/**
 * 時間帯パレットの境界値テスト。
 *
 * TypeScriptを直接importできないため、lib/theme-time.ts と同じ
 * アンカーと補間ロジックをここに写して検証する。
 * 仕様変更時は両方を更新すること。
 *
 *   node --test tests/theme-time.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

const VARS = [
  "--pg1","--pg2","--pg3","--pg4","--pg5","--pg6",
  "--bl1","--bl2","--bl3","--bl4",
  "--cg1","--cg2","--cg3","--cg4","--cg5",
  "--cb1","--cb2",
];

const MORNING = [
  [253,239,228,1],[252,233,226,1],[246,230,230,1],[236,235,240,1],[223,232,242,1],[207,227,240,1],
  [255,214,178,.9],[178,214,240,.8],[255,228,205,.85],[214,238,226,.8],
  [255,250,239,1],[253,246,230,1],[240,243,230,1],[220,236,238,1],[207,231,240,1],
  [255,245,220,.95],[200,232,228,.75],
];
const DAY = [
  [253,233,231,1],[247,232,234,1],[238,231,238,1],[224,227,240,1],[207,220,238,1],[179,211,233,1],
  [252,196,188,.95],[140,196,234,.9],[216,206,242,.9],[196,234,216,.85],
  [253,247,226,1],[246,246,228,1],[228,241,233,1],[207,233,239,1],[191,227,238,1],
  [255,248,214,.95],[176,224,224,.8],
];
const EVENING = [
  [243,169,126,1],[239,148,128,1],[224,127,146,1],[192,111,162,1],[146,99,154,1],[99,87,138,1],
  [255,150,90,.95],[170,110,190,.9],[255,180,120,.9],[190,130,200,.85],
  [255,241,222,1],[255,224,194,1],[255,205,176,1],[238,170,147,1],[226,158,162,1],
  [255,225,175,.95],[230,170,180,.85],
];
const NIGHT = [
  [47,55,102,1],[43,50,94,1],[38,45,85,1],[33,40,75,1],[28,35,65,1],[23,29,54,1],
  [90,105,190,.9],[60,90,150,.85],[120,100,190,.88],[70,110,150,.8],
  [230,236,252,1],[216,224,247,1],[202,214,244,1],[168,184,221,1],[162,176,216,1],
  [226,234,255,.9],[150,175,215,.8],
];

const ANCHORS = [
  { hour: 5, values: MORNING },
  { hour: 9, values: DAY },
  { hour: 16, values: DAY },
  { hour: 18.5, values: EVENING },
  { hour: 21, values: NIGHT },
];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
    Math.round((a[3] + (b[3] - a[3]) * t) * 1000) / 1000,
  ];
}
function s(c) {
  return c[3] >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
}
function paletteAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let f = ANCHORS.length - 1;
  for (let i = 0; i < ANCHORS.length; i++) if (h >= ANCHORS[i].hour) f = i;
  const g = (f + 1) % ANCHORS.length;
  const fh = ANCHORS[f].hour;
  const th = ANCHORS[g].hour > fh ? ANCHORS[g].hour : ANCHORS[g].hour + 24;
  const n = h >= fh ? h : h + 24;
  const t = th === fh ? 0 : (n - fh) / (th - fh);
  const out = {};
  VARS.forEach((name, i) => {
    out[name] = s(mix(ANCHORS[f].values[i], ANCHORS[g].values[i], t));
  });
  return out;
}

test("アンカー時刻ではそのパレットと完全に一致する", () => {
  assert.equal(paletteAt(5)["--pg1"], s(MORNING[0]));
  assert.equal(paletteAt(9)["--pg1"], s(DAY[0]));
  assert.equal(paletteAt(18.5)["--pg1"], s(EVENING[0]));
  assert.equal(paletteAt(21)["--pg1"], s(NIGHT[0]));
});

test("9時から16時までは、昼のパレットのまま動かない", () => {
  // 夕方を濃くしたので、アンカーが1つだと13時が夕方へ引っ張られる
  for (const h of [9, 10, 11, 12, 13, 14, 15, 16]) {
    for (const v of VARS) {
      assert.equal(paletteAt(h)[v], paletteAt(12)[v], `h=${h} ${v}`);
    }
  }
});

test("昼のパレットは v1.4.0 の実装値と同じ（日中は見た目が変わらない）", () => {
  const p = paletteAt(13);
  assert.equal(p["--pg1"], "rgb(253,233,231)");
  assert.equal(p["--pg6"], "rgb(179,211,233)");
  assert.equal(p["--bl1"], "rgba(252,196,188,0.95)");
  assert.equal(p["--cg1"], "rgb(253,247,226)");
  assert.equal(p["--cb2"], "rgba(176,224,224,0.8)");
});

test("深夜（22時→翌5時）を跨いで補間が連続する", () => {
  // 折り返しの前後で値が飛ばないこと
  const before = paletteAt(23.99)["--pg1"];
  const after = paletteAt(0.01)["--pg1"];
  const n = (str) => str.match(/\d+/g).slice(0, 3).map(Number);
  const [r1, g1, b1] = n(before);
  const [r2, g2, b2] = n(after);
  assert.ok(Math.abs(r1 - r2) <= 2, `r: ${r1} vs ${r2}`);
  assert.ok(Math.abs(g1 - g2) <= 2, `g: ${g1} vs ${g2}`);
  assert.ok(Math.abs(b1 - b2) <= 2, `b: ${b1} vs ${b2}`);
});

test("24時間どこでも全変数が定義される", () => {
  for (let h = 0; h < 24; h += 0.25) {
    const p = paletteAt(h);
    for (const v of VARS) {
      assert.ok(p[v] && /^rgba?\(/.test(p[v]), `h=${h} ${v}`);
    }
  }
});

// ---- 可読性：本文色 --ink (#39414d) に対するコントラスト比 ----
function lum([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

const INK = [57, 65, 77]; // --ink #39414d

function worstContrast(vars) {
  let worst = Infinity;
  let at = "";
  for (let h = 0; h < 24; h += 0.5) {
    const p = paletteAt(h);
    for (const v of vars) {
      const rgb = p[v].match(/\d+/g).slice(0, 3).map(Number);
      const c = contrast(INK, rgb);
      if (c < worst) {
        worst = c;
        at = `h=${h} ${v} ${p[v]}`;
      }
    }
  }
  return { worst, at };
}

test("導入・注意画面の文字が乗るカード中央は、どの時刻でも AAA(7:1)", () => {
  // radial-gradient(120% 78% at 50% 46%) の中央寄り＝文字が実際に乗る面
  const { worst, at } = worstContrast(["--cg1", "--cg2", "--cg3"]);
  assert.ok(worst >= 7, `AAA未達 ${worst.toFixed(2)}:1 @ ${at}`);
});

test("カードの外周でも、どの時刻でも AA(4.5:1) を下回らない", () => {
  const { worst, at } = worstContrast(["--cg4", "--cg5"]);
  assert.ok(worst >= 4.5, `AA未達 ${worst.toFixed(2)}:1 @ ${at}`);
});

test("夕方・夜が、誰でも気づく程度に昼と違う", () => {
  // v1.5.1 までは差が小さく、時間帯で変わっていることに気づかれなかった
  const rgb = (h, v) => paletteAt(h)[v].match(/\d+/g).slice(0, 3).map(Number);
  const dist = (a, b) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

  const dayPage = rgb(13, "--pg1");
  const dayCard = rgb(13, "--cg5");

  // ページ背景は文字が乗らないので、はっきり変える
  assert.ok(dist(dayPage, rgb(18.5, "--pg1")) >= 120, "夕方のページ背景の差が小さい");
  assert.ok(dist(dayPage, rgb(23, "--pg1")) >= 300, "夜のページ背景の差が小さい");
  // カードの外周も変える（中央は文字が乗るので明るいまま）
  assert.ok(dist(dayCard, rgb(18.5, "--cg5")) >= 80, "夕方のカード外周の差が小さい");
  assert.ok(dist(dayCard, rgb(23, "--cg5")) >= 60, "夜のカード外周の差が小さい");
});
