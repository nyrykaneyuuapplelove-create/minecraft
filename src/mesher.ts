// チャンクのメッシュ生成。滑らかなライティング（頂点ごとの空/ブロック光）と
// アンビエントオクルージョン、群系ごとの草・葉・水の着色をここで頂点に焼き込む。

import { WORLD_H, CHUNK, climateIdx } from "./config";
import {
  B, BLOCKS, OPAQUE, SHAPE, LAYER, Shape, Layer, TEX_TOP, TEX_BOTTOM, TEX_SIDE, TEX_SIDE_ALT, TINT, Tint, IS_LEAVES, IN_WATER,
  AO_OCC, isWaterLike,
} from "./blocks";
import { RW, HP, REGION_SIZE, computeLight } from "./lighting";
import { biomeColors } from "./biomes";
import { hash3 } from "./noise";

// シェーダー側と共有するフラグ
export const F_WATER = 1;
export const F_LAVA = 2;
export const F_LEAVES = 4;
export const F_PLANT = 8;
export const F_UWPLANT = 16;
export const F_GLASSY = 32;

export interface Geo {
  pos: Float32Array;
  uv: Float32Array;
  data: Uint8Array;
  light: Uint8Array;
  color: Uint8Array;
  index: Uint16Array | Uint32Array;
  minY: number;
  maxY: number;
}
export interface MeshResult {
  opaque: Geo | null;
  cutout: Geo | null;
  translucent: Geo | null;
}

class Buf {
  cap = 2048;
  pos = new Float32Array(this.cap * 3);
  uv = new Float32Array(this.cap * 2);
  data = new Uint8Array(this.cap * 4);
  light = new Uint8Array(this.cap * 4);
  color = new Uint8Array(this.cap * 4);
  icap = 3072;
  idx = new Uint32Array(this.icap);
  nv = 0;
  ni = 0;
  minY = 1e9;
  maxY = -1e9;

  reset() {
    this.nv = 0;
    this.ni = 0;
    this.minY = 1e9;
    this.maxY = -1e9;
  }
  private grow() {
    const ncap = this.cap * 2;
    const g = <T extends Float32Array | Uint8Array>(a: T, n: number): T => {
      const r = new (a.constructor as new (n: number) => T)(n);
      r.set(a);
      return r;
    };
    this.pos = g(this.pos, ncap * 3);
    this.uv = g(this.uv, ncap * 2);
    this.data = g(this.data, ncap * 4);
    this.light = g(this.light, ncap * 4);
    this.color = g(this.color, ncap * 4);
    this.cap = ncap;
    const nic = ncap * 3 / 2 * 2;
    const ni = new Uint32Array(nic);
    ni.set(this.idx);
    this.idx = ni;
    this.icap = nic;
  }
  /** 頂点を1つ追加して添字を返す */
  vert(x: number, y: number, z: number, u: number, v: number, d0: number, d1: number, d2: number, d3: number, l0: number, l1: number, l2: number, l3: number, c0: number, c1: number, c2: number, c3: number): number {
    if (this.nv >= this.cap) this.grow();
    const n = this.nv++;
    const p = n * 3;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    const q = n * 2;
    this.uv[q] = u; this.uv[q + 1] = v;
    const r = n * 4;
    this.data[r] = d0; this.data[r + 1] = d1; this.data[r + 2] = d2; this.data[r + 3] = d3;
    this.light[r] = l0; this.light[r + 1] = l1; this.light[r + 2] = l2; this.light[r + 3] = l3;
    this.color[r] = c0; this.color[r + 1] = c1; this.color[r + 2] = c2; this.color[r + 3] = c3;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
    return n;
  }
  quad(a: number, b: number, c: number, d: number, flip: boolean) {
    if (this.ni + 6 > this.icap) this.grow();
    const i = this.idx;
    let n = this.ni;
    if (!flip) { i[n++] = a; i[n++] = b; i[n++] = c; i[n++] = a; i[n++] = c; i[n++] = d; }
    else { i[n++] = b; i[n++] = c; i[n++] = d; i[n++] = b; i[n++] = d; i[n++] = a; }
    this.ni = n;
  }
  finish(oy: number): Geo | null {
    if (this.nv === 0) return null;
    const nv = this.nv;
    const index = nv < 65536 ? Uint16Array.from(this.idx.subarray(0, this.ni)) : this.idx.slice(0, this.ni);
    return {
      pos: this.pos.slice(0, nv * 3),
      uv: this.uv.slice(0, nv * 2),
      data: this.data.slice(0, nv * 4),
      light: this.light.slice(0, nv * 4),
      color: this.color.slice(0, nv * 4),
      index,
      minY: this.minY + oy,
      maxY: this.maxY + oy,
    };
  }
}

const bufO = new Buf();
const bufC = new Buf();
const bufT = new Buf();

// ---- 領域バッファ -----------------------------------------------------------------
const rb = new Uint8Array(REGION_SIZE);
const sky = new Uint8Array(REGION_SIZE);
const blk = new Uint8Array(REGION_SIZE);
const colRaw = new Float32Array(RW * RW * 9);
const colBlur = new Float32Array(RW * RW * 9);
const colTmp = new Float32Array(RW * RW * 9);
const scratch = new Float32Array(9);

const EX = HP * RW;
const EZ = HP;
const NORMAL_OFF = [EX, -EX, 1, -1, EZ, -EZ];

const FACE_CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AXIS_OFF = [EX, 1, EZ];

const AO_OFFS = new Int32Array(6 * 4 * 4);
for (let f = 0; f < 6; f++) {
  const n = NORMALS[f];
  const na = n[0] ? 0 : n[1] ? 1 : 2;
  const [t1, t2] = [0, 1, 2].filter((a) => a !== na);
  for (let c = 0; c < 4; c++) {
    const cc = FACE_CORNERS[f][c];
    const d1 = cc[t1] ? 1 : -1;
    const d2 = cc[t2] ? 1 : -1;
    const offN = n[0] * EX + n[1] + n[2] * EZ;
    const o1 = AXIS_OFF[t1] * d1;
    const o2 = AXIS_OFF[t2] * d2;
    const o = f * 16 + c * 4;
    AO_OFFS[o] = offN;
    AO_OFFS[o + 1] = offN + o1;
    AO_OFFS[o + 2] = offN + o2;
    AO_OFFS[o + 3] = offN + o1 + o2;
  }
}

const AUTUMN: [number, number, number][] = [
  [230, 115, 26], [217, 64, 26], [242, 179, 38], [191, 51, 38], [204, 140, 31], [168, 70, 28],
];

// ---- 色（頂点着色）------------------------------------------------------------------
const vAO = new Float32Array(4);
const vSky = new Float32Array(4);
const vBlk = new Float32Array(4);
const vCol = new Uint8Array(16);

function buildColors(climate: Uint8Array[]) {
  for (let rx = 0; rx < RW; rx++) {
    const dx = (rx / CHUNK) | 0, lx = rx % CHUNK;
    for (let rz = 0; rz < RW; rz++) {
      const dz = (rz / CHUNK) | 0, lz = rz % CHUNK;
      const cl = climate[dx * 3 + dz];
      const ci = climateIdx(lx, lz);
      biomeColors(cl[ci], cl[ci + 1], cl[ci + 2], scratch);
      colRaw.set(scratch, (rx * RW + rz) * 9);
    }
  }
  // 5x5 の箱ボカシ（バイオーム境界をなめらかに）
  const R = 2;
  for (let rx = 0; rx < RW; rx++)
    for (let rz = 0; rz < RW; rz++)
      for (let ch = 0; ch < 9; ch++) {
        let s = 0;
        for (let k = -R; k <= R; k++) {
          const z2 = rz + k < 0 ? 0 : rz + k >= RW ? RW - 1 : rz + k;
          s += colRaw[(rx * RW + z2) * 9 + ch];
        }
        colTmp[(rx * RW + rz) * 9 + ch] = s / (2 * R + 1);
      }
  for (let rx = 0; rx < RW; rx++)
    for (let rz = 0; rz < RW; rz++)
      for (let ch = 0; ch < 9; ch++) {
        let s = 0;
        for (let k = -R; k <= R; k++) {
          const x2 = rx + k < 0 ? 0 : rx + k >= RW ? RW - 1 : rx + k;
          s += colTmp[(x2 * RW + rz) * 9 + ch];
        }
        colBlur[(rx * RW + rz) * 9 + ch] = s / (2 * R + 1);
      }
}

/** 頂点 (チャンク内座標の角 vx,vz) の着色を vCol[o..o+3] に書く */
function vertexTint(kind: number, vx: number, vz: number, o: number, wx: number, wy: number, wz: number) {
  if (kind === Tint.GRASS || kind === Tint.FOLIAGE || kind === Tint.WATER) {
    const ch = kind === Tint.GRASS ? 0 : kind === Tint.FOLIAGE ? 3 : 6;
    const rx = Math.floor(vx) + 16, rz = Math.floor(vz) + 16;
    const i0 = ((rx - 1) * RW + (rz - 1)) * 9 + ch;
    const i1 = (rx * RW + (rz - 1)) * 9 + ch;
    const i2 = ((rx - 1) * RW + rz) * 9 + ch;
    const i3 = (rx * RW + rz) * 9 + ch;
    for (let k = 0; k < 3; k++) {
      const v = (colBlur[i0 + k] + colBlur[i1 + k] + colBlur[i2 + k] + colBlur[i3 + k]) * 0.25;
      vCol[o + k] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0;
    }
    vCol[o + 3] = 255;
  } else if (kind === Tint.BIRCH) {
    vCol[o] = 128; vCol[o + 1] = 167; vCol[o + 2] = 85; vCol[o + 3] = 255;
  } else if (kind === Tint.SPRUCE) {
    vCol[o] = 97; vCol[o + 1] = 153; vCol[o + 2] = 97; vCol[o + 3] = 255;
  } else if (kind === Tint.AUTUMN) {
    const c = AUTUMN[(hash3(wx, wy, wz, 77) * AUTUMN.length) | 0];
    vCol[o] = c[0]; vCol[o + 1] = c[1]; vCol[o + 2] = c[2]; vCol[o + 3] = 255;
  } else {
    vCol[o] = vCol[o + 1] = vCol[o + 2] = vCol[o + 3] = 255;
  }
}

// ---- 面の生成 -------------------------------------------------------------------------
function cubeFace(buf: Buf, f: number, x: number, y: number, z: number, ri: number, tex: number, flags: number, wParam: number, tint: number, wx: number, wy: number, wz: number) {
  const fo = f * 16;
  for (let c = 0; c < 4; c++) {
    const a = ri + AO_OFFS[fo + c * 4];
    const b1 = ri + AO_OFFS[fo + c * 4 + 1];
    const b2 = ri + AO_OFFS[fo + c * 4 + 2];
    const cc = ri + AO_OFFS[fo + c * 4 + 3];
    const s1 = AO_OCC[rb[b1]], s2 = AO_OCC[rb[b2]], s3 = AO_OCC[rb[cc]];
    let sumS = sky[a], sumB = blk[a], n = 1;
    if (s1 === 0) { sumS += sky[b1]; sumB += blk[b1]; n++; }
    if (s2 === 0) { sumS += sky[b2]; sumB += blk[b2]; n++; }
    if (s3 === 0 && (s1 === 0 || s2 === 0)) { sumS += sky[cc]; sumB += blk[cc]; n++; }
    vAO[c] = s1 && s2 ? 3 : s1 + s2 + s3;
    vSky[c] = sumS / n;
    vBlk[c] = sumB / n;
    const cor = FACE_CORNERS[f][c];
    vertexTint(tint, x + cor[0], z + cor[2], c * 4, wx, wy, wz);
  }
  const corners = FACE_CORNERS[f];
  const v0 = buf.nv;
  for (let c = 0; c < 4; c++) {
    const cor = corners[c];
    buf.vert(
      x + cor[0], y + cor[1], z + cor[2], FACE_UV[c][0], 1 - FACE_UV[c][1],
      tex, f, flags, wParam,
      Math.round(vSky[c] * 17), Math.round(vBlk[c] * 17), Math.round(vAO[c] * 85), 0,
      vCol[c * 4], vCol[c * 4 + 1], vCol[c * 4 + 2], vCol[c * 4 + 3],
    );
  }
  buf.quad(v0, v0 + 1, v0 + 2, v0 + 3, vAO[0] + vAO[2] <= vAO[1] + vAO[3]);
}

function leafExposed(ri: number): boolean {
  for (let f = 0; f < 6; f++) {
    const nb = rb[ri + NORMAL_OFF[f]];
    if (IS_LEAVES[nb] === 0 && OPAQUE[nb] === 0) return true;
  }
  return false;
}

function faceVisible(id: number, ri: number, f: number): boolean {
  const nri = ri + NORMAL_OFF[f];
  const nb = rb[nri];
  if (OPAQUE[nb]) return false;
  const layer = LAYER[id];
  if (layer === Layer.TRANSLUCENT) return nb !== id;
  if (layer === Layer.CUTOUT && IS_LEAVES[nb]) return leafExposed(nri);
  return true;
}

function liquidCell(x: number, y: number, z: number, ri: number, id: number, wx: number, wy: number, wz: number) {
  const isLava = id === B.LAVA;
  const buf = isLava ? bufO : bufT;
  const above = rb[ri + 1];
  const aboveSame = isLava ? above === B.LAVA : isWaterLike(above);
  const hTop = aboveSame || OPAQUE[above] ? 1 : isLava ? 0.82 : 0.875;
  const flags = isLava ? F_LAVA : F_WATER;
  const tex = TEX_TOP[isLava ? B.LAVA : B.WATER];
  for (let f = 0; f < 6; f++) {
    const nb = rb[ri + NORMAL_OFF[f]];
    if (OPAQUE[nb]) continue;
    if (isLava ? nb === B.LAVA : isWaterLike(nb)) continue;
    const corners = FACE_CORNERS[f];
    const v0 = buf.nv;
    for (let c = 0; c < 4; c++) {
      const cor = corners[c];
      const py = cor[1] ? hTop : 0;
      let shore = 0, depth = 0;
      vertexTint(isLava ? Tint.NONE : Tint.WATER, x + cor[0], z + cor[2], 0, wx, wy, wz);
      // 光：上面は水上の空気のライトを使う
      let sk = sky[ri], bk = blk[ri];
      if (f === 2) {
        sk = Math.max(sk, sky[ri + 1]);
        bk = Math.max(bk, blk[ri + 1]);
      }
      if (f === 2 && !isLava) {
        // 水際（岸の近さ）と水深を頂点ごとに求める
        let land = 0, dsum = 0;
        for (let k = 0; k < 4; k++) {
          const ddx = cor[0] - 1 + (k & 1), ddz = cor[2] - 1 + ((k >> 1) & 1);
          const nri = ri + ddx * EX + ddz * EZ;
          const nb2 = rb[nri];
          if (OPAQUE[nb2]) land++;
          else if (isWaterLike(nb2)) {
            let d = 1;
            while (d < 14 && isWaterLike(rb[nri - d])) d++;
            dsum += d;
          }
        }
        shore = Math.round((land / 4) * 255);
        depth = Math.min(255, Math.round((dsum / 4 / 14) * 255));
      }
      buf.vert(
        x + cor[0], y + py, z + cor[2], FACE_UV[c][0], 1 - FACE_UV[c][1],
        tex, f, flags, shore,
        Math.round(sk * 17), Math.round(bk * 17), 0, depth,
        vCol[0], vCol[1], vCol[2], vCol[3],
      );
    }
    buf.quad(v0, v0 + 1, v0 + 2, v0 + 3, false);
  }
}

function crossPlant(x: number, y: number, z: number, ri: number, id: number, wx: number, wy: number, wz: number) {
  const h1 = hash3(wx, wy, wz, 11), h2 = hash3(wx, wy, wz, 12), h3 = hash3(wx, wy, wz, 13);
  const noOff = id === B.SUGAR_CANE || id === B.KELP || id === B.SEAGRASS;
  const ox = noOff ? 0 : (h1 - 0.5) * 0.4;
  const oz = noOff ? 0 : (h2 - 0.5) * 0.4;
  const hs = id === B.GRASS || id === B.FERN ? 0.7 + h3 * 0.35 : id === B.SEAGRASS ? 0.9 : 1;
  const x0 = 0.1 + ox, x1 = 0.9 + ox, z0 = 0.1 + oz, z1 = 0.9 + oz;
  const sk = Math.round(sky[ri] * 17), bk = Math.round(blk[ri] * 17);
  const under = IN_WATER[id] === 1;
  const flags = under ? F_UWPLANT : F_PLANT;
  const tex = TEX_SIDE[id];
  const tint = TINT[id];
  let wBottom = 0, wTop = 255;
  if (id === B.TALL_GRASS_LO) wTop = 150;
  else if (id === B.TALL_GRASS_HI) wBottom = 150;
  else if (id === B.SUGAR_CANE || id === B.KELP) { wTop = 90; }
  const buf = bufC;
  for (let q = 0; q < 2; q++) {
    const ax = q === 0 ? x0 : x0, az = q === 0 ? z0 : z1;
    const bx = q === 0 ? x1 : x1, bz = q === 0 ? z1 : z0;
    vertexTint(tint, x + 0.5, z + 0.5, 0, wx, wy, wz);
    const v0 = buf.vert(x + ax, y, z + az, 0, 1, tex, 6, flags, wBottom, sk, bk, 0, 0, vCol[0], vCol[1], vCol[2], 255);
    buf.vert(x + bx, y, z + bz, 1, 1, tex, 6, flags, wBottom, sk, bk, 0, 0, vCol[0], vCol[1], vCol[2], 255);
    buf.vert(x + bx, y + hs, z + bz, 1, 0, tex, 6, flags, wTop, sk, bk, 0, 0, vCol[0], vCol[1], vCol[2], 255);
    buf.vert(x + ax, y + hs, z + az, 0, 0, tex, 6, flags, wTop, sk, bk, 0, 0, vCol[0], vCol[1], vCol[2], 255);
    buf.quad(v0, v0 + 1, v0 + 2, v0 + 3, false);
  }
}

function boxModel(x: number, y: number, z: number, ri: number, id: number, wx: number, wy: number, wz: number) {
  const def = BLOCKS[id];
  const boxes = def.boxes!;
  const buf = def.layer === Layer.CUTOUT ? bufC : def.layer === Layer.TRANSLUCENT ? bufT : bufO;
  const sk = Math.round(sky[ri] * 17), bk = Math.round(blk[ri] * 17);
  const lean = def.lean;
  const tint = def.tint;
  // 竹はブロックごとに位置を少しずらす
  const jx = id === B.BAMBOO ? (hash3(wx, 0, wz, 21) - 0.5) * 0.5 : 0;
  const jz = id === B.BAMBOO ? (hash3(wx, 0, wz, 22) - 0.5) * 0.5 : 0;
  for (const bx of boxes) {
    const [x0, y0, z0, x1, y1, z1] = bx;
    for (let f = 0; f < 6; f++) {
      const boundary = f === 0 ? x1 >= 1 : f === 1 ? x0 <= 0 : f === 2 ? y1 >= 1 : f === 3 ? y0 <= 0 : f === 4 ? z1 >= 1 : z0 <= 0;
      if (boundary) {
        const nb = rb[ri + NORMAL_OFF[f]];
        if (OPAQUE[nb] || nb === id) continue;
      }
      const tex = f === 2 ? def.top : f === 3 ? def.bottom : def.side;
      const corners = FACE_CORNERS[f];
      const v0 = buf.nv;
      // 面の明るさ：上面は上のセルの光を拾う
      let fs = sk, fb = bk;
      if (f === 2) { fs = Math.max(fs, Math.round(sky[ri + 1] * 17)); fb = Math.max(fb, Math.round(blk[ri + 1] * 17)); }
      for (let c = 0; c < 4; c++) {
        const cor = corners[c];
        const px = cor[0] ? x1 : x0, py = cor[1] ? y1 : y0, pz = cor[2] ? z1 : z0;
        let u: number, v: number;
        switch (f) {
          case 0: u = 1 - pz; v = py; break;
          case 1: u = pz; v = py; break;
          case 2: u = px; v = 1 - pz; break;
          case 3: u = px; v = pz; break;
          case 4: u = px; v = py; break;
          default: u = 1 - px; v = py; break;
        }
        let ex = px + jx, ez = pz + jz;
        if (lean) {
          const t = (py - y0) / (y1 - y0);
          ex += lean[0] * t;
          ez += lean[1] * t;
        }
        vertexTint(tint, x + ex, z + ez, 0, wx, wy, wz);
        buf.vert(x + ex, y + py, z + ez, u, 1 - v, tex, f, 0, 0, fs, fb, 0, 0, vCol[0], vCol[1], vCol[2], 255);
      }
      buf.quad(v0, v0 + 1, v0 + 2, v0 + 3, false);
    }
  }
}

// ---- メイン ----------------------------------------------------------------------------
export function meshChunk(blocks: Uint8Array[], climate: Uint8Array[], cx: number, cz: number): MeshResult {
  // 領域に 3x3 チャンクをコピー
  for (let dx = 0; dx < 3; dx++) {
    for (let dz = 0; dz < 3; dz++) {
      const src = blocks[dx * 3 + dz];
      for (let lx = 0; lx < CHUNK; lx++) {
        for (let lz = 0; lz < CHUNK; lz++) {
          const dst = HP * (dz * CHUNK + lz + RW * (dx * CHUNK + lx));
          const s = WORLD_H * (lz + CHUNK * lx);
          rb[dst] = B.BEDROCK;
          rb.set(src.subarray(s, s + WORLD_H), dst + 1);
          rb[dst + HP - 1] = 0;
        }
      }
    }
  }
  computeLight(rb, sky, blk);
  buildColors(climate);

  bufO.reset(); bufC.reset(); bufT.reset();

  // 中央チャンクの最大高さ
  let topY = 0;
  for (let lx = 0; lx < CHUNK; lx++)
    for (let lz = 0; lz < CHUNK; lz++) {
      const base = HP * (lz + 16 + RW * (lx + 16));
      for (let y = WORLD_H - 1; y > topY; y--) {
        if (rb[base + y + 1] !== 0) { topY = y; break; }
      }
    }
  topY = Math.min(WORLD_H - 1, topY + 1);

  const ox = cx * CHUNK, oz = cz * CHUNK;
  for (let lx = 0; lx < CHUNK; lx++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      const colBase = HP * (lz + 16 + RW * (lx + 16));
      for (let y = 0; y <= topY; y++) {
        const ri = colBase + y + 1;
        const id = rb[ri];
        if (id === 0) continue;
        const shape = SHAPE[id];
        const wx = ox + lx, wz = oz + lz;
        if (shape === Shape.CUBE) {
          const layer = LAYER[id];
          const buf = layer === Layer.OPAQUE ? bufO : layer === Layer.CUTOUT ? bufC : bufT;
          const tint = TINT[id];
          let flags = 0, wParam = 0;
          if (IS_LEAVES[id]) { flags = F_LEAVES; wParam = 70; }
          else if (id === B.ICE || id === B.GLASS) flags = F_GLASSY;
          for (let f = 0; f < 6; f++) {
            if (!faceVisible(id, ri, f)) continue;
            let tex: number;
            if (f === 2) tex = TEX_TOP[id];
            else if (f === 3) tex = TEX_BOTTOM[id];
            else {
              tex = TEX_SIDE[id];
              if (id === B.GRASS_BLOCK) {
                const up = rb[ri + 1];
                if (up === B.SNOW_LAYER || up === B.SNOW_BLOCK) tex = TEX_SIDE_ALT[id];
              }
            }
            cubeFace(buf, f, lx, y, lz, ri, tex, flags, wParam, tint, wx, y, wz);
          }
        } else if (shape === Shape.LIQUID) {
          liquidCell(lx, y, lz, ri, id, wx, y, wz);
        } else if (shape === Shape.CROSS) {
          if (IN_WATER[id]) liquidCell(lx, y, lz, ri, B.WATER, wx, y, wz);
          crossPlant(lx, y, lz, ri, id, wx, y, wz);
        } else {
          boxModel(lx, y, lz, ri, id, wx, y, wz);
        }
      }
    }
  }
  return { opaque: bufO.finish(0), cutout: bufC.finish(0), translucent: bufT.finish(0) };
}

