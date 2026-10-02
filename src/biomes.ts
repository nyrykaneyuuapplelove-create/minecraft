// バイオーム定義と、気候に応じた草・葉・水の色。

export const Biome = {
  OCEAN: 0, DEEP_OCEAN: 1, FROZEN_OCEAN: 2, WARM_OCEAN: 3, BEACH: 4, RIVER: 5, FROZEN_RIVER: 6,
  PLAINS: 7, MEADOW: 8, FOREST: 9, BIRCH_FOREST: 10, AUTUMN_FOREST: 11, CHERRY_GROVE: 12,
  TAIGA: 13, SNOWY_PLAINS: 14, SNOWY_TAIGA: 15, DESERT: 16, SAVANNA: 17, SWAMP: 18,
  MOUNTAINS: 19, SNOWY_PEAKS: 20, BAMBOO_GROVE: 21,
} as const;

export const BIOME_LABEL: string[] = [];
const L = (id: number, name: string) => (BIOME_LABEL[id] = name);
L(Biome.OCEAN, "海"); L(Biome.DEEP_OCEAN, "深海"); L(Biome.FROZEN_OCEAN, "凍った海"); L(Biome.WARM_OCEAN, "温かい海");
L(Biome.BEACH, "砂浜"); L(Biome.RIVER, "川"); L(Biome.FROZEN_RIVER, "凍った川");
L(Biome.PLAINS, "平原"); L(Biome.MEADOW, "花の草原"); L(Biome.FOREST, "森"); L(Biome.BIRCH_FOREST, "シラカバの森");
L(Biome.AUTUMN_FOREST, "紅葉の森"); L(Biome.CHERRY_GROVE, "桜の丘"); L(Biome.TAIGA, "タイガ");
L(Biome.SNOWY_PLAINS, "雪原"); L(Biome.SNOWY_TAIGA, "雪のタイガ"); L(Biome.DESERT, "砂漠"); L(Biome.SAVANNA, "サバンナ");
L(Biome.SWAMP, "湿地"); L(Biome.MOUNTAINS, "山岳"); L(Biome.SNOWY_PEAKS, "雪山"); L(Biome.BAMBOO_GROVE, "竹林");

export const isOceanBiome = (b: number) => b <= Biome.WARM_OCEAN;
export const isWaterBiome = (b: number) => b <= Biome.WARM_OCEAN || b === Biome.RIVER || b === Biome.FROZEN_RIVER;
export const isColdBiome = (b: number) => b === Biome.SNOWY_PLAINS || b === Biome.SNOWY_TAIGA || b === Biome.SNOWY_PEAKS || b === Biome.FROZEN_OCEAN || b === Biome.FROZEN_RIVER;

type RGB = [number, number, number];
const GRASS: Record<number, RGB> = {
  [Biome.PLAINS]: [0.55, 0.77, 0.32],
  [Biome.MEADOW]: [0.48, 0.82, 0.36],
  [Biome.FOREST]: [0.43, 0.72, 0.26],
  [Biome.BIRCH_FOREST]: [0.5, 0.75, 0.31],
  [Biome.AUTUMN_FOREST]: [0.77, 0.67, 0.25],
  [Biome.CHERRY_GROVE]: [0.6, 0.86, 0.48],
  [Biome.TAIGA]: [0.4, 0.66, 0.42],
  [Biome.SNOWY_PLAINS]: [0.5, 0.69, 0.6],
  [Biome.SNOWY_TAIGA]: [0.46, 0.66, 0.56],
  [Biome.DESERT]: [0.76, 0.72, 0.35],
  [Biome.SAVANNA]: [0.72, 0.72, 0.3],
  [Biome.SWAMP]: [0.37, 0.45, 0.25],
  [Biome.MOUNTAINS]: [0.5, 0.69, 0.42],
  [Biome.SNOWY_PEAKS]: [0.5, 0.69, 0.6],
  [Biome.BEACH]: [0.55, 0.77, 0.34],
  [Biome.RIVER]: [0.52, 0.76, 0.34],
  [Biome.BAMBOO_GROVE]: [0.42, 0.78, 0.3],
};
const FOLIAGE: Record<number, RGB> = {
  [Biome.PLAINS]: [0.42, 0.68, 0.24],
  [Biome.MEADOW]: [0.4, 0.72, 0.28],
  [Biome.FOREST]: [0.34, 0.62, 0.2],
  [Biome.BIRCH_FOREST]: [0.44, 0.68, 0.26],
  [Biome.AUTUMN_FOREST]: [0.7, 0.55, 0.2],
  [Biome.CHERRY_GROVE]: [0.45, 0.72, 0.34],
  [Biome.TAIGA]: [0.32, 0.55, 0.34],
  [Biome.SNOWY_PLAINS]: [0.4, 0.6, 0.5],
  [Biome.SNOWY_TAIGA]: [0.36, 0.56, 0.46],
  [Biome.DESERT]: [0.68, 0.66, 0.3],
  [Biome.SAVANNA]: [0.64, 0.66, 0.26],
  [Biome.SWAMP]: [0.34, 0.42, 0.22],
  [Biome.MOUNTAINS]: [0.4, 0.62, 0.34],
  [Biome.SNOWY_PEAKS]: [0.4, 0.6, 0.5],
  [Biome.BAMBOO_GROVE]: [0.36, 0.72, 0.26],
};
const WATER: Record<number, RGB> = {
  [Biome.OCEAN]: [0.2, 0.42, 0.86],
  [Biome.DEEP_OCEAN]: [0.16, 0.34, 0.8],
  [Biome.FROZEN_OCEAN]: [0.24, 0.36, 0.78],
  [Biome.WARM_OCEAN]: [0.08, 0.7, 0.82],
  [Biome.RIVER]: [0.22, 0.48, 0.88],
  [Biome.FROZEN_RIVER]: [0.26, 0.4, 0.8],
  [Biome.SWAMP]: [0.36, 0.46, 0.3],
  [Biome.BEACH]: [0.14, 0.58, 0.84],
  [Biome.CHERRY_GROVE]: [0.3, 0.55, 0.92],
};
const DEF_GRASS: RGB = [0.5, 0.74, 0.32];
const DEF_FOLIAGE: RGB = [0.4, 0.65, 0.25];
const DEF_WATER: RGB = [0.22, 0.45, 0.88];

/**
 * 気候から草・葉・水の色（sRGB）を求める。
 * temp / humid は 0..255（-1..1 を写像したもの）。
 */
export function biomeColors(biome: number, temp: number, humid: number, out: Float32Array, o = 0) {
  const g = GRASS[biome] ?? DEF_GRASS;
  const f = FOLIAGE[biome] ?? DEF_FOLIAGE;
  const w = WATER[biome] ?? DEF_WATER;
  const t = temp / 127.5 - 1;
  const h = humid / 127.5 - 1;
  // 乾燥すると黄ばみ、湿ると深緑に寄る
  const dry = Math.max(0, -h) * 0.25;
  const wet = Math.max(0, h) * 0.12;
  out[o + 0] = g[0] + dry * 0.18 - wet * 0.1;
  out[o + 1] = g[1] - dry * 0.06 - wet * 0.02;
  out[o + 2] = g[2] - dry * 0.1 + t * 0.02;
  out[o + 3] = f[0] + dry * 0.16 - wet * 0.08;
  out[o + 4] = f[1] - dry * 0.05;
  out[o + 5] = f[2] - dry * 0.08;
  out[o + 6] = w[0];
  out[o + 7] = w[1];
  out[o + 8] = w[2];
}
