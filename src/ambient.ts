// 環境演出（GPU駆動）：雨・雨の波紋・雪・桜の花びら・落ち葉・蛍・光の粒
// プレイヤー周囲の円柱領域に固定のランダム位置を敷き詰め、頂点シェーダーだけで動かす。
import * as THREE from "three";
import { OPAQUE } from "./blocks";
import { WORLD_H } from "./config";
import type { World } from "./world";
import { Biome } from "./biomes";

const SIZE = 64;

/** プレイヤー周囲の列ごとの高さ（R=光を遮る最上面 / G=不透明な地面の高さ）を持つテクスチャ */
export class HeightField {
  data = new Uint8Array(SIZE * SIZE * 2);
  tex: THREE.DataTexture;
  private lastX = 1e9;
  private lastZ = 1e9;
  private timer = 0;
  constructor() {
    this.tex = new THREE.DataTexture(this.data, SIZE, SIZE, THREE.RGFormat, THREE.UnsignedByteType);
    this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    this.tex.needsUpdate = true;
  }
  update(world: World, px: number, pz: number, dt: number) {
    this.timer -= dt;
    const cx = Math.floor(px), cz = Math.floor(pz);
    if (this.timer > 0 && Math.abs(cx - this.lastX) < 4 && Math.abs(cz - this.lastZ) < 4) return;
    this.timer = 0.5;
    this.lastX = cx;
    this.lastZ = cz;
    const x0 = cx - SIZE / 2, z0 = cz - SIZE / 2;
    for (let wx = x0; wx < x0 + SIZE; wx += 16) {
      for (let wz = z0; wz < z0 + SIZE; wz += 16) {
        const ch = world.getChunkAt(wx, wz);
        for (let i = 0; i < 16; i++)
          for (let j = 0; j < 16; j++) {
            const x = (wx & ~15) + i, z = (wz & ~15) + j;
            if (x < x0 || x >= x0 + SIZE || z < z0 || z >= z0 + SIZE) continue;
            const di = ((z & 63) * SIZE + (x & 63)) * 2;
            if (!ch) { this.data[di] = 0; this.data[di + 1] = 0; continue; }
            const top = ch.top[(x & 15) * 16 + (z & 15)];
            this.data[di] = top;
            let y = Math.min(top, WORLD_H - 1);
            const base = ((x & 15) * 16 + (z & 15)) * WORLD_H;
            while (y > 0 && !OPAQUE[ch.blocks[base + y]]) y--;
            this.data[di + 1] = y + 1;
          }
      }
    }
    this.tex.needsUpdate = true;
  }
}

const COMMON = /* glsl */ `
uniform vec3 uCam;
uniform float uTime;
uniform float uAmount;
uniform float uRadius;
uniform float uHeight;
uniform float uScale;
uniform vec2 uWind;
uniform sampler2D uTop;
vec2 wrapXZ(vec2 p0, float period) { return p0 + period * floor((uCam.xz - p0) / period + 0.5); }
vec2 columnInfo(vec2 xz) { return texelFetch(uTop, ivec2(int(floor(xz.x)) & 63, int(floor(xz.y)) & 63), 0).rg * 255.0; }
`;

const RAIN_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
varying float vA;
varying vec2 vQ;
void main() {
  float period = uRadius * 2.0;
  vec2 xz = wrapXZ(aSeed.xy * period, period);
  float speed = 17.0 + aSeed.w * 6.0;
  float ph = mod(aSeed.z * uHeight * 2.0 + uTime * speed, uHeight * 2.0);
  float y = uCam.y + uHeight - ph;
  float top = columnInfo(xz).x;
  if (aSeed.w > uAmount || y < top) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 base = vec3(xz.x, y, xz.y) + vec3(uWind.x, 0.0, uWind.y) * 0.08 * (y - uCam.y);
  vec2 toCam = uCam.xz - base.xz;
  vec2 h = toCam / max(length(toCam), 0.001);
  vec3 right = vec3(-h.y, 0.0, h.x);
  float len = 0.9;
  vec3 wp = base + right * position.x * 0.022 + vec3(uWind.x * 0.06, 1.0, uWind.y * 0.06) * (position.y + 0.5) * len;
  float dcam = distance(base, uCam);
  vA = (1.0 - smoothstep(uRadius * 0.5, uRadius, dcam)) * smoothstep(0.0, 0.5, y - top) * smoothstep(1.2, 4.0, dcam);
  vQ = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAIN_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vQ;
void main() {
  float a = vA * 0.3 * (1.0 - abs(vQ.x) * 1.8) * (0.4 + 0.6 * (vQ.y + 0.5));
  gl_FragColor = vec4(uColor, a);
}
`;

const SPLASH_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
varying float vA;
varying vec2 vQ;
void main() {
  float period = uRadius * 2.0;
  vec2 xz = wrapXZ(aSeed.xy * period, period);
  float t = fract(uTime * 1.5 + aSeed.z);
  float top = columnInfo(xz).x;
  if (aSeed.w > uAmount || top < 1.0 || abs(top - uCam.y) > uHeight) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float sc = mix(0.04, 0.3, t);
  vec3 wp = vec3(floor(xz.x) + aSeed.z, top - 0.06, floor(xz.y) + fract(aSeed.w * 7.0)) + vec3(position.x, 0.0, position.y) * sc;
  vA = (1.0 - t) * (1.0 - smoothstep(uRadius * 0.4, uRadius * 0.9, distance(xz, uCam.xz)));
  vQ = position.xy * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const SPLASH_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vQ;
void main() {
  float r = length(vQ);
  float ring = smoothstep(0.55, 0.78, r) * (1.0 - smoothstep(0.86, 1.0, r));
  gl_FragColor = vec4(uColor, ring * vA * 0.55);
}
`;

const SNOW_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
varying float vA;
void main() {
  float period = uRadius * 2.0;
  vec2 xz = wrapXZ(aSeed.xy * period, period);
  float speed = 1.3 + aSeed.w * 1.0;
  float ph = mod(aSeed.z * uHeight * 2.0 + uTime * speed, uHeight * 2.0);
  float y = uCam.y + uHeight - ph;
  float top = columnInfo(xz).x;
  if (aSeed.w > uAmount || y < top) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = vec3(xz.x, y, xz.y);
  p.x += sin(uTime * 0.7 + aSeed.z * 40.0) * 0.55 + uWind.x * 0.5 * ph * 0.1;
  p.z += cos(uTime * 0.6 + aSeed.x * 40.0) * 0.55 + uWind.y * 0.5 * ph * 0.1;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp((0.05 + aSeed.w * 0.03) * uScale / max(-mv.z, 0.1), 1.0, 28.0);
  vA = (1.0 - smoothstep(uRadius * 0.55, uRadius, distance(p, uCam))) * smoothstep(0.0, 0.4, y - top);
  gl_Position = projectionMatrix * mv;
}
`;
const SOFT_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  gl_FragColor = vec4(uColor, vA * smoothstep(1.0, 0.25, d) * 0.9);
}
`;

const PETAL_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform vec3 uColA;
uniform vec3 uColB;
uniform float uSizeP;
varying float vA;
varying vec3 vC;
varying float vRot;
void main() {
  float period = uRadius * 2.0;
  vec2 xz = wrapXZ(aSeed.xy * period, period);
  float speed = 0.75 + aSeed.w * 0.55;
  float ph = mod(aSeed.z * uHeight * 2.0 + uTime * speed, uHeight * 2.0);
  vec2 ci = columnInfo(xz);
  float y = uCam.y + uHeight * 0.85 - ph;
  float ground = ci.y;
  if (aSeed.w > uAmount || y < ground + 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float t = uTime;
  vec3 p = vec3(xz.x, y, xz.y);
  p.x += sin(t * (0.9 + aSeed.w) + aSeed.z * 30.0) * 1.4 + uWind.x * 0.9 * ph * 0.25;
  p.z += cos(t * (0.8 + aSeed.w * 0.7) + aSeed.x * 30.0) * 1.4 + uWind.y * 0.9 * ph * 0.25;
  p.y += sin(t * 2.0 + aSeed.z * 50.0) * 0.12;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uSizeP * (0.7 + aSeed.w * 0.6) * uScale / max(-mv.z, 0.1), 1.0, 40.0);
  vA = (1.0 - smoothstep(uRadius * 0.6, uRadius, distance(p, uCam))) * smoothstep(0.05, 0.5, y - ground);
  vC = mix(uColA, uColB, fract(aSeed.z * 13.7));
  vRot = t * (1.0 + aSeed.w * 2.0) + aSeed.z * 6.28;
  gl_Position = projectionMatrix * mv;
}
`;
const PETAL_FS = /* glsl */ `
uniform vec3 uLight;
varying float vA;
varying vec3 vC;
varying float vRot;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float e = q.x * q.x * 1.0 + q.y * q.y * 3.2;
  if (e > 1.0) discard;
  gl_FragColor = vec4(vC * uLight, vA);
}
`;

const GLOW_VS = /* glsl */ `
${COMMON}
attribute vec4 aSeed;
uniform float uSizeP;
uniform float uBlink;
varying float vA;
void main() {
  float period = uRadius * 2.0;
  vec2 xz = wrapXZ(aSeed.xy * period, period);
  vec2 ci = columnInfo(xz);
  float t = uTime;
  float baseY = ci.y + 0.6 + fract(aSeed.z * 5.31) * 2.8;
  vec3 p = vec3(xz.x, baseY, xz.y);
  p += vec3(sin(t * 0.5 + aSeed.z * 20.0), sin(t * 0.7 + aSeed.w * 20.0) * 0.4, cos(t * 0.45 + aSeed.x * 20.0)) * 1.4;
  if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float blink = mix(1.0, smoothstep(0.25, 0.95, sin(t * (1.2 + aSeed.w * 1.5) + aSeed.z * 40.0) * 0.5 + 0.5), uBlink);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_PointSize = clamp(uSizeP * uScale / max(-mv.z, 0.1), 1.0, 40.0);
  vA = blink * (1.0 - smoothstep(uRadius * 0.55, uRadius, distance(p, uCam)));
  gl_Position = projectionMatrix * mv;
}
`;
const GLOW_FS = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float g = exp(-d * 3.2);
  gl_FragColor = vec4(uColor * g, vA * g);
}
`;

function seeds(n: number) {
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = Math.random();
  return a;
}

export interface AmbientCtx {
  cam: THREE.Vector3;
  time: number;
  rain: number; // 0..1 降水強度
  snowing: boolean;
  wind: THREE.Vector2;
  biome: number;
  night: number;
  day: number;
  sunVis: number;
  ambient: THREE.Vector3;
  lightColor: THREE.Vector3;
  underwater: boolean;
  outdoor: number;
  particles: boolean;
  scale: number;
}

interface Layer {
  obj: THREE.Object3D;
  mat: THREE.ShaderMaterial;
  amount: number;
}

export class Ambient {
  group = new THREE.Group();
  hf = new HeightField();
  private shared: Record<string, THREE.IUniform>;
  private layers: Record<string, Layer> = {};
  private target: Record<string, number> = {};

  constructor() {
    this.shared = {
      uCam: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uScale: { value: 800 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uTop: { value: this.hf.tex },
    };
    const sh = this.shared;
    const instanced = (name: string, vs: string, fs: string, count: number, radius: number, height: number, extra: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NormalBlending) => {
      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute("position", base.getAttribute("position"));
      geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds(count), 4));
      geo.instanceCount = count;
      const mat = new THREE.ShaderMaterial({
        vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending,
        uniforms: { ...sh, uAmount: { value: 0 }, uRadius: { value: radius }, uHeight: { value: height }, ...extra },
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.layers[name] = { obj: mesh, mat, amount: 0 };
    };
    const points = (name: string, vs: string, fs: string, count: number, radius: number, height: number, extra: Record<string, THREE.IUniform>, blending: THREE.Blending = THREE.NormalBlending) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds(count), 4));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.ShaderMaterial({
        vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending,
        uniforms: { ...sh, uAmount: { value: 0 }, uRadius: { value: radius }, uHeight: { value: height }, ...extra },
      });
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      p.renderOrder = 2;
      this.group.add(p);
      this.layers[name] = { obj: p, mat, amount: 0 };
    };
    instanced("rain", RAIN_VS, RAIN_FS, 5200, 16, 14, { uColor: { value: new THREE.Vector3(0.7, 0.8, 0.95) } });
    instanced("splash", SPLASH_VS, SPLASH_FS, 900, 14, 14, { uColor: { value: new THREE.Vector3(0.8, 0.9, 1) } });
    points("snow", SNOW_VS, SOFT_FS, 3600, 16, 14, { uColor: { value: new THREE.Vector3(1, 1, 1) } });
    const petalLight = { value: new THREE.Vector3(1, 1, 1) };
    points("petal", PETAL_VS, PETAL_FS, 700, 18, 16, { uColA: { value: new THREE.Vector3(1.0, 0.6, 0.78) }, uColB: { value: new THREE.Vector3(1.0, 0.82, 0.9) }, uSizeP: { value: 0.16 }, uLight: petalLight });
    points("maple", PETAL_VS, PETAL_FS, 520, 18, 16, { uColA: { value: new THREE.Vector3(0.9, 0.34, 0.06) }, uColB: { value: new THREE.Vector3(0.95, 0.62, 0.1) }, uSizeP: { value: 0.22 }, uLight: petalLight });
    points("leaf", PETAL_VS, PETAL_FS, 180, 18, 16, { uColA: { value: new THREE.Vector3(0.22, 0.5, 0.1) }, uColB: { value: new THREE.Vector3(0.4, 0.62, 0.14) }, uSizeP: { value: 0.2 }, uLight: petalLight });
    points("firefly", GLOW_VS, GLOW_FS, 260, 20, 6, { uColor: { value: new THREE.Vector3(1.1, 1.5, 0.3) }, uSizeP: { value: 0.2 }, uBlink: { value: 1 } }, THREE.AdditiveBlending);
    points("mote", GLOW_VS, GLOW_FS, 420, 18, 6, { uColor: { value: new THREE.Vector3(1.0, 0.92, 0.7) }, uSizeP: { value: 0.07 }, uBlink: { value: 0 } }, THREE.AdditiveBlending);
    this.petalLight = petalLight;
  }
  private petalLight!: THREE.IUniform;

  private fast = false;
  private setAmount(name: string, v: number, dt: number) {
    const l = this.layers[name];
    l.amount += (v - l.amount) * Math.min(1, dt * (this.fast && v < l.amount ? 6 : 0.8));
    if (Math.abs(v - l.amount) < 0.002) l.amount = v;
    l.mat.uniforms.uAmount.value = l.amount;
    l.obj.visible = l.amount > 0.003;
  }

  update(dt: number, c: AmbientCtx, world: World) {
    const s = this.shared;
    (s.uCam.value as THREE.Vector3).copy(c.cam);
    s.uTime.value = c.time;
    s.uScale.value = c.scale;
    (s.uWind.value as THREE.Vector2).copy(c.wind);
    this.hf.update(world, c.cam.x, c.cam.z, dt);

    const lit = new THREE.Vector3().copy(c.ambient).multiplyScalar(0.9).addScaledVector(c.lightColor, 0.16);
    const rainOn = !c.snowing && !c.underwater ? c.rain : 0;
    const snowOn = c.snowing && !c.underwater ? c.rain : 0;
    (this.layers.rain.mat.uniforms.uColor.value as THREE.Vector3).copy(lit).clampScalar(0, 2.5).multiplyScalar(1.1);
    (this.layers.splash.mat.uniforms.uColor.value as THREE.Vector3).copy(lit).clampScalar(0, 2.5);
    (this.layers.snow.mat.uniforms.uColor.value as THREE.Vector3).copy(lit).addScaledVector(c.lightColor, 0.2).clampScalar(0.05, 3);
    this.petalLight.value.copy(lit).addScaledVector(c.lightColor, 0.25).clampScalar(0.03, 3);

    const b = c.biome;
    this.fast = c.underwater || c.outdoor < 0.5;
    const out = Math.min(1, Math.max(0, (c.outdoor - 0.3) / 0.5));
    const calm = (1 - c.rain * 0.6) * out;
    const part = c.particles ? 1 : 0;
    const quiet = c.underwater ? 0 : 1;
    this.setAmount("rain", rainOn * part, dt);
    this.setAmount("splash", rainOn * 0.9 * part, dt);
    this.setAmount("snow", snowOn * part, dt);
    this.setAmount("petal", (b === Biome.CHERRY_GROVE ? 0.85 : 0) * calm * part * quiet, dt);
    this.setAmount("maple", (b === Biome.AUTUMN_FOREST ? 0.7 : 0) * calm * part * quiet, dt);
    this.setAmount("leaf", (b === Biome.BAMBOO_GROVE ? 0.6 : b === Biome.FOREST || b === Biome.BIRCH_FOREST || b === Biome.TAIGA ? 0.35 : 0) * calm * part * quiet, dt);
    const grassy = b === Biome.BAMBOO_GROVE || b === Biome.FOREST || b === Biome.BIRCH_FOREST || b === Biome.PLAINS || b === Biome.MEADOW || b === Biome.SWAMP || b === Biome.CHERRY_GROVE || b === Biome.AUTUMN_FOREST || b === Biome.SAVANNA;
    this.setAmount("firefly", (grassy ? (b === Biome.SWAMP ? 1 : 0.7) : 0) * c.night * (1 - c.rain) * part * quiet * out, dt);
    this.setAmount("mote", (grassy ? 0.5 : 0.15) * c.day * c.sunVis * (1 - c.rain) * part * quiet * (b === Biome.FOREST || b === Biome.BIRCH_FOREST || b === Biome.CHERRY_GROVE ? 1.4 : 1) * out, dt);
  }
}
