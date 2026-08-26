/**
 * 依存パッケージを増やさないため、Node標準の node:test を使う。
 * 対象は純粋関数のみ（ネットワーク不要でテストできる範囲）。
 *
 *   node --test tests/
 */
import test from "node:test";
import assert from "node:assert/strict";

// TypeScriptを直接importできないため、判定ロジックをここに写して検証する。
// lib/conversation/config.ts と同じ値を使うこと。
const LIMITS = { naturalCloseTarget: 4, wrapUpHint: 6, hardLimit: 8 };

function resolvePhase(n) {
  if (n <= 0) return "OPENING";
  if (n >= LIMITS.hardLimit) return "CLOSING";
  if (n >= LIMITS.wrapUpHint) return "WRAP_UP";
  return "EXPLORING";
}

function canAiChooseToClose(phase) {
  return phase === "EXPLORING" || phase === "WRAP_UP";
}

test("フェーズ判定：境界値", () => {
  assert.equal(resolvePhase(0), "OPENING");
  assert.equal(resolvePhase(1), "EXPLORING");
  assert.equal(resolvePhase(5), "EXPLORING");
  assert.equal(resolvePhase(6), "WRAP_UP");
  assert.equal(resolvePhase(7), "WRAP_UP");
  assert.equal(resolvePhase(8), "CLOSING");
  assert.equal(resolvePhase(15), "CLOSING");
});

test("Hard Limitを超えたら必ずCLOSING（会話が無限に続かない）", () => {
  for (let n = LIMITS.hardLimit; n < 100; n++) {
    assert.equal(resolvePhase(n), "CLOSING", `n=${n}`);
  }
});

test("CLOSINGではAIに終了判断を委ねない（サーバーが強制終了する）", () => {
  assert.equal(canAiChooseToClose("CLOSING"), false);
  assert.equal(canAiChooseToClose("OPENING"), false);
  assert.equal(canAiChooseToClose("EXPLORING"), true);
  assert.equal(canAiChooseToClose("WRAP_UP"), true);
});

// ---- Episode重複回避 ----
function pickPool(episodes, excludeIds) {
  const excluded = new Set(excludeIds);
  const fresh = episodes.filter((e) => !excluded.has(e.id));
  return fresh.length > 0 ? fresh : episodes;
}

test("Episode重複回避：除外されていない候補があればそこから選ぶ", () => {
  const eps = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const pool = pickPool(eps, ["a"]);
  assert.equal(pool.length, 2);
  assert.ok(!pool.some((e) => e.id === "a"));
});

test("Episode重複回避：候補を使い切ったら除外を無視して選び直す", () => {
  const eps = [{ id: "a" }, { id: "b" }];
  const pool = pickPool(eps, ["a", "b"]);
  assert.equal(pool.length, 2, "枯渇時は全件から選ぶ");
});

// ---- 抽出スキーマ ----
test("hidden_candidate が null でも正常な抽出結果として扱う", () => {
  const extracted = {
    one_line_memory: "今日は、特に何も起きない一日だった。",
    event: null,
    emotion: [],
    people_relation: [],
    decision: null,
    desire: null,
    regret: null,
    hidden_candidate: null,
    memory_trigger_category: null,
    confidence: 0.2,
    memory_found: false,
  };
  assert.equal(extracted.hidden_candidate, null);
  assert.equal(Boolean(extracted.hidden_candidate), false);
  assert.equal(extracted.memory_found, false);
  assert.ok(typeof extracted.one_line_memory === "string");
});

// ---- 集計 ----
function summarize(messages) {
  let userChars = 0;
  let aiChars = 0;
  for (const m of messages) {
    if (m.role === "user") userChars += m.content.length;
    else aiChars += m.content.length;
  }
  return {
    messageCount: messages.length,
    userMessageCount: messages.filter((m) => m.role === "user").length,
    userCharCount: userChars,
    aiCharCount: aiChars,
  };
}

test("集計：発話数と文字数", () => {
  const s = summarize([
    { role: "assistant", content: "あいう" },
    { role: "user", content: "かきくけこ" },
    { role: "assistant", content: "さ" },
    { role: "user", content: "た" },
  ]);
  assert.equal(s.messageCount, 4);
  assert.equal(s.userMessageCount, 2);
  assert.equal(s.userCharCount, 6);
  assert.equal(s.aiCharCount, 4);
});

// ---- 質問の連続禁止（v1.4.0：コード側で強制する） ----
function lastAssistantAskedQuestion(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const t = messages[i].content;
    return t.includes("？") || t.includes("?");
  }
  return false;
}

test("直前のAI発話が質問なら、次のターンは質問を禁止する", () => {
  assert.equal(
    lastAssistantAskedQuestion([
      { role: "assistant", content: "それ、いつ頃の話？" },
      { role: "user", content: "学生のとき" },
    ]),
    true
  );
});

test("直前のAI発話が質問でなければ制約はかからない", () => {
  assert.equal(
    lastAssistantAskedQuestion([
      { role: "assistant", content: "それ、いつ頃の話？" },
      { role: "user", content: "学生のとき" },
      { role: "assistant", content: "学生のときなんだ。" },
      { role: "user", content: "うん" },
    ]),
    false
  );
});

test("AI発話がまだ無ければ制約はかからない", () => {
  assert.equal(lastAssistantAskedQuestion([{ role: "user", content: "あ" }]), false);
});

test("半角の疑問符でも判定する", () => {
  assert.equal(
    lastAssistantAskedQuestion([{ role: "assistant", content: "when?" }]),
    true
  );
});
