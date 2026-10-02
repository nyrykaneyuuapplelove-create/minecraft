// 16x16 のテクスチャをすべて手続き的に生成する（外部の画像素材は使わない）。
// albedo: RGBA（αは切り抜き用）  mask: R=バイオーム着色の強さ, G=発光, B=予備

import { TEXTURE_NAMES } from "./blocks";
import { mulberry32 } from "./noise";

export const TEX = 16;
type RGB = [number, number, number];

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const strHash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, f: number): RGB => [a[0] * f, a[1] * f, a[2] * f];
const hex = (h: number): RGB => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

class Tile {
  c = new Uint8ClampedArray(TEX * TEX * 4);
  m = new Uint8ClampedArray(TEX * TEX * 4);
  constructor() {
    for (let i = 0; i < TEX * TEX; i++) this.m[i * 4 + 3] = 255;
  }
  px(x: number, y: number, col: RGB, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    const i = (y * TEX + x) * 4;
    this.c[i] = clamp8(col[0]); this.c[i + 1] = clamp8(col[1]); this.c[i + 2] = clamp8(col[2]); this.c[i + 3] = a;
  }
  alpha(x: number, y: number) {
    return this.c[(y * TEX + x) * 4 + 3];
  }
  get(x: number, y: number): RGB {
    const i = (((y + TEX) % TEX) * TEX + ((x + TEX) % TEX)) * 4;
    return [this.c[i], this.c[i + 1], this.c[i + 2]];
  }
  tint(x: number, y: number, v = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    this.m[(y * TEX + x) * 4] = v;
  }
  emis(x: number, y: number, v = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= TEX || y >= TEX) return;
    this.m[(y * TEX + x) * 4 + 1] = v;
  }
  each(fn: (x: number, y: number) => void) {
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) fn(x, y);
  }
  disc(cx: number, cy: number, r: number, col: RGB, a = 255) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.px(x, y, col, a);
  }
  vline(x: number, y0: number, y1: number, col: RGB) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.px(x, y, col);
  }
}

/** 周期的な値ノイズ（0..1）。cells はタイル内の格子数 */
function makeNoise(rng: () => number, cells: number) {
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  return (x: number, y: number) => {
    const fx = (x / TEX) * cells, fy = (y / TEX) * cells;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const w = (v: number) => ((v % cells) + cells) % cells;
    const a = g[w(y0) * cells + w(x0)], b = g[w(y0) * cells + w(x0 + 1)];
    const c = g[w(y0 + 1) * cells + w(x0)], d = g[w(y0 + 1) * cells + w(x0 + 1)];
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}
const fractal = (rng: () => number) => {
  const a = makeNoise(rng, 4), b = makeNoise(rng, 8), c = makeNoise(rng, 2);
  return (x: number, y: number) => c(x, y) * 0.3 + a(x, y) * 0.45 + b(x, y) * 0.25;
};

/** 周期的ボロノイ。戻り値: [最近点ID, 最近距離, 2番目との差] */
function makeVoronoi(rng: () => number, n: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * n; i++) pts.push([(i % n + rng() * 0.9 + 0.05) * (TEX / n), (Math.floor(i / n) + rng() * 0.9 + 0.05) * (TEX / n)]);
  return (x: number, y: number): [number, number, number] => {
    let d1 = 1e9, d2 = 1e9, id = 0;
    for (let i = 0; i < pts.length; i++) {
      let dx = Math.abs(x + 0.5 - pts[i][0]), dy = Math.abs(y + 0.5 - pts[i][1]);
      if (dx > TEX / 2) dx = TEX - dx;
      if (dy > TEX / 2) dy = TEX - dy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
    }
    return [id, d1, d2 - d1];
  };
}

type Gen = (t: Tile, rng: () => number, name: string) => void;
const GENS: Record<string, Gen> = {};

GENS.air = () => {};

// ---- 基本素材 ----------------------------------------------------------------
function stoneLike(t: Tile, rng: () => number, base: RGB, amp: number, fleck = 0.06, fleckAmt = 22) {
  const n = fractal(rng);
  t.each((x, y) => {
    let v = (n(x, y) - 0.5) * amp * 2;
    v = Math.round(v / 5) * 5;
    if (rng() < fleck) v -= fleckAmt;
    t.px(x, y, [base[0] + v, base[1] + v, base[2] + v]);
  });
}
GENS.stone = (t, r) => stoneLike(t, r, [126, 126, 126], 14);
GENS.andesite = (t, r) => stoneLike(t, r, [138, 138, 140], 16, 0.05, 20);
GENS.diorite = (t, r) => stoneLike(t, r, [190, 190, 192], 20, 0.1, 40);
GENS.granite = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round((n(x, y) - 0.5) * 36 / 6) * 6;
    t.px(x, y, [152 + v, 104 + v * 0.8, 88 + v * 0.7]);
  });
};
GENS.calcite = (t, r) => stoneLike(t, r, [224, 224, 220], 6, 0.04, 14);
GENS.deepslate_top = (t, r) => stoneLike(t, r, [74, 74, 80], 8, 0.05, 14);
GENS.deepslate = (t, r) => {
  const n = fractal(r);
  const cols = Array.from({ length: TEX }, () => (r() - 0.5) * 16);
  t.each((x, y) => {
    let v = (n(x, y) - 0.5) * 16 + cols[x];
    if (y % 8 === 3) v -= 12;
    v = Math.round(v / 4) * 4;
    t.px(x, y, [70 + v, 70 + v, 78 + v]);
  });
};
GENS.bedrock = (t, r) => {
  const v = makeVoronoi(r, 4);
  t.each((x, y) => {
    const [id, , edge] = v(x, y);
    const base = 70 + ((id * 37) % 5) * 7;
    t.px(x, y, edge < 0.8 ? [28, 28, 28] : [base, base, base]);
  });
};
GENS.dirt = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    let v = Math.round(((n(x, y) - 0.5) * 30) / 5) * 5;
    const q = r();
    let c: RGB = [134 + v, 96 + v * 0.8, 67 + v * 0.6];
    if (q < 0.07) c = [108, 74, 48];
    else if (q < 0.11) c = [152, 112, 80];
    else if (q < 0.125) c = [122, 118, 112];
    t.px(x, y, c);
  });
};
GENS.mud = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round(((n(x, y) - 0.5) * 20) / 4) * 4;
    t.px(x, y, [64 + v, 56 + v, 58 + v]);
  });
};
GENS.clay = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round(((n(x, y) - 0.5) * 16) / 4) * 4;
    t.px(x, y, [160 + v, 166 + v, 180 + v]);
  });
};
GENS.sand = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    let v = Math.round(((n(x, y) - 0.5) * 16) / 4) * 4;
    if (r() < 0.06) v -= 12;
    t.px(x, y, [219 + v, 208 + v, 160 + v]);
  });
};
GENS.red_sand = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    let v = Math.round(((n(x, y) - 0.5) * 18) / 4) * 4;
    if (r() < 0.06) v -= 14;
    t.px(x, y, [190 + v, 103 + v * 0.7, 33 + v * 0.4]);
  });
};
GENS.gravel = (t, r) => {
  const v = makeVoronoi(r, 5);
  const pal: RGB[] = [[132, 128, 126], [110, 106, 104], [152, 148, 145], [94, 91, 90], [124, 120, 130]];
  t.each((x, y) => {
    const [id, , edge] = v(x, y);
    const c = pal[(id * 7 + 3) % pal.length];
    t.px(x, y, edge < 0.55 ? mul(c, 0.78) : c);
  });
};
GENS.snow_block = (t, r) => {
  t.each((x, y) => {
    const v = r() < 0.1 ? -8 : 0;
    t.px(x, y, [246 + v, 250 + v, 252 + v * 0.5]);
  });
};
GENS.ice = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    let v = (n(x, y) - 0.5) * 40;
    if ((x + y) % 7 === 0) v += 18;
    t.px(x, y, [150 + v * 0.6, 200 + v * 0.5, 246 + v * 0.2], 200);
  });
};
GENS.water = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => t.px(x, y, [44 + (n(x, y) - 0.5) * 30, 100 + (n(x, y) - 0.5) * 40, 226], 200));
};
GENS.lava = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = n(x, y);
    const c: RGB = v > 0.6 ? [255, 210, 70] : v > 0.45 ? [245, 140, 25] : v > 0.3 ? [215, 80, 14] : [150, 40, 10];
    t.px(x, y, c);
    t.emis(x, y, 255);
  });
};
GENS.obsidian = (t, r) => {
  t.each((x, y) => {
    const q = r();
    t.px(x, y, q < 0.08 ? [64, 32, 96] : q < 0.2 ? [30, 24, 44] : [20, 17, 30]);
  });
};
GENS.cobblestone = (t, r) => {
  const v = makeVoronoi(r, 4);
  t.each((x, y) => {
    const [id, , edge] = v(x, y);
    const b = 108 + ((id * 53) % 6) * 7;
    t.px(x, y, edge < 0.9 ? [74, 74, 74] : [b, b, b]);
  });
};
GENS.mossy_cobblestone = (t, r) => {
  GENS.cobblestone(t, r, "");
  const n = fractal(r);
  t.each((x, y) => {
    if (n(x, y) > 0.56) {
      const c = t.get(x, y);
      t.px(x, y, [c[0] * 0.55 + 20, c[1] * 0.6 + 55, c[2] * 0.4 + 10]);
    }
  });
};
GENS.stone_bricks = (t, r) => {
  const sh = [0, 0, 0, 0].map(() => (r() - 0.5) * 18);
  t.each((x, y) => {
    const bi = (y < 8 ? 0 : 2) + (x < 8 ? 0 : 1);
    const edge = x === 7 || x === 15 || y === 7 || y === 15;
    const v = 128 + sh[bi] + (r() < 0.1 ? -8 : 0);
    t.px(x, y, edge ? [88, 88, 90] : [v, v, v]);
  });
};
GENS.bricks = (t, r) => {
  t.each((x, y) => {
    const row = Math.floor(y / 4);
    const off = row % 2 === 0 ? 0 : 4;
    const mortar = y % 4 === 3 || (x + off) % 8 === 7;
    if (mortar) t.px(x, y, [176 + (r() - 0.5) * 10, 170, 162]);
    else {
      const k = ((Math.floor((x + off) / 8) * 31 + row * 17) % 5) * 5;
      t.px(x, y, [150 + k + (r() - 0.5) * 12, 70 + k * 0.4, 54 + k * 0.3]);
    }
  });
};
GENS.glass = (t) => {
  t.each((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15;
    if (edge) t.px(x, y, [200, 230, 240], 230);
    else if ((x === 3 && y >= 2 && y <= 4) || (x === 4 && y === 5) || (x === 11 && y >= 10 && y <= 12)) t.px(x, y, [255, 255, 255], 200);
    else t.px(x, y, [190, 225, 240], 26);
  });
};

// ---- 草・雪 ------------------------------------------------------------------
GENS.grass_top = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    let v = 148 + Math.round(((n(x, y) - 0.5) * 56) / 7) * 7;
    if (r() < 0.07) v -= 18;
    t.px(x, y, [v, v, v * 0.96]);
    t.tint(x, y, 255);
  });
};
function dirtBase(t: Tile, r: () => number) {
  GENS.dirt(t, r, "");
}
GENS.grass_side = (t, r) => {
  dirtBase(t, r);
  const n = fractal(r);
  for (let x = 0; x < TEX; x++) {
    const d = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 1 : 0);
    for (let y = 0; y < d; y++) {
      let v = 148 + Math.round(((n(x, y) - 0.5) * 50) / 7) * 7;
      if (y === d - 1) v -= 24;
      t.px(x, y, [v, v, v * 0.96]);
      t.tint(x, y, 255);
    }
  }
};
GENS.grass_side_snow = (t, r) => {
  dirtBase(t, r);
  for (let x = 0; x < TEX; x++) {
    const d = 4 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
    for (let y = 0; y < d; y++) t.px(x, y, y === d - 1 ? [225, 234, 240] : [246, 250, 252]);
  }
};
GENS.podzol_top = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = (n(x, y) - 0.5) * 30;
    const q = r();
    t.px(x, y, q < 0.1 ? [140, 86, 30] : q < 0.2 ? [60, 40, 22] : [100 + v, 72 + v * 0.7, 40 + v * 0.4]);
  });
};
GENS.podzol_side = (t, r) => {
  dirtBase(t, r);
  for (let x = 0; x < TEX; x++) {
    const d = 3 + (r() < 0.5 ? 1 : 0);
    for (let y = 0; y < d; y++) t.px(x, y, y === d - 1 ? [74, 50, 28] : [100 + (r() - 0.5) * 20, 72, 40]);
  }
};
GENS.moss_block = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round(((n(x, y) - 0.5) * 40) / 5) * 5;
    t.px(x, y, [88 + v * 0.7, 110 + v, 40 + v * 0.4]);
  });
};

// ---- 砂岩 --------------------------------------------------------------------
GENS.sandstone = (t, r) => {
  t.each((x, y) => {
    let v = 0;
    if (y === 0 || y === 15) v = -10;
    else if (y % 5 === 2) v = -14;
    else if (y % 5 === 3) v = 6;
    if (r() < 0.08) v -= 8;
    t.px(x, y, [218 + v, 206 + v, 160 + v]);
  });
};
GENS.sandstone_top = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round(((n(x, y) - 0.5) * 14) / 3) * 3;
    t.px(x, y, [222 + v, 211 + v, 165 + v]);
  });
};
GENS.sandstone_bottom = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = Math.round(((n(x, y) - 0.5) * 14) / 3) * 3;
    t.px(x, y, [200 + v, 188 + v, 142 + v]);
  });
};

// ---- 鉱石 --------------------------------------------------------------------
function ore(t: Tile, r: () => number, cols: RGB[], glow = 0) {
  stoneLike(t, r, [126, 126, 126], 12, 0.05, 20);
  const centers = 7 + Math.floor(r() * 3);
  for (let i = 0; i < centers; i++) {
    const cx = 1 + Math.floor(r() * 13), cy = 1 + Math.floor(r() * 13);
    const shape = [[0, 0], [1, 0], [0, 1], [1, 1]].filter(() => r() < 0.8);
    for (const [dx, dy] of shape) {
      const c = cols[Math.floor(r() * cols.length)];
      t.px(cx + dx, cy + dy, c);
      if (glow) t.emis(cx + dx, cy + dy, glow);
    }
  }
}
GENS.coal_ore = (t, r) => ore(t, r, [[30, 30, 30], [44, 44, 44], [20, 20, 20], [62, 60, 58]]);
GENS.iron_ore = (t, r) => ore(t, r, [[216, 175, 147], [200, 154, 120], [234, 200, 175]]);
GENS.copper_ore = (t, r) => ore(t, r, [[203, 110, 70], [220, 130, 86], [62, 170, 130], [180, 92, 56]]);
GENS.gold_ore = (t, r) => ore(t, r, [[252, 238, 75], [240, 210, 40], [255, 250, 150]]);
GENS.redstone_ore = (t, r) => ore(t, r, [[205, 20, 20], [255, 60, 50], [160, 10, 10]], 70);
GENS.lapis_ore = (t, r) => ore(t, r, [[35, 70, 170], [70, 110, 210], [24, 50, 130]]);
GENS.diamond_ore = (t, r) => ore(t, r, [[90, 230, 230], [190, 255, 255], [50, 190, 200]], 25);
GENS.emerald_ore = (t, r) => ore(t, r, [[30, 200, 80], [90, 235, 130], [20, 150, 60]], 25);

// ---- 木 ----------------------------------------------------------------------
function barkTex(t: Tile, r: () => number, base: RGB, dark: RGB, light: RGB) {
  const cols = Array.from({ length: TEX }, () => r());
  const n = fractal(r);
  t.each((x, y) => {
    const c = cols[x];
    let col = c < 0.25 ? dark : c > 0.8 ? light : base;
    const v = (n(x * 0.5, y * 2) - 0.5) * 26;
    t.px(x, y, [col[0] + v, col[1] + v * 0.8, col[2] + v * 0.6]);
  });
}
GENS.oak_log = (t, r) => barkTex(t, r, [112, 90, 58], [78, 60, 36], [136, 110, 70]);
GENS.spruce_log = (t, r) => barkTex(t, r, [64, 46, 28], [42, 30, 18], [82, 60, 38]);
GENS.cherry_log = (t, r) => barkTex(t, r, [150, 112, 120], [112, 76, 88], [188, 150, 158]);
GENS.birch_log = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const v = (n(x, y * 0.5) - 0.5) * 24;
    t.px(x, y, [214 + v, 212 + v, 204 + v]);
  });
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(r() * 12), y = Math.floor(r() * 15), w = 2 + Math.floor(r() * 4);
    for (let k = 0; k < w; k++) t.px(x + k, y, [34, 32, 30]);
    if (r() < 0.5) for (let k = 0; k < w - 1; k++) t.px(x + k + 1, y + 1, [60, 58, 54]);
  }
};
function logTop(t: Tile, bark: RGB, rings: RGB[]) {
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    if (d > 6.9) t.px(x, y, bark);
    else t.px(x, y, rings[Math.floor(d) % rings.length]);
  });
}
GENS.oak_log_top = (t) => logTop(t, [96, 76, 46], [[132, 100, 55], [178, 144, 86], [150, 118, 66], [178, 144, 86]]);
GENS.birch_log_top = (t) => logTop(t, [206, 204, 196], [[176, 156, 100], [200, 180, 125], [186, 166, 110], [200, 180, 125]]);
GENS.spruce_log_top = (t) => logTop(t, [60, 44, 26], [[96, 68, 38], [124, 92, 54], [108, 80, 46], [124, 92, 54]]);
GENS.cherry_log_top = (t) => logTop(t, [92, 58, 66], [[200, 140, 150], [228, 176, 184], [212, 154, 164], [228, 176, 184]]);
function planks(t: Tile, r: () => number, base: RGB, seam: RGB) {
  const sh = Array.from({ length: 4 }, () => (r() - 0.5) * 18);
  const seamX = Array.from({ length: 4 }, () => Math.floor(r() * 14) + 1);
  const n = fractal(r);
  t.each((x, y) => {
    const row = Math.floor(y / 4);
    if (y % 4 === 3) { t.px(x, y, seam); return; }
    if (x === seamX[row]) { t.px(x, y, seam); return; }
    const v = sh[row] + (n(x * 0.4, y * 3) - 0.5) * 22;
    t.px(x, y, [base[0] + v, base[1] + v * 0.85, base[2] + v * 0.65]);
  });
}
GENS.oak_planks = (t, r) => planks(t, r, [166, 132, 80], [112, 88, 50]);
GENS.birch_planks = (t, r) => planks(t, r, [194, 177, 122], [140, 126, 84]);
GENS.spruce_planks = (t, r) => planks(t, r, [116, 86, 50], [78, 56, 30]);
GENS.cherry_planks = (t, r) => planks(t, r, [228, 180, 174], [168, 118, 118]);

function leaves(t: Tile, r: () => number, lo: number, hi: number, holes: number, pal?: RGB[], tinted = true) {
  const n = fractal(r);
  t.each((x, y) => {
    const q = n(x * 1.3, y * 1.3) + (r() - 0.5) * 0.35;
    if (q < holes) { t.px(x, y, [0, 0, 0], 0); return; }
    if (pal) {
      const c = pal[Math.floor(r() * pal.length)];
      t.px(x, y, c);
    } else {
      const v = lo + (hi - lo) * Math.min(1, Math.max(0, (q - holes) * 2.2 + (r() - 0.5) * 0.3));
      t.px(x, y, [v, v, v * 0.95]);
    }
    if (tinted) t.tint(x, y, 255);
  });
}
GENS.oak_leaves = (t, r) => leaves(t, r, 80, 168, 0.36);
GENS.birch_leaves = (t, r) => leaves(t, r, 98, 180, 0.37);
GENS.spruce_leaves = (t, r) => {
  leaves(t, r, 68, 150, 0.38);
  // 針葉っぽい斜線
  t.each((x, y) => {
    if (t.alpha(x, y) && (x + y) % 4 === 0) {
      const c = t.get(x, y);
      t.px(x, y, mul(c, 0.82));
    }
  });
};
GENS.cherry_leaves = (t, r) =>
  leaves(t, r, 0, 0, 0.34, [[246, 168, 204], [238, 134, 184], [252, 196, 220], [226, 112, 164], [244, 150, 196]], false);

// ---- 光源・その他 -------------------------------------------------------------
GENS.glowstone = (t, r) => {
  const v = makeVoronoi(r, 4);
  const pal: RGB[] = [[252, 206, 96], [236, 164, 62], [255, 232, 140], [196, 124, 44]];
  t.each((x, y) => {
    const [id, , edge] = v(x, y);
    t.px(x, y, edge < 0.7 ? mul(pal[(id * 5) % 4], 0.78) : pal[(id * 3 + 1) % 4]);
    t.emis(x, y, 255);
  });
};
GENS.sea_lantern = (t, r) => {
  t.each((x, y) => {
    const edge = x % 8 === 0 || x % 8 === 7 || y % 8 === 0 || y % 8 === 7;
    const mid = x % 8 >= 2 && x % 8 <= 5 && y % 8 >= 2 && y % 8 <= 5;
    t.px(x, y, mid ? [238, 255, 250] : edge ? [150, 200, 190] : [182, 226, 214]);
    t.emis(x, y, mid ? 255 : 180);
  });
};
GENS.torch = (t) => {
  for (let y = 9; y < 16; y++) for (let x = 7; x <= 8; x++) t.px(x, y, x === 7 ? [128, 92, 46] : [98, 68, 32]);
  for (let y = 6; y <= 8; y++)
    for (let x = 7; x <= 8; x++) {
      t.px(x, y, y === 6 ? [255, 238, 120] : [255, 190, 60]);
      t.emis(x, y, 255);
    }
};
GENS.lantern = (t) => {
  const frame: RGB = [58, 54, 54];
  for (let y = 9; y <= 15; y++)
    for (let x = 5; x <= 10; x++) {
      const edge = y === 9 || y === 15 || x === 5 || x === 10;
      if (edge) t.px(x, y, frame);
      else {
        t.px(x, y, y > 11 ? [255, 214, 110] : [255, 240, 170]);
        t.emis(x, y, 255);
      }
    }
  for (let y = 7; y <= 8; y++) for (let x = 6; x <= 9; x++) t.px(x, y, frame);
  t.px(7, 6, frame); t.px(8, 6, frame);
};
GENS.cactus_top = (t, r) => {
  t.each((x, y) => {
    const edge = x === 0 || y === 0 || x === 15 || y === 15 || x === 1 || y === 1 || x === 14 || y === 14;
    t.px(x, y, edge ? [58, 100, 42] : [88, 132, 54]);
  });
};
GENS.cactus_side = (t, r) => {
  t.each((x, y) => {
    let c: RGB = [84, 125, 52];
    if (x % 4 === 1) c = [64, 104, 44];
    if (x % 4 === 3) c = [98, 142, 62];
    if ((x === 2 || x === 6 || x === 10 || x === 13) && y % 4 === 1) c = [214, 224, 170];
    t.px(x, y, c);
  });
};
GENS.pumpkin_top = (t, r) => {
  t.each((x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    t.px(x, y, d < 1.6 ? [90, 120, 40] : d % 3 < 1 ? [176, 98, 14] : [206, 124, 24]);
  });
};
GENS.pumpkin_side = (t, r) => {
  t.each((x, y) => {
    const ridge = x % 4 === 0;
    const v = ridge ? -26 : (r() - 0.5) * 8;
    t.px(x, y, [208 + v, 122 + v * 0.8, 22 + v * 0.3]);
  });
};
COLORS_INIT();
function COLORS_INIT() {
  const C: Record<string, number> = {
    white: 0xcfd5d6, light_gray: 0x7d7d73, gray: 0x373a3e, black: 0x080a0f, brown: 0x603c20, red: 0x8e2121, orange: 0xe06100,
    yellow: 0xf0af15, lime: 0x5ea818, green: 0x495b24, cyan: 0x157788, light_blue: 0x2489c7, blue: 0x2c2e8f, purple: 0x64209c,
    magenta: 0xa9309f, pink: 0xd5658e,
  };
  for (const [k, v] of Object.entries(C)) {
    GENS[`concrete_${k}`] = (t, r) => {
      const c = hex(v);
      t.each((x, y) => {
        const d = Math.round((r() - 0.5) * 6);
        t.px(x, y, [c[0] + d, c[1] + d, c[2] + d]);
      });
    };
  }
}

// ---- 植物 --------------------------------------------------------------------
const STEM: RGB = [62, 124, 42];
function blades(t: Tile, r: () => number, count: number, minH: number, maxH: number, grayscale: boolean, base = 15) {
  for (let i = 0; i < count; i++) {
    const x0 = 1 + Math.floor(r() * 14);
    const h = minH + Math.floor(r() * (maxH - minH + 1));
    const lean = r() < 0.5 ? -1 : 1;
    const bend = 3 + Math.floor(r() * 5);
    for (let k = 0; k < h; k++) {
      const y = base - k;
      const x = x0 + (k > bend ? lean * Math.floor((k - bend) / 2.2) : 0);
      const v = 104 + Math.floor((k / h) * 62) + (r() - 0.5) * 16;
      t.px(x, y, grayscale ? [v, v, v * 0.92] : [40 + v * 0.1, 100 + v * 0.4, 40])
      ;
      if (grayscale) t.tint(x, y, 255);
    }
  }
}
GENS.grass = (t, r) => blades(t, r, 11, 6, 12, true);
GENS.tall_grass_lo = (t, r) => {
  // 下半分（上半分と同じ乱数列で連続させる）
  const rr = mulberry32(777);
  blades2(t, rr, 0);
};
GENS.tall_grass_hi = (t) => {
  const rr = mulberry32(777);
  blades2(t, rr, 1);
};
function blades2(t: Tile, r: () => number, part: 0 | 1) {
  // 高さ32pxの草むらを生成し、下半分/上半分を切り出す
  const full: { x: number; y: number; v: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const x0 = 1 + Math.floor(r() * 14);
    const h = 14 + Math.floor(r() * 16);
    const lean = r() < 0.5 ? -1 : 1;
    const bend = 6 + Math.floor(r() * 8);
    for (let k = 0; k < h; k++) {
      const x = x0 + (k > bend ? lean * Math.floor((k - bend) / 3) : 0);
      full.push({ x, y: 31 - k, v: 104 + Math.floor((k / h) * 62) + (r() - 0.5) * 14 });
    }
  }
  for (const p of full) {
    const y = part === 1 ? p.y : p.y - 16;
    if (y < 0 || y > 15) continue;
    t.px(p.x, y, [p.v, p.v, p.v * 0.92]);
    t.tint(p.x, y, 255);
  }
}
GENS.fern = (t, r) => {
  for (let a = 0; a < 7; a++) {
    const ang = -1.2 + (a / 6) * 2.4;
    const len = 9 + Math.floor(r() * 3);
    for (let k = 1; k <= len; k++) {
      const x = 8 + Math.sin(ang) * k * 0.62 + (k > 6 ? Math.sin(ang) * (k - 6) * 0.2 : 0);
      const y = 15 - Math.cos(ang * 0.55) * k * 0.95;
      const v = 104 + k * 5 + (r() - 0.5) * 14;
      t.px(x, y, [v, v, v * 0.92]); t.tint(x, y, 255);
      if (k > 3 && k % 2 === 0) {
        for (const s of [-1, 1]) { t.px(x + s, y + 1, [v - 20, v - 20, (v - 20) * 0.92]); t.tint(x + s, y + 1, 255); }
      }
    }
  }
};
function flowerStem(t: Tile, x: number, top: number) {
  for (let y = top; y <= 15; y++) t.px(x, y, STEM);
  t.px(x + 1, 11, [80, 150, 56]); t.px(x - 1, 12, [80, 150, 56]);
}
GENS.dandelion = (t) => {
  flowerStem(t, 7, 7);
  t.disc(7.5, 5.5, 2.6, [255, 222, 36]);
  t.px(7, 5, [240, 176, 0]); t.px(8, 5, [240, 176, 0]);
};
GENS.poppy = (t) => {
  flowerStem(t, 7, 7);
  t.disc(7.5, 5, 3.2, [218, 34, 30]);
  t.px(7, 4, [38, 20, 20]); t.px(8, 4, [38, 20, 20]); t.px(7, 5, [38, 20, 20]);
};
GENS.blue_orchid = (t) => {
  flowerStem(t, 7, 8);
  t.disc(7.5, 6, 3, [38, 168, 238]);
  t.px(7, 5, [210, 240, 255]); t.px(8, 6, [210, 240, 255]); t.px(6, 7, [120, 200, 250]);
};
GENS.allium = (t) => {
  for (let y = 5; y <= 15; y++) t.px(7, y, STEM);
  t.disc(7.5, 3.8, 3.6, [176, 96, 206]);
  t.px(5, 2, [226, 170, 245]); t.px(9, 3, [226, 170, 245]); t.px(7, 5, [226, 170, 245]); t.px(6, 4, [140, 70, 170]);
};
GENS.azure_bluet = (t) => {
  flowerStem(t, 7, 8);
  for (const [dx, dy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, 1], [1, -1], [-1, 1]]) t.px(7.5 + dx, 6 + dy, [226, 236, 246]);
  t.px(7, 6, [250, 226, 110]); t.px(8, 6, [250, 226, 110]);
};
const tulip = (c: RGB) => (t: Tile) => {
  flowerStem(t, 7, 7);
  for (let y = 3; y <= 6; y++) for (let x = 6; x <= 9; x++) t.px(x, y, c);
  t.px(6, 3, c); t.px(7, 2, c); t.px(9, 2, c); t.px(8, 3, mul(c, 0.7)); t.px(7, 3, mul(c, 0.85));
};
GENS.red_tulip = tulip([212, 40, 42]);
GENS.orange_tulip = tulip([240, 132, 32]);
GENS.white_tulip = tulip([240, 240, 236]);
GENS.pink_tulip = tulip([242, 142, 190]);
GENS.oxeye_daisy = (t) => {
  flowerStem(t, 7, 8);
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    t.px(7.5 + Math.cos(ang) * 2.8, 5.5 + Math.sin(ang) * 2.8, [248, 248, 246]);
  }
  t.disc(7.5, 5.5, 1.3, [248, 200, 40]);
};
GENS.cornflower = (t) => {
  flowerStem(t, 7, 7);
  t.disc(7.5, 5, 2.8, [76, 104, 232]);
  t.px(7, 4, [150, 170, 250]); t.px(8, 5, [40, 60, 180]);
};
GENS.lily_of_the_valley = (t) => {
  for (let y = 4; y <= 15; y++) t.px(7 + (y < 7 ? -Math.floor((7 - y) / 2) : 0), y, STEM);
  for (const [x, y] of [[4, 6], [5, 8], [6, 10], [3, 5]]) { t.px(x, y, [244, 248, 244]); t.px(x, y + 1, [210, 230, 210]); }
  for (let i = 0; i < 5; i++) { t.px(9 + i / 2, 11 + i, [64, 132, 48]); t.px(5 - i / 2, 12 + i / 1.5, [64, 132, 48]); }
};
GENS.dead_bush = (t, r) => {
  const c: RGB = [112, 80, 40];
  const branch = (x: number, y: number, dx: number, len: number) => {
    for (let k = 0; k < len; k++) t.px(x + dx * Math.floor(k * 0.6), y - k, mul(c, 0.9 + r() * 0.2));
  };
  for (let y = 15; y >= 8; y--) t.px(7 + (y < 11 ? 0 : 0), y, c);
  branch(7, 10, -1, 6); branch(7, 12, 1, 6); branch(7, 8, 1, 5); branch(7, 9, -1, 5);
};
GENS.sugar_cane = (t, r) => {
  for (const x0 of [2, 7, 12]) {
    for (let y = 0; y < 16; y++) {
      const v = (y % 5 === 4) ? 104 : 150 + Math.floor(r() * 22);
      t.px(x0, y, [v, v, v * 0.9]); t.px(x0 + 1, y, [v - 22, v - 22, (v - 22) * 0.9]);
      t.tint(x0, y, 255); t.tint(x0 + 1, y, 255);
    }
    if (r() < 0.8) { t.px(x0 - 1, 1, [190, 190, 175]); t.px(x0 + 2, 2, [190, 190, 175]); t.tint(x0 - 1, 1); t.tint(x0 + 2, 2); }
  }
};
GENS.brown_mushroom = (t) => {
  for (let y = 10; y <= 15; y++) { t.px(7, y, [214, 204, 184]); t.px(8, y, [190, 180, 160]); }
  for (let x = 4; x <= 11; x++) t.px(x, 9, [150, 112, 74]);
  for (let x = 5; x <= 10; x++) t.px(x, 8, [170, 128, 88]);
  for (let x = 6; x <= 9; x++) t.px(x, 7, [160, 120, 80]);
};
GENS.red_mushroom = (t) => {
  for (let y = 10; y <= 15; y++) { t.px(7, y, [236, 230, 214]); t.px(8, y, [210, 204, 190]); }
  for (let x = 3; x <= 12; x++) t.px(x, 9, [206, 40, 38]);
  for (let x = 4; x <= 11; x++) t.px(x, 8, [220, 52, 46]);
  for (let x = 5; x <= 10; x++) t.px(x, 7, [212, 44, 40]);
  for (let x = 6; x <= 9; x++) t.px(x, 6, [200, 40, 38]);
  for (const [x, y] of [[5, 8], [8, 7], [10, 9], [7, 6]]) t.px(x, y, [248, 244, 236]);
};
GENS.seagrass = (t, r) => {
  for (const x0 of [3, 7, 11]) {
    const h = 9 + Math.floor(r() * 7);
    for (let k = 0; k < h; k++) {
      const x = x0 + Math.round(Math.sin(k * 0.5 + x0) * 1.2);
      t.px(x, 15 - k, [48 + k * 3, 150 + k * 3, 70 + k * 2]); t.px(x + 1, 15 - k, [40 + k * 3, 130 + k * 3, 60 + k * 2]);
    }
  }
};
GENS.kelp = (t, r) => {
  for (let y = 0; y < 16; y++) {
    const x = 6 + Math.round(Math.sin(y * 0.55) * 1.4);
    t.px(x, y, [64, 150, 52]); t.px(x + 1, y, [52, 128, 44]);
    if (y % 4 === 1) { t.px(x - 1, y, [86, 170, 66]); t.px(x - 2, y + 1, [86, 170, 66]); }
    if (y % 4 === 3) { t.px(x + 2, y, [86, 170, 66]); t.px(x + 3, y + 1, [74, 150, 58]); }
  }
};
GENS.lily_pad = (t, r) => {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = x + 0.5 - 8, dy = y + 0.5 - 8;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 7.4) continue;
      if (dx > 0 && Math.abs(dy) < dx * 0.22) continue; // 切れ込み
      const v = (r() - 0.5) * 24;
      t.px(x, y, d < 6 ? [44 + v * 0.5, 126 + v, 50 + v * 0.4] : [30 + v * 0.4, 96 + v, 40]);
    }
};
GENS.pink_petals = (t, r) => {
  for (let i = 0; i < 9; i++) {
    const x = 1 + Math.floor(r() * 13), y = 1 + Math.floor(r() * 13);
    const c: RGB = [[246, 170, 208], [240, 140, 190], [252, 200, 224]][Math.floor(r() * 3)] as RGB;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) t.px(x + dx, y + dy, c);
    t.px(x + 1, y + 1, [250, 224, 120]);
  }
};

// ---- 和の素材 ------------------------------------------------------------------
GENS.lacquer_red = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const g = (n(x * 0.3, y * 2.4) - 0.5) * 26;
    const edge = x === 0 || x === 15 ? -14 : 0;
    t.px(x, y, [158 + g + edge, 50 + g * 0.5 + edge * 0.4, 34 + g * 0.3]);
  });
};
GENS.lacquer_black = (t, r) => {
  const n = fractal(r);
  t.each((x, y) => {
    const g = (n(x * 0.3, y * 2.4) - 0.5) * 10;
    const sheen = y < 2 || x === 0 ? 10 : 0;
    t.px(x, y, [30 + g + sheen, 28 + g + sheen, 34 + g + sheen]);
  });
};
GENS.paper_lantern = (t, r) => {
  t.each((x, y) => {
    const rib = y % 5 === 0 ? 1 : 0;
    const edge = x === 0 || x === 15 || y === 0 || y === 15;
    const c: RGB = edge ? [120, 70, 34] : rib ? [226, 150, 70] : [255, 214, 140];
    t.px(x, y, c);
    t.emis(x, y, edge ? 40 : 255);
  });
};
GENS.bamboo = (t, r) => {
  t.each((x, y) => {
    const joint = y % 8 === 0 || y % 8 === 1;
    let c: RGB = [98, 166, 66];
    if (x < 3 || x > 12) c = [76, 130, 52];
    if (x >= 6 && x <= 9) c = [112, 182, 76];
    if (joint) c = [58, 108, 40];
    t.px(x, y, mul(c, 0.94 + r() * 0.12));
  });
};
GENS.bamboo_leaves = (t, r) => {
  const leaf = (x0: number, y0: number, dx: number, dy: number, len: number) => {
    for (let k = 0; k < len; k++) {
      const x = x0 + dx * k, y = y0 + dy * k + (k > len * 0.55 ? Math.floor((k - len * 0.55) * 0.7) : 0);
      const v = 110 + k * 5 + (r() - 0.5) * 18;
      t.px(x, y, [v, v, v * 0.95]); t.tint(x, y, 255);
      if (k > 1 && k < len - 1) { t.px(x, y + 1, [v - 22, v - 22, (v - 22) * 0.95]); t.tint(x, y + 1, 255); }
    }
  };
  for (let i = 0; i < 7; i++) leaf(8, 7 + Math.floor(r() * 4), r() < 0.5 ? -1 : 1, -0.5 + r() * 0.5, 5 + Math.floor(r() * 4));
  for (let i = 0; i < 5; i++) leaf(8, 3 + Math.floor(r() * 4), r() < 0.5 ? -1 : 1, -0.2 + r() * 0.5, 4 + Math.floor(r() * 3));
  t.vline(8, 4, 15, [96, 150, 70]);
};

// ---- 生成エントリ ---------------------------------------------------------------
export interface TextureSet {
  count: number;
  albedo: Uint8Array;
  mask: Uint8Array;
  tiles: HTMLCanvasElement[];
  masks: Uint8ClampedArray[];
}

export function generateTextures(): TextureSet {
  const count = TEXTURE_NAMES.length;
  const albedo = new Uint8Array(count * TEX * TEX * 4);
  const mask = new Uint8Array(count * TEX * TEX * 4);
  const tiles: HTMLCanvasElement[] = [];
  const masks: Uint8ClampedArray[] = [];
  TEXTURE_NAMES.forEach((name, i) => {
    const t = new Tile();
    const gen = GENS[name];
    if (gen) gen(t, mulberry32(strHash(name)), name);
    else {
      console.warn("texture generator missing:", name);
      t.each((x, y) => t.px(x, y, ((x >> 2) + (y >> 2)) % 2 ? [255, 0, 255] : [20, 20, 20]));
    }
    // 透明部分の色を不透明部分の平均にしてミップマップの黒ずみを防ぐ
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let p = 0; p < TEX * TEX; p++) if (t.c[p * 4 + 3] > 0) { sr += t.c[p * 4]; sg += t.c[p * 4 + 1]; sb += t.c[p * 4 + 2]; n++; }
    if (n > 0 && n < TEX * TEX) {
      for (let p = 0; p < TEX * TEX; p++) if (t.c[p * 4 + 3] === 0) { t.c[p * 4] = sr / n; t.c[p * 4 + 1] = sg / n; t.c[p * 4 + 2] = sb / n; }
    }
    albedo.set(t.c, i * TEX * TEX * 4);
    mask.set(t.m, i * TEX * TEX * 4);
    masks.push(t.m);
    const cv = document.createElement("canvas");
    cv.width = cv.height = TEX;
    const ctx = cv.getContext("2d")!;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(t.c), TEX, TEX), 0, 0);
    tiles.push(cv);
  });
  return { count, albedo, mask, tiles, masks };
}
