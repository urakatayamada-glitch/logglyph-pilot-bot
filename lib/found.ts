/**
 * /found と Stage 1 の純関数。
 *
 * ここには DB / fetch / React を持ち込まない。
 * node:test から依存なしで実行できる状態を保つ。
 */

/** 1タップ評価の値。DB の check 制約と一致させること。 */
export const VALUE_RESPONSES = ["fit", "off", "unknown"] as const;
export type ValueResponse = (typeof VALUE_RESPONSES)[number];

export function isValueResponse(v: unknown): v is ValueResponse {
  return typeof v === "string" && (VALUE_RESPONSES as readonly string[]).includes(v);
}

/**
 * client_token の形式検証。
 *
 * トークンは crypto.randomUUID() で生成した UUID v4。
 * 形式が一致しない入力は、DBに問い合わせる前に落とす。
 *
 * ⚠ /api/found と /api/session/delete は「トークンを提示すれば
 *   その人の私的な会話が読める / 消える」エンドポイントである。
 *   UUID v4 は 122 ビットあるため推測はできないが、
 *   総当たりの試行そのものをDBに到達させない。
 */
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientToken(v: unknown): v is string {
  return typeof v === "string" && UUID_V4.test(v.trim());
}

/**
 * 削除時に client_token を置き換える値。
 *
 * 行そのものは匿名集計のために残すが、本人と再び結び付けられないようにする。
 * 元のトークンは保存しない（ハッシュも残さない。残せば再結合が可能になる）。
 */
export function deletedTokenPlaceholder(random: () => string): string {
  return `deleted:${random()}`;
}

export function isDeletedToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.startsWith("deleted:");
}

/** JST の日付文字列。active_days の集計に使う。UTCで数えると日付が1日ずれる。 */
export function jstDateKey(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function countActiveDaysJst(isoList: string[]): number {
  const days = new Set<string>();
  for (const iso of isoList) {
    const key = jstDateKey(iso);
    if (key) days.add(key);
  }
  return days.size;
}

export interface SessionLike {
  client_token: string | null;
  started_at: string;
  user_message_count: number;
  memory_found: boolean;
}

/**
 * 0発話セッションを「1本目」と「2本目以降」に分ける。
 *
 * Wave 1 の集計で判明した問題:
 *   1本目が0発話  = Episodeを読んで帰った。本当の離脱
 *   2本目以降が0発話 = 1本しっかり話したあと別のEpisodeを覗いて閉じた。離脱ではない
 * 両方を同じ「0発話」として数えると Completion / Memory Found が実態より低く出る。
 */
export function splitSilentSessions(sessions: SessionLike[]): {
  firstSilent: number;
  laterSilent: number;
} {
  const byToken = new Map<string, SessionLike[]>();
  for (const s of sessions) {
    if (!s.client_token) continue;
    const list = byToken.get(s.client_token) ?? [];
    list.push(s);
    byToken.set(s.client_token, list);
  }

  let firstSilent = 0;
  let laterSilent = 0;
  for (const list of byToken.values()) {
    const ordered = [...list].sort(
      (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
    );
    ordered.forEach((s, i) => {
      if (s.user_message_count > 0) return;
      if (i === 0) firstSilent += 1;
      else laterSilent += 1;
    });
  }
  return { firstSilent, laterSilent };
}

/**
 * 3層の引き（Entry / Conversation / Return）。
 *
 * Wave 1 ではこの3つが1つの数字に混ざっていたため、
 * 「改善したのは中段だけ」という事実が Admin から見えなかった。
 *
 * entryViews … Stage 1 の到達数。上限で断った人は呼び出し側で除外しておく。
 */
export function threeLayerPull(
  sessions: SessionLike[],
  entryViews: number
): {
  entry: { started: number; views: number; rate: number | null };
  conversation: { withMemory: number; talked: number; rate: number | null };
  returning: { repeat: number; people: number; rate: number | null };
} {
  const byToken = new Map<string, SessionLike[]>();
  for (const s of sessions) {
    if (!s.client_token) continue;
    const list = byToken.get(s.client_token) ?? [];
    list.push(s);
    byToken.set(s.client_token, list);
  }

  const people = byToken.size;
  let started = 0;
  let talked = 0;
  let withMemory = 0;
  let repeat = 0;

  for (const list of byToken.values()) {
    started += 1;
    const didTalk = list.some((s) => s.user_message_count > 0);
    if (didTalk) talked += 1;
    if (list.some((s) => s.memory_found)) withMemory += 1;
    if (countActiveDaysJst(list.map((s) => s.started_at)) >= 2) repeat += 1;
  }

  return {
    entry: { started, views: entryViews, rate: rate(started, entryViews) },
    conversation: { withMemory, talked, rate: rate(withMemory, talked) },
    returning: { repeat, people, rate: rate(repeat, people) },
  };
}

function rate(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 100);
}

/** found_view から最初の再訪までの時間（分）。再訪が無ければ null。 */
export function minutesToRevisit(
  viewedAt: string,
  laterSessionStarts: string[]
): number | null {
  const base = new Date(viewedAt).getTime();
  if (Number.isNaN(base)) return null;
  const after = laterSessionStarts
    .map((s) => new Date(s).getTime())
    .filter((t) => !Number.isNaN(t) && t > base)
    .sort((a, b) => a - b);
  if (after.length === 0) return null;
  return Math.round((after[0] - base) / 60000);
}

export function medianMinutes(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

/* ============================================================
   Wave 2 の枠判定（純関数）
   ============================================================

   DBから数を集めるところと、その数から断るかどうかを決めるところを分ける。
   分けた理由は検証のため。

   「総数30に達したとき」「日次30に達したとき」の挙動は、
   実際に30セッション作らないと確かめられない形にしてしまうと、
   本番データを汚さずに検証できなくなる。判定だけを純関数にすれば
   node:test で全境界を確認できる。
*/

export type CapacityReason =
  | "cohort_total"
  | "cohort_daily"
  | "per_client_daily"
  | "global_daily";

export interface CapacityLimits {
  cohortSrc: string;
  cohortTotalSessions: number;
  cohortDailySessions: number;
  cohortSessionsPerClientPerDay: number;
  globalDailySessions: number;
}

export interface CapacityCounts {
  /** サービス全体の当日セッション数（src を問わない） */
  globalToday: number;
  /** コホートの累計セッション数 */
  cohortTotal: number;
  /** コホートの当日セッション数 */
  cohortToday: number;
  /** この端末の当日セッション数 */
  clientToday: number;
}

/**
 * 断るかどうかを決める。null なら通してよい。
 *
 * 判定順に意味がある。
 *   1. 全体のヒューズ … src を問わず先に見る（費用の最終防衛線）
 *   2. コホート総数   … コホートの定義そのもの
 *   3. コホート日次   … その日の枠
 *   4. 端末ごと日次   … 1人が枠を独占しないため
 *
 * src が一致しないアクセス（知人コホート・運営のテスト）は 1 だけを見る。
 */
export function decideCapacity(
  src: string | null,
  counts: CapacityCounts,
  limits: CapacityLimits
): CapacityReason | null {
  if (counts.globalToday >= limits.globalDailySessions) return "global_daily";
  if (src !== limits.cohortSrc) return null;
  if (counts.cohortTotal >= limits.cohortTotalSessions) return "cohort_total";
  if (counts.cohortToday >= limits.cohortDailySessions) return "cohort_daily";
  if (counts.clientToday >= limits.cohortSessionsPerClientPerDay) {
    return "per_client_daily";
  }
  return null;
}

/**
 * 1人につき1つだけ 1タップ評価を数える。
 *
 * /found を開くたびに found_views の行が増えるため、同じ人が何度も開いて
 * 押すと、行を素直に数えると回答が水増しされる。最初の回答だけを採る。
 */
export function countValueResponsesPerPerson(
  rows: Array<{ client_token: string; viewed_at: string; value_response: string | null }>
): Record<string, number> {
  const firstByToken = new Map<string, { at: string; value: string }>();
  for (const r of rows) {
    if (!r.value_response) continue;
    const cur = firstByToken.get(r.client_token);
    if (!cur || r.viewed_at < cur.at) {
      firstByToken.set(r.client_token, { at: r.viewed_at, value: r.value_response });
    }
  }
  const counts: Record<string, number> = { fit: 0, off: 0, unknown: 0 };
  for (const { value } of firstByToken.values()) {
    if (value in counts) counts[value] += 1;
  }
  return counts;
}
