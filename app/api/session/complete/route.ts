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
          memory_trigger_category: structured?.memory_trigger_category ?? undefined,
        })
        .eq("session_id", sessionId);
      if (error) console.error("session complete update failed", error);
    }

    return NextResponse.json({
      ok: true,
      oneLineMemory: structured?.one_line_memory ?? null,
      memoryFound: structured?.memory_found ?? false,
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
