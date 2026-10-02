// 一人称で持っているブロックの描画（スイング・持ち替え・歩行の揺れ・視点のなびき）
import * as THREE from "three";
import { BLOCKS, Shape, Tint } from "./blocks";
import { GLSL_MATH } from "./render/glslCommon";

const TINT_RGB: Record<number, [number, number, number]> = {
  [Tint.GRASS]: [0.55, 0.77, 0.32],
  [Tint.FOLIAGE]: [0.34, 0.62, 0.2],
  [Tint.BIRCH]: [0.5, 0.655, 0.333],
  [Tint.SPRUCE]: [0.38, 0.6, 0.38],
  [Tint.AUTUMN]: [0.85, 0.47, 0.12],
  [Tint.WATER]: [0.2, 0.42, 0.86],
};

const FACE_CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

const HAND_VS = /* glsl */ `
attribute vec4 aData;
attribute vec4 aColor;
varying vec2 vUv;
flat varying vec2 vInfo;
varying vec3 vColor;
varying vec3 vN;
vec3 faceNormal(int f) {
  if (f == 0) return vec3(1.0, 0.0, 0.0);
  if (f == 1) return vec3(-1.0, 0.0, 0.0);
  if (f == 2 || f == 6) return vec3(0.0, 1.0, 0.0);
  if (f == 3) return vec3(0.0, -1.0, 0.0);
  if (f == 4) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 0.0, -1.0);
}
void main() {
  vUv = uv;
  vInfo = aData.xy;
  vColor = pow(aColor.rgb, vec3(2.2));
  vN = normalize(mat3(modelViewMatrix) * faceNormal(int(aData.y + 0.5)));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const HAND_FS = /* glsl */ `
${GLSL_MATH}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMask;
uniform vec3 uLightDirV;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uBlockColor;
uniform float uSky;
uniform float uBlk;
uniform float uSun;
varying vec2 vUv;
flat varying vec2 vInfo;
varying vec3 vColor;
varying vec3 vN;
void main() {
  vec4 tex = texture(uAlbedo, vec3(vUv, vInfo.x));
  if (tex.a < 0.5) discard;
  vec4 mask = texture(uMask, vec3(vUv, vInfo.x));
  vec3 albedo = srgb2lin(tex.rgb) * mix(vec3(1.0), vColor, mask.r);
  vec3 N = normalize(vN);
  float ndl = max(dot(N, uLightDirV), 0.0);
  vec3 light = uAmbient * (0.08 + 0.92 * pow(uSky, 1.6)) * (0.72 + 0.28 * N.y) + uLightColor * ndl * uSun * uSky + uBlockColor * pow(uBlk, 2.0);
  vec3 col = albedo * light + albedo * mask.g * 2.2;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function buildItemGeometry(id: number): THREE.BufferGeometry | null {
  const def = BLOCKS[id];
  if (!def) return null;
  const pos: number[] = [], uv: number[] = [], data: number[] = [], col: number[] = [], idx: number[] = [];
  const tint = TINT_RGB[def.tint] ?? [1, 1, 1];
  const quad = (p: number[][], uvs: number[][], tex: number, face: number) => {
    const v0 = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      uv.push(uvs[i][0], uvs[i][1]);
      data.push(tex, face, 0, 0);
      col.push(tint[0], tint[1], tint[2], 1);
    }
    idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
  };
  if (def.shape === Shape.CROSS) {
    quad([[0, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 0]], [[0, 1], [1, 1], [1, 0], [0, 0]], def.side, 6);
    quad([[0, 0, 1], [1, 0, 0], [1, 1, 0], [0, 1, 1]], [[0, 1], [1, 1], [1, 0], [0, 0]], def.side, 6);
    quad([[1, 0, 1], [0, 0, 0], [0, 1, 0], [1, 1, 1]], [[0, 1], [1, 1], [1, 0], [0, 0]], def.side, 6);
    quad([[1, 0, 0], [0, 0, 1], [0, 1, 1], [1, 1, 0]], [[0, 1], [1, 1], [1, 0], [0, 0]], def.side, 6);
  } else {
    const boxes = def.shape === Shape.BOX && def.boxes ? def.boxes : [[0, 0, 0, 1, 1, 1] as [number, number, number, number, number, number]];
    for (const [x0, y0, z0, x1, y1, z1] of boxes) {
      for (let f = 0; f < 6; f++) {
        const tex = f === 2 ? def.top : f === 3 ? def.bottom : def.side;
        const p: number[][] = [], uvs: number[][] = [];
        for (let c = 0; c < 4; c++) {
          const cor = FACE_CORNERS[f][c];
          const px = cor[0] ? x1 : x0, py = cor[1] ? y1 : y0, pz = cor[2] ? z1 : z0;
          p.push([px, py, pz]);
          let u: number, v: number;
          switch (f) {
            case 0: u = 1 - pz; v = py; break;
            case 1: u = pz; v = py; break;
            case 2: u = px; v = 1 - pz; break;
            case 3: u = px; v = pz; break;
            case 4: u = px; v = py; break;
            default: u = 1 - px; v = py; break;
          }
          uvs.push([u, 1 - v]);
        }
        quad(p, uvs, tex, f);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  // 中心を原点にし、最大寸法が1になるよう正規化
  const bb = new THREE.Box3();
  for (let i = 0; i < pos.length; i += 3) bb.expandByPoint(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]));
  const size = bb.getSize(new THREE.Vector3());
  const ctr = bb.getCenter(new THREE.Vector3());
  const sc = 1 / Math.max(size.x, size.y, size.z, 0.01);
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] = (pos[i] - ctr.x) * sc;
    pos[i + 1] = (pos[i + 1] - ctr.y) * sc;
    pos[i + 2] = (pos[i + 2] - ctr.z) * sc;
  }
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("aData", new THREE.Float32BufferAttribute(data, 4));
  geo.setAttribute("aColor", new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  return geo;
}

export interface HandParams {
  bob: number; // 歩行の揺れの位相
  bobAmount: number; // 0..1
  lookDX: number;
  lookDY: number;
  lightDirView: THREE.Vector3;
  lightColor: THREE.Vector3;
  ambient: THREE.Vector3;
  blockColor: THREE.Vector3;
  sky: number;
  blk: number;
  sun: number;
  visible: boolean;
  sprinting: boolean;
}

export class Hand {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
  private group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private cache = new Map<number, THREE.BufferGeometry>();
  private mat: THREE.ShaderMaterial;
  private swing = 1;
  private equip = 1;
  private placeKick = 0;
  private current = -1;
  private sway = new THREE.Vector2();
  private baseScale = 1;

  constructor(albedo: THREE.Texture, mask: THREE.Texture) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: HAND_VS,
      fragmentShader: HAND_FS,
      uniforms: {
        uAlbedo: { value: albedo },
        uMask: { value: mask },
        uLightDirV: { value: new THREE.Vector3(0, 1, 0) },
        uLightColor: { value: new THREE.Vector3() },
        uAmbient: { value: new THREE.Vector3() },
        uBlockColor: { value: new THREE.Vector3() },
        uSky: { value: 1 },
        uBlk: { value: 0 },
        uSun: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
    this.scene.add(this.group);
    this.camera.position.set(0, 0, 0);
  }

  setAspect(a: number) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  setBlock(id: number) {
    if (id === this.current) return;
    this.current = id;
    this.equip = 0;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh = null;
    }
    if (!id) return;
    let g = this.cache.get(id);
    if (!g) {
      g = buildItemGeometry(id) ?? undefined;
      if (g) this.cache.set(id, g);
    }
    if (!g) return;
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    const def = BLOCKS[id];
    this.baseScale = def.shape === Shape.CUBE || def.shape === Shape.LIQUID ? 0.25 : def.name === "torch" ? 0.4 : 0.32;
    this.group.add(this.mesh);
  }

  punch() {
    this.swing = 0;
  }
  kick() {
    this.placeKick = 1;
  }

  update(dt: number, p: HandParams) {
    this.swing = Math.min(1, this.swing + dt / 0.27);
    this.equip = Math.min(1, this.equip + dt / 0.2);
    this.placeKick = Math.max(0, this.placeKick - dt * 5);
    // 視点移動に合わせて少し遅れてなびく
    this.sway.x += (-p.lookDX * 0.0012 - this.sway.x) * Math.min(1, dt * 12);
    this.sway.y += (p.lookDY * 0.0012 - this.sway.y) * Math.min(1, dt * 12);
    this.sway.x = THREE.MathUtils.clamp(this.sway.x, -0.08, 0.08);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y, -0.08, 0.08);

    const mesh = this.mesh;
    this.group.visible = !!mesh && p.visible;
    if (!mesh) return;

    const sw = this.swing;
    const sq = Math.sqrt(sw);
    const s1 = Math.sin(sq * Math.PI);
    const s2 = Math.sin(sw * Math.PI);
    const bobX = Math.sin(p.bob) * 0.018 * p.bobAmount;
    const bobY = -Math.abs(Math.cos(p.bob)) * 0.025 * p.bobAmount;
    const dip = (1 - this.equip) * (1 - this.equip) * 0.55;
    const run = p.sprinting ? 0.04 : 0;
    this.group.position.set(
      0.47 + bobX + this.sway.x - s1 * 0.2 - this.placeKick * 0.03,
      -0.36 + bobY + this.sway.y - dip + Math.sin(sq * Math.PI * 2) * 0.05 - run,
      -0.78 - s2 * 0.2 + this.placeKick * 0.05,
    );
    this.group.rotation.set(
      0.1 - s1 * 0.55 + dip * 0.6,
      -0.72 + s1 * 0.2,
      0.03 - s1 * 0.2,
    );
    this.group.scale.setScalar(this.baseScale);

    const u = this.mat.uniforms;
    u.uLightDirV.value.copy(p.lightDirView);
    u.uLightColor.value.copy(p.lightColor);
    u.uAmbient.value.copy(p.ambient);
    u.uBlockColor.value.copy(p.blockColor);
    u.uSky.value = p.sky;
    u.uBlk.value = p.blk;
    u.uSun.value = p.sun;
  }
}
