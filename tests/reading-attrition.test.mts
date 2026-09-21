import { test } from "node:test";
import assert from "node:assert/strict";
import { droppedTotal, tally } from "../lib/reading/attrition.ts";
import { coverage, emptyAttrition } from "../lib/reading/types.ts";
import type { EvaluatedCandidate, ReadingInput, SessionResult } from "../lib/reading/types.ts";

/*
 * Reading Abstention / Candidate Attrition（Product Decision 2026-09-20）
 *
 * ⚠ 棄却率だけを見ると、エンジンが「強い読みを作る」のではなく
 *   「読みを出さない」方向に最適化されたことを見逃す。
 *   落ちた場所の内訳と Coverage を必ず一緒に出す。
 */

const input: ReadingInput = {
  sessionId: "s1",
  trigger: "t",
  category: null,
  isInternal: false,
  turns: [],
};

function cand(dropped: EvaluatedCandidate["dropped"]): EvaluatedCandidate {
  return {
    candidate: { id: "c", text: "x", basedOn: [] },
    groundedQuotes: 1,
    ungroundedQuotes: [],
    kinds: [],
    lexiconHits: [],
    swapYes: 0,
    swapTested: 0,
    paraphraseRatio: 0,
    hasAssertion: true,
    score: dropped ? null : { evidence: 2, specificity: 2, risk: 2, surprise: 2, total: 8 },
    dropped,
  };
}

function result(drops: EvaluatedCandidate["dropped"][], hasBet: boolean): SessionResult {
  const evaluated = drops.map(cand);
  return {
    input,
    signals: [],
    evaluated,
    openBet: hasBet ? evaluated.find((e) => e.dropped === null) ?? null : null,
  };
}

test("落ちた場所ごとに数えられる", () => {
  const a = tally([
    result(["grounding", "barnum_swap", null], true),
    result(["surprise_echo", "barnum_lexicon", "no_assertion"], false),
  ]);
  assert.equal(a.sessions, 2);
  assert.equal(a.candidatesGenerated, 6);
  assert.equal(a.droppedByGrounding, 1);
  assert.equal(a.droppedByBarnumSwap, 1);
  assert.equal(a.droppedBySurpriseEcho, 1);
  assert.equal(a.droppedByBarnumLexicon, 1);
  assert.equal(a.droppedByNoAssertion, 1);
  assert.equal(a.survived, 1);
  assert.equal(a.openBets, 1);
  assert.equal(a.sessionsWithNoOpenBet, 1);
});

test("落ちた数の合計と生き残りが、生成数と一致する", () => {
  const a = tally([
    result(["grounding", "barnum_swap", null], true),
    result(["person_verdict", "advice", "no_gap"], false),
  ]);
  assert.equal(droppedTotal(a) + a.survived, a.candidatesGenerated);
});

test("v2 の『形』の理由は、理由ごとに数えられる", () => {
  const a = tally([result(["person_verdict", "diagnosis", "advice"], false)]);
  assert.equal(a.byReason?.person_verdict, 1);
  assert.equal(a.byReason?.diagnosis, 1);
  assert.equal(a.byReason?.advice, 1);
  assert.equal(a.survived, 0);
});

test("Coverage は Open Bet が残ったセッションの割合", () => {
  const a = tally([result([null], true), result(["grounding"], false)]);
  assert.equal(coverage(a), 0.5);
  assert.equal(coverage(emptyAttrition()), 0);
});

test("1件も出せないと Coverage は 0 になる", () => {
  const a = tally([result(["grounding"], false), result(["barnum_swap"], false)]);
  assert.equal(coverage(a), 0);
  assert.equal(a.sessionsWithNoOpenBet, 2);
});
