"use client";

import { useState } from "react";

/**
 * Future Preview を見たあとに聞く4問（Wave 1 のみ）。
 *
 * Wave 0 と同条件の評価（話しやすさ / また話したい）は
 * この面より前に送信済み。順序を分けているのは、
 * 「続けるとこう育ちます」を見せたあとに「また話したい？」を聞くと
 * 数字が必ず上がり、Wave 0 の 59% と比較できなくなるため。
 *
 *   A（Preview前の また話したい） = Conversation Pull
 *   B（この4問）                  = Future Value / Curiosity Pull
 *   C（実際の再訪）               = Actual Behavior
 */
export const WAVE1_QUESTIONS = [
  { key: "future_curiosity", label: "この先どうなるのか気になった" },
  { key: "want_to_accumulate", label: "もう少し自分の記録を貯めてみたいと思った" },
  {
    key: "want_five_day_insight",
    label: "5日後に「自分の経験から見つかったこと」を見てみたい",
  },
  {
    key: "understood_continuation_value",
    label: "LOGGLYPHを続ける意味が分かった",
  },
] as const;

export type Wave1Answers = Partial<
  Record<(typeof WAVE1_QUESTIONS)[number]["key"], number>
>;

export default function Wave1Survey({
  onSend,
}: {
  onSend: (answers: Wave1Answers | null) => void;
}) {
  const [answers, setAnswers] = useState<Wave1Answers>({});
  const [sent, setSent] = useState(false);

  if (sent) return <p className="thanks">ありがとう。またね。</p>;

  return (
    <div className="w1">
      <p className="w1-h">あと4つだけ</p>
      <p className="w1-lead">
        いまの画面を見て、どう感じたか。答えたくないものは飛ばして大丈夫です。
      </p>
      <div className="w1-scale">
        <span>1 = そう思わない</span>
        <span>5 = そう思う</span>
      </div>

      {WAVE1_QUESTIONS.map((q) => (
        <div key={q.key}>
          <p className="rating-q">{q.label}</p>
          <div className="rating-row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className={answers[q.key] === n ? "chip on" : "chip"}
                onClick={() => setAnswers((a) => ({ ...a, [q.key]: n }))}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="rating-actions">
        <button
          className="primary"
          onClick={() => {
            onSend(Object.keys(answers).length > 0 ? answers : null);
            setSent(true);
          }}
        >
          送る
        </button>
        <button
          className="ghost"
          onClick={() => {
            onSend(null);
            setSent(true);
          }}
        >
          答えずに閉じる
        </button>
      </div>
    </div>
  );
}
