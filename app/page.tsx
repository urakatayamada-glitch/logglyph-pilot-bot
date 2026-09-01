import Conversation from "../components/Conversation";
import { pickEpisode } from "../lib/episodes";

/**
 * サーバーコンポーネント。
 *
 * Episodeをサーバー側で取得して初期表示に含めている。
 * クライアントから取得すると「読み込み中」の空白が一瞬入り、
 * AIから話しかけられるという入り口の体験が弱くなるため。
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const episode = await pickEpisode();

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
        <Conversation episode={episode} />
      </section>
    </main>
  );
}
