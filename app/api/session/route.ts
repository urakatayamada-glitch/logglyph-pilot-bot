import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import {
  checkSessionRateLimit,
  checkPublicPilotCapacity,
  recordCapacityRejection,
  hashIp,
} from "../../../lib/rate-limit";
import { PROMPT_VERSION } from "../../../lib/conversation/config";
import {
  isExperienceVariant,
  resolveExperienceVariant,
  DEFAULT_VARIANT,
} from "../../../lib/experience";

/**
 * セッション開始。
 * クライアントがEpisodeを受け取った直後に呼ぶ。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, clientToken, episode, src, entryContext } = await req.json();
    if (!sessionId || !clientToken) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const ipHash = hashIp(req);
    const cohortSrc = typeof src === "string" && src.trim() ? src.trim().slice(0, 64) : null;
    /*
     * この到達の文脈（現状は /found から直接戻った "found" だけ）。
     *
     * ⚠ src とは別のカラムに入れる。src は絶対に上書きしない。
     * ⚠ 再開（isResume）のときは触らない。会話中のリロードで
     *   元の文脈が消える／上書きされるのを防ぐ。
     */
    const arrivalContext =
      typeof entryContext === "string" && entryContext.trim()
        ? entryContext.trim().slice(0, 32)
        : null;

    /*
     * すでに存在するセッションの再登録は、枠もレート制限も数えない。
     *
     * このエンドポイントは upsert なので、ページを再読み込みして会話を復元した
     * ときにも同じ session_id で呼ばれる。そこで枠を数えると、
     * 「この端末は今日すでに1回使っている」＝自分自身の1回を理由に断ってしまい、
     * 会話中の再読み込みで会話が打ち切られる。
     *
     * 1日1セッションに絞った Wave 2 で必ず表に出る（上限10のときは埋もれていた）。
     */
    const supabaseForCheck = getSupabaseAdmin();
    let isResume = false;
    /*
     * 体験条件。
     *
     * ⚠ サーバ側で決める。クライアントからは指定させない。
     * ⚠ 再開のときは保存済みの値をそのまま使う。会話の途中で
     *   MEMORY_RECEIPT_ENABLED を切り替えても、そのセッションの条件は変えない。
     *   変えてしまうと「同じ会話なのに前半と後半で条件が違う」行ができる。
     */
    let experienceVariant = resolveExperienceVariant(
      process.env.MEMORY_RECEIPT_ENABLED
    );
    if (supabaseForCheck) {
      const { data: existing } = await supabaseForCheck
        .from("sessions")
        .select("session_id, experience_variant")
        .eq("session_id", sessionId)
        .maybeSingle();
      isResume = Boolean(existing);
      if (existing && isExperienceVariant(existing.experience_variant)) {
        experienceVariant = existing.experience_variant;
      }
    }

    // Wave 2 の枠チェックを先に見る。
    // 断る場合はここで返すので、OpenAI は一度も呼ばれない。
    const capacity = isResume
      ? { allowed: true as const }
      : await checkPublicPilotCapacity(clientToken, cohortSrc);
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

    const verdict = isResume
      ? { allowed: true as const }
      : await checkSessionRateLimit(clientToken, ipHash);
    if (!verdict.allowed) {
      return NextResponse.json(
        { ok: false, rateLimited: true, message: verdict.reason },
        { status: 429 }
      );
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      // DB未設定でも会話自体は成立させる（Pilotを止めない）
      return NextResponse.json({
        ok: true,
        persisted: false,
        experienceVariant,
      });
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
        ...(isResume ? {} : { entry_context: arrivalContext }),
        experience_variant: experienceVariant,
        status: "active",
      },
      { onConflict: "session_id" }
    );

    if (error) throw error;
    return NextResponse.json({ ok: true, persisted: true, experienceVariant });
  } catch (error) {
    console.error("session start failed", error);
    // 体験条件が取れなくても会話は続ける。既定は baseline。
    return NextResponse.json(
      { ok: false, experienceVariant: DEFAULT_VARIANT },
      { status: 500 }
    );
  }
}
