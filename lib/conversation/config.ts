/**
 * LOGGLYPH Conversation Engine - 設定値
 *
 * ここの数値はPilot中の調整対象です。
 * 環境変数にしていないのは、Vercelの環境変数変更が再デプロイを伴い、
 * 「数値だけ少し変えて試す」というPilot中の運用に向かないためです。
 */

/** Prompt / Conversation Engine のバージョン。prompt文言を変えたら必ず更新する。 */
export const PROMPT_VERSION = "v1.5.1";

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

/**
 * Wave 2（Controlled Open Pilot）の上限。
 *
 * 「先着30名」と「日次30件」は別の仕組みなので混ぜない。
 *   cohortTotalSessions   … コホートの定義そのもの。達したら受付終了
 *   cohortDailySessions   … コホート内の日次上限
 *   globalDailySessions   … サービス全体のヒューズ。通常は発火しない
 *
 * globalDailySessions を cohortTotalSessions より大きく取っているのは、
 * コホートが枠を使い切った日に運営側の動作確認まで塞がれるのを避けるため。
 * 費用の歯止めは cohortTotalSessions（実測 約7円/セッション）と
 * OpenAI 側の Auto-reload 月間上限の二重で効く。
 *
 * src が一致しないアクセス（知人コホート・運営のテスト）はコホート上限の対象外。
 * つまり ?src を外せばコホート上限は回避できる。Pilotではこれを許容する
 * （note の読者はリンクをそのまま踏むため）。完全な閉鎖が必要になったら
 * 招待コード方式へ切り替える。
 */
export const PUBLIC_PILOT = {
  /** 環境変数で切る。既定は無効（知人コホートの運用を変えない） */
  enabled: process.env.PUBLIC_PILOT_ENABLED === "1",
  /** この src を持つセッションだけがコホート上限の対象 */
  src: process.env.PUBLIC_PILOT_SRC || "note_wave2",
  cohortTotalSessions: numFromEnv("PUBLIC_PILOT_TOTAL", 30),
  cohortDailySessions: numFromEnv("PUBLIC_PILOT_DAILY", 30),
  cohortSessionsPerClientPerDay: numFromEnv("PUBLIC_PILOT_PER_CLIENT_DAILY", 1),
  globalDailySessions: numFromEnv("PUBLIC_PILOT_GLOBAL_DAILY", 50),
} as const;

/** 上限に達したときに画面へ出す文言（会話は始めず、APIも呼ばない） */
export const CAPACITY_MESSAGES = {
  cohortTotal: "今回のテスト参加枠は終了しました。また別の機会に開きます。",
  cohortDaily: "本日のテスト参加枠は終了しました。また明日開きます。",
  perClientDaily: "今日はここまでにしておこう。また明日話そう。",
  globalDaily: "いまアクセスが集中しています。少し時間を置いて開いてみてください。",
} as const;

function numFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 直近この件数のEpisodeは再提示しない。
 *
 * 8だと、5日×2回で同じ人に同じ話が回ってくる確率が高かった。
 * 有効なEpisodeを増やすのに合わせて20へ。
 * 「前にも同じ事聞かれた」は一度でやる気を削ぐので、ここは広く取る。
 */
export const RECENT_EPISODE_MEMORY = 20;

export const MODELS = {
  /**
   * 会話用。
   *
   * v1.3.0 で gpt-4o-mini から gpt-4o へ変更した。
   * miniでは「質問を毎回しない」「一般論を述べない」「返事に困る発話をしない」
   * といった否定形の指示を守りきれず、実機テストで毎ターン質問・感嘆符連発・
   * 持論の開示が繰り返された。prompt側の強化では収束しなかったため。
   *
   * v1.3.2 で環境変数を分離した。
   *   OPENAI_CONVERSATION_MODEL … 会話用（新規・こちらを優先）
   *   OPENAI_MODEL              … 旧変数。既存のVercel設定を壊さないため後方互換で参照
   *
   * Pilot期間中は snapshot 固定を推奨（可変エイリアスだとモデル側の更新で
   * 挙動が変わり、prompt_version ごとの比較が成立しなくなる）。
   * 固定する場合は OPENAI_CONVERSATION_MODEL に snapshot 名を設定する。
   */
  conversation:
    process.env.OPENAI_CONVERSATION_MODEL || process.env.OPENAI_MODEL || "gpt-4o",
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
