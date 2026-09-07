import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { isValueResponse } from "../../../../lib/found";

/**
 * Personal Value Recognition の1タップ評価。
 *
 * 1つの found_view につき1回だけ受け付ける（上書きしない）。
 * viewId は /api/found のレスポンスで受け取ったもの。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const viewId: unknown = body?.viewId;
    const response: unknown = body?.response;

    if (typeof viewId !== "string" || !viewId.trim() || !isValueResponse(response)) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, persisted: false });

    // 既に回答済みなら何もしない（is null 条件で上書きを防ぐ）
    const { error } = await supabase
      .from("found_views")
      .update({ value_response: response, responded_at: new Date().toISOString() })
      .eq("view_id", viewId.trim())
      .is("value_response", null);
    if (error) throw error;

    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    console.error("found value failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
