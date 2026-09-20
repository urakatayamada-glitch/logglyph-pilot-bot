import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, verifyToken } from "../../../../lib/admin-auth";
import { getSupabaseAdmin } from "../../../../lib/supabase-server";
import { MODELS } from "../../../../lib/conversation/config";
import { loadInputs } from "../../../../lib/reading/load";
import { runSession } from "../../../../lib/reading/run";
import { tally, rotate } from "../../../../lib/reading/attrition";
import { READING_ENGINE_VERSION } from "../../../../lib/reading/llm";
import { decoyFor } from "../../../../lib/reading/decoy";
import type { SessionResult } from "../../../../lib/reading/types";

/**
 * Reading Engine Benchmark の実行。
 *
 * ⚠ 1リクエスト = 1セッションにしてある。
 *   20セッションを1回のリクエストで回すと、サーバーレスの実行時間上限に当たる。
 *   進行状況を画面に出せるという副次的な利点もある。
 *
 * ⚠ Admin 認証必須。生ログを扱うため、ここだけは必ず内側に置く。
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifyToken(store.get(ADMIN_COOKIE)?.value);
}

export async function POST(req: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "supabase未設定" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? "");

  /* ---------- start ---------- */
  if (action === "start") {
    const ids = Array.isArray(body?.sessionIds)
      ? (body.sessionIds as unknown[]).filter((v): v is string => typeof v === "string")
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "セッションが選ばれていません" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("reading_bench_runs")
      .insert({
        engine_version: READING_ENGINE_VERSION,
        model: MODELS.extraction,
        session_ids: ids,
        attrition: {},
        results: [],
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, runId: data.id, total: ids.length });
  }

  /* ---------- step ---------- */
  if (action === "step") {
    const runId = String(body?.runId ?? "");
    const index = Number(body?.index ?? -1);
    const { data: run, error } = await supabase
      .from("reading_bench_runs")
      .select("id, session_ids, results")
      .eq("id", runId)
      .maybeSingle();
    if (error || !run) {
      return NextResponse.json({ ok: false, error: "runが見つかりません" }, { status: 404 });
    }
    const ids = (run.session_ids as string[]) ?? [];
    if (index < 0 || index >= ids.length) {
      return NextResponse.json({ ok: false, error: "indexが範囲外です" }, { status: 400 });
    }

    // 差し替え用の他人ログも一緒に読む。自分自身は必ず除く
    const inputs = await loadInputs(ids);
    const self = inputs.find((i) => i.sessionId === ids[index]);
    if (!self) {
      return NextResponse.json({ ok: true, skipped: true, index });
    }
    const others = rotate(
      inputs.filter((i) => i.sessionId !== self.sessionId),
      index
    );
    const result = await runSession(self, others);

    const results = [...((run.results as SessionResult[]) ?? []), result];
    await supabase
      .from("reading_bench_runs")
      .update({ results, attrition: tally(results) })
      .eq("id", runId);

    return NextResponse.json({
      ok: true,
      index,
      sessionId: self.sessionId,
      hasOpenBet: Boolean(result.openBet),
      candidates: result.evaluated.length,
      error: result.error ?? null,
    });
  }

  /* ---------- finish（Blind 評価シートを作る） ---------- */
  if (action === "finish") {
    const runId = String(body?.runId ?? "");
    const { data: run } = await supabase
      .from("reading_bench_runs")
      .select("id, results")
      .eq("id", runId)
      .maybeSingle();
    if (!run) return NextResponse.json({ ok: false, error: "runが見つかりません" }, { status: 404 });

    const results = (run.results as SessionResult[]) ?? [];
    const withBet = results.filter((r) => r.openBet);
    const rows: Array<Record<string, unknown>> = [];

    withBet.forEach((r, i) => {
      // 他人の Open Bet（差し替え）。1件しか無ければ作れない
      const swapped = withBet[(i + 1) % withBet.length];
      const items = [
        { kind: "open_bet", text: r.openBet!.candidate.text },
        { kind: "decoy", text: decoyFor(i) },
        {
          kind: "swapped",
          text: swapped === r ? decoyFor(i + 1) : swapped.openBet!.candidate.text,
        },
      ];
      // ⚠ 並びをずらす。毎回 A がエンジンの出力だと、評価が成立しない
      const slots = ["A", "B", "C"];
      const offset = i % 3;
      items.forEach((item, j) => {
        rows.push({
          run_id: runId,
          session_id: r.input.sessionId,
          slot: slots[(j + offset) % 3],
          kind: item.kind,
          text: item.text,
        });
      });
    });

    if (rows.length > 0) {
      const { error: insErr } = await supabase
        .from("reading_bench_ratings")
        .upsert(rows, { onConflict: "run_id,session_id,slot" });
      if (insErr) {
        return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 });
      }
    }
    return NextResponse.json({ ok: true, sheets: withBet.length });
  }

  return NextResponse.json({ ok: false, error: "不明なaction" }, { status: 400 });
}
