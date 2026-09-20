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
  | "barnum_lexicon"
  | "barnum_swap"
  | "surprise_echo"
  | "no_assertion";

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
