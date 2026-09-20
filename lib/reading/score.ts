import { echoRatio, ECHO_THRESHOLD } from "../echo.ts";
import { lexiconHits, hasAssertion } from "./barnum.ts";
import type { ReadingInput, Score, SignalKind } from "./types.ts";

/**
 * S5. 4軸評価（Evidence / Specificity / Risk / Surprise）
 *
 * ⚠ 設計の要点：**LLM が甘く採点しても落ちる構造にする。**
 *   モデルは自分の出力に甘い。だから
 *     Evidence … 完全に機械
 *     Surprise … 機械側に下限（言い換えなら 0）
 *     Risk     … 言い切りが無ければ機械で 0
 *     Specificity … 一般語彙が出たら機械で上限 1
 *   を先に効かせる。LLM の点はその**内側**でしか動けない。
 */

/** 文に割る。言い換え判定を文単位で行うため */
export function sentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/**
 * Surprise の機械側。
 *
 * ⚠ v1.6.0 のおうむ返し対策で作った echoRatio をそのまま使う。
 *   「本人が言ったことを言い直しただけ」は文字bigramで検出できる。
 *   Reading が要約に化けるのは、この製品でいちばん起きやすい劣化である。
 */
export function paraphraseRatio(text: string, input: ReadingInput): number {
  const userText = input.turns
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join("\n");
  if (!userText) return 0;
  let max = 0;
  for (const s of sentences(text)) {
    const r = echoRatio(s, userText);
    if (r > max) max = r;
  }
  return max;
}

export function isParaphrase(text: string, input: ReadingInput): boolean {
  return paraphraseRatio(text, input) >= ECHO_THRESHOLD;
}

/**
 * Evidence（機械のみ）。
 *   0 … 接地した引用が無い
 *   1 … 引用1件、Signal 1種類
 *   2 … 引用2件以上 または Signal 2種類以上
 *   3 … 引用2件以上 かつ Signal 2種類以上
 *
 * ⚠ 種類の多様性を見るのは、同じ話題3件が1件に近いのと同じ理由。
 *   同じ kind ばかりの根拠は、実質1本の根拠である。
 */
export function evidenceScore(groundedQuotes: number, kinds: SignalKind[]): number {
  const k = new Set(kinds).size;
  if (groundedQuotes === 0) return 0;
  if (groundedQuotes >= 2 && k >= 2) return 3;
  if (groundedQuotes >= 2 || k >= 2) return 2;
  return 1;
}

/** 一般語彙が出たら、LLM が何点を付けても Specificity の上限は 1 */
export function capSpecificity(llmScore: number, text: string): number {
  const hits = lexiconHits(text);
  const capped = hits.length > 0 ? Math.min(llmScore, 1) : llmScore;
  return clamp(capped);
}

/** 言い切りが無ければ Risk は 0。LLM の点は使わない */
export function capRisk(llmScore: number, text: string): number {
  return hasAssertion(text) ? clamp(llmScore) : 0;
}

/** 言い換えなら Surprise は 0。LLM の点は使わない */
export function capSurprise(llmScore: number, text: string, input: ReadingInput): number {
  return isParaphrase(text, input) ? 0 : clamp(llmScore);
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}

export function buildScore(args: {
  groundedQuotes: number;
  kinds: SignalKind[];
  text: string;
  input: ReadingInput;
  llmSpecificity: number;
  llmRisk: number;
  llmSurprise: number;
}): Score {
  const evidence = evidenceScore(args.groundedQuotes, args.kinds);
  const specificity = capSpecificity(args.llmSpecificity, args.text);
  const risk = capRisk(args.llmRisk, args.text);
  const surprise = capSurprise(args.llmSurprise, args.text, args.input);
  return {
    evidence,
    specificity,
    risk,
    surprise,
    total: evidence + specificity + risk + surprise,
  };
}

/**
 * OPEN BET として採用してよいか。
 *
 * ⚠ 「合計が高い」だけでは通さない。どれか1軸でも 0 なら落とす。
 *   Evidence 0 は根拠なし、Risk 0 は外れようがない、
 *   Surprise 0 は要約、Specificity 0 は誰にでも当てはまる。
 *   どれも、他の軸で埋め合わせてよいものではない。
 */
export function isAcceptable(score: Score): boolean {
  return (
    score.evidence > 0 && score.specificity > 0 && score.risk > 0 && score.surprise > 0
  );
}
