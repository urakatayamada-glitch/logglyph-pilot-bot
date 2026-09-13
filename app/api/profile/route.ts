import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";
import { sanitizeAnswers, hasAnyAnswer } from "../../../lib/profile";

/**
 * プロフィールの保存（profile_v1）。
 *
 * ⚠ OpenAI は呼ばない。会話体験には一切触れない。
 * ⚠ トークンは body のみ。URL・クエリ・Cookie には絶対に出さない。
 * ⚠ 主キーが client_token なので、二重送信で水増しされない。
 * ⚠ 回答値そのものはログに出さない（人数と件数だけ）。
 *
 * action:
 *   "shown"    … 表示したことだけ記録する（回答はまだ）
 *   "answer"   … 回答を保存する
 *   "decline"  … 「今回はスキップ」。行は残す（＝二度と出さないため）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clientToken: unknown = body?.clientToken;
    const action: unknown = body?.action;

    if (!isClientToken(clientToken)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (action !== "shown" && action !== "answer" && action !== "decline") {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const token = clientToken.trim();

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    const now = new Date().toISOString();

    if (action === "shown" || action === "decline") {
      /*
       * 行を作るだけ。answered は false のまま。
       * ⚠ 既に回答済みの行を上書きしない（ignoreDuplicates）。
       *   上書きすると、答えた人の回答がスキップで消える。
       */
      const { error } = await supabase.from("client_profiles").upsert(
        { client_token: token, first_shown_at: now, updated_at: now },
        { onConflict: "client_token", ignoreDuplicates: true }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true, persisted: true });
    }

    const { answers, dropped } = sanitizeAnswers(body?.answers);
    if (dropped > 0) {
      // 捨てたものは必ず記録する（黙って握りつぶさない）
      console.warn("profile values dropped", { dropped });
    }
    if (!hasAnyAnswer(answers)) {
      // 全部空で「送る」を押した場合はスキップと同じ扱い
      const { error } = await supabase.from("client_profiles").upsert(
        { client_token: token, first_shown_at: now, updated_at: now },
        { onConflict: "client_token", ignoreDuplicates: true }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true, persisted: true, answered: false });
    }

    const { error } = await supabase.from("client_profiles").upsert(
      {
        client_token: token,
        states: answers.states,
        motives: answers.motives,
        reflect_habit: answers.reflectHabit,
        age_band: answers.ageBand,
        gender: answers.gender,
        answered: true,
        answered_at: now,
        updated_at: now,
      },
      { onConflict: "client_token" }
    );
    if (error) throw error;

    return NextResponse.json({ ok: true, persisted: true, answered: true });
  } catch (error) {
    // トークンも回答値もログへ出さない
    console.error("profile save failed", (error as Error)?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
