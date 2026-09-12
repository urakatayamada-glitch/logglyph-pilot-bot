/**
 * Story Preview の純関数テスト。
 *
 * ⚠ lib/story.ts を直接 import している。ロジックを写さない。
 *   node --test --experimental-strip-types tests/story.test.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_LABELS,
  CATEGORY_SLOTS,
  NARRATIVE_CATEGORIES,
  changedCategories,
  checkFragment,
  emptyScores,
  isNarrativeCategory,
  missingSlots,
  neededCategories,
  factLines,
  preferredPool,
  scoreFacets,
  unknownLines,
  transcript,
  userText,
} from "../lib/story.ts";

test("カテゴリ定義：5つ、全部に日本語ラベルとスロットがある", () => {
  assert.equal(NARRATIVE_CATEGORIES.length, 5);
  for (const c of NARRATIVE_CATEGORIES) {
    assert.ok(CATEGORY_LABELS[c], `${c} にラベルがない`);
    assert.ok(CATEGORY_SLOTS[c].length > 0, `${c} にスロットがない`);
    // 「まだ見えていないもの」はそのまま画面に出すので、必ず文になっていること
    for (const d of CATEGORY_SLOTS[c]) {
      assert.ok(d.missing.length > 5, `${c}.${d.slot} の missing が短すぎる`);
    }
  }
});

test("ユーザー画面に英語のカテゴリ名を出さない（ラベルが日本語）", () => {
  for (const c of NARRATIVE_CATEGORIES) {
    assert.ok(
      /[ぁ-んァ-ヶ一-龠・]/.test(CATEGORY_LABELS[c]),
      `${c} のラベルが日本語でない`
    );
  }
});

/* ---------- ％の算出 ---------- */

test("会話回数では％が増えない。同じスロットを何度埋めても動かない", () => {
  const once = scoreFacets([{ category: "setting", slot: "where" }]);
  const many = scoreFacets([
    { category: "setting", slot: "where" },
    { category: "setting", slot: "where" },
    { category: "setting", slot: "where" },
    { category: "setting", slot: "where" },
  ]);
  assert.deepEqual(once.scores, many.scores, "同じ種類が増えても％は同じ");
  assert.equal(once.scores.setting, 33);
});

test("新しい種類のスロットが埋まったときだけ増える", () => {
  const a = scoreFacets([{ category: "setting", slot: "where" }]);
  const b = scoreFacets([
    { category: "setting", slot: "where" },
    { category: "setting", slot: "when" },
  ]);
  assert.equal(a.scores.setting, 33);
  assert.equal(b.scores.setting, 67);
});

test("場所の話ばかりしても、他のカテゴリは増えない", () => {
  const { scores, overall } = scoreFacets([
    { category: "setting", slot: "where" },
    { category: "setting", slot: "when" },
    { category: "setting", slot: "place_kind" },
  ]);
  assert.equal(scores.setting, 100);
  assert.equal(scores.characters, 0);
  assert.equal(scores.aftermath, 0);
  assert.equal(overall, 20, "5カテゴリ中1つ満点なので20%");
});

test("知らないカテゴリ・スロットは％の根拠に混ぜない", () => {
  const { scores } = scoreFacets([
    { category: "setting", slot: "where" },
    { category: "mood", slot: "whatever" },
    { category: "setting", slot: "unknown_slot" },
  ]);
  assert.equal(scores.setting, 33, "未知のスロットは数えない");
});

test("空でも落ちない", () => {
  const { scores, overall } = scoreFacets([]);
  assert.deepEqual(scores, emptyScores());
  assert.equal(overall, 0);
});

test("isNarrativeCategory", () => {
  assert.equal(isNarrativeCategory("self"), true);
  assert.equal(isNarrativeCategory("drama"), false);
  assert.equal(isNarrativeCategory(null), false);
});

/* ---------- 不足 ---------- */

test("missingSlots：埋まっていないものだけ返す", () => {
  const m = missingSlots([
    { category: "setting", slot: "where" },
    { category: "setting", slot: "when" },
  ]);
  const settings = m.filter((x) => x.category === "setting");
  assert.equal(settings.length, 1);
  assert.equal(settings[0].slot, "place_kind");
  assert.equal(m.length, 15 - 2);
});

test("neededCategories：空きが多いカテゴリを先に返す", () => {
  const need = neededCategories([
    { category: "setting", slot: "where" },
    { category: "setting", slot: "when" },
    { category: "setting", slot: "place_kind" },
    { category: "self", slot: "wanted" },
  ]);
  assert.ok(!need.includes("setting"), "満点のカテゴリは返さない");
  assert.equal(need.length, 2);
});

test("changedCategories：増えたものだけ返す", () => {
  const before = { setting: 33, characters: 0, self: 0, events: 0, aftermath: 0 };
  const after = { setting: 67, characters: 0, self: 33, events: 0, aftermath: 0 };
  const ch = changedCategories(before, after);
  assert.equal(ch.length, 2);
  assert.deepEqual(
    ch.find((c) => c.category === "setting"),
    { category: "setting", from: 33, to: 67 }
  );
});

/* ---------- Fragment の検証 ---------- */

const LONG = "あ".repeat(200);

test("checkFragment：長さ", () => {
  assert.equal(checkFragment("短い", "元の話").ok, false);
  assert.equal(checkFragment("あ".repeat(700), "元の話").reason, "too_long");
  assert.equal(checkFragment(LONG, "元の話").ok, true);
});

test("checkFragment：会話に無い数字を足したら通さない", () => {
  const r = checkFragment(`${LONG}1998年のことだった。`, "昔の話をした");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invented_number");
});

test("checkFragment：会話に出てきた数字なら通す", () => {
  const r = checkFragment(`${LONG}1998年のことだった。`, "1998年に入社した");
  assert.equal(r.ok, true);
});

test("checkFragment：断定的な感情語は通さない", () => {
  const r = checkFragment(`${LONG}彼は絶望していた。`, "海を見ていた");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "asserted_emotion");
});

test("checkFragment：断定しない形なら通す", () => {
  const r = checkFragment(
    `${LONG}絶望していたのかもしれない。`,
    "海を見ていた"
  );
  assert.equal(r.ok, true, "「かもしれない」を伴えば断定ではない");
});

/* ---------- Episode の優先抽選 ---------- */

const EPISODES = [
  { id: "a", body: "", category: "x", narrative_categories: ["setting"] },
  { id: "b", body: "", category: "x", narrative_categories: ["characters"] },
  { id: "c", body: "", category: "x", narrative_categories: null },
];

test("preferredPool：不足カテゴリに合うEpisodeだけを候補にする", () => {
  const pool = preferredPool(EPISODES, ["characters"]);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].id, "b");
});

test("preferredPool：該当が無ければ全体から選ぶ（枯渇しない）", () => {
  const pool = preferredPool(EPISODES, ["aftermath"]);
  assert.equal(pool.length, 3);
});

test("preferredPool：不足指定が無ければ従来どおり", () => {
  assert.equal(preferredPool(EPISODES, []).length, 3);
});

test("preferredPool：タグ未設定のEpisodeを優先候補に混ぜない", () => {
  const pool = preferredPool(EPISODES, ["setting"]);
  assert.deepEqual(pool.map((e) => e.id), ["a"]);
});

/* ---------- 生成に渡す「確かなこと」 ---------- */

test("factLines：確定した事実だけを行にする", () => {
  const lines = factLines([
    { category: "events", slot: "happened", value: "AIツールの開発を引き受けた" },
    { category: "setting", slot: "where", value: "" },
  ]);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /出来事・選択/);
  assert.match(lines[0], /AIツールの開発を引き受けた/);
});

test("factLines：空なら1行も出さない（埋めさせない）", () => {
  assert.deepEqual(factLines([]), []);
});

test("unknownLines：確定していない項目を全部並べる", () => {
  const un = unknownLines([
    { category: "events", slot: "happened", value: "開発を引き受けた" },
  ]);
  assert.equal(un.length, 14, "15スロット中1つ埋まっているので14");
  assert.ok(
    un.some((u) => u.includes("どこでのことだったのか")),
    "場所が未確定なら、断定しない項目に入る"
  );
});

test("factLines と unknownLines は重ならない（シーンと不足表示が矛盾しない）", () => {
  const facets = [
    { category: "setting", slot: "where", value: "沖縄の中部" },
    { category: "events", slot: "happened", value: "海に行った" },
  ];
  const known = factLines(facets).join("\n");
  const unknown = unknownLines(facets).join("\n");
  assert.ok(known.includes("沖縄の中部"));
  assert.ok(!unknown.includes("どこでのことだったのか"), "確定した項目は不足に出ない");
  assert.ok(unknown.includes("いつ頃のことだったのか"), "未確定の項目は不足に出る");
});

/* ---------- 抽出に渡す会話の形 ---------- */

test("transcript：AIの発言も話者つきで残す（文脈が消えると拾えない）", () => {
  const t = transcript([
    { role: "assistant", content: "そのスーツって、どんなときに着てたの？" },
    { role: "user", content: "営業だったから、普通に会社に履いていた。" },
  ]);
  assert.match(t, /AI: そのスーツって/);
  assert.match(t, /相手: 営業だったから/);
});

test("userText：本人の発言だけ（こちらは文脈が落ちる）", () => {
  const t = userText([
    { role: "assistant", content: "どんなときに着てたの？" },
    { role: "user", content: "営業だったから。" },
  ]);
  assert.equal(t, "営業だったから。");
  assert.ok(
    !t.includes("どんなとき"),
    "本人の発言だけを抽出に渡すと、何の答えか分からなくなる"
  );
});
