import Link from "next/link";
import { requireAdmin } from "../../../../../lib/admin-guard";
import { getSupabaseAdmin } from "../../../../../lib/supabase-server";
import { isComplete } from "../../../../../lib/reading/blind";
import type { RatingRow } from "../../../../../lib/reading/blind";
import type { SessionResult } from "../../../../../lib/reading/types";
import BlindSheet from "../../../../../components/BlindSheet";
import type { BlindGroup } from "../../../../../components/BlindSheet";

/**
 * Blind 評価。
 *
 * ⚠ 対応表（どれがエンジンの出力か）は、**全項目に回答が入るまで出さない。**
 *   同じモデルが生成して同じモデルが採点すると自己採点になる。
 *   だから最終判定は人間が行う。その人間に先に答えを見せたら、同じことが起きる。
 */
export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  open_bet: "エンジンの Open Bet",
  decoy: "固定デコイ（一般論）",
  swapped: "他人の読み（差し替え）",
};

export default async function BlindPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  await requireAdmin();
  const { runId } = await params;
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return (
      <main className="admin">
        <p className="admin-error">SUPABASE_SERVICE_ROLE_KEY が未設定です。</p>
      </main>
    );
  }

  const [{ data: run }, { data: rows }] = await Promise.all([
    supabase.from("reading_bench_runs").select("id, results").eq("id", runId).maybeSingle(),
    supabase
      .from("reading_bench_ratings")
      .select("session_id, slot, kind, text, verdict")
      .eq("run_id", runId)
      .order("session_id", { ascending: true })
      .order("slot", { ascending: true }),
  ]);

  if (!run) {
    return (
      <main className="admin">
        <p className="admin-error">この実行の記録がありません。</p>
      </main>
    );
  }

  const results = (run.results as SessionResult[]) ?? [];
  const triggerById = new Map(results.map((r) => [r.input.sessionId, r.input.trigger]));
  const all = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    sessionId: String(r.session_id),
    slot: String(r.slot),
    kind: r.kind as RatingRow["kind"],
    text: String(r.text ?? ""),
    verdict: (r.verdict as RatingRow["verdict"]) ?? null,
  }));

  const complete = isComplete(all);

  // ⚠ kind はここで落とす。クライアントへ渡さない
  const groups: BlindGroup[] = [];
  for (const r of all) {
    let g = groups.find((x) => x.sessionId === r.sessionId);
    if (!g) {
      g = { sessionId: r.sessionId, trigger: triggerById.get(r.sessionId) ?? "", items: [] };
      groups.push(g);
    }
    g.items.push({ sessionId: r.sessionId, slot: r.slot, text: r.text, verdict: r.verdict });
  }

  return (
    <main className="admin">
      <div className="admin-head">
        <h1>Blind 評価</h1>
        <Link href="/admin/reading-bench" className="admin-back">
          ← Benchmark へ
        </Link>
      </div>

      {all.length === 0 && <p className="admin-error">評価する項目がありません。</p>}

      <BlindSheet runId={runId} groups={groups} />

      {complete && (
        <section style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 14 }}>対応表</h2>
          <p style={{ color: "var(--ink)", fontSize: 12 }}>
            すべて回答されたので開示します。
          </p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>セッション</th>
                <th>枠</th>
                <th>正体</th>
                <th>あなたの判定</th>
              </tr>
            </thead>
            <tbody>
              {all.map((r) => (
                <tr key={`${r.sessionId}:${r.slot}`}>
                  <td>{r.sessionId.slice(0, 8)}</td>
                  <td>{r.slot}</td>
                  <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td>{r.verdict}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 12 }}>
            <Link href={`/admin/reading-bench/${runId}`}>集計を見る</Link>
          </p>
        </section>
      )}
    </main>
  );
}
