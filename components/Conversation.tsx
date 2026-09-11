"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageList from "./MessageList";
import Composer from "./Composer";
import ConversationComplete from "./ConversationComplete";
import Intro from "./Intro";
import DeleteRecords from "./DeleteRecords";
import type { Wave1Answers } from "./Wave1Survey";
import type { ChatMessage } from "../lib/conversation/phase";
import type { MemoryTriggerEpisode } from "../lib/episodes";
import { RECENT_EPISODE_MEMORY } from "../lib/conversation/config";
import { DEFAULT_VARIANT, ExperienceVariant, isExperienceVariant } from "../lib/experience";

const LS_SESSION = "logglyph.session";
const LS_ACCEPTED = "logglyph.accepted";
const LS_INTRO_SEEN = "logglyph.introSeen";
const LS_CLIENT = "logglyph.client";
const LS_RECENT_EPISODES = "logglyph.recentEpisodes";
/**
 * 流入識別。?src=note_wave2 を最初の到達時に保存する。
 *
 * URLから消えても（画面遷移・リロード）コホートを見失わないように端末側に残す。
 * 知人コホートは null のまま。
 */
const LS_SRC = "logglyph.src";

/**
 * 会話開始前に一度だけ表示する注意文言。
 *
 * Product Owner決定（Wave 0 配布のリスクヘッジ）。
 * 「はじめる」を押すまでセッションをサーバーに登録しないため、
 * 読まずに離脱した人が Sessions 件数に混ざらない。
 */
/*
 * 文言はProduct Owner提供のものをそのまま使う。
 * 1つの塊で出すと読み飛ばされるため、段落だけ分けている
 * （前段＝データの扱い／後段＝話す側の自由）。文言自体は変えていない。
 */
const GATE_PARAGRAPHS = [
  "会話内容はPilot改善のため運営者が確認する場合があります。名前・会社名・住所など特定につながる情報はなるべく書かないでください。",
  "また、話したくないことは話す必要はありません。途中でやめても問題ありません。",
];

interface PersistedSession {
  sessionId: string;
  messages: ChatMessage[];
  completed: boolean;
  oneLineMemory: string | null;
  crisis: boolean;
}

/** URLの ?src= を読み、なければ保存済みの値を返す */
function readSrc(): string | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("src");
    if (fromUrl && fromUrl.trim()) {
      const v = fromUrl.trim().slice(0, 64);
      writeLS(LS_SRC, v);
      return v;
    }
    return readLS<string>(LS_SRC);
  } catch {
    return null;
  }
}

/**
 * この到達の文脈。現状は /found から直接戻ってきた場合の "found" だけ。
 *
 * ⚠ src と違い localStorage に保存しない。
 *   保存すると、数日後に別経路で来た会話まで「Foundから戻った」と記録され、
 *   Direct from Found が実態より多く出る。これは「今回の到達」の属性。
 *
 * ⚠ src を上書きしない。上書きすると Wave 2-A の母集団が壊れる。
 */
function readEntryContext(): string | null {
  try {
    const v = new URLSearchParams(window.location.search).get("from");
    if (!v || !v.trim()) return null;
    return v.trim().slice(0, 32);
  } catch {
    return null;
  }
}

/**
 * Stage 1 : Entry Pull の分母を記録する。
 *
 * これまでは「はじめる」を押すまでサーバーに何も送っていなかったため、
 * 画面を読んで帰った人がデータに一切現れず、Entry Pull を一度も実測できていなかった。
 * ⚠ ここでは OpenAI を呼ばない。API費用はゼロ。
 */
function recordEntry(stage: "view" | "accept", clientToken: string, src: string | null) {
  try {
    void fetch("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        clientToken,
        stage,
        src,
        referrer: typeof document !== "undefined" ? document.referrer || null : null,
      }),
    }).catch(() => undefined);
  } catch {
    /* 記録に失敗しても体験は壊さない */
  }
}

/** client_token を読み、無ければ作って保存する */
function ensureClientToken(): string {
  let token = readLS<string>(LS_CLIENT);
  if (!token) {
    token = makeId();
    writeLS(LS_CLIENT, token);
  }
  return token;
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * 直近に出したEpisodeをCookieにも残す。
 *
 * localStorage だけだと、サーバーコンポーネント（app/page.tsx）が
 * 初回表示のEpisodeを選ぶ時点で参照できず、除外が効かなかった。
 * 実際 pickEpisode() は除外リスト無しで呼ばれており、
 * 「前にも同じ話を聞かれた」が起きる原因になっていた。
 * Cookieならサーバー側で読めるので、初回表示から除外できる。
 */
function writeRecentCookie(ids: string[]) {
  try {
    const v = ids.slice(0, RECENT_EPISODE_MEMORY).join(",");
    document.cookie = `lg_recent=${encodeURIComponent(v)}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* Cookieが使えなくても会話は続けられる */
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* プライベートモード等では保存できないが、会話自体は続けられる */
  }
}

export default function Conversation({
  episode,
}: {
  episode: MemoryTriggerEpisode;
}) {
  const [ready, setReady] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [oneLineMemory, setOneLineMemory] = useState<string | null>(null);
  const [crisis, setCrisis] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * 注意文言に同意済みか。
   *
   * 端末ごとに1回だけ表示する。2回目以降のセッションで毎回挟むと、
   * 「また話したい」の観測対象である再訪に余計な摩擦が入るため。
   */
  const [accepted, setAccepted] = useState(false);
  /**
   * 導入を見たか。端末ごとに1回だけ自動表示する。
   * キーが新規なので、Wave 0 の参加者にも必ず1回表示される（今回の狙い）。
   */
  const [introSeen, setIntroSeen] = useState(false);
  /** 終了後の面（今日のログ・評価・Future Preview）へ自動で送るための目印 */
  const completeRef = useRef<HTMLDivElement>(null);
  /** フッターから明示的に再生した場合。introSeen は書き換えない。 */
  const [introReplay, setIntroReplay] = useState(false);
  /** Future Preview 用。取得できなければ null のまま（表示を省く）。 */
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [recentMemories, setRecentMemories] = useState<string[]>([]);
  const startedRef = useRef(false);
  /** 流入識別。到達時に確定し、セッション登録まで持ち回る。 */
  const srcRef = useRef<string | null>(null);
  const entryContextRef = useRef<string | null>(null);
  /**
   * 体験条件。サーバが決めた値を受け取って保持する。
   * ⚠ クライアントでは決めない。取れなければ baseline のまま。
   */
  const [experienceVariant, setExperienceVariant] =
    useState<ExperienceVariant>(DEFAULT_VARIANT);

  /** 初期化：前回の会話があれば復元、なければEpisodeで開始 */
  useEffect(() => {
    const saved = readLS<PersistedSession>(LS_SESSION);

    /*
     * 到達を1回だけ記録する。同意より前・会話より前の時点。
     * 同一端末・同一日はサーバー側の unique index で1行に集約される。
     */
    const src = readSrc();
    srcRef.current = src;
    entryContextRef.current = readEntryContext();
    recordEntry("view", ensureClientToken(), src);

    if (readLS<boolean>(LS_ACCEPTED) === true) setAccepted(true);
    if (readLS<boolean>(LS_INTRO_SEEN) === true) setIntroSeen(true);

    if (saved?.sessionId && saved.messages?.length) {
      // 進行中の会話が復元できる時点で、すでに同意も導入も済んでいる
      setAccepted(true);
      setIntroSeen(true);
      setSessionId(saved.sessionId);
      setMessages(saved.messages);
      setCompleted(saved.completed);
      setOneLineMemory(saved.oneLineMemory);
      setCrisis(saved.crisis);
      setReady(true);
      startedRef.current = true;
      return;
    }

    const id = makeId();
    setSessionId(id);
    setMessages([{ role: "assistant", content: episode.body }]);
    setReady(true);
  }, [episode.body]);

  /** セッションをサーバーに登録（Episodeの記録とレート制限） */
  useEffect(() => {
    // 同意前はサーバーに何も送らない（レート制限とSessions件数を汚さない）
    if (!ready || !accepted || !sessionId || startedRef.current) return;
    startedRef.current = true;

    const clientToken = ensureClientToken();

    const recent = readLS<string[]>(LS_RECENT_EPISODES) ?? [];
    const nextRecent = [
      episode.id,
      ...recent.filter((x) => x !== episode.id),
    ].slice(0, RECENT_EPISODE_MEMORY);
    writeLS(LS_RECENT_EPISODES, nextRecent);
    writeRecentCookie(nextRecent);

    void (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            clientToken,
            episode,
            src: srcRef.current,
            entryContext: entryContextRef.current,
          }),
        });
        const data = await res.json().catch(() => null);
        if (res.status === 429) {
          setNotice(data?.message ?? "今日はここまでにしておこう。");
          setCompleted(true);
          return;
        }
        if (isExperienceVariant(data?.experienceVariant)) {
          setExperienceVariant(data.experienceVariant);
        }
      } catch {
        /* 登録に失敗しても会話は続行する */
      }
      void saveLog(sessionId, "assistant", episode.body, 0);
    })();
  }, [ready, accepted, sessionId, episode]);

  /**
   * 会話が終わったら、締めの面が画面に入るところまで送る。
   *
   * MessageList の自動スクロールは最後の吹き出しまでしか送らないため、
   * 「今日のログ」以降が画面の下に隠れたままになり、
   * 見切れているように見えていた。
   */
  useEffect(() => {
    if (!completed) return;
    const t = setTimeout(() => {
      completeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => clearTimeout(t);
  }, [completed]);

  /** 会話状態の永続化（リロード対策） */
  useEffect(() => {
    if (!ready || !sessionId) return;
    writeLS(LS_SESSION, {
      sessionId,
      messages,
      completed,
      oneLineMemory,
      crisis,
    } satisfies PersistedSession);
  }, [ready, sessionId, messages, completed, oneLineMemory, crisis]);

  const finalize = useCallback(
    async (finalMessages: ChatMessage[], isCrisis: boolean) => {
      try {
        const res = await fetch("/api/session/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            messages: finalMessages,
            crisis: isCrisis,
            // Future Preview 用。この端末の蓄積を数えるためだけに使う。
            clientToken: readLS<string>(LS_CLIENT),
          }),
        });
        const data = await res.json();
        if (data?.oneLineMemory) setOneLineMemory(data.oneLineMemory);
        // 取得できなければ null のまま。件数を出さずに続行する。
        if (typeof data?.memoryCount === "number") setMemoryCount(data.memoryCount);
        if (Array.isArray(data?.recentMemories)) setRecentMemories(data.recentMemories);
      } catch {
        /* 抽出に失敗しても終了体験は壊さない */
      }
    },
    [sessionId]
  );

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || completed) return;

    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    void saveLog(sessionId, "user", text, next.length - 1);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, messages: next }),
      });
      const data = await res.json();
      const reply: string =
        data.reply ?? "うまく返答できませんでした。もう一度お願いします。";

      const after: ChatMessage[] = [...next, { role: "assistant", content: reply }];
      setMessages(after);
      void saveLog(sessionId, "assistant", reply, after.length - 1, data);

      if (data.completed) {
        setCompleted(true);
        setCrisis(Boolean(data.crisis));
        void finalize(after, Boolean(data.crisis));
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "少し接続が不安定だったみたい。もう一度送ってみて。",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, completed, messages, sessionId, finalize]);

  const rate = useCallback(
    (userRating: number | null, wantsToTalkAgain: boolean | null) => {
      void fetch("/api/session/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, userRating, wantsToTalkAgain }),
      }).catch(() => {});
    },
    [sessionId]
  );

  /** Future Preview のあとの4問。任意回答なので null でも呼ぶ。 */
  const sendFollowup = useCallback(
    (answers: Wave1Answers | null) => {
      if (!answers) return;
      void fetch("/api/session/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, followupAnswers: answers }),
      }).catch(() => {});
    },
    [sessionId]
  );

  const finishIntro = useCallback(() => {
    writeLS(LS_INTRO_SEEN, true);
    setIntroSeen(true);
    setIntroReplay(false);
  }, []);

  const accept = useCallback(() => {
    writeLS(LS_ACCEPTED, true);
    setAccepted(true);
    // 注意書きに同意した時点を記録する（到達 → 同意 → 会話開始 の中段）
    recordEntry("accept", ensureClientToken(), srcRef.current);
  }, []);

  const restart = useCallback(() => {
    try {
      localStorage.removeItem(LS_SESSION);
    } catch {
      /* noop */
    }
    window.location.reload();
  }, []);

  if (!ready) {
    return <div className="chat" />;
  }

  if (!introSeen || introReplay) {
    return (
      <>
        <Intro onDone={finishIntro} />
        <AboutFooter onClick={() => setIntroReplay(true)} />
      </>
    );
  }

  if (!accepted) {
    return (
      <>
        <div className="gate">
          <div className="gate-body">
            {GATE_PARAGRAPHS.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
          <button className="primary" onClick={accept}>
            はじめる
          </button>
          {/*
            Product Decision（Wave 2 設計合意 §7）:
            削除の扱いを、始める前に読める位置へ置く。
            文言は指定のものをそのまま使う（留保表現も変えない）。
          */}
          <div className="gate-fine">
            <p>
              あとから会話内容を削除できます。削除すると会話内容はすべて消えます。利用回数や記憶が見つかったか等の匿名集計値だけ、どなたの記録か分からない形で残る場合があります。
            </p>
            <p>
              ブラウザのデータを削除すると、この端末を識別する情報も消えるため、あとから削除操作ができなくなる場合があります。
            </p>
          </div>
        </div>
        <AboutFooter onClick={() => setIntroReplay(true)} />
      </>
    );
  }

  return (
    <>
      <MessageList messages={messages} loading={loading} />

      {notice && <div className="notice warn">{notice}</div>}

      {completed ? (
        <div className="complete-area" ref={completeRef}>
          <ConversationComplete
            oneLineMemory={oneLineMemory}
            onRate={rate}
            onFollowup={sendFollowup}
            crisis={crisis}
            memoryCount={memoryCount}
            recentMemories={recentMemories}
            experienceVariant={experienceVariant}
            sessionId={sessionId}
            clientToken={readLS<string>(LS_CLIENT)}
            restartSlot={
              crisis ? null : (
                <button className="ghost restart" onClick={restart}>
                  別の話をする
                </button>
              )
            }
          />
        </div>
      ) : (
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={loading}
        />
      )}

      <AboutFooter onClick={() => setIntroReplay(true)} showDelete />
    </>
  );
}

/**
 * 常設の「LOGGLYPHとは」。
 *
 * 新しいボタンを増やすと入り口の静けさが壊れるので、
 * これまでフッターに置いていた文字をそのまま押せるようにしただけ。
 */
/**
 * 常設フッター。
 *
 * showDelete は「同意して会話に入ったあと」だけ true にする。
 * 導入・注意書きの面ではまだ消すものが存在せず、最初に目に入る面に
 * 削除リンクを置くと入り口の静けさが壊れる。
 * その2面では注意書き（gate-fine）が削除の扱いを説明している。
 */
function AboutFooter({
  onClick,
  showDelete = false,
}: {
  onClick: () => void;
  showDelete?: boolean;
}) {
  return (
    <footer className="site-foot">
      <button className="about-link" onClick={onClick}>
        LOGGLYPHとは
      </button>
      {/*
        削除は不特定多数公開の前提条件（Safety / Trust 要件）。
        知人コホートには /found から辿れるが、Wave 2 の参加者は /found の
        案内を受け取らないため、本体側にも常設の入口が必要。
      */}
      {showDelete && <DeleteRecords />}
    </footer>
  );
}

function saveLog(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  turnIndex: number,
  meta?: { moderationFlagged?: boolean; moderationCategories?: string[] }
) {
  return fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      role,
      content,
      turnIndex,
      moderationFlagged: meta?.moderationFlagged,
      moderationCategories: meta?.moderationCategories,
    }),
  }).catch(() => {
    /* Pilot: ログ保存に失敗しても会話は続ける */
  });
}
