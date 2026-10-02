// ワールド共通の定数。メインスレッドとWorkerの両方から使う。
export const CHUNK = 16;
export const WORLD_H = 160;
export const SEA_LEVEL = 56;

/** チャンク内ブロックの添字（y が最速で変化する列優先レイアウト） */
export const cidx = (x: number, y: number, z: number) => y + WORLD_H * (z + CHUNK * x);
export const CHUNK_BLOCKS = CHUNK * CHUNK * WORLD_H;

/** 1ブロック列あたりの気候データ（biome, temp, humid）のバイト数 */
export const CLIMATE_STRIDE = 3;
export const climateIdx = (x: number, z: number) => (x * CHUNK + z) * CLIMATE_STRIDE;

export const chunkKey = (cx: number, cz: number) => ((cx + 0x8000) << 16) | ((cz + 0x8000) & 0xffff);
