/**
 * Reading の「形」の検査（reading-v2）。
 *
 * ⚠ 第1回 Benchmark で分かったこと：
 *   生成側が書いていたのは Reading ではなく**人物評**だった。
 *     「感受性豊かな人である」「逆境で燃えるタイプ」
 *     「防衛機制の一環である」「サポートが必要である」
 *   人を形容詞で要約し、心理学の語彙で診断し、助言まで付ける。
 *
 *   Reading の定義（Product Owner / 2026-09-21）：
 *     人を説明するものではなく、
 *     **語られた事実同士の間にある「まだ名前のない関係」を提示するもの。**
 *
 *   その定義から外れる形を、ここで**種類ごとに**落とす。
 *   種類ごとに分けているのは、Benchmark で
 *   「人物評・心理診断・助言ではなく、語りの中のズレになっているか」を
 *   **独立した問い**として数えるため。
 */

export type FormViolation =
  | "internal_id"
  | "gender_assertion"
  | "person_verdict"
  | "diagnosis"
  | "advice";

/** 人を形容で閉じる型 */
export const PERSON_VERDICT = [
  "な人である",
  "な人だ",
  "な人物",
  "人物だ",
  "人物である",
  "タイプ",
  "傾向がある",
  "傾向が強い",
  "性格",
  "感受性",
  "観察力",
  "成熟",
  "素質",
  "能力がある",
  "能力を持",
  "人一倍",
  "大切にする人",
] as const;

/** 心理学の語彙で診断する型 */
export const DIAGNOSIS = [
  "防衛機制",
  "承認欲求",
  "自己肯定感",
  "自己保護",
  "トラウマ",
  "無意識",
  "潜在的",
  "心理的",
  "深層",
  "欲求",
] as const;

/** 助言・処方の型 */
export const ADVICE = [
  "必要がある",
  "必要である",
  "必要だ",
  "サポート",
  "べきだ",
  "べきである",
  "するとよい",
  "するといい",
  "したほうがいい",
  "した方がいい",
  "認めてあげ",
  "励ま",
] as const;

function norm(s: string): string {
  return s.normalize("NFKC");
}

/**
 * 性別の断定。
 * ⚠ シーン生成で一度やった不具合と同じ種類（2026-09-13）。
 *   三人称を置くと、日本語では性別が決まってしまう。
 */
export function assertsGender(text: string): boolean {
  return /彼女|彼(?!岸)/.test(norm(text));
}

/** 内部の Signal ID（s1, s2 …）が本文に漏れていないか */
export function leaksInternalId(text: string): boolean {
  return /(^|[^A-Za-z0-9])s\d{1,2}(?![0-9A-Za-z])/.test(norm(text));
}

function hits(text: string, list: readonly string[]): string[] {
  const t = norm(text);
  return list.filter((w) => t.includes(w));
}

export interface FormCheck {
  violation: FormViolation | null;
  hits: string[];
}

/** 最初に当たった違反を返す。順序は「機械的に確実なもの」から */
export function checkForm(text: string): FormCheck {
  if (leaksInternalId(text)) return { violation: "internal_id", hits: [] };
  if (assertsGender(text)) return { violation: "gender_assertion", hits: [] };
  const pv = hits(text, PERSON_VERDICT);
  if (pv.length) return { violation: "person_verdict", hits: pv };
  const dx = hits(text, DIAGNOSIS);
  if (dx.length) return { violation: "diagnosis", hits: dx };
  const ad = hits(text, ADVICE);
  if (ad.length) return { violation: "advice", hits: ad };
  return { violation: null, hits: [] };
}
