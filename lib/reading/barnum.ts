/**
 * S4. Barnum 差し替え検査（v0.3 §7）
 *
 * (a) 一般語彙チェック … 機械。ここで実装する
 * (b) 差し替え判定     … LLM。lib/reading/run.ts から呼ぶ
 *
 * ⚠ 第1回検査で実際に1件落ちた案：
 *     「あなたは続けることが苦手なタイプなんだと思う」
 *   → 他の3件すべてに当てはまった。Risk ゼロ。自己啓発の語彙。
 *   これを**固定の回帰テスト**にしている（tests/reading-score.test.mts）。
 */

/**
 * 誰にでも当てはまる文章に出てくる語。
 *
 * ⚠ これは減点ではなく**上限**として効かせる（score.ts）。
 *   減点にすると、他の軸が高ければ通ってしまう。
 */
/**
 * 誰にでも当てはまる文章に出てくる語を、2段に分ける。
 *
 * ⚠ 1つの表にしていたが、扱いが違うので分けた。
 *   「タイプ」「人一倍」は、出た時点でその文章は人物占いである。**即落とす。**
 *   「向き合う」「受け入れる」は、具体的な文脈の中でなら成立しうる。
 *   一律に落とすと、良い読みまで巻き込む。**上限を下げるだけにする。**
 */

/** 出た時点で棄却する語 */
export const BARNUM_LEXICON_HARD = [
  "タイプ",
  "人一倍",
  "実は繊細",
  "誰にでもある",
  "本当の自分",
  "自分らしさ",
  "バランスを取ろう",
  "優しい人",
  "頑張り屋",
  "大切にする",
  "大切にしている",
] as const;

/** Specificity の上限を 1 に下げる語 */
export const BARNUM_LEXICON_SOFT = [
  "前に進む",
  "向き合って",
  "受け入れる",
  "素直に",
  "自分を責め",
  "焦らずに",
] as const;

export const BARNUM_LEXICON = [
  ...BARNUM_LEXICON_HARD,
  ...BARNUM_LEXICON_SOFT,
] as const;

/** 断定を避ける語尾。これしか無い候補は Risk 0 で落とす */
export const HEDGE_PATTERNS = [
  "かもしれません",
  "かもしれない",
  "のかもしれ",
  "ではないでしょうか",
  "気がします",
  "ように思えます",
  "人もいます",
  "一般に",
  "一般的に",
] as const;

/** 賭けの言い切り。1つも無ければ Risk 0 */
export const ASSERT_PATTERNS = [
  "と思う",
  "と思います",
  "じゃないか",
  "ではないか",
  "んじゃないか",
  "に違いない",
  "はずだ",
  "だと思う",
  "賭けてみる",
] as const;

function norm(s: string): string {
  return s.normalize("NFKC");
}

export function lexiconHits(text: string): string[] {
  const t = norm(text);
  return BARNUM_LEXICON.filter((w) => t.includes(w));
}

/** 即棄却に当たる語だけ */
export function hardLexiconHits(text: string): string[] {
  const t = norm(text);
  return BARNUM_LEXICON_HARD.filter((w) => t.includes(w));
}

export function hedgeHits(text: string): string[] {
  const t = norm(text);
  return HEDGE_PATTERNS.filter((w) => t.includes(w));
}

/**
 * 言い切りを含むか。
 *
 * ⚠ 「かもしれません」だけで終わる文章は、外れようがない。
 *   外れようがない読みは、当たっても意味がない。**Risk 0 として落とす。**
 */
export function hasAssertion(text: string): boolean {
  const t = norm(text);
  const asserted = ASSERT_PATTERNS.some((w) => t.includes(w));
  if (!asserted) return false;
  // 言い切りより逃げ語のほうが多いなら、実質は逃げている
  return hedgeHits(text).length < ASSERT_PATTERNS.filter((w) => t.includes(w)).length + 1;
}
