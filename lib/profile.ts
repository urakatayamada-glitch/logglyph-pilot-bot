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

/**
 * 今の自分に近い状態（複数選択）。Segmentation の中心。
 *
 * 2026-09-13 に整理（ChatGPT レビュー / オーナー判断 A案）:
 *   「仕事やキャリアについて考えている」「転職／独立／起業などの変化がある」
 *   「新しい挑戦をしている／始めたい」が近すぎて、回答者が迷っていた。
 *
 * ⚠ 旧コードは LEGACY_STATE_LABELS に残す。消すと、整理前に答えた人の
 *   回答が Admin から黙って消える。混ざった集計になるほうがまだよい。
 *   （黙ってデータを捨てるコードで一度痛い目を見ている）
 */
export const STATES = [
  "career_change",
  "family",
  "challenge",
  "milestone",
  "looking_back",
  "no_change",
  "other",
] as const;
export type ProfileState = (typeof STATES)[number];

export const STATE_LABELS: Record<ProfileState, string> = {
  career_change: "仕事やキャリアに変化がある",
  family: "家族や子育てについて考えることが増えた",
  challenge: "新しい挑戦を始めたい",
  milestone: "人生の節目を感じている",
  looking_back: "最近、自分の過去を振り返ることがある",
  no_change: "特に大きな変化はない",
  other: "その他",
};

/**
 * 整理前（2026-09-13 以前）に保存された値。
 * 新規の画面には出さないが、Admin では読めるようにする。
 */
export const LEGACY_STATES = ["career", "transition"] as const;

export const LEGACY_STATE_LABELS: Record<string, string> = {
  career: "（旧）仕事やキャリアについて考えている",
  transition: "（旧）転職／独立／起業などの変化がある",
};

/** 画面に出す選択肢 ＋ 集計で読む必要がある旧コード。 */
export const ALL_STATE_CODES = [...STATES, ...LEGACY_STATES] as const;

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
 * 送られてきた回答を、DB の列名の差分に変換する。
 *
 * ⚠ 3ステップに分割したので、1回の送信には一部の設問しか入らない。
 *   渡されなかった設問の列は**触らない**こと。
 *   全列を毎回書くと、STEP 2 の送信で STEP 1 の回答が空で上書きされる。
 *
 * ⚠ 知らない値は捨てるが、捨てた件数を返す。黙って握りつぶさない。
 */
export function toDbPatch(input: unknown): {
  patch: Record<string, unknown>;
  dropped: number;
  hasAny: boolean;
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const patch: Record<string, unknown> = {};
  let dropped = 0;
  let hasAny = false;

  const one = <T extends string>(key: string, col: string, allowed: readonly T[]) => {
    if (!has(key)) return;
    const v = pickOne(allowed, o[key]);
    if (v == null && o[key] != null) dropped += 1;
    patch[col] = v;
    if (v != null) hasAny = true;
  };
  const many = <T extends string>(key: string, col: string, allowed: readonly T[]) => {
    if (!has(key)) return;
    const v = pickMany(allowed, o[key]);
    if (Array.isArray(o[key])) dropped += Math.max(0, (o[key] as unknown[]).length - v.length);
    patch[col] = v;
    if (v.length > 0) hasAny = true;
  };

  many("states", "states", STATES);
  many("motives", "motives", MOTIVES);
  one("reflectHabit", "reflect_habit", REFLECT_HABITS);
  one("ageBand", "age_band", AGE_BANDS);
  one("gender", "gender", GENDERS);

  return { patch, dropped, hasAny };
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
      // ⚠ 旧コードも拾う。整理前の回答を消さないため
      return pickMany(ALL_STATE_CODES, row.states);
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
      return (
        STATE_LABELS[key as ProfileState] ?? LEGACY_STATE_LABELS[key] ?? key
      );
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
      return ALL_STATE_CODES;
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
