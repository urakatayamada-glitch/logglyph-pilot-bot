import OpenAI from "openai";
import { NextResponse } from "next/server";

const system = `あなたはLOGGLYPH Pilotの会話AIです。目的は、ユーザーの日常会話から本人が普段わざわざ語らない出来事、感情、判断、記憶、願望、違和感などの断片を自然な対話で見つけることです。尋問や心理診断をしてはいけません。普通の雑談のように、一度に質問は原則1つ。ユーザーの言葉を過剰にドラマ化せず、具体的な出来事・その時の感情・なぜそうしたかを少しずつ深掘りしてください。まだ「Hidden」や分析結果を断定して提示せず、まず会話そのものを心地よく続けてください。日本語で簡潔に応答してください。`;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ reply: "AI接続の準備中です。OPENAI_API_KEYを設定してください。" });
    const client = new OpenAI({ apiKey });
    const result = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.8,
      messages: [{ role: "system", content: system }, ...messages.map((m: any) => ({ role: m.role, content: m.content }))]
    });
    return NextResponse.json({ reply: result.choices[0]?.message?.content || "もう少し聞かせてください。" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ reply: "少し接続が不安定でした。もう一度送ってみてください。" }, { status: 500 });
  }
}
