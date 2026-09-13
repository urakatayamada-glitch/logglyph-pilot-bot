/**
 * プロフィール（profile_v1）の純関数テスト。
 *
 * ⚠ lib/profile.ts / lib/found.ts を直接 import する。ロジックを写さない。
 *   node --test --experimental-strip-types tests/profile.test.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  AGE_BANDS,
  MOTIVES,
  STATES,
  REFLECT_HABITS,
  axisKeys,
  axisLabel,
  axisOrder,
  emptyAnswers,
  hasAnyAnswer,
  profileGroup,
  sanitizeAnswers,
} from "../lib/profile.ts";
// ⚠ 型は import type で取ること。値として import すると
//   strip-types のローダーが実体を探して落ちる。
import type { ProfileRow } from "../lib/profile.ts";
import {
  cohortFunnels,
  personOutcomes,
  variantFunnels,
} from "../lib/found.ts";

/* ============================================================
   受け取った値の検証
   ============================================================ */

test("sanitizeAnswers : 知らない値は捨て、捨てた件数を返す", () => {
  const { answers, dropped } = sanitizeAnswers({
    ageBand: "80s",
    gender: "male",
    states: ["career", "not_a_state", "milestone"],
    motives: ["nope"],
    reflectHabit: "sometimes",
  });
  assert.equal(answers.ageBand, null);
  assert.equal(answers.gender, "male");
  assert.deepEqual(answers.states, ["career", "milestone"]);
  assert.deepEqual(answers.motives, []);
  assert.equal(answers.reflectHabit, "sometimes");
  // ⚠ 黙って捨てない。捨てた事実が数えられること
  assert.equal(dropped, 3);
});

test("sanitizeAnswers : 同じ選択肢を重ねて送られても1回だけ数える", () => {
  const { answers } = sanitizeAnswers({ states: ["career", "career", "career"] });
  assert.deepEqual(answers.states, ["career"]);
});

test("sanitizeAnswers : 空・不正な形でも落ちない", () => {
  for (const input of [null, undefined, 0, "x", [], { states: "career" }]) {
    const { answers } = sanitizeAnswers(input);
    assert.equal(hasAnyAnswer(answers), false);
  }
});

test("hasAnyAnswer : 1つでも答えていれば true", () => {
  assert.equal(hasAnyAnswer(emptyAnswers()), false);
  assert.equal(hasAnyAnswer({ ...emptyAnswers(), states: ["career"] }), true);
  assert.equal(hasAnyAnswer({ ...emptyAnswers(), gender: "no_answer" }), true);
});

test("全選択肢に日本語ラベルがある（コードがそのまま画面に出ない）", () => {
  for (const k of STATES) assert.notEqual(axisLabel("state", k), k);
  for (const k of MOTIVES) assert.notEqual(axisLabel("motive", k), k);
  for (const k of REFLECT_HABITS) assert.notEqual(axisLabel("reflect", k), k);
  for (const k of AGE_BANDS) assert.notEqual(axisLabel("age", k), k);
});

test("表示順は選択肢の定義順（回答数順にすると毎回並びが変わる）", () => {
  assert.deepEqual([...axisOrder("state")], [...STATES]);
  assert.deepEqual([...axisOrder("motive")], [...MOTIVES]);
});

/* ============================================================
   3群の判定
   ============================================================ */

const row = (over: Partial<ProfileRow> = {}): ProfileRow => ({
  client_token: "t",
  age_band: null,
  gender: null,
  states: null,
  motives: null,
  reflect_habit: null,
  answered: false,
  ...over,
});

test("profileGroup : 行が無ければ未表示、あって未回答ならスキップ", () => {
  assert.equal(profileGroup(undefined), "not_shown");
  assert.equal(profileGroup(row({ answered: false })), "declined");
  assert.equal(profileGroup(row({ answered: true })), "answered");
});

test("axisKeys : 未回答の軸は空を返す（どの行にも入らない）", () => {
  assert.deepEqual(axisKeys("state", row()), []);
  assert.deepEqual(axisKeys("state", undefined), []);
  assert.deepEqual(
    axisKeys("state", row({ states: ["career", "bogus", "milestone"] })),
    ["career", "milestone"]
  );
});

/* ============================================================
   集計（1人1回・複数選択・Next-Day の定義）
   ============================================================ */

const S = (
  session_id: string,
  client_token: string,
  started_at: string,
  over: Partial<{
    completed_at: string | null;
    memory_found: boolean;
    experience_variant: string | null;
  }> = {}
) => ({
  session_id,
  client_token,
  started_at,
  completed_at: over.completed_at ?? started_at,
  memory_found: over.memory_found ?? false,
  experience_variant: over.experience_variant ?? "story_preview_v1",
});

const base = {
  receiptSessionIds: [],
  storySessionIds: [],
  internalTokens: [],
  includeInternal: false,
};

test("personOutcomes : Next-Day は JST の日付で判定する（経過時間ではない）", () => {
  // 23:50 JST → 翌 00:10 JST。経過20分でも「翌日」
  const people = personOutcomes({
    sessions: [
      S("s1", "a", "2026-09-10T14:50:00Z", { memory_found: true }),
      S("s2", "a", "2026-09-10T15:10:00Z"),
    ],
    ...base,
  });
  assert.equal(people.length, 1);
  assert.equal(people[0].nextDayReturn, true);
  assert.equal(people[0].sameDayContinuation, false);
});

test("personOutcomes : 同じ日に続けただけは Next-Day にしない", () => {
  const people = personOutcomes({
    sessions: [
      S("s1", "a", "2026-09-10T02:00:00Z", { memory_found: true }),
      S("s2", "a", "2026-09-10T03:00:00Z"),
    ],
    ...base,
  });
  assert.equal(people[0].nextDayReturn, false);
  assert.equal(people[0].sameDayContinuation, true);
});

test("personOutcomes : 複数日に跨れば activeDays が 2 以上になる", () => {
  const people = personOutcomes({
    sessions: [
      S("s1", "a", "2026-09-10T02:00:00Z", { memory_found: true }),
      S("s2", "a", "2026-09-11T02:00:00Z"),
    ],
    ...base,
  });
  assert.equal(people[0].activeDays, 2);
});

test("personOutcomes : 運営テストと削除済みトークンを除く", () => {
  const people = personOutcomes({
    sessions: [
      S("s1", "ops", "2026-09-10T02:00:00Z"),
      S("s2", "deleted:00000000-0000-4000-8000-000000000000", "2026-09-10T02:00:00Z"),
      S("s3", "real", "2026-09-10T02:00:00Z"),
    ],
    ...base,
    internalTokens: ["ops"],
  });
  assert.deepEqual(people.map((p) => p.clientToken), ["real"]);
});

test("cohortFunnels : 複数選択では1人が複数行に入り、合計は人数と一致しない", () => {
  const people = personOutcomes({
    sessions: [S("s1", "a", "2026-09-10T02:00:00Z", { memory_found: true })],
    ...base,
  });
  const profiles = new Map<string, ProfileRow>([
    ["a", row({ client_token: "a", answered: true, states: ["career", "milestone"] })],
  ]);
  const f = cohortFunnels(people, (p) => axisKeys("state", profiles.get(p.clientToken)));
  assert.equal(f.career.people, 1);
  assert.equal(f.milestone.people, 1);
  // 合計2 だが実人数は1。だから n の併記が必須
  assert.equal(f.career.people + f.milestone.people, 2);
  assert.equal(people.length, 1);
});

test("cohortFunnels : 未回答の人はどの行にも入らない", () => {
  const people = personOutcomes({
    sessions: [S("s1", "a", "2026-09-10T02:00:00Z")],
    ...base,
  });
  const f = cohortFunnels(people, (p) => axisKeys("state", undefined));
  assert.deepEqual(Object.keys(f), []);
});

test("3群は重複せず、合計がちょうど対象人数になる", () => {
  const people = personOutcomes({
    sessions: [
      S("s1", "a", "2026-09-10T02:00:00Z"),
      S("s2", "b", "2026-09-10T02:00:00Z"),
      S("s3", "c", "2026-09-10T02:00:00Z"),
    ],
    ...base,
  });
  const profiles = new Map<string, ProfileRow>([
    ["a", row({ client_token: "a", answered: true })],
    ["b", row({ client_token: "b", answered: false })],
  ]);
  const f = cohortFunnels(people, (p) => [profileGroup(profiles.get(p.clientToken))]);
  assert.equal(f.answered.people, 1);
  assert.equal(f.declined.people, 1);
  assert.equal(f.not_shown.people, 1);
  assert.equal(
    f.answered.people + f.declined.people + f.not_shown.people,
    people.length
  );
});

test("variantFunnels は personOutcomes と同じ数字を返す（回帰）", () => {
  const sessions = [
    S("s1", "a", "2026-09-10T02:00:00Z", { memory_found: true }),
    S("s2", "a", "2026-09-11T02:00:00Z", { memory_found: true }),
    S("s3", "b", "2026-09-10T02:00:00Z", { experience_variant: "baseline" }),
  ];
  const v = variantFunnels({ sessions, ...base });
  assert.equal(v.story_preview_v1.people, 1);
  assert.equal(v.story_preview_v1.nextDayReturn, 1);
  assert.equal(v.story_preview_v1.newMemoryFound, 1);
  assert.equal(v.story_preview_v1.multiDay, 1);
  assert.equal(v.baseline.people, 1);
  assert.equal(v.baseline.nextDayReturn, 0);
});
