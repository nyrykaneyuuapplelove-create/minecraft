// CPUパーティクル：ブロック破片・砂ぼこり・水しぶき・火の粉・泡・煙
import * as THREE from "three";
import { BLOCKS, Tint, COLLIDE, IS_LIQUID, type BlockDef } from "./blocks";
import { GLSL_MATH } from "./render/glslCommon";
import type { World } from "./world";
import type { TextureSet } from "./textures";

const TINT_RGB: Record<number, [number, number, number]> = {
  [Tint.NONE]: [1, 1, 1],
  [Tint.GRASS]: [0.55, 0.77, 0.32],
  [Tint.FOLIAGE]: [0.34, 0.62, 0.2],
  [Tint.BIRCH]: [0.5, 0.655, 0.333],
  [Tint.SPRUCE]: [0.38, 0.6, 0.38],
  [Tint.AUTUMN]: [0.85, 0.47, 0.12],
  [Tint.WATER]: [0.2, 0.42, 0.86],
};

const VS = /* glsl */ `
attribute vec4 aInfo;
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vInfo;
varying vec4 vColor;
void main() {
  vInfo = aInfo;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 120.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FS_SOLID = /* glsl */ `
${GLSL_MATH}
uniform sampler2DArray uAlbedo;
uniform vec3 uLight;
varying vec4 vInfo;
varying vec4 vColor;
void main() {
  vec2 uv = vInfo.yz + gl_PointCoord * vInfo.w;
  vec4 t = texture(uAlbedo, vec3(uv, vInfo.x));
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(srgb2lin(t.rgb) * vColor.rgb * uLight, 1.0);
}
`;

const FS_SOFT = /* glsl */ `
uniform vec3 uLight;
varying vec4 vInfo;
varying vec4 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float d = dot(q, q);
  if (d > 1.0) discard;
  float a = vColor.a * smoothstep(1.0, 0.15, d);
  vec3 c = vColor.rgb * (vInfo.x < -1.5 ? vec3(1.0) : uLight);
  gl_FragColor = vec4(c, a);
}
`;

class Pool {
  n = 0;
  pos: Float32Array;
  vel: Float32Array;
  info: Float32Array;
  col: Float32Array;
  size: Float32Array;
  life: Float32Array;
  maxLife: Float32Array;
  grav: Float32Array;
  drag: Float32Array;
  fade: Uint8Array;
  collide: Uint8Array;
  points: THREE.Points;
  geo = new THREE.BufferGeometry();
  constructor(public max: number, material: THREE.ShaderMaterial) {
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.info = new Float32Array(max * 4);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.fade = new Uint8Array(max);
    this.collide = new Uint8Array(max);
    const mk = (a: Float32Array, n: number) => {
      const at = new THREE.BufferAttribute(a, n);
      at.setUsage(THREE.DynamicDrawUsage);
      return at;
    };
    this.geo.setAttribute("position", mk(this.pos, 3));
    this.geo.setAttribute("aInfo", mk(this.info, 4));
    this.geo.setAttribute("aColor", mk(this.col, 4));
    this.geo.setAttribute("aSize", mk(this.size, 1));
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
  }
  add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, g: number, drag: number, info: number[], col: number[], fade: boolean, collide: boolean) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grav[i] = g; this.drag[i] = drag;
    for (let k = 0; k < 4; k++) { this.info[i * 4 + k] = info[k]; this.col[i * 4 + k] = col[k]; }
    this.fade[i] = fade ? 1 : 0;
    this.collide[i] = collide ? 1 : 0;
  }
  private kill(i: number) {
    const l = --this.n;
    if (i === l) return;
    this.pos.copyWithin(i * 3, l * 3, l * 3 + 3);
    this.vel.copyWithin(i * 3, l * 3, l * 3 + 3);
    this.info.copyWithin(i * 4, l * 4, l * 4 + 4);
    this.col.copyWithin(i * 4, l * 4, l * 4 + 4);
    this.size[i] = this.size[l]; this.life[i] = this.life[l]; this.maxLife[i] = this.maxLife[l];
    this.grav[i] = this.grav[l]; this.drag[i] = this.drag[l]; this.fade[i] = this.fade[l]; this.collide[i] = this.collide[l];
  }
  update(dt: number, world: World) {
    for (let i = this.n - 1; i >= 0; i--) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); continue; }
      const p = i * 3;
      this.vel[p + 1] -= this.grav[i] * dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[p] *= d; this.vel[p + 1] *= d; this.vel[p + 2] *= d;
      let nx = this.pos[p] + this.vel[p] * dt, ny = this.pos[p + 1] + this.vel[p + 1] * dt, nz = this.pos[p + 2] + this.vel[p + 2] * dt;
      if (this.collide[i]) {
        const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
        if (id > 0 && COLLIDE[id]) {
          // 床に当たったら止まって摩擦
          if (this.vel[p + 1] < 0) { ny = this.pos[p + 1]; this.vel[p + 1] = 0; this.vel[p] *= 0.5; this.vel[p + 2] *= 0.5; }
          else { nx = this.pos[p]; nz = this.pos[p + 2]; ny = this.pos[p + 1]; this.vel[p] = this.vel[p + 1] = this.vel[p + 2] = 0; }
        }
      }
      this.pos[p] = nx; this.pos[p + 1] = ny; this.pos[p + 2] = nz;
      if (this.fade[i]) {
        const t = this.life[i] / this.maxLife[i];
        this.col[i * 4 + 3] = Math.min(1, t * 1.6) * (this.info[i * 4 + 3] === 0 ? 1 : 1);
      }
    }
    const g = this.geo;
    g.setDrawRange(0, this.n);
    for (const k of ["position", "aInfo", "aColor", "aSize"]) (g.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Particles {
  solid: Pool;
  soft: Pool;
  group = new THREE.Group();
  private solidMat: THREE.ShaderMaterial;
  private softMat: THREE.ShaderMaterial;
  private avg: [number, number, number][] = [];
  enabled = true;
  private uLight = { value: new THREE.Vector3(1, 1, 1) };
  private uScale = { value: 800 };

  constructor(albedo: THREE.Texture, tex: TextureSet) {
    this.solidMat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS_SOLID,
      uniforms: { uAlbedo: { value: albedo }, uLight: this.uLight, uScale: this.uScale },
    });
    this.softMat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS_SOFT,
      uniforms: { uLight: this.uLight, uScale: this.uScale },
      transparent: true, depthWrite: false,
    });
    this.solid = new Pool(1800, this.solidMat);
    this.soft = new Pool(1800, this.softMat);
    this.soft.points.renderOrder = 3;
    this.group.add(this.solid.points, this.soft.points);
    // 各タイルの平均色（ほこりの色用）
    for (const cv of tex.tiles) {
      const d = cv.getContext("2d")!.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < 256; i++) if (d[i * 4 + 3] > 128) { r += d[i * 4]; g += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
      n = Math.max(n, 1);
      this.avg.push([Math.pow(r / n / 255, 2.2), Math.pow(g / n / 255, 2.2), Math.pow(b / n / 255, 2.2)]);
    }
  }

  setView(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, light: THREE.Vector3) {
    const h = renderer.domElement.height;
    this.uScale.value = (h / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 0.5;
    this.uLight.value.copy(light);
  }

  breakBlock(x: number, y: number, z: number, def: BlockDef) {
    if (!this.enabled) return;
    const tint = TINT_RGB[def.tint] ?? [1, 1, 1];
    const n = 26;
    for (let i = 0; i < n; i++) {
      const px = x + Math.random(), py = y + Math.random(), pz = z + Math.random();
      const layer = Math.random() < 0.3 ? def.bottom : Math.random() < 0.3 ? def.top : def.side;
      const u0 = Math.floor(Math.random() * 3) / 4 + 0.0, v0 = Math.floor(Math.random() * 3) / 4;
      const tintHere = layer === def.bottom && def.name === "grass_block" ? [1, 1, 1] : tint;
      const dx = px - (x + 0.5), dz = pz - (z + 0.5);
      this.solid.add(px, py, pz, dx * 3 + (Math.random() - 0.5) * 1.5, Math.random() * 2.5 + 0.5, dz * 3 + (Math.random() - 0.5) * 1.5,
        0.7 + Math.random() * 0.7, 0.07 + Math.random() * 0.07, 16, 0.4, [layer, u0, v0, 0.25], [tintHere[0] * 0.9, tintHere[1] * 0.9, tintHere[2] * 0.9, 1], false, true);
    }
  }

  dust(x: number, y: number, z: number, layer: number, count = 6, spread = 0.4, up = 0.6) {
    if (!this.enabled) return;
    const c = this.avg[layer] ?? [0.4, 0.4, 0.4];
    for (let i = 0; i < count; i++) {
      this.soft.add(x + (Math.random() - 0.5) * spread, y + 0.05, z + (Math.random() - 0.5) * spread,
        (Math.random() - 0.5) * 0.8, up * (0.3 + Math.random() * 0.7), (Math.random() - 0.5) * 0.8,
        0.5 + Math.random() * 0.4, 0.11 + Math.random() * 0.1, -0.2, 2.0, [-1, 0, 0, 0], [c[0] * 1.2 + 0.05, c[1] * 1.2 + 0.05, c[2] * 1.2 + 0.05, 0.55], true, false);
    }
  }

  splash(x: number, y: number, z: number, strength: number) {
    if (!this.enabled) return;
    const n = Math.min(24, 8 + Math.floor(strength * 20));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.4 + Math.random() * 1.2;
      this.soft.add(x, y, z, Math.cos(a) * s, 2 + Math.random() * 3 * strength, Math.sin(a) * s, 0.7 + Math.random() * 0.4, 0.07 + Math.random() * 0.07, 14, 0.2, [-1, 0, 0, 0], [0.8, 0.92, 1.0, 0.8], true, false);
    }
  }

  bubble(x: number, y: number, z: number) {
    if (!this.enabled) return;
    this.soft.add(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.2,
      1.2 + Math.random(), 0.05 + Math.random() * 0.04, -0.1, 0.5, [-1, 0, 0, 0], [0.8, 0.95, 1.0, 0.55], true, false);
  }

  /** 松明・溶岩の火の粉（発光） */
  ember(x: number, y: number, z: number, hot = 1) {
    if (!this.enabled) return;
    this.soft.add(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.25, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.25,
      0.9 + Math.random() * 1.0, 0.03 + Math.random() * 0.03, -0.05, 0.4, [-2, 0, 0, 0], [3.2 * hot, 1.3 * hot, 0.3 * hot, 0.9], true, false);
  }

  smoke(x: number, y: number, z: number) {
    if (!this.enabled) return;
    this.soft.add(x, y, z, (Math.random() - 0.5) * 0.1, 0.6, (Math.random() - 0.5) * 0.1, 1.4 + Math.random() * 0.8, 0.12 + Math.random() * 0.06, -0.1, 0.8, [-1, 0, 0, 0], [0.5, 0.5, 0.52, 0.28], true, false);
  }

  update(dt: number, world: World) {
    this.solid.update(dt, world);
    this.soft.update(dt, world);
  }

  get count() {
    return this.solid.n + this.soft.n;
  }
}
export { IS_LIQUID };
