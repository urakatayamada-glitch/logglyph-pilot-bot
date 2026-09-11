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
  decideCapacity,
  countValueResponsesPerPerson,
  entryDenominator,
  isNextDayReturnJst,
  elapsedBucket,
  firstSessionAfter,
  foundCampaignFunnel,
  FOUND_CAMPAIGNS,
  variantFunnels,
} from "../lib/found.ts";
import {
  resolveExperienceVariant,
  isExperienceVariant,
  EXPERIENCE_VARIANTS,
} from "../lib/experience.ts";

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

/* ============================================================
   Wave 2 の枠判定
   ============================================================
   「総数30に達したとき」の挙動を確かめるために本番で30セッション作る、
   ということをしなくて済むように、判定だけを純関数にして境界を確認する。
*/
const LIMITS = {
  cohortSrcs: ["note_wave2", "note_wave2_a2"],
  cohortTotalPeople: 30,
  cohortDailySessions: 30,
  cohortSessionsPerClientPerDay: 2,
  globalDailySessions: 50,
};
const ZERO = {
  globalToday: 0,
  cohortPeople: 0,
  alreadyInCohort: false,
  cohortToday: 0,
  clientToday: 0,
};

test("枠：まだ空いていれば通す", () => {
  assert.equal(decideCapacity("note_wave2", ZERO, LIMITS), null);
  assert.equal(decideCapacity(null, ZERO, LIMITS), null);
});

test("枠：総数は『人数』で数える。30人目までが参加者", () => {
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, cohortPeople: 29 }, LIMITS),
    null
  );
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, cohortPeople: 30 }, LIMITS),
    "cohort_total"
  );
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, cohortPeople: 31 }, LIMITS),
    "cohort_total"
  );
});

test("枠：すでに参加済みの人は、満員でも2本目を始められる", () => {
  /*
   * ここを間違えると「30人目が埋まった瞬間、それまでの29人も
   * 2本目を始められなくなる」ことになり、人数で数える意味がなくなる。
   */
  assert.equal(
    decideCapacity(
      "note_wave2",
      { ...ZERO, cohortPeople: 30, alreadyInCohort: true },
      LIMITS
    ),
    null
  );
  // ただし1日の回数上限は、参加済みでも効く
  assert.equal(
    decideCapacity(
      "note_wave2",
      { ...ZERO, cohortPeople: 30, alreadyInCohort: true, clientToday: 2 },
      LIMITS
    ),
    "per_client_daily"
  );
});

test("枠：1人1日2回まで（初日の per_client_daily 3件を受けて 1 → 2 に変更）", () => {
  assert.equal(decideCapacity("note_wave2", { ...ZERO, clientToday: 1 }, LIMITS), null);
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, clientToday: 2 }, LIMITS),
    "per_client_daily"
  );
});

test("枠：コホート日次", () => {
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, cohortToday: 30 }, LIMITS),
    "cohort_daily"
  );
  assert.equal(
    decideCapacity("note_wave2", { ...ZERO, cohortToday: 29 }, LIMITS),
    null
  );
});

test("枠：全体のヒューズは src を問わず先に効く", () => {
  // 知人コホート（src なし）でも全体上限は効く
  assert.equal(
    decideCapacity(null, { ...ZERO, globalToday: 50 }, LIMITS),
    "global_daily"
  );
  // 全体上限とコホート総数が同時に埋まっていたら、全体が先に返る
  assert.equal(
    decideCapacity(
      "note_wave2",
      {
        globalToday: 50,
        cohortPeople: 30,
        alreadyInCohort: false,
        cohortToday: 30,
        clientToday: 2,
      },
      LIMITS
    ),
    "global_daily"
  );
});

test("枠：記事が増えても上限は1つ（複数srcが同じコホート）", () => {
  /*
   * 記事ごとに src を分けるが、上限はコホート全体で1つ。
   * 単一値にしていると、新しい記事の src が上限の対象外になり
   * 枠を無視して入れてしまう。
   */
  const full = {
    globalToday: 0,
    cohortPeople: 30,
    alreadyInCohort: false,
    cohortToday: 0,
    clientToday: 0,
  };
  assert.equal(decideCapacity("note_wave2", full, LIMITS), "cohort_total");
  assert.equal(decideCapacity("note_wave2_a2", full, LIMITS), "cohort_total");
  // コホート外は対象にならない
  assert.equal(decideCapacity("other_article", full, LIMITS), null);
  assert.equal(decideCapacity(null, full, LIMITS), null);
});

test("枠：コホート以外はコホート上限の対象にならない", () => {
  // 運営のテストや知人コホートが、note の枠が埋まったせいで止まらないこと
  const full = {
    globalToday: 10,
    cohortPeople: 30,
    alreadyInCohort: false,
    cohortToday: 30,
    clientToday: 5,
  };
  assert.equal(decideCapacity(null, full, LIMITS), null);
  assert.equal(decideCapacity("other_source", full, LIMITS), null);
  assert.equal(decideCapacity("note_wave2", full, LIMITS), "cohort_total");
});

test("1タップ評価は1人1票。開き直して押しても増えない", () => {
  const rows = [
    { client_token: "a", viewed_at: "2026-09-11T10:00:00Z", value_response: "fit" },
    // 同じ人が開き直して別の答えを押した。最初の回答だけを採る
    { client_token: "a", viewed_at: "2026-09-11T11:00:00Z", value_response: "off" },
    { client_token: "a", viewed_at: "2026-09-11T12:00:00Z", value_response: "off" },
    { client_token: "b", viewed_at: "2026-09-11T10:30:00Z", value_response: "off" },
    // 開いたが押さなかった人は数えない
    { client_token: "c", viewed_at: "2026-09-11T10:40:00Z", value_response: null },
  ];
  assert.deepEqual(countValueResponsesPerPerson(rows), { fit: 1, off: 1, unknown: 0 });
  // 順序が入れ替わっても「最初の回答」を採る
  assert.deepEqual(
    countValueResponsesPerPerson([...rows].reverse()),
    { fit: 1, off: 1, unknown: 0 }
  );
  assert.deepEqual(countValueResponsesPerPerson([]), { fit: 0, off: 0, unknown: 0 });
});

test("枠で断られただけの人は Entry Pull の分母から外す", () => {
  /*
   * 到達と拒否は別テーブルなので、断られた人も「到達」に残っている。
   * 分母に残すと、興味がなくて始めなかった人と混ざって
   * Entry Pull が実態より低く出る。
   */
  const r = entryDenominator(
    ["a", "b", "c", "d"],   // 到達した4人
    ["a", "c"],              // セッションを持っている2人
    ["b", "c"]               // 枠で断られた2人
  );
  // b は断られただけ → 除外。c は断られたが会話できている → 分母に残す
  assert.equal(r.people, 3);
  assert.equal(r.excluded, 1);
});

test("Entry Pull の分母：拒否も重複もない素直な場合", () => {
  assert.deepEqual(entryDenominator(["a", "b"], ["a"], []), {
    people: 2,
    excluded: 0,
  });
  assert.deepEqual(entryDenominator([], [], []), { people: 0, excluded: 0 });
  // 同じ人が何度も到達しても1人
  assert.deepEqual(entryDenominator(["a", "a", "a"], ["a"], []), {
    people: 1,
    excluded: 0,
  });
});

/* ============================================================
   Found Campaign と Return 判定
   ============================================================ */

test("isNextDayReturnJst : 経過時間ではなくJSTの日付で判定する", () => {
  // 経過20分でも日付が変わっていれば Next-Day Return
  assert.equal(
    isNextDayReturnJst("2026-09-11T14:50:00Z", "2026-09-11T15:10:00Z"),
    true,
    "9/11 23:50 JST → 9/12 00:10 JST は Next-Day"
  );
  // 経過10時間でも同じ日なら Same-Day
  assert.equal(
    isNextDayReturnJst("2026-09-11T01:00:00Z", "2026-09-11T11:00:00Z"),
    false,
    "9/11 10:00 JST → 9/11 20:00 JST は Same-Day"
  );
  // 前に戻るのは Return ではない
  assert.equal(
    isNextDayReturnJst("2026-09-12T01:00:00Z", "2026-09-11T01:00:00Z"),
    false
  );
  // 2日空いても Next-Day Return（「翌日以降」の意味）
  assert.equal(
    isNextDayReturnJst("2026-09-11T01:00:00Z", "2026-09-14T01:00:00Z"),
    true
  );
});

test("elapsedBucket : 境界", () => {
  assert.equal(elapsedBucket(0), "le10m");
  assert.equal(elapsedBucket(10), "le10m");
  assert.equal(elapsedBucket(11), "le1h");
  assert.equal(elapsedBucket(60), "le1h");
  assert.equal(elapsedBucket(61), "le24h");
  assert.equal(elapsedBucket(60 * 24), "le24h");
  assert.equal(elapsedBucket(60 * 24 + 1), "le72h");
  assert.equal(elapsedBucket(60 * 72), "le72h");
  assert.equal(elapsedBucket(60 * 72 + 1), "gt72h");
});

test("firstSessionAfter : 閲覧より後の最初の1本だけを採る", () => {
  assert.equal(
    firstSessionAfter("2026-09-11T01:00:00Z", [
      "2026-09-10T01:00:00Z",
      "2026-09-12T01:00:00Z",
      "2026-09-11T05:00:00Z",
    ]),
    "2026-09-11T05:00:00Z"
  );
  assert.equal(firstSessionAfter("2026-09-11T01:00:00Z", []), null);
  assert.equal(
    firstSessionAfter("2026-09-11T01:00:00Z", ["2026-09-10T01:00:00Z"]),
    null
  );
});

test("FOUND_CAMPAIGNS : 今回の配布キーが存在する", () => {
  assert.ok(FOUND_CAMPAIGNS.some((c) => c.key === "wave1_found_return_01"));
});

/* ---------- foundCampaignFunnel ---------- */

const CAMPAIGN = "wave1_found_return_01";

function sess(
  id: string,
  token: string,
  startedAt: string,
  extra: Partial<{
    user_message_count: number;
    memory_found: boolean;
    entry_context: string | null;
  }> = {}
) {
  return {
    session_id: id,
    client_token: token,
    started_at: startedAt,
    user_message_count: extra.user_message_count ?? 5,
    memory_found: extra.memory_found ?? true,
    entry_context: extra.entry_context ?? null,
  };
}

test("foundCampaignFunnel : Eligible は campaign / approved / 記憶 / 0発話で絞る", () => {
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    sess("s2", "t2", "2026-09-01T01:00:00Z"),
    sess("s3", "t3", "2026-09-01T01:00:00Z", { memory_found: false }),
    sess("s4", "t4", "2026-09-01T01:00:00Z", { user_message_count: 0 }),
    sess("s5", "t5", "2026-09-01T01:00:00Z"),
  ];
  const notes = [
    { session_id: "s1", approved: true, campaign_key: CAMPAIGN, first_sent_at: null },
    // 未承認は Eligible ではない
    { session_id: "s2", approved: false, campaign_key: CAMPAIGN, first_sent_at: null },
    // 記憶なし
    { session_id: "s3", approved: true, campaign_key: CAMPAIGN, first_sent_at: null },
    // 0発話
    { session_id: "s4", approved: true, campaign_key: CAMPAIGN, first_sent_at: null },
    // 別のcampaign
    { session_id: "s5", approved: true, campaign_key: "other", first_sent_at: null },
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.eligible, 1);
  assert.equal(f.sent, 0, "first_sent_at が無いうちは Sent に数えない");
});

test("foundCampaignFunnel : Sent は first_sent_at がある人だけ", () => {
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    sess("s2", "t2", "2026-09-01T01:00:00Z"),
  ];
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
    { session_id: "s2", approved: true, campaign_key: CAMPAIGN, first_sent_at: null },
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.eligible, 2);
  assert.equal(f.sent, 1);
});

test("foundCampaignFunnel : 送付前の閲覧を起点にしない", () => {
  const sessions = [sess("s1", "t1", "2026-09-01T01:00:00Z")];
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  // 送付より前（運営の動作確認）の閲覧しかない
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [
      { client_token: "t1", viewed_at: "2026-09-05T00:00:00Z", value_response: "fit" },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.viewed, 0);
  assert.equal(f.valueCounts.fit, 0, "送付前の評価は campaign の票にしない");
});

test("foundCampaignFunnel : 未閲覧の人は Return 判定に入れない", () => {
  // t2 は送付済みだが /found を開いていない。開いていないのに翌日会話している。
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    sess("s2", "t2", "2026-09-01T01:00:00Z"),
    sess("s2b", "t2", "2026-09-12T01:00:00Z"),
  ];
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
    {
      session_id: "s2",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [
      { client_token: "t1", viewed_at: "2026-09-11T02:00:00Z", value_response: null },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.sent, 2);
  assert.equal(f.viewed, 1);
  assert.equal(
    f.postFoundSession,
    0,
    "t2 の翌日会話は Found を見ていないので数えない"
  );
});

test("foundCampaignFunnel : Same-Day と Next-Day を取り違えない", () => {
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
    {
      session_id: "s2",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    // 9/11 10:00 JST 閲覧 → 9/11 20:00 JST 会話（経過10時間だが同日）
    sess("s1b", "t1", "2026-09-11T11:00:00Z"),
    sess("s2", "t2", "2026-09-01T01:00:00Z"),
    // 9/11 23:50 JST 閲覧 → 9/12 00:10 JST 会話（経過20分だが翌日）
    sess("s2b", "t2", "2026-09-11T15:10:00Z"),
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [
      { client_token: "t1", viewed_at: "2026-09-11T01:00:00Z", value_response: "fit" },
      { client_token: "t2", viewed_at: "2026-09-11T14:50:00Z", value_response: "fit" },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.postFoundSession, 2);
  assert.equal(f.sameDayContinuation, 1);
  assert.equal(f.nextDayReturn, 1);
  // Diagnostic は経過時間で入る（Return の判定とは別軸）
  assert.equal(f.buckets.le10m, 0);
  assert.equal(f.buckets.le1h, 1, "20分の方");
  assert.equal(f.buckets.le24h, 1, "10時間の方");
  assert.equal(f.fitAndNextDay, 1);
  assert.equal(f.fitPeople, 2);
});

test("foundCampaignFunnel : 同じ人は1回だけ数え、Next-Day を優先する", () => {
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    sess("s1b", "t1", "2026-09-11T02:00:00Z"), // 同日
    sess("s1c", "t1", "2026-09-12T02:00:00Z", { entry_context: "found" }), // 翌日
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [
      { client_token: "t1", viewed_at: "2026-09-11T01:00:00Z", value_response: null },
      // 再閲覧。起点はリセットしない
      { client_token: "t1", viewed_at: "2026-09-11T23:00:00Z", value_response: null },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.postFoundSession, 1);
  assert.equal(f.sameDayContinuation, 0);
  assert.equal(f.nextDayReturn, 1);
  assert.equal(f.directFromFound, 1);
  assert.equal(f.newMemoryFound, 1);
});

test("foundCampaignFunnel : entry_context は Return の必須条件ではない", () => {
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    // ブックマークから戻ったので ?from=found が付いていない
    sess("s1b", "t1", "2026-09-12T02:00:00Z", { entry_context: null }),
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [
      { client_token: "t1", viewed_at: "2026-09-11T01:00:00Z", value_response: null },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.nextDayReturn, 1, "?from=found が無くても Return に数える");
  assert.equal(f.directFromFound, 0, "Direct は別指標");
});

test("foundCampaignFunnel : 運営テストは明示登録した人だけを除外する", () => {
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
    {
      session_id: "s2",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const sessions = [
    sess("s1", "t1", "2026-09-01T01:00:00Z"),
    sess("s2", "t2", "2026-09-01T01:00:00Z"),
    sess("s2b", "t2", "2026-09-12T02:00:00Z"),
  ];
  const views = [
    { client_token: "t1", viewed_at: "2026-09-11T01:00:00Z", value_response: null },
    { client_token: "t2", viewed_at: "2026-09-11T01:00:00Z", value_response: "fit" },
  ];
  const excluded = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views,
    internalTokens: ["t2"],
    includeInternal: false,
  });
  assert.equal(excluded.eligible, 1);
  assert.equal(excluded.sent, 1);
  assert.equal(excluded.nextDayReturn, 0);
  assert.equal(excluded.internalExcluded, 1);

  const included = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views,
    internalTokens: ["t2"],
    includeInternal: true,
  });
  assert.equal(included.eligible, 2);
  assert.equal(included.nextDayReturn, 1);
  assert.equal(included.internalExcluded, 0);
});

test("foundCampaignFunnel : 1タップ評価は1人1票（再閲覧で水増ししない）", () => {
  const notes = [
    {
      session_id: "s1",
      approved: true,
      campaign_key: CAMPAIGN,
      first_sent_at: "2026-09-11T00:00:00Z",
    },
  ];
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions: [sess("s1", "t1", "2026-09-01T01:00:00Z")],
    views: [
      { client_token: "t1", viewed_at: "2026-09-11T01:00:00Z", value_response: "fit" },
      { client_token: "t1", viewed_at: "2026-09-11T02:00:00Z", value_response: "fit" },
      { client_token: "t1", viewed_at: "2026-09-11T03:00:00Z", value_response: "off" },
    ],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.viewed, 1);
  assert.equal(f.valueCounts.fit, 1);
  assert.equal(f.valueCounts.off, 0);
});

test("foundCampaignFunnel : 今回の想定（6名送付・まだ誰も見ていない）", () => {
  const tokens = ["t1", "t2", "t3", "t4", "t5", "t6"];
  const sessions = tokens.map((t, i) => sess(`s${i}`, t, "2026-09-01T01:00:00Z"));
  const notes = tokens.map((_, i) => ({
    session_id: `s${i}`,
    approved: true,
    campaign_key: CAMPAIGN,
    first_sent_at: "2026-09-11T00:00:00Z",
  }));
  const f = foundCampaignFunnel({
    campaignKey: CAMPAIGN,
    notes,
    sessions,
    views: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.eligible, 6);
  assert.equal(f.sent, 6);
  assert.equal(f.viewed, 0);
  assert.equal(f.postFoundSession, 0);
  assert.equal(f.nextDayReturn, 0);
});

/* ============================================================
   体験条件（experience_variant）
   ============================================================ */

test("resolveExperienceVariant : フラグが 1 のときだけ v1", () => {
  assert.equal(resolveExperienceVariant("1"), "memory_receipt_v1");
  assert.equal(resolveExperienceVariant("0"), "baseline");
  assert.equal(resolveExperienceVariant(""), "baseline");
  assert.equal(resolveExperienceVariant(undefined), "baseline");
  // "true" では有効にしない。値は "1" だけと決めている
  assert.equal(resolveExperienceVariant("true"), "baseline");
});

test("isExperienceVariant : 知らない値は通さない", () => {
  assert.equal(isExperienceVariant("baseline"), true);
  assert.equal(isExperienceVariant("memory_receipt_v1"), true);
  assert.equal(isExperienceVariant("memory_receipt_v2"), false);
  assert.equal(isExperienceVariant(null), false);
  assert.equal(EXPERIENCE_VARIANTS.length, 2);
});

function vs(
  id: string,
  token: string,
  startedAt: string,
  extra: Partial<{
    completed_at: string | null;
    memory_found: boolean;
    experience_variant: string | null;
  }> = {}
) {
  return {
    session_id: id,
    client_token: token,
    started_at: startedAt,
    completed_at:
      extra.completed_at === undefined ? startedAt : extra.completed_at,
    memory_found: extra.memory_found ?? true,
    experience_variant: extra.experience_variant ?? "baseline",
  };
}

test("variantFunnels : 起点は「記憶が出た最初のセッションの終了時刻」", () => {
  const f = variantFunnels({
    sessions: [
      // 9/11 10:00 JST 開始 → 10:30 JST 終了
      vs("s1", "t1", "2026-09-11T01:00:00Z", {
        completed_at: "2026-09-11T01:30:00Z",
        experience_variant: "memory_receipt_v1",
      }),
      // 9/12 09:00 JST。翌日なので Next-Day Return
      vs("s2", "t1", "2026-09-12T00:00:00Z", {
        experience_variant: "memory_receipt_v1",
      }),
    ],
    receiptSessionIds: ["s1"],
    internalTokens: [],
    includeInternal: false,
  });
  const v = f.memory_receipt_v1;
  assert.equal(v.people, 1);
  assert.equal(v.memoryFound, 1);
  assert.equal(v.receiptViewed, 1);
  assert.equal(v.nextDayReturn, 1);
  assert.equal(v.sameDayContinuation, 0);
  assert.equal(v.newMemoryFound, 1);
});

test("variantFunnels : 同じ日に続けただけは Next-Day にしない", () => {
  const f = variantFunnels({
    sessions: [
      vs("s1", "t1", "2026-09-11T01:00:00Z", {
        completed_at: "2026-09-11T01:30:00Z",
      }),
      // 同じ 9/11 JST のうちにもう1本（Wave 1 で誤認したパターン）
      vs("s2", "t1", "2026-09-11T11:00:00Z"),
    ],
    receiptSessionIds: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.baseline.sameDayContinuation, 1);
  assert.equal(f.baseline.nextDayReturn, 0);
});

test("variantFunnels : Receipt を見たことは Return の起点にしない", () => {
  // receipt を見ていない baseline の人も、同じ起点で Return を判定できる
  const f = variantFunnels({
    sessions: [
      vs("s1", "t1", "2026-09-11T01:00:00Z", {
        completed_at: "2026-09-11T01:30:00Z",
      }),
      vs("s2", "t1", "2026-09-12T00:00:00Z"),
    ],
    receiptSessionIds: [], // 1件も無い
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.baseline.receiptViewed, 0);
  assert.equal(f.baseline.nextDayReturn, 1, "receiptが無くてもReturnは数える");
});

test("variantFunnels : 1人が両方の条件にまたがらない", () => {
  // フラグ切り替えを跨いで使った人。最初のセッションの条件に入れる
  const f = variantFunnels({
    sessions: [
      vs("s1", "t1", "2026-09-11T01:00:00Z", {
        completed_at: "2026-09-11T01:30:00Z",
        experience_variant: "baseline",
      }),
      vs("s2", "t1", "2026-09-12T00:00:00Z", {
        experience_variant: "memory_receipt_v1",
      }),
    ],
    receiptSessionIds: ["s2"],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.baseline.people, 1);
  assert.equal(f.memory_receipt_v1, undefined, "両方には数えない");
  assert.equal(f.baseline.nextDayReturn, 1);
});

test("variantFunnels : 運営テストと削除済みトークンを除く", () => {
  const sessions = [
    vs("s1", "t1", "2026-09-11T01:00:00Z"),
    vs("s2", "t2", "2026-09-11T01:00:00Z"),
    vs("s3", "deleted:abc", "2026-09-11T01:00:00Z"),
  ];
  const excluded = variantFunnels({
    sessions,
    receiptSessionIds: [],
    internalTokens: ["t2"],
    includeInternal: false,
  });
  assert.equal(excluded.baseline.people, 1, "運営も削除済みも除く");

  const included = variantFunnels({
    sessions,
    receiptSessionIds: [],
    internalTokens: ["t2"],
    includeInternal: true,
  });
  assert.equal(included.baseline.people, 2, "削除済みは含めない");
});

test("variantFunnels : 記憶が出なかった人は Return 判定に入れない", () => {
  const f = variantFunnels({
    sessions: [
      vs("s1", "t1", "2026-09-11T01:00:00Z", { memory_found: false }),
      vs("s2", "t1", "2026-09-12T00:00:00Z", { memory_found: false }),
    ],
    receiptSessionIds: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.baseline.people, 1);
  assert.equal(f.baseline.completed, 1);
  assert.equal(f.baseline.memoryFound, 0);
  assert.equal(f.baseline.nextDayReturn, 0);
});

test("variantFunnels : experience_variant が null の行は baseline 扱い", () => {
  const f = variantFunnels({
    sessions: [
      vs("s1", "t1", "2026-09-11T01:00:00Z", { experience_variant: null }),
    ],
    receiptSessionIds: [],
    internalTokens: [],
    includeInternal: false,
  });
  assert.equal(f.baseline.people, 1);
});
