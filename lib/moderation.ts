import { getOpenAI } from "./conversation/engine";

export interface ModerationResult {
  flagged: boolean;
  categories: string[];
  /** 自傷・自殺に関する高確度の反応。会話継続を止める判断に使う */
  selfHarmCritical: boolean;
}

const EMPTY: ModerationResult = {
  flagged: false,
  categories: [],
  selfHarmCritical: false,
};

/** 自傷系カテゴリで、これを超えたら会話を止めて相談先を案内する */
const SELF_HARM_THRESHOLD = 0.5;

/**
 * OpenAI Moderation API による判定。無料。
 *
 * Pilot規模で実効性のある最小限のSafety対策として使う。
 * 判定に失敗した場合は会話を止めない（誤って体験を壊さないため）。
 */
export async function moderate(text: string): Promise<ModerationResult> {
  const client = getOpenAI();
  if (!client || !text.trim()) return EMPTY;

  try {
    const result = await client.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });
    const r = result.results[0];
    if (!r) return EMPTY;

    const categories = Object.entries(r.categories)
      .filter(([, hit]) => hit)
      .map(([name]) => name);

    const scores = r.category_scores as unknown as Record<string, number>;
    const selfHarmCritical = [
      "self-harm",
      "self-harm/intent",
      "self-harm/instructions",
    ].some((k) => (scores[k] ?? 0) >= SELF_HARM_THRESHOLD);

    return { flagged: r.flagged, categories, selfHarmCritical };
  } catch {
    return EMPTY;
  }
}
