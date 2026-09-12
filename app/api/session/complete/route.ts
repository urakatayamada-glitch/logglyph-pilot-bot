import { NextResponse } from "next/server";
import { extractStructuredMemory } from "../../../../lib/conversation/engine";
import { ChatMessage, summarizeMessages } from "../../../../lib/conversation/phase";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { MODELS, PROMPT_VERSION } from "../../../../lib/conversation/config";
import { extractFacets, generateFragment, STORY_PROMPT_VERSION } from "../../../../lib/story-generate";
import {
  Facet,
  changedCategories,
  missingSlots,
  neededCategories,
  scoreFacets,
  Scores,
} from "../../../../lib/story";

/**
 * 会話終了時の処理。
 *
 * 構造化抽出は会話とは別工程。失敗しても終了体験は壊さない
 * （one_line_memory は締めの発話から取れるため）。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const sessionId: string | undefined = body?.sessionId;
    const messages: ChatMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    const crisis: boolean = Boolean(body?.crisis);
    // Future Preview 用。この端末の蓄積を数えるためだけに使う。
    const clientToken: string | undefined =
      typeof body?.clientToken === "string" ? body.clientToken : undefined;

    if (!sessionId) return NextResponse.json({ ok: false }, { status: 400 });

    const stats = summarizeMessages(messages);

    // 危機対応で終了した会話は、抽出も保存もしない（記録を残すこと自体が不適切なため、
    // 会話ログは残るが構造化はしない）
    const structured = crisis ? null : await safeExtract(messages);

    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { error } = await supabase
        .from("sessions")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          prompt_version: PROMPT_VERSION,
          message_count: stats.messageCount,
          user_message_count: stats.userMessageCount,
          user_char_count: stats.userCharCount,
          ai_char_count: stats.aiCharCount,
          memory_found: structured?.memory_found ?? false,
          hidden_candidate_found: Boolean(structured?.hidden_candidate),
          one_line_memory: structured?.one_line_memory ?? null,
          structured_memory: structured ?? null,
          // memory_trigger_category は更新しない。
          // セッション開始時にEpisode側のカテゴリ（固定の20分類）を入れており、
          // 抽出モデルが返す自由記述（「仕事」「personal habits」等）で上書きすると
          // 「どのEpisodeが記憶を引き出せたか」の集計が壊れる。
          // 抽出側の分類は structured_memory の中に残っている。
        })
        .eq("session_id", sessionId);
      if (error) console.error("session complete update failed", error);
    }

    // Future Preview 用の蓄積。今回のセッションを更新した「あと」に数える。
    // 失敗しても終了体験は壊さないので、握りつぶして null を返す。
    let memoryCount: number | null = null;
    let recentMemories: string[] = [];
    if (supabase && clientToken && !crisis) {
      try {
        const { count } = await supabase
          .from("sessions")
          .select("session_id", { count: "exact", head: true })
          .eq("client_token", clientToken)
          .eq("memory_found", true);
        memoryCount = count ?? 0;

        const { data: recent } = await supabase
          .from("sessions")
          .select("one_line_memory")
          .eq("client_token", clientToken)
          .eq("memory_found", true)
          .not("one_line_memory", "is", null)
          .order("started_at", { ascending: false })
          .limit(3);
        recentMemories = (recent ?? [])
          .map((r) => (r as { one_line_memory: string }).one_line_memory)
          .filter((t) => typeof t === "string" && t.trim().length > 0);
      } catch (error) {
        console.error("accumulation fetch failed", error);
      }
    }

    /* ============================================================
       Story Preview（story_preview_v1 のときだけ）
       ============================================================

       ⚠ この条件以外では OpenAI を1回も追加で呼ばない。
         baseline / memory_receipt_v1 のコストは今までどおり。
       ⚠ 生成に失敗しても終了体験は壊さない。story を null で返すだけ。
    */
    let story: StoryPayload | null = null;
    if (supabase && clientToken && !crisis && structured?.memory_found) {
      try {
        const { data: row } = await supabase
          .from("sessions")
          .select("experience_variant")
          .eq("session_id", sessionId)
          .maybeSingle();
        if ((row as { experience_variant?: string } | null)?.experience_variant ===
          "story_preview_v1") {
          story = await buildStory(
            supabase,
            sessionId,
            clientToken,
            messages,
            structured?.one_line_memory ?? null
          );
        }
      } catch (error) {
        console.error("story build failed", error);
      }
    }

    return NextResponse.json({
      ok: true,
      oneLineMemory: structured?.one_line_memory ?? null,
      memoryFound: structured?.memory_found ?? false,
      memoryCount,
      recentMemories,
      story,
    });
  } catch (error) {
    console.error("session complete failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

interface StoryPayload {
  fragment: string | null;
  scores: Scores;
  overall: number;
  /** 今回ぶんを入れる前の総合％。「46% → 52%」の左側 */
  previousOverall: number;
  changed: Array<{ category: string; from: number; to: number }>;
  missing: string[];
  /** 次回の Episode 抽選に渡す不足カテゴリ。クライアントが Cookie に書く */
  need: string[];
}

/**
 * Story Preview の中身を組み立てる。
 *
 * 順番に意味がある。
 *   1. 「前回までの％」を先に読む（差分を出すため。今回ぶんを入れる前に読む）
 *   2. 今回の facet を抽出して保存
 *   3. 全 facet で採点
 *   4. シーンを生成
 *
 * ⚠ facet の入力は会話ログと one_line_memory だけ。
 *   生成したシーン（演出）は facet に一切入れない。逆輸入の禁止。
 */
async function buildStory(
  supabase: NonNullable<ReturnType<typeof getSupabaseAdmin>>,
  sessionId: string,
  clientToken: string,
  messages: ChatMessage[],
  oneLineMemory: string | null
): Promise<StoryPayload | null> {
  // 1. 今回を入れる前の状態
  const { data: before } = await supabase
    .from("memory_facets")
    .select("category, slot")
    .eq("client_token", clientToken);
  const beforeFacets = (before ?? []) as Facet[];
  const beforeResult = scoreFacets(beforeFacets);
  const beforeScores = beforeResult.scores;

  // 2. 抽出して保存
  const extracted = await extractFacets(messages, oneLineMemory);
  if (extracted.length > 0) {
    const { error } = await supabase.from("memory_facets").upsert(
      extracted.map((f) => ({
        session_id: sessionId,
        client_token: clientToken,
        category: f.category,
        slot: f.slot,
        value: f.value.slice(0, 200),
      })),
      { onConflict: "session_id,category,slot", ignoreDuplicates: true }
    );
    if (error) console.error("facet insert failed", error);
  }

  // 3. 採点
  const allFacets: Facet[] = [...beforeFacets, ...extracted];
  const { scores, overall } = scoreFacets(allFacets);

  await supabase.from("story_progress_snapshots").upsert(
    { session_id: sessionId, client_token: clientToken, scores, overall },
    { onConflict: "session_id" }
  );

  // 4. シーン
  /*
   * ⚠ 渡すのは「今回のセッションで確定した事実」だけ。
   *   過去の全 facet を渡すと、別の時期の場所や人物が今日のシーンに混ざる。
   *   ここに無いことは断定させない（Fact は増やさない）。
   */
  const { body } = await generateFragment(messages, oneLineMemory, extracted);
  if (body) {
    const { error } = await supabase.from("story_fragments").upsert(
      {
        session_id: sessionId,
        client_token: clientToken,
        body,
        model: MODELS.extraction,
        prompt_version: STORY_PROMPT_VERSION,
      },
      { onConflict: "session_id" }
    );
    if (error) console.error("fragment insert failed", error);
  }

  return {
    fragment: body,
    scores,
    overall,
    previousOverall: beforeResult.overall,
    changed: changedCategories(beforeScores, scores),
    // 「まだ見えていないもの」は出しすぎない。多いと宿題になる
    missing: missingSlots(allFacets).slice(0, 3).map((m) => m.missing),
    need: neededCategories(allFacets),
  };
}

async function safeExtract(messages: ChatMessage[]) {
  try {
    return await extractStructuredMemory(messages);
  } catch (error) {
    console.error("extraction failed", error);
    return null;
  }
}
