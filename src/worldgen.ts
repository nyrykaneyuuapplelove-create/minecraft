// 地形・バイオーム・洞窟・植生の生成。すべてシードから決定的に計算され、
// チャンク境界をまたぐ木などもチャンクごとに同じ結果になる。

import { CHUNK, WORLD_H, SEA_LEVEL, cidx, CHUNK_BLOCKS, CLIMATE_STRIDE, climateIdx } from "./config";
import { B, SHAPE, Shape, REPLACEABLE, OPACITY } from "./blocks";
import { Biome, isColdBiome } from "./biomes";
import { Simplex, fbm2, hash2, hash3, mulberry32, clamp, lerp, smoothstep } from "./noise";

export interface Column {
  height: number;
  biome: number;
  temp: number; // -1..1
  humid: number; // -1..1
  carve: number; // 川の侵食度 0..1
  mount: number; // 山岳度 0..1
  spec: number;
}

export interface GenResult {
  blocks: Uint8Array;
  climate: Uint8Array;
  top: Uint8Array;
}

const PAD = 10;
const PW = CHUNK + PAD * 2;

class Placer {
  constructor(public blocks: Uint8Array, public ox: number, public oz: number) {}
  /** mode 0: 空気/草花のみ置換  1: さらに葉を置換  2: 強制（岩盤以外） */
  set(wx: number, wy: number, wz: number, id: number, mode: 0 | 1 | 2 = 0) {
    const x = wx - this.ox, z = wz - this.oz;
    if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || wy < 1 || wy >= WORLD_H) return;
    const i = cidx(x, wy, z);
    const e = this.blocks[i];
    if (e === B.AIR || (REPLACEABLE[e] === 1 && e !== B.WATER && e !== B.LAVA) || SHAPE[e] === Shape.CROSS) {
      this.blocks[i] = id;
    } else if (mode >= 1 && (e === B.OAK_LEAVES || e === B.BIRCH_LEAVES || e === B.SPRUCE_LEAVES || e === B.CHERRY_LEAVES || e === B.MAPLE_LEAVES)) {
      this.blocks[i] = id;
    } else if (mode === 2 && e !== B.BEDROCK && e !== B.WATER) {
      this.blocks[i] = id;
    }
  }
  get(wx: number, wy: number, wz: number) {
    const x = wx - this.ox, z = wz - this.oz;
    if (x < 0 || x >= CHUNK || z < 0 || z >= CHUNK || wy < 0 || wy >= WORLD_H) return 255;
    return this.blocks[cidx(x, wy, z)];
  }
}

function blob(p: Placer, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number, rng: () => number, jag = 0.35) {
  const x0 = Math.floor(cx - rx - 1), x1 = Math.ceil(cx + rx + 1);
  const y0 = Math.floor(cy - ry - 1), y1 = Math.ceil(cy + ry + 1);
  const z0 = Math.floor(cz - rz - 1), z1 = Math.ceil(cz + rz + 1);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const nx = (x - cx) / rx, ny = (y - cy) / ry, nz = (z - cz) / rz;
        const d = nx * nx + ny * ny + nz * nz;
        const r = rng();
        if (d + (r - 0.5) * jag < 1) p.set(x, y, z, id, 0);
      }
}

function line(p: Placer, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
  for (let i = 0; i <= n; i++) {
    const t = n === 0 ? 0 : i / n;
    p.set(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t)), Math.round(lerp(z0, z1, t)), id, 1);
  }
}

// ---- 樹木 ------------------------------------------------------------------
function treeOak(p: Placer, x: number, gy: number, z: number, rng: () => number, leaf: number, log: number, big: boolean, wide = 1) {
  const h = 4 + Math.floor(rng() * 3) + (big ? 3 : 0);
  const top = gy + h;
  const rr = (2.5 + rng() * 0.8 + (big ? 1.3 : 0)) * wide;
  blob(p, x, top - 0.5, z, rr, rr * 0.82, rr, leaf, rng);
  const subs = big ? 4 : 2;
  for (let i = 0; i < subs; i++) {
    const a = rng() * Math.PI * 2;
    const d = rr * (0.7 + rng() * 0.4);
    blob(p, x + Math.cos(a) * d, top - 1.2 - rng() * 1.5, z + Math.sin(a) * d, rr * 0.62, rr * 0.5, rr * 0.62, leaf, rng);
  }
  for (let y = gy + 1; y <= top; y++) p.set(x, y, z, log, 1);
  if (big) {
    for (let i = 0; i < 2; i++) {
      const a = rng() * Math.PI * 2;
      const by = gy + Math.floor(h * 0.55);
      line(p, x, by, z, x + Math.round(Math.cos(a) * 2), by + 2, z + Math.round(Math.sin(a) * 2), log);
    }
  }
}

function treeBirch(p: Placer, x: number, gy: number, z: number, rng: () => number) {
  const h = 5 + Math.floor(rng() * 4);
  const top = gy + h;
  blob(p, x, top - 0.5, z, 2.2, 2.7, 2.2, B.BIRCH_LEAVES, rng, 0.5);
  blob(p, x, top + 1.8, z, 1.2, 1.2, 1.2, B.BIRCH_LEAVES, rng, 0.3);
  for (let y = gy + 1; y <= top + 1; y++) p.set(x, y, z, B.BIRCH_LOG, 1);
}

const SPRUCE_R = [0, 1, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 4];
function treeSpruce(p: Placer, x: number, gy: number, z: number, rng: () => number, snowy: boolean) {
  const h = 7 + Math.floor(rng() * 6);
  const top = gy + h;
  const maxR = h > 10 ? 4 : 3;
  for (let ly = top + 1; ly >= gy + 3; ly--) {
    const k = top + 1 - ly;
    const r = Math.min(maxR, SPRUCE_R[Math.min(k, SPRUCE_R.length - 1)]);
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        const d = dx * dx + dz * dz;
        const rr = rng();
        if (d > r * r + r * 0.6) continue;
        if (d > r * r * 0.6 && rr < 0.28) continue;
        p.set(x + dx, ly, z + dz, B.SPRUCE_LEAVES, 0);
      }
  }
  for (let y = gy + 1; y <= top; y++) p.set(x, y, z, B.SPRUCE_LOG, 1);
}

function treeCherry(p: Placer, x: number, gy: number, z: number, rng: () => number) {
  const h = 4 + Math.floor(rng() * 3);
  const bx = Math.floor(rng() * 3) - 1, bz = Math.floor(rng() * 3) - 1;
  const bendY = gy + Math.floor(h * 0.55);
  let tx = x, tz = z;
  const topY = gy + h;
  const cxl = x + bx, czl = z + bz;
  blob(p, cxl, topY + 0.2, czl, 4.4, 2.5, 4.4, B.CHERRY_LEAVES, rng, 0.55);
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    blob(p, cxl + Math.cos(a) * 3.2, topY - 0.8, czl + Math.sin(a) * 3.2, 2.4, 1.6, 2.4, B.CHERRY_LEAVES, rng, 0.5);
  }
  // 垂れ下がる花
  for (let dx = -5; dx <= 5; dx++)
    for (let dz = -5; dz <= 5; dz++) {
      const r = rng();
      const len = 1 + Math.floor(rng() * 2);
      if (dx * dx + dz * dz > 14 && dx * dx + dz * dz < 24 && r < 0.3) {
        for (let k = 0; k < len; k++) p.set(cxl + dx, topY - 1 - k, czl + dz, B.CHERRY_LEAVES, 0);
      }
    }
  for (let y = gy + 1; y <= topY; y++) {
    if (y === bendY) {
      tx = x + bx;
      tz = z + bz;
    }
    p.set(tx, y, tz, B.CHERRY_LOG, 1);
  }
  // 横枝
  const a = rng() * Math.PI * 2;
  line(p, tx, topY - 1, tz, tx + Math.round(Math.cos(a) * 3), topY + 1, tz + Math.round(Math.sin(a) * 3), B.CHERRY_LOG);
}

function treeAcacia(p: Placer, x: number, gy: number, z: number, rng: () => number) {
  const h = 5 + Math.floor(rng() * 2);
  const dir = Math.floor(rng() * 4);
  const dx = [1, -1, 0, 0][dir], dz = [0, 0, 1, -1][dir];
  let tx = x, tz = z;
  const half = Math.floor(h / 2);
  for (let y = gy + 1; y <= gy + h; y++) {
    p.set(tx, y, tz, B.OAK_LOG, 1);
    if (y > gy + half) {
      tx += dx;
      tz += dz;
      p.set(tx, y, tz, B.OAK_LOG, 1);
    }
  }
  blob(p, tx, gy + h + 0.5, tz, 3.6, 1.1, 3.6, B.OAK_LEAVES, rng, 0.4);
  blob(p, x - dx * 2, gy + half + 2, z - dz * 2, 2.2, 0.9, 2.2, B.OAK_LEAVES, rng, 0.4);
}

function treeAncient(p: Placer, x: number, gy: number, z: number, rng: () => number) {
  const H = 24 + Math.floor(rng() * 8);
  const top = gy + H;
  // 幹：下ほど太い
  for (let y = gy - 1; y <= top; y++) {
    const k = y - gy;
    const r = k < 5 ? 2.3 : k < 12 ? 1.8 : k < H - 6 ? 1.3 : 0.6;
    const ri = Math.ceil(r);
    for (let dx = -ri; dx <= ri; dx++)
      for (let dz = -ri; dz <= ri; dz++) if (dx * dx + dz * dz <= r * r + 0.4) p.set(x + dx, y, z + dz, B.OAK_LOG, 2);
  }
  // 根
  const roots = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rng() * 0.5;
    const len = 4 + Math.floor(rng() * 4);
    for (let k = 2; k <= len; k++) {
      const wy = gy + (k < len * 0.6 ? 1 : 0) - (k > len - 2 ? 1 : 0);
      p.set(x + Math.round(Math.cos(a) * k), wy, z + Math.round(Math.sin(a) * k), B.OAK_LOG, 2);
      p.set(x + Math.round(Math.cos(a) * k), wy - 1, z + Math.round(Math.sin(a) * k), B.OAK_LOG, 2);
    }
  }
  // 枝と葉
  const branches = 6 + Math.floor(rng() * 4);
  for (let i = 0; i < branches; i++) {
    const a = rng() * Math.PI * 2;
    const by = gy + Math.floor(H * (0.5 + rng() * 0.38));
    const len = 5 + Math.floor(rng() * 5);
    const ex = x + Math.round(Math.cos(a) * len), ez = z + Math.round(Math.sin(a) * len);
    const ey = by + 2 + Math.floor(rng() * 3);
    line(p, x, by, z, ex, ey, ez, B.OAK_LOG);
    const r = 4 + rng() * 2.2;
    blob(p, ex, ey + 1, ez, r, r * 0.72, r, B.OAK_LEAVES, rng, 0.5);
  }
  const R = 6.5 + rng() * 2;
  blob(p, x, top + 1, z, R, R * 0.7, R, B.OAK_LEAVES, rng, 0.5);
  // 垂れ下がる葉
  for (let dx = -10; dx <= 10; dx++)
    for (let dz = -10; dz <= 10; dz++) {
      const r = rng();
      if (r < 0.04) {
        const len = 2 + Math.floor(rng() * 4);
        for (let k = 0; k < len; k++) p.set(x + dx, top - 2 - k, z + dz, B.OAK_LEAVES, 0);
      }
    }
}


// ---- 構造物：鳥居・石灯籠・環状列石 ------------------------------------------------
type HeightFn = (x: number, z: number) => number;

function toriiGate(p: Placer, ox: number, gy: number, oz: number, rot: number, h: HeightFn) {
  const W = (u: number, v: number): [number, number] => (rot % 2 === 0 ? [ox + u, oz + v] : [ox + v, oz + u]);
  const sign = rot >= 2 ? -1 : 1;
  const put = (u: number, v: number, y: number, id: number) => {
    const [x, z] = W(u, v * sign);
    p.set(x, y, z, id, 2);
  };
  // 柱と台石
  for (const u of [-2, 2]) {
    put(u, 0, gy, B.STONE_BRICKS);
    for (let y = 1; y <= 6; y++) put(u, 0, gy + y, B.LACQUER_RED);
  }
  // 貫（ぬき）と笠木（かさぎ）
  for (let u = -3; u <= 3; u++) put(u, 0, gy + 4, B.LACQUER_RED);
  for (let u = -4; u <= 4; u++) put(u, 0, gy + 7, B.LACQUER_BLACK);
  for (let u = -5; u <= 5; u++) put(u, 0, gy + 8, B.LACQUER_BLACK);
  put(-5, 0, gy + 9, B.LACQUER_BLACK);
  put(5, 0, gy + 9, B.LACQUER_BLACK);
  put(0, 0, gy + 5, B.LACQUER_BLACK);
  // 参道：石畳
  for (let v = -2; v <= 16; v++) {
    for (let u = -1; u <= 1; u++) {
      const [x, z] = W(u, v * sign);
      const hy = h(x, z);
      p.set(x, hy, z, (u + v) % 2 === 0 ? B.STONE_BRICKS : B.COBBLESTONE, 2);
      for (let k = 1; k <= 3; k++) p.set(x, hy + k, z, B.AIR, 2);
    }
  }
  // 石灯籠
  for (const v of [4, 8, 12]) {
    for (const u of [-3, 3]) {
      const [x, z] = W(u, v * sign);
      const hy = h(x, z);
      p.set(x, hy, z, B.STONE_BRICKS, 2);
      p.set(x, hy + 1, z, B.STONE_BRICKS, 2);
      p.set(x, hy + 2, z, B.LANTERN, 2);
      p.set(x, hy + 3, z, B.STONE_BRICKS, 2);
    }
  }
}

function stoneCircle(p: Placer, cx: number, gy: number, cz: number, rng: () => number, h: HeightFn) {
  const n = 8;
  const phase = rng() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2;
    const x = cx + Math.round(Math.cos(a) * 5.5), z = cz + Math.round(Math.sin(a) * 5.5);
    const hy = h(x, z);
    const H = 3 + Math.floor(rng() * 4);
    const broken = rng() < 0.3;
    for (let k = 0; k <= (broken ? H - 2 : H); k++) {
      const m = rng();
      p.set(x, hy + k, z, k < 2 ? B.MOSSY_COBBLESTONE : m < 0.45 ? B.STONE_BRICKS : m < 0.75 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE, 2);
    }
    if (!broken) {
      p.set(x, hy + H + 1, z, B.LANTERN, 2);
    }
    // 倒れた石
    if (rng() < 0.4) p.set(x + (rng() < 0.5 ? 1 : -1), hy + 1, z, B.MOSSY_COBBLESTONE, 2);
  }
  // 中央の祭壇
  for (let dx = -1; dx <= 1; dx++)
    for (let dz = -1; dz <= 1; dz++) {
      const hy = h(cx + dx, cz + dz);
      p.set(cx + dx, hy, cz + dz, dx === 0 && dz === 0 ? B.STONE_BRICKS : B.MOSSY_COBBLESTONE, 2);
    }
  const hc = h(cx, cz);
  p.set(cx, hc + 1, cz, B.STONE_BRICKS, 2);
  p.set(cx, hc + 2, cz, B.GLOWSTONE, 2);
}

// ---- 生成器 -----------------------------------------------------------------
export class WorldGen {
  readonly seed: number;
  private nWarp: Simplex; private nCont: Simplex; private nEros: Simplex; private nRidge: Simplex;
  private nDet: Simplex; private nHill: Simplex; private nRiver: Simplex; private nTemp: Simplex;
  private nHumid: Simplex; private nSpec: Simplex; private nCave1: Simplex; private nCave2: Simplex;
  private nCave3: Simplex; private nBlob: Simplex; private nBlob2: Simplex; private nStrata: Simplex;
  private nFlower: Simplex; private nSurf: Simplex; private nEntr: Simplex;

  constructor(seed: number) {
    this.seed = seed | 0;
    const s = (k: number) => new Simplex(Math.imul(this.seed ^ Math.imul(k, 0x9e3779b1), 0x85ebca6b) ^ (k * 7919));
    this.nWarp = s(1); this.nCont = s(2); this.nEros = s(3); this.nRidge = s(4); this.nDet = s(5); this.nHill = s(6);
    this.nRiver = s(7); this.nTemp = s(8); this.nHumid = s(9); this.nSpec = s(10); this.nCave1 = s(11);
    this.nCave2 = s(12); this.nCave3 = s(13); this.nBlob = s(14); this.nBlob2 = s(15); this.nStrata = s(16);
    this.nFlower = s(17); this.nSurf = s(18); this.nEntr = s(19);
  }

  columnInfo(x: number, z: number): Column {
    const wx = x + this.nWarp.noise2(x / 190, z / 190) * 50;
    const wz = z + this.nWarp.noise2(x / 190 + 41.3, z / 190 - 77.9) * 50;
    const c = clamp(fbm2(this.nCont, wx / 2300, wz / 2300, 4) * 1.8 + 0.16, -1, 1);
    const e = fbm2(this.nEros, wx / 1100, wz / 1100, 3) * 1.7;
    const rid = clamp(1 - Math.abs(fbm2(this.nRidge, wx / 360, wz / 360, 5)) * 2.3, 0, 1);
    const detail = fbm2(this.nDet, x / 64, z / 64, 4);
    const big = fbm2(this.nHill, wx / 280, wz / 280, 3);
    let t = clamp(fbm2(this.nTemp, wx / 2000, wz / 2000, 3) * 1.7, -1, 1);
    const hm = clamp(fbm2(this.nHumid, wx / 1500 + 500, wz / 1500 - 300, 3) * 1.9, -1, 1);
    const spec = fbm2(this.nSpec, wx / 520, wz / 520, 2) * 1.9;

    let base: number;
    if (c < -0.12) {
      const d = clamp((-0.12 - c) / 0.7, 0, 1);
      base = SEA_LEVEL - 3 - 36 * Math.pow(d, 0.8);
    } else {
      const l = c + 0.12;
      base = SEA_LEVEL - 3 + smoothstep(0, 0.12, l) * 4.5 + l * 20;
    }
    const hillAmp = lerp(2.5, 17, smoothstep(0.35, -0.5, e));
    const inland = smoothstep(-0.18, 0.0, c);
    const mid = fbm2(this.nDet, x / 21 + 300, z / 21 - 170, 3);
    let height = base + (detail * 0.45 + big * 1.1) * hillAmp * (0.35 + 0.65 * inland) + mid * (1.2 + 2.6 * smoothstep(-0.1, 0.3, c));

    const m = smoothstep(0.28, 0.72, c) * smoothstep(0.12, -0.45, e);
    height += m * (8 + 88 * Math.pow(rid, 1.7)) + m * detail * 10;

    // 湿地：海抜付近の低地を平らに
    const swamp = smoothstep(0.38, 0.6, hm) * (1 - smoothstep(0.25, 0.45, Math.abs(t))) * smoothstep(-0.05, 0.1, c) * (1 - smoothstep(0.1, 0.3, c)) * (1 - m);
    if (swamp > 0) height = lerp(height, SEA_LEVEL - 0.2 + detail * 2.4, swamp);

    // 川
    const rv = Math.abs(this.nRiver.noise2(wx / 720, wz / 720));
    const carve = (c > -0.1 ? 1 : smoothstep(-0.2, -0.1, c)) * (1 - smoothstep(0.012, 0.042, rv)) * (1 - smoothstep(0.4, 0.85, m));
    if (carve > 0) height = lerp(height, SEA_LEVEL - 4.5, carve);

    if (height > 128) height = 128 + (height - 128) * 0.55;
    height = clamp(height, 4, WORLD_H - 8);
    const h = Math.floor(height);

    t = clamp(t - Math.max(0, h - 92) * 0.016, -1, 1);

    let biome: number;
    if (swamp > 0.5 && h >= SEA_LEVEL - 5 && h <= SEA_LEVEL + 4) {
      biome = Biome.SWAMP;
    } else if (h <= SEA_LEVEL - 1) {
      if (carve > 0.4 && c > -0.1) biome = t < -0.5 ? Biome.FROZEN_RIVER : Biome.RIVER;
      else if (t < -0.7) biome = Biome.FROZEN_OCEAN;
      else if (t > 0.62) biome = Biome.WARM_OCEAN;
      else biome = h < SEA_LEVEL - 20 ? Biome.DEEP_OCEAN : Biome.OCEAN;
    } else if (h <= SEA_LEVEL + 2 && c < 0.1 && swamp < 0.4) {
      biome = Biome.BEACH;
    } else if (m > 0.4 && h > 92) {
      biome = h > 118 || t < -0.3 ? Biome.SNOWY_PEAKS : Biome.MOUNTAINS;
    } else if (t < -0.58) {
      biome = hm > 0.05 ? Biome.SNOWY_TAIGA : Biome.SNOWY_PLAINS;
    } else if (t < -0.32) {
      biome = hm > -0.35 ? Biome.TAIGA : Biome.PLAINS;
    } else if (t > 0.5) {
      biome = hm < -0.05 ? Biome.DESERT : hm < 0.35 ? Biome.SAVANNA : Biome.BAMBOO_GROVE;
    } else if (swamp > 0.5 && h <= SEA_LEVEL + 4) {
      biome = Biome.SWAMP;
    } else if (spec > 0.3 && h > 60 && hm > -0.3) {
      biome = Biome.CHERRY_GROVE;
    } else if (spec < -0.38 && hm > -0.1) {
      biome = Biome.AUTUMN_FOREST;
    } else if (hm > 0.4) {
      biome = t > 0.0 && spec > -0.15 ? Biome.BAMBOO_GROVE : Biome.FOREST;
    } else if (hm > 0.1) {
      biome = spec > -0.05 ? Biome.BIRCH_FOREST : Biome.FOREST;
    } else if (hm > -0.2) {
      biome = spec > 0.12 && h > 64 ? Biome.MEADOW : Biome.PLAINS;
    } else {
      biome = Biome.PLAINS;
    }
    return { height: h, biome, temp: t, humid: hm, carve, mount: m, spec };
  }

  /** チャンク周辺の構造物の位置（決定的） */
  private structureSites(ox: number, oz: number, hfn: HeightFn): { kind: number; x: number; z: number; gy: number }[] {
    const seed = this.seed;
    const out: { kind: number; x: number; z: number; gy: number }[] = [];
    const SC = 96;
    const R = 34;
    const sx0 = Math.floor((ox - R) / SC), sx1 = Math.floor((ox + CHUNK + R) / SC);
    const sz0 = Math.floor((oz - R) / SC), sz1 = Math.floor((oz + CHUNK + R) / SC);
    for (let sx = sx0; sx <= sx1; sx++)
      for (let sz = sz0; sz <= sz1; sz++) {
        const r0 = hash2(sx, sz, seed + 61);
        const ax = sx * SC + 16 + Math.floor(hash2(sx, sz, seed + 62) * (SC - 32));
        const az = sz * SC + 16 + Math.floor(hash2(sx, sz, seed + 63) * (SC - 32));
        if (ax < ox - R || ax > ox + CHUNK + R || az < oz - R || az > oz + CHUNK + R) continue;
        const col = this.columnInfo(ax, az);
        let pT = 0, pC = 0;
        switch (col.biome) {
          case Biome.CHERRY_GROVE: pT = 0.6; break;
          case Biome.MEADOW: pT = 0.3; pC = 0.2; break;
          case Biome.PLAINS: pT = 0.1; pC = 0.18; break;
          case Biome.FOREST: pT = 0.1; pC = 0.1; break;
          case Biome.BIRCH_FOREST: pT = 0.12; pC = 0.1; break;
          case Biome.BAMBOO_GROVE: pT = 0.4; break;
          case Biome.AUTUMN_FOREST: pT = 0.3; pC = 0.1; break;
          case Biome.TAIGA: pC = 0.12; break;
          case Biome.SNOWY_PLAINS: pC = 0.12; break;
          default: continue;
        }
        const gy = col.height;
        if (gy < SEA_LEVEL + 2 || gy > 100) continue;
        let lo = gy, hi = gy;
        for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4]]) {
          const hh = hfn(ax + dx, az + dz);
          lo = Math.min(lo, hh);
          hi = Math.max(hi, hh);
        }
        if (hi - lo > 3) continue;
        if (r0 < pT) out.push({ kind: 0, x: ax, z: az, gy });
        else if (r0 < pT + pC) out.push({ kind: 1, x: ax, z: az, gy });
      }
    return out;
  }

  // ---- チャンク生成 --------------------------------------------------------
  generate(cx: number, cz: number): GenResult {
    const blocks = new Uint8Array(CHUNK_BLOCKS);
    const climate = new Uint8Array(CHUNK * CHUNK * CLIMATE_STRIDE);
    const top = new Uint8Array(CHUNK * CHUNK);
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const seed = this.seed;

    const infos: Column[] = new Array(PW * PW);
    for (let i = 0; i < PW; i++) for (let j = 0; j < PW; j++) infos[i * PW + j] = this.columnInfo(ox + i - PAD, oz + j - PAD);
    const info = (x: number, z: number) => infos[(x + PAD) * PW + (z + PAD)];

    // 岩種の塊（2x2x2解像度）
    const GY = WORLD_H >> 1;
    const blobA = new Float32Array(8 * 8 * GY);
    const blobB = new Float32Array(8 * 8 * GY);
    for (let gx = 0; gx < 8; gx++)
      for (let gz = 0; gz < 8; gz++)
        for (let gy = 2; gy < 60; gy++) {
          const i = (gx * 8 + gz) * GY + gy;
          blobA[i] = this.nBlob.noise3((ox + gx * 2) * 0.045, gy * 0.13, (oz + gz * 2) * 0.045);
          blobB[i] = this.nBlob2.noise3((ox + gx * 2) * 0.05 + 100, gy * 0.12, (oz + gz * 2) * 0.05 - 50);
        }

    for (let x = 0; x < CHUNK; x++) {
      for (let z = 0; z < CHUNK; z++) {
        const wx = ox + x, wz = oz + z;
        const col = info(x, z);
        const h = col.height;
        const biome = col.biome;

        // 気候データ
        const ci = climateIdx(x, z);
        climate[ci] = biome;
        climate[ci + 1] = clamp(Math.round((col.temp + 1) * 127.5), 0, 255);
        climate[ci + 2] = clamp(Math.round((col.humid + 1) * 127.5), 0, 255);

        // 傾斜
        const hN = Math.max(Math.abs(info(x + 1, z).height - h), Math.abs(info(x - 1, z).height - h), Math.abs(info(x, z + 1).height - h), Math.abs(info(x, z - 1).height - h));

        let topB: number = B.GRASS_BLOCK, fillB: number = B.DIRT, fillDepth = 3 + (hash2(wx, wz, seed + 3) < 0.5 ? 1 : 0);
        let subB: number = B.STONE, subDepth = 0;
        const sn = this.nSurf.noise2(wx / 28, wz / 28);
        switch (biome) {
          case Biome.DESERT:
            topB = fillB = B.SAND; fillDepth = 4; subB = B.SANDSTONE; subDepth = 5;
            if (sn > 0.55) { topB = fillB = B.RED_SAND; }
            break;
          case Biome.BEACH:
            topB = fillB = B.SAND; fillDepth = 4; subB = B.SANDSTONE; subDepth = 2;
            break;
          case Biome.OCEAN: case Biome.DEEP_OCEAN: case Biome.FROZEN_OCEAN: case Biome.WARM_OCEAN:
          case Biome.RIVER: case Biome.FROZEN_RIVER:
            if (h > SEA_LEVEL - 9) { topB = fillB = B.SAND; if (sn < -0.35) topB = fillB = B.CLAY; else if (sn > 0.5) topB = fillB = B.GRAVEL; }
            else { topB = fillB = B.GRAVEL; if (sn > 0.2) topB = fillB = B.SAND; if (sn < -0.4 && h > SEA_LEVEL - 20) topB = fillB = B.CLAY; }
            fillDepth = 3;
            break;
          case Biome.SWAMP:
            topB = h < SEA_LEVEL + 1 ? B.MUD : B.GRASS_BLOCK; fillB = B.DIRT;
            if (h < SEA_LEVEL) { topB = fillB = sn > 0 ? B.MUD : B.CLAY; }
            break;
          case Biome.MOUNTAINS: case Biome.SNOWY_PEAKS: {
            const snowLine = 112 + sn * 6;
            if (h > snowLine && hN < 5) { topB = B.SNOW_BLOCK; fillB = B.SNOW_BLOCK; fillDepth = 2; subB = B.STONE; }
            else if (h > 98 || hN >= 3) { topB = fillB = B.STONE; fillDepth = 3; if (sn > 0.45 && hN < 4) topB = fillB = B.GRAVEL; }
            else { topB = B.GRASS_BLOCK; }
            break;
          }
          case Biome.TAIGA: case Biome.SNOWY_TAIGA:
            if (sn > 0.25) topB = B.PODZOL;
            break;
          default:
            break;
        }
        if ((biome === Biome.PLAINS || biome === Biome.FOREST || biome === Biome.MEADOW) && hN >= 4) { topB = B.STONE; fillB = B.STONE; }

        const deepY = 14 + this.nStrata.noise2(wx / 14, wz / 14) * 4;
        const gbase = ((x >> 1) * 8 + (z >> 1)) * GY;
        for (let y = 0; y <= h; y++) {
          let id: number;
          const d = h - y;
          if (y === 0) id = B.BEDROCK;
          else if (y < 4 && hash3(wx, y, wz, seed + 9) < (4 - y) * 0.25) id = B.BEDROCK;
          else if (d === 0) id = topB;
          else if (d <= fillDepth) id = fillB;
          else if (subDepth > 0 && d <= fillDepth + subDepth) id = subB;
          else {
            if (y < deepY) id = B.DEEPSLATE;
            else {
              id = B.STONE;
              if (y >= 6 && y < 118) {
                const gi = gbase + (y >> 1);
                if (blobA[gi] > 0.5) id = B.ANDESITE;
                else if (blobA[gi] < -0.52) id = B.GRANITE;
                else if (blobB[gi] > 0.6) id = B.DIORITE;
              }
            }
          }
          blocks[cidx(x, y, z)] = id;
        }

        // 洞窟
        const entrance = this.nEntr.noise2(wx / 36, wz / 36) > 0.5;
        let caveTop = h < SEA_LEVEL ? h - 7 : entrance ? h : h - 3;
        if (caveTop > 118) caveTop = 118;
        for (let y = 4; y <= caveTop; y++) {
          const thr = 0.6 - clamp((SEA_LEVEL - y) / 90, 0, 1) * 0.1;
          let carved = false;
          const v1 = this.nCave1.noise3(wx / 40, y / 24, wz / 40);
          if (v1 > thr) carved = true;
          else {
            const a = this.nCave2.noise3(wx / 26, y / 18, wz / 26);
            if (a > -0.1 && a < 0.1) {
              const b = this.nCave3.noise3(wx / 26 + 99, y / 18, wz / 26 - 31);
              if (a * a + b * b < 0.0044) carved = true;
            }
          }
          if (carved) blocks[cidx(x, y, z)] = y <= 10 ? B.LAVA : B.AIR;
        }

        // 水面
        if (h < SEA_LEVEL) {
          for (let y = h + 1; y <= SEA_LEVEL; y++) blocks[cidx(x, y, z)] = B.WATER;
          if (biome === Biome.FROZEN_OCEAN || biome === Biome.FROZEN_RIVER) blocks[cidx(x, SEA_LEVEL, z)] = B.ICE;
        }
      }
    }

    // ---- 鉱石 ---------------------------------------------------------------
    const orng = mulberry32(Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663) ^ seed ^ 0x5a17);
    const isHost = (b: number) => b === B.STONE || b === B.DEEPSLATE || b === B.ANDESITE || b === B.DIORITE || b === B.GRANITE;
    const ore = (id: number, tries: number, minY: number, maxY: number, size: number) => {
      for (let t = 0; t < tries; t++) {
        let x = Math.floor(orng() * CHUNK), y = minY + Math.floor(orng() * (maxY - minY + 1)), z = Math.floor(orng() * CHUNK);
        const n = 1 + Math.floor(orng() * size);
        for (let i = 0; i < n; i++) {
          if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK && y > 0 && y < WORLD_H) {
            const bi = cidx(x, y, z);
            if (isHost(blocks[bi])) blocks[bi] = id;
          }
          x += Math.floor(orng() * 3) - 1;
          y += Math.floor(orng() * 3) - 1;
          z += Math.floor(orng() * 3) - 1;
        }
      }
    };
    ore(B.COAL_ORE, 22, 5, 110, 9);
    ore(B.IRON_ORE, 15, 5, 72, 7);
    ore(B.COPPER_ORE, 11, 20, 84, 7);
    ore(B.GOLD_ORE, 4, 5, 34, 6);
    ore(B.REDSTONE_ORE, 7, 5, 20, 7);
    ore(B.LAPIS_ORE, 3, 5, 32, 5);
    ore(B.DIAMOND_ORE, 4, 5, 16, 5);
    if (info(8, 8).mount > 0.3) ore(B.EMERALD_ORE, 3, 40, 110, 1);

    // ---- 植生 ---------------------------------------------------------------
    const p = new Placer(blocks, ox, oz);
    const hfn: HeightFn = (x, z) => this.columnInfo(x, z).height;
    const sites = this.structureSites(ox, oz, hfn);
    // 構造物の周囲は木を植えない（開けた空間にする）
    const nearSite = (x: number, z: number, extra = 0) => {
      for (const st of sites) {
        const r = (st.kind === 0 ? 15 : 11) + extra;
        if ((x - st.x) * (x - st.x) + (z - st.z) * (z - st.z) < r * r) return true;
      }
      return false;
    };

    const treeBiome = (b: number) =>
      b === Biome.FOREST || b === Biome.BIRCH_FOREST || b === Biome.AUTUMN_FOREST || b === Biome.CHERRY_GROVE || b === Biome.TAIGA ||
      b === Biome.SNOWY_TAIGA || b === Biome.PLAINS || b === Biome.MEADOW || b === Biome.SAVANNA || b === Biome.SWAMP || b === Biome.SNOWY_PLAINS || b === Biome.MOUNTAINS;

    const CELL = 5;
    const gx0 = Math.floor((ox - 9) / CELL), gx1 = Math.floor((ox + CHUNK + 9) / CELL);
    const gz0 = Math.floor((oz - 9) / CELL), gz1 = Math.floor((oz + CHUNK + 9) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const tx = gx * CELL + Math.floor(hash2(gx, gz, seed + 21) * 4);
        const tz = gz * CELL + Math.floor(hash2(gx, gz, seed + 22) * 4);
        const lx = tx - ox, lz = tz - oz;
        if (lx < -PAD || lx >= CHUNK + PAD || lz < -PAD || lz >= CHUNK + PAD) continue;
        const col = info(lx, lz);
        const biome = col.biome;
        const gy = col.height;
        if (!treeBiome(biome) || gy < SEA_LEVEL + 1 || gy > 110) continue;
        if (sites.length && nearSite(tx, tz)) continue;
        const r = hash2(gx, gz, seed + 23);
        const r2 = hash2(gx, gz, seed + 24);
        const trng = mulberry32(Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ seed ^ 0x77);
        let dens = 0;
        switch (biome) {
          case Biome.FOREST: dens = 0.72; break;
          case Biome.BIRCH_FOREST: dens = 0.62; break;
          case Biome.AUTUMN_FOREST: dens = 0.7; break;
          case Biome.CHERRY_GROVE: dens = 0.42; break;
          case Biome.TAIGA: dens = 0.7; break;
          case Biome.SNOWY_TAIGA: dens = 0.5; break;
          case Biome.PLAINS: dens = 0.035 + (col.humid > 0 ? 0.03 : 0); break;
          case Biome.MEADOW: dens = 0.05; break;
          case Biome.SAVANNA: dens = 0.1; break;
          case Biome.SWAMP: dens = 0.4; break;
          case Biome.SNOWY_PLAINS: dens = 0.03; break;
          case Biome.MOUNTAINS: dens = gy < 90 ? 0.3 : 0; break;
        }
        if (r >= dens) continue;
        switch (biome) {
          case Biome.FOREST:
            if (r2 < 0.12) treeBirch(p, tx, gy, tz, trng);
            else treeOak(p, tx, gy, tz, trng, B.OAK_LEAVES, B.OAK_LOG, r2 > 0.8, 1);
            break;
          case Biome.BIRCH_FOREST: treeBirch(p, tx, gy, tz, trng); break;
          case Biome.AUTUMN_FOREST: treeOak(p, tx, gy, tz, trng, B.MAPLE_LEAVES, B.OAK_LOG, r2 > 0.55, 1.1); break;
          case Biome.CHERRY_GROVE: treeCherry(p, tx, gy, tz, trng); break;
          case Biome.TAIGA: case Biome.SNOWY_TAIGA: case Biome.MOUNTAINS: treeSpruce(p, tx, gy, tz, trng, biome === Biome.SNOWY_TAIGA); break;
          case Biome.PLAINS: case Biome.MEADOW: case Biome.SNOWY_PLAINS:
            if (biome === Biome.SNOWY_PLAINS) treeSpruce(p, tx, gy, tz, trng, true);
            else treeOak(p, tx, gy, tz, trng, B.OAK_LEAVES, B.OAK_LOG, r2 > 0.7, 1);
            break;
          case Biome.SAVANNA: treeAcacia(p, tx, gy, tz, trng); break;
          case Biome.SWAMP: treeOak(p, tx, gy, tz, trng, B.OAK_LEAVES, B.OAK_LOG, false, 1.25); break;
        }
      }
    }

    // 古樹（まれな巨木）
    const AC = 112;
    const ax0 = Math.floor((ox - 14) / AC), ax1 = Math.floor((ox + CHUNK + 14) / AC);
    const az0 = Math.floor((oz - 14) / AC), az1 = Math.floor((oz + CHUNK + 14) / AC);
    for (let ax = ax0; ax <= ax1; ax++)
      for (let az = az0; az <= az1; az++) {
        if (hash2(ax, az, seed + 31) > 0.55) continue;
        const tx = ax * AC + 10 + Math.floor(hash2(ax, az, seed + 32) * (AC - 20));
        const tz = az * AC + 10 + Math.floor(hash2(ax, az, seed + 33) * (AC - 20));
        if (tx < ox - 14 || tx > ox + CHUNK + 14 || tz < oz - 14 || tz > oz + CHUNK + 14) continue;
        const col = this.columnInfo(tx, tz);
        const bi = col.biome;
        if (col.height < SEA_LEVEL + 2 || col.height > 95) continue;
        if (sites.length && nearSite(tx, tz, 8)) continue;
        if (!(bi === Biome.FOREST || bi === Biome.PLAINS || bi === Biome.MEADOW || bi === Biome.BIRCH_FOREST || bi === Biome.CHERRY_GROVE || bi === Biome.AUTUMN_FOREST)) continue;
        const trng = mulberry32(Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ seed ^ 0xa11c);
        treeAncient(p, tx, col.height, tz, trng);
      }

    // 苔むした岩
    const BC = 40;
    const bx0 = Math.floor((ox - 4) / BC), bx1 = Math.floor((ox + CHUNK + 4) / BC);
    const bz0 = Math.floor((oz - 4) / BC), bz1 = Math.floor((oz + CHUNK + 4) / BC);
    for (let bx = bx0; bx <= bx1; bx++)
      for (let bz = bz0; bz <= bz1; bz++) {
        if (hash2(bx, bz, seed + 41) > 0.5) continue;
        const tx = bx * BC + Math.floor(hash2(bx, bz, seed + 42) * BC);
        const tz = bz * BC + Math.floor(hash2(bx, bz, seed + 43) * BC);
        if (tx < ox - 4 || tx > ox + CHUNK + 4 || tz < oz - 4 || tz > oz + CHUNK + 4) continue;
        const col = this.columnInfo(tx, tz);
        if (!(col.biome === Biome.TAIGA || col.biome === Biome.SNOWY_TAIGA || col.biome === Biome.MOUNTAINS || col.biome === Biome.FOREST)) continue;
        if (col.height < SEA_LEVEL + 1) continue;
        const brng = mulberry32(Math.imul(tx, 73856093) ^ Math.imul(tz, 19349663) ^ seed ^ 0xb01d);
        const r = 1.4 + brng() * 1.5;
        const mossy = brng() < 0.7;
        for (let dx = -3; dx <= 3; dx++)
          for (let dy = -1; dy <= 3; dy++)
            for (let dz = -3; dz <= 3; dz++) {
              const d = (dx * dx) / (r * r) + ((dy - 0.3) * (dy - 0.3)) / (r * r * 0.7) + (dz * dz) / (r * r);
              const rr = brng();
              if (d + (rr - 0.5) * 0.4 < 1) p.set(tx + dx, col.height + dy, tz + dz, mossy && rr < 0.6 ? B.MOSSY_COBBLESTONE : B.COBBLESTONE, 2);
            }
      }

    // 竹林
    for (let lx = -2; lx < CHUNK + 2; lx++) {
      for (let lz = -2; lz < CHUNK + 2; lz++) {
        const col = info(lx, lz);
        if (col.biome !== Biome.BAMBOO_GROVE || col.height < SEA_LEVEL + 1) continue;
        const wx = ox + lx, wz = oz + lz;
        if (hash2(wx, wz, seed + 71) > 0.17) continue;
        if (sites.length && nearSite(wx, wz)) continue;
        const H = 8 + Math.floor(hash2(wx, wz, seed + 72) * 9);
        const gy = col.height;
        for (let k = 1; k <= H; k++) p.set(wx, gy + k, wz, B.BAMBOO, 1);
        p.set(wx, gy + H + 1, wz, B.BAMBOO_LEAVES, 1);
        for (let k = 0; k < 3; k++) {
          const ang = Math.floor(hash2(wx + k, wz, seed + 73) * 4);
          const dxl = [1, -1, 0, 0][ang], dzl = [0, 0, 1, -1][ang];
          p.set(wx + dxl, gy + H - 1 - k, wz + dzl, B.BAMBOO_LEAVES, 0);
        }
      }
    }

    // 構造物（鳥居・環状列石）
    for (const st of sites) {
      const srng = mulberry32(Math.imul(st.x, 73856093) ^ Math.imul(st.z, 19349663) ^ seed ^ 0x5eed);
      if (st.kind === 0) toriiGate(p, st.x, st.gy, st.z, Math.floor(srng() * 4), hfn);
      else stoneCircle(p, st.x, st.gy, st.z, srng, hfn);
    }

    // 地表の草花・海中植物・雪
    for (let x = 0; x < CHUNK; x++) {
      for (let z = 0; z < CHUNK; z++) {
        const wx = ox + x, wz = oz + z;
        const col = info(x, z);
        const h = col.height;
        const biome = col.biome;
        const r = hash2(wx, wz, seed + 51);
        const r2 = hash2(wx, wz, seed + 52);
        const topId = blocks[cidx(x, h, z)];
        const above = h + 1 < WORLD_H ? blocks[cidx(x, h + 1, z)] : 255;

        if (h >= SEA_LEVEL) {
          if (above !== B.AIR) continue;
          const y1 = h + 1;
          if (topId === B.GRASS_BLOCK || topId === B.PODZOL) {
            let grassP = 0, tallP = 0, fernP = 0, flowerP = 0, mushP = 0.0025;
            switch (biome) {
              case Biome.PLAINS: grassP = 0.24; tallP = 0.07; flowerP = 0.03; break;
              case Biome.MEADOW: grassP = 0.2; tallP = 0.08; flowerP = 0.32; break;
              case Biome.FOREST: grassP = 0.13; tallP = 0.04; flowerP = 0.006; fernP = 0.03; break;
              case Biome.BIRCH_FOREST: grassP = 0.14; tallP = 0.05; flowerP = 0.01; break;
              case Biome.AUTUMN_FOREST: grassP = 0.14; tallP = 0.03; fernP = 0.03; break;
              case Biome.CHERRY_GROVE: grassP = 0.16; tallP = 0.04; flowerP = 0.1; break;
              case Biome.TAIGA: grassP = 0.06; fernP = 0.12; tallP = 0.02; break;
              case Biome.SAVANNA: grassP = 0.26; tallP = 0.12; break;
              case Biome.BAMBOO_GROVE: grassP = 0.2; tallP = 0.05; fernP = 0.08; flowerP = 0.008; break;
              case Biome.SWAMP: grassP = 0.2; tallP = 0.06; fernP = 0.04; mushP = 0.012; break;
              case Biome.MOUNTAINS: grassP = 0.1; fernP = 0.02; break;
              case Biome.SNOWY_PLAINS: case Biome.SNOWY_TAIGA: break;
              default: grassP = 0.1;
            }
            if (isColdBiome(biome)) grassP = tallP = fernP = flowerP = 0;
            const fl = this.nFlower.noise2(wx / 5.5, wz / 5.5);
            if (biome === Biome.CHERRY_GROVE && r < 0.18) {
              blocks[cidx(x, y1, z)] = B.PINK_PETALS;
            } else if (flowerP > 0 && fl > (biome === Biome.MEADOW ? -0.2 : 0.15) && r2 < flowerP * 1.8) {
              const patch = hash2(Math.floor(wx / 8), Math.floor(wz / 8), seed + 53);
              const list = biome === Biome.MEADOW || biome === Biome.CHERRY_GROVE
                ? [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER, B.RED_TULIP, B.ORANGE_TULIP, B.WHITE_TULIP, B.PINK_TULIP, B.AZURE_BLUET, B.ALLIUM, B.LILY_OF_THE_VALLEY, B.BLUE_ORCHID]
                : [B.DANDELION, B.POPPY, B.OXEYE_DAISY, B.CORNFLOWER, B.AZURE_BLUET, B.ALLIUM];
              const idx = biome === Biome.MEADOW ? Math.floor(hash2(wx, wz, seed + 54) * list.length) : Math.floor(patch * list.length);
              blocks[cidx(x, y1, z)] = list[idx];
            } else if (r < tallP && y1 + 1 < WORLD_H) {
              blocks[cidx(x, y1, z)] = B.TALL_GRASS_LO;
              blocks[cidx(x, y1 + 1, z)] = B.TALL_GRASS_HI;
            } else if (r < tallP + grassP) {
              blocks[cidx(x, y1, z)] = B.GRASS;
            } else if (r < tallP + grassP + fernP) {
              blocks[cidx(x, y1, z)] = B.FERN;
            } else if (r2 > 1 - mushP) {
              blocks[cidx(x, y1, z)] = r < 0.5 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
            } else if ((biome === Biome.PLAINS || biome === Biome.MEADOW) && r > 0.9988) {
              blocks[cidx(x, y1, z)] = B.PUMPKIN;
            }
          } else if (topId === B.SAND || topId === B.RED_SAND) {
            if (biome === Biome.DESERT) {
              if (r < 0.0075) {
                const hh = 1 + Math.floor(r2 * 3.2);
                let ok = true;
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                  const nx = x + dx, nz = z + dz;
                  if (nx >= 0 && nx < CHUNK && nz >= 0 && nz < CHUNK && blocks[cidx(nx, y1, nz)] === B.CACTUS) ok = false;
                }
                if (ok) for (let k = 0; k < hh; k++) blocks[cidx(x, y1 + k, z)] = B.CACTUS;
              } else if (r > 0.985) blocks[cidx(x, y1, z)] = B.DEAD_BUSH;
            } else if (h === SEA_LEVEL && r < 0.1) {
              // 水辺のサトウキビ
              let wet = false;
              for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (info(x + dx, z + dz).height < SEA_LEVEL) wet = true;
              if (wet) {
                const hh = 1 + Math.floor(r2 * 3);
                for (let k = 0; k < hh; k++) blocks[cidx(x, y1 + k, z)] = B.SUGAR_CANE;
              }
            }
          } else if (topId === B.DIRT && h === SEA_LEVEL && r < 0.06) {
            let wet = false;
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (info(x + dx, z + dz).height < SEA_LEVEL) wet = true;
            if (wet) blocks[cidx(x, y1, z)] = B.SUGAR_CANE;
          }
        } else {
          // 水中
          const depth = SEA_LEVEL - h;
          const floor = topId;
          if (biome === Biome.SWAMP && h < SEA_LEVEL && blocks[cidx(x, SEA_LEVEL, z)] === B.WATER && r < 0.1) {
            blocks[cidx(x, SEA_LEVEL + 1, z)] = B.LILY_PAD;
          } else if ((floor === B.SAND || floor === B.GRAVEL || floor === B.MUD || floor === B.CLAY || floor === B.DIRT) && above === B.WATER) {
            if (biome === Biome.OCEAN || biome === Biome.WARM_OCEAN) {
              if (depth <= 14 && r < 0.2) blocks[cidx(x, h + 1, z)] = B.SEAGRASS;
              else if (depth >= 5 && depth <= 24 && r > 0.955) {
                const len = Math.min(3 + Math.floor(r2 * 9), depth - 2);
                for (let k = 1; k <= len; k++) blocks[cidx(x, h + k, z)] = B.KELP;
              }
            } else if ((biome === Biome.RIVER || biome === Biome.SWAMP) && r < 0.1) {
              blocks[cidx(x, h + 1, z)] = B.SEAGRASS;
            } else if (biome === Biome.DEEP_OCEAN && depth <= 26 && r > 0.975) {
              const len = Math.min(3 + Math.floor(r2 * 8), depth - 2);
              for (let k = 1; k <= len; k++) blocks[cidx(x, h + k, z)] = B.KELP;
            }
          }
        }

        // 雪
        const cold = isColdBiome(biome) || (biome === Biome.MOUNTAINS && h > 104);
        if (cold && biome !== Biome.FROZEN_OCEAN && biome !== Biome.FROZEN_RIVER) {
          let y = WORLD_H - 2;
          while (y > 0 && blocks[cidx(x, y, z)] === B.AIR) y--;
          const b = blocks[cidx(x, y, z)];
          if (y >= SEA_LEVEL - 1 && y + 1 < WORLD_H) {
            if (SHAPE[b] === Shape.CROSS) blocks[cidx(x, y, z)] = B.SNOW_LAYER;
            else if (b !== B.WATER && b !== B.ICE && b !== B.LAVA && b !== B.SNOW_LAYER && (OPACITY[b] >= 1) && blocks[cidx(x, y + 1, z)] === B.AIR) blocks[cidx(x, y + 1, z)] = B.SNOW_LAYER;
          }
        }
      }
    }

    // 最上層（光を遮る最も高いブロックのy+1）
    for (let x = 0; x < CHUNK; x++)
      for (let z = 0; z < CHUNK; z++) {
        let y = WORLD_H - 1;
        const base = cidx(x, 0, z);
        while (y > 0 && OPACITY[blocks[base + y]] === 0) y--;
        top[x * CHUNK + z] = y + 1;
      }

    return { blocks, climate, top };
  }
}
