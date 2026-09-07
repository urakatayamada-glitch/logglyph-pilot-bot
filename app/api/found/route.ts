import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";

/**
 * /found の中身を返す。
 *
 * ⚠ 設計上の重要な決定
 *
 *   1. トークンを URL に出さない。
 *      /found?token=xxx にすると Referer・ブラウザ履歴・アクセスログ・
 *      コピペに残り、他人の記憶を読めるリンクが流通する。POST の body だけで渡す。
 *
 *   2. これは「トークンを提示すれば、その人の私的な会話が読める」
 *      エンドポイントである。client_token は UUID v4（122ビット）なので
 *      推測はできないが、形式が一致しない入力はDBに到達させない。
 *
 *   3. 承認済みでない note は返さない。approved = false の間は画面に段ごと出ない。
 *
 *   4. 読み書きはすべて service_role 経由。RLS は開けない。
 */
/**
 * 1時間あたりに受け付ける /found の照会数の上限（サービス全体）。
 *
 * IP単位ではなく全体で見ている。理由は、IP単位の試行を記録するテーブルを
 * 増やさずに済ませたいこと、そして参加者が数十人規模のPilotでは
 * 全体上限でも総当たりを十分に潰せること。
 * 参加者が増えたらIP単位の記録に切り替える。
 */
const MAX_LOOKUPS_PER_HOUR = 200;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clientToken: unknown = body?.clientToken;

    // 形式不一致は空で返す。存在の有無を漏らさないため、
    // 「該当なし」と同じ応答にする（列挙を無意味にする）。
    if (!isClientToken(clientToken)) {
      return NextResponse.json(empty());
    }
    const token = clientToken.trim();

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json(empty());

    // 総当たりの試行を抑える。上限を超えたら照会そのものを行わない。
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: lookups } = await supabase
      .from("found_views")
      .select("view_id", { count: "exact", head: true })
      .gte("viewed_at", since);
    if ((lookups ?? 0) >= MAX_LOOKUPS_PER_HOUR) {
      console.warn("found lookup limit reached", { lookups });
      return NextResponse.json(empty());
    }

    const { data: rows, error } = await supabase
      .from("sessions")
      .select("session_id, one_line_memory, started_at, memory_found, content_deleted_at")
      .eq("client_token", token)
      .eq("memory_found", true)
      .is("content_deleted_at", null)
      .not("one_line_memory", "is", null)
      .order("started_at", { ascending: true });
    if (error) throw error;

    const sessions = (rows ?? []) as Array<{
      session_id: string;
      one_line_memory: string | null;
      started_at: string;
    }>;

    // この端末が会話したことがあるか（記憶が出たかとは別）。
    // 記憶0件の人への文面を分けるために使う。
    const { count: talkedCount } = await supabase
      .from("sessions")
      .select("session_id", { count: "exact", head: true })
      .eq("client_token", token)
      .gt("user_message_count", 0);

    let notes: Record<string, string> = {};
    if (sessions.length > 0) {
      const { data: noteRows } = await supabase
        .from("found_notes")
        .select("session_id, note, approved")
        .in(
          "session_id",
          sessions.map((s) => s.session_id)
        )
        .eq("approved", true);
      notes = Object.fromEntries(
        ((noteRows ?? []) as Array<{ session_id: string; note: string }>).map((r) => [
          r.session_id,
          r.note,
        ])
      );
    }

    // 閲覧を記録する。ここが found → revisit のファネルの起点になる。
    let viewId: string | null = null;
    const { data: view } = await supabase
      .from("found_views")
      .insert({ client_token: token })
      .select("view_id")
      .single();
    viewId = (view as { view_id: string } | null)?.view_id ?? null;

    return NextResponse.json({
      ok: true,
      viewId,
      hasTalked: (talkedCount ?? 0) > 0,
      memories: sessions
        .filter((s) => s.one_line_memory)
        .map((s) => ({
          oneLine: s.one_line_memory as string,
          // 未承認・未作成なら null。画面側は段ごと出さない。
          note: notes[s.session_id] ?? null,
        })),
    });
  } catch (error) {
    console.error("found fetch failed", error);
    return NextResponse.json(empty());
  }
}

function empty() {
  return { ok: true, viewId: null, hasTalked: false, memories: [] as never[] };
}
