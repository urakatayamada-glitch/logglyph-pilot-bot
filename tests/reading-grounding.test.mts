import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isGrounded,
  normalizeForMatch,
  userCorpus,
  groundSignals,
  MIN_QUOTE_CHARS,
} from "../lib/reading/grounding.ts";
import type { ReadingInput, Signal } from "../lib/reading/types.ts";

const input: ReadingInput = {
  sessionId: "s1",
  trigger: "人との別れで、いまも引っかかっていることはある？",
  category: "romance",
  isInternal: false,
  turns: [
    { role: "assistant", content: "別れの話で、残っていることはある？" },
    { role: "user", content: "昔ベンチャーに勤めてた頃のスーツが捨てられないんだよね" },
    { role: "assistant", content: "そのスーツはどんなときに着てた？" },
    { role: "user", content: "営業で毎日着てた。今は着る予定もないのに置いてある" },
  ],
};

test("本人の発話にある引用は接地する", () => {
  assert.equal(isGrounded("スーツが捨てられない", userCorpus(input)), true);
});

test("AIの発話からの引用は接地しない", () => {
  assert.equal(isGrounded("どんなときに着てた", userCorpus(input)), false);
});

test("捏造した引用は接地しない", () => {
  assert.equal(isGrounded("父に買ってもらったスーツ", userCorpus(input)), false);
});

test("助詞を変えただけの引用も接地しない（正規化を緩めない）", () => {
  // 「スーツは捨てられない」は本人の発話に無い（本人は「スーツが」と言っている）
  assert.equal(isGrounded("スーツは捨てられない", userCorpus(input)), false);
});

test("短すぎる引用は根拠にしない", () => {
  const short = "スーツ";
  assert.ok(short.length < MIN_QUOTE_CHARS);
  assert.equal(isGrounded(short, userCorpus(input)), false);
});

test("全角半角と空白の違いは吸収する", () => {
  assert.equal(normalizeForMatch("ベンチャー に　勤めてた"), "ベンチャーに勤めてた");
  assert.equal(isGrounded("ベンチャー に 勤めてた", userCorpus(input)), true);
});

test("接地したものとしていないものに分かれる", () => {
  const signals: Signal[] = [
    { id: "s1", kind: "residue", quote: "スーツが捨てられない", turn: 1, note: "" },
    { id: "s2", kind: "content", quote: "父に買ってもらった", turn: 1, note: "" },
  ];
  const { grounded, ungrounded } = groundSignals(signals, input);
  assert.equal(grounded.length, 1);
  assert.equal(grounded[0].id, "s1");
  assert.equal(ungrounded.length, 1);
});
