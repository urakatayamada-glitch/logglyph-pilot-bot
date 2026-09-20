import { getOpenAI } from "../conversation/engine";
import { MODELS } from "../conversation/config";
import { SIGNAL_KINDS } from "./types.ts";
import type { Candidate, ReadingInput, Signal, SignalKind } from "./types.ts";

/**
 * Reading Engine の LLM 呼び出し（S1 / S2 / S4b / S5）。
 *
 * ⚠ lib/conversation/ は**読むだけ**。getOpenAI と MODELS を import しているだけで、
 *   会話の挙動には1文字も触れていない。
 *
 * ⚠ 生成と採点を**別の呼び出し**に分けている。
 *   同じコンテキストで「これ良いよね」まで判断させると自己採点になる。
 */

export const READING_ENGINE_VERSION = "reading-v1";

/** 本人の発話だけを「相手:」で、AIの発話を「AI:」で並べる */
export function transcriptOf(input: ReadingInput): string {
  return input.turns.map((t) => `${t.role === "user" ? "相手" : "AI"}: ${t.content}`).join("\n");
}

function sourceBlock(input: ReadingInput): string {
  return [
    "【こちらが投げかけた話題（Trigger）】",
    input.trigger || "(記録なし)",
    "",
    "【会話の全文】",
    transcriptOf(input),
  ].join("\n");
}

/* ============================================================
   S1. Signal 抽出
   ============================================================ */

const SIGNAL_SYSTEM = `あなたは、ある1回の会話から「その人固有の手がかり」を拾い出す。

会話は「相手:」と「AI:」の形で渡される。
冒頭に、こちらから投げかけた話題（Trigger）が付いている。

拾う手がかりの種類：
- content            何を話したか
- trigger_delta      何を聞かれて、何を返したか。そのズレ
                     例：人との別れを聞いたのに、返ってきたのが「物」だった
- narrative_mismatch 本人の自己説明と、実際の反応のズレ
                     例：「忘れてた」と言いながら、その出来事を3日引きずっている
- contradiction      同じ会話の中での論理的な食い違い
- repetition         聞いていないのに、何度も戻ってくるもの
- omission           本来ありそうなのに、出てこないもの / しなかったこと
- residue            今も残っているもの
- unexpected_choice  普通ならそうしない選択

⚠ 絶対の規則：
- quote は「相手」の発話から、**一字一句そのまま**取ること。要約しない。言い換えない。
- 「AI」の発話からは取らない。
- quote は6文字以上。
- trigger_delta は、Trigger の中身と突き合わせて判断すること。
- 無理に全種類を埋めない。出ていないものは返さない。
- 最大8件。`;

const SIGNAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["signals"],
  properties: {
    signals: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "quote", "turn", "note"],
        properties: {
          kind: { type: "string", enum: [...SIGNAL_KINDS] },
          quote: { type: "string" },
          turn: { type: "integer" },
          note: { type: "string" },
        },
      },
    },
  },
} as const;

export async function extractSignals(input: ReadingInput): Promise<Signal[]> {
  const client = getOpenAI();
  if (!client) return [];
  const res = await client.chat.completions.create({
    model: MODELS.extraction,
    messages: [
      { role: "system", content: SIGNAL_SYSTEM },
      { role: "user", content: sourceBlock(input) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "signals", strict: true, schema: SIGNAL_SCHEMA },
    },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) {
    console.warn("reading: no signal content", {
      finish: res.choices[0]?.finish_reason,
    });
    return [];
  }
  const parsed = JSON.parse(raw) as {
    signals?: Array<{ kind: string; quote: string; turn: number; note: string }>;
  };
  const list = Array.isArray(parsed.signals) ? parsed.signals : [];
  return list
    .filter((s) => typeof s.quote === "string" && s.quote.trim())
    .filter((s) => (SIGNAL_KINDS as readonly string[]).includes(s.kind))
    .slice(0, 8)
    .map((s, i) => ({
      id: `s${i + 1}`,
      kind: s.kind as SignalKind,
      quote: s.quote.trim(),
      turn: Number.isFinite(s.turn) ? s.turn : 0,
      note: String(s.note ?? ""),
    }));
}

/* ============================================================
   S2. Reading 候補生成（3件）
   ============================================================ */

/*
 * ⚠ ここで「良い Reading を書いて」と頼まない。
 *   3件出させて、**選ぶのは後段の機械検査**にする。
 *   生成側に品質判断をさせないことが、自己採点を避ける第一歩になる。
 */
const CANDIDATE_SYSTEM = `あなたは、1回の会話から拾った手がかりをもとに、
その人について**踏み込んだ読み**を書く。

読みの書き方：
- 200〜400字
- **必ず言い切る。**「〜と思う」「〜なんじゃないか」で終える
- 「かもしれません」「〜な気がします」で逃げない
- 根拠にした手がかりの id を based_on に入れる（最低1つ）
- 本人が言っていない具体的な事実を勝手に足さない
- 分からない部分は「分からない」と書いてよい。埋めない

⚠ 3件は**別々の方向**にすること。同じ読みの言い換えを3つ出さない。
⚠ 本人が言ったことの要約は読みではない。**本人が言っていないことを言う。**
⚠ 誰にでも当てはまる文章は書かない。この人にしか当てはまらないものを書く。`;

const CANDIDATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "based_on"],
        properties: {
          text: { type: "string" },
          based_on: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export const CANDIDATE_COUNT = 3;

export async function generateCandidates(
  input: ReadingInput,
  signals: Signal[]
): Promise<Candidate[]> {
  const client = getOpenAI();
  if (!client || signals.length === 0) return [];
  const signalBlock = signals
    .map((s) => `${s.id} [${s.kind}] 「${s.quote}」 … ${s.note}`)
    .join("\n");
  const res = await client.chat.completions.create({
    model: MODELS.extraction,
    messages: [
      { role: "system", content: CANDIDATE_SYSTEM },
      {
        role: "user",
        content: [
          sourceBlock(input),
          "",
          "【拾った手がかり】",
          signalBlock,
          "",
          `方向の違う読みを ${CANDIDATE_COUNT} 件。`,
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "candidates", strict: true, schema: CANDIDATE_SCHEMA },
    },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) return [];
  const parsed = JSON.parse(raw) as {
    candidates?: Array<{ text: string; based_on: string[] }>;
  };
  const list = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  return list
    .filter((c) => typeof c.text === "string" && c.text.trim())
    .slice(0, CANDIDATE_COUNT)
    .map((c, i) => ({
      id: `c${i + 1}`,
      text: c.text.trim(),
      basedOn: Array.isArray(c.based_on) ? c.based_on.filter((x) => typeof x === "string") : [],
    }));
}

/* ============================================================
   S4b. Barnum 差し替え判定（Blind）
   ============================================================ */

/*
 * ⚠ 判定側には、この文章がどこから来たかを**見せない。**
 *   「元のセッションに当てはまるか」ではなく、
 *   「無関係な他人のログに当てはまってしまうか」だけを聞く。
 */
const SWAP_SYSTEM = `ある人の会話の全文と、ある文章が渡される。

質問はひとつだけ：
**この文章は、この人について書かれたものだと思うか。**

判断の基準：
- この人の会話に出てくる具体的な事柄と噛み合っているなら yes
- 誰について書かれていても成立しそうなら no ではなく yes にしない。
  つまり「誰にでも当てはまるから、この人にも当てはまる」は yes にしない
- あくまで「この人のことだ」と言えるかどうかで答える`;

const SWAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fits", "why"],
  properties: {
    fits: { type: "boolean" },
    why: { type: "string" },
  },
} as const;

export async function swapFits(text: string, other: ReadingInput): Promise<boolean> {
  const client = getOpenAI();
  if (!client) return false;
  const res = await client.chat.completions.create({
    model: MODELS.extraction,
    messages: [
      { role: "system", content: SWAP_SYSTEM },
      {
        role: "user",
        content: [
          "【この人の会話の全文】",
          transcriptOf(other),
          "",
          "【文章】",
          text,
        ].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "swap", strict: true, schema: SWAP_SCHEMA },
    },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) return false;
  const parsed = JSON.parse(raw) as { fits?: boolean };
  return Boolean(parsed.fits);
}

/* ============================================================
   S5. LLM 側の採点（Specificity / Risk / Surprise）
   ============================================================ */

/*
 * ⚠ Evidence は機械だけで決める。ここでは聞かない。
 * ⚠ ここで返る点は、score.ts の機械的な上限の**内側**でしか効かない。
 */
const SCORE_SYSTEM = `会話の全文と、その人について書かれた読みが渡される。
3つの観点で 0〜3 の点を付ける。甘く付けない。

specificity  この人にしか当てはまらないか
  0 誰にでも当てはまる / 1 ありがちだが少し具体的
  2 この人の話に固有の要素がある / 3 この人以外にはまず当てはまらない

risk         外れる可能性があるか。本人が「違う」と言える文か
  0 外れようがない（当たり障りがない）/ 1 ほぼ安全
  2 本人が否定しうる / 3 はっきり外しうる踏み込み

surprise     本人が言っていないことを言えているか
  0 本人の発言の要約・言い換え / 1 少し足しただけ
  2 本人が言っていない読みがある / 3 本人も気づいていない構造を示している`;

const SCORE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["specificity", "risk", "surprise", "why"],
  properties: {
    specificity: { type: "integer" },
    risk: { type: "integer" },
    surprise: { type: "integer" },
    why: { type: "string" },
  },
} as const;

export async function scoreByLlm(
  text: string,
  input: ReadingInput
): Promise<{ specificity: number; risk: number; surprise: number; why: string }> {
  const client = getOpenAI();
  if (!client) return { specificity: 0, risk: 0, surprise: 0, why: "no client" };
  const res = await client.chat.completions.create({
    model: MODELS.extraction,
    messages: [
      { role: "system", content: SCORE_SYSTEM },
      {
        role: "user",
        content: ["【会話の全文】", transcriptOf(input), "", "【読み】", text].join("\n"),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "score", strict: true, schema: SCORE_SCHEMA },
    },
  });
  const raw = res.choices[0]?.message?.content;
  if (!raw) return { specificity: 0, risk: 0, surprise: 0, why: "no content" };
  const p = JSON.parse(raw) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    specificity: n(p.specificity),
    risk: n(p.risk),
    surprise: n(p.surprise),
    why: String(p.why ?? ""),
  };
}
