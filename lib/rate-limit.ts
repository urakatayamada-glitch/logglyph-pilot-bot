import { createHash } from "crypto";
import {
  RATE_LIMITS,
  PUBLIC_PILOT,
  CAPACITY_MESSAGES,
} from "./conversation/config";
import { getSupabaseAdmin } from "./supabase-server";

/**
 * IPアドレスは生のまま保存しない（個人情報になるため）。
 * 同一性の判定にだけ使えれば十分なのでハッシュ化する。
 */
export function hashIp(req: Request): string {
  const raw =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const salt = process.env.ADMIN_SESSION_SECRET || "logglyph-pilot";
  return createHash("sha256").update(`${salt}:${raw}`).digest("hex").slice(0, 32);
}

export interface RateLimitVerdict {
  allowed: boolean;
  reason?: string;
  /**
   * 上限で断った理由。null なら通常のレート制限。
   *
   * ⚠ これが入っている場合、そのアクセスは capacity_rejections に記録し
   *   Entry Pull の分母から除外する。「興味がなくて始めなかった人」と
   *   「枠がなくて始められなかった人」を混ぜると Entry Pull が壊れる。
   */
  capacityReason?: "cohort_total" | "cohort_daily" | "per_client_daily" | "global_daily";
}

/**
 * 新規セッション開始のレート制限。
 *
 * 完全な防御ではない（client_tokenはブラウザのデータ消去で回避でき、
 * IPは共有回線だと複数人が同一に見える）。
 * ただし1セッションあたりの発話数にHard Limitがあるため、
 * この2層でOpenAI APIコストの暴走という実害は十分に防げる。
 */
export async function checkSessionRateLimit(
  clientToken: string,
  ipHash: string
): Promise<RateLimitVerdict> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { allowed: true };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [byClient, byIp] = await Promise.all([
    supabase
      .from("sessions")
      .select("session_id", { count: "exact", head: true })
      .eq("client_token", clientToken)
      .gte("started_at", since),
    supabase
      .from("sessions")
      .select("session_id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("started_at", since),
  ]);

  if ((byClient.count ?? 0) >= RATE_LIMITS.sessionsPerClientPerDay) {
    return {
      allowed: false,
      reason: "今日はここまでにしておこう。また明日話そう。",
    };
  }
  if ((byIp.count ?? 0) >= RATE_LIMITS.sessionsPerIpPerDay) {
    return {
      allowed: false,
      reason: "少し時間をおいてから、また話しかけてみてください。",
    };
  }
  return { allowed: true };
}

/**
 * Wave 2（Controlled Open Pilot）の枠チェック。
 *
 * src がコホートの src と一致しないアクセス（知人コホート・運営のテスト）は
 * globalDailySessions のヒューズだけを見る。
 */
export async function checkPublicPilotCapacity(
  clientToken: string,
  src: string | null
): Promise<RateLimitVerdict> {
  if (!PUBLIC_PILOT.enabled) return { allowed: true };

  const supabase = getSupabaseAdmin();
  if (!supabase) return { allowed: true };

  const dayStartJst = startOfJstDayIso();

  // 全体のヒューズ。src に関係なく効く。
  const { count: globalToday } = await supabase
    .from("sessions")
    .select("session_id", { count: "exact", head: true })
    .gte("started_at", dayStartJst);
  if ((globalToday ?? 0) >= PUBLIC_PILOT.globalDailySessions) {
    return {
      allowed: false,
      reason: CAPACITY_MESSAGES.globalDaily,
      capacityReason: "global_daily",
    };
  }

  if (src !== PUBLIC_PILOT.src) return { allowed: true };

  // コホートの総数。これがコホートの定義そのもの。
  const { count: cohortTotal } = await supabase
    .from("sessions")
    .select("session_id", { count: "exact", head: true })
    .eq("src", PUBLIC_PILOT.src);
  if ((cohortTotal ?? 0) >= PUBLIC_PILOT.cohortTotalSessions) {
    return {
      allowed: false,
      reason: CAPACITY_MESSAGES.cohortTotal,
      capacityReason: "cohort_total",
    };
  }

  const { count: cohortToday } = await supabase
    .from("sessions")
    .select("session_id", { count: "exact", head: true })
    .eq("src", PUBLIC_PILOT.src)
    .gte("started_at", dayStartJst);
  if ((cohortToday ?? 0) >= PUBLIC_PILOT.cohortDailySessions) {
    return {
      allowed: false,
      reason: CAPACITY_MESSAGES.cohortDaily,
      capacityReason: "cohort_daily",
    };
  }

  const { count: clientToday } = await supabase
    .from("sessions")
    .select("session_id", { count: "exact", head: true })
    .eq("client_token", clientToken)
    .gte("started_at", dayStartJst);
  if ((clientToday ?? 0) >= PUBLIC_PILOT.cohortSessionsPerClientPerDay) {
    return {
      allowed: false,
      reason: CAPACITY_MESSAGES.perClientDaily,
      capacityReason: "per_client_daily",
    };
  }

  return { allowed: true };
}

/** 上限で断ったアクセスを記録する。失敗しても本来の応答は壊さない。 */
export async function recordCapacityRejection(
  clientToken: string | null,
  ipHash: string | null,
  src: string | null,
  reason: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return;
  const { error } = await supabase.from("capacity_rejections").insert({
    client_token: clientToken,
    ip_hash: ipHash,
    src,
    reason,
  });
  if (error) console.error("capacity rejection log failed", error);
}

/**
 * JST の当日0時を ISO で返す。
 *
 * 「直近24時間」ではなく「日本時間の今日」で数える。
 * 24時間窓だと、前日の夜に枠を使った人が翌朝まで待たされる。
 */
function startOfJstDayIso(): string {
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = nowJst.getUTCFullYear();
  const m = String(nowJst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(nowJst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}T00:00:00+09:00`;
}
