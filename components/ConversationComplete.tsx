"use client";

import { useState } from "react";

/**
 * 会話終了後の表示。
 *
 * 「今日はここで終わった」と直感的に分かることが目的。
 * 評価は任意回答。答えずに離れても正常。
 */
export default function ConversationComplete({
  oneLineMemory,
  onRate,
  crisis,
}: {
  oneLineMemory: string | null;
  onRate: (rating: number | null, again: boolean | null) => void;
  crisis: boolean;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [sent, setSent] = useState(false);

  // 危機対応で終了した会話では、評価もログ表示も出さない
  if (crisis) return null;

  return (
    <div className="complete">
      {oneLineMemory && (
        <div className="memory-card">
          <div className="memory-label">今日のログ</div>
          <div className="memory-body">{oneLineMemory}</div>
        </div>
      )}

      {!sent ? (
        <div className="rating">
          <p className="rating-q">話しやすかった？</p>
          <div className="rating-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={rating === n ? "chip on" : "chip"}
                onClick={() => setRating(n)}
              >
                {n}
              </button>
            ))}
          </div>

          <p className="rating-q">また話したい？</p>
          <div className="rating-row">
            <button
              className={again === true ? "chip on" : "chip"}
              onClick={() => setAgain(true)}
            >
              はい
            </button>
            <button
              className={again === false ? "chip on" : "chip"}
              onClick={() => setAgain(false)}
            >
              いいえ
            </button>
          </div>

          <div className="rating-actions">
            <button
              className="primary"
              onClick={() => {
                onRate(rating, again);
                setSent(true);
              }}
            >
              送る
            </button>
            <button
              className="ghost"
              onClick={() => {
                onRate(null, null);
                setSent(true);
              }}
            >
              答えずに閉じる
            </button>
          </div>
        </div>
      ) : (
        <p className="thanks">ありがとう。またね。</p>
      )}
    </div>
  );
}
