import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";

/**
 * Story Preview を表示した記録。
 *
 * ⚠ OpenAI は呼ばない。⚠ トークンは body のみ。URLに出さない。
 * ⚠ session_id が主キーなので、再読み込みで水増しされない。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, clientToken } = await req.json();
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!isClientToken(clientToken)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    const { error } = await supabase.from("story_views").upsert(
      { session_id: sessionId.trim(), client_token: clientToken.trim() },
      { onConflict: "session_id", ignoreDuplicates: true }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    console.error("story view failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
