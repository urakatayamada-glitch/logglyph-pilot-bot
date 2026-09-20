import { test } from "node:test";
import assert from "node:assert/strict";
import { purgeSessionsFromResults } from "../lib/reading/purge.ts";
import type { SessionResult } from "../lib/reading/types.ts";

function res(sessionId: string): SessionResult {
  return {
    input: { sessionId, trigger: "t", category: null, turns: [], isInternal: false },
    signals: [{ id: "s1", kind: "residue", quote: "本人の発話そのもの", turn: 1, note: "" }],
    evaluated: [],
    openBet: null,
  };
}

test("削除された人の結果は残さない", () => {
  const { kept, removed } = purgeSessionsFromResults([res("a"), res("b"), res("c")], ["b"]);
  assert.equal(removed, 1);
  assert.deepEqual(kept.map((r) => r.input.sessionId), ["a", "c"]);
});

test("引用が1つも残らないことを確かめる", () => {
  const { kept } = purgeSessionsFromResults([res("a")], ["a"]);
  const quotes = kept.flatMap((r) => r.signals.map((s) => s.quote));
  assert.deepEqual(quotes, []);
});

test("該当が無ければ何も変えない", () => {
  const { kept, removed } = purgeSessionsFromResults([res("a")], ["z"]);
  assert.equal(removed, 0);
  assert.equal(kept.length, 1);
});
