import type { ReadingInput, Signal } from "./types.ts";

/**
 * S3. Evidence Grounding ── 機械検査（v0.3 §0.5）
 *
 * ⚠ ここが Reading Engine の土台である。
 *
 *   第1回 Reading 検査で確定した事実：
 *     one_line_memory は**抽出器が書いた文**であって、本人の発話ではない。
 *     要約の言い回しを根拠にすると、本人ではなく自分たちの抽出器を読むことになる。
 *
 *   したがって引用は「生ログの user 発話に実在する文字列」でなければならない。
 *   これを文言でのお願いにせず、**部分文字列判定**で検査する。
 *
 * ⚠ 一致しなかった候補は**破棄する。書き直させない。**
 *   書き直させると、モデルは一致する引用を探して
 *   **読みのほうを引用に合わせて曲げる。** それでは根拠ではなくなる。
 */

/** 引用として短すぎるものは根拠にしない（「そう」「うん」で通ってしまう） */
export const MIN_QUOTE_CHARS = 6;

/**
 * 比較用の正規化。
 *
 * ⚠ ここを緩くしすぎると、捏造引用が通る。
 *   全角半角（NFKC）と空白、引用符だけを揃える。
 *   助詞や語尾は**落とさない**。落とすと「言っていないこと」が通る。
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[「」『』"'”“]/g, "")
    .trim();
}

/** 本人（user）の発話だけを連結する。AIの発話は根拠にできない */
export function userCorpus(input: ReadingInput): string {
  return normalizeForMatch(
    input.turns.filter((t) => t.role === "user").map((t) => t.content).join("\n")
  );
}

export function isGrounded(quote: string, corpus: string): boolean {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return false;
  return corpus.includes(q);
}

export interface GroundingResult {
  grounded: Signal[];
  ungrounded: Signal[];
}

/** Signal を接地したものとしていないものに分ける */
export function groundSignals(signals: Signal[], input: ReadingInput): GroundingResult {
  const corpus = userCorpus(input);
  const grounded: Signal[] = [];
  const ungrounded: Signal[] = [];
  for (const s of signals) {
    (isGrounded(s.quote, corpus) ? grounded : ungrounded).push(s);
  }
  return { grounded, ungrounded };
}
