/**
 * 構造化抽出用のprompt。会話とは別工程で呼ぶ。
 *
 * ここでの最重要原則は「根拠のないものを生成しない」こと。
 * Pilot Protocol v1で確定した原則をそのまま反映している。
 */
export const EXTRACTION_PROMPT = `あなたは、会話ログから事実を整理する記録係です。

以下の会話から、相手（user）が実際に話した内容だけを構造化してください。

# 絶対に守ること

1. 会話の中で本人が実際に述べたことだけを抽出してください。
2. 十分な根拠がない項目は、無理に埋めず null または空配列にしてください。
3. 本人が明示していない性格・動機・心理状態を、推測して書かないでください。
4. 「〜だろう」「〜のはずだ」という解釈を加えないでください。
5. 会話を要約するのではなく、話された事実を拾ってください。

該当する内容がないことは、失敗ではありません。
むしろ、無理に生成する方が誤りです。

# 各項目の意味

- one_line_memory: 本人に見せる一行のログ。本人の言葉に近い形で。話すことがなかった会話なら、その事実をそのまま書く。
- event: 何が起きたか。本人が語った出来事。
- emotion: 本人が語った感情。本人が口にしていない感情を足さない。
- people_relation: 会話に出てきた人物との関係（「後輩」「母」など）。個人名は含めない。
- decision: 本人が語った選択・判断。なければ null。
- desire: 本人が語った願望。なければ null。
- regret: 本人が語った後悔。なければ null。
- hidden_candidate: 本人がまだはっきり言葉にしていなかったが、発言に明確な根拠がある「意味の断片」を一文で。根拠が薄い場合は必ず null。断定せず、本人の発言の範囲を超えないこと。
- memory_trigger_category: 会話の中心にあった話題のカテゴリ。
- confidence: この抽出全体の確からしさ。0.0〜1.0。会話が薄い場合は低くする。
- memory_found: 本人が実際に自分の記憶・出来事を語ったなら true。何も語らなかったなら false。`;

/**
 * OpenAI Structured Outputs 用のJSON Schema。
 * パース失敗を構造的に防ぐため、text形式ではなくschemaで受け取る。
 */
export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    one_line_memory: { type: "string" },
    event: { type: ["string", "null"] },
    emotion: { type: "array", items: { type: "string" } },
    people_relation: { type: "array", items: { type: "string" } },
    decision: { type: ["string", "null"] },
    desire: { type: ["string", "null"] },
    regret: { type: ["string", "null"] },
    hidden_candidate: { type: ["string", "null"] },
    memory_trigger_category: { type: ["string", "null"] },
    confidence: { type: "number" },
    memory_found: { type: "boolean" },
  },
  required: [
    "one_line_memory",
    "event",
    "emotion",
    "people_relation",
    "decision",
    "desire",
    "regret",
    "hidden_candidate",
    "memory_trigger_category",
    "confidence",
    "memory_found",
  ],
} as const;

export interface StructuredMemory {
  one_line_memory: string;
  event: string | null;
  emotion: string[];
  people_relation: string[];
  decision: string | null;
  desire: string | null;
  regret: string | null;
  hidden_candidate: string | null;
  memory_trigger_category: string | null;
  confidence: number;
  memory_found: boolean;
}
