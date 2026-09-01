"use client";

import { useEffect, useState } from "react";

/**
 * 初回導入「LOGGLYPHとは」。
 *
 * 説明画面ではなく、プロローグとして読ませる。
 * 長文をスクロールさせず、一文ずつ出して消す。
 *
 * 文面は Product Owner 決定（Wave 1 指示書 改善1）。
 * STEP 4 の「情報資産」は硬い語だと認識したうえで採用しており、
 * UI側（文字サイズ・囲みを作らない・行間）で和らげている。
 */
const LINES = [
  "過去のあなたは、\n未来のあなたを助けてくれる。",
  "毎日の会話には、\n忘れていた経験や、大切にしてきたことが眠っています。",
  "LOGGLYPHは、\nそれをひとつずつ見つけて、積み重ねていく場所です。",
  "積み重ねた会話は、あなただけの記録になり、\nあなただけの情報資産へと育っていきます。\n未来のあなたを支えたり、\nあなただけの物語へとつながっていきます。",
  "これは、まだ完成していません。\n会話を重ねるたびに、\n少しずつ育っていきます。",
];

/** 1文あたりの自動送り（ミリ秒）。文字数に応じて伸ばす。 */
function holdMs(text: string): number {
  return Math.min(9000, 3200 + text.length * 90);
}

export default function Intro({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const last = index >= LINES.length - 1;

  // フェードイン
  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [index]);

  // 自動送り。最後の一文では止めて「はじめる」を待つ。
  useEffect(() => {
    if (last) return;
    const t = setTimeout(() => {
      setVisible(false);
      const n = setTimeout(() => setIndex((i) => i + 1), 700);
      return () => clearTimeout(n);
    }, holdMs(LINES[index]));
    return () => clearTimeout(t);
  }, [index, last]);

  /** タップで次へ。急かさないが、待たせもしない。 */
  const next = () => {
    if (last) return;
    setVisible(false);
    setTimeout(() => setIndex((i) => i + 1), 260);
  };

  return (
    <div className="intro" onClick={next}>
      <p className={visible ? "intro-line show" : "intro-line"}>
        {LINES[index]}
      </p>

      <div className={visible ? "intro-foot show" : "intro-foot"}>
        {last ? (
          <button
            className="primary"
            onClick={(e) => {
              e.stopPropagation();
              onDone();
            }}
          >
            はじめる
          </button>
        ) : (
          <>
            <span className="intro-hint">タップで次へ</span>
            <span className="intro-dots">
              {LINES.map((_, i) => (
                <i key={i} className={i <= index ? "on" : ""} />
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
