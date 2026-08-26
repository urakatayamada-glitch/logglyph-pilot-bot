import { createHash } from "crypto";
import { RATE_LIMITS } from "./conversation/config";
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
