// 遠景の地形（LOD）。ロード済みチャンクの外側に、霞の中の山並みや森の色を描く。
import * as THREE from "three";
import { GLSL_UNIFORMS, GLSL_MATH, GLSL_SKY_FN, GLSL_CLOUD_FN } from "./render/glslCommon";

const VS = /* glsl */ `
attribute vec3 aColor;
attribute float aWater;
varying vec3 vWorld;
varying vec3 vCol;
varying float vWater;
void main() {
  vec3 p = position;
  p.y -= (aWater > 0.5 ? 0.3 : 1.6);
  vWorld = p;
  vCol = pow(aColor, vec3(2.2));
  vWater = aWater;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const FS = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_MATH}
${GLSL_SKY_FN}
${GLSL_CLOUD_FN}
uniform vec2 uCenter;
uniform float uHole;
varying vec3 vWorld;
varying vec3 vCol;
varying float vWater;
void main() {
  if (length(vWorld.xz - uCenter) < uHole) discard;
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  V /= max(dist, 0.001);
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (N.y < 0.0) N = -N;
  float ndl = max(dot(N, uLightDir), 0.0);
  // 雲の影
  float cs = 1.0;
  if (uCloudShadow > 0.0) {
    float t = (uCloudAlt - vWorld.y) / max(uLightDir.y, 0.15);
    cs = 1.0 - cloudDensity(vWorld.xz + uLightDir.xz * t) * uCloudShadow;
  }
  vec3 amb = mix(uGround, uAmbient, N.y * 0.5 + 0.5);
  vec3 col = vCol * (amb + uLightColor * ndl * cs);
  if (vWater > 0.5) {
    vec3 R = reflect(V, vec3(0.0, 1.0, 0.0));
    float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(-V, vec3(0.0, 1.0, 0.0)), 0.0, 1.0), 5.0);
    col = vCol * (uAmbient * 0.9 + uLightColor * 0.15) * 0.8 + skyColor(R) * fres * 0.9;
  }
  // 霞：読み込み範囲の端からなめらかにつながる
  float haze = 1.0 - exp(-dist * uFogDensity);
  float edge = smoothstep(uFogEnd * 0.78, uFogEnd * 0.985, dist) * uEdgeFog;
  float far = smoothstep(uFogEnd, 2200.0, dist) * 0.8;
  float f = 1.0 - (1.0 - haze) * (1.0 - edge) * (1.0 - far);
  float mistF = mistAmount(vWorld, dist);
  f = 1.0 - (1.0 - f) * (1.0 - mistF);
  vec3 fogC = fogColorFor(V);
  fogC += uGlowColor * pow(max(dot(V, uSunDir), 0.0), 6.0) * 0.22 * uGlowAmount * mistF;
  if (uUnderwater > 0.5) { f = 1.0 - exp(-dist * 0.055); fogC = uWaterFog; }
  col = mix(col, fogC, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Lod {
  mesh: THREE.Mesh | null = null;
  enabled = true;
  private worker: Worker;
  private busy = false;
  private cx = 1e9;
  private cz = 1e9;
  private lastHole = -1;
  private mat: THREE.ShaderMaterial;
  private uCenter = { value: new THREE.Vector2() };
  private uHole = { value: 0 };
  group = new THREE.Group();
  ms = 0;

  constructor(seed: number, shared: Record<string, THREE.IUniform>) {
    this.worker = new Worker(new URL("./lodWorker.ts", import.meta.url), { type: "module" });
    this.worker.postMessage({ type: "init", seed });
    this.worker.onmessage = (e) => this.onResult(e.data);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { ...shared, uCenter: this.uCenter, uHole: this.uHole },
    });
  }

  dispose() {
    this.worker.terminate();
    this.mesh?.geometry.dispose();
  }

  private onResult(m: { cx: number; cz: number; hole: number; ms: number; pos: Float32Array; col: Uint8Array; flag: Uint8Array; idx: Uint32Array }) {
    this.busy = false;
    this.ms = m.ms;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(m.pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(m.col, 3, true));
    geo.setAttribute("aWater", new THREE.BufferAttribute(m.flag, 1));
    geo.setIndex(new THREE.BufferAttribute(m.idx, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(m.cx, 80, m.cz), 4000);
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.group.add(this.mesh);
    this.cx = m.cx;
    this.cz = m.cz;
    this.lastHole = m.hole;
  }

  /** 毎フレーム呼ぶ。プレイヤーが十分動いたら再構築を依頼 */
  update(px: number, pz: number, renderDistanceChunks: number) {
    this.group.visible = this.enabled;
    if (!this.enabled) return;
    const hole = Math.max(0, renderDistanceChunks * 16 - 8);
    this.uCenter.value.set(px, pz);
    this.uHole.value = hole;
    const moved = Math.hypot(px - this.cx, pz - this.cz);
    if (!this.busy && (moved > 112 || Math.abs(hole - this.lastHole) > 1)) {
      this.busy = true;
      // 格子の原点をそろえて、動いても模様がちらつかないようにする
      const cx = Math.round(px / 32) * 32, cz = Math.round(pz / 32) * 32;
      this.worker.postMessage({ type: "build", id: 0, cx, cz });
    }
  }
}
