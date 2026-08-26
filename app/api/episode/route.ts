import { NextResponse } from "next/server";
import { pickEpisode } from "../../../lib/episodes";

/**
 * Episodeの取得。
 *
 * 通常の初回表示はサーバーコンポーネント（app/page.tsx）で取得するため
 * ここは通らない。「もう一度話す」でセッションをやり直すときに使う。
 */
export async function POST(req: Request) {
  try {
    const { excludeIds } = await req.json().catch(() => ({ excludeIds: [] }));
    const episode = await pickEpisode(
      Array.isArray(excludeIds) ? excludeIds : []
    );
    return NextResponse.json({ ok: true, episode });
  } catch (error) {
    console.error("episode fetch failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
