import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hasAssertion,
  hardLexiconHits,
  lexiconHits,
  hedgeHits,
} from "../lib/reading/barnum.ts";
import { DECOYS, decoyFor } from "../lib/reading/decoy.ts";

test("一般論の語が入っていれば即棄却の対象になる", () => {
  assert.ok(hardLexiconHits("あなたは続けることが苦手なタイプなんだと思う").length >= 1);
  assert.ok(hardLexiconHits("あなたは過去を大切にする人だと思う").length >= 1);
});

test("固定デコイは全件、即棄却の語を含む", () => {
  // ⚠ ここが崩れると Blind 評価の「デコイ」が機能しない
  for (const d of DECOYS) {
    assert.ok(hardLexiconHits(d).length >= 1, `デコイに一般語彙が無い: ${d.slice(0, 20)}`);
  }
});

test("具体的な読みは即棄却の語を含まない", () => {
  const good =
    "あなたが手放せずにいるのは、あのスーツを着ていたときの自分の立ち方なんじゃないか。";
  assert.deepEqual(hardLexiconHits(good), []);
});

test("やわらかい語は棄却ではなく上限の対象にとどまる", () => {
  const t = "そこに向き合ってきたのだと思う";
  assert.deepEqual(hardLexiconHits(t), []);
  assert.ok(lexiconHits(t).length >= 1);
});

test("言い切りがあれば賭けとして認める", () => {
  assert.equal(hasAssertion("欲しかったのは休みではなかったと思う"), true);
  assert.equal(hasAssertion("あなたが手放せずにいるのは自分の立ち方なんじゃないか"), true);
});

test("逃げ語だけで終わる文章は賭けとして認めない", () => {
  assert.equal(hasAssertion("あなたは過去を振り返る人なのかもしれません"), false);
  assert.equal(hasAssertion("そういう気がします"), false);
});

test("逃げ語を検出できる", () => {
  assert.ok(hedgeHits("そうなのかもしれません").length >= 1);
});

test("デコイは順番に取り出せる", () => {
  assert.equal(decoyFor(0), DECOYS[0]);
  assert.equal(decoyFor(DECOYS.length), DECOYS[0]);
});
