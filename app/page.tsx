import { cookies } from "next/headers";
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
  /*
   * 直近に出したEpisodeを除外して選ぶ。
   *
   * ここが除外リスト無しで呼ばれていたため、同じ人に同じ話が
   * 何度も出ていた（「前にも同じ事聞かれた」の原因）。
   * クライアント側が Cookie に残した直近のidを読んで渡す。
   */
  const store = await cookies();
  const recent = (store.get("lg_recent")?.value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const episode = await pickEpisode(recent);

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
