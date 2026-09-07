import { createHash } from "crypto";
import {
  RATE_LIMITS,
  PUBLIC_PILOT,
  CAPACITY_MESSAGES,
} from "./conversation/config";
import { decideCapacity, type CapacityReason } from "./found";
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
  capacityReason?: CapacityReason;
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
  const isCohort = src === PUBLIC_PILOT.src;

  /*
   * 数を集めるところと、判定するところを分けている。
   * 判定は lib/found.ts の decideCapacity（純関数）にあり、
   * 境界は tests/found.test.mts で確認している。
   * こうしておかないと「総数30に達したとき」の挙動を確かめるために
   * 本番で30セッション作る必要が出てしまう。
   */
  const countSessions = async (
    apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>
  ) => {
    const { count } = await apply(baseQuery());
    return count ?? 0;
  };
  function baseQuery() {
    return supabase!
      .from("sessions")
      .select("session_id", { count: "exact", head: true });
  }

  const globalToday = await countSessions((q) => q.gte("started_at", dayStartJst));
  // コホート以外は全体のヒューズだけを見るので、余計な問い合わせをしない
  const cohortTotal = isCohort
    ? await countSessions((q) => q.eq("src", PUBLIC_PILOT.src))
    : 0;
  const cohortToday = isCohort
    ? await countSessions((q) =>
        q.eq("src", PUBLIC_PILOT.src).gte("started_at", dayStartJst)
      )
    : 0;
  const clientToday = isCohort
    ? await countSessions((q) =>
        q.eq("client_token", clientToken).gte("started_at", dayStartJst)
      )
    : 0;

  const reason = decideCapacity(
    src,
    { globalToday, cohortTotal, cohortToday, clientToday },
    {
      cohortSrc: PUBLIC_PILOT.src,
      cohortTotalSessions: PUBLIC_PILOT.cohortTotalSessions,
      cohortDailySessions: PUBLIC_PILOT.cohortDailySessions,
      cohortSessionsPerClientPerDay: PUBLIC_PILOT.cohortSessionsPerClientPerDay,
      globalDailySessions: PUBLIC_PILOT.globalDailySessions,
    }
  );

  if (!reason) return { allowed: true };

  const messages: Record<CapacityReason, string> = {
    cohort_total: CAPACITY_MESSAGES.cohortTotal,
    cohort_daily: CAPACITY_MESSAGES.cohortDaily,
    per_client_daily: CAPACITY_MESSAGES.perClientDaily,
    global_daily: CAPACITY_MESSAGES.globalDaily,
  };
  return { allowed: false, reason: messages[reason], capacityReason: reason };
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
