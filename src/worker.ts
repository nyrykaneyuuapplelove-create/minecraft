// 地形生成とメッシュ生成を担当するWorker。状態を持たないため複数並列で動かせる。
import { WorldGen } from "./worldgen";
import { meshChunk, type Geo } from "./mesher";

interface Ctx {
  postMessage(m: unknown, t?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
}
const ctx = self as unknown as Ctx;
let gen: WorldGen | null = null;

function transfers(g: Geo | null, out: Transferable[]) {
  if (!g) return;
  out.push(g.pos.buffer, g.uv.buffer, g.data.buffer, g.light.buffer, g.color.buffer, g.index.buffer);
}

ctx.onmessage = (e: MessageEvent) => {
  const m = e.data;
  switch (m.type) {
    case "init":
      gen = new WorldGen(m.seed);
      break;
    case "gen": {
      const t0 = performance.now();
      const r = gen!.generate(m.cx, m.cz);
      ctx.postMessage({ type: "gen", cx: m.cx, cz: m.cz, blocks: r.blocks, climate: r.climate, top: r.top, ms: performance.now() - t0 }, [r.blocks.buffer, r.climate.buffer, r.top.buffer]);
      break;
    }
    case "mesh": {
      const t0 = performance.now();
      const r = meshChunk(m.blocks, m.climate, m.cx, m.cz);
      const ms = performance.now() - t0;
      const t: Transferable[] = [];
      transfers(r.opaque, t);
      transfers(r.cutout, t);
      transfers(r.translucent, t);
      ctx.postMessage({ type: "mesh", cx: m.cx, cz: m.cz, version: m.version, result: r, ms }, t);
      break;
    }
  }
};
