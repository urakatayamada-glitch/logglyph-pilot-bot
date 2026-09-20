import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { isClientToken, deletedTokenPlaceholder } from "../../../../lib/found";
import { purgeSessionsFromResults } from "../../../../lib/reading/purge";
import type { SessionResult } from "../../../../lib/reading/types";

/**
 * 本人による削除。
 *
 * Product Decision（Wave 2 設計合意 §7）: 「内容削除 ＋ 匿名集計値は残す」
 *
 *   消す   conversation_logs の本文
 *          one_line_memory / structured_memory
 *          found_notes
 *          story_fragments（脚色されたシーン）
 *          memory_facets（記憶の断片）
 *          client_profiles（本人が自分について答えた内容）
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

    // 3b. Story Preview 関連。本人の記憶そのもの、またはそれを脚色した文章。
    //
    // ⚠ 0013 で story_fragments / memory_facets を追加したとき、
    //   この削除処理を更新し忘れていた（2026-09-13 に発見）。
    //   記録を消したはずの人の「記憶の断片」と「脚色されたシーン」が
    //   client_token 付きで残っていた。内容そのものなので、行ごと消す。
    const { error: fragErr } = await supabase
      .from("story_fragments")
      .delete()
      .in("session_id", sessionIds);
    if (fragErr) console.error("story_fragments delete failed", fragErr);

    const { error: facetErr } = await supabase
      .from("memory_facets")
      .delete()
      .in("session_id", sessionIds);
    if (facetErr) console.error("memory_facets delete failed", facetErr);

    // 進捗スコアと閲覧記録は内容を含まない（数値と時刻だけ）ので行は残し、
    // トークンだけ切る。ファネルの分母を後から変えないため。
    for (const table of [
      "story_progress_snapshots",
      "story_views",
      "receipt_views",
    ]) {
      const { error } = await supabase
        .from(table)
        .update({ client_token: placeholder })
        .eq("client_token", token);
      if (error) console.error(`${table} anonymize failed`, error);
    }

    // 3c. プロフィール（profile_v1）。本人が自分について答えた内容なので消す。
    //
    // ⚠ ここを忘れると、記録を消した人の属性だけが残る。
    //   行ごと消すため、その人は次に会話したとき再び設問を見ることになる。
    //   これは意図どおり（消した人は「聞かれていない人」に戻る）。
    const { error: profErr } = await supabase
      .from("client_profiles")
      .delete()
      .eq("client_token", token);
    if (profErr) console.error("client_profiles delete failed", profErr);

    // 3d. Reading Engine Benchmark の保存物。
    //
    // ⚠ Benchmark は Signal の引用（本人の発話そのもの）と、
    //   その人について書かれた読みを保持している。集計値ではなく内容なので消す。
    //   0013 で同じ漏れをやっているため、追加と同じ turn でここへ足した。
    try {
      const { data: runs } = await supabase
        .from("reading_bench_runs")
        .select("id, results")
        .overlaps("session_ids", sessionIds);
      for (const run of (runs ?? []) as Array<{ id: string; results: unknown }>) {
        const { kept, removed } = purgeSessionsFromResults(
          (run.results as SessionResult[]) ?? [],
          sessionIds
        );
        if (removed > 0) {
          await supabase.from("reading_bench_runs").update({ results: kept }).eq("id", run.id);
        }
      }
      await supabase.from("reading_bench_ratings").delete().in("session_id", sessionIds);
    } catch (e) {
      console.error("reading bench purge failed", (e as Error)?.message);
    }

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
