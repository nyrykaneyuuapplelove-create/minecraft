// 遠景（LOD）地形のメッシュを作るWorker。ロード済みチャンクの外側を、粗い格子で埋める。
import { WorldGen } from "./worldgen";
import { Biome } from "./biomes";
import { SEA_LEVEL } from "./config";
import { hash2 } from "./noise";

interface Ctx {
  postMessage(m: unknown, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const ctx = self as unknown as Ctx;
let gen: WorldGen | null = null;
let seed = 0;

type RGB = [number, number, number];
const PAL: Record<number, { c: RGB; bump: number }> = {
  [Biome.PLAINS]: { c: [112, 172, 70], bump: 0 },
  [Biome.MEADOW]: { c: [108, 176, 78], bump: 0 },
  [Biome.FOREST]: { c: [58, 116, 44], bump: 5 },
  [Biome.BIRCH_FOREST]: { c: [86, 138, 60], bump: 4 },
  [Biome.AUTUMN_FOREST]: { c: [178, 96, 38], bump: 5 },
  [Biome.CHERRY_GROVE]: { c: [232, 150, 190], bump: 5 },
  [Biome.BAMBOO_GROVE]: { c: [92, 164, 58], bump: 7 },
  [Biome.TAIGA]: { c: [44, 88, 60], bump: 6 },
  [Biome.SNOWY_PLAINS]: { c: [236, 242, 246], bump: 0 },
  [Biome.SNOWY_TAIGA]: { c: [196, 214, 220], bump: 6 },
  [Biome.DESERT]: { c: [226, 202, 132], bump: 0 },
  [Biome.SAVANNA]: { c: [172, 164, 72], bump: 2 },
  [Biome.SWAMP]: { c: [70, 92, 52], bump: 3 },
  [Biome.MOUNTAINS]: { c: [124, 124, 130], bump: 0 },
  [Biome.SNOWY_PEAKS]: { c: [242, 247, 250], bump: 0 },
  [Biome.BEACH]: { c: [226, 214, 162], bump: 0 },
};
const WATER_SHALLOW: RGB = [70, 170, 200];
const WATER_DEEP: RGB = [24, 58, 130];

function build(cx: number, cz: number) {
  const g = gen!;
  const rings = [
    { step: 8, half: 640 },
    { step: 32, half: 2240 },
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const flag: number[] = [];
  const idx: number[] = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const { step, half } = rings[ri];
    const x0 = Math.floor((cx - half) / step) * step, z0 = Math.floor((cz - half) / step) * step;
    const n = Math.floor((half * 2) / step) + 1;
    const H = new Float32Array(n * n);
    const C = new Uint8Array(n * n * 3);
    const W = new Uint8Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const x = x0 + i * step, z = z0 + j * step;
        const c = g.columnInfo(x, z);
        const k = i * n + j;
        let h = c.height + 1;
        let rgb: RGB;
        if (c.height < SEA_LEVEL - 0.5) {
          const d = Math.min(1, (SEA_LEVEL - c.height) / 26);
          rgb = [
            WATER_SHALLOW[0] + (WATER_DEEP[0] - WATER_SHALLOW[0]) * d,
            WATER_SHALLOW[1] + (WATER_DEEP[1] - WATER_SHALLOW[1]) * d,
            WATER_SHALLOW[2] + (WATER_DEEP[2] - WATER_SHALLOW[2]) * d,
          ];
          h = SEA_LEVEL + 0.875;
          W[k] = 1;
        } else {
          const p = PAL[c.biome] ?? PAL[Biome.PLAINS];
          const nz = hash2(Math.floor(x / step), Math.floor(z / step), seed + 99);
          rgb = [p.c[0], p.c[1], p.c[2]];
          if (p.bump) h += p.bump * (0.5 + nz * 0.7);
          // 標高による雪線と、山肌の岩
          if (c.height > 100 + (nz - 0.5) * 10 && c.biome !== Biome.DESERT) rgb = [238, 244, 248];
          else if (c.mount > 0.5 && c.height > 88) rgb = [126, 126, 134];
          const v = 0.9 + nz * 0.2;
          rgb = [rgb[0] * v, rgb[1] * v, rgb[2] * v];
        }
        H[k] = h;
        C[k * 3] = rgb[0]; C[k * 3 + 1] = rgb[1]; C[k * 3 + 2] = rgb[2];
      }
    }
    const base = pos.length / 3;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const k = i * n + j;
        pos.push(x0 + i * step, H[k], z0 + j * step);
        col.push(C[k * 3], C[k * 3 + 1], C[k * 3 + 2]);
        flag.push(W[k]);
      }
    for (let i = 0; i < n - 1; i++)
      for (let j = 0; j < n - 1; j++) {
        const mx = x0 + (i + 0.5) * step - cx, mz = z0 + (j + 0.5) * step - cz;
        // 外側のリングが内側のリングと重なる部分は作らない
        if (ri === 1 && Math.abs(mx) < rings[0].half - step * 2 && Math.abs(mz) < rings[0].half - step * 2) continue;
        const a = base + i * n + j, b = base + (i + 1) * n + j, c2 = base + (i + 1) * n + j + 1, d2 = base + i * n + j + 1;
        idx.push(a, d2, b, b, d2, c2);
      }
  }
  return { pos: new Float32Array(pos), col: new Uint8Array(col), flag: new Uint8Array(flag), idx: new Uint32Array(idx) };
}

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.type === "init") {
    seed = m.seed;
    gen = new WorldGen(m.seed);
  } else if (m.type === "build") {
    const t0 = performance.now();
    const r = build(m.cx, m.cz);
    ctx.postMessage({ type: "lod", id: m.id, cx: m.cx, cz: m.cz, hole: m.hole, ms: performance.now() - t0, ...r }, [r.pos.buffer, r.col.buffer, r.flag.buffer, r.idx.buffer]);
  }
};
