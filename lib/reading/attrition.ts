import { emptyAttrition, type Attrition, type SessionResult } from "./types.ts";

/**
 * Reading Abstention / Candidate Attrition（Product Decision 2026-09-20）
 *
 * ⚠ LLM を呼ぶモジュールから切り離してある。
 *   集計は純粋な計算なので、ネットワーク無しでテストできる状態を保つ。
 */

/** Reading Abstention / Candidate Attrition の集計 */
export function tally(results: SessionResult[]): Attrition {
  const a = emptyAttrition();
  a.sessions = results.length;
  for (const r of results) {
    a.candidatesGenerated += r.evaluated.length;
    for (const e of r.evaluated) {
      if (e.dropped) {
        a.byReason = a.byReason ?? {};
        a.byReason[e.dropped] = (a.byReason[e.dropped] ?? 0) + 1;
      }
      switch (e.dropped) {
        case "grounding":
          a.droppedByGrounding += 1;
          break;
        case "no_assertion":
          a.droppedByNoAssertion += 1;
          break;
        case "barnum_lexicon":
          a.droppedByBarnumLexicon += 1;
          break;
        case "barnum_swap":
          a.droppedByBarnumSwap += 1;
          break;
        case "surprise_echo":
          a.droppedBySurpriseEcho += 1;
          break;
        case null:
          a.survived += 1;
          break;
        default:
          // v2 で増えた「形」の理由は byReason にだけ数える
          break;
      }
    }
    if (r.openBet) a.openBets += 1;
    else a.sessionsWithNoOpenBet += 1;
  }
  return a;
}

/** 差し替え相手が毎回同じ4件にならないようにずらす */
export function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const k = by % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}

/**
 * 落ちた数の合計（理由を問わず）。
 * ⚠ 「落ちた数 + 生き残り = 生成数」を常に満たすこと。
 *   どこかの経路が黙って候補を捨てたら、この等式が壊れて気づける。
 */
export function droppedTotal(a: Attrition): number {
  return Object.values(a.byReason ?? {}).reduce((s, n) => s + (n ?? 0), 0);
}
