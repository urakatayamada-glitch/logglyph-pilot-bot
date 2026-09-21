import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForm, assertsGender, leaksInternalId } from "../lib/reading/form.ts";
import { hasAssertion } from "../lib/reading/barnum.ts";
import { checkAnchors } from "../lib/reading/grounding.ts";
import type { ReadingInput } from "../lib/reading/types.ts";

/*
 * reading-v2 の回帰テスト。
 * 第1回 Benchmark で実際に出た「形」を固定する（参加者の記憶は含めず、型だけを残す）。
 */

test("回帰 v1：地の文の断定は『言い切っている』と判定する", () => {
  // v1 はこれらを「言い切っていない」として55件落としていた
  assert.equal(hasAssertion("この人は言葉に特別な重きを置いている。"), true);
  assert.equal(hasAssertion("それは直感で動いた結果である。"), true);
  assert.equal(hasAssertion("忘れていた、と言ったけれど、いまそれを話している。"), true);
});

test("逃げ語だけの文章は、賭けとして認めない", () => {
  assert.equal(hasAssertion("そういう人なのかもしれません。そんな気がします。"), false);
  assert.equal(hasAssertion("影響を受けている可能性がある。そう考えられる。"), false);
});

test("人物評は落ちる", () => {
  for (const t of [
    "この人は感受性豊かな人である。",
    "逆境で燃えるタイプである。",
    "直感に基づいて行動する傾向が強い。",
    "冷静さと成熟した思考を持っている。",
  ]) {
    assert.equal(checkForm(t).violation, "person_verdict", t);
  }
});

test("心理診断は落ちる", () => {
  assert.equal(checkForm("それは防衛機制の一環である。").violation, "diagnosis");
  assert.equal(checkForm("承認欲求が満たされていない。").violation, "diagnosis");
});

test("助言は落ちる", () => {
  assert.equal(checkForm("次に進むためのサポートがいる。").violation, "advice");
  assert.equal(checkForm("自分を認める必要がある。").violation, "advice");
});

test("性別の断定は落ちる（シーンで直した不具合と同じ種類）", () => {
  assert.equal(assertsGender("彼にとって、それは特別だった。"), true);
  assert.equal(assertsGender("彼女はそう言った。"), true);
  assert.equal(checkForm("彼は言葉を選んだ。").violation, "gender_assertion");
  assert.equal(assertsGender("あなたはそう言った。"), false);
});

test("内部IDの混入は落ちる", () => {
  assert.equal(leaksInternalId("s2から、背徳感が残っている。"), true);
  assert.equal(leaksInternalId("(s1)を見ると"), true);
  assert.equal(leaksInternalId("sushi を食べた"), false);
  assert.equal(leaksInternalId("3日引きずった"), false);
});

test("手書きで通った Reading は、形の検査を通る", () => {
  const good = [
    "忘れていた、と言ったけれど、いまそれを話している。",
    "私が振ったのは人との別れの話だったのに、返ってきたのは人ではなくスーツだった。手放せずにいるのは、あのスーツを着ていたときの自分の立ち方なんじゃないかと思う。",
    "やめることではなく、始めることのほうが定期的に起きている。続かないのではなく、何度でも始め直している。",
  ];
  for (const t of good) {
    assert.equal(checkForm(t).violation, null, t);
    assert.equal(hasAssertion(t), true, t);
  }
});

const input: ReadingInput = {
  sessionId: "x",
  trigger: "別れた人からもらったものを、引き出しに入れたままの人がいて。捨てられないままの物って、何かある？",
  category: "romance",
  isInternal: false,
  turns: [
    { role: "user", content: "昔ベンチャーに勤めてた頃のスーツが捨てられないんだよね" },
    { role: "user", content: "今は着る予定もないのに置いてある" },
  ],
};

test("anchor：振った話と本人の発言の組は通る", () => {
  assert.equal(
    checkAnchors(
      { anchorASource: "trigger", anchorA: "別れた人からもらったもの", anchorB: "スーツが捨てられない" },
      input
    ),
    "ok"
  );
});

test("anchor：本人の発言同士の組は通る", () => {
  assert.equal(
    checkAnchors(
      { anchorASource: "person", anchorA: "スーツが捨てられない", anchorB: "着る予定もないのに置いてある" },
      input
    ),
    "ok"
  );
});

test("anchor：実在しない引用は接地しない", () => {
  assert.equal(
    checkAnchors(
      { anchorASource: "person", anchorA: "父に買ってもらった", anchorB: "スーツが捨てられない" },
      input
    ),
    "ungrounded"
  );
});

test("anchor：同じ箇所を2回指すと『間』が無い", () => {
  assert.equal(
    checkAnchors(
      { anchorASource: "person", anchorA: "スーツが捨てられない", anchorB: "スーツが捨てられないんだよね" },
      input
    ),
    "no_gap"
  );
});

test("anchor：欄が空なら『間』が無い", () => {
  assert.equal(checkAnchors({ anchorASource: "person", anchorA: "", anchorB: "" }, input), "no_gap");
});
