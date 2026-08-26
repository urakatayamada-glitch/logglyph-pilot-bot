import { NextResponse } from "next/server";
import { runTurn } from "../../../lib/conversation/engine";
import { ChatMessage } from "../../../lib/conversation/phase";
import { moderate } from "../../../lib/moderation";
import { getSupabaseAdmin } from "../../../lib/supabase-server";
import { PROMPT_VERSION } from "../../../lib/conversation/config";

/**
 * 危機的内容が検出された場合にユーザーへ返すメッセージ。
 *
 * Product Decision（暫定）: 会話を止めて相談先を案内する（Option A）＋
 * それ以外の重い内容ではAIが深掘りしない（Option C）の併用。
 * Pilotが夜間に使われる可能性を考えると、運営者の目視だけに頼るのは弱いという判断。
 */
const CRISIS_MESSAGE = `ここまで話してくれてありがとう。

今はいったん、ここで区切らせてください。

もししんどい気持ちが続いているなら、話を聞いてくれるところがあります。

・こころの健康相談統一ダイヤル 0570-064-556
・よりそいホットライン 0120-279-338

無理せず、頼っていいと思う。`;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages: ChatMessage[] = Array.isArray(body?.messages)
      ? body.messages
      : [];
    const sessionId: string | undefined = body?.sessionId;

    if (messages.length === 0) {
      return NextResponse.json({ reply: "うん。", completed: false });
    }

    // 直近のユーザー発話を判定する
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const moderation = await moderate(lastUser?.content ?? "");

    if (moderation.flagged && sessionId) {
      void recordFlag(sessionId);
    }

    // 自傷系の高確度検出時は会話を継続せず、静かに相談先を案内する
    if (moderation.selfHarmCritical) {
      return NextResponse.json({
        reply: CRISIS_MESSAGE,
        completed: true,
        crisis: true,
      });
    }

    const result = await runTurn(messages, { sensitive: moderation.flagged });

    return NextResponse.json({
      reply: result.reply,
      completed: result.completed,
      phase: result.phase,
      promptVersion: PROMPT_VERSION,
      moderationFlagged: moderation.flagged,
      moderationCategories: moderation.categories,
    });
  } catch (error) {
    console.error("chat failed", error);
    return NextResponse.json(
      { reply: "少し接続が不安定でした。もう一度送ってみてください。", completed: false },
      { status: 500 }
    );
  }
}

async function recordFlag(sessionId: string) {
  try {
    const supabase = getSupabaseAdmin();
    if (!supabase) return;
    const { data } = await supabase
      .from("sessions")
      .select("moderation_flag_count")
      .eq("session_id", sessionId)
      .maybeSingle();
    await supabase
      .from("sessions")
      .update({ moderation_flag_count: (data?.moderation_flag_count ?? 0) + 1 })
      .eq("session_id", sessionId);
  } catch {
    /* Pilot: 記録に失敗しても会話は止めない */
  }
}
