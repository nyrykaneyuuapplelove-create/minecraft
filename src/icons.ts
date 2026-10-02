// インベントリ/ホットバー用のブロックアイコン（タイルのキャンバスからアイソメ描画）
import { BLOCKS, Shape, Tint, type BlockDef } from "./blocks";
import { TEX, type TextureSet } from "./textures";

const TINTS: Record<number, [number, number, number]> = {
  [Tint.GRASS]: [140, 196, 82],
  [Tint.FOLIAGE]: [87, 158, 51],
  [Tint.BIRCH]: [128, 167, 85],
  [Tint.SPRUCE]: [97, 153, 97],
  [Tint.AUTUMN]: [217, 120, 30],
  [Tint.WATER]: [51, 107, 219],
};

function tinted(tex: TextureSet, layer: number, tint: number): HTMLCanvasElement {
  const src = tex.tiles[layer];
  const rgb = TINTS[tint];
  if (!rgb) return src;
  const cv = document.createElement("canvas");
  cv.width = cv.height = TEX;
  const ctx = cv.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const id = ctx.getImageData(0, 0, TEX, TEX);
  const m = tex.masks[layer];
  for (let i = 0; i < TEX * TEX; i++) {
    const k = m[i * 4] / 255;
    id.data[i * 4] = id.data[i * 4] * (1 - k + (k * rgb[0]) / 255);
    id.data[i * 4 + 1] = id.data[i * 4 + 1] * (1 - k + (k * rgb[1]) / 255);
    id.data[i * 4 + 2] = id.data[i * 4 + 2] * (1 - k + (k * rgb[2]) / 255);
  }
  ctx.putImageData(id, 0, 0);
  return cv;
}

export function makeIcon(def: BlockDef, tex: TextureSet, size = 64): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const sprite = (layer: number, scale = 0.86) => {
    const c = tinted(tex, layer, def.tint);
    const s = size * scale;
    ctx.drawImage(c, (size - s) / 2, (size - s) / 2 + size * 0.02, s, s);
  };
  if (def.shape === Shape.CROSS || def.name === "torch" || def.name === "lily_pad" || def.name === "pink_petals" || def.name === "lantern" || def.name === "bamboo") {
    sprite(def.side, def.name === "torch" ? 1.0 : 0.9);
    return cv;
  }
  const L = size * 0.47;
  const cx = size / 2, cy = size / 2;
  const u = [0.866 * L, 0.5 * L], v = [-0.866 * L, 0.5 * L], h = L;
  const T = [cx, cy - L];
  const top = tinted(tex, def.top, def.tint);
  const side = tinted(tex, def.side, def.tint);
  const topC = def.shape === Shape.LIQUID ? top : top;
  // 上面
  ctx.save();
  ctx.setTransform(u[0] / TEX, u[1] / TEX, v[0] / TEX, v[1] / TEX, T[0], T[1]);
  ctx.drawImage(topC, 0, 0);
  ctx.restore();
  // 左面
  const Lf = [T[0] + v[0], T[1] + v[1]];
  ctx.save();
  ctx.setTransform(u[0] / TEX, u[1] / TEX, 0, h / TEX, Lf[0], Lf[1]);
  ctx.drawImage(side, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.moveTo(Lf[0], Lf[1]); ctx.lineTo(Lf[0] + u[0], Lf[1] + u[1]); ctx.lineTo(Lf[0] + u[0], Lf[1] + u[1] + h); ctx.lineTo(Lf[0], Lf[1] + h);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  // 右面
  const Bt = [T[0] + u[0] + v[0], T[1] + u[1] + v[1]];
  ctx.save();
  ctx.setTransform(-v[0] / TEX, -v[1] / TEX, 0, h / TEX, Bt[0], Bt[1]);
  ctx.drawImage(side, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.38)";
  ctx.beginPath();
  ctx.moveTo(Bt[0], Bt[1]); ctx.lineTo(Bt[0] - v[0], Bt[1] - v[1]); ctx.lineTo(Bt[0] - v[0], Bt[1] - v[1] + h); ctx.lineTo(Bt[0], Bt[1] + h);
  ctx.closePath(); ctx.fill();
  ctx.restore();
  return cv;
}

export function makeAllIcons(tex: TextureSet, size = 64): Map<number, string> {
  const out = new Map<number, string>();
  for (const b of BLOCKS) {
    if (!b || b.id === 0) continue;
    out.set(b.id, makeIcon(b, tex, size).toDataURL());
  }
  return out;
}
