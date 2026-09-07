"use client";

import { useCallback, useEffect, useState } from "react";
import DeleteRecords from "./DeleteRecords";

const LS_CLIENT = "logglyph.client";

/**
 * 「あなたが話してくれたこと」
 *
 * Product Decision（Wave 2 設計合意 §4〜§6）:
 *   - 「5日間」「複数Memoryの共通点」は使わない。全員が記憶1件のため成立しない
 *   - 観察文は自動生成しない。承認済み（approved = true）のテキストだけ出す
 *   - 人格診断・性格断定は禁止
 *   - 記憶0件の人には意味づけを作らない
 *   - 再利用を促す強いCTAを置かない（置くと、その後の再訪が測れなくなる）
 *
 * client_token は localStorage にあるためサーバーコンポーネントでは読めない。
 * ここで読んで POST する。⚠ トークンをURLに出さない。
 */
interface FoundMemory {
  oneLine: string;
  note: string | null;
}

type Load = "loading" | "ready" | "notoken";
type Tap = "fit" | "off" | "unknown";

const TAPS: Array<{ key: Tap; label: string }> = [
  { key: "fit", label: "しっくりきた" },
  { key: "off", label: "少し違う" },
  { key: "unknown", label: "わからない" },
];

export default function Found() {
  const [load, setLoad] = useState<Load>("loading");
  const [memories, setMemories] = useState<FoundMemory[]>([]);
  const [hasTalked, setHasTalked] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [tapped, setTapped] = useState(false);

  useEffect(() => {
    let token: string | null = null;
    try {
      const raw = localStorage.getItem(LS_CLIENT);
      token = raw ? (JSON.parse(raw) as string) : null;
    } catch {
      token = null;
    }
    if (!token) {
      setLoad("notoken");
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/found", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientToken: token }),
        });
        const data = await res.json();
        setMemories(Array.isArray(data?.memories) ? data.memories : []);
        setHasTalked(Boolean(data?.hasTalked));
        setViewId(typeof data?.viewId === "string" ? data.viewId : null);
      } catch {
        setMemories([]);
      }
      setLoad("ready");
    })();
  }, []);

  const tap = useCallback(
    async (response: Tap) => {
      setTapped(true);
      if (!viewId) return;
      try {
        await fetch("/api/found/value", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ viewId, response }),
        });
      } catch {
        /* 記録に失敗しても画面は進める */
      }
    },
    [viewId]
  );

  if (load === "loading") {
    return <div className="found" />;
  }

  if (load === "notoken") {
    return (
      <div className="found">
        <h2 className="found-h">あなたが話してくれたこと</h2>
        <p className="found-empty">
          この端末には、まだ記録がありません。
          <br />
          前にお使いになった端末・ブラウザで開いてみてください。
        </p>
        <FoundFooter />
      </div>
    );
  }

  const hasMemories = memories.length > 0;

  return (
    <div className="found">
      <h2 className="found-h">あなたが話してくれたこと</h2>

      {hasMemories ? (
        <>
          <ul className="found-list">
            {memories.map((m, i) => (
              <li key={i}>
                <p className="found-mem">{m.oneLine}</p>
                {/*
                  承認済みの観察文だけを出す。
                  未承認・未作成のときは、この段ごと出さない。
                */}
                {m.note && (
                  <div className="found-note">
                    <p className="found-note-h">少し違う角度から見ると</p>
                    <p>{m.note}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <div className="found-tap">
            {tapped ? (
              <p className="found-thanks">ありがとうございました。</p>
            ) : (
              <>
                <p className="found-tap-q">この受け取り方、しっくりきましたか？</p>
                <div className="found-tap-row">
                  {TAPS.map((t) => (
                    <button key={t.key} onClick={() => void tap(t.key)}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <p className="found-disclaimer">
            これは診断ではありません。
            <br />
            あなたが話してくれた記憶を、少し違う角度から置き直したものです。
          </p>
        </>
      ) : (
        /*
          記憶0件。
          Product Decision: 無理に意味づけや観察文を生成しない。
          会話をしてくれた人と、まだ話していない人で文面を分ける。
        */
        <p className="found-empty">
          {hasTalked ? (
            <>
              今回は、残しておける記憶は見つかりませんでした。
              <br />
              何も出てこない回も正常です。
            </>
          ) : (
            <>
              まだ、ここには何もありません。
              <br />
              話すたびに、ここに増えていきます。
            </>
          )}
        </p>
      )}

      <FoundFooter />
    </div>
  );
}

/**
 * 戻る導線。
 *
 * ⚠ ボタンにしない。強いCTAを置くと、その後の再訪が「誘導された行動」になり、
 *   Return Pull を測れなくなる。テキストリンクだけ置く。
 */
function FoundFooter() {
  return (
    <footer className="found-foot">
      <a className="about-link" href="/">
        LOGGLYPHに戻る
      </a>
      <DeleteRecords />
    </footer>
  );
}
