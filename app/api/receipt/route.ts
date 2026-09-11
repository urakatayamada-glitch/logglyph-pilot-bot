import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";

/**
 * Memory Receipt を表示した記録。
 *
 * ⚠ ここでは OpenAI を呼ばない。費用はゼロ。
 * ⚠ client_token は body でのみ受ける。URLには絶対に出さない。
 * ⚠ session_id が主キーなので、再読み込みしても行は増えない
 *   （Memory Receipt Viewed が水増しされない）。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, clientToken } = await req.json();
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    // 形式が合わない入力はDBに到達させない
    if (!isClientToken(clientToken)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    const { error } = await supabase
      .from("receipt_views")
      .upsert(
        { session_id: sessionId.trim(), client_token: clientToken.trim() },
        { onConflict: "session_id", ignoreDuplicates: true }
      );
    if (error) throw error;

    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    // ⚠ トークンはログに出さない
    console.error("receipt view failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
