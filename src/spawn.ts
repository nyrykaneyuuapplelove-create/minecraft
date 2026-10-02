import { SEA_LEVEL } from "./config";
import { Biome } from "./biomes";
import type { WorldGen } from "./worldgen";

const GOOD = new Set<number>([Biome.PLAINS, Biome.MEADOW, Biome.FOREST, Biome.BIRCH_FOREST, Biome.AUTUMN_FOREST, Biome.CHERRY_GROVE, Biome.TAIGA]);

/** 原点から螺旋状に探し、景色のよい陸地のスポーン地点を返す */
export function findSpawn(gen: WorldGen): { x: number; z: number; y: number; biome: number } {
  const isGood = (x: number, z: number) => {
    const c = gen.columnInfo(x, z);
    return c.height >= SEA_LEVEL + 2 && c.height <= 92 && GOOD.has(c.biome);
  };
  const land = (x: number, z: number) => gen.columnInfo(x, z).height >= SEA_LEVEL;
  for (let r = 0; r <= 4000; r += 20) {
    const n = Math.max(1, Math.floor((r * 2 * Math.PI) / 30));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
      if (!isGood(x, z)) continue;
      if (!land(x + 40, z) || !land(x - 40, z) || !land(x, z + 40) || !land(x, z - 40)) continue;
      const c = gen.columnInfo(x, z);
      return { x, z, y: c.height + 1, biome: c.biome };
    }
  }
  const c = gen.columnInfo(0, 0);
  return { x: 0, z: 0, y: Math.max(c.height, SEA_LEVEL) + 1, biome: c.biome };
}
