/**
 * 最終ユーザーテスト用のプロフィール（profile_v1）。
 *
 * ── 目的 ──────────────────────────────────────────────
 * 「誰に Return Pull が強く出たのか」を利用ログと突き合わせるため。
 * demographic segmentation を作るためではない。n が小さく、
 * 年代・性別で結論は出せない。中心にあるのは「いまの状態」と「動機」。
 *
 * ── 設計上の約束 ────────────────────────────────────
 * ⚠ 本人特定情報は扱わない。名前・メール・電話は列としても存在させない。
 * ⚠ 保存するのは英数コードのみ。日本語ラベルはこのファイルだけに置く。
 *    文言を直したときに過去データが読めなくなるのを防ぐ。
 * ⚠ 自由記述欄は作らない（Product Decision 2026-09-13）。
 *    n が小さく集計に使えないうえ、職業・地名などの特定情報が混入する。
 * ⚠ 必須項目は1つも無い。全部飛ばして閉じられる。
 */

export const AGE_BANDS = [
  "10s",
  "20s",
  "30s",
  "40s",
  "50s",
  "60s_plus",
  "no_answer",
] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  "10s": "10代",
  "20s": "20代",
  "30s": "30代",
  "40s": "40代",
  "50s": "50代",
  "60s_plus": "60代以上",
  no_answer: "答えたくない",
};

export const GENDERS = ["male", "female", "other", "no_answer"] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  no_answer: "答えたくない",
};

/** 今の自分に近い状態（複数選択）。Segmentation の中心。 */
export const STATES = [
  "career",
  "transition",
  "challenge",
  "family",
  "milestone",
  "looking_back",
  "no_change",
  "other",
] as const;
export type ProfileState = (typeof STATES)[number];

export const STATE_LABELS: Record<ProfileState, string> = {
  career: "仕事やキャリアについて考えている",
  transition: "転職／独立／起業などの変化がある",
  challenge: "新しい挑戦をしている／始めたい",
  family: "子育てや家族について考えることが増えた",
  milestone: "人生の節目を感じている",
  looking_back: "最近、自分の過去を振り返ることがある",
  no_change: "特に大きな変化はない",
  other: "その他",
};

/** 試してみようと思った理由（複数選択）。 */
export const MOTIVES = [
  "what_recall",
  "how_scripted",
  "new_discovery",
  "keep_record",
  "ai_interest",
  "asked_by_friend",
  "no_reason",
  "other",
] as const;
export type ProfileMotive = (typeof MOTIVES)[number];

export const MOTIVE_LABELS: Record<ProfileMotive, string> = {
  what_recall: "自分が何を思い出すのか気になった",
  how_scripted: "自分の人生がどう脚本化されるのか気になった",
  new_discovery: "自分について新しい発見がありそうだった",
  keep_record: "過去の経験を残しておきたいと思った",
  ai_interest: "AIサービスとして興味があった",
  asked_by_friend: "知人から頼まれたから",
  no_reason: "なんとなく",
  other: "その他",
};

export const REFLECT_HABITS = ["often", "sometimes", "rarely", "never"] as const;
export type ReflectHabit = (typeof REFLECT_HABITS)[number];

export const REFLECT_HABIT_LABELS: Record<ReflectHabit, string> = {
  often: "よくする",
  sometimes: "たまにする",
  rarely: "ほとんどしない",
  never: "まったくしない",
};

export interface ProfileAnswers {
  ageBand: AgeBand | null;
  gender: Gender | null;
  states: ProfileState[];
  motives: ProfileMotive[];
  reflectHabit: ReflectHabit | null;
}

export function emptyAnswers(): ProfileAnswers {
  return {
    ageBand: null,
    gender: null,
    states: [],
    motives: [],
    reflectHabit: null,
  };
}

function pickOne<T extends string>(
  allowed: readonly T[],
  v: unknown
): T | null {
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : null;
}

function pickMany<T extends string>(allowed: readonly T[], v: unknown): T[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    if (!(allowed as readonly string[]).includes(item)) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item as T);
  }
  return out;
}

/**
 * 受け取った値を既知の選択肢だけに絞る。
 *
 * ⚠ 知らない値は黙って捨てず、捨てた事実が分かるように呼び出し側で数える。
 *   （進捗バーが 0% のままだった原因は、捨てたものを記録していなかったこと）
 */
export function sanitizeAnswers(input: unknown): {
  answers: ProfileAnswers;
  dropped: number;
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const answers: ProfileAnswers = {
    ageBand: pickOne(AGE_BANDS, o.ageBand),
    gender: pickOne(GENDERS, o.gender),
    states: pickMany(STATES, o.states),
    motives: pickMany(MOTIVES, o.motives),
    reflectHabit: pickOne(REFLECT_HABITS, o.reflectHabit),
  };
  const given = (v: unknown) => (Array.isArray(v) ? v.length : v == null ? 0 : 1);
  const before =
    given(o.ageBand) +
    given(o.gender) +
    given(o.states) +
    given(o.motives) +
    given(o.reflectHabit);
  const after =
    (answers.ageBand ? 1 : 0) +
    (answers.gender ? 1 : 0) +
    answers.states.length +
    answers.motives.length +
    (answers.reflectHabit ? 1 : 0);
  return { answers, dropped: Math.max(0, before - after) };
}

/** 1つでも答えていれば「回答済み」。 */
export function hasAnyAnswer(a: ProfileAnswers): boolean {
  return (
    a.ageBand != null ||
    a.gender != null ||
    a.reflectHabit != null ||
    a.states.length > 0 ||
    a.motives.length > 0
  );
}

/* ============================================================
   集計（Admin 用）
   ============================================================ */

export interface ProfileRow {
  client_token: string;
  age_band: string | null;
  gender: string | null;
  states: string[] | null;
  motives: string[] | null;
  reflect_habit: string | null;
  answered: boolean;
}

/** 回答状況の3群。質問そのものが Return に効いていないかを見るために使う。 */
export const PROFILE_GROUPS = ["answered", "declined", "not_shown"] as const;
export type ProfileGroup = (typeof PROFILE_GROUPS)[number];

export const PROFILE_GROUP_LABELS: Record<ProfileGroup, string> = {
  answered: "プロフィール回答",
  declined: "スキップ／拒否",
  not_shown: "そもそも未表示",
};

/**
 * その人がどの群かを返す。
 *   行が無い          → まだ質問を出していない（not_shown）
 *   行があり answered → 回答した
 *   行があり未回答    → 出したが断られた（declined）
 */
export function profileGroup(row: ProfileRow | undefined): ProfileGroup {
  if (!row) return "not_shown";
  return row.answered ? "answered" : "declined";
}

export type ProfileAxis = "state" | "motive" | "reflect" | "age" | "gender";

/**
 * 集計軸ごとのキーを返す。回答が無ければ空配列＝どの行にも入らない。
 *
 * ⚠ state / motive は複数選択。1人が複数のキーを返すので、
 *   各行の人数を足しても総人数にはならない。
 */
export function axisKeys(
  axis: ProfileAxis,
  row: ProfileRow | undefined
): readonly string[] {
  if (!row) return [];
  switch (axis) {
    case "state":
      return pickMany(STATES, row.states);
    case "motive":
      return pickMany(MOTIVES, row.motives);
    case "reflect": {
      const v = pickOne(REFLECT_HABITS, row.reflect_habit);
      return v ? [v] : [];
    }
    case "age": {
      const v = pickOne(AGE_BANDS, row.age_band);
      return v ? [v] : [];
    }
    case "gender": {
      const v = pickOne(GENDERS, row.gender);
      return v ? [v] : [];
    }
  }
}

export function axisLabel(axis: ProfileAxis, key: string): string {
  switch (axis) {
    case "state":
      return STATE_LABELS[key as ProfileState] ?? key;
    case "motive":
      return MOTIVE_LABELS[key as ProfileMotive] ?? key;
    case "reflect":
      return REFLECT_HABIT_LABELS[key as ReflectHabit] ?? key;
    case "age":
      return AGE_BAND_LABELS[key as AgeBand] ?? key;
    case "gender":
      return GENDER_LABELS[key as Gender] ?? key;
  }
}

/** 表示順を選択肢の定義順に揃える（回答数順にすると毎回並びが変わって読めない）。 */
export function axisOrder(axis: ProfileAxis): readonly string[] {
  switch (axis) {
    case "state":
      return STATES;
    case "motive":
      return MOTIVES;
    case "reflect":
      return REFLECT_HABITS;
    case "age":
      return AGE_BANDS;
    case "gender":
      return GENDERS;
  }
}

/** n がこれ未満の行は参考値。画面に注記を出す。 */
export const SMALL_N = 5;
