/**
 * /found と Stage 1 の純関数テスト。
 *
 * ⚠ このファイルは lib/found.ts を「直接 import」している。
 *   既存の *.test.mjs はロジックを写して検証する形になっているが、
 *   それが原因で一度事故が起きた（テスト側の定数が config.ts と乖離し、
 *   テストが自己整合しているせいで乖離そのものが隠れた）。
 *   Node 22 の --experimental-strip-types で TypeScript を直接読めるので、
 *   新しいテストは写さない。今後もこの形を使うこと。
 *
 *   node --test --experimental-strip-types tests/found.test.mts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  isClientToken,
  isValueResponse,
  deletedTokenPlaceholder,
  isDeletedToken,
  jstDateKey,
  countActiveDaysJst,
  splitSilentSessions,
  threeLayerPull,
  minutesToRevisit,
  medianMinutes,
} from "../lib/found.ts";

test("client_token は UUID v4 だけを通す", () => {
  assert.equal(isClientToken("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), true);
  assert.equal(isClientToken(" 3f2504e0-4f89-41d3-9a0c-0305e82c3301 "), true);

  // v4 以外・長さ違い・記号混入・空・非文字列はすべて落とす
  assert.equal(isClientToken("3f2504e0-4f89-11d3-9a0c-0305e82c3301"), false); // version=1
  assert.equal(isClientToken("3f2504e0-4f89-41d3-1a0c-0305e82c3301"), false); // variant不正
  assert.equal(isClientToken("3f2504e0-4f89-41d3-9a0c-0305e82c33"), false);
  assert.equal(isClientToken("' or 1=1 --"), false);
  assert.equal(isClientToken(""), false);
  assert.equal(isClientToken(null), false);
  assert.equal(isClientToken(undefined), false);
  assert.equal(isClientToken(123), false);
  assert.equal(isClientToken({}), false);
});

test("1タップ評価は3値のみ", () => {
  for (const v of ["fit", "off", "unknown"]) assert.equal(isValueResponse(v), true);
  assert.equal(isValueResponse("FIT"), false);
  assert.equal(isValueResponse("good"), false);
  assert.equal(isValueResponse(null), false);
});

test("削除後のトークンは元のトークンを含まない", () => {
  const original = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
  const replaced = deletedTokenPlaceholder(() => "zzzz-random");
  assert.equal(isDeletedToken(replaced), true);
  // 再結合を可能にしてはいけない。元の値の断片が残っていないこと。
  assert.equal(replaced.includes(original), false);
  assert.equal(replaced.includes("3f2504e0"), false);
  // 置換後のトークンは client_token として通らない（/found から読めない）
  assert.equal(isClientToken(replaced), false);
  assert.equal(isDeletedToken("3f2504e0-4f89-41d3-9a0c-0305e82c3301"), false);
  assert.equal(isDeletedToken(null), false);
});

test("日付は JST で数える（UTCで数えると1日ずれる）", () => {
  // 9/3 01:32 JST は UTC では 9/2 16:32。UTC日付で束ねると 9/2 に潰れ、
  // 再訪していた人を見落とす。Wave 1 で実際に危なかったデータ。
  assert.equal(jstDateKey("2026-09-02T16:32:00Z"), "2026-09-03");
  assert.equal(jstDateKey("2026-09-02T10:43:46Z"), "2026-09-02");
  assert.equal(jstDateKey("なんでもない"), "");

  assert.equal(
    countActiveDaysJst(["2026-09-02T10:43:46Z", "2026-09-02T16:32:00Z"]),
    2
  );
  assert.equal(
    countActiveDaysJst(["2026-09-02T10:43:46Z", "2026-09-02T14:36:36Z"]),
    1
  );
  assert.equal(countActiveDaysJst([]), 0);
});

/** Wave 1 の実データ（参加者10人・13セッション）を固定値として持つ。 */
const WAVE1: Array<{
  client_token: string | null;
  started_at: string;
  user_message_count: number;
  memory_found: boolean;
}> = [
  { client_token: "ce562761", started_at: "2026-09-02T10:43:46Z", user_message_count: 0, memory_found: false },
  { client_token: "f1d0c958", started_at: "2026-09-02T10:47:14Z", user_message_count: 0, memory_found: false },
  { client_token: "8e5b9e55", started_at: "2026-09-02T10:47:48Z", user_message_count: 8, memory_found: true },
  { client_token: "8e5b9e55", started_at: "2026-09-02T10:53:38Z", user_message_count: 0, memory_found: false },
  { client_token: "f72917fd", started_at: "2026-09-02T10:55:41Z", user_message_count: 2, memory_found: false },
  { client_token: "5ab658d1", started_at: "2026-09-02T11:26:02Z", user_message_count: 6, memory_found: true },
  { client_token: "5ab658d1", started_at: "2026-09-02T11:31:10Z", user_message_count: 0, memory_found: false },
  { client_token: "dbfdcb74", started_at: "2026-09-02T14:36:36Z", user_message_count: 7, memory_found: true },
  { client_token: "18c794ea", started_at: "2026-09-02T16:32:12Z", user_message_count: 6, memory_found: true },
  { client_token: "5715a5fc", started_at: "2026-09-03T07:03:34Z", user_message_count: 5, memory_found: true },
  { client_token: "5715a5fc", started_at: "2026-09-03T07:06:08Z", user_message_count: 0, memory_found: false },
  { client_token: "1f974dec", started_at: "2026-09-03T15:31:45Z", user_message_count: 7, memory_found: true },
  { client_token: "31d35854", started_at: "2026-09-05T09:19:24Z", user_message_count: 0, memory_found: false },
];

test("0発話を『1本目』と『2本目以降』に分ける", () => {
  const { firstSilent, laterSilent } = splitSilentSessions(WAVE1);
  // 本当の離脱は ce562761 / f1d0c958 / 31d35854 の3人
  assert.equal(firstSilent, 3);
  // 8e5b9e55 / 5ab658d1 / 5715a5fc が「1本話したあと覗いて閉じた」3件
  assert.equal(laterSilent, 3);
});

test("2本目以降が0発話でも、その人の順序が入れ替わっても結果は変わらない", () => {
  const shuffled = [...WAVE1].reverse();
  assert.deepEqual(splitSilentSessions(shuffled), splitSilentSessions(WAVE1));
});

test("3層の引きが Wave 1 の確定値と一致する", () => {
  // Wave 1 には Stage 1 が無かったので Entry Pull の分母は取れていない。
  // ここでは分母0のとき rate が null になることを確認する。
  const noViews = threeLayerPull(WAVE1, 0);
  assert.equal(noViews.entry.started, 10);
  assert.equal(noViews.entry.rate, null);

  const r = threeLayerPull(WAVE1, 20);
  assert.equal(r.entry.started, 10);
  assert.equal(r.entry.rate, 50);

  // 会話が成立したのは7人、うち記憶が出たのは6人 = 86%
  assert.equal(r.conversation.talked, 7);
  assert.equal(r.conversation.withMemory, 6);
  assert.equal(r.conversation.rate, 86);

  // Return Pull はゼロ。10人全員 active_days = 1（JSTで確認済み）
  assert.equal(r.returning.people, 10);
  assert.equal(r.returning.repeat, 0);
  assert.equal(r.returning.rate, 0);
});

test("3層は Return Pull が発生したら拾える", () => {
  const withReturn = [
    ...WAVE1,
    // 8e5b9e55 が翌日に戻ってきた場合
    { client_token: "8e5b9e55", started_at: "2026-09-04T02:00:00Z", user_message_count: 4, memory_found: true },
  ];
  const r = threeLayerPull(withReturn, 20);
  assert.equal(r.returning.repeat, 1);
  assert.equal(r.returning.rate, 10);
});

test("client_token が null のセッションは人数に数えない", () => {
  const withNull = [
    ...WAVE1,
    { client_token: null, started_at: "2026-09-04T02:00:00Z", user_message_count: 5, memory_found: true },
  ];
  assert.equal(threeLayerPull(withNull, 20).returning.people, 10);
  assert.deepEqual(splitSilentSessions(withNull), splitSilentSessions(WAVE1));
});

test("found_view から再訪までの時間", () => {
  const viewed = "2026-09-11T10:00:00Z";
  // 閲覧より前のセッションは再訪ではない
  assert.equal(minutesToRevisit(viewed, ["2026-09-11T09:00:00Z"]), null);
  assert.equal(minutesToRevisit(viewed, []), null);
  // 複数あれば最初のものを採る
  assert.equal(
    minutesToRevisit(viewed, ["2026-09-11T13:00:00Z", "2026-09-11T10:30:00Z"]),
    30
  );
  assert.equal(minutesToRevisit("こわれた日付", ["2026-09-11T10:30:00Z"]), null);
});

test("中央値", () => {
  assert.equal(medianMinutes([]), null);
  assert.equal(medianMinutes([5]), 5);
  assert.equal(medianMinutes([30, 10, 20]), 20);
  assert.equal(medianMinutes([10, 20, 30, 40]), 25);
});
