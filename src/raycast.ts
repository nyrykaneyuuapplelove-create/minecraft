// ボクセルレイキャスト（Amanatides–Woo）。選択ボックスが部分的なブロックは厳密に判定する。
import { B, IS_LIQUID, selectionBoxes } from "./blocks";
import type { World } from "./world";

export interface Hit {
  x: number;
  y: number;
  z: number;
  id: number;
  nx: number;
  ny: number;
  nz: number;
  t: number;
  px: number;
  py: number;
  pz: number;
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: number[], bx: number, by: number, bz: number, maxT: number) {
  let tmin = 0, tmax = maxT;
  let nx = 0, ny = 0, nz = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const lo = [bx + b[0], by + b[1], bz + b[2]], hi = [bx + b[3], by + b[4], bz + b[5]];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return null;
    } else {
      let t1 = (lo[a] - o[a]) / d[a], t2 = (hi[a] - o[a]) / d[a];
      let sign = -1;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = ny = nz = 0;
        if (a === 0) nx = sign; else if (a === 1) ny = sign; else nz = sign;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  return { t: tmin, nx, ny, nz };
}

export function raycast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number, includeLiquid = false): Hit | null {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let t = 0;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < 200; i++) {
    const id = world.getBlock(x, y, z);
    if (id > 0 && (includeLiquid || !IS_LIQUID[id])) {
      const boxes = selectionBoxes(id);
      let best: { t: number; nx: number; ny: number; nz: number } | null = null;
      for (const bx of boxes) {
        const r = rayBox(ox, oy, oz, dx, dy, dz, bx, x, y, z, maxDist);
        if (r && (!best || r.t < best.t)) best = r;
      }
      if (best && best.t <= maxDist) {
        // 箱の中から始まった場合は進入面 (nx,ny,nz) を DDA の値で補う
        const hn = best.nx || best.ny || best.nz ? best : { t: best.t, nx, ny, nz };
        return { x, y, z, id, nx: hn.nx, ny: hn.ny, nz: hn.nz, t: hn.t, px: ox + dx * hn.t, py: oy + dy * hn.t, pz: oz + dz * hn.t };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX; x += stepX; tMaxX += tDeltaX; nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY; y += stepY; tMaxY += tDeltaY; nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ; z += stepZ; tMaxZ += tDeltaZ; nx = 0; ny = 0; nz = -stepZ;
    }
    if (t > maxDist) break;
  }
  return null;
}
export { B };
