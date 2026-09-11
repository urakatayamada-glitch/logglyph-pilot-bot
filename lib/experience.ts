/**
 * 体験条件（experience_variant）。
 *
 * src（流入記事）とは別の軸で持つ。
 *   src                … どの記事から来たか
 *   experience_variant … 会話後に何を見せたか
 *
 * ⚠ ここは lib/conversation/ ではない。
 *   Conversation Engine v1.5.1 / gpt-4o / Episode / Prompt には一切触れない。
 *   会話そのものは baseline と memory_receipt_v1 で完全に同一である。
 */

export const EXPERIENCE_VARIANTS = ["baseline", "memory_receipt_v1"] as const;
export type ExperienceVariant = (typeof EXPERIENCE_VARIANTS)[number];

export const DEFAULT_VARIANT: ExperienceVariant = "baseline";

export function isExperienceVariant(v: unknown): v is ExperienceVariant {
  return (
    typeof v === "string" && (EXPERIENCE_VARIANTS as readonly string[]).includes(v)
  );
}

/**
 * 環境変数から、いま新しく始まるセッションに与える条件を決める。
 *
 * ⚠ 既存セッションの再開には使わない。再開では保存済みの値を読む。
 *   途中でフラグを切り替えたときに、同じ会話の条件が変わってしまうため。
 */
export function resolveExperienceVariant(env: string | undefined): ExperienceVariant {
  return env === "1" ? "memory_receipt_v1" : "baseline";
}

export const MEMORY_RECEIPT_ENABLED = process.env.MEMORY_RECEIPT_ENABLED === "1";

/** 表示用。Admin の見出しに使う。 */
export const VARIANT_LABELS: Record<ExperienceVariant, string> = {
  baseline: "baseline（Future Preview）",
  memory_receipt_v1: "memory_receipt_v1（Memory Receipt）",
};
