/**
 * Blind 評価の集計。
 *
 * ⚠ ここで見るのは3本。**2本目がいちばん大事。**
 *   1. エンジンの Open Bet が「そこを見る？」「自分にしか当てはまらない」を得た率
 *   2. 固定デコイが「一般論っぽい」と判定された率   ← 評価そのものの妥当性
 *   3. 他人の Open Bet が「一般論っぽい」と判定された率（差し替えが効いているか）
 *
 *   2が低いということは、評価者がデコイを見抜けていないということ。
 *   そのとき1の数字には意味がない。**1より先に2を見る。**
 */

export type RatingKind = "open_bet" | "decoy" | "swapped";
export type Verdict = "sees" | "only_me" | "generic";

export const VERDICT_LABELS: Record<Verdict, string> = {
  sees: "そこを見る？",
  only_me: "自分にしか当てはまらない",
  generic: "一般論っぽい",
};

export interface RatingRow {
  sessionId: string;
  slot: string;
  kind: RatingKind;
  verdict: Verdict | null;
}

export interface BlindRollup {
  rated: number;
  total: number;
  /** 1. エンジンの Open Bet が刺さった率 */
  openBetHitRate: number | null;
  /** 2. デコイを一般論と見抜けた率（評価の妥当性） */
  decoyCaughtRate: number | null;
  /** 3. 他人の読みを一般論と判定した率 */
  swappedRejectedRate: number | null;
  /** 評価そのものが成立しているか（2が閾値未満なら成立していない） */
  calibrationOk: boolean;
}

export const THRESHOLDS = {
  openBetHit: 0.6,
  decoyCaught: 0.8,
  swappedRejected: 0.6,
} as const;

function rate(rows: RatingRow[], kind: RatingKind, ok: (v: Verdict) => boolean): number | null {
  const scoped = rows.filter((r) => r.kind === kind && r.verdict);
  if (scoped.length === 0) return null;
  return scoped.filter((r) => ok(r.verdict as Verdict)).length / scoped.length;
}

export function rollup(rows: RatingRow[]): BlindRollup {
  const decoyCaughtRate = rate(rows, "decoy", (v) => v === "generic");
  return {
    rated: rows.filter((r) => r.verdict).length,
    total: rows.length,
    openBetHitRate: rate(rows, "open_bet", (v) => v === "sees" || v === "only_me"),
    decoyCaughtRate,
    swappedRejectedRate: rate(rows, "swapped", (v) => v === "generic"),
    calibrationOk: decoyCaughtRate !== null && decoyCaughtRate >= THRESHOLDS.decoyCaught,
  };
}

/** すべての項目に回答が入ったか。入るまで対応表を見せない */
export function isComplete(rows: RatingRow[]): boolean {
  return rows.length > 0 && rows.every((r) => Boolean(r.verdict));
}
