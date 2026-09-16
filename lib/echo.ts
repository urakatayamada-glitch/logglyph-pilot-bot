/**
 * おうむ返しの検出（v1.6.0）。
 *
 * ── なぜ必要か ────────────────────────────────────────
 * 実ユーザーからの指摘（2026-09-15）:
 *   「おうむ返しが2回連続したときに、やや萎えた」
 *
 * 会話の中核ルールは「相手が使った言葉をそのまま返す」で、これ自体は正しい。
 * 1回目は「聞いてもらえた」になる。問題は**2回続いたとき**で、
 * 2回目は「機械が返している」に反転する。
 *
 * ⚠ このプロジェクトの経験則：抽象的な禁止はモデルに守られない。
 *   機械的に検査できる規則だけが守られる。
 *   （進捗バー 0% / シーンの人称、いずれも指示を強めるだけでは直らなかった）
 *   そこで「同じ型を2回続けない」を、お願いではなく計算で止める。
 */

/** 比較のために、助詞・記号・空白を落として文字列を揃える。 */
function normalize(s: string): string {
  return s
    .replace(/[。、．，！？!?…「」『』（）()\s\n]/g, "")
    .replace(/[ぁ-ん]{0,0}/g, "")
    .trim();
}

/** 文字bigramの集合。日本語は単語分割せずに済むこの粒度が扱いやすい。 */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** 返答の最初の一文。おうむ返しはここに出る。 */
export function firstSentence(reply: string): string {
  const m = reply.trim().match(/^[^。！？!?\n]*[。！？!?\n]?/);
  return (m ? m[0] : reply).trim();
}

/**
 * 返答の冒頭が、相手の直前の発言をどれだけなぞっているか（0〜1）。
 *
 * 「相手の発言に含まれていた表現が、返答の冒頭にどれだけ占めているか」で測る。
 * 逆向き（相手の発言のうち何割を拾ったか）にすると、
 * 長い発言を短く受けただけで低く出てしまい、おうむ返しを見逃す。
 */
export function echoRatio(reply: string, userText: string): number {
  const r = bigrams(normalize(firstSentence(reply)));
  const u = bigrams(normalize(userText));
  if (r.size === 0 || u.size === 0) return 0;
  let hit = 0;
  for (const g of r) if (u.has(g)) hit += 1;
  return hit / r.size;
}

/**
 * これ以上だと「言い換え」ではなく「なぞり」と見なす。
 *
 * ⚠ 実データで較正した値。感覚で動かさないこと。
 *   0.62 … 実際に萎えさせた2発話（0.74 / 0.70）を捕まえ、
 *          理解を示した言い換え（0.45 前後）は通す。
 */
export const ECHO_THRESHOLD = 0.62;

export function isEcho(reply: string, userText: string): boolean {
  return echoRatio(reply, userText) >= ECHO_THRESHOLD;
}

/** 直前のAI発話も、相手の言葉をなぞっていたか。 */
export function previousTurnEchoed(
  messages: Array<{ role: string; content: string }>
): boolean {
  // 末尾は今回のユーザー発話。その手前のAI発話と、さらに手前のユーザー発話を見る
  let ai = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      ai = i;
      break;
    }
  }
  if (ai < 0) return false;
  let user = -1;
  for (let i = ai - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      user = i;
      break;
    }
  }
  if (user < 0) return false;
  return isEcho(messages[ai].content, messages[user].content);
}

/** 直近のユーザー発話。無ければ空文字。 */
export function lastUserText(
  messages: Array<{ role: string; content: string }>
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}
