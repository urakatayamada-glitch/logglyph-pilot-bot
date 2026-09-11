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
  /** コホートに属する src の集合。記事が増えても上限は1つ */
  cohortSrcs: readonly string[];
  /** 人数（ユニーク client_token）の上限。セッション数ではない */
  cohortTotalPeople: number;
  cohortDailySessions: number;
  cohortSessionsPerClientPerDay: number;
  globalDailySessions: number;
}

export interface CapacityCounts {
  /** サービス全体の当日セッション数（src を問わない） */
  globalToday: number;
  /**
   * コホートに参加した人数（ユニーク client_token）。
   * セッション数ではない。記事の「先着30名」と一致させるため。
   * ただし、すでに参加済みの人が2本目を始める場合は枠を消費しないので、
   * 呼び出し側はその人を数に含めたうえで alreadyInCohort を立てる。
   */
  cohortPeople: number;
  /** この端末がすでにコホートに参加済みか。参加済みなら総数上限で断らない */
  alreadyInCohort: boolean;
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
  if (!src || !limits.cohortSrcs.includes(src)) return null;
  /*
   * すでに枠に入っている人は、総数上限では断らない。
   * 断ってしまうと「30人目が埋まった瞬間、29人目までの人も
   * 2本目を始められなくなる」ことになり、人数で数える意味がなくなる。
   */
  if (!counts.alreadyInCohort && counts.cohortPeople >= limits.cohortTotalPeople) {
    return "cohort_total";
  }
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

/**
 * 「到達したが、枠で断られただけ」の人を Entry Pull の分母から外す。
 *
 * ⚠ 到達（entry_views）と枠での拒否（capacity_rejections）は別テーブルなので、
 *   断られた人も「到達」には残っている。分母に残したままだと、
 *   興味がなくて始めなかった人と混ざって Entry Pull が実態より低く出る。
 *
 * ただし「断られたが、別の日には会話できた人」は除外しない。
 * その人はちゃんと参加しているので、分母に残すのが正しい。
 * したがって除外するのは「セッションを1つも持たず、拒否だけがある人」。
 */
export function entryDenominator(
  entryTokens: Iterable<string>,
  tokensWithSession: Iterable<string>,
  rejectedTokens: Iterable<string>
): { people: number; excluded: number } {
  const entry = new Set(entryTokens);
  const withSession = new Set(tokensWithSession);
  const rejected = new Set(rejectedTokens);

  let excluded = 0;
  for (const t of entry) {
    if (rejected.has(t) && !withSession.has(t)) excluded += 1;
  }
  return { people: entry.size - excluded, excluded };
}

/* ============================================================
   Found Campaign と Return 判定（Wave 1 / Found Return 01）
   ============================================================

   Wave 1 で一度踏んだ罠を繰り返さないための設計。

   罠1: 同じ日に何度も使ったのを「再訪」と誤認した。
        → Return の判定に経過時間を使わない。JSTの日付が変わったかで見る。
           9/11 23:50 閲覧 → 9/12 00:10 会話 は、経過20分だが Next-Day Return。
           9/11 10:00 閲覧 → 9/11 20:00 会話 は、経過10時間だが Same-Day。
        経過時間は Diagnostic として別に出す。

   罠2: 母集団の混在。src が null のものには過去の開発・運営セッションが
        混ざるため、「src なし = Wave 1 知人」とは定義できない。
        → Found実験の母集団は campaign_key で定義する。

   罠3: 再閲覧のたびに起点がリセットされると、見るたびに起点が後ろへずれて
        再訪が永久に検出されない。
        → 起点は「そのキャンペーンでの最初の閲覧」に固定する。
*/

export interface FoundCampaign {
  key: string;
  label: string;
}

/** 配布キャンペーンの一覧。DBの campaign_key と一致させること。 */
export const FOUND_CAMPAIGNS: readonly FoundCampaign[] = [
  { key: "wave1_found_return_01", label: "Wave 1 / Found Return 01" },
] as const;

/**
 * Next-Day Return の判定。
 *
 * ⚠ 経過時間ではなく JST の日付で見る。これが Primary KPI。
 */
export function isNextDayReturnJst(viewedAt: string, startedAt: string): boolean {
  const v = jstDateKey(viewedAt);
  const s = jstDateKey(startedAt);
  if (!v || !s) return false;
  return s > v;
}

export const ELAPSED_BUCKETS = ["le10m", "le1h", "le24h", "le72h", "gt72h"] as const;
export type ElapsedBucket = (typeof ELAPSED_BUCKETS)[number];

export const ELAPSED_BUCKET_LABELS: Record<ElapsedBucket, string> = {
  le10m: "≤10分",
  le1h: "≤1時間",
  le24h: "≤24時間",
  le72h: "≤72時間",
  gt72h: ">72時間",
};

/** Diagnostic 用。Return の判定には使わない。 */
export function elapsedBucket(minutes: number): ElapsedBucket {
  if (minutes <= 10) return "le10m";
  if (minutes <= 60) return "le1h";
  if (minutes <= 60 * 24) return "le24h";
  if (minutes <= 60 * 72) return "le72h";
  return "gt72h";
}

/** viewedAt より後の最初の開始時刻。無ければ null。 */
export function firstSessionAfter(
  viewedAt: string,
  starts: string[]
): string | null {
  const base = new Date(viewedAt).getTime();
  if (Number.isNaN(base)) return null;
  const after = starts
    .filter((s) => {
      const t = new Date(s).getTime();
      return !Number.isNaN(t) && t > base;
    })
    .sort();
  return after[0] ?? null;
}

export interface FoundNoteRow {
  session_id: string;
  approved: boolean;
  campaign_key: string | null;
  first_sent_at: string | null;
}

export interface FoundSessionRow {
  session_id: string;
  client_token: string | null;
  started_at: string;
  user_message_count: number;
  memory_found: boolean;
  entry_context: string | null;
}

export interface FoundViewRow {
  client_token: string;
  viewed_at: string;
  value_response: string | null;
}

export interface FoundCampaignFunnel {
  /** 配布できる条件を満たした人（Memory Found とは別物） */
  eligible: number;
  /** 実際に送った人（first_sent_at あり） */
  sent: number;
  /** 送ったうち /found を開いた人 */
  viewed: number;
  valueCounts: Record<string, number>;
  /** 閲覧後に会話を開始した人。⚠ 閲覧していない人は対象外 */
  postFoundSession: number;
  sameDayContinuation: number;
  nextDayReturn: number;
  /** ?from=found から直接戻った人（Return の必須条件ではない） */
  directFromFound: number;
  /** 閲覧後の会話で新しい記憶が出た人 */
  newMemoryFound: number;
  /** Diagnostic。Return の判定には使わない */
  buckets: Record<ElapsedBucket, number>;
  elapsedMinutes: number[];
  /** fit と答えた人のうち Next-Day Return した人 */
  fitAndNextDay: number;
  fitPeople: number;
  /** 除外した運営テストの人数 */
  internalExcluded: number;
}

function emptyBuckets(): Record<ElapsedBucket, number> {
  return { le10m: 0, le1h: 0, le24h: 0, le72h: 0, gt72h: 0 };
}

/**
 * 1つの配布キャンペーンのファネルを組み立てる。
 *
 * 母集団の定義（順に絞る）:
 *   Found Eligible … campaign_key 一致 かつ approved かつ Memory あり かつ 0発話でない
 *   Sent           … そのうち first_sent_at がある人
 *   Viewed         … そのうち /found を開いた人
 *
 * ⚠ Post-Found Session 以降は「閲覧した人」だけを対象にする。
 *   送付済みでも未閲覧の人は Return 判定に入れない。
 *   今回の実験は「Foundを見たことが Return Trigger になるか」を見るもので、
 *   見ていない人の再訪はその問いに答えない。
 *
 * ⚠ 起点は「first_sent_at 以降の最初の閲覧」。
 *   送付前に運営が開いたテスト閲覧を起点にしないため。
 */
export function foundCampaignFunnel(args: {
  campaignKey: string;
  notes: FoundNoteRow[];
  sessions: FoundSessionRow[];
  views: FoundViewRow[];
  internalTokens: Iterable<string>;
  includeInternal: boolean;
}): FoundCampaignFunnel {
  const { campaignKey, notes, sessions, views, includeInternal } = args;
  const internal = new Set(args.internalTokens);

  const sessionById = new Map<string, FoundSessionRow>();
  const sessionsByToken = new Map<string, FoundSessionRow[]>();
  for (const s of sessions) {
    sessionById.set(s.session_id, s);
    if (!s.client_token) continue;
    const list = sessionsByToken.get(s.client_token) ?? [];
    list.push(s);
    sessionsByToken.set(s.client_token, list);
  }

  // Eligible と Sent を人単位で集める
  const eligible = new Set<string>();
  const sentAtByToken = new Map<string, string>();
  for (const n of notes) {
    if (n.campaign_key !== campaignKey) continue;
    if (!n.approved) continue;
    const s = sessionById.get(n.session_id);
    if (!s || !s.client_token) continue;
    if (!s.memory_found) continue;
    if (s.user_message_count <= 0) continue;
    eligible.add(s.client_token);
    if (n.first_sent_at) {
      const cur = sentAtByToken.get(s.client_token);
      // 同じ人に複数のnoteがある場合は、最も早い送付を採る
      if (!cur || n.first_sent_at < cur) sentAtByToken.set(s.client_token, n.first_sent_at);
    }
  }

  let internalExcluded = 0;
  if (!includeInternal) {
    for (const t of [...eligible]) {
      if (internal.has(t)) {
        eligible.delete(t);
        sentAtByToken.delete(t);
        internalExcluded += 1;
      }
    }
  }

  // 起点：first_sent_at 以降の最初の閲覧
  const viewsByToken = new Map<string, FoundViewRow[]>();
  for (const v of views) {
    const list = viewsByToken.get(v.client_token) ?? [];
    list.push(v);
    viewsByToken.set(v.client_token, list);
  }

  const valueCounts: Record<string, number> = { fit: 0, off: 0, unknown: 0 };
  const buckets = emptyBuckets();
  const elapsedMinutes: number[] = [];

  let viewed = 0;
  let postFoundSession = 0;
  let sameDayContinuation = 0;
  let nextDayReturn = 0;
  let directFromFound = 0;
  let newMemoryFound = 0;
  let fitAndNextDay = 0;
  let fitPeople = 0;

  for (const [token, sentAt] of sentAtByToken) {
    const own = (viewsByToken.get(token) ?? [])
      .filter((v) => v.viewed_at >= sentAt)
      .sort((a, b) => (a.viewed_at < b.viewed_at ? -1 : 1));
    if (own.length === 0) continue;
    viewed += 1;

    const firstView = own[0].viewed_at;

    // 1タップ評価は1人1票。最初の回答だけ採る
    const answered = own.find((v) => v.value_response);
    const isFit = answered?.value_response === "fit";
    if (answered?.value_response && answered.value_response in valueCounts) {
      valueCounts[answered.value_response] += 1;
    }
    if (isFit) fitPeople += 1;

    const ownSessions = sessionsByToken.get(token) ?? [];
    const after = ownSessions.filter((s) => s.started_at > firstView);
    if (after.length === 0) continue;

    postFoundSession += 1;

    /*
     * 1人は1回だけ数える。
     * Same-Day と Next-Day の両方がある場合は Next-Day を採る（強いシグナル）。
     */
    const isNextDay = after.some((s) => isNextDayReturnJst(firstView, s.started_at));
    if (isNextDay) {
      nextDayReturn += 1;
      if (isFit) fitAndNextDay += 1;
    } else {
      sameDayContinuation += 1;
    }

    if (after.some((s) => s.entry_context === "found")) directFromFound += 1;
    if (after.some((s) => s.memory_found)) newMemoryFound += 1;

    const mins = minutesToRevisit(
      firstView,
      after.map((s) => s.started_at)
    );
    if (mins != null) {
      elapsedMinutes.push(mins);
      buckets[elapsedBucket(mins)] += 1;
    }
  }

  return {
    eligible: eligible.size,
    sent: sentAtByToken.size,
    viewed,
    valueCounts,
    postFoundSession,
    sameDayContinuation,
    nextDayReturn,
    directFromFound,
    newMemoryFound,
    buckets,
    elapsedMinutes,
    fitAndNextDay,
    fitPeople,
    internalExcluded,
  };
}

/* ============================================================
   体験条件の比較（baseline / memory_receipt_v1）
   ============================================================

   ⚠ これは A/B ランダムテストではない。導入前後の variant 比較である。
     記事1の読者と、フラグを入れたあとの読者は同じ集団ではない。
     n も小さい。統計的効果としては扱わず、
     Positive / Negative Signal としてのみ読むこと。

   ⚠ Return の起点は、両条件で同じものを使う。
     Memory Receipt を見たかどうかを起点にすると baseline に対応物が無く、
     比較が成立しない。したがって起点は「記憶が出た最初のセッションの終了時刻」。
     Memory Receipt Viewed はファネルの1段であって起点ではない。
*/

export interface VariantSessionRow {
  session_id: string;
  client_token: string | null;
  started_at: string;
  completed_at: string | null;
  memory_found: boolean;
  experience_variant: string | null;
}

export interface VariantFunnel {
  people: number;
  completed: number;
  memoryFound: number;
  receiptViewed: number;
  sameDayContinuation: number;
  nextDayReturn: number;
  newMemoryFound: number;
}

function emptyVariantFunnel(): VariantFunnel {
  return {
    people: 0,
    completed: 0,
    memoryFound: 0,
    receiptViewed: 0,
    sameDayContinuation: 0,
    nextDayReturn: 0,
    newMemoryFound: 0,
  };
}

/**
 * 体験条件ごとのファネルを人単位で組み立てる。
 *
 * 1人が両方の条件にまたがらないよう、その人の「最初のセッションの条件」で
 * 所属を決める。フラグを切り替えた前後に跨って使った人は、切り替え前の条件に入る。
 * （跨った人を両方に数えると、どちらの数字も読めなくなる）
 */
export function variantFunnels(args: {
  sessions: VariantSessionRow[];
  receiptSessionIds: Iterable<string>;
  internalTokens: Iterable<string>;
  includeInternal: boolean;
}): Record<string, VariantFunnel> {
  const receipts = new Set(args.receiptSessionIds);
  const internal = new Set(args.internalTokens);

  const byToken = new Map<string, VariantSessionRow[]>();
  for (const s of args.sessions) {
    if (!s.client_token) continue;
    if (isDeletedToken(s.client_token)) continue;
    if (!args.includeInternal && internal.has(s.client_token)) continue;
    const list = byToken.get(s.client_token) ?? [];
    list.push(s);
    byToken.set(s.client_token, list);
  }

  const out: Record<string, VariantFunnel> = {};
  const bucket = (key: string) => (out[key] ??= emptyVariantFunnel());

  for (const list of byToken.values()) {
    const ordered = [...list].sort((a, b) =>
      a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0
    );
    const variant = ordered[0].experience_variant ?? "baseline";
    const f = bucket(variant);

    f.people += 1;
    if (ordered.some((s) => s.completed_at)) f.completed += 1;
    if (ordered.some((s) => receipts.has(s.session_id))) f.receiptViewed += 1;

    const firstMemory = ordered.find((s) => s.memory_found);
    if (!firstMemory) continue;
    f.memoryFound += 1;

    // 起点。終了時刻が取れなければ開始時刻で代用する
    const origin = firstMemory.completed_at ?? firstMemory.started_at;
    const after = ordered.filter((s) => s.started_at > origin);
    if (after.length === 0) continue;

    // 1人は1回だけ数える。両方あるときは Next-Day を採る（強いシグナル）
    const isNextDay = after.some((s) => isNextDayReturnJst(origin, s.started_at));
    if (isNextDay) f.nextDayReturn += 1;
    else f.sameDayContinuation += 1;

    if (after.some((s) => s.memory_found)) f.newMemoryFound += 1;
  }

  return out;
}
