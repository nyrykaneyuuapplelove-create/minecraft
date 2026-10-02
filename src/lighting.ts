// 光の伝播（スカイライト＋ブロックライト）。
// 3x3チャンク分（48x48）の領域に対して計算し、中央チャンクの結果だけを使う。
// 光は最大15ブロックしか届かないので、中央チャンクの値は厳密に正しい。

import { WORLD_H } from "./config";
import { OPACITY, EMIT } from "./blocks";

export const RW = 48;
/** y方向は下に1、上に1のパディングを持つ（下: 岩盤 / 上: 空） */
export const HP = WORLD_H + 2;
export const REGION_SIZE = RW * RW * HP;

const QMASK = (1 << 20) - 1;
const queue = new Int32Array(1 << 20);
const EX = HP * RW;
const EZ = HP;

function bfs(light: Uint8Array, rb: Uint8Array, head: number, tail: number) {
  while (head !== tail) {
    const p = queue[head];
    head = (head + 1) & QMASK;
    const x = p >> 16, z = (p >> 8) & 255, i = p & 255;
    const idx = i + HP * (z + RW * x);
    const L = light[idx];
    if (L <= 1) continue;
    let n: number, op: number, nl: number;
    if (x < RW - 1) {
      n = idx + EX; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p + 65536; tail = (tail + 1) & QMASK; } }
    }
    if (x > 0) {
      n = idx - EX; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p - 65536; tail = (tail + 1) & QMASK; } }
    }
    if (z < RW - 1) {
      n = idx + EZ; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p + 256; tail = (tail + 1) & QMASK; } }
    }
    if (z > 0) {
      n = idx - EZ; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p - 256; tail = (tail + 1) & QMASK; } }
    }
    if (i < HP - 1) {
      n = idx + 1; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p + 1; tail = (tail + 1) & QMASK; } }
    }
    if (i > 0) {
      n = idx - 1; op = OPACITY[rb[n]];
      if (op < 15) { nl = L - (op > 1 ? op : 1); if (nl > light[n]) { light[n] = nl; queue[tail] = p - 1; tail = (tail + 1) & QMASK; } }
    }
  }
}

export function computeLight(rb: Uint8Array, sky: Uint8Array, blk: Uint8Array): void {
  sky.fill(0);
  blk.fill(0);

  // 1) 列ごとの直射スカイライト
  let maxI = 1;
  for (let x = 0; x < RW; x++) {
    for (let z = 0; z < RW; z++) {
      const base = HP * (z + RW * x);
      let level = 15;
      sky[base + HP - 1] = 15;
      let seenTop = false;
      for (let i = HP - 2; i >= 1; i--) {
        const b = rb[base + i];
        const op = OPACITY[b];
        if (op >= 15) level = 0;
        else if (op > 0) level = level > op ? level - op : 0;
        sky[base + i] = level;
        if (!seenTop && b !== 0) {
          seenTop = true;
          if (i > maxI) maxI = i;
        }
      }
    }
  }
  const top = Math.min(maxI + 2, HP - 2);

  // 2) スカイライトの横方向への拡散（光の縁からのみ開始）
  let head = 0, tail = 0;
  for (let x = 1; x < RW - 1; x++) {
    for (let z = 1; z < RW - 1; z++) {
      const base = HP * (z + RW * x);
      for (let i = 1; i <= top; i++) {
        const L = sky[base + i];
        if (L < 2) continue;
        const lim = L - 1;
        let push = false;
        let n = base + i + EX;
        if (sky[n] < lim && OPACITY[rb[n]] < 15) push = true;
        else {
          n = base + i - EX;
          if (sky[n] < lim && OPACITY[rb[n]] < 15) push = true;
          else {
            n = base + i + EZ;
            if (sky[n] < lim && OPACITY[rb[n]] < 15) push = true;
            else {
              n = base + i - EZ;
              if (sky[n] < lim && OPACITY[rb[n]] < 15) push = true;
            }
          }
        }
        if (push) {
          queue[tail] = (x << 16) | (z << 8) | i;
          tail = (tail + 1) & QMASK;
        }
      }
    }
  }
  bfs(sky, rb, head, tail);

  // 3) ブロックライト
  head = 0;
  tail = 0;
  for (let x = 0; x < RW; x++) {
    for (let z = 0; z < RW; z++) {
      const base = HP * (z + RW * x);
      for (let i = 1; i <= top; i++) {
        const e = EMIT[rb[base + i]];
        if (e > 0) {
          blk[base + i] = e;
          queue[tail] = (x << 16) | (z << 8) | i;
          tail = (tail + 1) & QMASK;
        }
      }
    }
  }
  if (tail !== head) bfs(blk, rb, head, tail);
}
