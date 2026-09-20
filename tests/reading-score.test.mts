import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildScore,
  capRisk,
  capSpecificity,
  capSurprise,
  evidenceScore,
  isAcceptable,
  isParaphrase,
  paraphraseRatio,
} from "../lib/reading/score.ts";
import { hardLexiconHits } from "../lib/reading/barnum.ts";
import { DECOYS } from "../lib/reading/decoy.ts";
import type { ReadingInput } from "../lib/reading/types.ts";

const input: ReadingInput = {
  sessionId: "s1",
  trigger: "人との別れで、いまも引っかかっていることはある？",
  category: "romance",
  isInternal: false,
  turns: [
    { role: "assistant", content: "別れの話で、残っていることはある？" },
    { role: "user", content: "昔ベンチャーに勤めてた頃のスーツが捨てられないんだよね" },
    { role: "user", content: "営業で毎日着てた。今は着る予定もないのに置いてある" },
  ],
};

/* ── 固定回帰テスト ──────────────────────────────────────
 * 第1回 Reading 検査で手で捨てた文。
 * ⚠ これをエンジンが高く評価したら、そのエンジンは壊れている。
 *   Benchmark failure として扱う（Product Decision 2026-09-20）。
 */
test("回帰：『続けることが苦手なタイプ』は機械側で棄却される", () => {
  const bad = DECOYS[0];
  assert.ok(hardLexiconHits(bad).length >= 1, "即棄却の語で捕まえられること");
});

test("回帰：甘く採点されても、一般論の Specificity は 1 で頭打ちになる", () => {
  /*
   * ⚠ ここで確認しているのは「点が低いこと」ではない。
   *   LLM が 3/3/3 を付けてきても、機械側が Specificity を 1 に抑えること。
   *
   * ⚠ そして**点だけがゲートではない。**
   *   この文章は run.ts の一般語彙ゲートで、採点に到達する前に落ちる。
   *   合計点で弾こうとすると閾値の調整合戦になるので、
   *   「語が出た時点で落とす」を先に置いている。
   */
  const bad = "あなたは続けることが苦手なタイプなんだと思う。";
  const s = buildScore({
    groundedQuotes: 2,
    kinds: ["residue", "repetition"],
    text: bad,
    input,
    llmSpecificity: 3,
    llmRisk: 3,
    llmSurprise: 3,
  });
  assert.equal(s.specificity, 1, "一般語彙があれば Specificity は 1 が上限");
  assert.ok(hardLexiconHits(bad).length >= 1, "採点に到達する前に落ちること");
});

test("Evidence は機械だけで決まる", () => {
  assert.equal(evidenceScore(0, []), 0);
  assert.equal(evidenceScore(1, ["residue"]), 1);
  assert.equal(evidenceScore(2, ["residue"]), 2);
  assert.equal(evidenceScore(1, ["residue", "trigger_delta"]), 2);
  assert.equal(evidenceScore(2, ["residue", "trigger_delta"]), 3);
});

test("言い切りが無ければ Risk は 0 に落ちる", () => {
  assert.equal(capRisk(3, "あなたは過去を振り返る人なのかもしれません"), 0);
  assert.equal(capRisk(3, "欲しかったのは休みではなかったと思う"), 3);
});

test("本人の発話の言い換えは Surprise 0 になる", () => {
  const echoText = "昔ベンチャーに勤めてた頃のスーツが捨てられないんだよね。";
  assert.ok(isParaphrase(echoText, input), `ratio=${paraphraseRatio(echoText, input)}`);
  assert.equal(capSurprise(3, echoText, input), 0);
});

test("本人が言っていない読みは Surprise が残る", () => {
  const reading =
    "あなたが手放せずにいるのは、あのスーツを着ていたときの自分の立ち方なんじゃないか。";
  assert.equal(isParaphrase(reading, input), false);
  assert.equal(capSurprise(3, reading, input), 3);
});

test("一般語彙があれば Specificity の上限は 1", () => {
  assert.equal(capSpecificity(3, "あなたは過去を大切にする人だと思う"), 1);
  assert.equal(capSpecificity(3, "あのスーツを着ていた頃の立ち方だと思う"), 3);
});

test("1軸でも0なら合格にしない", () => {
  assert.equal(isAcceptable({ evidence: 3, specificity: 3, risk: 3, surprise: 0, total: 9 }), false);
  assert.equal(isAcceptable({ evidence: 1, specificity: 1, risk: 1, surprise: 1, total: 4 }), true);
});

test("強い読みは4軸すべてが立つ", () => {
  const reading =
    "私が振ったのは人との別れの話だったのに、返ってきたのは人ではなくスーツだった。あなたが手放せずにいるのは、あのスーツを着ていたときの自分の立ち方なんじゃないかと思う。";
  const s = buildScore({
    groundedQuotes: 2,
    kinds: ["trigger_delta", "residue"],
    text: reading,
    input,
    llmSpecificity: 3,
    llmRisk: 2,
    llmSurprise: 3,
  });
  assert.equal(isAcceptable(s), true);
  assert.equal(s.evidence, 3);
});
