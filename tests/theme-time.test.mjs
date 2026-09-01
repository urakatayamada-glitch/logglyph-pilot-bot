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
  [253,228,216,1],[251,220,216,1],[242,216,222,1],[230,213,228,1],[214,207,228,1],[194,198,224,1],
  [255,190,150,.92],[196,164,214,.85],[250,200,180,.88],[214,196,236,.8],
  [254,243,226,1],[251,234,221,1],[242,226,226,1],[226,220,237,1],[213,214,236,1],
  [255,236,205,.92],[226,206,236,.78],
];
const NIGHT = [
  [201,205,232,1],[194,199,228,1],[185,191,224,1],[174,182,218,1],[164,173,212,1],[152,162,204,1],
  [150,158,214,.85],[126,158,200,.8],[170,158,214,.82],[140,176,200,.75],
  [238,240,250,1],[231,234,247,1],[219,225,242,1],[200,211,234,1],[185,198,228,1],
  [228,232,250,.9],[172,192,220,.72],
];

const ANCHORS = [
  { hour: 5, values: MORNING },
  { hour: 11, values: DAY },
  { hour: 18, values: EVENING },
  { hour: 22, values: NIGHT },
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
  assert.equal(paletteAt(11)["--pg1"], s(DAY[0]));
  assert.equal(paletteAt(18)["--pg1"], s(EVENING[0]));
  assert.equal(paletteAt(22)["--pg1"], s(NIGHT[0]));
});

test("昼のパレットは v1.4.0 の実装値と同じ（日中は見た目が変わらない）", () => {
  const p = paletteAt(11);
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

test("夜と昼が、見て分かる程度に違う", () => {
  // 夜が昼とほぼ同じ色だと、時間帯を変えた意味がない
  const day = paletteAt(11)["--pg1"].match(/\d+/g).map(Number);
  const night = paletteAt(23)["--pg1"].match(/\d+/g).map(Number);
  const diff =
    Math.abs(day[0] - night[0]) + Math.abs(day[1] - night[1]) + Math.abs(day[2] - night[2]);
  assert.ok(diff >= 60, `昼と夜の差が小さすぎる: ${diff}`);
});
