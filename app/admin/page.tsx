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
  entryDenominator,
  threeLayerPull as computeThreeLayer,
  foundCampaignFunnel,
  FOUND_CAMPAIGNS,
  ELAPSED_BUCKETS,
  ELAPSED_BUCKET_LABELS,
  variantFunnels,
} from "../../lib/found";
import { EXPERIENCE_VARIANTS, VARIANT_LABELS } from "../../lib/experience";
import { PUBLIC_PILOT } from "../../lib/conversation/config";

export const dynamic = "force-dynamic";

interface SessionRow {
  session_id: string;
  started_at: string;
  completed_at: string | null;
  client_token: string | null;
  src: string | null;
  entry_context: string | null;
  experience_variant: string | null;
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

/**
 * 流入元の表示名。DBの src 値は書き換えず、表示だけ補助する。
 * 記事1は `note_wave2` で開始してしまったが、値は変えない（既存データを壊さない）。
 */
const SRC_LABELS: Record<string, string> = {
  note_wave2: "Wave2-A / 記事1",
  note_wave2_a2: "Wave2-A / 共創記事",
};

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
  searchParams: Promise<{ v?: string; s?: string; c?: string; i?: string }>;
}) {
  await requireAdmin();
  const {
    v: versionParam,
    s: srcParam,
    c: campaignParam,
    i: internalParam,
  } = await searchParams;

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
  const [
    entryRes,
    rejectRes,
    foundViewRes,
    noteRes,
    internalRes,
    receiptRes,
    storyViewRes,
  ] =
    await Promise.all([
    supabase
      .from("entry_views")
      .select("client_token, viewed_at, accepted_at, src")
      .order("viewed_at", { ascending: true }),
    supabase
      .from("capacity_rejections")
      .select("reason, rejected_at, src, client_token"),
    supabase
      .from("found_views")
      .select("client_token, viewed_at, value_response")
      .order("viewed_at", { ascending: true }),
    supabase
      .from("found_notes")
      .select("session_id, approved, campaign_key, first_sent_at"),
    supabase.from("internal_clients").select("client_token"),
    supabase.from("receipt_views").select("session_id"),
    supabase.from("story_views").select("session_id"),
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
    client_token: string | null;
  }>;
  const foundViewRows = (foundViewRes.data ?? []) as Array<{
    client_token: string;
    viewed_at: string;
    value_response: string | null;
  }>;
  const noteRows = (noteRes.data ?? []) as Array<{
    session_id: string;
    approved: boolean;
    campaign_key: string | null;
    first_sent_at: string | null;
  }>;
  const internalTokens = ((internalRes.data ?? []) as Array<{ client_token: string }>)
    .map((r) => r.client_token);
  const receiptSessionIds = (
    (receiptRes.data ?? []) as Array<{ session_id: string }>
  ).map((r) => r.session_id);
  const storySessionIds = (
    (storyViewRes.data ?? []) as Array<{ session_id: string }>
  ).map((r) => r.session_id);

  const stage1Since = entryRows.length > 0 ? entryRows[0].viewed_at : null;

  /*
   * 流入元の絞り込み。
   *
   * note読者と知人と運営のテストが同じ数字に混ざると、どちらも読めなくなる。
   * 実際 Wave 2 初日は「記事を開いた43人 → LOGGLYPHに到達30人（70%）」という
   * 記事のCTRとしてはあり得ない値が出た。混在が原因。
   *
   *   all      … 全部
   *   <src値>  … その流入元だけ（例: note_wave2）
   *   none     … src が付いていないもの（知人コホート・運営のテスト）
   */
  const srcValues = Array.from(
    new Set(
      [
        ...entryRows.map((r) => r.src),
        ...allRows.map((r) => r.src),
      ].filter((v): v is string => Boolean(v))
    )
  ).sort();
  const selectedSrc = srcParam ?? "all";
  const matchesSrc = (v: string | null) =>
    selectedSrc === "all" ? true : selectedSrc === "none" ? !v : v === selectedSrc;

  const entryScoped = entryRows.filter((r) => matchesSrc(r.src));

  // Stage 1 が動き出してからのセッションだけを3層の対象にする
  const stage1Sessions = (
    stage1Since ? allRows.filter((r) => r.started_at >= stage1Since) : []
  ).filter((r) => matchesSrc(r.src));

  const rejectScoped = rejectRows.filter((r) => matchesSrc(r.src));

  /*
   * 枠で断られただけの人を分母から外す。
   *
   * ⚠ ここは以前、画面に「分母から除外済み」と書いていながら
   *   実際には除外していなかった。表示が事実と違っていたので直した。
   *   断られたが別の日に会話できた人は、参加しているので分母に残す。
   */
  const entryDen = entryDenominator(
    entryScoped.map((r) => r.client_token),
    stage1Sessions
      .map((r) => r.client_token)
      .filter((t): t is string => Boolean(t)),
    rejectScoped
      .map((r) => r.client_token)
      .filter((t): t is string => Boolean(t))
  );
  const entryPeople = entryDen.people;
  const acceptedPeople = new Set(
    entryScoped.filter((r) => r.accepted_at).map((r) => r.client_token)
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
   * 記事ごとに分けて見たいので、流入元で絞った集合に対して数える
   * （以前は版で絞った rows を見ていたため、記事1と記事2が混ざった）。
   */
  const silent = splitSilentSessions(
    stage1Sessions.map((r) => ({
      client_token: r.client_token,
      started_at: r.started_at,
      user_message_count: r.user_message_count,
      memory_found: r.memory_found,
    }))
  );

  /* ============================================================
     Found Campaign（Wave 1 / Found Return 01）
     ============================================================

     ⚠ 母集団は src ではなく campaign_key で定義する。
       src が null のものには過去の開発・運営セッションが混ざるため、
       「src なし = Wave 1 知人」とは定義できない。

     ⚠ Post-Found Session 以降は「/found を開いた人」だけが対象。
       送付済みでも未閲覧の人は Return 判定に入れない。
       今回の問いは「Foundを見たことが Return Trigger になるか」であり、
       見ていない人の再訪はその問いに答えない。

     ⚠ Next-Day Return は経過時間ではなく JST の日付で判定する。
       Wave 1 の「同じ日に何度も使ったのを再訪と誤認した」を繰り返さないため。
  */
  const selectedCampaign =
    campaignParam && FOUND_CAMPAIGNS.some((c) => c.key === campaignParam)
      ? campaignParam
      : FOUND_CAMPAIGNS[0].key;
  const campaignLabel =
    FOUND_CAMPAIGNS.find((c) => c.key === selectedCampaign)?.label ?? selectedCampaign;
  const includeInternal = internalParam === "1";

  const foundSessionRows = allRows.map((r) => ({
    session_id: r.session_id,
    client_token: r.client_token,
    started_at: r.started_at,
    user_message_count: r.user_message_count,
    memory_found: r.memory_found,
    entry_context: r.entry_context,
  }));

  const campaign = foundCampaignFunnel({
    campaignKey: selectedCampaign,
    notes: noteRows,
    sessions: foundSessionRows,
    views: foundViewRows,
    internalTokens,
    includeInternal,
  });

  /*
   * Memory Found（記憶が出た人）と Found Eligible（配布できる人）は別物。
   * Eligible は approved な観察文があり、0発話でなく、campaign に属する人だけ。
   */
  /* ============================================================
     体験条件の比較（baseline / memory_receipt_v1）
     ============================================================
     ⚠ A/B ランダムテストではない。導入前後の比較である。
     流入元の絞り込み（上の src チップ）がそのまま効く。
  */
  const variantScoped = allRows.filter((r) => matchesSrc(r.src));
  const variants = variantFunnels({
    sessions: variantScoped.map((r) => ({
      session_id: r.session_id,
      client_token: r.client_token,
      started_at: r.started_at,
      completed_at: r.completed_at,
      memory_found: r.memory_found,
      experience_variant: r.experience_variant,
    })),
    receiptSessionIds,
    storySessionIds,
    internalTokens,
    includeInternal,
  });

  const memoryFoundPeople = new Set(
    allRows
      .filter((r) => r.memory_found && r.client_token && !isDeletedToken(r.client_token))
      .map((r) => r.client_token as string)
  ).size;

  /* ============================================================
     記事ごとの比較（Wave 2-A）
     ============================================================
     上限は記事ごとではなくコホート全体で1つ（合計30人）。
     比較していいのは Entry Pull / Conversation Pull / 初回0発話まで。
     Memory Found は、記事2の読者がテーマを理解して入ってくるため
     記事1や Wave 0/1 との単純比較はできない（参考値）。
  */
  const cohortSrcs = PUBLIC_PILOT.srcs as unknown as string[];
  const articleRows = cohortSrcs.map((src) => {
    const entry = entryRows.filter((r) => r.src === src);
    const sessions = (
      stage1Since ? allRows.filter((r) => r.started_at >= stage1Since) : []
    ).filter((r) => r.src === src);
    const rejects = rejectRows.filter((r) => r.src === src);
    const den = entryDenominator(
      entry.map((r) => r.client_token),
      sessions.map((r) => r.client_token).filter((t): t is string => Boolean(t)),
      rejects.map((r) => r.client_token).filter((t): t is string => Boolean(t))
    );
    const layer = computeThreeLayer(
      sessions.map((r) => ({
        client_token: r.client_token,
        started_at: r.started_at,
        user_message_count: r.user_message_count,
        memory_found: r.memory_found,
      })),
      den.people
    );
    const sil = splitSilentSessions(
      sessions.map((r) => ({
        client_token: r.client_token,
        started_at: r.started_at,
        user_message_count: r.user_message_count,
        memory_found: r.memory_found,
      }))
    );
    return {
      src,
      label: SRC_LABELS[src] ?? src,
      people: new Set(
        sessions.map((r) => r.client_token).filter(Boolean)
      ).size,
      entryPeople: den.people,
      excluded: den.excluded,
      started: layer.entry.started,
      entryRate: layer.entry.rate,
      talked: layer.conversation.talked,
      withMemory: layer.conversation.withMemory,
      convRate: layer.conversation.rate,
      firstSilent: sil.firstSilent,
      laterSilent: sil.laterSilent,
    };
  });
  const cohortPeopleTotal = new Set(
    allRows
      .filter((r) => r.src && cohortSrcs.includes(r.src))
      .map((r) => r.client_token)
      .filter(Boolean)
  ).size;

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

  // 版チップを押しても流入元の選択が消えないようにする
  /**
   * 現在のURLパラメータを保ったままリンクを作る。
   * 版・流入元・campaign・運営テスト表示が、片方を押すと片方に戻る事故を防ぐ。
   */
  const currentParams: Record<string, string | undefined> = {
    v: versionParam,
    s: srcParam,
    c: campaignParam,
    i: internalParam,
  };
  const adminHref = (next: Record<string, string | undefined>) => {
    const merged = { ...currentParams, ...next };
    const q = Object.entries(merged)
      .filter(([, v]) => v != null && v !== "")
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join("&");
    return q ? `/admin?${q}` : "/admin";
  };

  const srcQuery = selectedSrc === "all" ? "" : `s=${encodeURIComponent(selectedSrc)}&`;
  const versionQuery =
    selectedVersion && selectedVersion !== "all"
      ? `v=${encodeURIComponent(selectedVersion)}&`
      : selectedVersion === "all"
        ? "v=all&"
        : "";

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
            href={`/admin?${srcQuery}v=${encodeURIComponent(v)}`}
            className={selectedVersion === v ? "vchip on" : "vchip"}
          >
            {v}
          </Link>
        ))}
        <Link
          href={`/admin?${srcQuery}v=all`}
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
      {/*
        流入元の絞り込み。この節にだけ効く（版フィルタは効かない）。
        混ぜると note読者と知人のどちらの数字も読めなくなる。
      */}
      <div className="admin-filter">
        <Link
          href={`/admin?${versionQuery}s=all`}
          className={selectedSrc === "all" ? "vchip on" : "vchip"}
        >
          全体
        </Link>
        {srcValues.map((v) => (
          <Link
            key={v}
            href={`/admin?${versionQuery}s=${encodeURIComponent(v)}`}
            className={selectedSrc === v ? "vchip on" : "vchip"}
          >
            {v}
          </Link>
        ))}
        <Link
          href={`/admin?${versionQuery}s=none`}
          className={selectedSrc === "none" ? "vchip on" : "vchip"}
        >
          知人・運営（src なし）
        </Link>
      </div>
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
            いま表示している流入元：
            <strong>
              {selectedSrc === "all"
                ? "全体（note読者・知人・運営が混ざっています）"
                : selectedSrc === "none"
                  ? "知人・運営（src なし）"
                  : selectedSrc}
            </strong>
            。
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

      {/* ============================================================
          記事ごとの比較（Wave 2-A）
          ============================================================ */}
      <h2>記事ごとの比較（Wave 2-A）</h2>
      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th />
              {articleRows.map((a) => (
                <th key={a.src}>{a.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>到達（枠で断られた人を除く）</th>
              {articleRows.map((a) => (
                <td key={a.src}>
                  {a.entryPeople}
                  {a.excluded > 0 && <em>−{a.excluded}</em>}
                </td>
              ))}
            </tr>
            <tr>
              <th>会話を始めた</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.started}</td>
              ))}
            </tr>
            <tr className="cmp-key">
              <th>Entry Pull</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.entryRate == null ? "—" : `${a.entryRate}%`}</td>
              ))}
            </tr>
            <tr>
              <th>一言でも話した</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.talked}</td>
              ))}
            </tr>
            <tr className="cmp-key">
              <th>Conversation Pull</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.convRate == null ? "—" : `${a.convRate}%`}</td>
              ))}
            </tr>
            <tr className="cmp-key">
              <th>初回0発話</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.firstSilent}</td>
              ))}
            </tr>
            <tr>
              <th>2本目以降0発話</th>
              {articleRows.map((a) => (
                <td key={a.src}>{a.laterSilent}</td>
              ))}
            </tr>
            <tr>
              <th>Memory Found（参考値）</th>
              {articleRows.map((a) => (
                <td key={a.src} className="cmp-ref">
                  {a.withMemory} / {a.talked}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="admin-note">
        <strong>
          Wave 2-A 受付：{cohortPeopleTotal} / {PUBLIC_PILOT.cohortTotalPeople}人
        </strong>
        （記事ごとではなくコホート合計。上限は人数で数えています）
        <br />
        比較していいのは <strong>Entry Pull / Conversation Pull / 初回0発話</strong> です。
        Memory Found は参考値にとどめてください。記事2の読者は「記憶」というテーマを
        理解した状態で入ってくるため、記事1や Wave 0 / Wave 1 との単純比較ができません。
        <br />
        <strong>
          そして、記事の書き方が効くのはこの表の手前です。
        </strong>
        note のページビュー ÷ 上の「到達」で、記事から来た人の割合が出ます。
        この表の Entry Pull は「到達したあと会話を始めたか」なので、副指標です。
        <br />
        同じ日に両方の記事から来た人は、先に開いた記事に集計されます
        （到達イベントは同一端末・同一日で1行に集約するため）。n が小さいうちは効きます。
      </p>

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

      {/* ---------- 体験条件の比較 ---------- */}
      <h2>体験条件の比較（baseline / memory_receipt_v1）</h2>
      <p className="admin-note">
        会話そのものは両条件で完全に同一です（v1.5.1 / gpt-4o / Episode / Prompt は不変）。
        違うのは会話が終わったあとに何を出すかだけです。
        <br />
        baseline … Future Preview（この先3つが育ちます／現在開発中）
        <br />
        memory_receipt_v1 … Memory Receipt（今日ひとつ残りました／確定した記録）
      </p>

      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              <th />
              {EXPERIENCE_VARIANTS.map((v) => (
                <th key={v}>{VARIANT_LABELS[v]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["対象者", (f: typeof variants[string]) => f?.people],
                ["Session Completed", (f: typeof variants[string]) => f?.completed],
                ["Memory Found", (f: typeof variants[string]) => f?.memoryFound],
                [
                  "Memory Receipt Viewed",
                  (f: typeof variants[string]) => f?.receiptViewed,
                ],
                [
                  "Story Fragment Viewed",
                  (f: typeof variants[string]) => f?.storyViewed,
                ],
                [
                  "Same-Day Continuation",
                  (f: typeof variants[string]) => f?.sameDayContinuation,
                ],
                ["Next-Day Return", (f: typeof variants[string]) => f?.nextDayReturn],
                ["New Memory Found", (f: typeof variants[string]) => f?.newMemoryFound],
              ] as const
            ).map(([label, pick]) => (
              <tr key={label} className={label === "Next-Day Return" ? "cmp-key" : ""}>
                <th>{label}</th>
                {EXPERIENCE_VARIANTS.map((v) => (
                  <td key={v}>{pick(variants[v]) ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="admin-note">
        Primary KPI は <b>Next-Day Return</b>（JSTの日付が変わってから戻った人）です。
        Memory Receipt Viewed / Same-Day Continuation / New Memory Found は Secondary。
        <br />
        ⚠ <b>これは A/B ランダムテストではありません。</b>
        フラグを入れた時刻を境にした前後比較です。記事1の読者と、それ以降の読者は
        同じ集団ではありません。n も小さいため、統計的効果とは扱わず
        <b>Positive / Negative Signal</b> として読んでください。
        <br />
        Return の起点は両条件で同じ「記憶が出た最初のセッションの終了時刻」です。
        Memory Receipt を見たかどうかは起点にしていません（baseline に対応物が無く、
        比較が成立しなくなるため）。
        <br />
        1人が両条件にまたがらないよう、その人の最初のセッションの条件で所属を決めています。
      </p>

      {/* ---------- Found Campaign ---------- */}
      <h2>Found Campaign : {campaignLabel}</h2>
      <p className="admin-note">
        母集団は src ではなく campaign_key で定義しています。src が付いていない
        セッションには過去の開発・運営テストが混ざるため、「src なし = Wave 1 知人」
        とは定義できません。Wave 2-A（note読者）とは campaign 単位で完全に分離されます。
      </p>

      <div className="admin-filter">
        {FOUND_CAMPAIGNS.map((c) => (
          <Link
            key={c.key}
            className={c.key === selectedCampaign ? "vchip on" : "vchip"}
            href={adminHref({ c: c.key })}
          >
            {c.label}
          </Link>
        ))}
        <Link
          className={includeInternal ? "vchip on" : "vchip"}
          href={adminHref({ i: includeInternal ? undefined : "1" })}
        >
          運営テストを含む
        </Link>
      </div>

      <section className="stats compact">
        <Stat
          label="Memory Found"
          value={String(memoryFoundPeople)}
          note="記憶が出た人（全体・参考値）"
        />
        <Stat
          label="Known Eligible"
          value={String(campaign.eligible)}
          note="承認済み観察文あり／0発話でない／campaign対象"
        />
        <Stat
          label="Campaign Message Sent"
          value={campaign.sent > 0 ? "1" : "0"}
          note={`共通URLを1回、グループ全体へ（対象 ${campaign.sent}人）`}
        />
        <Stat
          label="Eligible Viewed"
          value={pct(campaign.viewed, campaign.sent)}
          note={`${campaign.viewed} / ${campaign.sent}人`}
        />
        <Stat
          label="Value Response"
          value={`fit ${campaign.valueCounts.fit}`}
          note={`off ${campaign.valueCounts.off} / unknown ${campaign.valueCounts.unknown}（1人1票）`}
        />
        <Stat
          label="観察文"
          value={`${approvedNotes} 承認済み`}
          note={`未承認 ${pendingNotes}件（未承認は画面に出ません）`}
        />
      </section>

      <section className="stats compact">
        <Stat
          label="Post-Found Session"
          value={pct(campaign.postFoundSession, campaign.viewed)}
          note={`${campaign.postFoundSession} / 閲覧 ${campaign.viewed}人`}
        />
        <Stat
          label="├ Same-Day Continuation"
          value={String(campaign.sameDayContinuation)}
          note="同じJST日付。再訪ではない"
        />
        <Stat
          label="└ Next-Day Return"
          value={String(campaign.nextDayReturn)}
          note="Primary KPI。JSTの日付が変わった"
        />
        <Stat
          label="Direct from Found"
          value={String(campaign.directFromFound)}
          note="?from=found 経由（補助指標）"
        />
        <Stat
          label="New Memory Found"
          value={String(campaign.newMemoryFound)}
          note="閲覧後の会話で新しい記憶が出た人"
        />
        <Stat
          label="fit × Next-Day Return"
          value={`${campaign.fitAndNextDay} / ${campaign.fitPeople}`}
          note="fit と答えた人のうち翌日以降に戻った人"
        />
      </section>

      <p className="admin-note">
        ⚠ Next-Day Return は経過時間ではなく JST の日付で判定しています。
        9/11 23:50 閲覧 → 9/12 00:10 会話 は経過20分でも Next-Day Return、
        9/11 10:00 閲覧 → 9/11 20:00 会話 は経過10時間でも Same-Day Continuation です。
        Wave 1 の「同じ日に何度も使ったのを再訪と誤認した」を繰り返さないためです。
        <br />
        Post-Found 以降の分母は「閲覧した人」です。配信対象でも未閲覧の人は
        Return 判定に入れていません。
        <br />
        ⚠ <b>個別送付ではありません。</b>client_token は誰のものか記録していないため、
        個人を指定して送ることはできません。共通URLをグループ全体へ1回送り、
        そのうち記憶を持つ人が Known Eligible です。
        <br />
        ⚠ 会話したときと別の端末・ブラウザで開いた人は「記録がありません」になります。
        Eligible Viewed は実態より少なく出ます。
        {!includeInternal && campaign.internalExcluded > 0 && (
          <>
            <br />
            運営テストとして明示登録された {campaign.internalExcluded}人を除外しています
            （自動判定はしていません）。
          </>
        )}
      </p>

      <h2>Diagnostic : 閲覧 → 会話の経過時間</h2>
      <p className="admin-note">
        これは診断用です。Return の判定には使いません。
      </p>
      <div className="cmp-wrap">
        <table className="cmp">
          <thead>
            <tr>
              {ELAPSED_BUCKETS.map((b) => (
                <th key={b}>{ELAPSED_BUCKET_LABELS[b]}</th>
              ))}
              <th>中央値</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {ELAPSED_BUCKETS.map((b) => (
                <td key={b}>{campaign.buckets[b]}</td>
              ))}
              <td>
                {medianMinutes(campaign.elapsedMinutes) == null
                  ? "—"
                  : `${medianMinutes(campaign.elapsedMinutes)}分`}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
