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
} from "../lib/profile";

/**
 * 最終ユーザーテスト用のプロフィール（profile_v1）。
 *
 * ── 位置 ──────────────────────────────────────────────
 * Story Preview を見たあと。会話前・Entry には絶対に置かない。
 * 「はじめる」を押した人の約半分が一言も発話しない離脱があり、
 * そこに新しい変数を足すと Entry Pull / Conversation Pull が読めなくなる。
 *
 * ── 3ステップにした理由（2026-09-13）──────────────────
 * 1画面に5問すべてを縦に並べたところ、選択肢だけで24個になり、
 * アンケート感が強すぎた。操作回数は変わっていないが、
 * ⚠ 心理負荷に効くのは操作回数ではなく画面の長さ。
 *   1画面あたりの選択肢を減らすこと。設問を減らすことではない。
 *
 * ── 原則 ──────────────────────────────────────────────
 * ⚠ 主役は Story Preview。これは付け足しであって、強制しない。
 * ⚠ 必須項目は1つも無い。どのステップでもスキップできる。
 * ⚠ 各ステップごとに保存する。STEP 2 で離脱しても STEP 1 は残る。
 *   まとめて最後に送ると、分割したせいでデータが減る。
 * ⚠ 同じ人には原則1回だけ。しつこく出すと、いちばん見たい指標
 *   （再訪）そのものを壊す。
 * ⚠ 自由記述欄は作らない（Product Decision 2026-09-13）。
 */
const LAST_STEP = 3;

export default function ProfileSurvey({ clientToken }: { clientToken: string | null }) {
  const [a, setA] = useState<ProfileAnswers>(emptyAnswers());
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);
  const shown = useRef(false);

  // 表示したこと自体を記録する。これが無いと
  // 「出していない人」と「出したが無反応だった人」を後から区別できない。
  useEffect(() => {
    if (shown.current || !clientToken) return;
    shown.current = true;
    post(clientToken, { action: "shown" });
  }, [clientToken]);

  if (done) return <p className="thanks">ありがとう。またね。</p>;

  const toggle = <K extends "states" | "motives">(key: K, v: ProfileAnswers[K][number]) =>
    setA((prev) => {
      const list = prev[key] as string[];
      const next = list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
      return { ...prev, [key]: next } as ProfileAnswers;
    });

  /** このステップぶんだけ送る。渡さなかった設問の列は触られない。 */
  const send = (answers: Record<string, unknown>) => {
    if (!clientToken) return;
    post(clientToken, { action: "answer", answers });
  };

  const next = () => {
    if (step === 1) send({ states: a.states });
    if (step === 2) send({ motives: a.motives });
    if (step === 3) {
      send({ reflectHabit: a.reflectHabit, ageBand: a.ageBand, gender: a.gender });
      setDone(true);
      return;
    }
    setStep(step + 1);
  };

  const skip = () => {
    // ⚠ ここまでに答えたぶんは捨てない。断ったのは「この先」だけ。
    if (clientToken) post(clientToken, { action: "decline" });
    setDone(true);
  };

  return (
    <div className="w1">
      <p className="profile-h">
        あと30秒だけ <span className="profile-step">{step} / {LAST_STEP}</span>
      </p>
      {/*
        ⚠ この説明文は外さないこと。
          「なぜ聞かれるのか」が無いまま属性を聞かれると、
          体験の最後が「詮索された」で終わる。
      */}
      {step === 1 && (
        <p className="profile-lead">
          今回の実験で、どんな人にこの体験が合うのか確かめるため、
          もう少しだけ教えてください。
          <br />
          答えたくないものは飛ばして大丈夫です。
        </p>
      )}

      {step === 1 && (
        <>
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
        </>
      )}

      {step === 2 && (
        <>
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
        </>
      )}

      {step === 3 && (
        <>
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
        </>
      )}

      <div className="rating-actions">
        <button className="primary" onClick={next}>
          {step === LAST_STEP ? "送る" : "次へ"}
        </button>
        {/* ⚠ スキップは全ステップに出す。途中で降りられなくしない */}
        <button className="ghost" onClick={skip}>
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
