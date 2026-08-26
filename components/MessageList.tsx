"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/conversation/phase";

export default function MessageList({
  messages,
  loading,
}: {
  messages: ChatMessage[];
  loading: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  return (
    <div className="chat">
      {messages.map((m, i) => (
        <div key={i} className={`row ${m.role}`}>
          <div className="bubble">{m.content}</div>
        </div>
      ))}
      {loading && (
        <div className="row assistant">
          <div className="bubble typing">…</div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
