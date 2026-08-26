import { NextResponse } from "next/server";
import { getSupabaseAdmin, getSupabase } from "../../../lib/supabase-server";
import { PROMPT_VERSION } from "../../../lib/conversation/config";

export async function POST(req: Request) {
  try {
    const { sessionId, role, content, turnIndex, moderationFlagged, moderationCategories } =
      await req.json();
    if (!sessionId || !role || !content) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // vNextではサーバー経由（service_role）で書き込む。
    // 未設定の環境では既存のanonクライアントへフォールバックする。
    const supabase = getSupabaseAdmin() ?? getSupabase();
    if (!supabase) {
      return NextResponse.json(
        { ok: false, error: "Supabase is not configured" },
        { status: 503 }
      );
    }

    const { error } = await supabase.from("conversation_logs").insert({
      session_id: sessionId,
      role,
      content,
      turn_index: typeof turnIndex === "number" ? turnIndex : null,
      prompt_version: PROMPT_VERSION,
      moderation_flagged: Boolean(moderationFlagged),
      moderation_categories: moderationCategories ?? null,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("log save failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
