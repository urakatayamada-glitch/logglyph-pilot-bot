import Link from "next/link";
import { requireAdmin } from "../../../../lib/admin-guard";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import {
  computeConversationMetrics,
  SPONTANEOUS_MIN_CHARS,
} from "../../../../lib/metrics";

export const dynamic = "force-dynamic";

interface LogRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  turn_index: number | null;
  moderation_flagged: boolean;
  moderation_categories: string[] | null;
}

export default async function SessionDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return (
      <main className="admin">
        <p className="admin-error">SUPABASE_SERVICE_ROLE_KEY が未設定です。</p>
      </main>
    );
  }

  const [{ data: session }, { data: logs }] = await Promise.all([
    supabase.from("sessions").select("*").eq("session_id", id).maybeSingle(),
    supabase
      .from("conversation_logs")
      .select("*")
      .eq("session_id", id)
      .order("created_at", { ascending: true }),
  ]);

  const rows = (logs ?? []) as LogRow[];
  const structured = session?.structured_memory as Record<string, unknown> | null;
  const m = computeConversationMetrics(
    rows.map((r) => ({ role: r.role, content: r.content }))
  );
  const fmtRate = (v: number | null) =>
    v == null ? "—" : `${Math.round(v * 100)}%`;

  return (
    <main className="admin">
      <div className="admin-head">
        <h1>Session</h1>
        <Link href="/admin" className="admin-back">
          ← 一覧へ
        </Link>
      </div>

      {!session && (
        <p className="admin-error">
          このセッションの記録がありません（vNext以前の会話ログの可能性があります）。
        </p>
      )}

      {session && (
        <section className="detail-meta">
          <Meta label="開始" value={new Date(session.started_at).toLocaleString("ja-JP")} />
          <Meta label="状態" value={session.status === "completed" ? "完了" : "進行中"} />
          <Meta label="Category" value={session.memory_trigger_category ?? "—"} />
          <Meta label="Episode Source" value={session.episode_source_type ?? "—"} />
          <Meta label="Prompt Version" value={session.prompt_version ?? "—"} />
          <Meta label="ユーザー発話数" value={String(session.user_message_count ?? 0)} />
          <Meta label="Memory Found" value={session.memory_found ? "○" : "—"} />
          <Meta label="話しやすさ" value={session.user_rating ? String(session.user_rating) : "—"} />
          <Meta
            label="また話したい"
            value={
              session.wants_to_talk_again == null
                ? "—"
                : session.wants_to_talk_again
                  ? "はい"
                  : "いいえ"
            }
          />
          {session.moderation_flag_count > 0 && (
            <Meta
              label="Moderation"
              value={`${session.moderation_flag_count} 件フラグ`}
              warn
            />
          )}
        </section>
      )}

      {rows.length > 0 && (
        <section className="detail-block">
          <h2>Conversation Metrics</h2>
          <div className="detail-meta">
            <Meta
              label="AI平均文字数 / Message"
              value={
                m.aiAvgCharsPerMessage == null
                  ? "—"
                  : m.aiAvgCharsPerMessage.toFixed(0)
              }
            />
            <Meta
              label="Question Turn Rate"
              value={`${fmtRate(m.questionTurnRate)}（${m.questionTurns}/${m.questionEligibleTurns}）`}
            />
            <Meta
              label="Spontaneous Continuation Proxy"
              value={`${fmtRate(m.spontaneousContinuationRate)}（${m.spontaneousContinuations}/${m.spontaneousOpportunities}）`}
            />
            <Meta
              label="AI / User 発話回数"
              value={`${m.aiMessageCount} / ${m.userMessageCount}`}
            />
          </div>
          <p className="admin-note">
            Question Turn Rate は冒頭のEpisodeを除外して算出しています。
            Spontaneous Continuation Proxy は、AIが質問しなかった発話の直後に
            ユーザーが {SPONTANEOUS_MIN_CHARS} 文字以上を話した割合による代理指標です。
          </p>
        </section>
      )}

      {session?.one_line_memory && (
        <section className="detail-block">
          <h2>One Line Memory</h2>
          <p className="one-line">{session.one_line_memory}</p>
        </section>
      )}

      {structured && (
        <section className="detail-block">
          <h2>Structured Memory</h2>
          <pre className="json">{JSON.stringify(structured, null, 2)}</pre>
        </section>
      )}

      <section className="detail-block">
        <h2>Conversation Log</h2>
        <div className="log">
          {rows.map((r) => (
            <div key={r.id} className={`log-row ${r.role}`}>
              <div className="log-role">
                {r.role === "user" ? "USER" : "AI"}
                {r.moderation_flagged && <span className="log-flag">flagged</span>}
              </div>
              <div className="log-body">{r.content}</div>
              <div className="log-time">
                {new Date(r.created_at).toLocaleTimeString("ja-JP")}
              </div>
            </div>
          ))}
          {rows.length === 0 && <p className="admin-empty">ログがありません。</p>}
        </div>
      </section>
    </main>
  );
}

function Meta({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className={warn ? "meta warn" : "meta"}>
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}
