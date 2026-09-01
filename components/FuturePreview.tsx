"use client";

/**
 * 会話のあとに出す「この先どう育つか」の面。
 *
 * Product Decision（Wave 1 指示書 ④／⑧）:
 *   - 架空データを使わない
 *   - 「4 / 20」のような固定分母を出さない（分母を出すと
 *     「20たまると何かが起きる」という約束になってしまう）
 *   - 架空のカテゴリ内訳も出さない
 *   - 完成済み機能だと誤認させない
 *
 * したがってここに出るのは、本人の実データ（件数と自分の一行）だけ。
 */
export default function FuturePreview({
  memoryCount,
  recentMemories,
}: {
  memoryCount: number | null;
  recentMemories: string[];
}) {
  const hasData = memoryCount !== null;
  const hasLines = recentMemories.length > 0;

  return (
    <div className="future">
      <p className="future-h">これまでに見つかった記憶</p>

      {hasData && memoryCount > 0 && (
        <p className="future-count">
          <b>{memoryCount}</b>つ
        </p>
      )}

      {hasLines ? (
        <ul className="future-list">
          {recentMemories.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      ) : (
        <p className="future-empty">
          まだ、ここには何もありません。
          <br />
          話すたびに、ここに増えていきます。
        </p>
      )}

      <p className="future-lead">
        会話を重ねることで、これらは少しずつ、
      </p>
      <ul className="future-dirs">
        <li>
          <span>01</span>あなたの経験から得られた知恵
        </li>
        <li>
          <span>02</span>AIがあなたを理解するための情報
        </li>
        <li>
          <span>03</span>あなた自身の物語
        </li>
      </ul>
      <p className="future-lead">へ育っていきます。</p>

      <p className="future-note">
        この3つは現在開発中で、まだ受け取れません。
        <br />
        いまお見せしているのは、これから育っていく未来のイメージです。
      </p>
    </div>
  );
}
