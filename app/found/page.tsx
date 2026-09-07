import Found from "../../components/Found";

/**
 * 「あなたが話してくれたこと」
 *
 * 薄いサーバーシェル。中身は client_token（localStorage）が必要なので
 * クライアント側で取得する。ここではレイアウトとテーマだけを継承する。
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "あなたが話してくれたこと ｜ LOGGLYPH",
};

export default function FoundPage() {
  return (
    <main className="shell">
      <section className="card">
        <header>
          <div className="glyph">L</div>
          <div>
            <h1>LOGGLYPH</h1>
            <p>PILOT / conversation experiment</p>
          </div>
        </header>
        <Found />
      </section>
    </main>
  );
}
