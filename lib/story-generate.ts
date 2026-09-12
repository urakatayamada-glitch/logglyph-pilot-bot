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

/*
 * ⚠ 一度、これが厳しすぎて0件しか取れなかった（2026-09-12 本番）。
 *
 *   会話には「ホテルの人によくしてもらった」「発注をもらった」
 *   「自信になった」「今もスーツを捨てられない」が出ていたのに、
 *   抽出は1件も返さなかった。「推測で埋めない」を繰り返した結果、
 *   本人がはっきり言ったことまで拾わなくなっていた。
 *
 *   拾わなすぎると進捗が動かず、「まだ見えていないもの」も変わらない。
 *   話しても何も起きないので、体験そのものが成立しない。
 *
 *   禁止したいのは「本人が言っていないことの追加」であって、
 *   「本人が言ったことの言い換え」ではない。
 */
const FACET_SYSTEM = `あなたは、ある人が話した内容から、物語の素材になる事実を拾い出す。

拾ってよいもの:
- 本人が実際に口にしたこと。言い換えてよい。逐語でなくてよい
- 本人が「〜だった」「〜と思った」と言ったことは、そのまま拾ってよい

拾ってはいけないもの:
- 本人が話していないことの追加。推測で埋めない
- 本人が言っていない内面の断定

ほかの決まり:
- それぞれ40字以内
- 該当する項目だけ返す。無理に全部埋めない
- category と slot は、下の一覧にある文字列をそのまま使う。
  一覧にない名前を作らない

例:
  「営業先の人がよくしてくれて、発注ももらった」
    → characters.relation  営業先の人がよくしてくれた
    → events.happened      発注をもらった
  「あれは自信になった。今もスーツを捨てられない」
    → aftermath.changed    自信になった
    → aftermath.remains    今もスーツを捨てられずにいる

拾う項目の一覧:`;

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
  const first = await runFacetPass(messages, oneLineMemory, false);
  if (first.length > 0) return first;

  /*
   * 0件だったときだけ、もう一度だけ拾い直す。
   *
   * ⚠ 会話に材料があるのに0件だと、進捗も不足表示も動かず体験が死ぬ。
   *   0件は「本当に何も無い」より「拾い損ねた」ほうが多い。
   * ⚠ 追加の呼び出しは失敗したときだけ。通常は1回のまま。
   */
  console.warn("facet retry", { reason: "first pass returned 0" });
  return runFacetPass(messages, oneLineMemory, true);
}

async function runFacetPass(
  messages: SourceTurn[],
  oneLineMemory: string | null,
  permissive: boolean
): Promise<ExtractedFacet[]> {
  const client = getOpenAI();
  if (!client) return [];

  const source = [userText(messages), oneLineMemory ?? ""].join("\n").trim();
  if (!source) return [];

  try {
    const res = await client.chat.completions.create({
      model: MODELS.extraction,
      messages: [
        {
          role: "system",
          content: [
            FACET_SYSTEM,
            "",
            facetInstruction(),
            permissive
              ? "\n一度目は1件も拾えなかった。本人がはっきり口にしたことは、言い換えて構わないので必ず拾うこと。"
              : "",
          ].join("\n"),
        },
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
    const kept = facets.filter((f) => {
      if (!isNarrativeCategory(f.category)) return false;
      if (!CATEGORY_SLOTS[f.category].some((d) => d.slot === f.slot)) return false;
      return typeof f.value === "string" && f.value.trim().length > 0;
    });

    /*
     * ⚠ 捨てた件数を必ず残す。
     *   ここが黙って捨てていたため「0件なのは抽出が弱いから」なのか
     *   「名前が合わずに落ちているから」なのかが分からなかった。
     *   ⚠ value はログに出さない（本人の記憶そのものなので）。
     */
    if (kept.length < facets.length) {
      console.warn("facets dropped", {
        returned: facets.length,
        kept: kept.length,
        names: facets
          .filter((f) => !kept.includes(f))
          .map((f) => `${f.category}.${f.slot}`),
      });
    }
    if (kept.length === 0) {
      console.warn("facets empty", { returned: facets.length });
    }
    return kept;
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
