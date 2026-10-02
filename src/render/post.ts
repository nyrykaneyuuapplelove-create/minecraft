// ポストプロセス：HDR描画 → ブルーム → 光芒（ゴッドレイ）→ トーンマッピング → 画面
import * as THREE from "three";
import { GLSL_MATH } from "./glslCommon";

const FS_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const DOWN_FS = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uFirst;
uniform float uThreshold;
varying vec2 vUv;
vec3 t(vec2 o) { return texture(uTex, vUv + o * uTexel).rgb; }
void main() {
  vec3 A = t(vec2(-2.0, -2.0)), B = t(vec2(0.0, -2.0)), C = t(vec2(2.0, -2.0));
  vec3 D = t(vec2(-1.0, -1.0)), E = t(vec2(1.0, -1.0));
  vec3 F = t(vec2(-2.0, 0.0)), G = t(vec2(0.0, 0.0)), H = t(vec2(2.0, 0.0));
  vec3 I = t(vec2(-1.0, 1.0)), J = t(vec2(1.0, 1.0));
  vec3 K = t(vec2(-2.0, 2.0)), L = t(vec2(0.0, 2.0)), M = t(vec2(2.0, 2.0));
  vec3 col = (D + E + I + J) * 0.125 + (A + B + F + G) * 0.03125 + (B + C + G + H) * 0.03125 + (F + G + K + L) * 0.03125 + (G + H + L + M) * 0.03125;
  if (uFirst > 0.5) {
    float br = max(col.r, max(col.g, col.b));
    float knee = uThreshold * 0.6;
    float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
    col *= contrib;
  }
  gl_FragColor = vec4(min(col, vec3(60.0)), 1.0);
}
`;

const UP_FS = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
varying vec2 vUv;
vec3 t(vec2 o) { return texture(uTex, vUv + o * uTexel).rgb; }
void main() {
  vec3 col = t(vec2(0.0)) * 4.0 + (t(vec2(0.0, 1.0)) + t(vec2(-1.0, 0.0)) + t(vec2(1.0, 0.0)) + t(vec2(0.0, -1.0))) * 2.0 +
             (t(vec2(-1.0, 1.0)) + t(vec2(1.0, 1.0)) + t(vec2(-1.0, -1.0)) + t(vec2(1.0, -1.0)));
  gl_FragColor = vec4(col / 16.0, 1.0);
}
`;

const COMPOSITE_FS = /* glsl */ `
${GLSL_MATH}
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uBloomStrength;
uniform float uExposure;
uniform vec2 uSunUV;
uniform float uGodRay;
uniform vec3 uGodColor;
uniform float uUnderwater;
uniform float uTime;
uniform float uVignette;
uniform float uSat;
uniform float uFlash;
varying vec2 vUv;

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = vUv;
  if (uUnderwater > 0.5) {
    uv += vec2(sin(uv.y * 26.0 + uTime * 1.7), cos(uv.x * 22.0 + uTime * 1.4)) * 0.0026;
  }
  vec4 s = texture(uScene, uv);
  vec3 col = s.rgb;
  col += texture(uBloom, uv).rgb * uBloomStrength;

  if (uGodRay > 0.001) {
    const int N = 28;
    vec2 delta = (uSunUV - uv) / float(N) * 0.95;
    vec2 p = uv;
    float illum = 0.0;
    float decay = 1.0;
    for (int i = 0; i < N; i++) {
      p += delta;
      float sky = 1.0 - texture(uScene, p).a;
      illum += sky * decay;
      decay *= 0.955;
    }
    float dsun = length((uv - uSunUV) * vec2(1.6, 1.0));
    float fall = exp(-dsun * 1.7);
    col += uGodColor * (illum / float(N)) * uGodRay * fall;
  }

  col *= uExposure;
  col = aces(col);
  float l = luma(col);
  col = mix(vec3(l), col, uSat);
  // 暖かいハイライトと冷たい影
  col *= mix(vec3(0.97, 0.99, 1.04), vec3(1.03, 1.0, 0.95), smoothstep(0.1, 0.9, l));
  vec2 q = uv - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;
  if (uUnderwater > 0.5) col *= vec3(0.82, 0.95, 1.0);
  col += vec3(uFlash * 0.25);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

class Pass {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  material: THREE.ShaderMaterial;
  constructor(frag: string, uniforms: Record<string, THREE.IUniform>, blend = false) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: FS_VS,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: blend ? THREE.CustomBlending : THREE.NoBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }
  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null, clear = true) {
    r.setRenderTarget(target);
    if (clear) {
      r.setClearColor(0x000000, 1);
      r.clear(true, false, false);
    }
    r.render(this.scene, this.camera);
  }
}

export interface PostParams {
  bloom: number;
  exposure: number;
  sunUV: THREE.Vector2;
  godRay: number;
  godColor: THREE.Vector3;
  underwater: boolean;
  time: number;
  vignette: number;
  saturation: number;
  flash: number;
  bloomThreshold: number;
}

export class PostFX {
  sceneRT: THREE.WebGLRenderTarget;
  private mips: THREE.WebGLRenderTarget[] = [];
  private down: Pass;
  private up: Pass;
  private composite: Pass;
  private levels = 6;
  msaa = 0;
  bloomEnabled = true;
  private rtType: THREE.TextureDataType = THREE.HalfFloatType;

  constructor(private renderer: THREE.WebGLRenderer, w: number, h: number, msaa: number) {
    const ext = renderer.extensions;
    const hdr = ext.has("EXT_color_buffer_float") || ext.has("EXT_color_buffer_half_float");
    this.rtType = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;
    if (!hdr) msaa = 0;
    this.msaa = msaa;
    this.sceneRT = this.makeSceneRT(w, h);
    this.down = new Pass(DOWN_FS, {
      uTex: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1 },
    });
    this.up = new Pass(UP_FS, { uTex: { value: null }, uTexel: { value: new THREE.Vector2() } }, true);
    this.composite = new Pass(COMPOSITE_FS, {
      uScene: { value: null }, uBloom: { value: null }, uBloomStrength: { value: 0.5 }, uExposure: { value: 1 },
      uSunUV: { value: new THREE.Vector2() }, uGodRay: { value: 0 }, uGodColor: { value: new THREE.Vector3(1, 0.8, 0.5) },
      uUnderwater: { value: 0 }, uTime: { value: 0 }, uVignette: { value: 0.45 }, uSat: { value: 1.08 }, uFlash: { value: 0 },
    });
    this.setSize(w, h);
  }

  private makeSceneRT(w: number, h: number) {
    return new THREE.WebGLRenderTarget(w, h, {
      type: this.rtType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: this.msaa,
    });
  }

  setMsaa(n: number) {
    if (n === this.msaa) return;
    this.msaa = n;
    const { width, height } = this.sceneRT;
    this.sceneRT.dispose();
    this.sceneRT = this.makeSceneRT(width, height);
  }

  setSize(w: number, h: number) {
    this.sceneRT.setSize(w, h);
    for (const m of this.mips) m.dispose();
    this.mips = [];
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(2, Math.floor(mw / 2));
      mh = Math.max(2, Math.floor(mh / 2));
      this.mips.push(
        new THREE.WebGLRenderTarget(mw, mh, {
          type: this.rtType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
    }
  }

  private validated = false;

  /** フレームバッファが使えるか確認し、ダメならMSAA→HDRの順に縮退する */
  private validate() {
    this.validated = true;
    const r = this.renderer;
    const gl = r.getContext() as WebGL2RenderingContext;
    const ok = () => {
      r.setRenderTarget(this.sceneRT);
      return gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    };
    if (ok()) return;
    console.warn("[hakoniwa] framebuffer incomplete: MSAA を無効にします");
    this.setMsaa(0);
    if (ok()) return;
    console.warn("[hakoniwa] framebuffer incomplete: 8bit に切り替えます");
    this.rtType = THREE.UnsignedByteType;
    const { width, height } = this.sceneRT;
    this.sceneRT.dispose();
    this.sceneRT = this.makeSceneRT(width, height);
    for (const m of this.mips) m.dispose();
    this.setSize(width, height);
  }

  /** シーン描画の前に呼ぶ：ターゲットをクリアして設定する */
  begin() {
    const r = this.renderer;
    if (!this.validated) this.validate();
    r.setRenderTarget(this.sceneRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
  }

  /** シーン描画のあとに呼ぶ：ブルーム → 合成 → 画面 */
  finish(p: PostParams) {
    const r = this.renderer;
    let bloomTex: THREE.Texture | null = null;
    if (this.bloomEnabled && p.bloom > 0.001) {
      // ダウンサンプル
      let src: THREE.Texture = this.sceneRT.texture;
      let sw = this.sceneRT.width, sh = this.sceneRT.height;
      for (let i = 0; i < this.levels; i++) {
        const u = this.down.material.uniforms;
        u.uTex.value = src;
        u.uTexel.value.set(1 / sw, 1 / sh);
        u.uFirst.value = i === 0 ? 1 : 0;
        u.uThreshold.value = p.bloomThreshold;
        this.down.render(r, this.mips[i], false);
        src = this.mips[i].texture;
        sw = this.mips[i].width;
        sh = this.mips[i].height;
      }
      // アップサンプル（加算）
      for (let i = this.levels - 2; i >= 0; i--) {
        const u = this.up.material.uniforms;
        const lo = this.mips[i + 1];
        u.uTex.value = lo.texture;
        u.uTexel.value.set(1 / lo.width, 1 / lo.height);
        this.up.render(r, this.mips[i], false);
      }
      bloomTex = this.mips[0].texture;
    }
    const u = this.composite.material.uniforms;
    u.uScene.value = this.sceneRT.texture;
    u.uBloom.value = bloomTex ?? this.sceneRT.texture;
    u.uBloomStrength.value = bloomTex ? p.bloom : 0;
    u.uExposure.value = p.exposure;
    u.uSunUV.value.copy(p.sunUV);
    u.uGodRay.value = p.godRay;
    u.uGodColor.value.copy(p.godColor);
    u.uUnderwater.value = p.underwater ? 1 : 0;
    u.uTime.value = p.time;
    u.uVignette.value = p.vignette;
    u.uSat.value = p.saturation;
    u.uFlash.value = p.flash;
    this.composite.render(r, null, false);
  }
}
