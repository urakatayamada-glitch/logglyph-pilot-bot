"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MessageList from "./MessageList";
import Composer from "./Composer";
import ConversationComplete from "./ConversationComplete";
import type { ChatMessage } from "../lib/conversation/phase";
import type { MemoryTriggerEpisode } from "../lib/episodes";
import { RECENT_EPISODE_MEMORY } from "../lib/conversation/config";

const LS_SESSION = "logglyph.session";
const LS_CLIENT = "logglyph.client";
const LS_RECENT_EPISODES = "logglyph.recentEpisodes";

interface PersistedSession {
  sessionId: string;
  messages: ChatMessage[];
  completed: boolean;
  oneLineMemory: string | null;
  crisis: boolean;
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
  const startedRef = useRef(false);

  /** 初期化：前回の会話があれば復元、なければEpisodeで開始 */
  useEffect(() => {
    const saved = readLS<PersistedSession>(LS_SESSION);
    if (saved?.sessionId && saved.messages?.length) {
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
    if (!ready || !sessionId || startedRef.current) return;
    startedRef.current = true;

    let clientToken = readLS<string>(LS_CLIENT);
    if (!clientToken) {
      clientToken = makeId();
      writeLS(LS_CLIENT, clientToken);
    }

    const recent = readLS<string[]>(LS_RECENT_EPISODES) ?? [];
    writeLS(
      LS_RECENT_EPISODES,
      [episode.id, ...recent.filter((x) => x !== episode.id)].slice(
        0,
        RECENT_EPISODE_MEMORY
      )
    );

    void (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, clientToken, episode }),
        });
        if (res.status === 429) {
          const data = await res.json();
          setNotice(data.message ?? "今日はここまでにしておこう。");
          setCompleted(true);
        }
      } catch {
        /* 登録に失敗しても会話は続行する */
      }
      void saveLog(sessionId, "assistant", episode.body, 0);
    })();
  }, [ready, sessionId, episode]);

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
          }),
        });
        const data = await res.json();
        if (data?.oneLineMemory) setOneLineMemory(data.oneLineMemory);
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

  return (
    <>
      <MessageList messages={messages} loading={loading} />

      {notice && <div className="notice warn">{notice}</div>}

      {completed ? (
        <div className="complete-area">
          <ConversationComplete
            oneLineMemory={oneLineMemory}
            onRate={rate}
            crisis={crisis}
          />
          {!crisis && (
            <button className="ghost restart" onClick={restart}>
              別の話をする
            </button>
          )}
        </div>
      ) : (
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          disabled={loading}
        />
      )}
    </>
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
