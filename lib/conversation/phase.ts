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
 * 相槌だけの返事か（新しい材料を含んでいないか）。
 *
 * 「うん」「わかる」だけで会話を終えてしまうのが v1.4.0 / v1.5.0 の
 * 最大の問題だった。相槌は「終わりの合図」ではなく
 * 「AI側のボール待ち」であることが多い。
 */
export function isThinAgreement(text: string): boolean {
  const t = text.trim();
  if (t.length > 10) return false;
  return /^(うん+|ええ|はい|そう(だね|ですね|そう)?|わかる|分かる|確かに|たしかに|なるほど|そっか|そうかも|だね|ですね|了解|オーケー|オッケー|ok|OK|w+|笑)[。、．，！!？?\s]*$/.test(
    t
  );
}

/**
 * 直前のユーザー発話が、掘れる材料を新しく出したか。
 *
 * 材料が出ている間は、続けて質問してよい（Deep Dive）。
 * 相槌しか返ってこないなら、質問を重ねても掘れない。
 */
export function userAddedMaterial(messages: ChatMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    const t = messages[i].content.trim();
    return t.length >= 6 && !isThinAgreement(t);
  }
  return false;
}

/**
 * 末尾から連続しているAIの質問ターン数。
 *
 * **冒頭Episodeは数えない。** ここが v1.5.0 までの致命的な欠陥だった。
 * Episodeの結びは必ず「〜ある？」で終わるため、素朴に「直前のAI発話に
 * ？が含まれるか」で判定すると、AIは1回目の応答で必ず質問を禁止される。
 * 平均往復数が2.4なので、多くの会話でAIは一度も質問できないまま終わっていた。
 * Question Turn Rate を測るときに冒頭Episodeを分母から除いているのと
 * 同じ理由で、こちらも除く必要がある。
 */
export function trailingAssistantQuestionTurns(messages: ChatMessage[]): number {
  const firstAssistant = messages.findIndex((m) => m.role === "assistant");
  let count = 0;
  for (let i = messages.length - 1; i > firstAssistant; i--) {
    if (messages[i].role !== "assistant") continue;
    const t = messages[i].content;
    if (t.includes("？") || t.includes("?")) count += 1;
    else break;
  }
  return count;
}

/** 続けて質問してよい上限。これを超えると尋問になる。 */
export const MAX_CONSECUTIVE_QUESTIONS = 2;

/**
 * 今回のターンで質問を禁止すべきか。
 *
 * 「質問と質問の間に必ず1ターン挟む」という v1.4.0 の機械的制約は、
 * しつこさを止める一方で Deep Dive も止めてしまった。
 * v1.5.1 では、相手が材料を出し続けている間だけ連続を許す。
 *
 *   ・冒頭Episodeの「？」は数えない
 *   ・材料が出ているなら、2回までは連続して聞ける
 *   ・相槌しか返っていない、または既に2回続けて聞いたら禁止
 */
export function shouldBlockQuestion(messages: ChatMessage[]): boolean {
  const trailing = trailingAssistantQuestionTurns(messages);
  if (trailing === 0) return false;
  if (trailing >= MAX_CONSECUTIVE_QUESTIONS) return true;
  return !userAddedMaterial(messages);
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
