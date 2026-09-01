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

// ---- 質問のガード（v1.5.1：Deep Dive を潰さない形に作り直した） ----
/*
 * v1.5.0 までの判定は「直前のAI発話に？が含まれるか」だけだった。
 * Episodeの結びは必ず「〜ある？」で終わるため、AIは1回目の応答で
 * 必ず質問を禁止されていた。平均往復数が2.4なので、多くの会話で
 * AIは一度も質問できないまま終わっていた。
 */
const MAX_CONSECUTIVE_QUESTIONS = 2;

function isThinAgreement(text) {
  const t = text.trim();
  if (t.length > 10) return false;
  return /^(うん+|ええ|はい|そう(だね|ですね|そう)?|わかる|分かる|確かに|たしかに|なるほど|そっか|そうかも|だね|ですね|了解|オーケー|オッケー|ok|OK|w+|笑)[。、．，！!？?\s]*$/.test(t);
}

function userAddedMaterial(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const t = messages[i].content.trim();
    return t.length >= 6 && !isThinAgreement(t);
  }
  return false;
}

function trailingAssistantQuestionTurns(messages) {
  const firstAssistant = messages.findIndex((m) => m.role === "assistant");
  let count = 0;
  for (let i = messages.length - 1; i > firstAssistant; i--) {
    if (messages[i].role !== "assistant") continue;
    const t = messages[i].content;
    if (t.includes("？") || t.includes("?")) count += 1;
    else break;
  }
  return count;
}

function shouldBlockQuestion(messages) {
  const trailing = trailingAssistantQuestionTurns(messages);
  if (trailing === 0) return false;
  if (trailing >= MAX_CONSECUTIVE_QUESTIONS) return true;
  return !userAddedMaterial(messages);
}

const EPISODE = {
  role: "assistant",
  content:
    "こんな話を聞いてさ。昔は朝まで遊べたのに、最近は二十三時で眠くなる人がいるって。最近、自分が変わったなと思うことある？",
};

test("冒頭Episodeの「？」でAIの1回目の質問を潰さない（v1.5.0のバグ）", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "ある。マジで徹夜すると翌日に響く。昔のようにはいかない。" },
  ];
  assert.equal(trailingAssistantQuestionTurns(msgs), 0, "Episodeは数えない");
  assert.equal(shouldBlockQuestion(msgs), false, "1回目は質問できなければならない");
});

test("材料が出ている間は、続けて質問してよい（Deep Dive）", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "わかる。徹夜すると翌日に響く。" },
    { role: "assistant", content: "昔って、最高どれくらい起きてられた？" },
    { role: "user", content: "25〜26時間かな。そのまま仕事行ったりしてた。" },
  ];
  assert.equal(trailingAssistantQuestionTurns(msgs), 1);
  assert.equal(shouldBlockQuestion(msgs), false);
});

test("3回続けては聞けない（尋問に戻らない）", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "わかる。徹夜すると翌日に響く。" },
    { role: "assistant", content: "昔って、最高どれくらい起きてられた？" },
    { role: "user", content: "25〜26時間かな。そのまま仕事行ったりしてた。" },
    { role: "assistant", content: "え、その間ずっと何してたの？" },
    { role: "user", content: "友達と朝5時まで飲んで、そのまま仕事行ってた。" },
  ];
  assert.equal(trailingAssistantQuestionTurns(msgs), 2);
  assert.equal(shouldBlockQuestion(msgs), true, "2回聞いたら止める");
});

test("相槌しか返っていないなら、質問を重ねない", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "ある。徹夜すると翌日に響く。" },
    { role: "assistant", content: "昔って、最高どれくらい起きてられた？" },
    { role: "user", content: "うん" },
  ];
  assert.equal(shouldBlockQuestion(msgs), true);
});

test("質問しないターンのあとは、また質問できる", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "ある。徹夜すると翌日に響く。" },
    { role: "assistant", content: "徹夜が響くようになったんだね。" },
    { role: "user", content: "そうそう、昔は平気だったのに。" },
  ];
  assert.equal(trailingAssistantQuestionTurns(msgs), 0);
  assert.equal(shouldBlockQuestion(msgs), false);
});

test("相槌の判定：新しい材料を含むものは相槌ではない", () => {
  assert.equal(isThinAgreement("うん"), true);
  assert.equal(isThinAgreement("そうだね。"), true);
  assert.equal(isThinAgreement("わかる"), true);
  assert.equal(isThinAgreement("確かに！"), true);
  assert.equal(isThinAgreement("うん、朝5時まで飲んでた"), false);
  assert.equal(isThinAgreement("25時間くらいかな"), false);
});

test("AI発話がまだ無ければ制約はかからない", () => {
  assert.equal(shouldBlockQuestion([{ role: "user", content: "あ" }]), false);
});

test("半角の疑問符でも数える", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "ある。徹夜すると響く。" },
    { role: "assistant", content: "how long?" },
    { role: "user", content: "うん" },
  ];
  assert.equal(trailingAssistantQuestionTurns(msgs), 1);
  assert.equal(shouldBlockQuestion(msgs), true, "相槌なので止める");
});

// ---- 記憶が出た直後の締めに、受け取りの指示が入るか（v1.5.1） ----
/*
 * 「記憶が出た瞬間に回収して終わる」体験を防ぐための判定。
 * 直前のユーザー発話が材料を含んでいれば、CLOSING に
 * 「まず受け取ってから終える」指示を足す。
 */
test("具体的な場面が語られた直後の締めでは、受け取りの指示を足す", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "わかる。徹夜すると翌日に響く。" },
    { role: "assistant", content: "昔って、最高どれくらい起きてられた？" },
    { role: "user", content: "友達と朝5時まで飲んで、そのまま仕事行ってた。" },
  ];
  assert.equal(userAddedMaterial(msgs), true, "受け取りの指示が入る条件");
});

test("相槌で終わる会話では、受け取りの指示は足さない", () => {
  const msgs = [
    EPISODE,
    { role: "user", content: "特にないかな。" },
    { role: "assistant", content: "そっか。何も出てこない日もあるしね。" },
    { role: "user", content: "うん" },
  ];
  assert.equal(userAddedMaterial(msgs), false, "受け取る具体物が無い");
});
