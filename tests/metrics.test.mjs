/**
 * Pilot Metrics の境界値テスト。
 *
 * TypeScriptを直接importできないため、lib/metrics.ts と同じロジックを
 * ここに写して検証する。仕様変更時は両方を更新すること。
 *
 *   node --test tests/metrics.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const SPONTANEOUS_MIN_CHARS = 20;

function hasQuestion(t) {
  return t.includes("？") || t.includes("?");
}

function computeConversationMetrics(messages) {
  let aiMessageCount = 0,
    userMessageCount = 0,
    aiCharCount = 0,
    userCharCount = 0;
  for (const m of messages) {
    if (m.role === "assistant") {
      aiMessageCount++;
      aiCharCount += m.content.length;
    } else {
      userMessageCount++;
      userCharCount += m.content.length;
    }
  }

  let seenFirstAssistant = false;
  let questionTurns = 0,
    questionEligibleTurns = 0;
  let spontaneousContinuations = 0,
    spontaneousOpportunities = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const isEpisode = !seenFirstAssistant;
    seenFirstAssistant = true;
    if (!isEpisode) {
      questionEligibleTurns++;
      if (hasQuestion(m.content)) questionTurns++;
    }
    if (!hasQuestion(m.content)) {
      const next = messages[i + 1];
      if (next && next.role === "user") {
        spontaneousOpportunities++;
        if (next.content.length >= SPONTANEOUS_MIN_CHARS)
          spontaneousContinuations++;
      }
    }
  }

  return {
    aiMessageCount,
    userMessageCount,
    aiCharCount,
    userCharCount,
    aiAvgCharsPerMessage: aiMessageCount > 0 ? aiCharCount / aiMessageCount : null,
    questionTurns,
    questionEligibleTurns,
    questionTurnRate:
      questionEligibleTurns > 0 ? questionTurns / questionEligibleTurns : null,
    spontaneousContinuations,
    spontaneousOpportunities,
    spontaneousContinuationRate:
      spontaneousOpportunities > 0
        ? spontaneousContinuations / spontaneousOpportunities
        : null,
  };
}

const A = (c) => ({ role: "assistant", content: c });
const U = (c) => ({ role: "user", content: c });

test("Question Turn Rate：冒頭のEpisodeは分母から除外する", () => {
  // Episodeは末尾に問いかけを含むが、固定の種なのでAIの振る舞いとして数えない
  const m = computeConversationMetrics([
    A("こんな話を聞いてさ。こういうことある？"), // Episode（除外）
    U("あるかも"),
    A("それ、いつ頃の話？"), // 質問
    U("学生のとき"),
    A("学生のときなんだ。"), // 質問なし
  ]);
  assert.equal(m.questionEligibleTurns, 2);
  assert.equal(m.questionTurns, 1);
  assert.equal(m.questionTurnRate, 0.5);
});

test("Question Turn Rate：半角の疑問符も質問として数える", () => {
  const m = computeConversationMetrics([
    A("Episode?"),
    U("うん"),
    A("いつ?"),
  ]);
  assert.equal(m.questionTurns, 1);
  assert.equal(m.questionEligibleTurns, 1);
});

test("Question Turn Rate：AI発話がEpisodeだけなら算出不能（null）", () => {
  const m = computeConversationMetrics([A("Episodeだけ。ある？")]);
  assert.equal(m.questionEligibleTurns, 0);
  assert.equal(m.questionTurnRate, null);
});

test("Spontaneous Continuation Proxy：閾値の境界（19文字は数えない / 20文字は数える）", () => {
  const short = "あ".repeat(19);
  const exact = "あ".repeat(20);

  const m1 = computeConversationMetrics([
    A("Episode。ある？"),
    U("うん"),
    A("そうなんだ。"), // 質問なし
    U(short),
  ]);
  assert.equal(m1.spontaneousOpportunities, 1);
  assert.equal(m1.spontaneousContinuations, 0);

  const m2 = computeConversationMetrics([
    A("Episode。ある？"),
    U("うん"),
    A("そうなんだ。"),
    U(exact),
  ]);
  assert.equal(m2.spontaneousOpportunities, 1);
  assert.equal(m2.spontaneousContinuations, 1);
  assert.equal(m2.spontaneousContinuationRate, 1);
});

test("Spontaneous Continuation Proxy：質問したターンは機会に数えない", () => {
  const m = computeConversationMetrics([
    A("Episode。ある？"), // 質問あり → 機会にしない
    U("あ".repeat(30)),
  ]);
  assert.equal(m.spontaneousOpportunities, 0);
  assert.equal(m.spontaneousContinuationRate, null);
});

test("Spontaneous Continuation Proxy：AI発話が会話の最後なら機会に数えない", () => {
  const m = computeConversationMetrics([
    A("Episode。ある？"),
    U("うん"),
    A("そうなんだ。"), // 次が無い
  ]);
  assert.equal(m.spontaneousOpportunities, 0);
});

test("AI平均文字数", () => {
  const m = computeConversationMetrics([
    A("あいうえお"), // 5
    U("かき"),
    A("さしす"), // 3
  ]);
  assert.equal(m.aiMessageCount, 2);
  assert.equal(m.aiCharCount, 8);
  assert.equal(m.aiAvgCharsPerMessage, 4);
});

test("空の会話でも例外を出さない", () => {
  const m = computeConversationMetrics([]);
  assert.equal(m.aiAvgCharsPerMessage, null);
  assert.equal(m.questionTurnRate, null);
  assert.equal(m.spontaneousContinuationRate, null);
});
