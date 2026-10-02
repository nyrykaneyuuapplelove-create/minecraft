import "./style.css";
import { Game } from "./game";
import { loadMeta } from "./persistence";
import { seedFromString } from "./noise";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const root = document.getElementById("ui") as HTMLElement;
const params = new URLSearchParams(location.search);

let seed: number;
if (params.has("seed")) seed = seedFromString(params.get("seed")!);
else {
  const m = loadMeta();
  seed = m ? m.seed : Math.floor(Math.random() * 2147483647);
}

if (!(window as unknown as { WebGL2RenderingContext?: unknown }).WebGL2RenderingContext) {
  root.innerHTML = `<div style="position:absolute;inset:0;display:grid;place-items:center;color:#fff;font:16px sans-serif;text-align:center;padding:24px">WebGL2 に対応したブラウザ（最新の Chrome / Edge / Firefox / Safari）でお楽しみください。</div>`;
  root.style.pointerEvents = "auto";
} else {
  const game = new Game(canvas, seed, root);
  (window as unknown as { __hk: Game }).__hk = game;
}
