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

export const dynamic = "force-dynamic";

interface SessionRow {
  session_id: string;
  started_at: string;
  completed_at: string | null;
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
  moderation_flag_count: number;
}

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

export default async function AdminHome() {
  await requireAdmin();

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

  const rows = (data ?? []) as SessionRow[];

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
        <Stat label="User / AI 文字比" value={charRatio} note="参考値" />
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
