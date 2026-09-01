/**
 * 時間帯によって背景の色を変える。
 *
 * 設計方針（Wave 1 / v1.5.0）:
 *   1. 文字色（--ink 系）は一切変えない。背景側だけを動かす。
 *      夜だけ配色を反転させると、可読性の検証対象が倍になるため。
 *   2. 夜も明度を落としすぎない。このUIは「白いカードにグレーの文字」が
 *      前提なので、背景だけ暗黒にすると成立しない。
 *      夜らしさは彩度と色相（藍・菫）で作る。
 *   3. Day のパレットは v1.4.0 の実装と完全に同じ値。
 *      日中は見た目が1ピクセルも変わらない。
 *   4. 4つのアンカーを時刻で線形補間する。境界で急に切り替わらない。
 *
 * サーバー時刻はUTCなので、時間帯の決定は必ずクライアント側で行う。
 */

export type Rgba = readonly [number, number, number, number];

/** CSS変数名の一覧。globals.css の :root と対応している。 */
export const THEME_VARS = [
  "--pg1", "--pg2", "--pg3", "--pg4", "--pg5", "--pg6", // ページ背景のグラデーション
  "--bl1", "--bl2", // body::after の漂う塊
  "--bl3", "--bl4", // .shell::before の漂う塊
  "--cg1", "--cg2", "--cg3", "--cg4", "--cg5", // 会話カードのグラデーション
  "--cb1", "--cb2", // .card::after の漂う塊
] as const;

export type ThemeVar = (typeof THEME_VARS)[number];
export type Palette = Record<ThemeVar, Rgba>;

function p(values: Rgba[]): Palette {
  const out = {} as Palette;
  THEME_VARS.forEach((name, i) => {
    out[name] = values[i];
  });
  return out;
}

/** 朝。白に近い、わずかに橙みのある空気。 */
const MORNING = p([
  [253, 239, 228, 1], [252, 233, 226, 1], [246, 230, 230, 1],
  [236, 235, 240, 1], [223, 232, 242, 1], [207, 227, 240, 1],
  [255, 214, 178, 0.9], [178, 214, 240, 0.8],
  [255, 228, 205, 0.85], [214, 238, 226, 0.8],
  [255, 250, 239, 1], [253, 246, 230, 1], [240, 243, 230, 1],
  [220, 236, 238, 1], [207, 231, 240, 1],
  [255, 245, 220, 0.95], [200, 232, 228, 0.75],
]);

/** 昼。v1.4.0 と完全に同じ値。 */
const DAY = p([
  [253, 233, 231, 1], [247, 232, 234, 1], [238, 231, 238, 1],
  [224, 227, 240, 1], [207, 220, 238, 1], [179, 211, 233, 1],
  [252, 196, 188, 0.95], [140, 196, 234, 0.9],
  [216, 206, 242, 0.9], [196, 234, 216, 0.85],
  [253, 247, 226, 1], [246, 246, 228, 1], [228, 241, 233, 1],
  [207, 233, 239, 1], [191, 227, 238, 1],
  [255, 248, 214, 0.95], [176, 224, 224, 0.8],
]);

/** 夕方。琥珀と薔薇。 */
const EVENING = p([
  [253, 228, 216, 1], [251, 220, 216, 1], [242, 216, 222, 1],
  [230, 213, 228, 1], [214, 207, 228, 1], [194, 198, 224, 1],
  [255, 190, 150, 0.92], [196, 164, 214, 0.85],
  [250, 200, 180, 0.88], [214, 196, 236, 0.8],
  [254, 243, 226, 1], [251, 234, 221, 1], [242, 226, 226, 1],
  [226, 220, 237, 1], [213, 214, 236, 1],
  [255, 236, 205, 0.92], [226, 206, 236, 0.78],
]);

/** 夜。藍と菫。
 *  縁と背景はしっかり沈めるが、カードの中央（文字が乗る面）は
 *  明るいまま残す。白いカードにグレーの文字という前提のUIなので、
 *  中央まで暗くすると成立しない。 */
const NIGHT = p([
  [201, 205, 232, 1], [194, 199, 228, 1], [185, 191, 224, 1],
  [174, 182, 218, 1], [164, 173, 212, 1], [152, 162, 204, 1],
  [150, 158, 214, 0.85], [126, 158, 200, 0.8],
  [170, 158, 214, 0.82], [140, 176, 200, 0.75],
  [238, 240, 250, 1], [231, 234, 247, 1], [219, 225, 242, 1],
  [200, 211, 234, 1], [185, 198, 228, 1],
  [228, 232, 250, 0.9], [172, 192, 220, 0.72],
]);

/**
 * アンカー。hour は 0〜24 の実数。
 * 22時から翌5時までは NIGHT → MORNING を跨いで補間する。
 */
export const ANCHORS: { hour: number; palette: Palette; name: string }[] = [
  { hour: 5, palette: MORNING, name: "morning" },
  { hour: 11, palette: DAY, name: "day" },
  { hour: 18, palette: EVENING, name: "evening" },
  { hour: 22, palette: NIGHT, name: "night" },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
    Math.round(lerp(a[3], b[3], t) * 1000) / 1000,
  ];
}

export function rgba([r, g, b, a]: Rgba): string {
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}

/**
 * 時刻（0〜24の実数）から、その瞬間のパレットを返す。
 *
 * 純粋関数。ネットワークもDOMも触らないのでテストできる。
 */
export function paletteAt(hour: number): Record<string, string> {
  const h = ((hour % 24) + 24) % 24;

  // 直前のアンカーを探す。5時より前なら前日の22時（NIGHT）から始まる。
  let fromIndex = ANCHORS.length - 1;
  for (let i = 0; i < ANCHORS.length; i++) {
    if (h >= ANCHORS[i].hour) fromIndex = i;
  }
  const toIndex = (fromIndex + 1) % ANCHORS.length;

  const from = ANCHORS[fromIndex];
  const to = ANCHORS[toIndex];

  const fromHour = from.hour;
  // 折り返し（22時 → 翌5時）は +24 して連続した数直線にする
  const toHour = to.hour > fromHour ? to.hour : to.hour + 24;
  const now = h >= fromHour ? h : h + 24;

  const span = toHour - fromHour;
  const t = span === 0 ? 0 : (now - fromHour) / span;

  const out: Record<string, string> = {};
  for (const name of THEME_VARS) {
    out[name] = rgba(mix(from.palette[name], to.palette[name], t));
  }
  return out;
}

/**
 * 描画前に <head> で実行するスクリプト。
 *
 * サーバー側で時間帯を決めるとUTCになってしまうため、
 * クライアントの現地時刻で決める必要がある。
 * ハイドレーション後に適用すると一瞬だけ既定色が見えるので、
 * body の描画前に実行する。
 */
export function themeInlineScript(): string {
  const anchors = ANCHORS.map((a) => ({
    hour: a.hour,
    values: THEME_VARS.map((n) => a.palette[n]),
  }));

  return `(function(){try{
var V=${JSON.stringify(THEME_VARS)},A=${JSON.stringify(anchors)};
function mix(a,b,t){return[Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*t),Math.round(a[2]+(b[2]-a[2])*t),Math.round((a[3]+(b[3]-a[3])*t)*1000)/1000]}
function s(c){return c[3]>=1?'rgb('+c[0]+','+c[1]+','+c[2]+')':'rgba('+c[0]+','+c[1]+','+c[2]+','+c[3]+')'}
function apply(){
var d=new Date(),h=d.getHours()+d.getMinutes()/60;
var f=A.length-1;for(var i=0;i<A.length;i++){if(h>=A[i].hour)f=i}
var g=(f+1)%A.length,fh=A[f].hour,th=A[g].hour>fh?A[g].hour:A[g].hour+24,n=h>=fh?h:h+24;
var t=th===fh?0:(n-fh)/(th-fh),r=document.documentElement;
for(var j=0;j<V.length;j++){r.style.setProperty(V[j],s(mix(A[f].values[j],A[g].values[j],t)))}
}
apply();setInterval(apply,600000);
}catch(e){}})();`;
}
