"use client";

import { useState } from "react";
import { VERDICT_LABELS } from "../lib/reading/blind";
import type { Verdict } from "../lib/reading/blind";

/**
 * Blind 評価シート。
 *
 * ⚠ どれがエンジンの出力かは、**このコンポーネントに渡していない。**
 *   画面に出さないのではなく、そもそも持たせない。
 *   持たせると、いつか表示に混ざる。
 */

export interface BlindItem {
  sessionId: string;
  slot: string;
  text: string;
  verdict: Verdict | null;
}

export interface BlindGroup {
  sessionId: string;
  trigger: string;
  items: BlindItem[];
}

const ORDER: Verdict[] = ["sees", "only_me", "generic"];

export default function BlindSheet({
  runId,
  groups,
}: {
  runId: string;
  groups: BlindGroup[];
}) {
  const [state, setState] = useState<Record<string, Verdict>>(() => {
    const init: Record<string, Verdict> = {};
    for (const g of groups) {
      for (const it of g.items) {
        if (it.verdict) init[`${g.sessionId}:${it.slot}`] = it.verdict;
      }
    }
    return init;
  });
  const [saving, setSaving] = useState<string | null>(null);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const done = Object.keys(state).length;

  async function choose(sessionId: string, slot: string, verdict: Verdict) {
    const key = `${sessionId}:${slot}`;
    setState((p) => ({ ...p, [key]: verdict }));
    setSaving(key);
    await fetch("/api/reading-bench/rate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, sessionId, slot, verdict }),
    });
    setSaving(null);
  }

  return (
    <div>
      <p style={{ color: "var(--ink)", fontSize: 13, lineHeight: 1.9 }}>
        それぞれの文章について、いちばん近いものを1つ選んでください。
        <br />
        <strong>
          どれがエンジンの出力かは、全部答え終わるまで表示されません。
        </strong>
        先に結果画面を開かないでください。
      </p>
      <p className="admin-sub">
        {done} / {total} 件 回答済み
      </p>

      {groups.map((g) => (
        <section
          key={g.sessionId}
          style={{
            marginTop: 24,
            padding: 14,
            border: "1px solid var(--line)",
            borderRadius: 8,
            color: "var(--ink)",
            fontSize: 13,
            lineHeight: 1.9,
          }}
        >
          <div className="admin-sub">この会話で投げかけた話題</div>
          <div style={{ marginBottom: 10 }}>{g.trigger || "（記録なし）"}</div>

          {g.items.map((it) => {
            const key = `${g.sessionId}:${it.slot}`;
            const current = state[key];
            return (
              <div key={it.slot} style={{ marginTop: 14 }}>
                <strong>{it.slot}</strong>
                <p style={{ margin: "4px 0 6px" }}>{it.text}</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {ORDER.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => choose(g.sessionId, it.slot, v)}
                      disabled={saving === key}
                      style={{
                        fontSize: 12,
                        padding: "4px 10px",
                        border: "1px solid var(--line-strong)",
                        borderRadius: 999,
                        background: current === v ? "rgba(255,255,255,.95)" : "transparent",
                        fontWeight: current === v ? 600 : 400,
                        color: "var(--ink)",
                      }}
                    >
                      {VERDICT_LABELS[v]}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
