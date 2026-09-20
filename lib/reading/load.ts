import { getSupabaseAdmin } from "../supabase-server";
import type { ReadingInput } from "./types.ts";

/**
 * Benchmark の入力を組み立てる。
 *
 * ⚠ one_line_memory / structured_memory は**読み込まない**（v0.3 §0.5）。
 *   要約は抽出器が書いた文であって本人の発話ではない。
 *   入力に混ぜると、モデルが要約の言い回しを本人の言葉だと誤認する。
 *   第1回 Reading 検査で実際に起きた事故なので、型の時点で持たせない。
 *
 * ⚠ is_internal は internal_clients への明示登録だけで決める。
 *   自動判定はしない（運営の取り決め）。
 */

export interface SessionSummary {
  sessionId: string;
  startedAt: string;
  category: string | null;
  promptVersion: string | null;
  userMessageCount: number;
  isInternal: boolean;
}

/** Benchmark にかけられるセッションの一覧 */
export async function listCandidateSessions(minUserTurns = 3): Promise<SessionSummary[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const [{ data: sessions }, { data: internal }] = await Promise.all([
    supabase
      .from("sessions")
      .select(
        "session_id, started_at, memory_trigger_category, prompt_version, user_message_count, client_token, content_deleted_at"
      )
      .order("started_at", { ascending: false })
      .limit(300),
    supabase.from("internal_clients").select("client_token"),
  ]);
  const internalSet = new Set(
    ((internal ?? []) as Array<{ client_token: string }>).map((r) => r.client_token)
  );
  return ((sessions ?? []) as Array<Record<string, unknown>>)
    .filter((s) => !s.content_deleted_at)
    .filter((s) => Number(s.user_message_count ?? 0) >= minUserTurns)
    .map((s) => ({
      sessionId: String(s.session_id),
      startedAt: String(s.started_at),
      category: (s.memory_trigger_category as string | null) ?? null,
      promptVersion: (s.prompt_version as string | null) ?? null,
      userMessageCount: Number(s.user_message_count ?? 0),
      isInternal: internalSet.has(String(s.client_token ?? "")),
    }));
}

/** 生ログと Trigger を読み込む。⚠ 削除済みセッションは返さない */
export async function loadInputs(sessionIds: string[]): Promise<ReadingInput[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase || sessionIds.length === 0) return [];

  const [{ data: sessions }, { data: logs }, { data: internal }] = await Promise.all([
    supabase
      .from("sessions")
      .select(
        "session_id, episode_id, memory_trigger_category, client_token, content_deleted_at"
      )
      .in("session_id", sessionIds),
    supabase
      .from("conversation_logs")
      .select("session_id, role, content, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true }),
    supabase.from("internal_clients").select("client_token"),
  ]);

  const sessionRows = ((sessions ?? []) as Array<Record<string, unknown>>).filter(
    (s) => !s.content_deleted_at
  );
  const episodeIds = sessionRows
    .map((s) => s.episode_id as string | null)
    .filter((v): v is string => Boolean(v));
  const { data: episodes } = episodeIds.length
    ? await supabase.from("memory_trigger_episodes").select("id, body").in("id", episodeIds)
    : { data: [] as Array<{ id: string; body: string }> };

  const bodyById = new Map(
    ((episodes ?? []) as Array<{ id: string; body: string }>).map((e) => [e.id, e.body])
  );
  const internalSet = new Set(
    ((internal ?? []) as Array<{ client_token: string }>).map((r) => r.client_token)
  );
  const turnsBySession = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
  for (const row of (logs ?? []) as Array<Record<string, unknown>>) {
    const id = String(row.session_id);
    const role = row.role === "user" ? "user" : "assistant";
    const list = turnsBySession.get(id) ?? [];
    list.push({ role, content: String(row.content ?? "") });
    turnsBySession.set(id, list);
  }

  return sessionRows
    .map((s) => {
      const id = String(s.session_id);
      const episodeId = s.episode_id as string | null;
      return {
        sessionId: id,
        trigger: (episodeId && bodyById.get(episodeId)) || "",
        category: (s.memory_trigger_category as string | null) ?? null,
        turns: turnsBySession.get(id) ?? [],
        isInternal: internalSet.has(String(s.client_token ?? "")),
      } satisfies ReadingInput;
    })
    .filter((i) => i.turns.some((t) => t.role === "user"));
}
