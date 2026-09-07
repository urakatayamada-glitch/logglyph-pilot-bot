import Link from "next/link";
import { requireAdmin } from "../../lib/admin-guard";
import {
  describeSupabaseConfig,
  getSupabaseAdmin,
  isAdminConfigured,
} from "../../lib/supabase-server";
import {
  aggregateMetrics,
  computeConversationMetrics,
  LogMessage,
  SPONTANEOUS_MIN_CHARS,
} from "../../lib/metrics";
import {
  threeLayerPull,
  splitSilentSessions,
  minutesToRevisit,
  medianMinutes,
  isDeletedToken,
  countValueResponsesPerPerson,
} from "../../lib/found";

export const dynamic = "force-dynamic";

interface SessionRow {
  session_id: string;
  started_at: string;
  completed_at: string | null;
  client_token: string | null;
  src: string | null;
  content_deleted_at: string | null;
  status: string;
  memory_trigger_category: string | null;
  episode_source_type: string | null;
  prompt_version: string | null;
  user_message_count: number;
  user_char_count: number;
  ai_char_count: number;
  memory_found: boolean;
  hidden_candidate_found: boolean;
  one_line_memory: string | null;
  user_rating: number | null;
  wants_to_talk_again: boolean | null;
  followup_answers: Record<string, number> | null;
  moderation_flag_count: number;
}

/** Wave 1（v1.5.0）で Future Preview のあとに聞く4問 */
const FOLLOWUP_QUESTIONS: { key: string; label: string }[] = [
  { key: "future_curiosity", label: "この先が気になった" },
  { key: "want_to_accumulate", label: "記録を貯めたい" },
  { key: "want_five_day_insight", label: "5日後を見たい" },
  { key: "understood_continuation_value", label: "続ける意味が分かった" },
];

function pct(n: number, d: number) {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function rate(v: number | null) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function num(v: number | null, digits = 1) {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function avg(values: number[]) {
  if (!values.length) return "—";
  return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
}

export default async function AdminHome({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>;
}) {
  await requireAdmin();
  const { v: versionParam } = await searchParams;

  if (!isAdminConfigured()) {
    return (
      <main className="admin">
        <h1>LOGGLYPH ADMIN</h1>
        <p className="admin-error">
          SUPABASE_SERVICE_ROLE_KEY が設定されていません。Vercelの環境変数を確認してください。
        </p>
      </main>
    );
  }

  const supabase = getSupabaseAdmin()!;
  const [{ data, error }, episodeCount] = await Promise.all([
    supabase
      .from("sessions")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(200),
    supabase
      .from("memory_trigger_episodes")
      .select("id", { count: "exact", head: true }),
  ]);

  const allRows = (data ?? []) as SessionRow[];

  /*
   * prompt_version の絞り込み（Wave 1 で追加）。
   * Wave 0（v1.4.0）と Wave 1（v1.5.0）が混ざると Primary KPI が読めなくなる。
   * 既定は「最新の版」。件数が小さいので、全件取得してから絞っている。
   */
  const versions = Array.from(
    new Set(allRows.map((r) => r.prompt_version).filter(Boolean) as string[])
  ).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const latestVersion = versions[0] ?? null;
  const selectedVersion =
    versionParam === "all"
      ? "all"
      : versionParam && versions.includes(versionParam)
        ? versionParam
        : latestVersion;

  const rows =
    selectedVersion && selectedVersion !== "all"
      ? allRows.filter((r) => r.prompt_version === selectedVersion)
      : allRows;

  /**
   * キーの取り違えを検出する。
   *
   * service_role（secret）キーはRLSを無視して読めるが、
   * publishable / anon キーだとRLSに弾かれ、エラーではなく「0件」が返る。
   * Episodeを投入済みなのに0件に見える場合は、ほぼ確実にキーが違う。
   */
  const episodesVisible = episodeCount.count ?? 0;
  const keyLooksWrong = episodesVisible === 0;
  const config = describeSupabaseConfig();

  // 会話ログから算出する指標（DB追加変更なし）
  const ids = rows.map((r) => r.session_id);
  let logs: { session_id: string; role: "user" | "assistant"; content: string }[] =
    [];
  if (ids.length > 0) {
    const { data: logData } = await supabase
      .from("conversation_logs")
      .select("session_id, role, content")
      .in("session_id", ids)
      .order("created_at", { ascending: true });
    logs = (logData ?? []) as typeof logs;
  }

  const bySession = new Map<string, LogMessage[]>();
  for (const l of logs) {
    const arr = bySession.get(l.session_id) ?? [];
    arr.push({ role: l.role, content: l.content });
    bySession.set(l.session_id, arr);
  }
  const perSession = ids
    .map((id) => bySession.get(id))
    .filter((v): v is LogMessage[] => Boolean(v?.length))
    .map(computeConversationMetrics);
  const m = aggregateMetrics(perSession);

  const completed = rows.filter((r) => r.status === "completed");
  const withMemory = rows.filter((r) => r.memory_found);
  const withHidden = rows.filter((r) => r.hidden_candidate_found);
  const rated = rows.filter((r) => r.user_rating != null);
  const againYes = rows.filter((r) => r.wants_to_talk_again === true);
  const againAnswered = rows.filter((r) => r.wants_to_talk_again != null);

  const totalUserChars = rows.reduce((a, r) => a + (r.user_char_count ?? 0), 0);
  const totalAiChars = rows.reduce((a, r) => a + (r.ai_char_count ?? 0), 0);
  const charRatio =
    totalUserChars + totalAiChars > 0
      ? `${Math.round((totalUserChars / (totalUserChars + totalAiChars)) * 100)}% / ${Math.round(
          (totalAiChars / (totalUserChars + totalAiChars)) * 100
        )}%`
      : "—";

  // Wave 1 追加設問（Future Preview のあとに聞いた4問）の平均
  const followupRows = rows.filter((r) => r.followup_answers != null);
  const followupAvg = FOLLOWUP_QUESTIONS.map((q) => {
    const values = followupRows
      .map((r) => r.followup_answers?.[q.key])
      .filter((v): v is number => typeof v === "number");
    return {
      ...q,
      answered: values.length,
      avg: values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null,
    };
  });

  /* ============================================================
     3層の引き（Entry / Conversation / Return）と found ファネル
     ============================================================

     Wave 1 ではこの3つが1つの数字に混ざっていたため、
     「改善したのは中段だけ」という事実が Admin から見えなかった。

     ⚠ Entry Pull の分母（entry_views）は Stage 1 を入れた時点から
       しか存在しない。それより前のセッションと並べると分母が足りず、
       Entry Pull が実態より良く見える。したがって
       「最初の entry_view の時刻」以降のセッションだけを対象にする。
       prompt_version では絞らない（Stage 1 の有無が別の時代を作るため）。
  */
  const [entryRes, rejectRes, foundViewRes, noteRes] = await Promise.all([
    supabase
      .from("entry_views")
      .select("client_token, viewed_at, accepted_at, src")
      .order("viewed_at", { ascending: true }),
    supabase
      .from("capacity_rejections")
      .select("reason, rejected_at, src"),
    supabase
      .from("found_views")
      .select("client_token, viewed_at, value_response")
      .order("viewed_at", { ascending: true }),
    supabase
      .from("found_notes")
      .select("session_id, approved"),
  ]);

  const entryRows = (entryRes.data ?? []) as Array<{
    client_token: string;
    viewed_at: string;
    accepted_at: string | null;
    src: string | null;
  }>;
  const rejectRows = (rejectRes.data ?? []) as Array<{
    reason: string;
    rejected_at: string;
    src: string | null;
  }>;
  const foundViewRows = (foundViewRes.data ?? []) as Array<{
    client_token: string;
    viewed_at: string;
    value_response: string | null;
  }>;
  const noteRows = (noteRes.data ?? []) as Array<{
    session_id: string;
    approved: boolean;
  }>;

  const stage1Since = entryRows.length > 0 ? entryRows[0].viewed_at : null;

  // Stage 1 が動き出してからのセッションだけを3層の対象にする
  const stage1Sessions = stage1Since
    ? allRows.filter((r) => r.started_at >= stage1Since)
    : [];

  const entryPeople = new Set(entryRows.map((r) => r.client_token)).size;
  const acceptedPeople = new Set(
    entryRows.filter((r) => r.accepted_at).map((r) => r.client_token)
  ).size;

  const layers = threeLayerPull(
    stage1Sessions.map((r) => ({
      client_token: r.client_token,
      started_at: r.started_at,
      user_message_count: r.user_message_count,
      memory_found: r.memory_found,
    })),
    entryPeople
  );

  /*
   * 0発話の分離。
   * 1本目が0発話 = 本当の離脱。2本目以降が0発話 = 1本話したあと覗いて閉じた。
   * 混ぜると Completion / Memory Found が実態より低く出る（Wave 1 で実際に起きた）。
   * ここは prompt_version で絞った rows に対して見る。
   */
  const silent = splitSilentSessions(
    rows.map((r) => ({
      client_token: r.client_token,
      started_at: r.started_at,
      user_message_count: r.user_message_count,
      memory_found: r.memory_found,
    }))
  );

  /* found ファネル。閲覧 → 1タップ → 再訪 → 新規Memory */
  const foundPeople = new Set(foundViewRows.map((r) => r.client_token)).size;
  /*
   * 1タップ評価は1人1票で数える。
   * /found を開くたびに found_views の行が増えるため、行を素直に数えると
   * 同じ人が何度も開いて押した分だけ回答が水増しされる。最初の回答だけを採る。
   */
  const valueCounts = countValueResponsesPerPerson(foundViewRows);

  const sessionsByToken = new Map<string, SessionRow[]>();
  for (const r of allRows) {
    if (!r.client_token) continue;
    const list = sessionsByToken.get(r.client_token) ?? [];
    list.push(r);
    sessionsByToken.set(r.client_token, list);
  }

  // 1人につき最初の閲覧だけを見る（同じ人が何度も開いても再訪は1回で数える）
  const firstFoundViewByToken = new Map<string, string>();
  for (const r of foundViewRows) {
    if (!firstFoundViewByToken.has(r.client_token)) {
      firstFoundViewByToken.set(r.client_token, r.viewed_at);
    }
  }

  const revisitMinutes: number[] = [];
  let revisitPeople = 0;
  let revisitWithNewMemory = 0;
  for (const [token, viewedAt] of firstFoundViewByToken) {
    const own = sessionsByToken.get(token) ?? [];
    const mins = minutesToRevisit(
      viewedAt,
      own.map((s) => s.started_at)
    );
    if (mins == null) continue;
    revisitPeople += 1;
    revisitMinutes.push(mins);
    const after = own.filter((s) => s.started_at > viewedAt);
    if (after.some((s) => s.memory_found)) revisitWithNewMemory += 1;
  }

  const approvedNotes = noteRows.filter((n) => n.approved).length;
  const pendingNotes = noteRows.length - approvedNotes;
  const deletedSessions = allRows.filter(
    (r) => r.content_deleted_at || isDeletedToken(r.client_token)
  ).length;

  // カテゴリ別の成績（どのEpisodeが記憶を引き出せたか）
  const byCategory = new Map<string, { total: number; found: number }>();
  for (const r of rows) {
    const key = r.memory_trigger_category ?? "(未設定)";
    const cur = byCategory.get(key) ?? { total: 0, found: 0 };
    cur.total += 1;
    if (r.memory_found) cur.found += 1;
    byCategory.set(key, cur);
  }

  return (
    <main className="admin">
      <div className="admin-head">
        <h1>LOGGLYPH ADMIN</h1>
        <span className="admin-sub">Pilot Observability</span>
        <span className="admin-now">
          現在表示：{selectedVersion === "all" ? "All" : (selectedVersion ?? "—")}
          <em>{rows.length} / {allRows.length} セッション</em>
        </span>
      </div>

      {/*
        Wave 0（v1.4.0）と Wave 1（v1.5.0）が混ざると Primary KPI が読めない。
        既定は最新の版だけを表示する。
      */}
      <div className="admin-filter">
        {versions.map((v) => (
          <Link
            key={v}
            href={`/admin?v=${encodeURIComponent(v)}`}
            className={selectedVersion === v ? "vchip on" : "vchip"}
          >
            {v}
          </Link>
        ))}
        <Link
          href="/admin?v=all"
          className={selectedVersion === "all" ? "vchip on" : "vchip"}
        >
          All
        </Link>
      </div>

      {(keyLooksWrong || error) && (
        <div className="admin-warn">
          <strong>DBが読めていません。</strong>
          {error && (
            <p>
              エラー内容: <code>{error.message}</code>
            </p>
          )}
          <p>
            現在の設定 — URL: <code>{config.url}</code> / キー種別:{" "}
            <code>{config.keyKind}</code>（{config.keyLength}文字）
          </p>
          {config.keyKind.includes("誤り") && (
            <p>
              <strong>
                SUPABASE_SERVICE_ROLE_KEY に publishable キーが入っています。
              </strong>
              Supabase → Project Settings → API Keys の Secret keys にある値
              （<code>sb_secret_</code> で始まるもの）に差し替えてください。
            </p>
          )}
          {(config.rawUrlHadPath || config.rawUrlHadTrailingSlash) && (
            <p>
              NEXT_PUBLIC_SUPABASE_URL に余計な部分が含まれていました（設定値:{" "}
              <code>{config.rawUrl}</code>）。コード側でホスト部分のみを使って接続しますが、
              環境変数もプロジェクトURLだけ（<code>https://xxxx.supabase.co</code>）
              にしておくことを推奨します。
            </p>
          )}
          <p>この状態では会話も記録されません。</p>
        </div>
      )}

      {/* ============================================================
          3層の引き。Wave 2 以降はここを主に見る。
          ============================================================ */}
      <h2>3層の引き（Entry / Conversation / Return）</h2>
      {stage1Since ? (
        <>
          <section className="stats">
            <Stat
              label="Entry Pull"
              value={layers.entry.rate == null ? "—" : `${layers.entry.rate}%`}
              note={`会話を始めた ${layers.entry.started}人 / 到達 ${layers.entry.views}人`}
            />
            <Stat
              label="注意書きに同意"
              value={pct(acceptedPeople, entryPeople)}
              note={`${acceptedPeople} / ${entryPeople}人（到達→同意→開始 の中段）`}
            />
            <Stat
              label="Conversation Pull"
              value={
                layers.conversation.rate == null
                  ? "—"
                  : `${layers.conversation.rate}%`
              }
              note={`記憶が出た ${layers.conversation.withMemory}人 / 会話した ${layers.conversation.talked}人`}
            />
            <Stat
              label="Return Pull"
              value={layers.returning.rate == null ? "—" : `${layers.returning.rate}%`}
              note={`2日以上使った ${layers.returning.repeat}人 / ${layers.returning.people}人（JST日付）`}
            />
            <Stat
              label="枠で断った"
              value={String(rejectRows.length)}
              note="Entry Pull の分母から除外済み"
            />
          </section>
          <p className="admin-note">
            Entry Pull の分母は Stage 1（到達イベント）以降のみです。
            対象は {new Date(stage1Since).toLocaleString("ja-JP")} 以降に始まった
            {" "}{stage1Sessions.length} セッション。
            <strong>prompt_version では絞っていません</strong>
            （Stage 1 の有無が別の時代を作るため）。上の版フィルタはこの節に効きません。
            <br />
            「枠で断った」は上限に達して会話を始められなかった人です。
            興味がなくて始めなかった人と混ぜると Entry Pull が壊れるため、
            分母から除いています。
            {rejectRows.length > 0 && (
              <>
                {" "}内訳：
                {Object.entries(
                  rejectRows.reduce<Record<string, number>>((acc, r) => {
                    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
                    return acc;
                  }, {})
                )
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" / ")}
              </>
            )}
          </p>
        </>
      ) : (
        <p className="admin-note">
          Stage 1（到達イベント）のデータがまだありません。Entry Pull は
          entry_views に最初の行が入ってから表示されます。
          それまで Entry Pull は<strong>一度も実測されていません</strong>
          （「はじめる」を押すまでサーバーに何も記録していなかったため）。
        </p>
      )}

      <h2>0発話の内訳</h2>
      <section className="stats compact">
        <Stat
          label="1本目が0発話"
          value={String(silent.firstSilent)}
          note="Episodeを読んで帰った。本当の離脱"
        />
        <Stat
          label="2本目以降が0発話"
          value={String(silent.laterSilent)}
          note="1本話したあと覗いて閉じた。離脱ではない"
        />
      </section>
      <p className="admin-note">
        この2つを「0発話」として一括りにすると、Completion / Memory Found が
        実態より低く出ます（Wave 1 で実際に起きました）。下の Primary KPI は
        まだ分離していない値です。
      </p>

      {/* ---------- found ファネル ---------- */}
      <h2>/found ファネル</h2>
      <section className="stats compact">
        <Stat label="閲覧した人" value={String(foundPeople)} note="ユニーク端末" />
        <Stat
          label="しっくりきた"
          value={String(valueCounts.fit)}
          note={`少し違う ${valueCounts.off} / わからない ${valueCounts.unknown}（1人1票）`}
        />
        <Stat
          label="閲覧後に再訪"
          value={pct(revisitPeople, foundPeople)}
          note={`${revisitPeople} / ${foundPeople}人`}
        />
        <Stat
          label="再訪までの中央値"
          value={
            medianMinutes(revisitMinutes) == null
              ? "—"
              : `${medianMinutes(revisitMinutes)}分`
          }
          note={revisitMinutes.length ? `${revisitMinutes.length}件` : "再訪なし"}
        />
        <Stat
          label="再訪で新規Memory"
          value={String(revisitWithNewMemory)}
          note={`再訪 ${revisitPeople}人のうち`}
        />
        <Stat
          label="観察文"
          value={`${approvedNotes} 承認済み`}
          note={`未承認 ${pendingNotes}件（未承認は画面に出ません）`}
        />
      </section>
      <p className="admin-note">
        /found の案内は Return Pull を測るための Trigger です。案内文に
        「また使ってください」を書かないこと。書くと、その後の再訪が
        誘導された行動になり、Return Pull が測れなくなります。
        {deletedSessions > 0 && (
          <>
            <br />
            本人の削除操作で内容を消したセッション：{deletedSessions}件。
            行と匿名の集計値は残しています（設計どおり）。
          </>
        )}
      </p>

      <h2>Primary KPI</h2>
      <section className="stats">
        <Stat label="Sessions" value={String(rows.length)} />
        <Stat
          label="Memory Found Rate"
          value={pct(withMemory.length, rows.length)}
          note={`Level 1 ／ ${withMemory.length} / ${rows.length}`}
        />
        <Stat
          label="Conversation Completion"
          value={pct(completed.length, rows.length)}
          note={`${completed.length} / ${rows.length}`}
        />
        <Stat
          label="話しやすさ 平均"
          value={avg(rated.map((r) => r.user_rating as number))}
          note={`${rated.length} 件回答`}
        />
        <Stat
          label="また話したい"
          value={pct(againYes.length, againAnswered.length)}
          note={`${againAnswered.length} 件回答`}
        />
        <Stat
          label="AI平均文字数 / Message"
          value={num(m.aiAvgCharsPerMessage, 0)}
          note="短いほど聞き役に寄っている"
        />
        <Stat
          label="Question Turn Rate"
          value={rate(m.questionTurnRate)}
          note={`${m.questionTurns} / ${m.questionEligibleTurns}（冒頭Episodeは除外）`}
        />
        <Stat
          label="Spontaneous Continuation Proxy"
          value={rate(m.spontaneousContinuationRate)}
          note={`${m.spontaneousContinuations} / ${m.spontaneousOpportunities}　代理指標`}
        />
      </section>

      <div className="admin-note">
        <strong>Spontaneous Continuation Proxy は代理指標です。</strong>
        AIが質問しなかった発話の直後に、ユーザーが {SPONTANEOUS_MIN_CHARS}{" "}
        文字以上を話した割合です。「記憶が実際に追加されたか」は機械判定できないため、
        発話量で近似しています。真に意味が追加されたことは保証しません。
      </div>

      {followupRows.length > 0 && (
        <>
          <h2>Wave 1 追加設問（Future Preview を見たあと）</h2>
          <section className="stats compact">
            {followupAvg.map((q) => (
              <Stat
                key={q.key}
                label={q.label}
                value={num(q.avg, 2)}
                note={`${q.answered} 件回答 ／ 5点満点`}
              />
            ))}
          </section>
          <div className="admin-note">
            これは <strong>Future Preview を見たあと</strong>の回答です。
            上の「また話したい」は Preview を見る<strong>前</strong>に取っており、
            Wave 0 と同条件です。会話そのものの引き（前者）と、
            提示した未来による期待（後者）を分けて読んでください。
          </div>
        </>
      )}

      <h2>Level 2（Primary KPIではない）</h2>
      <section className="stats compact">
        <Stat
          label="Hidden Candidate"
          value={pct(withHidden.length, rows.length)}
          note={`${withHidden.length} 件 ／ null は正常`}
        />
      </section>

      <div className="admin-note">
        Hidden Candidate は、Memory の中に本人がまだ十分言語化していなかった意味が
        存在した場合にのみ生成されます。<strong>null は正常な結果です。</strong>
        本人が自分で意味づけまで語り切った場合、Hidden は残りません。
      </div>

      <h2>Diagnostic（成功判定には使わない）</h2>
      <section className="stats compact">
        <Stat label="User / AI 文字比" value={charRatio} note="Episodeを含む／参考値" />
        <Stat
          label="ユーザー発話比（Episode除外）"
          value={rate(m.userDialogueShare)}
          note="冒頭Episodeを分母から除いた値"
        />
        <Stat
          label="平均ユーザー発話数"
          value={avg(rows.map((r) => r.user_message_count ?? 0))}
        />
        <Stat
          label="AI / User 発話回数"
          value={`${m.aiMessageCount} / ${m.userMessageCount}`}
        />
      </section>

      <h2>カテゴリ別</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Sessions</th>
            <th>Memory Found</th>
          </tr>
        </thead>
        <tbody>
          {[...byCategory.entries()]
            .sort((a, b) => b[1].total - a[1].total)
            .map(([cat, v]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td>{v.total}</td>
                <td>{pct(v.found, v.total)}</td>
              </tr>
            ))}
        </tbody>
      </table>

      <h2>Sessions</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>開始</th>
            <th>状態</th>
            <th>Category</th>
            <th>発話</th>
            <th>Memory</th>
            <th>One Line Memory</th>
            <th>Prompt</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.session_id} className={r.moderation_flag_count > 0 ? "flagged" : ""}>
              <td>{new Date(r.started_at).toLocaleString("ja-JP")}</td>
              <td>{r.status === "completed" ? "完了" : "進行中"}</td>
              <td>{r.memory_trigger_category ?? "—"}</td>
              <td>{r.user_message_count ?? 0}</td>
              <td>{r.memory_found ? "○" : "—"}</td>
              <td className="ellipsis">{r.one_line_memory ?? "—"}</td>
              <td>{r.prompt_version ?? "—"}</td>
              <td>
                <Link href={`/admin/sessions/${r.session_id}`}>詳細</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length === 0 && <p className="admin-empty">まだセッションがありません。</p>}
    </main>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
