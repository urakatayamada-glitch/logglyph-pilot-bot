/**
 * おうむ返し検出のテスト（v1.6.0）。
 *
 * ⚠ 実機で「萎えた」と言われた発話をそのまま残してある。短くしないこと。
 *   node --test --experimental-strip-types tests/echo.test.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ECHO_THRESHOLD,
  echoRatio,
  firstSentence,
  isEcho,
  lastUserText,
  previousTurnEchoed,
} from "../lib/echo.ts";

/* 2026-09-15 に実ユーザーが「やや萎えた」と指摘した2発話 */
const USER_1 =
  "実家に里帰りした時にね、なんか私疲れた顔してたみたいで、おじいちゃんが「あんまり頑張るなよ」って言ってくれたの、残ってるなぁー";
const AI_1 =
  "おじいちゃんが「あんまり頑張るなよ」って言ってくれたんだね。里帰りしたときって、どんな感じで過ごしてたの？";
const USER_2 = "ご飯作ってあげたり、それを食べたり、お抹茶飲んだりって感じかなぁ。";
const AI_2 =
  "ご飯作ってあげたり、一緒に食べたり、お抹茶飲んだりしてたんだね。なんかその時間が特別だったんだろうなあ。";

test("実機で萎えさせた2発話を、どちらもなぞりと判定する", () => {
  assert.equal(isEcho(AI_1, USER_1), true);
  assert.equal(isEcho(AI_2, USER_2), true);
});

test("理解を示した言い換えは通す（オーナー案）", () => {
  assert.equal(isEcho("おじいちゃんが、そんなことふと言ってくれたんだね。", USER_1), false);
  assert.equal(
    isEcho(
      "なんかそんな時間が、特別だと感じちゃったんだろうな。気の許せる誰かと一緒に過ごす時間って、やっぱりいいね。",
      USER_2
    ),
    false
  );
});

test("判定は最初の一文で行う（なぞりは冒頭に出る）", () => {
  assert.equal(firstSentence(AI_2), "ご飯作ってあげたり、一緒に食べたり、お抹茶飲んだりしてたんだね。");
  // 冒頭が言い換えなら、後ろに共感が続いても通す
  assert.equal(
    isEcho("そんな一言が残ってるんだね。ご飯作ってあげたりしてたんだ。", USER_2),
    false
  );
});

test("閾値は実測の間に取ってある（感覚で動かさない）", () => {
  assert.ok(echoRatio(AI_1, USER_1) > ECHO_THRESHOLD);
  assert.ok(echoRatio(AI_2, USER_2) > ECHO_THRESHOLD);
  assert.ok(echoRatio("おじいちゃんが、そんなことふと言ってくれたんだね。", USER_1) < ECHO_THRESHOLD);
});

test("空・短すぎる入力で落ちない", () => {
  for (const [a, b] of [["", ""], ["あ", "あ"], ["うん。", ""], ["", "うん"]]) {
    assert.equal(typeof echoRatio(a, b), "number");
  }
});

/* ---------- 2連続の判定 ---------- */

test("previousTurnEchoed : 直前のAI発話がなぞっていれば true", () => {
  const messages = [
    { role: "assistant", content: "この前聞いてさ。…妙に残ってる一言ってある？" },
    { role: "user", content: USER_1 },
    { role: "assistant", content: AI_1 },
    { role: "user", content: USER_2 },
  ];
  assert.equal(previousTurnEchoed(messages), true);
});

test("previousTurnEchoed : 直前が言い換えなら false（1回目は止めない）", () => {
  const messages = [
    { role: "user", content: USER_1 },
    { role: "assistant", content: "おじいちゃんが、そんなことふと言ってくれたんだね。" },
    { role: "user", content: USER_2 },
  ];
  assert.equal(previousTurnEchoed(messages), false);
});

test("previousTurnEchoed : AI発話が無いときは false", () => {
  assert.equal(previousTurnEchoed([{ role: "user", content: USER_1 }]), false);
  assert.equal(previousTurnEchoed([]), false);
});

test("lastUserText : 直近のユーザー発話を返す", () => {
  assert.equal(
    lastUserText([
      { role: "user", content: "あ" },
      { role: "assistant", content: "い" },
      { role: "user", content: "う" },
    ]),
    "う"
  );
  assert.equal(lastUserText([{ role: "assistant", content: "い" }]), "");
});
