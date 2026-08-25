"use client";

import { useState } from "react";

type Message = { role: "user" | "assistant"; content: string };

function makeSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function Home() {
  const [sessionId] = useState(makeSessionId);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "こんにちは。今日は何気ない話を少し聞かせてください。最近、妙に気になったことや、誰かに話すほどでもない出来事はありましたか？" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function save(role: Message["role"], content: string) {
    try {
      await fetch("/api/log", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, role, content }) });
    } catch { /* Pilot: chat continues even if logging temporarily fails. */ }
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    void save("user", text);
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const data = await res.json();
      const reply = data.reply ?? "うまく返答できませんでした。もう一度お願いします。";
      setMessages([...next, { role: "assistant", content: reply }]);
      void save("assistant", reply);
    } finally { setLoading(false); }
  }

  return <main className="shell"><section className="card"><header><div className="glyph">L</div><div><h1>LOGGLYPH</h1><p>PILOT / conversation experiment</p></div></header><div className="notice">何気ない日常の会話から、まだ名前のないあなたの断片を見つける実験です。</div><div className="chat">{messages.map((m,i)=><div key={i} className={`row ${m.role}`}><div className="bubble">{m.content}</div></div>)}{loading&&<div className="row assistant"><div className="bubble">考えています…</div></div>}</div><div className="composer"><textarea value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="ここに話してみる…"/><button onClick={send}>送る</button></div><footer>LOGGLYPH PILOT v0</footer></section></main>;
}
