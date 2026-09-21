/**
 * Reading Engine ── 型定義
 *
 * 設計：`LOGGLYPH_HumanitiesModel_内部設計_v0.3`
 * 　　　`LOGGLYPH_ReadingEngine_Benchmark_Implementation_Plan_v1`
 *
 * ⚠ このディレクトリは Benchmark 専用である。
 *   lib/conversation/ には1文字も触れていない。テスターの会話には影響しない。
 */

/** Humanities Signal の種類（v0.3 §1.5） */
export const SIGNAL_KINDS = [
  "content",
  "trigger_delta",
  "narrative_mismatch",
  "contradiction",
  "repetition",
  "omission",
  "residue",
  "unexpected_choice",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** 日本語ラベル。表示はここだけで行う（コード側は英字コードで扱う） */
export const SIGNAL_LABELS: Record<SignalKind, string> = {
  content: "Content（何を話したか）",
  trigger_delta: "Trigger Delta（何を聞かれて何を返したか）",
  narrative_mismatch: "Narrative Mismatch（自己説明と観測のズレ）",
  contradiction: "Contradiction（同一会話内の食い違い）",
  repetition: "Repetition（何度も戻るもの）",
  omission: "Omission（出てこないもの）",
  residue: "Residue（今も残っているもの）",
  unexpected_choice: "Unexpected Choice（予測と違う選択）",
};

export interface SourceTurnRow {
  role: "user" | "assistant";
  content: string;
}

/** 1セッション分の入力。⚠ one_line_memory は含めない（v0.3 §0.5） */
export interface ReadingInput {
  sessionId: string;
  /** 何を投げたか。Trigger Delta の判定に必須 */
  trigger: string;
  category: string | null;
  turns: SourceTurnRow[];
  /** 山田さん本人のログか（結果を分けて出すため） */
  isInternal: boolean;
}

export interface Signal {
  id: string;
  kind: SignalKind;
  /** 本人の発話からの verbatim 引用 */
  quote: string;
  turn: number;
  note: string;
}

export interface Candidate {
  id: string;
  text: string;
  basedOn: string[];
  /**
   * reading-v2：どこを見たか。**2つの事実の組**で表す。
   *
   * ⚠ Reading を「語られた事実同士の間にある、まだ名前のない関係」と定義したので、
   *   その「間」を構造として持たせる。お願いではなく、欄として必須にする。
   *   anchorA が trigger のときは「何を振ったのに、何が返ってきたか」（Trigger Delta）。
   */
  anchorA?: string;
  anchorASource?: "trigger" | "person";
  anchorB?: string;
  /** 2つの間のズレを1行で */
  gap?: string;
}

/** 4軸。各0〜3 */
export interface Score {
  evidence: number;
  specificity: number;
  risk: number;
  surprise: number;
  total: number;
}

export type DropReason =
  | "grounding"
  | "no_gap"
  | "internal_id"
  | "gender_assertion"
  | "person_verdict"
  | "diagnosis"
  | "advice"
  | "barnum_lexicon"
  | "barnum_swap"
  | "surprise_echo"
  | "no_assertion";

/**
 * 落ちた理由を、Benchmark の3つの問いに振り分ける。
 *   generation … そもそも根拠のある読みを作れたか
 *   form       … 人物評・心理診断・助言ではなく「語りの中のズレ」になっているか
 *   barnum     … 誰にでも当てはまらないか
 */
export const DROP_GROUP: Record<DropReason, "generation" | "form" | "barnum"> = {
  grounding: "generation",
  no_gap: "form",
  internal_id: "form",
  gender_assertion: "form",
  person_verdict: "form",
  diagnosis: "form",
  advice: "form",
  no_assertion: "form",
  barnum_lexicon: "barnum",
  barnum_swap: "barnum",
  surprise_echo: "barnum",
};

export interface EvaluatedCandidate {
  candidate: Candidate;
  groundedQuotes: number;
  ungroundedQuotes: string[];
  kinds: SignalKind[];
  lexiconHits: string[];
  /** 差し替え検査で「この人のことだ」と判定された他人ログの数 */
  swapYes: number;
  swapTested: number;
  /** 本人の発話の言い換えに過ぎない度合い（0〜1） */
  paraphraseRatio: number;
  hasAssertion: boolean;
  score: Score | null;
  dropped: DropReason | null;
}

export interface SessionResult {
  input: ReadingInput;
  signals: Signal[];
  evaluated: EvaluatedCandidate[];
  /** 最終的に残った1件。0件のこともある */
  openBet: EvaluatedCandidate | null;
  error?: string;
}

/**
 * Reading Abstention / Candidate Attrition（★Product Decision 2026-09-20）
 *
 * ⚠ なぜこれを必ず記録するのか。
 *   Barnum 検査を厳しくするほど、エンジンは
 *   「強い Reading を作る」のではなく「Reading を出さない」方向に
 *   最適化されうる。棄却率だけが下がって見える状態を避けるため、
 *   **どこで何件落ちたか**を常に一緒に出す。
 *
 *   Benchmark 上は「一般論を出すくらいなら棄却」でよい。
 *   ただし製品価値は「弱い Reading を出さないこと」ではなく、
 *   「本人固有の賭けを、一定確率で生み出せること」である。
 */
export interface Attrition {
  sessions: number;
  candidatesGenerated: number;
  /** 理由ごとの件数（reading-v2 以降。v1 の run には無い） */
  byReason?: Partial<Record<DropReason, number>>;
  droppedByGrounding: number;
  droppedByNoAssertion: number;
  droppedByBarnumLexicon: number;
  droppedByBarnumSwap: number;
  droppedBySurpriseEcho: number;
  survived: number;
  openBets: number;
  sessionsWithNoOpenBet: number;
}

export function emptyAttrition(): Attrition {
  return {
    sessions: 0,
    candidatesGenerated: 0,
    droppedByGrounding: 0,
    droppedByNoAssertion: 0,
    droppedByBarnumLexicon: 0,
    droppedByBarnumSwap: 0,
    droppedBySurpriseEcho: 0,
    survived: 0,
    openBets: 0,
    sessionsWithNoOpenBet: 0,
  };
}

/** Coverage = 強い Reading を生成できたセッションの割合 */
export function coverage(a: Attrition): number {
  return a.sessions === 0 ? 0 : a.openBets / a.sessions;
}
