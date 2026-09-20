import { test } from "node:test";
import assert from "node:assert/strict";
import { isComplete, rollup, THRESHOLDS } from "../lib/reading/blind.ts";
import type { RatingRow } from "../lib/reading/blind.ts";

function row(kind: RatingRow["kind"], verdict: RatingRow["verdict"], i = 0): RatingRow {
  return { sessionId: `s${i}`, slot: "A", kind, verdict };
}

test("回答が揃うまでは完了にしない", () => {
  assert.equal(isComplete([row("open_bet", null)]), false);
  assert.equal(isComplete([row("open_bet", "sees")]), true);
  assert.equal(isComplete([]), false);
});

test("Open Bet は『そこを見る？』か『自分にしか』で当たりとする", () => {
  const r = rollup([
    row("open_bet", "sees", 1),
    row("open_bet", "only_me", 2),
    row("open_bet", "generic", 3),
    row("open_bet", "generic", 4),
  ]);
  assert.equal(r.openBetHitRate, 0.5);
});

test("デコイを見抜けていなければ、評価は成立していないと判定する", () => {
  const bad = rollup([
    row("decoy", "generic", 1),
    row("decoy", "sees", 2),
    row("open_bet", "sees", 3),
  ]);
  assert.equal(bad.decoyCaughtRate, 0.5);
  assert.equal(bad.calibrationOk, false, "0.8未満なら評価そのものが成立していない");

  const good = rollup([
    row("decoy", "generic", 1),
    row("decoy", "generic", 2),
    row("decoy", "generic", 3),
    row("decoy", "generic", 4),
    row("decoy", "sees", 5),
  ]);
  assert.equal(good.calibrationOk, true);
  assert.ok(good.decoyCaughtRate! >= THRESHOLDS.decoyCaught);
});

test("未回答は率の計算から除く", () => {
  const r = rollup([row("open_bet", "sees", 1), row("open_bet", null, 2)]);
  assert.equal(r.openBetHitRate, 1);
  assert.equal(r.rated, 1);
  assert.equal(r.total, 2);
});

test("1件も回答が無ければ率は null（0%と区別する）", () => {
  const r = rollup([row("open_bet", null)]);
  assert.equal(r.openBetHitRate, null);
  assert.equal(r.calibrationOk, false);
});
