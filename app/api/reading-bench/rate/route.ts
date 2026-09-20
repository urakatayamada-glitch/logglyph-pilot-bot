import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyToken } from "../../../../lib/admin-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";

/** Blind 評価の回答を保存する。⚠ 上書きは許す（見直しは自由） */
export const dynamic = "force-dynamic";

const VERDICTS = ["sees", "only_me", "generic"] as const;

export async function POST(req: Request) {
  const store = await cookies();
  if (!verifyToken(store.get(ADMIN_COOKIE)?.value)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const runId = String(body?.runId ?? "");
  const sessionId = String(body?.sessionId ?? "");
  const slot = String(body?.slot ?? "");
  const verdict = String(body?.verdict ?? "");
  if (!runId || !sessionId || !["A", "B", "C"].includes(slot)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!(VERDICTS as readonly string[]).includes(verdict)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false }, { status: 500 });

  const { error } = await supabase
    .from("reading_bench_ratings")
    .update({ verdict, rated_at: new Date().toISOString() })
    .eq("run_id", runId)
    .eq("session_id", sessionId)
    .eq("slot", slot);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
