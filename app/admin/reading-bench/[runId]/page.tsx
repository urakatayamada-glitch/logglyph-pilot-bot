import Link from "next/link";
import { requireAdmin } from "../../../../lib/admin-guard";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { coverage, SIGNAL_LABELS } from "../../../../lib/reading/types";
import type { Attrition, SessionResult } from "../../../../lib/reading/types";
import { rollup, VERDICT_LABELS } from "../../../../lib/reading/blind";
import type { RatingRow } from "../../../../lib/reading/blind";

/**
 * Benchmark の結果。
 *
 * ⚠ 4つを必ず**一緒に**出す（Product Decision 2026-09-20）。
 *   1. Reading の質      2. Barnum 耐性
 *   3. 本人 Blind 評価    4. 強い Reading を生成できた Coverage
 *
 *   質だけを見ると、「出さないことで失敗を避けている」状態を見逃す。
 */
export const dynamic = "force-dynamic";

const DROP_LABELS: Record<string, string> = {
  grounding: "根拠が生ログに無い",
  no_assertion: "言い切っていない",
  barnum_lexicon: "一般論の語",
  barnum_swap: "他人にも当てはまった",
  surprise_echo: "本人の発言の言い換え",
};

export default async function RunResult({
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

  const [{ data: run }, { data: ratingRows }] = await Promise.all([
    supabase
      .from("reading_bench_runs")
      .select("id, created_at, model, engine_version, session_ids, attrition, results")
      .eq("id", runId)
      .maybeSingle(),
    supabase
      .from("reading_bench_ratings")
      .select("session_id, slot, kind, verdict")
      .eq("run_id", runId),
  ]);

  if (!run) {
    return (
      <main className="admin">
        <p className="admin-error">この実行の記録がありません。</p>
      </main>
    );
  }

  const results = (run.results as SessionResult[]) ?? [];
  const a = (run.attrition ?? {}) as Attrition;
  const ratings = ((ratingRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    sessionId: String(r.session_id),
    slot: String(r.slot),
    kind: r.kind as RatingRow["kind"],
    verdict: (r.verdict as RatingRow["verdict"]) ?? null,
  }));
  const blind = rollup(ratings);

  const bets = results.filter((r) => r.openBet);
  const mean = (pick: (r: SessionResult) => number) =>
    bets.length === 0 ? 0 : bets.reduce((s, r) => s + pick(r), 0) / bets.length;
  const internal = results.filter((r) => r.input.isInternal);
  const tester = results.filter((r) => !r.input.isInternal);
  const cov = (list: SessionResult[]) =>
    list.length === 0 ? "—" : `${Math.round((list.filter((r) => r.openBet).length / list.length) * 100)}%`;
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

  return (
    <main className="admin">
      <div className="admin-head">
        <h1>Benchmark 結果</h1>
        <Link href="/admin/reading-bench" className="admin-back">
          ← Benchmark へ
        </Link>
      </div>
      <p className="admin-sub">
        {new Date(String(run.created_at)).toLocaleString("ja-JP")}　
        {String(run.engine_version)}　{String(run.model)}
      </p>

      {/* ---------- 1. Coverage ---------- */}
      <h2 style={{ fontSize: 14, marginTop: 28 }}>① Coverage（強い読みを出せた割合）</h2>
      <table className="admin-table">
        <tbody>
          <tr>
            <td>全体</td>
            <td>
              {a.openBets ?? 0} / {a.sessions ?? 0}（{Math.round(coverage(a) * 100)}%）
            </td>
          </tr>
          <tr>
            <td>山田さんのログ</td>
            <td>
              {internal.filter((r) => r.openBet).length} / {internal.length}（{cov(internal)}）
            </td>
          </tr>
          <tr>
            <td>テスターのログ</td>
            <td>
              {tester.filter((r) => r.openBet).length} / {tester.length}（{cov(tester)}）
            </td>
          </tr>
          <tr>
            <td>1件も出せなかったセッション</td>
            <td>{a.sessionsWithNoOpenBet ?? 0}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- 2. Attrition ---------- */}
      <h2 style={{ fontSize: 14, marginTop: 28 }}>② どこで落ちたか（Candidate Attrition）</h2>
      <p style={{ color: "var(--ink)", fontSize: 12, lineHeight: 1.9 }}>
        一般論を出すくらいなら棄却でよい。ただし
        <strong>「出さないこと」で失敗を避けていないか</strong>をここで見る。
      </p>
      <table className="admin-table">
        <tbody>
          <tr>
            <td>生成された候補</td>
            <td>{a.candidatesGenerated ?? 0}</td>
          </tr>
          <tr>
            <td>根拠が生ログに無い</td>
            <td>{a.droppedByGrounding ?? 0}</td>
          </tr>
          <tr>
            <td>言い切っていない</td>
            <td>{a.droppedByNoAssertion ?? 0}</td>
          </tr>
          <tr>
            <td>一般論の語</td>
            <td>{a.droppedByBarnumLexicon ?? 0}</td>
          </tr>
          <tr>
            <td>他人にも当てはまった（差し替え）</td>
            <td>{a.droppedByBarnumSwap ?? 0}</td>
          </tr>
          <tr>
            <td>本人の発言の言い換え</td>
            <td>{a.droppedBySurpriseEcho ?? 0}</td>
          </tr>
          <tr>
            <td>検査を通った候補</td>
            <td>{a.survived ?? 0}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- 3. 質 ---------- */}
      <h2 style={{ fontSize: 14, marginTop: 28 }}>③ Reading の質（Open Bet の平均）</h2>
      <table className="admin-table">
        <tbody>
          <tr>
            <td>Evidence</td>
            <td>{mean((r) => r.openBet!.score!.evidence).toFixed(2)}</td>
          </tr>
          <tr>
            <td>Specificity</td>
            <td>{mean((r) => r.openBet!.score!.specificity).toFixed(2)}</td>
          </tr>
          <tr>
            <td>Risk</td>
            <td>{mean((r) => r.openBet!.score!.risk).toFixed(2)}</td>
          </tr>
          <tr>
            <td>Surprise</td>
            <td>{mean((r) => r.openBet!.score!.surprise).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- 4. Blind ---------- */}
      <h2 style={{ fontSize: 14, marginTop: 28 }}>④ Blind 評価</h2>
      {!blind.calibrationOk && (
        <p className="admin-error">
          ⚠ デコイを「一般論っぽい」と判定できた率が {pct(blind.decoyCaughtRate)} です。
          80% 未満のあいだ、①の数字は読まないでください。評価そのものが成立していません。
        </p>
      )}
      <table className="admin-table">
        <tbody>
          <tr>
            <td>回答済み</td>
            <td>
              {blind.rated} / {blind.total}
            </td>
          </tr>
          <tr>
            <td>エンジンの Open Bet が刺さった率</td>
            <td>{pct(blind.openBetHitRate)}（目標 60%）</td>
          </tr>
          <tr>
            <td>デコイを見抜けた率</td>
            <td>{pct(blind.decoyCaughtRate)}（目標 80%）</td>
          </tr>
          <tr>
            <td>他人の読みを退けた率</td>
            <td>{pct(blind.swappedRejectedRate)}（目標 60%）</td>
          </tr>
        </tbody>
      </table>

      {/* ---------- 個別 ---------- */}
      <h2 style={{ fontSize: 14, marginTop: 36 }}>セッションごと</h2>
      {results.map((r) => (
        <section
          key={r.input.sessionId}
          style={{
            marginTop: 20,
            padding: 14,
            border: "1px solid var(--line)",
            borderRadius: 8,
            color: "var(--ink)",
            fontSize: 13,
            lineHeight: 1.9,
          }}
        >
          <div className="admin-sub">
            {r.input.isInternal ? "山田" : "テスター"}　{r.input.category ?? "—"}　
            <Link href={`/admin/sessions/${r.input.sessionId}`}>会話を見る</Link>
          </div>
          <div style={{ marginTop: 6 }}>
            <strong>Trigger：</strong>
            {r.input.trigger || "（記録なし）"}
          </div>

          {r.error && <p className="admin-error">エラー：{r.error}</p>}

          {r.openBet ? (
            <div style={{ marginTop: 10 }}>
              <strong>OPEN BET</strong>
              <p>{r.openBet.candidate.text}</p>
              <div className="admin-sub">
                Evidence {r.openBet.score!.evidence} / Specificity {r.openBet.score!.specificity} /
                Risk {r.openBet.score!.risk} / Surprise {r.openBet.score!.surprise}　
                差し替え {r.openBet.swapYes}/{r.openBet.swapTested}
              </div>
            </div>
          ) : (
            <p style={{ marginTop: 10 }}>
              <strong>Open Bet なし（棄却）</strong>
            </p>
          )}

          <details style={{ marginTop: 10 }}>
            <summary>落ちた候補と、拾った手がかり</summary>
            <ul>
              {r.evaluated
                .filter((e) => e.dropped)
                .map((e, i) => (
                  <li key={i}>
                    <strong>{DROP_LABELS[e.dropped!] ?? e.dropped}</strong>：{e.candidate.text}
                  </li>
                ))}
            </ul>
            <ul>
              {r.signals.map((s) => (
                <li key={s.id}>
                  {SIGNAL_LABELS[s.kind]}　「{s.quote}」
                </li>
              ))}
            </ul>
          </details>
        </section>
      ))}

      <p className="admin-sub" style={{ marginTop: 28 }}>
        判定の内訳：{Object.values(VERDICT_LABELS).join(" / ")}
      </p>
    </main>
  );
}
