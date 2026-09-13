"use client";

import { useEffect, useRef, useState } from "react";
import {
  AGE_BANDS,
  AGE_BAND_LABELS,
  GENDERS,
  GENDER_LABELS,
  MOTIVES,
  MOTIVE_LABELS,
  REFLECT_HABITS,
  REFLECT_HABIT_LABELS,
  STATES,
  STATE_LABELS,
  ProfileAnswers,
  emptyAnswers,
  hasAnyAnswer,
} from "../lib/profile";

/**
 * 最終ユーザーテスト用のプロフィール（profile_v1）。
 *
 * ── 位置 ──────────────────────────────────────────────
 * Story Preview を見たあと。会話前・Entry には絶対に置かない。
 * 「はじめる」を押した人の約半分が一言も発話しない離脱があり、
 * そこに新しい変数を足すと Entry Pull / Conversation Pull が読めなくなる。
 *
 * ── 原則 ──────────────────────────────────────────────
 * ⚠ 主役は Story Preview。これは付け足しであって、強制しない。
 * ⚠ 必須項目は1つも無い。全部飛ばして閉じられる。
 * ⚠ 同じ人には原則1回だけ。回答済み・スキップ済みなら次回以降は出さない。
 *   しつこく出すと、いちばん見たい指標（再訪）そのものを壊す。
 * ⚠ 自由記述欄は作らない（Product Decision 2026-09-13）。
 */
type Sent = "none" | "answered" | "declined";

export default function ProfileSurvey({ clientToken }: { clientToken: string | null }) {
  const [a, setA] = useState<ProfileAnswers>(emptyAnswers());
  const [sent, setSent] = useState<Sent>("none");
  const shown = useRef(false);

  // 表示したこと自体を記録する。これが無いと
  // 「出していない人」と「出したが無反応だった人」を後から区別できない。
  useEffect(() => {
    if (shown.current || !clientToken) return;
    shown.current = true;
    post(clientToken, { action: "shown" });
  }, [clientToken]);

  if (sent !== "none") {
    return <p className="thanks">ありがとう。またね。</p>;
  }

  const toggle = <K extends "states" | "motives">(key: K, v: ProfileAnswers[K][number]) =>
    setA((prev) => {
      const list = prev[key] as string[];
      const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
      return { ...prev, [key]: next } as ProfileAnswers;
    });

  return (
    <div className="w1">
      <p className="profile-h">もう少しだけ</p>
      {/*
        ⚠ この説明文は外さないこと。
          「なぜ聞かれるのか」が無いまま属性を聞かれると、
          体験の最後が「詮索された」で終わる。
      */}
      <p className="profile-lead">
        今回の実験で、どんな人にこの体験が合うのか確かめるため、
        もう少しだけ教えてください。
        <br />
        答えたくないものは飛ばして大丈夫です。
      </p>

      <p className="rating-q">今の自分に近いもの（いくつでも）</p>
      <div className="w1-choices">
        {STATES.map((s) => (
          <button
            key={s}
            className={a.states.includes(s) ? "chip wide on" : "chip wide"}
            onClick={() => toggle("states", s)}
          >
            {STATE_LABELS[s]}
          </button>
        ))}
      </div>

      <p className="rating-q">試してみようと思った理由（いくつでも）</p>
      <div className="w1-choices">
        {MOTIVES.map((m) => (
          <button
            key={m}
            className={a.motives.includes(m) ? "chip wide on" : "chip wide"}
            onClick={() => toggle("motives", m)}
          >
            {MOTIVE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* 短い選択肢は横並び。縦に積むと画面が無意味に伸びる */}
      <p className="rating-q">普段、自分のことを振り返ったり記録したりしますか</p>
      <div className="rating-row">
        {REFLECT_HABITS.map((r) => (
          <button
            key={r}
            className={a.reflectHabit === r ? "chip on" : "chip"}
            onClick={() =>
              setA((p) => ({ ...p, reflectHabit: p.reflectHabit === r ? null : r }))
            }
          >
            {REFLECT_HABIT_LABELS[r]}
          </button>
        ))}
      </div>

      <p className="rating-q">年代</p>
      <div className="rating-row">
        {AGE_BANDS.map((g) => (
          <button
            key={g}
            className={a.ageBand === g ? "chip on" : "chip"}
            onClick={() => setA((p) => ({ ...p, ageBand: p.ageBand === g ? null : g }))}
          >
            {AGE_BAND_LABELS[g]}
          </button>
        ))}
      </div>

      <p className="rating-q">性別</p>
      <div className="rating-row">
        {GENDERS.map((g) => (
          <button
            key={g}
            className={a.gender === g ? "chip on" : "chip"}
            onClick={() => setA((p) => ({ ...p, gender: p.gender === g ? null : g }))}
          >
            {GENDER_LABELS[g]}
          </button>
        ))}
      </div>

      <div className="rating-actions">
        <button
          className="primary"
          onClick={() => {
            if (clientToken) {
              post(clientToken, hasAnyAnswer(a)
                ? { action: "answer", answers: a }
                : { action: "decline" });
            }
            setSent("answered");
          }}
        >
          回答する
        </button>
        <button
          className="ghost"
          onClick={() => {
            if (clientToken) post(clientToken, { action: "decline" });
            setSent("declined");
          }}
        >
          今回はスキップ
        </button>
      </div>
    </div>
  );
}

/** ⚠ トークンは body のみ。URL には絶対に載せない。失敗しても体験は壊さない。 */
function post(clientToken: string, payload: Record<string, unknown>) {
  try {
    void fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ clientToken, ...payload }),
    }).catch(() => undefined);
  } catch {
    /* noop */
  }
}
