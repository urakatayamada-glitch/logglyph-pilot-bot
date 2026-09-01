"use client";

import { ReactNode, useState } from "react";
import FuturePreview from "./FuturePreview";
import Wave1Survey, { Wave1Answers } from "./Wave1Survey";

/**
 * 会話終了後の表示。
 *
 * 「今日はここで終わった」と直感的に分かることが目的。
 * 評価は任意回答。答えずに離れても正常。
 *
 * v1.5.0 で3段階にした。順序には理由がある（Wave 1 指示書 ①／⑨）。
 *
 *   1. rating  : Wave 0 と完全に同条件の評価
 *   2. preview : Future Preview
 *   3. survey  : Preview を見たあとの4問
 *
 * 「また話したい」を Preview の前に取ることで、Wave 0 の 59% と
 * 比較できる状態を保つ。Preview のあとに聞くと、良くなったのが
 * 会話なのか提示された未来なのか区別できなくなる。
 */
type Stage = "rating" | "preview" | "survey";

export default function ConversationComplete({
  oneLineMemory,
  onRate,
  onFollowup,
  crisis,
  memoryCount,
  recentMemories,
  restartSlot,
}: {
  oneLineMemory: string | null;
  onRate: (rating: number | null, again: boolean | null) => void;
  onFollowup: (answers: Wave1Answers | null) => void;
  crisis: boolean;
  memoryCount: number | null;
  recentMemories: string[];
  /**
   * 「別の話をする」。最後の段階に来るまで出さない。
   * 評価の段階で出すと、Future Preview と追加設問を飛ばして
   * やり直せてしまい、Wave 1 で一番見たい回答が取れなくなる。
   */
  restartSlot?: ReactNode;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [again, setAgain] = useState<boolean | null>(null);
  const [stage, setStage] = useState<Stage>("rating");

  // 危機対応で終了した会話では、評価もログ表示も出さない
  if (crisis) return null;

  /** 評価を送って（または飛ばして）、Future Preview へ進む */
  const finishRating = (r: number | null, a: boolean | null) => {
    onRate(r, a);
    setStage("preview");
  };

  return (
    <div className="complete">
      {oneLineMemory && (
        <div className="memory-card">
          <div className="memory-label">今日のログ</div>
          <div className="memory-body">{oneLineMemory}</div>
        </div>
      )}

      {stage === "rating" && (
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
            <button className="primary" onClick={() => finishRating(rating, again)}>
              送る
            </button>
            <button className="ghost" onClick={() => finishRating(null, null)}>
              答えずに閉じる
            </button>
          </div>
        </div>
      )}

      {stage !== "rating" && (
        <>
          <FuturePreview
            memoryCount={memoryCount}
            recentMemories={recentMemories}
          />
          {stage === "preview" ? (
            <div className="rating-actions">
              <button className="primary" onClick={() => setStage("survey")}>
                次へ
              </button>
            </div>
          ) : (
            <>
              <Wave1Survey onSend={onFollowup} />
              {restartSlot}
            </>
          )}
        </>
      )}
    </div>
  );
}
