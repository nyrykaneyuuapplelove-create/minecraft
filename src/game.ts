import * as THREE from "three";
import { CHUNK, SEA_LEVEL, WORLD_H, cidx } from "./config";
import { World } from "./world";
import { WorldGen } from "./worldgen";
import { generateTextures, type TextureSet } from "./textures";
import { Environment, makeCloudTexture, type WeatherKind } from "./render/environment";
import { Sky } from "./render/sky";
import { PostFX } from "./render/post";
import { Shadow } from "./render/shadow";
import { createTerrainMaterials, type TerrainMaterials } from "./render/materials";
import { settings } from "./settings";
import { findSpawn } from "./spawn";
import { Input } from "./input";
import { Player } from "./player";
import { raycast, type Hit } from "./raycast";
import { UI } from "./ui";
import { Hand } from "./hand";
import { Particles } from "./particles";
import { Ambient } from "./ambient";
import { AudioEngine } from "./audio";
import { makeAllIcons } from "./icons";
import { PlayerModel } from "./playerModel";
import { Lod } from "./lod";
import { ChunkStore, loadMeta, saveMeta, clearMeta, type SaveMeta } from "./persistence";
import { B, BLOCKS, BLOCK_BY_NAME, COLLIDE, EMIT, IS_LIQUID, REPLACEABLE, OPAQUE, selectionBoxes, Shape, isWaterLike, SLAB_OF } from "./blocks";
import { Biome, BIOME_LABEL, biomeColors, isColdBiome } from "./biomes";
import { hash2, seedFromString } from "./noise";

type State = "title" | "loading" | "playing" | "paused";

const DEFAULT_HOTBAR = [B.GRASS_BLOCK, B.DIRT, B.STONE_BRICKS, B.OAK_PLANKS, B.GLASS, B.TORCH, B.LANTERN, B.SAND, B.WATER];

const BIOME_ALIASES: Record<string, number> = {
  bamboo: Biome.BAMBOO_GROVE, 竹: Biome.BAMBOO_GROVE, 竹林: Biome.BAMBOO_GROVE,
  cherry: Biome.CHERRY_GROVE, さくら: Biome.CHERRY_GROVE, 桜: Biome.CHERRY_GROVE, 桜の丘: Biome.CHERRY_GROVE,
  autumn: Biome.AUTUMN_FOREST, 紅葉: Biome.AUTUMN_FOREST, 紅葉の森: Biome.AUTUMN_FOREST,
  forest: Biome.FOREST, 森: Biome.FOREST, birch: Biome.BIRCH_FOREST, シラカバ: Biome.BIRCH_FOREST,
  taiga: Biome.TAIGA, タイガ: Biome.TAIGA, snow: Biome.SNOWY_PLAINS, 雪原: Biome.SNOWY_PLAINS, 雪のタイガ: Biome.SNOWY_TAIGA,
  desert: Biome.DESERT, 砂漠: Biome.DESERT, savanna: Biome.SAVANNA, サバンナ: Biome.SAVANNA,
  swamp: Biome.SWAMP, 湿地: Biome.SWAMP, mountains: Biome.MOUNTAINS, 山岳: Biome.MOUNTAINS, peaks: Biome.SNOWY_PEAKS, 雪山: Biome.SNOWY_PEAKS,
  meadow: Biome.MEADOW, 花畑: Biome.MEADOW, 花の草原: Biome.MEADOW, plains: Biome.PLAINS, 平原: Biome.PLAINS,
  ocean: Biome.OCEAN, 海: Biome.OCEAN, beach: Biome.BEACH, 砂浜: Biome.BEACH, river: Biome.RIVER, 川: Biome.RIVER,
};

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  env: Environment;
  sky: Sky;
  post: PostFX;
  shadow: Shadow;
  world!: World;
  mats: TerrainMaterials;
  gen!: WorldGen;
  tex: TextureSet;
  input: Input;
  player!: Player;
  ui: UI;
  hand: Hand;
  particles: Particles;
  ambient: Ambient;
  audio = new AudioEngine();
  store = new ChunkStore();
  seed: number;
  state: State = "title";
  time = 0;
  fps = 60;
  frames = 0;
  spawn = { x: 0, y: 80, z: 0, biome: 0 };
  /** タイトル・デバッグ用のカメラ */
  view = { x: 0, y: 90, z: 0, yaw: 0, pitch: -0.2 };
  hotbar = [...DEFAULT_HOTBAR];
  selected = 0;
  hit: Hit | null = null;
  thirdPerson = 0;
  hudVisible = true;
  debugOn = false;
  private meta: SaveMeta | null;
  private last = 0;
  private tickAcc = 0;
  private breakCd = 0;
  private placeCd = 0;
  private outline: THREE.Mesh;
  private outlineMat: THREE.MeshBasicMaterial;
  private fovCur = 72;
  private shotRequested = false;
  private biomeNow = -1;
  private biomeCandidate = -1;
  private biomeTimer = 0;
  private saveTimer = 0;
  private scanTimer = 0;
  private torchPos: number[] = [];
  private lavaPos: number[] = [];
  private lightSky = 1;
  private lightBlk = 0;
  private waterNear = 0;
  private lavaNear = 0;
  private lookDX = 0;
  private lookDY = 0;
  private bobAmt = 0;
  private titleT = 0;
  private dbReady = false;
  private loadDone = false;
  private tmpV = new THREE.Vector3();
  private eyeOut = { x: 0, y: 0, z: 0 };
  private gpuName = "";
  private auroraLevel = 0;
  private colScratch = new Float32Array(9);
  private cinematic = false;
  private paused = false;
  private freshStart = false;
  private model = new PlayerModel();
  lod!: Lod;
  private fpsAcc = 0;
  private fpsN = 0;
  private autoQ = { done: false, t: 0 };

  constructor(public canvas: HTMLCanvasElement, seed: number, private root: HTMLElement) {
    this.meta = loadMeta();
    this.seed = seed;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance", alpha: false, depth: false, stencil: false });
    renderer.autoClear = false;
    renderer.info.autoReset = false;
    this.renderer = renderer;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const maxSamples = gl.getParameter(gl.MAX_SAMPLES) as number;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    this.gpuName = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "WebGL2";

    this.tex = generateTextures();
    const cloudTex = makeCloudTexture();
    this.env = new Environment(cloudTex);
    this.mats = createTerrainMaterials(this.env.uniforms, this.tex);
    this.sky = new Sky(this.env.uniforms);
    this.scene.add(this.sky.mesh);

    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 1400);
    this.camera.rotation.order = "YXZ";
    this.fovCur = settings.fov;

    this.ui = new UI(root);
    this.ui.icons = makeAllIcons(this.tex, 64);
    this.hand = new Hand(this.mats.albedo, this.mats.mask);
    this.particles = new Particles(this.mats.albedo, this.tex);
    this.ambient = new Ambient();
    this.scene.add(this.particles.group, this.ambient.group, this.model.group);

    // 選択ボックス（細い枠）
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });
    this.outline = new THREE.Mesh(this.makeFrameGeometry(), this.outlineMat);
    this.outline.visible = false;
    this.outline.frustumCulled = false;
    this.outline.renderOrder = 1;
    this.scene.add(this.outline);

    this.input = new Input(canvas);
    this.post = new PostFX(renderer, 2, 2, Math.min(4, maxSamples));
    this.shadow = new Shadow(this.mats.shadowUniforms, new THREE.Group());

    this.bindUI();
    this.env.onThunder = (r) => this.audio.thunder(r);
    this.input.onLockChange = (l) => this.onLockChange(l);
    this.input.onKey = (c, e) => this.onKey(c, e);
    this.applyAllSettings();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("pagehide", () => this.saveAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.saveAll();
    });
    void this.initWorld(seed);
    requestAnimationFrame((t) => this.loop(t));
  }

  // ---------------------------------------------------------------- 初期化 ----
  private async initWorld(seed: number) {
    this.seed = seed;
    const saved = await this.store.open(seed);
    this.gen = new WorldGen(seed);
    this.world = new World(seed, this.mats);
    this.world.saved = saved;
    this.world.renderDistance = settings.renderDistance;
    this.world.onEdit = (c) => this.store.mark(c);
    this.scene.add(this.world.group);
    this.lod = new Lod(seed, this.env.uniforms);
    this.scene.add(this.lod.group);
    // シャドウ用グループを差し替え
    this.shadow.scene.clear();
    this.shadow.scene.add(this.world.shadowGroup);
    this.player = new Player(this.world);
    this.hookPlayer();
    const m = this.meta && this.meta.seed === seed ? this.meta : null;
    this.spawn = findSpawn(this.gen);
    if (m) {
      this.view.x = m.x; this.view.y = m.y + 14; this.view.z = m.z;
      this.env.tick = m.tick;
      this.env.dayCount = m.dayCount;
      this.hotbar = m.hotbar.slice(0, 9);
      while (this.hotbar.length < 9) this.hotbar.push(0);
      this.selected = m.selected;
    } else {
      this.view.x = this.spawn.x + 0.5; this.view.y = this.spawn.y + 16; this.view.z = this.spawn.z + 0.5;
      this.env.setTime(900);
    }
    this.ui.continueBtn.textContent = m ? "続きから遊ぶ" : "ワールドに入る";
    this.ui.updateHotbar(this.hotbar, this.selected);
    this.hand.setBlock(this.hotbar[this.selected]);
    this.dbReady = true;
  }

  private bindUI() {
    const ui = this.ui;
    ui.onContinue = () => void this.startPlaying();
    ui.onNewWorld = (s) => void this.newWorld(s);
    ui.onResume = () => this.input.lock();
    ui.onQuit = () => {
      this.saveAll();
      location.reload();
    };
    ui.onScreenshot = () => {
      this.shotRequested = true;
    };
    ui.onSettings = () => this.applyAllSettings();
    ui.onAssign = (id, slot) => {
      const s = slot ?? this.selected;
      this.hotbar[s] = id;
      this.selected = s;
      this.syncHotbar();
    };
    ui.onSlot = (s) => {
      this.selected = s;
      this.syncHotbar();
    };
    ui.onCommand = (t) => this.exec(t);
    ui.onChatClose = () => {
      this.input.enabled = true;
      this.canvas.focus();
    };
    ui.onInventoryClose = () => this.closeInventory();
    ui.loading.addEventListener("click", () => {
      if (this.state === "loading" && this.loadDone) this.enterPlay();
    });
  }

  private hookPlayer() {
    const p = this.player;
    p.onStep = (id) => {
      const def = BLOCKS[id];
      if (!def) return;
      this.audio.play("step", def.sound, p.sneaking ? 0.45 : p.sprinting ? 1.15 : 0.8);
      if (p.sprinting) this.particles.dust(p.x, p.y, p.z, def.top, 3, 0.4, 0.5);
    };
    p.onLand = (speed, id) => {
      const def = BLOCKS[id];
      if (!def) return;
      this.audio.land(def.sound, speed);
      this.particles.dust(p.x, p.y, p.z, def.top, Math.min(14, 4 + Math.floor(speed * 14)), 0.9, 0.9);
    };
    p.onSplash = (speed) => {
      this.audio.splash(speed);
      this.particles.splash(p.x, p.y + 0.6, p.z, Math.min(1, speed * 1.4));
    };
  }

  private makeFrameGeometry(): THREE.BufferGeometry {
    const t = 0.012;
    const parts: THREE.BufferGeometry[] = [];
    const add = (sx: number, sy: number, sz: number, px: number, py: number, pz: number) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      g.translate(px, py, pz);
      parts.push(g);
    };
    for (const y of [0, 1]) for (const z of [0, 1]) add(1 + t, t, t, 0.5, y, z);
    for (const x of [0, 1]) for (const z of [0, 1]) add(t, 1 + t, t, x, 0.5, z);
    for (const x of [0, 1]) for (const y of [0, 1]) add(t, t, 1 + t, x, y, 0.5);
    // マージ
    let nv = 0, ni = 0;
    for (const g of parts) { nv += g.getAttribute("position").count; ni += g.index!.count; }
    const pos = new Float32Array(nv * 3);
    const idx = new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const g of parts) {
      const p = g.getAttribute("position").array as Float32Array;
      pos.set(p, vo * 3);
      const ix = g.index!.array;
      for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + vo;
      vo += p.length / 3;
      io += ix.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    return geo;
  }

  // ---------------------------------------------------------------- 設定 ----
  applyAllSettings() {
    const s = settings;
    if (this.world) this.world.renderDistance = s.renderDistance;
    this.post.bloomEnabled = s.bloom;
    this.particles.enabled = s.particles;
    const q = [{ size: 1024, r: 48 }, { size: 2048, r: 60 }, { size: 3072, r: 72 }][s.shadowQuality] ?? { size: 2048, r: 60 };
    this.shadow.enabled = s.shadows;
    if (this.shadow.size !== q.size) this.shadow.resize(q.size);
    this.shadow.setRadius(q.r);
    if (this.world) this.world.shadowChunkRadius = Math.ceil(q.r / CHUNK) + 1;
    this.env.timeSpeed = s.timeSpeed;
    this.audio.setVolumes({ master: s.masterVol, music: s.musicVol, amb: s.ambientVol, sfx: s.sfxVol });
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * settings.resolution;
    this.renderer.setPixelRatio(dpr);
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hand.setAspect(w / h);
    this.root.style.setProperty("--ui", String(Math.max(0.7, Math.min(1.4, h / 800))));
  }

  // ---------------------------------------------------------------- 画面遷移 ----
  private async startPlaying() {
    if (this.state !== "title" || !this.dbReady) return;
    this.audio.init();
    this.state = "loading";
    this.loadDone = false;
    this.ui.showTitle(false);
    this.ui.showLoading(true);
    const m = this.meta && this.meta.seed === this.seed ? this.meta : null;
    if (m) {
      this.player.setPos(m.x, m.y, m.z);
      this.player.yaw = m.yaw;
      this.player.pitch = m.pitch;
      this.player.flying = m.flying;
    } else {
      this.player.setPos(this.spawn.x + 0.5, this.spawn.y, this.spawn.z + 0.5);
      this.player.yaw = -Math.PI / 2 + 0.45; // 日の出の方角（東）を向いて始める
      this.player.pitch = 0.04;
      this.freshStart = true;
    }
    this.player.creative = true;
  }

  /** 開始地点の近くで、平らで開けた地面を探し、見晴らしのよい向きを決める */
  private findSafeSpawn(): { x: number; y: number; z: number; yaw: number } {
    const w = this.world;
    const ok = (x: number, z: number): number | null => {
      const top = w.columnTop(x, z);
      if (top <= 0) return null;
      const id = w.getBlock(x, top - 1, z);
      if (id <= 0 || OPAQUE[id] !== 1) return null;
      const def = BLOCKS[id];
      if (def.leaves || def.name.endsWith("_log") || IS_LIQUID[id]) return null;
      if (top - 1 < SEA_LEVEL) return null;
      for (let dy = 0; dy < 3; dy++) {
        const a = w.getBlock(x, top + dy, z);
        if (a !== 0 && !(a > 0 && !COLLIDE[a])) return null;
      }
      return top;
    };
    // 平らさ：周囲 ±3 の地面の高さの差が小さいほどよい
    const flat = (x: number, z: number, y: number) => {
      let worst = 0;
      for (let dx = -3; dx <= 3; dx += 3)
        for (let dz = -3; dz <= 3; dz += 3) {
          const t = w.columnTop(x + dx, z + dz);
          if (t <= 0) return 99;
          worst = Math.max(worst, Math.abs(t - y));
        }
      return worst;
    };
    const cx = Math.floor(this.spawn.x), cz = Math.floor(this.spawn.z);
    let best: { x: number; y: number; z: number; score: number } | null = null;
    for (let r = 0; r <= 18; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const y = ok(cx + dx, cz + dz);
          if (y === null) continue;
          const score = flat(cx + dx, cz + dz, y) * 3 + r * 0.15;
          if (!best || score < best.score) best = { x: cx + dx, y, z: cz + dz, score };
        }
    const sp = best ?? { x: cx, y: this.spawn.y, z: cz, score: 0 };
    // 8方位のうち、遠くまで開けていて、日の出（東）に近い向きを選ぶ
    let bestYaw = -Math.PI / 2, bestScore = -1e9;
    for (let k = 0; k < 8; k++) {
      const yaw = (k * Math.PI) / 4;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let s = fx * 2.5;
      for (let d = 5; d <= 20; d += 3) s -= Math.max(0, w.columnTop(Math.floor(sp.x + fx * d), Math.floor(sp.z + fz * d)) - (sp.y + 1.5)) * 0.8;
      if (s > bestScore) {
        bestScore = s;
        bestYaw = yaw;
      }
    }
    return { x: sp.x, y: sp.y, z: sp.z, yaw: bestYaw };
  }

  /** 体が埋まっていたら、空いている高さまで押し上げる */
  private unstick() {
    const p = this.player;
    for (let i = 0; i < 160; i++) {
      const box = p.aabb();
      let hit = false;
      for (let x = Math.floor(box.x0); x <= Math.floor(box.x1) && !hit; x++)
        for (let z = Math.floor(box.z0); z <= Math.floor(box.z1) && !hit; z++)
          for (let y = Math.floor(box.y0); y <= Math.floor(box.y1) && !hit; y++) {
            const id = this.world.getBlock(x, y, z);
            if (id > 0 && COLLIDE[id]) hit = true;
          }
      if (!hit) return;
      p.setPos(p.x, p.y + 1, p.z);
    }
  }

  /** 新しいワールドの開始地点まわりの草を刈って、足元を見やすくする */
  private clearSpawnArea() {
    const w = this.world;
    const cx = Math.floor(this.player.x), cz = Math.floor(this.player.z), cy = Math.floor(this.player.y);
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++)
        for (let dy = 0; dy <= 2; dy++) {
          const id = w.getBlock(cx + dx, cy + dy, cz + dz);
          if (id > 0 && BLOCKS[id].shape === Shape.CROSS) w.setBlock(cx + dx, cy + dy, cz + dz, B.AIR);
        }
  }

  private enterPlay() {
    if (this.freshStart) {
      // 読み込みが終わってから、安全な地面を探して開始地点を確定する
      this.freshStart = false;
      const sp = this.findSafeSpawn();
      this.player.setPos(sp.x + 0.5, sp.y, sp.z + 0.5);
      this.player.yaw = sp.yaw;
      this.player.pitch = 0.05;
      this.clearSpawnArea();
    }
    this.state = "playing";
    this.loadDone = false;
    this.ui.showLoading(false);
    this.ui.setHudVisible(true);
    this.hudVisible = true;
    this.input.lock();
    this.audio.init();
    this.tickAcc = 0;
    this.ui.updateHotbar(this.hotbar, this.selected);
    this.ui.showItemName(BLOCKS[this.hotbar[this.selected]]?.label ?? "");
    this.biomeNow = -1;
    this.ui.log("ようこそ、箱庭へ。 Space を2回押すと空を飛べます。 E でブロック一覧、/help でコマンド一覧。");
    window.onbeforeunload = (e) => {
      e.preventDefault();
      return "";
    };
  }

  private async newWorld(seedText: string) {
    const seed = seedText.trim() === "" ? Math.floor(Math.random() * 2147483647) : seedFromString(seedText);
    await ChunkStore.wipe(seed);
    clearMeta();
    const url = new URL(location.href);
    url.searchParams.set("seed", String(seed));
    window.onbeforeunload = null;
    location.href = url.toString();
  }

  private onLockChange(locked: boolean) {
    if (!locked) {
      window.onbeforeunload = null;
      if (this.state === "playing" && !this.ui.anyOverlayOpen && !this.ui.isChatOpen) {
        this.state = "paused";
        this.ui.showPause(true);
        this.saveAll();
      }
    } else {
      if (this.state === "paused") {
        this.state = "playing";
        this.ui.showPause(false);
        this.ui.settingsEl.classList.add("hidden");
        this.ui.controlsEl.classList.add("hidden");
      }
      window.onbeforeunload = (e) => {
        e.preventDefault();
        return "";
      };
      this.audio.init();
    }
  }

  private closeInventory() {
    this.ui.showInventory(false);
    if (this.state === "playing") this.input.lock();
  }

  private onKey(code: string, e: KeyboardEvent) {
    if (this.state !== "playing") return;
    if (code.startsWith("Digit")) {
      const n = parseInt(code.slice(5), 10);
      if (n >= 1 && n <= 9) {
        if (this.ui.assignHover(n - 1)) return;
        this.selected = n - 1;
        this.syncHotbar();
      }
      return;
    }
    switch (code) {
      case "KeyE":
        if (this.ui.isChatOpen) return;
        if (this.ui.inventoryEl.classList.contains("hidden")) {
          this.ui.showInventory(true);
          this.input.unlock();
        } else this.closeInventory();
        break;
      case "KeyT":
        if (this.ui.anyOverlayOpen) return;
        e.preventDefault();
        this.openChat("");
        break;
      case "Slash":
        if (this.ui.anyOverlayOpen) return;
        e.preventDefault();
        this.openChat("/");
        break;
      case "KeyQ":
        if (!this.ui.anyOverlayOpen) this.pickBlock(this.hit);
        break;
      case "F1":
        this.hudVisible = !this.hudVisible;
        this.ui.setHudVisible(this.hudVisible);
        break;
      case "F2":
        this.shotRequested = true;
        break;
      case "F3":
        this.debugOn = !this.debugOn;
        if (!this.debugOn) this.ui.setDebug(null);
        break;
      case "F5":
        this.thirdPerson = (this.thirdPerson + 1) % 3;
        this.ui.toast(["一人称視点", "三人称視点（背面）", "三人称視点（前面）"][this.thirdPerson]);
        break;
      case "Escape":
        if (!this.ui.inventoryEl.classList.contains("hidden")) this.ui.showInventory(false);
        break;
    }
  }

  private openChat(prefill: string) {
    this.input.enabled = false;
    this.ui.openChat(prefill);
  }

  private syncHotbar() {
    this.ui.updateHotbar(this.hotbar, this.selected);
    const id = this.hotbar[this.selected];
    this.hand.setBlock(id);
    if (id) this.ui.showItemName(BLOCKS[id].label);
  }

  saveAll() {
    this.store.flush();
    if (this.player && this.state !== "title" && this.state !== "loading") {
      const p = this.player;
      saveMeta({ seed: this.seed, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, tick: this.env.tick, dayCount: this.env.dayCount, hotbar: this.hotbar, selected: this.selected, flying: p.flying });
    }
  }

  // ---------------------------------------------------------------- ループ ----
  private loop(t: number) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0.016);
    this.last = t;
    this.fps += (1 / Math.max(dt, 1e-4) - this.fps) * 0.05;
    this.frame(dt);
  }

  frame(dt: number) {
    this.frames++;
    this.renderer.info.reset();
    this.time += dt;
    const cam = this.camera;
    const inp = this.input;
    let camX = this.view.x, camY = this.view.y, camZ = this.view.z;
    let yaw = this.view.yaw, pitch = this.view.pitch, roll = 0;
    let streamX = camX, streamZ = camZ;
    const playing = this.state === "playing" && this.dbReady;

    if (!this.dbReady) {
      this.env.update(dt, this.time, 160);
      return;
    }

    if (this.state === "title") {
      this.titleT += dt;
      // ゆっくり周回しながら世界を眺める
      const a = this.titleT * 0.045 + 0.6;
      const R = 34;
      const cx = this.view.x, cz = this.view.z;
      if (this.titleT === dt) { this.titleBase = { x: cx, y: this.view.y, z: cz }; }
      const b = this.titleBase ?? { x: cx, y: this.view.y, z: cz };
      camX = b.x + Math.cos(a) * R;
      camZ = b.z + Math.sin(a) * R;
      camY = b.y + 4 + Math.sin(this.titleT * 0.11) * 3;
      yaw = Math.atan2(-(b.x - camX), -(b.z - camZ));
      pitch = -0.2 + Math.sin(this.titleT * 0.13) * 0.04;
      streamX = camX;
      streamZ = camZ;
    } else if (this.state === "loading") {
      streamX = this.player.x; streamZ = this.player.z;
      camX = streamX; camY = this.player.y + 20; camZ = streamZ;
      pitch = -0.4;
      const prog = this.world.loadProgress(4);
      this.ui.setLoading(Math.min(1, prog));
      const pc = this.world.getChunkAt(Math.floor(this.player.x), Math.floor(this.player.z));
      if (!this.loadDone && prog >= 0.98 && pc && pc.meshed) {
        this.loadDone = true;
        this.ui.loading.querySelector(".t")!.textContent = "クリックして開始";
        (this.ui.loading.querySelector(".bar") as HTMLElement).style.display = "none";
      }
    } else if (playing || this.state === "paused") {
      const r = this.updatePlayer(dt, playing);
      camX = r.x; camY = r.y; camZ = r.z; yaw = r.yaw; pitch = r.pitch; roll = r.roll;
      streamX = this.player.x; streamZ = this.player.z;
    }

    cam.position.set(camX, camY, camZ);
    cam.rotation.set(pitch, yaw, roll);
    const fovT = settings.fov * (this.player && this.state !== "title" && this.player.sprinting ? 1.1 : 1) * (this.player && this.player.flying && this.player.sprinting ? 1.06 : 1);
    this.fovCur += (fovT - this.fovCur) * Math.min(1, dt * 9);
    if (Math.abs(cam.fov - this.fovCur) > 0.01) {
      cam.fov = this.fovCur;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();

    // 三人称モデル
    if (this.player && (this.state === "playing" || this.state === "paused")) {
      const alpha = Math.min(1, this.tickAcc / 0.05);
      const amb = this.env.uniforms.uAmbient.value as THREE.Vector3;
      const lc = this.env.uniforms.uLightColor.value as THREE.Vector3;
      const lightV = new THREE.Vector3().copy(amb).multiplyScalar(0.7).addScaledVector(lc, 0.28).multiplyScalar(0.55 + 0.45 * Math.max(this.lightSky, 0.1));
      this.model.update(this.player, alpha, this.thirdPerson > 0, lightV, dt, this.player.pitch);
    }
    this.autoQuality(dt);
    if (this.world) this.world.meshBudget = this.state === "loading" ? 24 : this.state === "title" ? 8 : 3;

    // 環境
    const biomeInfo = this.world.climateAt(Math.floor(camX), Math.floor(camZ));
    const biome = biomeInfo ? biomeInfo[0] : Biome.PLAINS;
    this.updateEnvironment(dt, camX, camY, camZ, biomeInfo);
    this.world.update(streamX, streamZ);
    this.lod.enabled = settings.farTerrain;
    this.env.uniforms.uEdgeFog.value = settings.farTerrain && this.lod.mesh ? 0.4 : 1;
    this.lod.update(streamX, streamZ, this.world.renderDistance);
    this.sky.update(cam);

    // パーティクル・環境演出
    const env = this.env;
    const L = env.uniforms.uLightColor.value as THREE.Vector3;
    const partLight = new THREE.Vector3().copy(env.uniforms.uAmbient.value as THREE.Vector3).multiplyScalar(0.9).addScaledVector(L, 0.45).clampScalar(0.04, 2.2);
    this.particles.setView(this.renderer, cam, partLight);
    this.particles.update(dt, this.world);
    try {
      this.ambient.update(dt, {
        cam: cam.position, time: this.time, rain: env.rain, snowing: env.snowing, wind: env.uniforms.uWind.value as THREE.Vector2,
        biome, night: env.night, day: env.dayFactor, sunVis: env.sunIntensity, ambient: env.uniforms.uAmbient.value as THREE.Vector3, lightColor: L,
        underwater: env.underwater, outdoor: this.lightSky, particles: settings.particles,
        scale: this.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360)) * 0.5,
      }, this.world);
    } catch (e) {
      console.warn("ambient", e);
    }
    this.updateWorldFx(dt, camX, camY, camZ);

    // 影
    const fwd = cam.getWorldDirection(this.tmpV);
    this.shadow.update(this.renderer, env.uniforms.uLightDir.value as THREE.Vector3, new THREE.Vector3(camX, camY, camZ).addScaledVector(fwd, 18), L.length() > 0.05);

    // 描画
    this.post.begin();
    this.renderer.render(this.scene, cam);
    // 手
    if (this.state === "playing" || this.state === "paused") this.renderHand(dt);

    const sp = cam.position.clone().addScaledVector(env.sunDir, 500);
    const facing = fwd.dot(env.sunDir);
    sp.project(cam);
    const godOn = settings.godRays && this.state !== "loading";
    this.post.finish({
      bloom: 0.3,
      bloomThreshold: 1.0,
      exposure: settings.brightness * (env.underwater ? 0.9 : 1),
      sunUV: new THREE.Vector2(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5),
      godRay: godOn && facing > 0.05 && !env.underwater ? env.sunIntensity * 0.5 * (1 - env.rain) * Math.min(1, facing * 3) : 0,
      godColor: new THREE.Vector3(1.0, 0.78, 0.5).multiplyScalar(0.55),
      underwater: env.underwater,
      time: this.time,
      vignette: 0.5,
      saturation: 1.08,
      flash: env.flash,
    });
    if (this.shotRequested) this.takeScreenshot();

    // HUD・デバッグ
    if (this.state === "playing" || this.state === "paused") this.updateHud(dt, biome, biomeInfo);
    inp.endFrame();
  }

  private titleBase: { x: number; y: number; z: number } | null = null;

  /** プレイ開始から数秒のFPSを見て、重ければ画質を一段階ずつ下げる */
  private autoQuality(dt: number) {
    if (this.state !== "playing" || this.autoQ.done) return;
    this.autoQ.t += dt;
    if (this.autoQ.t < 6) return;
    this.fpsAcc += 1 / Math.max(dt, 1e-4);
    this.fpsN++;
    if (this.autoQ.t < 12) return;
    this.autoQ.done = true;
    const avg = this.fpsAcc / Math.max(1, this.fpsN);
    if (avg < 26) {
      settings.shadowQuality = 0;
      settings.resolution = Math.min(settings.resolution, 0.75);
      settings.renderDistance = Math.min(settings.renderDistance, 8);
      settings.godRays = false;
      this.post.setMsaa(0);
      this.applyAllSettings();
      this.ui.toast("動作が重いため、画質を自動で下げました（設定から変更できます）");
    } else if (avg < 42) {
      settings.shadowQuality = Math.min(settings.shadowQuality, 0);
      settings.renderDistance = Math.min(settings.renderDistance, 9);
      this.applyAllSettings();
      this.ui.toast("画質を少し調整しました（設定から変更できます）");
    }
  }

  // ---------------------------------------------------------------- プレイヤー ----
  private updatePlayer(dt: number, active: boolean) {
    const inp = this.input;
    const p = this.player;
    if (!active) inp.endTick();
    const blocking = this.ui.isChatOpen || this.ui.anyOverlayOpen;
    const canLook = active && inp.locked && !blocking;
    const canMove = active && inp.locked && !this.ui.isChatOpen && !this.ui.anyOverlayOpen;

    this.lookDX = 0;
    this.lookDY = 0;
    if (canLook) {
      const k = Math.pow(settings.sensitivity * 0.6 + 0.2, 3) * 8 * 0.15 * (Math.PI / 180);
      p.yaw -= inp.dx * k;
      p.pitch -= inp.dy * k;
      p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
      this.lookDX = inp.dx;
      this.lookDY = inp.dy;
      if (inp.wheel !== 0) {
        this.selected = (((this.selected + inp.wheel) % 9) + 9) % 9;
        this.syncHotbar();
      }
    }

    // 物理（20 TPS 固定）
    if (active) {
      this.tickAcc += dt;
      let n = 0;
      while (this.tickAcc >= 0.05 && n < 5) {
        p.tick(inp, canMove);
        inp.endTick();
        this.tickAcc -= 0.05;
        n++;
      }
      if (n === 5) this.tickAcc = 0;
    }
    const alpha = Math.min(1, this.tickAcc / 0.05);
    p.eyePos(alpha, this.eyeOut);

    // 視点の揺れ
    let roll = 0, bobPitch = 0, bx = 0, by = 0;
    const speed = Math.hypot(p.x - p.px, p.z - p.pz) * 20;
    const targetBob = p.onGround && !p.flying && settings.bobbing && !p.inWater ? Math.min(1, speed / 4.3) : 0;
    this.bobAmt += (targetBob - this.bobAmt) * Math.min(1, dt * 10);
    const ph = p.walkDist * 0.6 * Math.PI * 2 / 2;
    if (this.bobAmt > 0.001) {
      bx = Math.sin(ph) * 0.03 * this.bobAmt;
      by = -Math.abs(Math.cos(ph)) * 0.035 * this.bobAmt;
      roll = Math.sin(ph) * 0.012 * this.bobAmt;
      bobPitch = Math.abs(Math.cos(ph - 0.2)) * 0.008 * this.bobAmt;
    }
    const eye = this.eyeOut;
    // カメラの右方向への揺れ
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let cx = eye.x + rx * bx, cy = eye.y + by, cz = eye.z + rz * bx;
    let yaw = p.yaw, pitch = p.pitch + bobPitch;

    // 三人称
    if (this.thirdPerson > 0) {
      const sgn = this.thirdPerson === 1 ? 1 : -1;
      const dir = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
      const back = dir.clone().multiplyScalar(sgn * -1);
      const h = raycast(this.world, eye.x, eye.y, eye.z, back.x, back.y, back.z, 4.2);
      const d = h ? Math.max(0.3, h.t - 0.25) : 4.2;
      cx = eye.x + back.x * d;
      cy = eye.y + back.y * d;
      cz = eye.z + back.z * d;
      if (this.thirdPerson === 2) { yaw = p.yaw + Math.PI; pitch = -p.pitch; }
    }

    if (active && canMove) this.interact(dt, eye);
    else {
      this.hit = null;
      this.outline.visible = false;
    }
    return { x: cx, y: cy, z: cz, yaw, pitch, roll };
  }

  private interact(dt: number, eye: { x: number; y: number; z: number }) {
    const inp = this.input;
    const p = this.player;
    const dir = new THREE.Vector3(-Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch));
    const held = this.hotbar[this.selected];
    const wantLiquid = held === B.LILY_PAD;
    let hit = raycast(this.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, wantLiquid);
    this.hit = hit;
    this.updateOutline(hit);

    this.breakCd -= dt;
    this.placeCd -= dt;
    const lClick = inp.clicked(0);
    const rClick = inp.clicked(2);
    if (inp.clicked(1)) this.pickBlock(hit);

    if (lClick || (inp.buttons[0] && this.breakCd <= 0)) {
      this.hand.punch();
      if (hit && !(wantLiquid && IS_LIQUID[hit.id])) {
        this.breakBlock(hit);
      } else {
        // 空振り：液体を貫通して壊す
        const h2 = wantLiquid ? raycast(this.world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 5, false) : null;
        if (h2) this.breakBlock(h2);
      }
      this.breakCd = 0.25;
    }
    if (rClick || (inp.buttons[2] && this.placeCd <= 0)) {
      if (!hit) hit = null;
      if (this.placeBlock(hit)) this.hand.kick();
      this.hand.punch();
      this.placeCd = 0.2;
    }
  }

  private updateOutline(hit: Hit | null) {
    if (!hit || !this.hudVisible && false) {
      this.outline.visible = false;
      return;
    }
    const boxes = selectionBoxes(hit.id);
    // 複数ボックスは外接ボックスで表示
    let x0 = 1, y0 = 1, z0 = 1, x1 = 0, y1 = 0, z1 = 0;
    for (const b of boxes) {
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); z0 = Math.min(z0, b[2]);
      x1 = Math.max(x1, b[3]); y1 = Math.max(y1, b[4]); z1 = Math.max(z1, b[5]);
    }
    const e = 0.004;
    this.outline.position.set(hit.x + x0 - e, hit.y + y0 - e, hit.z + z0 - e);
    this.outline.scale.set(x1 - x0 + 2 * e, y1 - y0 + 2 * e, z1 - z0 + 2 * e);
    this.outline.visible = true;
    this.outlineMat.opacity = 0.5 + 0.12 * Math.sin(this.time * 4);
  }

  // ---------------------------------------------------------------- ブロック操作 ----
  private fluidNeighbor(x: number, y: number, z: number): number {
    const w = this.world;
    let lava = 0;
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]]) {
      const id = w.getBlock(x + dx, y + dy, z + dz);
      if (id === B.WATER) return B.WATER;
      if (id === B.LAVA) lava = B.LAVA;
    }
    return lava;
  }

  private supported(x: number, y: number, z: number, id: number): boolean {
    const def = BLOCKS[id];
    const w = this.world;
    switch (def.attach) {
      case "below": {
        const b = w.getBlock(x, y - 1, z);
        return b > 0 && (OPAQUE[b] === 1 || COLLIDE[b] === 1) && !IS_LIQUID[b];
      }
      case "water": {
        const b = w.getBlock(x, y - 1, z);
        if (id === B.LILY_PAD) return b === B.WATER;
        return b > 0 && (isWaterLike(b) || OPAQUE[b] === 1 || b === B.KELP);
      }
      case "wall": {
        const dx = id === B.TORCH_WALL_PX ? 1 : id === B.TORCH_WALL_NX ? -1 : 0;
        const dz = id === B.TORCH_WALL_PZ ? 1 : id === B.TORCH_WALL_NZ ? -1 : 0;
        const b = w.getBlock(x + dx, y, z + dz);
        return b > 0 && OPAQUE[b] === 1;
      }
      default:
        return true;
    }
  }

  /** 支えを失った植物・松明などを連鎖的に消す */
  private cascade(x: number, y: number, z: number) {
    const w = this.world;
    const stack: number[][] = [[x, y + 1, z], [x + 1, y, z], [x - 1, y, z], [x, y, z + 1], [x, y, z - 1]];
    let guard = 0;
    while (stack.length && guard++ < 64) {
      const [cx, cy, cz] = stack.pop()!;
      const id = w.getBlock(cx, cy, cz);
      if (id <= 0) continue;
      const def = BLOCKS[id];
      if (def.attach === "none") {
        if (id === B.TALL_GRASS_HI && w.getBlock(cx, cy - 1, cz) !== B.TALL_GRASS_LO) {
          w.setBlock(cx, cy, cz, B.AIR);
        }
        continue;
      }
      if (!this.supported(cx, cy, cz, id)) {
        const rep = IN_WATER_REPLACE(id) ? B.WATER : B.AIR;
        w.setBlock(cx, cy, cz, rep);
        this.particles.breakBlock(cx, cy, cz, def);
        stack.push([cx, cy + 1, cz], [cx + 1, cy, cz], [cx - 1, cy, cz], [cx, cy, cz + 1], [cx, cy, cz - 1]);
      }
    }
  }

  private breakBlock(hit: Hit) {
    const w = this.world;
    const { x, y, z } = hit;
    const id = w.getBlock(x, y, z);
    if (id <= 0 || y < 1) return;
    const def = BLOCKS[id];
    let rep: number = B.AIR;
    if (IN_WATER_REPLACE(id)) rep = B.WATER;
    else {
      const f = this.fluidNeighbor(x, y, z);
      if (f) rep = f;
    }
    w.setBlock(x, y, z, rep);
    // 背の高い草は2ブロックまとめて
    if (id === B.TALL_GRASS_LO && w.getBlock(x, y + 1, z) === B.TALL_GRASS_HI) w.setBlock(x, y + 1, z, B.AIR);
    if (id === B.TALL_GRASS_HI && w.getBlock(x, y - 1, z) === B.TALL_GRASS_LO) w.setBlock(x, y - 1, z, B.AIR);
    this.cascade(x, y, z);
    this.particles.breakBlock(x, y, z, def);
    this.audio.play("break", def.sound);
  }

  private placeBlock(hit: Hit | null): boolean {
    const w = this.world;
    const item = this.hotbar[this.selected];
    if (!item || !hit) return false;
    let placeId = item;
    let tx = hit.x + hit.nx, ty = hit.y + hit.ny, tz = hit.z + hit.nz;
    const hitDef = BLOCKS[hit.id];
    if (REPLACEABLE[hit.id] && !IS_LIQUID[hit.id]) {
      tx = hit.x; ty = hit.y; tz = hit.z;
    }
    if (item === B.LILY_PAD) {
      // 水面にだけ置ける
      if (hit.id === B.WATER && w.getBlock(hit.x, hit.y + 1, hit.z) === B.AIR) { tx = hit.x; ty = hit.y + 1; tz = hit.z; }
      else if (hit.ny === 1 && w.getBlock(hit.x, hit.y, hit.z) === B.WATER) { tx = hit.x; ty = hit.y + 1; tz = hit.z; }
    }
    const cur = w.getBlock(tx, ty, tz);
    if (cur < 0 || ty < 1 || ty >= WORLD_H) return false;
    if (cur !== B.AIR && !REPLACEABLE[cur]) return false;
    // 松明は面の向きに応じて
    if (item === B.TORCH) {
      if (hit.ny === 1 || (hit.nx === 0 && hit.nz === 0 && hit.ny === 0)) placeId = B.TORCH;
      else if (hit.ny === -1) return false;
      else if (hit.nx === -1) placeId = B.TORCH_WALL_PX;
      else if (hit.nx === 1) placeId = B.TORCH_WALL_NX;
      else if (hit.nz === -1) placeId = B.TORCH_WALL_PZ;
      else placeId = B.TORCH_WALL_NZ;
    }
    // ハーフブロック・階段
    const grp = SLAB_OF.get(item);
    if (grp) {
      if (item === grp.slab || item === grp.slabTop) {
        // 同じ素材のハーフブロックの上下に重ねると、ひとつのブロックになる
        if ((hit.id === grp.slab && hit.ny === 1) || (hit.id === grp.slabTop && hit.ny === -1)) {
          if (this.player.intersectsBlock(hit.x, hit.y, hit.z, grp.base)) return false;
          if (!w.setBlock(hit.x, hit.y, hit.z, grp.base)) return false;
          this.audio.play("place", BLOCKS[grp.base].sound);
          return true;
        }
        const upper = hit.ny === -1 ? true : hit.ny === 1 ? false : hit.py - hit.y > 0.5;
        placeId = upper ? grp.slabTop : grp.slab;
      } else {
        // 階段は、プレイヤーが向いている方向へ上っていく向きに置く
        const fx = -Math.sin(this.player.yaw), fz = -Math.cos(this.player.yaw);
        placeId = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? grp.stairs[0] : grp.stairs[1]) : fz > 0 ? grp.stairs[2] : grp.stairs[3];
      }
    }
    const def = BLOCKS[placeId];
    if (def.attach !== "none" && !this.supported(tx, ty, tz, placeId)) return false;
    if (COLLIDE[placeId] && this.player.intersectsBlock(tx, ty, tz, placeId)) return false;
    // 2段植物の置き換えで残った上半分を掃除
    if (cur === B.TALL_GRASS_LO && w.getBlock(tx, ty + 1, tz) === B.TALL_GRASS_HI) w.setBlock(tx, ty + 1, tz, B.AIR);
    if (!w.setBlock(tx, ty, tz, placeId)) return false;
    this.audio.play("place", def.sound);
    if (this.particles.enabled && COLLIDE[placeId]) this.particles.dust(tx + 0.5, ty + 0.1, tz + 0.5, def.side, 3, 0.8, 0.3);
    void hitDef;
    return true;
  }

  private pickBlock(hit: Hit | null) {
    if (!hit) return;
    let id = hit.id;
    const def = BLOCKS[id];
    if (def.itemOf) id = BLOCK_BY_NAME.get(def.itemOf)!.id;
    if (IS_LIQUID[id] && id !== B.WATER && id !== B.LAVA) return;
    const slot = this.hotbar.indexOf(id);
    if (slot >= 0) this.selected = slot;
    else this.hotbar[this.selected] = id;
    this.syncHotbar();
  }

  // ---------------------------------------------------------------- 環境の更新 ----
  private updateEnvironment(dt: number, cx: number, cy: number, cz: number, info: [number, number, number] | null) {
    const env = this.env;
    // 水中判定（カメラ位置）
    const bid = this.world.getBlock(Math.floor(cx), Math.floor(cy), Math.floor(cz));
    let under = false;
    if (bid > 0 && isWaterLike(bid)) {
      const above = this.world.getBlock(Math.floor(cx), Math.floor(cy) + 1, Math.floor(cz));
      const top = isWaterLike(above) ? 1 : 0.875;
      under = cy - Math.floor(cy) < top;
    }
    env.underwater = under;
    const biome = info ? info[0] : Biome.PLAINS;
    if (info) {
      biomeColors(biome, info[1], info[2], this.colScratch);
      env.waterTint.setRGB(this.colScratch[6], this.colScratch[7], this.colScratch[8]);
    }
    env.mistBias = biome === Biome.SWAMP ? 0.55 : biome === Biome.BAMBOO_GROVE ? 0.25 : biome === Biome.CHERRY_GROVE ? 0.12 : 0;
    env.snowing = isColdBiome(biome) || (info ? info[1] < 70 : false);
    // オーロラ：寒い土地の夜に、日によって出る
    const coldTarget = isColdBiome(biome) || (info ? info[1] < 95 : false) ? 1 : 0;
    const nightly = hash2(env.dayCount, 7, this.seed) < 0.6 ? 1 : 0.4;
    this.auroraLevel += (coldTarget * nightly - this.auroraLevel) * Math.min(1, dt * 0.3);
    env.aurora = this.auroraLevel;
    env.update(dt, this.time, this.world.renderDistance * CHUNK);
  }

  /** 周囲の光・水・溶岩・松明の走査（0.25秒ごと） */
  private updateWorldFx(dt: number, cx: number, cy: number, cz: number) {
    if (this.state === "title" || this.state === "loading") return;
    const w = this.world;
    this.scanTimer -= dt;
    // 火の粉・煙を、保持している位置から出す
    const p = this.particles;
    for (let i = 0; i < this.torchPos.length; i += 3) {
      if (Math.random() < dt * 2.2) p.ember(this.torchPos[i] + 0.5, this.torchPos[i + 1] + 0.75, this.torchPos[i + 2] + 0.5, 1);
      if (Math.random() < dt * 0.35) p.smoke(this.torchPos[i] + 0.5, this.torchPos[i + 1] + 0.8, this.torchPos[i + 2] + 0.5);
    }
    for (let i = 0; i < this.lavaPos.length; i += 3) {
      if (Math.random() < dt * 0.5) p.ember(this.lavaPos[i] + Math.random(), this.lavaPos[i + 1] + 0.9, this.lavaPos[i + 2] + Math.random(), 1.2);
    }
    if (this.env.underwater && Math.random() < dt * 3) p.bubble(cx + (Math.random() - 0.5) * 0.8, cy - 0.3, cz + (Math.random() - 0.5) * 0.8);
    if (this.scanTimer > 0) return;
    this.scanTimer = 0.25;
    const R = 10;
    const torches: number[] = [], lavas: number[] = [];
    let blk = 0, water = 0, lava = 0;
    const ix = Math.floor(cx), iy = Math.floor(cy), iz = Math.floor(cz);
    for (let x = ix - R; x <= ix + R; x++) {
      for (let z = iz - R; z <= iz + R; z++) {
        const ch = w.getChunkAt(x, z);
        if (!ch) continue;
        const lx = x & 15, lz = z & 15;
        const base = (lx * 16 + lz) * WORLD_H;
        const y0 = Math.max(1, iy - 6), y1 = Math.min(WORLD_H - 1, iy + 6);
        for (let y = y0; y <= y1; y++) {
          const id = ch.blocks[base + y];
          if (id === 0) continue;
          const e = EMIT[id];
          if (e > 0) {
            const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - cz);
            blk = Math.max(blk, Math.max(0, e - d));
            if (id === B.TORCH || id >= B.TORCH_WALL_PX && id <= B.TORCH_WALL_NZ) torches.push(x, y, z);
            else if (id === B.LAVA && (ch.blocks[base + y + 1] === 0) && Math.random() < 0.25) lavas.push(x, y, z);
            if (id === B.LAVA) lava += 1 / (1 + d * 0.5);
          } else if (id === B.WATER && Math.abs(y - iy) < 4 && Math.abs(x - ix) < 8 && Math.abs(z - iz) < 8) {
            water += 0.02;
          }
        }
      }
    }
    this.torchPos = torches.length > 90 ? torches.slice(0, 90) : torches;
    this.lavaPos = lavas.length > 60 ? lavas.slice(0, 60) : lavas;
    this.lightBlk = Math.min(1, blk / 15);
    this.waterNear = Math.min(1, water);
    this.lavaNear = Math.min(1, lava * 0.2);
    // 空の明るさ（頭上の遮蔽から推定）
    const top = w.columnTop(ix, iz);
    const eyeY = cy;
    this.lightSky = eyeY >= top ? 1 : Math.max(0, 1 - (top - eyeY) / 9);
  }

  private renderHand(dt: number) {
    const env = this.env;
    const cam = this.camera;
    const dirV = (env.uniforms.uLightDir.value as THREE.Vector3).clone().transformDirection(cam.matrixWorldInverse);
    const p = this.player;
    this.hand.update(dt, {
      bob: p.walkDist * 0.6 * Math.PI,
      bobAmount: this.bobAmt,
      lookDX: this.lookDX,
      lookDY: this.lookDY,
      lightDirView: dirV,
      lightColor: env.uniforms.uLightColor.value as THREE.Vector3,
      ambient: env.uniforms.uAmbient.value as THREE.Vector3,
      blockColor: env.uniforms.uBlockColor.value as THREE.Vector3,
      sky: Math.max(0.02, this.lightSky),
      blk: this.lightBlk,
      sun: 0.85,
      visible: this.thirdPerson === 0 && this.hudVisible && this.state === "playing",
      sprinting: p.sprinting,
    });
    const r = this.renderer;
    r.clearDepth();
    r.render(this.hand.scene, this.hand.camera);
  }

  // ---------------------------------------------------------------- HUD ----
  private updateHud(dt: number, biome: number, info: [number, number, number] | null) {
    const p = this.player;
    // バイオーム名のバナー
    if (this.state === "playing") {
      if (biome !== this.biomeCandidate) {
        this.biomeCandidate = biome;
        this.biomeTimer = 0;
      } else this.biomeTimer += dt;
      if (this.biomeTimer > (this.biomeNow === -1 ? 1.5 : 2.2) && biome !== this.biomeNow) {
        this.biomeNow = biome;
        this.ui.showBanner(BIOME_LABEL[biome] ?? "", this.timeLabel());
      }
    }
    // 環境音
    const exposure = Math.min(1, Math.max(0, this.lightSky));
    const top = this.world.columnTop(Math.floor(p.x), Math.floor(p.z));
    const deep = Math.min(1, Math.max(0, (top - p.y - 6) / 24));
    try {
      this.audio.update({
        dt, day: this.env.dayFactor, night: this.env.night, rain: this.env.rain, biome, exposure, deep, altitude: p.y,
        wind: Math.min(1, this.env.rain * 0.8 + (this.env.uniforms.uGust.value as number)), underwater: this.env.underwater, waterNear: this.waterNear,
        lavaNear: this.lavaNear, snowing: this.env.snowing,
      });
    } catch (e) {
      console.warn("audio", e);
    }
    this.ui.setFps(settings.showFps && !this.debugOn ? `${Math.round(this.fps)} FPS` : null);
    if (this.debugOn) this.updateDebug(biome, info);
    // 定期セーブ
    this.saveTimer += dt;
    if (this.saveTimer > 15) {
      this.saveTimer = 0;
      this.saveAll();
    }
  }

  private timeLabel(): string {
    const t = this.env.tick;
    if (t < 1000 || t >= 22500) return "夜明け";
    if (t < 4500) return "朝";
    if (t < 8500) return "昼";
    if (t < 11500) return "夕方";
    if (t < 13500) return "夕暮れ";
    if (t >= 17000 && t < 20000) return "真夜中";
    return "夜";
  }

  private updateDebug(biome: number, info: [number, number, number] | null) {
    const p = this.player;
    const w = this.world;
    const yawDeg = ((((180 - (p.yaw * 180) / Math.PI) % 360) + 540) % 360) - 180;
    const dirNames = ["南 (+Z)", "西 (-X)", "北 (-Z)", "東 (+X)"];
    const di = Math.round((((yawDeg + 360) % 360) / 90)) % 4;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const r = this.renderer.info.render;
    const L = this.hit ? `${this.hit.x} ${this.hit.y} ${this.hit.z} (${BLOCKS[this.hit.id]?.name ?? "?"})` : "なし";
    const left = [
      `HAKONIWA 1.0   ${Math.round(this.fps)} fps`,
      `XYZ: ${p.x.toFixed(3)} / ${p.y.toFixed(3)} / ${p.z.toFixed(3)}`,
      `ブロック: ${bx} ${by} ${bz}   チャンク: ${bx >> 4} ${bz >> 4} (${bx & 15}, ${bz & 15})`,
      `向き: ${dirNames[di]}  (yaw ${yawDeg.toFixed(1)} / pitch ${((-p.pitch * 180) / Math.PI).toFixed(1)})`,
      `バイオーム: ${BIOME_LABEL[biome]}   気温 ${info ? (info[1] / 127.5 - 1).toFixed(2) : "-"}  湿度 ${info ? (info[2] / 127.5 - 1).toFixed(2) : "-"}`,
      `見ているブロック: ${L}`,
      `時刻: ${this.timeLabel()} (tick ${Math.floor(this.env.tick)})  ${this.env.dayCount + 1}日目  月: ${(this.env.moonIllum * 100) | 0}%`,
      `天気: ${this.env.weather === "clear" ? "晴れ" : this.env.weather === "rain" ? "雨" : "雷雨"}  降水 ${(this.env.rain * 100) | 0}%`,
      `状態: ${p.flying ? "飛行 " : ""}${p.sprinting ? "ダッシュ " : ""}${p.sneaking ? "しゃがみ " : ""}${p.onGround ? "接地" : "空中"}${p.inWater ? " 水中" : ""}`,
      `チャンク: メッシュ済 ${w.meshedCount()} / 読込 ${w.chunks.size} / 処理中 ${w.inFlight}  生成 ${w.genMs.toFixed(1)}ms メッシュ ${w.meshMs.toFixed(1)}ms`,
      `描画: ${r.calls} calls / ${(r.triangles / 1000).toFixed(0)}k tris  パーティクル ${this.particles.count}`,
    ].join("\n");
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const right = [
      `Three.js r${THREE.REVISION}`,
      this.gpuName,
      `${this.renderer.domElement.width}x${this.renderer.domElement.height}  MSAA x${this.post.msaa}`,
      `描画距離 ${settings.renderDistance}  シード ${this.seed}`,
      mem ? `JSヒープ ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : "",
    ].filter(Boolean).join("\n");
    this.ui.setDebug(left, right);
  }

  // ---------------------------------------------------------------- コマンド ----
  private say(msg: string) {
    this.ui.log(msg);
  }

  private exec(text: string) {
    let t = text.trim();
    if (!t.startsWith("/")) {
      this.say(`<あなた> ${t}`);
      return;
    }
    t = t.slice(1);
    const a = t.split(/\s+/);
    const cmd = a[0].toLowerCase();
    const env = this.env;
    const p = this.player;
    const num = (s: string, base: number) => (s.startsWith("~") ? base + (s.length > 1 ? parseFloat(s.slice(1)) : 0) : parseFloat(s));
    switch (cmd) {
      case "help":
        this.say("コマンド: /time set <day|noon|sunset|night|midnight|sunrise|数値>  /time add <n>  /weather <clear|rain|thunder>");
        this.say("/tp <x> <y> <z>  /locate <biome>  /fly  /seed  /biome  /timespeed <n>  /aurora  /clear  /save");
        break;
      case "time": {
        const sub = a[1];
        if (sub === "set" && a[2]) {
          const presets: Record<string, number> = { day: 1000, morning: 1000, noon: 6000, sunset: 12000, dusk: 12600, night: 14000, midnight: 18000, sunrise: 23000, dawn: 23000 };
          const v = presets[a[2]] ?? parseFloat(a[2]);
          if (isNaN(v)) return this.say("時刻が正しくありません");
          env.setTime(v);
          this.say(`時刻を ${Math.floor(env.tick)} に設定しました`);
        } else if (sub === "add" && a[2]) {
          env.setTime(env.tick + parseFloat(a[2]));
          this.say(`時刻を進めました (${Math.floor(env.tick)})`);
        } else this.say(`現在の時刻: ${Math.floor(env.tick)} (${this.timeLabel()}) / ${env.dayCount + 1}日目`);
        break;
      }
      case "weather": {
        const w = a[1] as WeatherKind;
        if (w === "clear" || w === "rain" || w === "thunder") {
          env.setWeather(w);
          this.say(w === "clear" ? "天気を晴れにしました" : w === "rain" ? "雨が降り出します" : "雷雨になります");
        } else this.say("使い方: /weather <clear|rain|thunder>");
        break;
      }
      case "tp": {
        if (a.length < 4) return this.say("使い方: /tp <x> <y> <z>  （~ で相対座標）");
        const x = num(a[1], p.x), y = num(a[2], p.y), z = num(a[3], p.z);
        if ([x, y, z].some(isNaN)) return this.say("座標が正しくありません");
        p.setPos(x, y, z);
        p.flying = true;
        setTimeout(() => this.unstick(), 600);
        this.say(`(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}) にテレポートしました（飛行モード）`);
        break;
      }
      case "fly":
        p.flying = !p.flying;
        this.say(p.flying ? "飛行モード: オン" : "飛行モード: オフ");
        break;
      case "seed":
        this.say(`シード値: ${this.seed}`);
        break;
      case "biome": {
        const i = this.world.climateAt(Math.floor(p.x), Math.floor(p.z));
        this.say(`現在のバイオーム: ${i ? BIOME_LABEL[i[0]] : "不明"}`);
        break;
      }
      case "timespeed":
        if (a[1] !== undefined && !isNaN(parseFloat(a[1]))) {
          settings.timeSpeed = parseFloat(a[1]);
          env.timeSpeed = settings.timeSpeed;
          this.say(`時間の流れ: x${env.timeSpeed}`);
        } else this.say(`時間の流れ: x${env.timeSpeed}`);
        break;
      case "aurora":
        this.auroraLevel = 1;
        env.setTime(18000);
        this.say("夜空にオーロラが現れます（寒い土地で見えます）");
        break;
      case "clear":
        this.hotbar = new Array(9).fill(0);
        this.syncHotbar();
        break;
      case "save":
        this.saveAll();
        this.say("保存しました");
        break;
      case "locate": {
        const name = a.slice(1).join(" ").toLowerCase();
        const biome = BIOME_ALIASES[name] ?? BIOME_ALIASES[a[1]?.toLowerCase() ?? ""];
        if (biome === undefined) return this.say("使い方: /locate <cherry|autumn|forest|taiga|desert|swamp|mountains|snow|meadow|ocean ...>");
        this.say(`${BIOME_LABEL[biome]} を探しています…`);
        setTimeout(() => {
          const found = this.locate(biome, p.x, p.z);
          if (found) this.say(`${BIOME_LABEL[biome]} は (${found.x}, ${found.z}) 付近にあります（約 ${Math.round(Math.hypot(found.x - p.x, found.z - p.z))} ブロック）。 /tp ${found.x} 120 ${found.z}`);
          else this.say("近くには見つかりませんでした");
        }, 20);
        break;
      }
      default:
        this.say(`不明なコマンド: /${cmd}  （/help で一覧）`);
    }
  }

  private locate(biome: number, x0: number, z0: number): { x: number; z: number } | null {
    const step = 32;
    for (let r = step; r <= 5000; r += step) {
      const n = Math.max(8, Math.floor((r * 2 * Math.PI) / step));
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        const x = Math.round(x0 + Math.cos(ang) * r), z = Math.round(z0 + Math.sin(ang) * r);
        if (this.gen.columnInfo(x, z).biome === biome) return { x, z };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- スクリーンショット ----
  private takeScreenshot() {
    this.shotRequested = false;
    this.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      a.download = `hakoniwa-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
      a.href = URL.createObjectURL(blob);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      this.ui.toast("スクリーンショットを保存しました");
    }, "image/png");
  }

  // ---------------------------------------------------------------- テスト用 ----
  blockId(name: string) {
    return BLOCK_BY_NAME.get(name)?.id ?? -1;
  }

  ready(radius = 6) {
    return !!this.world && this.world.loadProgress(radius) > 0.995 && this.world.inFlight === 0;
  }

  /** ヘッドレス確認用：タイトルを飛ばして遊べる状態にする（ポインターロックなし） */
  debugEnter(x?: number, y?: number, z?: number) {
    this.state = "playing";
    this.ui.showTitle(false);
    this.ui.showLoading(false);
    this.ui.setHudVisible(true);
    this.input.locked = true;
    const p = this.player;
    p.setPos(x ?? this.spawn.x + 0.5, y ?? this.spawn.y, z ?? this.spawn.z + 0.5);
    this.audio.vol.master = 0;
  }
}

function IN_WATER_REPLACE(id: number): boolean {
  return id === B.SEAGRASS || id === B.KELP;
}
export { cidx, SEA_LEVEL };
