import { checkAnchors, groundSignals, isGrounded, userCorpus } from "./grounding.ts";
import { checkForm } from "./form.ts";
import { rotate, tally } from "./attrition.ts";
import { hasAssertion, hardLexiconHits, lexiconHits } from "./barnum.ts";
import { buildScore, isAcceptable, paraphraseRatio } from "./score.ts";
import { extractSignals, generateCandidates, scoreByLlm, swapFits } from "./llm.ts";
import {
  type Attrition,
  type DropReason,
  type EvaluatedCandidate,
  type ReadingInput,
  type SessionResult,
  type Signal,
  type SignalKind,
} from "./types.ts";

/**
 * Reading Engine ── S1〜S6 のオーケストレーション。
 *
 * ⚠ 検査の順番は**コストの安い順**にしてある。
 *   機械でできる検査（接地・言い切り・一般語彙・言い換え）を先に通し、
 *   LLM 呼び出し（差し替え4回 + 採点1回）は生き残った候補にだけ使う。
 *
 * ⚠ 棄却は失敗ではない。ただし**どこで何件落ちたかを必ず記録する**
 *   （Product Decision 2026-09-20）。
 *   Barnum を厳しくするほど、エンジンは「出さない」方向に最適化されうる。
 *   Coverage と併せて見ないと、質が上がったのか逃げたのか区別できない。
 */

/** 他人ログ何件に差し替えて試すか */
export const SWAP_K = 4;
/** 何件に当てはまったら不合格にするか。1件でも当てはまれば落とす */
export const SWAP_FAIL_AT = 1;
/** 即棄却の一般語彙がこの件数以上なら、採点を待たずに落とす */
export const LEXICON_HARD_DROP = 1;

function kindsOf(signals: Signal[], ids: string[]): SignalKind[] {
  return signals.filter((s) => ids.includes(s.id)).map((s) => s.kind);
}

export async function runSession(
  input: ReadingInput,
  others: ReadingInput[]
): Promise<SessionResult> {
  try {
    const rawSignals = await extractSignals(input);
    const { grounded } = groundSignals(rawSignals, input);
    const candidates = await generateCandidates(input, grounded);
    const corpus = userCorpus(input);
    const evaluated: EvaluatedCandidate[] = [];

    for (const c of candidates) {
      const used = grounded.filter((s) => c.basedOn.includes(s.id));
      const anchors = checkAnchors(c, input);
      // ⚠ v2：「どこを見たか」の2点も根拠として数える（実在が確認できたときだけ）
      const groundedQuotes =
        used.filter((s) => isGrounded(s.quote, corpus)).length + (anchors === "ok" ? 2 : 0);
      const form = checkForm(c.text);
      const ungroundedQuotes = rawSignals
        .filter((s) => c.basedOn.includes(s.id) && !isGrounded(s.quote, corpus))
        .map((s) => s.quote);
      const kinds = kindsOf(grounded, c.basedOn);
      const hits = lexiconHits(c.text);
      const hardHits = hardLexiconHits(c.text);
      const para = paraphraseRatio(c.text, input);
      const assertion = hasAssertion(c.text);

      const base = {
        candidate: c,
        groundedQuotes,
        ungroundedQuotes,
        kinds,
        lexiconHits: hits,
        swapYes: 0,
        swapTested: 0,
        paraphraseRatio: para,
        hasAssertion: assertion,
        score: null,
      };

      const drop = (reason: DropReason) => {
        evaluated.push({ ...base, dropped: reason });
      };

      // S3 接地 ── 「どこを見たか」の2点が生ログに実在しないなら、書き直させずに破棄する
      if (anchors === "ungrounded") {
        drop("grounding");
        continue;
      }
      // 2点が同じ ＝ 事実同士の「間」が無い。Reading の定義から外れる
      if (anchors === "no_gap") {
        drop("no_gap");
        continue;
      }
      // 形 ── 人物評・心理診断・助言・性別の断定・内部IDの混入（種類ごとに数える）
      if (form.violation) {
        drop(form.violation);
        continue;
      }
      // 賭けているか ── 逃げ語だけで組み立てた文章は、外れようがない
      if (!assertion) {
        drop("no_assertion");
        continue;
      }
      // S4a 一般語彙
      if (hardHits.length >= LEXICON_HARD_DROP) {
        drop("barnum_lexicon");
        continue;
      }
      // Surprise の機械ゲート ── 本人の発言の言い換えは読みではない
      if (para >= 0.62) {
        drop("surprise_echo");
        continue;
      }

      // S4b 差し替え検査（ここから LLM）
      const pool = others.slice(0, SWAP_K);
      let yes = 0;
      for (const o of pool) {
        if (await swapFits(c.text, o)) yes += 1;
      }
      if (yes >= SWAP_FAIL_AT) {
        evaluated.push({ ...base, swapYes: yes, swapTested: pool.length, dropped: "barnum_swap" });
        continue;
      }

      // S5 採点
      const llm = await scoreByLlm(c.text, input);
      const score = buildScore({
        groundedQuotes,
        kinds,
        text: c.text,
        input,
        llmSpecificity: llm.specificity,
        llmRisk: llm.risk,
        llmSurprise: llm.surprise,
      });
      const ok = isAcceptable(score);
      evaluated.push({
        ...base,
        swapYes: yes,
        swapTested: pool.length,
        score,
        dropped: ok ? null : zeroAxisReason(score),
      });
    }

    // S6 選択 ── 残ったうち合計最大の1件だけ。0件もありうる
    const survivors = evaluated.filter((e) => e.dropped === null && e.score);
    survivors.sort((a, b) => (b.score!.total ?? 0) - (a.score!.total ?? 0));
    return {
      input,
      signals: grounded,
      evaluated,
      openBet: survivors[0] ?? null,
    };
  } catch (e) {
    return {
      input,
      signals: [],
      evaluated: [],
      openBet: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 0点になった軸から、落ちた理由を決める（集計を意味のあるものにするため） */
function zeroAxisReason(score: {
  evidence: number;
  specificity: number;
  risk: number;
  surprise: number;
}): DropReason {
  if (score.evidence === 0) return "grounding";
  if (score.surprise === 0) return "surprise_echo";
  if (score.risk === 0) return "no_assertion";
  return "barnum_lexicon";
}

export async function runBenchmark(inputs: ReadingInput[]): Promise<{
  results: SessionResult[];
  attrition: Attrition;
}> {
  const results: SessionResult[] = [];
  for (let i = 0; i < inputs.length; i++) {
    // 差し替え用の他人ログ。自分自身は必ず除く
    const others = inputs.filter((_, j) => j !== i);
    results.push(await runSession(inputs[i], rotate(others, i)));
  }
  return { results, attrition: tally(results) };
}

