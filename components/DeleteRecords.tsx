"use client";

import { useCallback, useState } from "react";

const LS_CLIENT = "logglyph.client";

/**
 * 本人による削除。
 *
 * Product Decision（Wave 2 設計合意 §7）:
 *   内容は消す。匿名の集計値だけ残す。この扱いを画面に明記する。
 *
 * 文言は Product Owner 指定のものをそのまま使う。
 * 「残る場合があります」「できなくなる場合があります」という留保も含めて変えない。
 */
const NOTICE = [
  "削除すると会話内容はすべて消えます。利用回数や記憶が見つかったか等の匿名集計値だけ、どなたの記録か分からない形で残る場合があります。",
  "ブラウザのデータを削除すると、この端末を識別する情報も消えるため、あとから削除操作ができなくなる場合があります。",
];

type Stage = "closed" | "confirm" | "working" | "done" | "empty" | "error";

export default function DeleteRecords({ onDeleted }: { onDeleted?: () => void }) {
  const [stage, setStage] = useState<Stage>("closed");

  const run = useCallback(async () => {
    setStage("working");
    let token: string | null = null;
    try {
      const raw = localStorage.getItem(LS_CLIENT);
      token = raw ? (JSON.parse(raw) as string) : null;
    } catch {
      token = null;
    }
    if (!token) {
      // 端末の識別情報がすでに無い。注意書きで予告してある状態。
      setStage("empty");
      return;
    }
    try {
      const res = await fetch("/api/session/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⚠ トークンは body だけで渡す。URLに入れると履歴やログに残る。
        body: JSON.stringify({ clientToken: token, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok !== true) {
        setStage("error");
        return;
      }
      if ((data.deleted ?? 0) === 0) {
        setStage("empty");
        return;
      }
      // 端末側の控えも消す。残しておくと画面に古い内容が出続ける。
      try {
        localStorage.removeItem("logglyph.session");
        localStorage.removeItem(LS_CLIENT);
        localStorage.removeItem("logglyph.recentEpisodes");
      } catch {
        /* noop */
      }
      setStage("done");
      onDeleted?.();
    } catch {
      setStage("error");
    }
  }, [onDeleted]);

  if (stage === "closed") {
    return (
      <button className="danger-link" onClick={() => setStage("confirm")}>
        記録を削除する
      </button>
    );
  }

  if (stage === "done") {
    return <p className="del-msg">削除しました。会話内容は残っていません。</p>;
  }
  if (stage === "empty") {
    return (
      <p className="del-msg">
        この端末に紐づく記録は見つかりませんでした。
        <br />
        ブラウザのデータを消したあとは、こちらから削除できません。
      </p>
    );
  }
  if (stage === "error") {
    return (
      <p className="del-msg">
        削除できませんでした。時間を置いてもう一度お試しください。
      </p>
    );
  }

  return (
    <div className="del-box">
      {NOTICE.map((t) => (
        <p key={t}>{t}</p>
      ))}
      <p className="del-warn">この操作は取り消せません。</p>
      <div className="del-actions">
        <button
          className="danger"
          onClick={run}
          disabled={stage === "working"}
        >
          {stage === "working" ? "削除中…" : "削除する"}
        </button>
        <button className="about-link" onClick={() => setStage("closed")}>
          やめる
        </button>
      </div>
    </div>
  );
}
