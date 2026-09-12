import { getOpenAI } from "./conversation/engine";
import { MODELS } from "./conversation/config";
import {
  CATEGORY_SLOTS,
  NARRATIVE_CATEGORIES,
  ValuedFacet,
  checkFragment,
  factLines,
  isNarrativeCategory,
  unknownLines,
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

/*
 * ⚠ 方針は「Fact は増やさない。表現は大胆にしてよい」。
 *
 *   制限するのは脚色ではなく、本人が話していない具体的事実の追加。
 *   埋めてしまうと「まだ見えていないもの」と矛盾し、
 *   記憶が増えるほど描写が具体的になる、という体験が壊れる。
 */
const FRAGMENT_SYSTEM = `あなたは、ある人が話した記憶を、ひとつのシーンとして書く。

【断定してよいのは、下に「確かなこと」として渡された内容だけ】

「確かなこと」に書かれていない次のものを、新しい事実として断定しない。
  場所 / 日時 / 人物 / 出来事 / 連絡手段 / 天候 / 音 / 身体動作 / 感情

書かれていない部分は、埋めずに余白として残す。
どうしても触れる必要があるときは、特定しない形にする。
  「自宅のオフィスで」→ ×（場所が確かでないなら書かない）
  「どこかの午後」「誰かの声」→ ○
  「絶望していた」→ ×
  「何かを考えていたのかもしれない」→ ○

【表現は大胆にしてよい】

次はむしろ積極的に使ってよい。
  比喩 / 文章の構成 / リズム / 余韻 / 視点 / 本人が話した内容の再配置

本人の言葉やニュアンスは、会話からそのまま拾ってよい。

【形式】
- 三人称で書く。「あなた」と呼びかけない
- 200字から400字
- 診断・性格づけをしない`;

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
  oneLineMemory: string | null,
  /**
   * この回で確定した事実。ここに無いことは断定させない。
   *
   * ⚠ 今回のセッションぶんだけを渡す。
   *   過去の全 facet を渡すと、別の時期の記憶の場所や人物が
   *   今日のシーンに紛れ込む。今日のシーンは今日の記憶のもの。
   */
  facets: ValuedFacet[] = []
): Promise<FragmentResult> {
  const client = getOpenAI();
  if (!client) return { body: null, rejected: "no_client" };

  const source = [userText(messages), oneLineMemory ?? ""].join("\n").trim();
  if (!source) return { body: null, rejected: "no_source" };

  const known = factLines(facets);
  const unknown = unknownLines(facets);
  const brief = [
    "【本人が話したこと】",
    source,
    "",
    "【確かなこと（断定してよいのはこれだけ）】",
    known.length > 0 ? known.join("\n") : "（まだ何も確定していない）",
    "",
    "【まだ分かっていないこと（断定しないこと）】",
    unknown.join("\n"),
  ].join("\n");

  try {
    const res = await client.chat.completions.create({
      model: MODELS.extraction,
      messages: [
        { role: "system", content: FRAGMENT_SYSTEM },
        { role: "user", content: brief },
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
