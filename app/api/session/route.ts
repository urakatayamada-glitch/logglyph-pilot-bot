import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { checkSessionRateLimit, hashIp } from "../../../lib/rate-limit";
import { PROMPT_VERSION } from "../../../lib/conversation/config";

/**
 * セッション開始。
 * クライアントがEpisodeを受け取った直後に呼ぶ。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, clientToken, episode } = await req.json();
    if (!sessionId || !clientToken) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const ipHash = hashIp(req);
    const verdict = await checkSessionRateLimit(clientToken, ipHash);
    if (!verdict.allowed) {
      return NextResponse.json(
        { ok: false, rateLimited: true, message: verdict.reason },
        { status: 429 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      // DB未設定でも会話自体は成立させる（Pilotを止めない）
      return NextResponse.json({ ok: true, persisted: false });
    }

    const { error } = await supabase.from("sessions").upsert(
      {
        session_id: sessionId,
        client_token: clientToken,
        ip_hash: ipHash,
        prompt_version: PROMPT_VERSION,
        episode_id: episode?.id && episode.id !== "fallback" ? episode.id : null,
        memory_trigger_category: episode?.category ?? null,
        episode_source_type: episode?.source_type ?? null,
        status: "active",
      },
      { onConflict: "session_id" }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true, persisted: true });
  } catch (error) {
    console.error("session start failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
