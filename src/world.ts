// ワールド：チャンクの保持・ストリーミング・メッシュ化ジョブの管理・ブロックの読み書き。
import * as THREE from "three";
import { CHUNK, WORLD_H, cidx, chunkKey, climateIdx } from "./config";
import { B, OPACITY, EMIT } from "./blocks";
import type { Geo, MeshResult } from "./mesher";
import type { TerrainMaterials } from "./render/materials";

export interface SavedChunk {
  blocks: Uint8Array;
  climate: Uint8Array;
  top: Uint8Array;
}

export class Chunk {
  version = 1;
  meshVersion = 0;
  meshed = false;
  meshing = false;
  urgentQueued = false;
  edited = false;
  opaque?: THREE.Mesh;
  cutout?: THREE.Mesh;
  translucent?: THREE.Mesh;
  shOpaque?: THREE.Mesh;
  shCutout?: THREE.Mesh;
  geoms: THREE.BufferGeometry[] = [];
  constructor(
    public cx: number,
    public cz: number,
    public blocks: Uint8Array,
    public climate: Uint8Array,
    public top: Uint8Array,
  ) {}
}

interface RingEntry {
  dx: number;
  dz: number;
  d2: number;
}

export class World {
  chunks = new Map<number, Chunk>();
  pendingGen = new Set<number>();
  saved = new Map<number, SavedChunk>();
  group = new THREE.Group();
  shadowGroup = new THREE.Group();
  renderDistance = 10;
  shadowChunkRadius = 5;
  private workers: Worker[] = [];
  private load: number[] = [];
  private ring: RingEntry[] = [];
  private urgent: Chunk[] = [];
  private lastPcx = 1e9;
  private lastPcz = 1e9;
  private lastR = -1;
  pcx = 0;
  pcz = 0;
  /** 変更があったチャンクの通知（保存用） */
  onEdit?: (c: Chunk) => void;
  meshesBuilt = 0;
  genMs = 0;
  meshMs = 0;
  private meshQueue: any[] = [];
  /** 1フレームで反映するメッシュ数（読み込み中は多めに） */
  meshBudget = 3;

  constructor(public seed: number, private mats: TerrainMaterials, workerCount?: number) {
    const n = workerCount ?? Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
      w.postMessage({ type: "init", seed });
      w.onmessage = (e) => this.onWorker(i, e.data);
      this.workers.push(w);
      this.load.push(0);
    }
    const maxR = 26;
    for (let dx = -maxR; dx <= maxR; dx++)
      for (let dz = -maxR; dz <= maxR; dz++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= maxR * maxR) this.ring.push({ dx, dz, d2 });
      }
    this.ring.sort((a, b) => a.d2 - b.d2);
  }

  get workerCount() {
    return this.workers.length;
  }
  get inFlight() {
    return this.load.reduce((a, b) => a + b, 0);
  }

  dispose() {
    for (const w of this.workers) w.terminate();
    for (const c of this.chunks.values()) this.disposeMeshes(c);
    this.chunks.clear();
  }

  // ---- ワーカー応答 ----------------------------------------------------------
  private onWorker(wi: number, m: any) {
    this.load[wi]--;
    if (m.type === "gen") {
      const key = chunkKey(m.cx, m.cz);
      this.genMs = this.genMs * 0.95 + m.ms * 0.05;
      this.pendingGen.delete(key);
      const dx = m.cx - this.pcx, dz = m.cz - this.pcz;
      const keep = this.renderDistance + 3;
      if (dx * dx + dz * dz > keep * keep) return;
      if (this.chunks.has(key)) return;
      this.chunks.set(key, new Chunk(m.cx, m.cz, m.blocks, m.climate, m.top));
    } else if (m.type === "mesh") {
      this.meshMs = this.meshMs * 0.95 + m.ms * 0.05;
      const c = this.chunks.get(chunkKey(m.cx, m.cz));
      if (!c) return;
      c.meshing = false;
      c.meshVersion = m.version;
      c.meshed = true;
      // GPUへのアップロードが1フレームに集中しないようキューに積む（編集によるものは即時反映）
      if (c.urgentQueued || this.meshQueue.length === 0 && this.meshBudget >= 99) this.applyMeshes(c, m.result as MeshResult);
      else this.meshQueue.push({ c, r: m.result });
    }
  }

  private flushMeshQueue() {
    let n = this.meshBudget;
    while (n-- > 0 && this.meshQueue.length) {
      const it = this.meshQueue.shift();
      if (!this.chunks.has(chunkKey(it.c.cx, it.c.cz))) continue;
      this.applyMeshes(it.c, it.r as MeshResult);
    }
  }

  private makeMesh(g: Geo, mat: THREE.Material, cx: number, cz: number, geo?: THREE.BufferGeometry): { mesh: THREE.Mesh; geo: THREE.BufferGeometry } {
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3));
      geo.setAttribute("uv", new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute("aData", new THREE.BufferAttribute(g.data, 4, false));
      geo.setAttribute("aLight", new THREE.BufferAttribute(g.light, 4, true));
      geo.setAttribute("aColor", new THREE.BufferAttribute(g.color, 4, true));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      const pad = 1.5;
      const box = new THREE.Box3(new THREE.Vector3(-pad, g.minY - pad, -pad), new THREE.Vector3(CHUNK + pad, g.maxY + pad, CHUNK + pad));
      geo.boundingBox = box;
      geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx * CHUNK, 0, cz * CHUNK);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.updateMatrix();
    mesh.matrixWorld.copy(mesh.matrix);
    return { mesh, geo };
  }

  private disposeMeshes(c: Chunk) {
    for (const m of [c.opaque, c.cutout, c.translucent]) if (m) this.group.remove(m);
    for (const m of [c.shOpaque, c.shCutout]) if (m) this.shadowGroup.remove(m);
    for (const g of c.geoms) g.dispose();
    c.geoms = [];
    c.opaque = c.cutout = c.translucent = c.shOpaque = c.shCutout = undefined;
  }

  private applyMeshes(c: Chunk, r: MeshResult) {
    this.disposeMeshes(c);
    const within = this.shadowVisible(c);
    if (r.opaque) {
      const { mesh, geo } = this.makeMesh(r.opaque, this.mats.opaque, c.cx, c.cz);
      c.opaque = mesh;
      c.geoms.push(geo);
      this.group.add(mesh);
      const s = this.makeMesh(r.opaque, this.mats.shadowOpaque, c.cx, c.cz, geo).mesh;
      s.visible = within;
      c.shOpaque = s;
      this.shadowGroup.add(s);
    }
    if (r.cutout) {
      const { mesh, geo } = this.makeMesh(r.cutout, this.mats.cutout, c.cx, c.cz);
      c.cutout = mesh;
      c.geoms.push(geo);
      this.group.add(mesh);
      const s = this.makeMesh(r.cutout, this.mats.shadowCutout, c.cx, c.cz, geo).mesh;
      s.visible = within;
      c.shCutout = s;
      this.shadowGroup.add(s);
    }
    if (r.translucent) {
      const { mesh, geo } = this.makeMesh(r.translucent, this.mats.translucent, c.cx, c.cz);
      mesh.renderOrder = 1;
      c.translucent = mesh;
      c.geoms.push(geo);
      this.group.add(mesh);
    }
    this.meshesBuilt++;
  }

  private shadowVisible(c: Chunk) {
    const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
    const r = this.shadowChunkRadius;
    return dx * dx + dz * dz <= r * r;
  }

  updateShadowRange() {
    for (const c of this.chunks.values()) {
      const v = this.shadowVisible(c);
      if (c.shOpaque) c.shOpaque.visible = v;
      if (c.shCutout) c.shCutout.visible = v;
    }
  }

  // ---- ストリーミング -------------------------------------------------------
  private neighborsReady(c: Chunk): boolean {
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        if (!this.chunks.has(chunkKey(c.cx + dx, c.cz + dz))) return false;
      }
    return true;
  }

  private nextJob(): { type: "gen" | "mesh"; cx: number; cz: number; chunk?: Chunk } | null {
    // 編集されたチャンクの再メッシュを最優先
    for (let i = 0; i < this.urgent.length; ) {
      const c = this.urgent[i];
      if (!this.chunks.has(chunkKey(c.cx, c.cz)) || c.meshVersion === c.version) {
        c.urgentQueued = false;
        this.urgent.splice(i, 1);
        continue;
      }
      if (!c.meshing && this.neighborsReady(c)) return { type: "mesh", cx: c.cx, cz: c.cz, chunk: c };
      i++;
    }
    const R = this.renderDistance;
    const genR2 = (R + 1) * (R + 1);
    const meshR2 = R * R;
    for (let i = 0; i < this.ring.length; i++) {
      const e = this.ring[i];
      if (e.d2 > genR2) break;
      const cx = this.pcx + e.dx, cz = this.pcz + e.dz;
      const key = chunkKey(cx, cz);
      const c = this.chunks.get(key);
      if (!c) {
        if (this.pendingGen.has(key)) continue;
        const sv = this.saved.get(key);
        if (sv) {
          this.chunks.set(key, new Chunk(cx, cz, sv.blocks, sv.climate, sv.top));
          this.chunks.get(key)!.edited = true;
          continue;
        }
        return { type: "gen", cx, cz };
      }
      if (e.d2 <= meshR2 && c.meshVersion !== c.version && !c.meshing && this.neighborsReady(c)) {
        return { type: "mesh", cx, cz, chunk: c };
      }
    }
    return null;
  }

  update(px: number, pz: number) {
    this.flushMeshQueue();
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    this.pcx = pcx;
    this.pcz = pcz;
    if (pcx !== this.lastPcx || pcz !== this.lastPcz || this.renderDistance !== this.lastR) {
      this.lastPcx = pcx;
      this.lastPcz = pcz;
      this.lastR = this.renderDistance;
      this.unloadFar();
      this.updateShadowRange();
    }
    for (let guard = 0; guard < this.workers.length * 3; guard++) {
      let wi = 0;
      for (let i = 1; i < this.load.length; i++) if (this.load[i] < this.load[wi]) wi = i;
      if (this.load[wi] >= 2) break;
      const job = this.nextJob();
      if (!job) break;
      if (job.type === "gen") {
        this.pendingGen.add(chunkKey(job.cx, job.cz));
        this.workers[wi].postMessage({ type: "gen", cx: job.cx, cz: job.cz });
      } else {
        const c = job.chunk!;
        c.meshing = true;
        const blocks: Uint8Array[] = [], climate: Uint8Array[] = [];
        for (let dx = -1; dx <= 1; dx++)
          for (let dz = -1; dz <= 1; dz++) {
            const n = this.chunks.get(chunkKey(c.cx + dx, c.cz + dz))!;
            blocks.push(n.blocks);
            climate.push(n.climate);
          }
        this.workers[wi].postMessage({ type: "mesh", cx: c.cx, cz: c.cz, version: c.version, blocks, climate });
      }
      this.load[wi]++;
    }
  }

  private unloadFar() {
    const keep = this.renderDistance + 3;
    const k2 = keep * keep;
    for (const [key, c] of this.chunks) {
      const dx = c.cx - this.pcx, dz = c.cz - this.pcz;
      if (dx * dx + dz * dz > k2) {
        if (c.edited) this.saved.set(key, { blocks: c.blocks, climate: c.climate, top: c.top });
        this.disposeMeshes(c);
        this.chunks.delete(key);
      }
    }
  }

  // ---- 状態の問い合わせ -----------------------------------------------------
  /** 範囲内でメッシュ化が済んだチャンクの割合（0..1） */
  loadProgress(radius: number): number {
    let total = 0, done = 0;
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        total++;
        const c = this.chunks.get(chunkKey(this.pcx + dx, this.pcz + dz));
        if (c && c.meshed) done++;
      }
    return total ? done / total : 1;
  }

  meshedCount() {
    let n = 0;
    for (const c of this.chunks.values()) if (c.meshed) n++;
    return n;
  }

  // ---- ブロック操作 ---------------------------------------------------------
  /** 未ロードは -1 */
  getBlock(x: number, y: number, z: number): number {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_H) return B.AIR;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return -1;
    return c.blocks[cidx(x & 15, y, z & 15)];
  }

  getChunkAt(x: number, z: number) {
    return this.chunks.get(chunkKey(x >> 4, z >> 4));
  }

  /** 光を遮る最も高いブロックの y+1（0 = なし）。未ロードは 0 */
  columnTop(x: number, z: number): number {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return c ? c.top[(x & 15) * CHUNK + (z & 15)] : 0;
  }

  /** [biome, temp, humid]（未ロードなら null） */
  climateAt(x: number, z: number): [number, number, number] | null {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return null;
    const i = climateIdx(x & 15, z & 15);
    return [c.climate[i], c.climate[i + 1], c.climate[i + 2]];
  }

  private bump(c: Chunk | undefined, urgent: boolean) {
    if (!c) return;
    c.version++;
    if (urgent && !c.urgentQueued) {
      c.urgentQueued = true;
      this.urgent.push(c);
    }
  }

  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 1 || y >= WORLD_H) return false;
    const cx = x >> 4, cz = z >> 4;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return false;
    const lx = x & 15, lz = z & 15;
    const i = cidx(lx, y, lz);
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    c.edited = true;
    // 最上層マップの更新
    const ti = lx * CHUNK + lz;
    if (OPACITY[id] > 0) {
      if (y + 1 > c.top[ti]) c.top[ti] = y + 1;
    } else if (y + 1 === c.top[ti]) {
      let yy = y - 1;
      while (yy > 0 && OPACITY[c.blocks[cidx(lx, yy, lz)]] === 0) yy--;
      c.top[ti] = yy + 1;
    }
    this.bump(c, true);
    // 隣接チャンク：境界付近、または光源に関わる変更は広めに再メッシュ
    const lightChange = EMIT[old] > 0 || EMIT[id] > 0 || OPACITY[old] !== OPACITY[id];
    const near = lightChange ? (EMIT[old] > 0 || EMIT[id] > 0 ? 15 : 6) : 1;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const ex = dx < 0 ? lx : dx > 0 ? 15 - lx : 99;
        const ez = dz < 0 ? lz : dz > 0 ? 15 - lz : 99;
        const dist = Math.min(dx !== 0 ? ex : 99, dz !== 0 ? ez : 99);
        // 斜め隣は両方の軸が近いときだけ
        if (dx !== 0 && dz !== 0 && Math.max(ex, ez) > near) continue;
        if (dist > near) continue;
        this.bump(this.chunks.get(chunkKey(cx + dx, cz + dz)), true);
      }
    this.onEdit?.(c);
    return true;
  }
}
