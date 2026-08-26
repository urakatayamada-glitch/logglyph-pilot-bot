import { CONVERSATION_LIMITS } from "./config";

/**
 * 会話フェーズ。
 *
 * サーバーは会話の状態を保持せず、毎リクエストで履歴から再計算する。
 * Vercelのサーバーレス環境で状態を持つと不安定になるため。
 */
export type ConversationPhase =
  /** まだユーザーが一度も話していない。AIがEpisodeを話す段階 */
  | "OPENING"
  /** 通常の会話。AIは十分と判断すればいつでも終了できる */
  | "EXPLORING"
  /** そろそろ締める方向へAIを誘導する */
  | "WRAP_UP"
  /** サーバーが終了を強制する。AIの判断に関わらず、このターンで会話を締める */
  | "CLOSING";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/**
 * 直前のAI発話が質問だったかどうか。
 *
 * 「質問と質問の間に、質問しないターンを1つ挟む」というルールは
 * promptのお願いでは守られなかった（実測で質問率75%）。
 * そこでサーバー側で判定し、その場限りの絶対制約として毎ターン渡す。
 */
export function lastAssistantAskedQuestion(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const t = messages[i].content;
    return t.includes("？") || t.includes("?");
  }
  return false;
}

/** 履歴の中のユーザー発話数を数える */
export function countUserMessages(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

/**
 * ユーザー発話数からフェーズを決定する。
 *
 * この関数は純粋関数なので、ネットワークなしでテストできる。
 */
export function resolvePhase(userMessageCount: number): ConversationPhase {
  if (userMessageCount <= 0) return "OPENING";
  if (userMessageCount >= CONVERSATION_LIMITS.hardLimit) return "CLOSING";
  if (userMessageCount >= CONVERSATION_LIMITS.wrapUpHint) return "WRAP_UP";
  return "EXPLORING";
}

/**
 * AIに「会話を終える」判断を委ねてよいフェーズかどうか。
 *
 * CLOSINGではサーバーが強制終了するため、AIの判断は問わない。
 */
export function canAiChooseToClose(phase: ConversationPhase): boolean {
  return phase === "EXPLORING" || phase === "WRAP_UP";
}

/** 会話履歴から集計値を出す（Analytics用） */
export function summarizeMessages(messages: ChatMessage[]) {
  let userChars = 0;
  let aiChars = 0;
  for (const m of messages) {
    if (m.role === "user") userChars += m.content.length;
    else aiChars += m.content.length;
  }
  return {
    messageCount: messages.length,
    userMessageCount: countUserMessages(messages),
    userCharCount: userChars,
    aiCharCount: aiChars,
  };
}
