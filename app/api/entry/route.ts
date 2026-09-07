import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { isClientToken } from "../../../lib/found";

/**
 * Stage 1 : Entry Pull の分母。
 *
 * これまでは「はじめる」を押すまでサーバーに何も記録していなかったため、
 * 画面を読んで帰った人がデータに一切現れず、Entry Pull を一度も実測できていなかった。
 *
 *   stage = "view"   … 画面に到達した
 *   stage = "accept" … 注意書きに同意した
 *
 * ⚠ ここでは OpenAI を一度も呼ばない。API費用はゼロ。
 * ⚠ 記録に失敗しても体験は壊さない（常に ok を返す）。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const clientToken: unknown = body?.clientToken;
    const stage: unknown = body?.stage;

    if (!isClientToken(clientToken)) {
      return NextResponse.json({ ok: true, recorded: false });
    }
    const token = clientToken.trim();

    const supabase = getSupabaseAdmin();
    if (!supabase) return NextResponse.json({ ok: true, recorded: false });

    const src =
      typeof body?.src === "string" && body.src.trim()
        ? body.src.trim().slice(0, 64)
        : null;
    // referrer は分析用。クエリ文字列は落として host + path までにする
    // （検索語などが混ざる可能性があるため）。
    const referrer = trimReferrer(body?.referrer);

    if (stage === "accept") {
      // その端末の当日の行を探して accepted_at を立てる。
      const { data } = await supabase
        .from("entry_views")
        .select("view_id, accepted_at")
        .eq("client_token", token)
        .order("viewed_at", { ascending: false })
        .limit(1);

      const row = data?.[0] as { view_id: string; accepted_at: string | null } | undefined;
      if (row && !row.accepted_at) {
        await supabase
          .from("entry_views")
          .update({ accepted_at: new Date().toISOString() })
          .eq("view_id", row.view_id);
      } else if (!row) {
        // 到達の記録に失敗していた場合の保険。同意だけでも残す。
        await supabase.from("entry_views").insert({
          client_token: token,
          src,
          referrer,
          accepted_at: new Date().toISOString(),
        });
      }
      return NextResponse.json({ ok: true, recorded: true });
    }

    // stage = "view"。同一端末・同一日は unique index で1行に集約される。
    // 重複は正常なので、衝突エラーは握りつぶす。
    const { error } = await supabase
      .from("entry_views")
      .insert({ client_token: token, src, referrer });
    if (error && error.code !== "23505") {
      console.error("entry view insert failed", error);
    }
    return NextResponse.json({ ok: true, recorded: true });
  } catch (error) {
    console.error("entry event failed", error);
    return NextResponse.json({ ok: true, recorded: false });
  }
}

function trimReferrer(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const u = new URL(raw);
    return `${u.host}${u.pathname}`.slice(0, 200);
  } catch {
    return raw.trim().slice(0, 200);
  }
}
