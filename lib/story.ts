/**
 * Story Preview の純関数。
 *
 * ここには DB / fetch / React を持ち込まない。
 * node:test から依存なしで実行できる状態を保つ。
 *
 * ── Product Principle（内部設計原則。ユーザーに毎回説明するものではない）──
 *
 * LOGGLYPH はドラマを作るサービスではない。
 * 本体は「自分の記憶や経験を、自分自身の人文知として蓄積し、
 * 今とこれからの判断に活かすこと」。
 *
 * ドラマ化・進捗表示は、記憶を集め続けたくなるための体験装置である。
 * ただしユーザーが「ドラマが面白いから使う」のは何も問題ない。
 * どこから好奇心を持ってもらってもよく、結果として Memory が貯まれば目的は達する。
 *
 * ⚠ 実装中に主従が逆転する兆候（気づいたら止めて報告すること）:
 *   1. Fragment の文章の質を上げること自体が目的化している
 *   2. ％を上げること自体が動機になり、記憶が「素材集め」になっている
 *   3. Chapter 完成が終着点として設計され、経験知が付け足しになっている
 */

/* ============================================================
   カテゴリとスロット
   ============================================================

   ⚠ この％は「Story を生成するのに必要な情報がどれだけ揃ったか」であり、
     人生の完成度でも、心理学的・科学的な指標でもない。
     Pilot では暫定のルールベースで構わない、という Product Decision 済み。
*/

export const NARRATIVE_CATEGORIES = [
  "setting",
  "characters",
  "self",
  "events",
  "aftermath",
] as const;
export type NarrativeCategory = (typeof NARRATIVE_CATEGORIES)[number];

export function isNarrativeCategory(v: unknown): v is NarrativeCategory {
  return (
    typeof v === "string" &&
    (NARRATIVE_CATEGORIES as readonly string[]).includes(v)
  );
}

/** ユーザー画面は日本語で統一する。英語のカテゴリ名は出さない。 */
export const CATEGORY_LABELS: Record<NarrativeCategory, string> = {
  setting: "舞台・景色",
  characters: "登場人物",
  self: "あの頃の自分",
  events: "出来事・選択",
  aftermath: "その後",
};

export interface SlotDef {
  slot: string;
  /** 抽出側への説明 */
  hint: string;
  /** 「まだ見えていないもの」としてそのまま画面に出す文 */
  missing: string;
}

export const CATEGORY_SLOTS: Record<NarrativeCategory, SlotDef[]> = {
  setting: [
    { slot: "when", hint: "いつ頃のことか", missing: "それがいつ頃のことだったのか" },
    { slot: "where", hint: "どこでのことか", missing: "それがどこでのことだったのか" },
    {
      slot: "place_kind",
      hint: "そこはどんな場所だったか",
      missing: "その場所が、どんなところだったのか",
    },
  ],
  characters: [
    { slot: "who", hint: "誰がいたか", missing: "その場に、ほかに誰がいたのか" },
    {
      slot: "relation",
      hint: "その人とどんな関係だったか",
      missing: "その人とは、どんな関係だったのか",
    },
    {
      slot: "presence",
      hint: "その人は何をしていたか",
      missing: "その人が、そこで何をしていたのか",
    },
  ],
  self: [
    {
      slot: "wanted",
      hint: "当時なにを目指していたか",
      missing: "あの頃、本当は何を目指していたのか",
    },
    {
      slot: "conflicted",
      hint: "なにに迷っていたか",
      missing: "そのとき、何に迷っていたのか",
    },
    {
      slot: "believed",
      hint: "なにを大事にしていたか",
      missing: "あの頃、何を大事にしていたのか",
    },
  ],
  events: [
    { slot: "happened", hint: "何が起きたか", missing: "そこで実際に何が起きたのか" },
    { slot: "chose", hint: "何を選んだか", missing: "そのとき、何を選んだのか" },
    {
      slot: "not_chose",
      hint: "選ばなかったことは何か",
      missing: "選ばなかったほうには、何があったのか",
    },
  ],
  aftermath: [
    {
      slot: "changed",
      hint: "そのあと何が変わったか",
      missing: "そのあと、何が変わったのか",
    },
    {
      slot: "remains",
      hint: "いま残っているもの",
      missing: "いま、何が残っているのか",
    },
    {
      slot: "meaning_now",
      hint: "いまどう思っているか",
      missing: "いまそれを、どう思っているのか",
    },
  ],
};

export interface Facet {
  category: string;
  slot: string;
}

export type Scores = Record<NarrativeCategory, number>;

export function emptyScores(): Scores {
  return { setting: 0, characters: 0, self: 0, events: 0, aftermath: 0 };
}

/**
 * 充足率を出す。
 *
 * ⚠ 会話回数では増やさない。「1 session = +10%」のような実装は禁止。
 *   同じスロットの facet が何個増えても％は動かない。
 *   新しい種類のスロットが埋まったときだけ動く。
 */
export function scoreFacets(facets: Facet[]): { scores: Scores; overall: number } {
  const filled = new Map<NarrativeCategory, Set<string>>();
  for (const c of NARRATIVE_CATEGORIES) filled.set(c, new Set());

  for (const f of facets) {
    if (!isNarrativeCategory(f.category)) continue;
    const defs = CATEGORY_SLOTS[f.category];
    if (!defs.some((d) => d.slot === f.slot)) continue; // 未知のスロットは数えない
    filled.get(f.category)!.add(f.slot);
  }

  const scores = emptyScores();
  for (const c of NARRATIVE_CATEGORIES) {
    const total = CATEGORY_SLOTS[c].length;
    scores[c] = Math.round((filled.get(c)!.size / total) * 100);
  }
  const overall = Math.round(
    NARRATIVE_CATEGORIES.reduce((a, c) => a + scores[c], 0) / NARRATIVE_CATEGORIES.length
  );
  return { scores, overall };
}

/** まだ埋まっていないスロット。不足の少ないカテゴリから順に返す（あと少しで埋まる順） */
export function missingSlots(
  facets: Facet[]
): Array<{ category: NarrativeCategory; slot: string; missing: string }> {
  const filled = new Map<NarrativeCategory, Set<string>>();
  for (const c of NARRATIVE_CATEGORIES) filled.set(c, new Set());
  for (const f of facets) {
    if (!isNarrativeCategory(f.category)) continue;
    filled.get(f.category)!.add(f.slot);
  }

  const out: Array<{ category: NarrativeCategory; slot: string; missing: string }> = [];
  for (const c of NARRATIVE_CATEGORIES) {
    for (const d of CATEGORY_SLOTS[c]) {
      if (!filled.get(c)!.has(d.slot)) {
        out.push({ category: c, slot: d.slot, missing: d.missing });
      }
    }
  }
  return out;
}

/** 次に補いたいカテゴリ。空きが多い順。Episode の優先抽選に渡す */
export function neededCategories(facets: Facet[], limit = 2): NarrativeCategory[] {
  const { scores } = scoreFacets(facets);
  return [...NARRATIVE_CATEGORIES]
    .filter((c) => scores[c] < 100)
    .sort((a, b) => scores[a] - scores[b])
    .slice(0, limit);
}

/** 「65% → 80%」を出すための差分。変化のあったカテゴリだけ返す */
export function changedCategories(
  before: Partial<Scores> | null,
  after: Scores
): Array<{ category: NarrativeCategory; from: number; to: number }> {
  const out: Array<{ category: NarrativeCategory; from: number; to: number }> = [];
  for (const c of NARRATIVE_CATEGORIES) {
    const from = before?.[c] ?? 0;
    if (after[c] > from) out.push({ category: c, from, to: after[c] });
  }
  return out;
}

/* ============================================================
   Story Fragment の検証
   ============================================================

   ⚠ 抽象的な禁止をプロンプトに書いても守られない、というのは
     このプロジェクトで既に確認済みの経験則である。
     機械的にチェックできるものはコードで止める。違反したら表示しない。
*/

export const FRAGMENT_MIN = 120;
export const FRAGMENT_MAX = 600;

/**
 * 断定的な感情語。
 * 「本人が言っていないのに内面を決めつける」ことを防ぐ。
 * 「〜かもしれない」を伴う形は許す（下の判定で除外する）。
 */
export const FORBIDDEN_ASSERTIONS = [
  "絶望",
  "後悔していた",
  "幸せだった",
  "不幸だった",
  "満たされていた",
  "愛していた",
  "憎んでいた",
  "孤独だった",
  "救われた",
] as const;

export interface FragmentCheck {
  ok: boolean;
  reason?: "too_short" | "too_long" | "invented_number" | "asserted_emotion";
  detail?: string;
}

/**
 * 生成された Fragment を検証する。
 *
 * 1. 長さ
 * 2. 会話に出てこない数字を足していないか（年号・人数などの捏造）
 * 3. 断定的な感情語を使っていないか
 *
 * ⚠ 固有名詞の照合は入れていない。日本語では誤検出が多く、
 *   まともなシーンまで落としてしまうため。ここは今後の課題として残す。
 */
export function checkFragment(body: string, sourceText: string): FragmentCheck {
  const text = body.trim();
  if (text.length < FRAGMENT_MIN) return { ok: false, reason: "too_short" };
  if (text.length > FRAGMENT_MAX) return { ok: false, reason: "too_long" };

  const srcDigits = new Set((sourceText.match(/\d+/g) ?? []).map(String));
  for (const n of text.match(/\d+/g) ?? []) {
    if (!srcDigits.has(n)) {
      return { ok: false, reason: "invented_number", detail: n };
    }
  }

  for (const w of FORBIDDEN_ASSERTIONS) {
    const i = text.indexOf(w);
    if (i < 0) continue;
    // 「〜かもしれない」「〜だろうか」を伴う形は断定ではないので許す
    const after = text.slice(i, i + w.length + 20);
    if (/かもしれない|のだろうか|ようにも見え/.test(after)) continue;
    return { ok: false, reason: "asserted_emotion", detail: w };
  }

  return { ok: true };
}


/* ============================================================
   Episode の優先抽選
   ============================================================ */

export interface TaggedEpisode {
  id: string;
  narrative_categories?: string[] | null;
}

/**
 * 不足カテゴリに合う Episode があれば、それだけを候補にする。
 * 無ければ元の候補をそのまま返す（枯渇しない）。
 *
 * ⚠ 絞り込みではなく優先。
 *   Story Preview で「登場人物がまだ見えていない」と伝えておきながら、
 *   次回に無関係な Episode が出ると体験が切れる。それを避けるためのもの。
 * ⚠ 会話のしかたは変えない。変わるのは「どの話題から入るか」だけ。
 */
export function preferredPool<T extends TaggedEpisode>(
  episodes: T[],
  preferCategories: string[]
): T[] {
  if (preferCategories.length === 0) return episodes;
  const want = new Set(preferCategories);
  const hit = episodes.filter((e) =>
    (e.narrative_categories ?? []).some((c) => want.has(c))
  );
  return hit.length > 0 ? hit : episodes;
}
