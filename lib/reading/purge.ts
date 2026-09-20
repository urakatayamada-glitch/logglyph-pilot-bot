import type { SessionResult } from "./types.ts";

/**
 * 本人が記録を削除したとき、Benchmark の保存物からもその人の分を取り除く。
 *
 * ⚠ 0013（story_fragments / memory_facets）で同じ漏れを一度やっている。
 *   新しく人の発話を保持するテーブルを足したら、**同じ turn のうちに**
 *   削除経路へ足す。あとで足すことにすると、足されない。
 *
 * Benchmark が保持しているもの：
 *   - Signal の quote（本人の発話そのもの）
 *   - 生成された読み（本人について書かれた文章）
 *   - Blind 評価シートの本文
 *   いずれも「集計値」ではなく内容なので、**行ごと・要素ごと消す。**
 */

export function purgeSessionsFromResults(
  results: SessionResult[],
  sessionIds: string[]
): { kept: SessionResult[]; removed: number } {
  const ids = new Set(sessionIds);
  const kept = results.filter((r) => !ids.has(r.input.sessionId));
  return { kept, removed: results.length - kept.length };
}
