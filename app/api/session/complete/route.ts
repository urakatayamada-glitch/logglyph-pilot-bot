import { NextResponse } from "next/server";
import { extractStructuredMemory } from "../../../../lib/conversation/engine";
import { ChatMessage, summarizeMessages } from "../../../../lib/conversation/phase";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { PROMPT_VERSION } from "../../../../lib/conversation/config";

/**
 * 会話終了時の処理。
 *
 * 構造化抽出は会話とは別工程。失敗しても終了体験は壊さない
 * （one_line_memory は締めの発話から取れるため）。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string | undefined = body?.sessionId;
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const crisis: boolean = Boolean(body?.crisis);
    // Future Preview 用。この端末の蓄積を数えるためだけに使う。
    const clientToken: string | undefined =
      typeof body?.clientToken === "string" ? body.clientToken : undefined;

    if (!sessionId) return NextResponse.json({ ok: false }, { status: 400 });

    const stats = summarizeMessages(messages);

    // 危機対応で終了した会話は、抽出も保存もしない（記録を残すこと自体が不適切なため、
    // 会話ログは残るが構造化はしない）
    const structured = crisis ? null : await safeExtract(messages);

    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { error } = await supabase
        .from("sessions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          prompt_version: PROMPT_VERSION,
          message_count: stats.messageCount,
          user_message_count: stats.userMessageCount,
          user_char_count: stats.userCharCount,
          ai_char_count: stats.aiCharCount,
          memory_found: structured?.memory_found ?? false,
          hidden_candidate_found: Boolean(structured?.hidden_candidate),
          one_line_memory: structured?.one_line_memory ?? null,
          structured_memory: structured ?? null,
          // memory_trigger_category は更新しない。
          // セッション開始時にEpisode側のカテゴリ（固定の20分類）を入れており、
          // 抽出モデルが返す自由記述（「仕事」「personal habits」等）で上書きすると
          // 「どのEpisodeが記憶を引き出せたか」の集計が壊れる。
          // 抽出側の分類は structured_memory の中に残っている。
        })
        .eq("session_id", sessionId);
      if (error) console.error("session complete update failed", error);
    }

    // Future Preview 用の蓄積。今回のセッションを更新した「あと」に数える。
    // 失敗しても終了体験は壊さないので、握りつぶして null を返す。
    let memoryCount: number | null = null;
    let recentMemories: string[] = [];
    if (supabase && clientToken && !crisis) {
      try {
        const { count } = await supabase
          .from("sessions")
          .select("session_id", { count: "exact", head: true })
          .eq("client_token", clientToken)
          .eq("memory_found", true);
        memoryCount = count ?? 0;

        const { data: recent } = await supabase
          .from("sessions")
          .select("one_line_memory")
          .eq("client_token", clientToken)
          .eq("memory_found", true)
          .not("one_line_memory", "is", null)
          .order("started_at", { ascending: false })
          .limit(3);
        recentMemories = (recent ?? [])
          .map((r) => (r as { one_line_memory: string }).one_line_memory)
          .filter((t) => typeof t === "string" && t.trim().length > 0);
      } catch (error) {
        console.error("accumulation fetch failed", error);
      }
    }

    return NextResponse.json({
      ok: true,
      oneLineMemory: structured?.one_line_memory ?? null,
      memoryFound: structured?.memory_found ?? false,
      memoryCount,
      recentMemories,
    });
  } catch (error) {
    console.error("session complete failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function safeExtract(messages: ChatMessage[]) {
  try {
    return await extractStructuredMemory(messages);
  } catch (error) {
    console.error("extraction failed", error);
    return null;
  }
}
