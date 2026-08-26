/**
 * Pilot Metrics の算出。
 *
 * すべて純粋関数として切り出している（ネットワーク不要でテストできる）。
 * 算出元は conversation_logs のみで、DBの追加変更は不要。
 */

export interface LogMessage {
  role: "user" | "assistant";
  content: string;
}

/** 全角・半角どちらの疑問符も質問として数える */
function hasQuestion(text: string): boolean {
  return text.includes("？") || text.includes("?");
}

/**
 * Spontaneous Continuation Proxy の閾値。
 *
 * 「うん」「そうだね」「了解」程度の相槌を除外し、
 * 自発的に語り足した発話だけを拾うための下限。
 */
export const SPONTANEOUS_MIN_CHARS = 20;

export interface ConversationMetrics {
  aiMessageCount: number;
  userMessageCount: number;
  aiCharCount: number;
  userCharCount: number;
  /** AI 1発話あたりの平均文字数 */
  aiAvgCharsPerMessage: number | null;

  /**
   * 冒頭Episode（1つ目のAI発話）の文字数。
   *
   * Episodeは固定のseed文であり、AIの振る舞いではない。
   * 平均103文字あるため、4往復程度の会話では
   * AI側文字数の半分近くをEpisodeが占めてしまう。
   */
  episodeCharCount: number;
  /** Episodeを除いたAI側の文字数（＝実際の応答だけ） */
  dialogueAiCharCount: number;
  /**
   * 会話中の発話量に占めるユーザーの割合。
   *
   * 分母からEpisodeを除いている。Question Turn Rate と同じ扱い。
   * 「User / AI 文字比」はEpisodeを含むため、会話が短いほど
   * AI優勢に見える偏りがあった。
   */
  userDialogueShare: number | null;

  /**
   * Question Turn Rate。
   * AI発話のうち「？」を含むものの割合。
   *
   * 冒頭のEpisode（1つ目のAI発話）は除外している。
   * Episodeの末尾の問いかけは固定の種であり、AIの振る舞いではないため。
   */
  questionTurns: number;
  questionEligibleTurns: number;
  questionTurnRate: number | null;

  /**
   * Spontaneous Continuation Proxy（代理指標）。
   *
   * AIが質問しなかった発話の直後に、ユーザーが
   * SPONTANEOUS_MIN_CHARS 文字以上を話した回数。
   *
   * 「意味が追加されたか」は機械判定できないため、発話量による代理指標。
   * 真に記憶が追加されたことを保証しない。
   */
  spontaneousContinuations: number;
  spontaneousOpportunities: number;
  spontaneousContinuationRate: number | null;
}

export function computeConversationMetrics(
  messages: LogMessage[]
): ConversationMetrics {
  let aiMessageCount = 0;
  let userMessageCount = 0;
  let aiCharCount = 0;
  let userCharCount = 0;
  let episodeCharCount = 0;
  let seenEpisode = false;

  for (const m of messages) {
    if (m.role === "assistant") {
      aiMessageCount += 1;
      aiCharCount += m.content.length;
      if (!seenEpisode) {
        episodeCharCount = m.content.length;
        seenEpisode = true;
      }
    } else {
      userMessageCount += 1;
      userCharCount += m.content.length;
    }
  }

  // Question Turn Rate：冒頭のEpisodeは除外する
  let seenFirstAssistant = false;
  let questionTurns = 0;
  let questionEligibleTurns = 0;

  // Spontaneous Continuation Proxy
  let spontaneousContinuations = 0;
  let spontaneousOpportunities = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== "assistant") continue;

    const isEpisode = !seenFirstAssistant;
    seenFirstAssistant = true;

    if (!isEpisode) {
      questionEligibleTurns += 1;
      if (hasQuestion(m.content)) questionTurns += 1;
    }

    // 質問しなかったAI発話の直後にユーザー発話があるか
    if (!hasQuestion(m.content)) {
      const next = messages[i + 1];
      if (next && next.role === "user") {
        spontaneousOpportunities += 1;
        if (next.content.length >= SPONTANEOUS_MIN_CHARS) {
          spontaneousContinuations += 1;
        }
      }
    }
  }

  const dialogueAiCharCount = aiCharCount - episodeCharCount;
  const dialogueTotal = dialogueAiCharCount + userCharCount;

  return {
    aiMessageCount,
    userMessageCount,
    aiCharCount,
    userCharCount,
    aiAvgCharsPerMessage:
      aiMessageCount > 0 ? aiCharCount / aiMessageCount : null,
    episodeCharCount,
    dialogueAiCharCount,
    userDialogueShare: dialogueTotal > 0 ? userCharCount / dialogueTotal : null,
    questionTurns,
    questionEligibleTurns,
    questionTurnRate:
      questionEligibleTurns > 0 ? questionTurns / questionEligibleTurns : null,
    spontaneousContinuations,
    spontaneousOpportunities,
    spontaneousContinuationRate:
      spontaneousOpportunities > 0
        ? spontaneousContinuations / spontaneousOpportunities
        : null,
  };
}

/** 複数セッションぶんを合算する（Admin一覧の集計用） */
export function aggregateMetrics(
  perSession: ConversationMetrics[]
): ConversationMetrics {
  const sum = perSession.reduce(
    (a, m) => ({
      aiMessageCount: a.aiMessageCount + m.aiMessageCount,
      userMessageCount: a.userMessageCount + m.userMessageCount,
      aiCharCount: a.aiCharCount + m.aiCharCount,
      userCharCount: a.userCharCount + m.userCharCount,
      episodeCharCount: a.episodeCharCount + m.episodeCharCount,
      dialogueAiCharCount: a.dialogueAiCharCount + m.dialogueAiCharCount,
      questionTurns: a.questionTurns + m.questionTurns,
      questionEligibleTurns: a.questionEligibleTurns + m.questionEligibleTurns,
      spontaneousContinuations:
        a.spontaneousContinuations + m.spontaneousContinuations,
      spontaneousOpportunities:
        a.spontaneousOpportunities + m.spontaneousOpportunities,
    }),
    {
      aiMessageCount: 0,
      userMessageCount: 0,
      aiCharCount: 0,
      userCharCount: 0,
      episodeCharCount: 0,
      dialogueAiCharCount: 0,
      questionTurns: 0,
      questionEligibleTurns: 0,
      spontaneousContinuations: 0,
      spontaneousOpportunities: 0,
    }
  );

  return {
    ...sum,
    aiAvgCharsPerMessage:
      sum.aiMessageCount > 0 ? sum.aiCharCount / sum.aiMessageCount : null,
    userDialogueShare:
      sum.dialogueAiCharCount + sum.userCharCount > 0
        ? sum.userCharCount / (sum.dialogueAiCharCount + sum.userCharCount)
        : null,
    questionTurnRate:
      sum.questionEligibleTurns > 0
        ? sum.questionTurns / sum.questionEligibleTurns
        : null,
    spontaneousContinuationRate:
      sum.spontaneousOpportunities > 0
        ? sum.spontaneousContinuations / sum.spontaneousOpportunities
        : null,
  };
}
