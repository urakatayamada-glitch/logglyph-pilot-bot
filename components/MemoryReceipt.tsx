"use client";

import { useEffect, useRef } from "react";

/**
 * Memory Receipt（memory_receipt_v1）。
 *
 * Product Decision（2026-09-11）:
 *   検証したいのは
 *     「将来何が受け取れるかを予告する体験」ではなく
 *     「今日話した記憶が、実際にひとつの記録として残ったことを確定して返す体験」
 *   の方が、利用価値の理解と Next-Day Return につながるか。
 *
 *   ⚠ 人格分析・観察文・仮説は生成しない。ここに出るのは本人の実データだけ。
 *   ⚠ Future Preview の3項目（知恵 / AIの理解 / 物語）はこの条件では出さない。
 *     予告して終わる画面が Wave 1 の「最後にどうなるのかわからなすぎて」を
 *     生んでいる可能性があり、それ自体が検証対象のため。
 *
 * 表示位置は Future Preview があった場所（評価のあと）。
 * 評価より前に出すと「また話したい」が Wave 0 の 59% と比較できなくなる。
 */
export default function MemoryReceipt({
  oneLineMemory,
  memoryCount,
  sessionId,
  clientToken,
}: {
  oneLineMemory: string | null;
  memoryCount: number | null;
  sessionId: string | null;
  clientToken: string | null;
}) {
  const sent = useRef(false);

  /*
   * 表示された事実を1回だけ記録する。
   * ⚠ OpenAI は呼ばない。⚠ トークンはURLに出さない（POSTのbodyのみ）。
   * サーバ側は session_id が主キーなので、再読み込みしても行は増えない。
   */
  useEffect(() => {
    if (sent.current) return;
    if (!sessionId || !clientToken) return;
    sent.current = true;
    try {
      void fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ sessionId, clientToken }),
      }).catch(() => undefined);
    } catch {
      /* 記録に失敗しても体験は壊さない */
    }
  }, [sessionId, clientToken]);

  return (
    <div className="receipt">
      <p className="receipt-h">今日、ひとつの記憶が残りました。</p>

      {oneLineMemory && <p className="receipt-mem">{oneLineMemory}</p>}

      {memoryCount != null && memoryCount > 0 && (
        <p className="receipt-count">
          これまでに見つかった記憶：<b>{memoryCount}</b>件
        </p>
      )}

      <p className="receipt-note">
        これは診断ではありません。
        <br />
        あなたが話してくれた内容から、
        <br />
        残しておける形にした記録です。
      </p>

      <p className="receipt-lead">
        記憶が少しずつ集まったとき、
        <br />
        そこから何が見えてくるのか。
        <br />
        LOGGLYPHでは、いまそれを確かめています。
      </p>
    </div>
  );
}
