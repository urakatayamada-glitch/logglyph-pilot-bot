/**
 * LOGGLYPH Conversation Engine - 設定値
 *
 * ここの数値はPilot中の調整対象です。
 * 環境変数にしていないのは、Vercelの環境変数変更が再デプロイを伴い、
 * 「数値だけ少し変えて試す」というPilot中の運用に向かないためです。
 */

/** Prompt / Conversation Engine のバージョン。prompt文言を変えたら必ず更新する。 */
export const PROMPT_VERSION = "v1.3.1";

/**
 * 会話の長さに関する閾値（すべて「ユーザーの発話数」で数える）
 *
 * AIは十分な素材が得られたと判断すれば、これらを待たずいつでも終了できる。
 * 下記はあくまで「暴走防止」と「そろそろ締める方向への誘導」のための線。
 */
export const CONVERSATION_LIMITS = {
  /** この数に達するまでは、AIは自然終了を急がない（目安） */
  naturalCloseTarget: 4,
  /** この数を超えたら、AIへ「そろそろ締める方向で」と伝える */
  wrapUpHint: 6,
  /**
   * この数に達したら、サーバー側が終了専用モードへ強制的に切り替える。
   *
   * v1.1.0で10→8に短縮。実際の会話で、記憶が語られ終わったあともAIが
   * 新しい話題を探し続け、話題が3つに増えてしまったため。
   * 一つの記憶を扱い終えるのに必要な往復は4〜6程度だった。
   */
  hardLimit: 8,
} as const;

/** 1クライアントが1日に開始できるセッション数の上限 */
export const RATE_LIMITS = {
  sessionsPerClientPerDay: 10,
  sessionsPerIpPerDay: 30,
} as const;

/** 直近この件数のEpisodeは再提示しない（同じ人が繰り返し試したときの重複回避） */
export const RECENT_EPISODE_MEMORY = 8;

export const MODELS = {
  /**
   * 会話用。
   *
   * v1.3.0 で gpt-4o-mini から gpt-4o へ変更した。
   * miniでは「質問を毎回しない」「一般論を述べない」「返事に困る発話をしない」
   * といった否定形の指示を守りきれず、実機テストで毎ターン質問・感嘆符連発・
   * 持論の開示が繰り返された。prompt側の強化では収束しなかったため。
   *
   * 環境変数 OPENAI_MODEL で上書きできるので、コストを抑えたい場合は
   * gpt-4o-mini に戻せる（会話品質は落ちる）。
   */
  conversation: process.env.OPENAI_MODEL || "gpt-4o",
  /**
   * 構造化抽出用。1セッションに1回だけの呼び出しなので、
   * 会話用より上位のモデルを既定にしている（Memory Extraction Yieldが最重要指標のため）。
   */
  extraction: process.env.OPENAI_EXTRACTION_MODEL || "gpt-4o",
} as const;

/** Memory Trigger Category（STAGE 1.2 仕様 §5） */
export const MEMORY_TRIGGER_CATEGORIES = [
  "regret",
  "embarrassment",
  "romance",
  "work",
  "friendship",
  "family",
  "challenge",
  "jealousy",
  "failure",
  "success",
  "fear",
  "surprise",
  "nostalgia",
  "desire",
  "decision",
  "aging",
  "health",
  "school",
  "money",
  "dream",
] as const;

export type MemoryTriggerCategory = (typeof MEMORY_TRIGGER_CATEGORIES)[number];
