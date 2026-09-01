import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

/** 終了後の評価。任意回答なので、未回答でも正常。 */
export async function POST(req: Request) {
  try {
    const { sessionId, userRating, wantsToTalkAgain, followupAnswers } =
      await req.json();
    if (!sessionId) return NextResponse.json({ ok: false }, { status: 400 });

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    /*
     * Wave 1 の追加4問は、Future Preview を見たあとに別送されてくる。
     * そのときに user_rating を null で上書きしてしまわないよう、
     * 送られてきた項目だけを更新する。
     */
    const patch: Record<string, unknown> = {};
    if (followupAnswers && typeof followupAnswers === "object") {
      patch.followup_answers = followupAnswers;
    } else {
      patch.user_rating = typeof userRating === "number" ? userRating : null;
      patch.wants_to_talk_again =
        typeof wantsToTalkAgain === "boolean" ? wantsToTalkAgain : null;
    }

    const { error } = await supabase
      .from("sessions")
      .update(patch)
      .eq("session_id", sessionId);

    if (error) throw error;
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    console.error("rating save failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
