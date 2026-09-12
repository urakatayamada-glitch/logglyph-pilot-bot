import { getSupabaseAdmin } from "./supabase-server";
/*
 * 抽選の優先度だけを決める純関数は lib/story.ts に置いている。
 * このファイルは DB を読むため node:test から直接 import できない。
 * 判定ロジックを検証可能な側へ寄せておく。
 */
import { preferredPool } from "./story";

export interface MemoryTriggerEpisode {
  id: string;
  body: string;
  category: string;
  source_type: "seed" | "ai_generated" | "user_memory";
  /** 物語のどの部分を引き出しやすいか。未設定の Episode は null */
  narrative_categories?: string[] | null;
}

/**
 * DBが未設定・空の場合でも会話が始められるようにするための最終手段。
 *
 * ⚠ 本文はSeed Episodeのどれとも重複させないこと。
 *   重複していると「DBから取れた」のか「フォールバックに落ちた」のかを
 *   画面から判別できず、設定ミスの切り分けができなくなる。
 */
const FALLBACK_EPISODE: MemoryTriggerEpisode = {
  id: "fallback",
  body:
    "今日さ、ちょっと聞いた話なんだけど。\n" +
    "傘を持って出た日に限って晴れて、置いてきた日に限って降る、というのが何年も続いてる人がいるらしくて。\n" +
    "本人は「もう自分のせいだと思ってる」って言ってた。\n" +
    "そういう、自分だけずっと当たらないことってある？",
  category: "surprise",
  source_type: "seed",
};

/**
 * Episodeを1件選ぶ。
 *
 * excludeIds は「同じ人が繰り返し試したときに同じ話が出る」のを避けるためのもの。
 * アカウント機構がないため、クライアントのlocalStorageから渡される。
 * 除外した結果が空になった場合は、除外を無視して選び直す（枯渇時のフォールバック）。
 */
export async function pickEpisode(
  excludeIds: string[] = [],
  sourceType: "seed" | "ai_generated" = "seed",
  /**
   * いま不足している物語カテゴリ。
   *
   * Story Preview で「登場人物がまだ見えていない」と伝えておきながら、
   * 次回に全く関係のない Episode が出ると体験が切れる。
   * それを避けるための優先抽選。
   *
   * ⚠ 会話のしかた（Conversation Engine）は一切変えていない。
   *   変わるのは「どの話題から入るか」の抽選の重みだけ。
   * ⚠ 絞り込みではなく優先。該当が無ければ従来どおり全体から選ぶ。
   */
  preferCategories: string[] = []
): Promise<MemoryTriggerEpisode> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return FALLBACK_EPISODE;

  const { data, error } = await supabase
    .from("memory_trigger_episodes")
    .select("id, body, category, source_type, narrative_categories")
    .eq("is_active", true)
    .eq("source_type", sourceType);

  if (error || !data || data.length === 0) return FALLBACK_EPISODE;

  const episodes = data as MemoryTriggerEpisode[];
  const excluded = new Set(excludeIds);
  const fresh = episodes.filter((e) => !excluded.has(e.id));
  const base = fresh.length > 0 ? fresh : episodes;

  const pool = preferredPool(base, preferCategories);
  return pool[Math.floor(Math.random() * pool.length)];
}

