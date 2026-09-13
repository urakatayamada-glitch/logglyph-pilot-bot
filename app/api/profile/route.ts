import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";
import { toDbPatch } from "../../../lib/profile";

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

    /*
     * ⚠ 3ステップに分割したので、1回の送信には一部の設問しか入らない。
     *   渡されなかった列は触らない（PostgREST の upsert は
     *   payload にある列だけを更新する）。
     *   全列を毎回書くと STEP 2 の送信で STEP 1 の回答が消える。
     */
    const { patch, dropped, hasAny } = toDbPatch(body?.answers);
    if (dropped > 0) {
      // 捨てたものは必ず記録する（黙って握りつぶさない）
      console.warn("profile values dropped", { dropped });
    }
    if (Object.keys(patch).length === 0) {
      // 何も送られてこなかった＝スキップと同じ扱い
      const { error } = await supabase.from("client_profiles").upsert(
        { client_token: token, first_shown_at: now, updated_at: now },
        { onConflict: "client_token", ignoreDuplicates: true }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true, persisted: true, answered: false });
    }

    /*
     * ⚠ answered は一度 true になったら下げない。
     *   STEP 1 で答えて STEP 3 を空で送った人を「未回答」に戻さないため。
     */
    const row: Record<string, unknown> = {
      client_token: token,
      ...patch,
      updated_at: now,
    };
    if (hasAny) {
      row.answered = true;
      row.answered_at = now;
    }

    const { error } = await supabase
      .from("client_profiles")
      .upsert(row, { onConflict: "client_token" });
    if (error) throw error;

    return NextResponse.json({ ok: true, persisted: true, answered: hasAny });
  } catch (error) {
    // トークンも回答値もログへ出さない
    console.error("profile save failed", (error as Error)?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
