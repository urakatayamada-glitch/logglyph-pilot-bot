import { NextResponse } from "next/server";
import { getSupabase } from "../../../lib/supabase-server";

export async function POST(req: Request) {
  try {
    const { sessionId, role, content } = await req.json();
    if (!sessionId || !role || !content) return NextResponse.json({ ok: false }, { status: 400 });
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    const { error } = await supabase.from("conversation_logs").insert({
      session_id: sessionId,
      role,
      content,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("log save failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
