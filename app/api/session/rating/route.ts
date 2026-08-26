import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

/** 終了後の評価。任意回答なので、未回答でも正常。 */
export async function POST(req: Request) {
  try {
    const { sessionId, userRating, wantsToTalkAgain } = await req.json();
    if (!sessionId) return NextResponse.json({ ok: false }, { status: 400 });

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    const { error } = await supabase
      .from("sessions")
      .update({
        user_rating: typeof userRating === "number" ? userRating : null,
        wants_to_talk_again:
          typeof wantsToTalkAgain === "boolean" ? wantsToTalkAgain : null,
      })
      .eq("session_id", sessionId);

    if (error) throw error;
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    console.error("rating save failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
