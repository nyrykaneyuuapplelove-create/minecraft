// セーブデータ：プレイヤー状態は localStorage、編集されたチャンクは IndexedDB に保存する。
import type { Chunk, SavedChunk } from "./world";
import { chunkKey } from "./config";

export interface SaveMeta {
  seed: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  tick: number;
  dayCount: number;
  hotbar: number[];
  selected: number;
  flying: boolean;
}

const META_KEY = "hakoniwa:save:v1";
const DB_NAME = "hakoniwa";
const STORE = "chunks";

export function loadMeta(): SaveMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw) as SaveMeta;
  } catch {
    /* ignore */
  }
  return null;
}
export function saveMeta(m: SaveMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(m));
  } catch {
    /* ignore */
  }
}
export function clearMeta() {
  try {
    localStorage.removeItem(META_KEY);
  } catch {
    /* ignore */
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("seed", "seed", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class ChunkStore {
  private db: IDBDatabase | null = null;
  private dirty = new Map<number, Chunk>();
  private timer = 0;
  seed = 0;

  async open(seed: number): Promise<Map<number, SavedChunk>> {
    this.seed = seed;
    this.db = await openDb();
    const out = new Map<number, SavedChunk>();
    if (!this.db) return out;
    const db = this.db;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).index("seed").getAll(seed);
        req.onsuccess = () => {
          for (const r of req.result as { key: number; blocks: Uint8Array; climate: Uint8Array; top: Uint8Array }[]) out.set(r.key, { blocks: r.blocks, climate: r.climate, top: r.top });
          resolve();
        };
        req.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    return out;
  }

  mark(c: Chunk) {
    this.dirty.set(chunkKey(c.cx, c.cz), c);
    if (!this.timer) this.timer = window.setTimeout(() => this.flush(), 2500);
  }

  flush() {
    this.timer = 0;
    const db = this.db;
    if (!db || this.dirty.size === 0) return;
    const items = [...this.dirty.entries()];
    this.dirty.clear();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const [key, c] of items) {
        st.put({ id: `${this.seed}:${key}`, seed: this.seed, key, blocks: c.blocks.slice(), climate: c.climate.slice(), top: c.top.slice() });
      }
    } catch {
      /* ignore */
    }
  }

  /** 指定シードのチャンクをすべて削除 */
  static async wipe(seed: number): Promise<void> {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        const idx = tx.objectStore(STORE).index("seed");
        const req = idx.openKeyCursor(IDBKeyRange.only(seed));
        req.onsuccess = () => {
          const cur = req.result;
          if (cur) {
            tx.objectStore(STORE).delete(cur.primaryKey);
            cur.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}
