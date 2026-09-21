"use client";

import { useState } from "react";

/**
 * Benchmark の実行。1セッションずつ順に叩く。
 *
 * ⚠ まとめて1リクエストにしない。サーバーレスの実行時間上限に当たるため。
 *   1件ずつにすると、どこで止まったかも分かる。
 */

export interface RunnerSession {
  sessionId: string;
  startedAt: string;
  category: string | null;
  promptVersion: string | null;
  userMessageCount: number;
  isInternal: boolean;
}

type Phase = "idle" | "running" | "done" | "error";

export default function ReadingBenchRunner({
  sessions,
  previousIds = [],
}: {
  sessions: RunnerSession[];
  /** 直前の実行で使ったセッション。前回と同じ条件で比べるため */
  previousIds?: string[];
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  const internalPicked = sessions.filter((s) => picked.has(s.sessionId) && s.isInternal).length;
  const testerPicked = picked.size - internalPicked;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /*
   * 推奨の選び方：山田さんのログを最大10件、残りをテスターで埋めて合計20件。
   * ⚠ 第1回では山田さんのログが3件しか無く、「10 + 10」のつもりが「3 + 18」になっていた。
   *   足りないときは、画面にそのまま出す（黙って埋めない）。
   */
  const internalAvailable = sessions.filter((s) => s.isInternal).length;
  function pickPrevious() {
    const avail = new Set(sessions.map((s) => s.sessionId));
    setPicked(new Set(previousIds.filter((id) => avail.has(id))));
  }

  function pickRecommended() {
    const internal = sessions.filter((s) => s.isInternal).slice(0, 10);
    const tester = sessions.filter((s) => !s.isInternal).slice(0, 20 - internal.length);
    setPicked(new Set([...internal, ...tester].map((s) => s.sessionId)));
  }

  async function post(body: unknown) {
    const res = await fetch("/api/reading-bench/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function start() {
    const ids = sessions.filter((s) => picked.has(s.sessionId)).map((s) => s.sessionId);
    if (ids.length === 0) return;
    setPhase("running");
    setLog([`${ids.length}件で開始します。`]);

    const started = await post({ action: "start", sessionIds: ids });
    if (!started.ok) {
      setLog((l) => [...l, `開始できませんでした：${started.error}`]);
      setPhase("error");
      return;
    }
    setRunId(started.runId);

    for (let i = 0; i < ids.length; i++) {
      const r = await post({ action: "step", runId: started.runId, index: i });
      if (!r.ok) {
        setLog((l) => [...l, `${i + 1}/${ids.length} 失敗：${r.error}`]);
        continue;
      }
      const mark = r.hasOpenBet ? "Open Bet 1件" : "棄却（0件）";
      setLog((l) => [
        ...l,
        `${i + 1}/${ids.length}　候補${r.candidates ?? 0}件 → ${mark}${r.error ? `　⚠ ${r.error}` : ""}`,
      ]);
    }

    const fin = await post({ action: "finish", runId: started.runId });
    setLog((l) => [
      ...l,
      fin.ok
        ? `Blind評価シートを${fin.sheets}件作りました。` +
          (fin.swappedMissing ? `（うち${fin.swappedMissing}件は、別の人の読みが無いため2択です）` : "")
        : `シート作成に失敗：${fin.error}`,
    ]);
    setPhase("done");
  }

  return (
    <section style={{ marginTop: 24 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        {previousIds.length > 0 && (
          <button type="button" onClick={pickPrevious} disabled={phase === "running"}>
            前回と同じ{previousIds.length}件を選ぶ
          </button>
        )}
        <button type="button" onClick={pickRecommended} disabled={phase === "running"}>
          推奨の20件を選ぶ
        </button>
        <button type="button" onClick={start} disabled={phase === "running" || picked.size === 0}>
          {phase === "running" ? "実行中…" : `この${picked.size}件で実行`}
        </button>
        <span style={{ color: "var(--ink)", fontSize: 12 }}>
          選択中：山田 {internalPicked} / テスター {testerPicked}
          {internalAvailable < 10 && (
            <>
              {"　"}⚠ 対象にできる山田さんのログは {internalAvailable} 件だけです（発話3回以上）
            </>
          )}
        </span>
      </div>

      {log.length > 0 && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid var(--line)",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.9,
            color: "var(--ink)",
          }}
        >
          {log.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          {phase === "done" && runId && (
            <div style={{ marginTop: 10 }}>
              <a href={`/admin/reading-bench/${runId}`}>結果を見る</a>
              {"　"}
              <a href={`/admin/reading-bench/${runId}/blind`}>Blind評価へ</a>
              <div style={{ marginTop: 6 }}>
                ⚠ 先に「結果を見る」を開くと、どれがエンジンの出力か分かってしまいます。
                Blind評価を先に済ませてください。
              </div>
            </div>
          )}
        </div>
      )}

      <table className="admin-table" style={{ marginTop: 20 }}>
        <thead>
          <tr>
            <th></th>
            <th>開始</th>
            <th>出所</th>
            <th>Category</th>
            <th>発話数</th>
            <th>Prompt</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.sessionId}>
              <td>
                <input
                  type="checkbox"
                  checked={picked.has(s.sessionId)}
                  onChange={() => toggle(s.sessionId)}
                  disabled={phase === "running"}
                />
              </td>
              <td>{new Date(s.startedAt).toLocaleString("ja-JP")}</td>
              <td>{s.isInternal ? "山田" : "テスター"}</td>
              <td>{s.category ?? "—"}</td>
              <td>{s.userMessageCount}</td>
              <td>{s.promptVersion ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
