import Link from "next/link";
import { requireAdmin } from "../../../lib/admin-guard";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { listCandidateSessions } from "../../../lib/reading/load";
import ReadingBenchRunner from "../../../components/ReadingBenchRunner";

/**
 * Reading Engine Benchmark。
 *
 * Gate の内容：
 *   Claude が手で強い Reading を書けること **ではなく**、
 *   製品が自動でそれを出せること。
 */
export const dynamic = "force-dynamic";

export default async function ReadingBenchPage() {
  await requireAdmin();
  const supabase = getSupabaseAdmin();
  const sessions = await listCandidateSessions(3);
  const { data: runs } = supabase
    ? await supabase
        .from("reading_bench_runs")
        .select("id, created_at, session_ids, attrition, model")
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] as Array<Record<string, unknown>> };

  return (
    <main className="admin">
      <div className="admin-head">
        <h1>Reading Engine Benchmark</h1>
        <Link href="/admin" className="admin-back">
          ← 一覧へ
        </Link>
      </div>

      <p style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.9 }}>
        生ログと Trigger を入力に、Signal 抽出 → 読み候補3件 → 根拠の接地検査 →
        Barnum 差し替え検査 → 4軸評価 → 最強1件を Open Bet として選ぶ、までを自動で行います。
        <br />
        <strong>一般論を出すくらいなら棄却します。</strong>
        ただし「出さないことで失敗を避けていないか」を見るため、
        どこで何件落ちたかを必ず記録します。
      </p>

      {sessions.length === 0 && (
        <p className="admin-error">対象になるセッションがありません。</p>
      )}

      <ReadingBenchRunner sessions={sessions} />

      <h2 style={{ marginTop: 40, fontSize: 14 }}>過去の実行</h2>
      <table className="admin-table">
        <thead>
          <tr>
            <th>実行日時</th>
            <th>件数</th>
            <th>Open Bet</th>
            <th>Coverage</th>
            <th>Model</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {((runs ?? []) as Array<Record<string, unknown>>).map((r) => {
            const a = (r.attrition ?? {}) as Record<string, number>;
            const n = (r.session_ids as string[] | null)?.length ?? 0;
            const bets = a.openBets ?? 0;
            return (
              <tr key={String(r.id)}>
                <td>{new Date(String(r.created_at)).toLocaleString("ja-JP")}</td>
                <td>{n}</td>
                <td>{bets}</td>
                <td>{n ? `${Math.round((bets / n) * 100)}%` : "—"}</td>
                <td>{String(r.model ?? "—")}</td>
                <td>
                  <Link href={`/admin/reading-bench/${r.id}/blind`}>Blind評価</Link>
                  {"　"}
                  <Link href={`/admin/reading-bench/${r.id}`}>結果</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
