import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  checkSessionRateLimit,
  checkPublicPilotCapacity,
  recordCapacityRejection,
  hashIp,
} from "../../../lib/rate-limit";
import { PROMPT_VERSION } from "../../../lib/conversation/config";

/**
 * セッション開始。
 * クライアントがEpisodeを受け取った直後に呼ぶ。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, clientToken, episode, src } = await req.json();
    if (!sessionId || !clientToken) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const ipHash = hashIp(req);
    const cohortSrc = typeof src === "string" && src.trim() ? src.trim().slice(0, 64) : null;

    // Wave 2 の枠チェックを先に見る。
    // 断る場合はここで返すので、OpenAI は一度も呼ばれない。
    const capacity = await checkPublicPilotCapacity(clientToken, cohortSrc);
    if (!capacity.allowed) {
      // ⚠ 上限で断った人は Entry Pull の分母から除外する必要がある。
      //    ここで記録しないと「興味がなくて始めなかった人」と混ざる。
      await recordCapacityRejection(
        clientToken,
        ipHash,
        cohortSrc,
        capacity.capacityReason ?? "unknown"
      );
      return NextResponse.json(
        { ok: false, capacityReached: true, message: capacity.reason },
        { status: 429 }
      );
    }

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
        src: cohortSrc,
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
