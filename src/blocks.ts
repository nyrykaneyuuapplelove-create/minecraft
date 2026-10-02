// ブロック定義。メインスレッドとWorkerで同一の順序で初期化されるため、
// テクスチャ層番号（texIndex）やIDは両者で必ず一致する。

export const Tint = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3, BIRCH: 4, SPRUCE: 5, AUTUMN: 6 } as const;
export const Shape = { CUBE: 0, CROSS: 1, BOX: 2, LIQUID: 3 } as const;
export const Layer = { OPAQUE: 0, CUTOUT: 1, TRANSLUCENT: 2 } as const;

export type SoundKind = "stone" | "grass" | "dirt" | "sand" | "gravel" | "wood" | "glass" | "snow" | "water" | "plant" | "metal";
export type Category = "building" | "natural" | "plants" | "lights" | "ores" | "colors" | "liquids";

/** 0..1 のブロック内座標 [x0,y0,z0,x1,y1,z1] */
export type BoxT = [number, number, number, number, number, number];

export interface BlockDef {
  id: number;
  name: string;
  label: string;
  shape: number;
  layer: number;
  collide: boolean;
  opaque: boolean;
  opacity: number;
  emit: number;
  tint: number;
  sound: SoundKind;
  replaceable: boolean;
  inWater: boolean;
  leaves: boolean;
  top: number;
  bottom: number;
  side: number;
  /** grass_block が雪の下のときに使う側面 */
  sideAlt: number;
  boxes: BoxT[] | null;
  lean: [number, number] | null;
  attach: "none" | "below" | "wall" | "water";
  category: Category | null;
  /** 派生ブロック（壁掛けトーチなど）はインベントリに出さない */
  hidden: boolean;
  /** 手持ち・アイコン用に使う元ブロック名 */
  itemOf: string | null;
}

// ---- テクスチャ層レジストリ ------------------------------------------------
const texNames: string[] = [];
const texMap = new Map<string, number>();
function texIndex(name: string): number {
  let i = texMap.get(name);
  if (i === undefined) {
    i = texNames.length;
    texNames.push(name);
    texMap.set(name, i);
  }
  return i;
}
export const TEXTURE_NAMES = texNames;
export const texLayer = (name: string) => texIndex(name);

// ---- ブロック名一覧（この順番がIDになる。既存IDは変更しないこと） -------------------
const COLORS = ["white", "light_gray", "gray", "black", "brown", "red", "orange", "yellow", "lime", "green", "cyan", "light_blue", "blue", "purple", "magenta", "pink"] as const;

type ConcreteName = `concrete_${(typeof COLORS)[number]}`;
const CONCRETE = COLORS.map((c) => `concrete_${c}`) as ConcreteName[];

const NAMES = [
  "air", "stone", "grass_block", "dirt", "cobblestone", "sand", "gravel", "water", "lava", "snow_block", "ice", "bedrock",
  "sandstone", "clay", "podzol", "deepslate", "andesite", "diorite", "granite",
  "coal_ore", "iron_ore", "copper_ore", "gold_ore", "redstone_ore", "lapis_ore", "diamond_ore", "emerald_ore",
  "oak_log", "oak_planks", "oak_leaves", "birch_log", "birch_planks", "birch_leaves",
  "spruce_log", "spruce_planks", "spruce_leaves", "cherry_log", "cherry_planks", "cherry_leaves", "maple_leaves",
  "bricks", "stone_bricks", "mossy_cobblestone", "glass", "glowstone", "sea_lantern",
  "torch", "torch_wall_px", "torch_wall_nx", "torch_wall_pz", "torch_wall_nz", "lantern",
  "snow_layer", "cactus", "moss_block", "pumpkin", "obsidian",
  "grass", "tall_grass_lo", "tall_grass_hi", "fern", "dandelion", "poppy", "blue_orchid", "allium", "azure_bluet",
  "red_tulip", "orange_tulip", "white_tulip", "pink_tulip", "oxeye_daisy", "cornflower", "lily_of_the_valley",
  "dead_bush", "sugar_cane", "lily_pad", "brown_mushroom", "red_mushroom", "seagrass", "kelp",
  ...CONCRETE,
  "pink_petals", "mud", "red_sand", "calcite",
  "lacquer_red", "lacquer_black", "paper_lantern", "bamboo", "bamboo_leaves",
] as const;

type Names = (typeof NAMES)[number];
export const B = Object.fromEntries(NAMES.map((n, i) => [n.toUpperCase(), i])) as Record<Uppercase<Names>, number>;

export const BLOCKS: BlockDef[] = [];
const byName = new Map<string, BlockDef>();

interface Opts {
  tex?: string | [string, string, string];
  shape?: number;
  layer?: number;
  collide?: boolean;
  opaque?: boolean;
  opacity?: number;
  emit?: number;
  tint?: number;
  sound?: SoundKind;
  replaceable?: boolean;
  inWater?: boolean;
  leaves?: boolean;
  sideAlt?: string;
  boxes?: BoxT[];
  lean?: [number, number];
  attach?: BlockDef["attach"];
  cat?: Category;
  hidden?: boolean;
  itemOf?: string;
}

function def(name: Names, label: string, o: Opts = {}) {
  const id = B[name.toUpperCase() as Uppercase<Names>];
  const shape = o.shape ?? Shape.CUBE;
  const t = o.tex ?? name;
  const [top, bottom, side] = typeof t === "string" ? [t, t, t] : t;
  const opaqueCube = shape === Shape.CUBE && (o.layer ?? Layer.OPAQUE) === Layer.OPAQUE;
  const d: BlockDef = {
    id,
    name,
    label,
    shape,
    layer: o.layer ?? Layer.OPAQUE,
    collide: o.collide ?? (shape === Shape.CUBE),
    opaque: o.opaque ?? opaqueCube,
    opacity: o.opacity ?? (o.opaque ?? opaqueCube ? 15 : 0),
    emit: o.emit ?? 0,
    tint: o.tint ?? Tint.NONE,
    sound: o.sound ?? "stone",
    replaceable: o.replaceable ?? false,
    inWater: o.inWater ?? false,
    leaves: o.leaves ?? false,
    top: texIndex(top),
    bottom: texIndex(bottom),
    side: texIndex(side),
    sideAlt: o.sideAlt ? texIndex(o.sideAlt) : texIndex(side),
    boxes: o.boxes ?? null,
    lean: o.lean ?? null,
    attach: o.attach ?? "none",
    category: o.cat ?? null,
    hidden: o.hidden ?? false,
    itemOf: o.itemOf ?? null,
  };
  BLOCKS[id] = d;
  byName.set(name, d);
}

const px = (a: number[]): BoxT => [a[0] / 16, a[1] / 16, a[2] / 16, a[3] / 16, a[4] / 16, a[5] / 16];

// --- 空気
def("air", "空気", { shape: Shape.CUBE, collide: false, opaque: false, opacity: 0, replaceable: true, hidden: true });

// --- 地形
def("stone", "石", { sound: "stone", cat: "natural" });
def("grass_block", "草ブロック", { tex: ["grass_top", "dirt", "grass_side"], tint: Tint.GRASS, sound: "grass", sideAlt: "grass_side_snow", cat: "natural" });
def("dirt", "土", { sound: "dirt", cat: "natural" });
def("cobblestone", "丸石", { cat: "building" });
def("sand", "砂", { sound: "sand", cat: "natural" });
def("gravel", "砂利", { sound: "gravel", cat: "natural" });
def("water", "水", { shape: Shape.LIQUID, layer: Layer.TRANSLUCENT, collide: false, opaque: false, opacity: 1, tint: Tint.WATER, sound: "water", replaceable: true, cat: "liquids" });
def("lava", "溶岩", { shape: Shape.LIQUID, layer: Layer.OPAQUE, collide: false, opaque: false, opacity: 1, emit: 15, sound: "stone", replaceable: true, cat: "liquids" });
def("snow_block", "雪ブロック", { sound: "snow", cat: "natural" });
def("ice", "氷", { layer: Layer.TRANSLUCENT, opaque: false, opacity: 1, sound: "glass", cat: "natural" });
def("bedrock", "岩盤", { cat: "natural" });
def("sandstone", "砂岩", { tex: ["sandstone_top", "sandstone_bottom", "sandstone"], sound: "stone", cat: "natural" });
def("clay", "粘土", { sound: "dirt", cat: "natural" });
def("podzol", "ポドゾル", { tex: ["podzol_top", "dirt", "podzol_side"], sound: "dirt", cat: "natural" });
def("deepslate", "深層岩", { tex: ["deepslate_top", "deepslate_top", "deepslate"], cat: "natural" });
def("andesite", "安山岩", { cat: "natural" });
def("diorite", "閃緑岩", { cat: "natural" });
def("granite", "花崗岩", { cat: "natural" });

// --- 鉱石
for (const [n, l] of [["coal_ore", "石炭鉱石"], ["iron_ore", "鉄鉱石"], ["copper_ore", "銅鉱石"], ["gold_ore", "金鉱石"], ["redstone_ore", "レッドストーン鉱石"], ["lapis_ore", "ラピスラズリ鉱石"], ["diamond_ore", "ダイヤモンド鉱石"], ["emerald_ore", "エメラルド鉱石"]] as const) {
  def(n, l, { cat: "ores" });
}

// --- 木材
const woods: [string, string, string][] = [["oak", "オーク", "oak"], ["birch", "シラカバ", "birch"], ["spruce", "トウヒ", "spruce"], ["cherry", "サクラ", "cherry"]];
for (const [w, jp] of woods) {
  def(`${w}_log` as Names, `${jp}の原木`, { tex: [`${w}_log_top`, `${w}_log_top`, `${w}_log`], sound: "wood", cat: "building" });
  def(`${w}_planks` as Names, `${jp}の板材`, { sound: "wood", cat: "building" });
}
const leaf = { layer: Layer.CUTOUT, opaque: false, opacity: 1, sound: "grass" as SoundKind, leaves: true, cat: "natural" as Category };
def("oak_leaves", "オークの葉", { ...leaf, tint: Tint.FOLIAGE });
def("birch_leaves", "シラカバの葉", { ...leaf, tint: Tint.BIRCH });
def("spruce_leaves", "トウヒの葉", { ...leaf, tint: Tint.SPRUCE });
def("cherry_leaves", "サクラの葉", { ...leaf });
def("maple_leaves", "カエデの葉", { ...leaf, tex: "oak_leaves", tint: Tint.AUTUMN });

// --- 建材
def("bricks", "レンガ", { cat: "building" });
def("stone_bricks", "石レンガ", { cat: "building" });
def("mossy_cobblestone", "苔むした丸石", { cat: "building" });
def("glass", "ガラス", { layer: Layer.TRANSLUCENT, opaque: false, opacity: 0, sound: "glass", cat: "building" });
def("obsidian", "黒曜石", { cat: "building" });
def("calcite", "方解石", { cat: "building" });

// --- 光源
def("glowstone", "グロウストーン", { emit: 15, sound: "glass", cat: "lights" });
def("sea_lantern", "シーランタン", { emit: 15, sound: "glass", cat: "lights" });
const torchBox: BoxT = px([7, 0, 7, 9, 10, 9]);
def("torch", "松明", { shape: Shape.BOX, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, emit: 14, sound: "wood", boxes: [torchBox], attach: "below", cat: "lights" });
// 壁掛け松明：px = +X側に壁がある
const wallTorch = (n: Names, wx: number, wz: number) =>
  def(n, "松明", {
    tex: "torch", shape: Shape.BOX, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, emit: 14, sound: "wood", attach: "wall", hidden: true, itemOf: "torch",
    boxes: [[7 / 16 + wx * 0.34, 3 / 16, 7 / 16 + wz * 0.34, 9 / 16 + wx * 0.34, 13 / 16, 9 / 16 + wz * 0.34]],
    lean: [-wx * 0.3, -wz * 0.3],
  });
wallTorch("torch_wall_px", 1, 0);
wallTorch("torch_wall_nx", -1, 0);
wallTorch("torch_wall_pz", 0, 1);
wallTorch("torch_wall_nz", 0, -1);
def("lantern", "ランタン", { shape: Shape.BOX, layer: Layer.OPAQUE, collide: true, opaque: false, opacity: 0, emit: 15, sound: "metal", boxes: [px([5, 0, 5, 11, 7, 11]), px([6, 7, 6, 10, 9, 10])], attach: "below", cat: "lights" });

// --- 自然物
def("snow_layer", "雪", { shape: Shape.BOX, layer: Layer.OPAQUE, collide: false, opaque: false, opacity: 0, sound: "snow", replaceable: true, tex: "snow_block", boxes: [px([0, 0, 0, 16, 2, 16])], attach: "below", cat: "natural" });
def("cactus", "サボテン", { shape: Shape.BOX, layer: Layer.OPAQUE, collide: true, opaque: false, opacity: 0, sound: "plant", tex: ["cactus_top", "cactus_top", "cactus_side"], boxes: [px([1, 0, 1, 15, 16, 15])], attach: "below", cat: "plants" });
def("moss_block", "苔ブロック", { sound: "grass", cat: "natural" });
def("pumpkin", "カボチャ", { tex: ["pumpkin_top", "pumpkin_top", "pumpkin_side"], sound: "wood", cat: "natural" });
def("mud", "泥", { sound: "dirt", cat: "natural" });
def("red_sand", "赤い砂", { sound: "sand", cat: "natural" });

// --- 植物
const plant = { shape: Shape.CROSS, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, sound: "plant" as SoundKind, attach: "below" as const, cat: "plants" as Category };
def("grass", "草", { ...plant, tint: Tint.GRASS, replaceable: true });
def("tall_grass_lo", "背の高い草", { ...plant, tint: Tint.GRASS, replaceable: true, hidden: true, itemOf: "grass" });
def("tall_grass_hi", "背の高い草", { ...plant, tint: Tint.GRASS, replaceable: true, hidden: true, itemOf: "grass", attach: "none" });
def("fern", "シダ", { ...plant, tint: Tint.GRASS, replaceable: true });
for (const [n, l] of [["dandelion", "タンポポ"], ["poppy", "ポピー"], ["blue_orchid", "ヒスイラン"], ["allium", "アリウム"], ["azure_bluet", "ヒナソウ"], ["red_tulip", "赤いチューリップ"], ["orange_tulip", "橙のチューリップ"], ["white_tulip", "白いチューリップ"], ["pink_tulip", "ピンクのチューリップ"], ["oxeye_daisy", "フランスギク"], ["cornflower", "ヤグルマギク"], ["lily_of_the_valley", "スズラン"]] as const) {
  def(n, l, { ...plant });
}
def("dead_bush", "枯れ木", { ...plant, replaceable: true });
def("sugar_cane", "サトウキビ", { ...plant, tint: Tint.GRASS });
def("brown_mushroom", "茶色のキノコ", { ...plant });
def("red_mushroom", "赤いキノコ", { ...plant });
def("seagrass", "海草", { ...plant, inWater: true, attach: "water", replaceable: true });
def("kelp", "コンブ", { ...plant, inWater: true, attach: "water" });
def("lily_pad", "スイレンの葉", { shape: Shape.BOX, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, sound: "plant", boxes: [[1 / 16, -2 / 16, 1 / 16, 15 / 16, -0.5 / 16, 15 / 16]], attach: "water", cat: "plants" });
def("pink_petals", "ピンクの花びら", { shape: Shape.BOX, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, sound: "plant", boxes: [px([0, 0, 0, 16, 1.5, 16])], attach: "below", replaceable: true, cat: "plants" });

// --- 和の素材
def("lacquer_red", "朱塗りの木材", { sound: "wood", cat: "building" });
def("lacquer_black", "黒漆の木材", { sound: "wood", cat: "building" });
def("paper_lantern", "提灯", { emit: 14, sound: "wood", cat: "lights" });
def("bamboo", "竹", { shape: Shape.BOX, layer: Layer.OPAQUE, collide: false, opaque: false, opacity: 0, sound: "wood", boxes: [[6.5 / 16, 0, 6.5 / 16, 9.5 / 16, 1, 9.5 / 16]], attach: "below", cat: "plants" });
def("bamboo_leaves", "笹の葉", { shape: Shape.CROSS, layer: Layer.CUTOUT, collide: false, opaque: false, opacity: 0, sound: "plant", tint: Tint.FOLIAGE, attach: "none", cat: "plants" });

// --- カラーブロック
for (const c of COLORS) def(`concrete_${c}` as Names, "コンクリート", { cat: "colors", sound: "stone" });
export const COLOR_LABELS: Record<(typeof COLORS)[number], string> = {
  white: "白", light_gray: "薄灰", gray: "灰", black: "黒", brown: "茶", red: "赤", orange: "橙", yellow: "黄", lime: "黄緑", green: "緑", cyan: "水", light_blue: "空", blue: "青", purple: "紫", magenta: "赤紫", pink: "桃",
};
for (const c of COLORS) BLOCKS[B[`CONCRETE_${c.toUpperCase()}` as keyof typeof B]].label = `${COLOR_LABELS[c]}のコンクリート`;

export const BLOCK_BY_NAME = byName;

// ---- 高速参照用の型付き配列 ----------------------------------------------------
const N = 256;
export const OPACITY = new Uint8Array(N); // 光の減衰
export const EMIT = new Uint8Array(N);
export const OPAQUE = new Uint8Array(N); // 面を完全に隠す立方体
export const SHAPE = new Uint8Array(N);
export const LAYER = new Uint8Array(N);
export const TEX_TOP = new Uint8Array(N);
export const TEX_BOTTOM = new Uint8Array(N);
export const TEX_SIDE = new Uint8Array(N);
export const TEX_SIDE_ALT = new Uint8Array(N);
export const TINT = new Uint8Array(N);
export const COLLIDE = new Uint8Array(N);
export const IN_WATER = new Uint8Array(N);
export const IS_LEAVES = new Uint8Array(N);
export const IS_LIQUID = new Uint8Array(N);
export const REPLACEABLE = new Uint8Array(N);
/** AOで遮蔽物として扱うか */
export const AO_OCC = new Uint8Array(N);
for (const b of BLOCKS) {
  if (!b) continue;
  OPACITY[b.id] = b.opacity;
  EMIT[b.id] = b.emit;
  OPAQUE[b.id] = b.opaque ? 1 : 0;
  SHAPE[b.id] = b.shape;
  LAYER[b.id] = b.layer;
  TEX_TOP[b.id] = b.top;
  TEX_BOTTOM[b.id] = b.bottom;
  TEX_SIDE[b.id] = b.side;
  TEX_SIDE_ALT[b.id] = b.sideAlt;
  TINT[b.id] = b.tint;
  COLLIDE[b.id] = b.collide ? 1 : 0;
  IN_WATER[b.id] = b.inWater ? 1 : 0;
  IS_LEAVES[b.id] = b.leaves ? 1 : 0;
  IS_LIQUID[b.id] = b.shape === Shape.LIQUID ? 1 : 0;
  REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
  AO_OCC[b.id] = b.opaque ? 1 : 0;
}
// 水と同じ扱いにしたいブロック
export const isWaterLike = (id: number) => id === B.WATER || IN_WATER[id] === 1;

export const CATEGORIES: { key: Category; label: string }[] = [
  { key: "natural", label: "自然" },
  { key: "building", label: "建築" },
  { key: "plants", label: "植物" },
  { key: "lights", label: "光源" },
  { key: "ores", label: "鉱石" },
  { key: "colors", label: "色" },
  { key: "liquids", label: "液体" },
];

/** 衝突判定ボックス（ブロック内 0..1）。当たり判定なしは null */
export function collisionBoxes(id: number): BoxT[] | null {
  const b = BLOCKS[id];
  if (!b || !b.collide) return null;
  if (b.shape === Shape.BOX && b.boxes) return b.boxes;
  return FULL;
}
const FULL: BoxT[] = [[0, 0, 0, 1, 1, 1]];

/** 選択（レイキャスト）用ボックス */
export function selectionBoxes(id: number): BoxT[] {
  const b = BLOCKS[id];
  if (!b) return FULL;
  if (b.shape === Shape.CROSS) return [[0.15, 0, 0.15, 0.85, id === B.TALL_GRASS_HI ? 0.7 : 0.9, 0.85]];
  if (b.shape === Shape.BOX && b.boxes) return b.boxes.map((x) => [x[0], Math.max(0, x[1]), x[2], x[3], Math.max(x[4], 0.05), x[5]] as BoxT);
  return FULL;
}
