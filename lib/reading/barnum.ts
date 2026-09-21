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

/**
 * 断定を避ける言い方。
 *
 * ⚠ reading-v1 では「と思う」「じゃないか」という**語尾の型**を探して言い切りを判定していた。
 *   第1回 Benchmark で、63件中55件がそれで落ちた。実物は「〜である」「〜人物だ」と
 *   地の文で断定していた。**言い切りではなく、私の口調を測っていた。**
 *
 *   v2 では向きを逆にする。「言い切りの型があるか」ではなく
 *   **「逃げていない文が1つでもあるか」**で判定する。
 */
export const HEDGE_PATTERNS = [
  "かもしれ",
  "のかも",
  "ではないでしょうか",
  "気がします",
  "気がする",
  "ように思えます",
  "ように見える",
  "ようだ",
  "可能性が",
  "考えられる",
  "うかがえる",
  "伺える",
  "示唆",
  "人もいます",
  "一般に",
  "一般的に",
  "だろうか",
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

/** 文に割る（言い切り判定用） */
function splitSentences(text: string): string[] {
  return norm(text)
    .split(/[。！？!?\n]/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
}

/**
 * 賭けているか ── 逃げ語を含まない文が1つでもあるか。
 *
 * ⚠ 「かもしれません」だけで組み立てた文章は、外れようがない。
 *   外れようがない読みは、当たっても意味がない。
 * ⚠ 一方で「〜である」「〜のだ」「〜と思う」は、どれも賭けである。語尾の型は問わない。
 */
export function hasAssertion(text: string): boolean {
  return splitSentences(text).some((s) => !HEDGE_PATTERNS.some((h) => s.includes(h)));
}
