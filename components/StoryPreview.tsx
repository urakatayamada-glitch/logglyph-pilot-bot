"use client";

import { useEffect, useRef } from "react";
import { CATEGORY_LABELS, NARRATIVE_CATEGORIES, NarrativeCategory } from "../lib/story";

/**
 * Story Preview（story_preview_v1）。
 *
 * ── Product Principle（内部設計。ユーザーに毎回説明するものではない）──
 *
 * ドラマは目的ではなく、記憶が集まり続けるための装置である。
 * ただしユーザーが「ドラマが面白いから使う」のは何も問題ない。
 * 画面上で「これは人文知のためです」と説明する必要はない。
 *
 * ⚠ ここで守るのは1つだけ。
 *   シーンは演出であって事実ではない、と画面上で分かるようにすること。
 *   本人の記憶そのものと、脚色されたシーンが同じものに見えてはいけない。
 */
export interface StoryData {
  fragment: string | null;
  scores: Record<string, number>;
  overall: number;
  changed: Array<{ category: string; from: number; to: number }>;
  missing: string[];
}

export default function StoryPreview({
  oneLineMemory,
  story,
  previousOverall,
  sessionId,
  clientToken,
}: {
  oneLineMemory: string | null;
  story: StoryData;
  previousOverall: number | null;
  sessionId: string | null;
  clientToken: string | null;
}) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    if (!sessionId || !clientToken) return;
    sent.current = true;
    try {
      void fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({ sessionId, clientToken }),
      }).catch(() => undefined);
    } catch {
      /* 記録に失敗しても体験は壊さない */
    }
  }, [sessionId, clientToken]);

  const changedMap = new Map(story.changed.map((c) => [c.category, c]));

  return (
    <div className="story">
      <p className="story-h">今日、ひとつの記憶が残りました。</p>
      {oneLineMemory && <p className="story-mem">{oneLineMemory}</p>}

      {story.fragment && (
        <>
          <p className="story-sub">今日のシーン</p>
          <div className="story-frag">
            {story.fragment.split("\n").map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
          {/*
            ⚠ この注記は外さないこと。
              演出と事実が同じものに見えると、本人の記憶が書き換わる。
          */}
          <p className="story-caveat">
            これはあなたが話した内容をもとにした演出です。事実そのものではありません。
          </p>
        </>
      )}

      <p className="story-sub">あなたのドラマをつくる材料</p>
      <p className="story-overall">
        {previousOverall != null && previousOverall < story.overall && (
          <span className="story-from">{previousOverall}% →</span>
        )}
        <b>{story.overall}</b>%
      </p>

      <ul className="story-bars">
        {NARRATIVE_CATEGORIES.map((c) => {
          const v = story.scores[c] ?? 0;
          const ch = changedMap.get(c);
          return (
            <li key={c}>
              <span className="story-cat">{CATEGORY_LABELS[c as NarrativeCategory]}</span>
              <span className="story-bar">
                <span className="story-bar-fill" style={{ width: `${v}%` }} />
              </span>
              <span className="story-val">
                {ch ? (
                  <>
                    <span className="story-from">{ch.from}% →</span> {v}%
                  </>
                ) : (
                  `${v}%`
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {story.missing.length > 0 && (
        <>
          <p className="story-sub">まだ見えていないもの</p>
          <ul className="story-missing">
            {story.missing.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
