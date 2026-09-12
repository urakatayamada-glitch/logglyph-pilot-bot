import { getOpenAI } from "./conversation/engine";
import { MODELS } from "./conversation/config";
import {
  CATEGORY_SLOTS,
  NARRATIVE_CATEGORIES,
  checkFragment,
  isNarrativeCategory,
} from "./story";

/**
 * Story Fragment と memory_facets の生成。
 *
 * ⚠ lib/conversation/ は読むだけ。1文字も変更していない。
 *   getOpenAI と MODELS を import しているだけで、会話の挙動には触れていない。
 *
 * ⚠ 逆輸入の禁止をここで型として守る。
 *   この関数群が受け取れるのは会話ログと one_line_memory だけ。
 *   story_fragments（演出）を読む経路を持たせていない。
 *   演出で生まれた「絶望していた」のような内面を facet に入れない、という
 *   Product Decision を、プロンプトのお願いではなく引数の形で守る。
 */

export const STORY_PROMPT_VERSION = "story-v1";

export interface SourceTurn {
  role: "user" | "assistant";
  content: string;
}

/** 会話のうち、本人が話した部分だけを取り出す。FACT の唯一の出どころ */
export function userText(messages: SourceTurn[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

/* ============================================================
   1. memory_facets（FACT）
   ============================================================ */

const FACET_SYSTEM = `あなたは、ある人が話した内容から「事実として書かれていること」だけを拾い出す。

守ること:
- 本人が言っていないことは拾わない。推測で埋めない
- 内面の断定をしない。「〜と思っていた」は本人がそう言った場合のみ
- 分からない項目は返さない。無理に埋めない
- それぞれ40字以内の短い記述にする

拾う項目は次のとおり。該当するものだけを返す。`;

function facetInstruction(): string {
  const lines: string[] = [];
  for (const c of NARRATIVE_CATEGORIES) {
    for (const d of CATEGORY_SLOTS[c]) {
      lines.push(`- ${c}.${d.slot} : ${d.hint}`);
    }
  }
  return lines.join("\n");
}

const FACET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["facets"],
  properties: {
    facets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["category", "slot", "value"],
        properties: {
          category: { type: "string" },
          slot: { type: "string" },
          value: { type: "string" },
        },
      },
    },
  },
} as const;

export interface ExtractedFacet {
  category: string;
  slot: string;
  value: string;
}

/**
 * 会話から facet を抽出する。
 * ⚠ 入力は会話ログと one_line_memory のみ。演出テキストは受け取らない。
 */
export async function extractFacets(
  messages: SourceTurn[],
  oneLineMemory: string | null
): Promise<ExtractedFacet[]> {
  const client = getOpenAI();
  if (!client) return [];

  const source = [userText(messages), oneLineMemory ?? ""].join("\n").trim();
  if (!source) return [];

  try {
    const res = await client.chat.completions.create({
      model: MODELS.extraction,
      messages: [
        { role: "system", content: `${FACET_SYSTEM}\n\n${facetInstruction()}` },
        { role: "user", content: source },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "facets", strict: true, schema: FACET_SCHEMA },
      },
    });
    const raw = res.choices[0]?.message?.content;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { facets?: ExtractedFacet[] };
    const facets = Array.isArray(parsed.facets) ? parsed.facets : [];

    // 知らないカテゴリ・スロットは捨てる。％の根拠を汚さない
    return facets.filter((f) => {
      if (!isNarrativeCategory(f.category)) return false;
      if (!CATEGORY_SLOTS[f.category].some((d) => d.slot === f.slot)) return false;
      return typeof f.value === "string" && f.value.trim().length > 0;
    });
  } catch (error) {
    console.error("facet extraction failed", error);
    return [];
  }
}

/* ============================================================
   2. story_fragments（DRAMATIZATION）
   ============================================================ */

const FRAGMENT_SYSTEM = `あなたは、ある人が話した記憶をもとに、短いシーンを書く。

守ること:
- 本人が話していない事実を足さない。固有名詞・数字・因果関係を作らない
- 感情を断定しない。「絶望していた」「幸せだった」とは書かない。
  内面に触れるときは「何かを考えていたのかもしれない」のように、断定しない形にする
- 診断・性格づけをしない
- 「あなた」と呼びかけない
- 200字から400字

書いてよいこと:
- 情景、時間帯、音、温度などの描写
- 語りの間、視点の演出`;

export interface FragmentResult {
  body: string | null;
  rejected?: string;
}

/**
 * シーンを生成する。
 *
 * ⚠ 検証に通らなかったものは表示しない。出さないほうが安全。
 *   数字の捏造・断定的な感情語・長さは lib/story.ts で機械的に見る。
 */
export async function generateFragment(
  messages: SourceTurn[],
  oneLineMemory: string | null
): Promise<FragmentResult> {
  const client = getOpenAI();
  if (!client) return { body: null, rejected: "no_client" };

  const source = [userText(messages), oneLineMemory ?? ""].join("\n").trim();
  if (!source) return { body: null, rejected: "no_source" };

  try {
    const res = await client.chat.completions.create({
      model: MODELS.extraction,
      messages: [
        { role: "system", content: FRAGMENT_SYSTEM },
        { role: "user", content: source },
      ],
    });
    const body = res.choices[0]?.message?.content?.trim() ?? "";
    const check = checkFragment(body, source);
    if (!check.ok) {
      console.warn("fragment rejected", { reason: check.reason, detail: check.detail });
      return { body: null, rejected: check.reason };
    }
    return { body };
  } catch (error) {
    console.error("fragment generation failed", error);
    return { body: null, rejected: "error" };
  }
}
