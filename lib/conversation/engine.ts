import OpenAI from "openai";
import { MODELS } from "./config";
import {
  ChatMessage,
  ConversationPhase,
  canAiChooseToClose,
  countUserMessages,
  resolvePhase,
} from "./phase";
import { BASE_PROMPT } from "./prompts/base";
import {
  CLOSING_PROMPT,
  EXPLORING_PROMPT,
  SENSITIVE_TOPIC_PROMPT,
  WRAP_UP_PROMPT,
} from "./prompts/phases";
import {
  EXTRACTION_PROMPT,
  EXTRACTION_SCHEMA,
  StructuredMemory,
} from "./prompts/extraction";

let cachedClient: OpenAI | null = null;

export function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (!cachedClient) cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

function phaseInstruction(phase: ConversationPhase): string {
  switch (phase) {
    case "WRAP_UP":
      return WRAP_UP_PROMPT;
    case "CLOSING":
      return CLOSING_PROMPT;
    default:
      return EXPLORING_PROMPT;
  }
}

export function buildSystemPrompt(
  phase: ConversationPhase,
  opts: { sensitive?: boolean } = {}
): string {
  const parts = [BASE_PROMPT, phaseInstruction(phase)];
  if (opts.sensitive) parts.push(SENSITIVE_TOPIC_PROMPT);
  return parts.join("\n\n---\n\n");
}

/**
 * AIが「もう十分な素材が得られた」と判断したことを、構造的に受け取るためのツール。
 *
 * 返答テキストに合図の記号を埋め込む方式は、AIが書き忘れたり
 * ユーザーに見えてしまったりして壊れやすいため採用していない。
 */
const CLOSE_TOOL = {
  type: "function" as const,
  function: {
    name: "close_conversation",
    description:
      "一つの記憶について、何があったか・どう感じたかが相手の言葉で十分に語られたと判断したときに呼ぶ。まだ話が続きそうなときは呼ばない。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        reason: {
          type: "string",
          description: "終えてよいと判断した理由を短く",
        },
      },
      required: ["reason"],
    },
  },
};

export interface TurnResult {
  reply: string;
  completed: boolean;
  phase: ConversationPhase;
  /** AI自身の判断で終了したか（false かつ completed の場合はHard Limitによる終了） */
  closedByAi: boolean;
}

/**
 * 1ターン分の応答を生成する。
 *
 * CLOSING フェーズではAIの判断を問わず必ず completed:true を返すため、
 * AIが終了指示に従わなくても会話は確実に終わる。
 */
export async function runTurn(
  messages: ChatMessage[],
  opts: { sensitive?: boolean } = {}
): Promise<TurnResult> {
  const client = getOpenAI();
  if (!client) {
    return {
      reply: "AI接続の準備中です。OPENAI_API_KEYを設定してください。",
      completed: false,
      phase: "EXPLORING",
      closedByAi: false,
    };
  }

  const userCount = countUserMessages(messages);
  const phase = resolvePhase(userCount);

  const request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: MODELS.conversation,
    temperature: 0.72,
    messages: [
      { role: "system", content: buildSystemPrompt(phase, opts) },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  if (canAiChooseToClose(phase)) {
    request.tools = [CLOSE_TOOL];
    request.tool_choice = "auto";
  }

  const result = await client.chat.completions.create(request);
  const choice = result.choices[0];
  const toolCalls = choice?.message?.tool_calls ?? [];
  const wantsClose = toolCalls.some(
    (c) => "function" in c && c.function?.name === "close_conversation"
  );

  // AIが終了を選んだ場合は、締めの発話を専用promptで作り直す。
  if (wantsClose) {
    const closing = await client.chat.completions.create({
      model: MODELS.conversation,
      temperature: 0.7,
      messages: [
        { role: "system", content: buildSystemPrompt("CLOSING", opts) },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return {
      reply: closing.choices[0]?.message?.content?.trim() || fallbackClosing(),
      completed: true,
      phase: "CLOSING",
      closedByAi: true,
    };
  }

  const text = choice?.message?.content?.trim();

  // CLOSINGフェーズではAIの応答内容に関わらず終了させる（確実な終了の保証）
  if (phase === "CLOSING") {
    return {
      reply: text || fallbackClosing(),
      completed: true,
      phase,
      closedByAi: false,
    };
  }

  return {
    reply: text || "うん。",
    completed: false,
    phase,
    closedByAi: false,
  };
}

function fallbackClosing(): string {
  return "今日はこんな感じで残しておくね。\nまた話そう。";
}

/**
 * 会話ログから構造化データを抽出する。会話とは別工程・別モデル。
 *
 * 失敗しても会話の終了体験は壊さない（呼び出し側で握りつぶす）。
 */
export async function extractStructuredMemory(
  messages: ChatMessage[]
): Promise<StructuredMemory | null> {
  const client = getOpenAI();
  if (!client) return null;

  const transcript = messages
    .map((m) => `${m.role === "user" ? "相手" : "あなた"}: ${m.content}`)
    .join("\n");

  const result = await client.chat.completions.create({
    model: MODELS.extraction,
    temperature: 0.2,
    messages: [
      { role: "system", content: EXTRACTION_PROMPT },
      { role: "user", content: transcript },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "structured_memory",
        strict: true,
        schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
  });

  const raw = result.choices[0]?.message?.content;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StructuredMemory;
  } catch {
    return null;
  }
}
