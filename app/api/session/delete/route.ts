import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { isClientToken, deletedTokenPlaceholder } from "../../../../lib/found";

/**
 * 本人による削除。
 *
 * Product Decision（Wave 2 設計合意 §7）: 「内容削除 ＋ 匿名集計値は残す」
 *
 *   消す   conversation_logs の本文
 *          one_line_memory / structured_memory
 *          found_notes
 *   残す   sessions の行そのもの（発話数・memory_found・日時）
 *          client_token はランダム値へ置換し、本人と再び結び付けられなくする
 *
 * なぜ完全削除にしないか:
 *   誰か1人が完全削除した瞬間、Entry Pull / Conversation Pull の分母が
 *   後から変わり、過去に出した報告と数字が合わなくなる。
 *   そのため行は残し、内容だけを消す。この扱いは注意書きに明記している。
 *
 * ⚠ これは他人の記憶を破壊できるエンドポイントである。
 *   - POST限定。トークンは body のみ（URLに出さない）
 *   - 形式不一致は「該当なし」と同じ応答（列挙を無意味にする）
 *   - トークンをログに残さない
 *   - 元のトークンは保存しない。ハッシュも残さない（残せば再結合が可能になる）
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clientToken: unknown = body?.clientToken;
    const confirmed: unknown = body?.confirm;

    // 確認なしでは実行しない（誤爆と、意図しない自動リクエストを防ぐ）
    if (confirmed !== true) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (!isClientToken(clientToken)) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }
    const token = clientToken.trim();

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: false }, { status: 503 });

    const { data: rows, error: selErr } = await supabase
      .from("sessions")
      .select("session_id")
      .eq("client_token", token);
    if (selErr) throw selErr;

    const sessionIds = ((rows ?? []) as Array<{ session_id: string }>).map(
      (r) => r.session_id
    );
    if (sessionIds.length === 0) {
      return NextResponse.json({ ok: true, deleted: 0 });
    }

    // 1. 会話の本文
    const { error: logErr } = await supabase
      .from("conversation_logs")
      .delete()
      .in("session_id", sessionIds);
    if (logErr) console.error("conversation_logs delete failed", logErr);

    // 2. 承認済みノート（本人の会話内容に紐づくため消す）
    const { error: noteErr } = await supabase
      .from("found_notes")
      .delete()
      .in("session_id", sessionIds);
    if (noteErr) console.error("found_notes delete failed", noteErr);

    // 3. /found の閲覧記録。トークンで本人と結び付くので置換対象に含める。
    //    行は残す（ファネルの集計に必要）が、結び付きを切る。
    const placeholder = deletedTokenPlaceholder(() => randomUUID());
    const { error: viewErr } = await supabase
      .from("found_views")
      .update({ client_token: placeholder })
      .eq("client_token", token);
    if (viewErr) console.error("found_views anonymize failed", viewErr);

    const { error: entryErr } = await supabase
      .from("entry_views")
      .update({ client_token: placeholder })
      .eq("client_token", token);
    if (entryErr) console.error("entry_views anonymize failed", entryErr);

    // 4. sessions は行を残し、内容だけ消してトークンを置換する。
    //    message_count / user_message_count / memory_found / started_at は残す。
    const { error: sesErr } = await supabase
      .from("sessions")
      .update({
        one_line_memory: null,
        structured_memory: null,
        client_token: placeholder,
        content_deleted_at: new Date().toISOString(),
      })
      .in("session_id", sessionIds);
    if (sesErr) throw sesErr;

    return NextResponse.json({ ok: true, deleted: sessionIds.length });
  } catch (error) {
    // トークンは絶対にログへ出さない
    console.error("session delete failed", (error as Error)?.message);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
