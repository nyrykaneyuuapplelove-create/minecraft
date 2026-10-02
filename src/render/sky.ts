// 空：大気グラデーション・太陽・月（満ち欠け）・星・天の川・オーロラ・雲をひとつのフルスクリーンシェーダーで描く。

import * as THREE from "three";
import { GLSL_UNIFORMS, GLSL_MATH, GLSL_SKY_FN, GLSL_CLOUD_FN } from "./glslCommon";

const SKY_VS = /* glsl */ `
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
varying vec3 vDir;
void main() {
  vec4 v = uInvProj * vec4(position.xy, 1.0, 1.0);
  vDir = (uCamWorld * vec4(v.xyz / v.w, 0.0)).xyz;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

const SKY_FS = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_MATH}
${GLSL_SKY_FN}
${GLSL_CLOUD_FN}
uniform float uAurora;
uniform mat3 uSkyRotInv;
varying vec3 vDir;

float starField(vec3 d) {
  vec3 p = d * 150.0;
  vec3 ip = floor(p);
  vec3 fp = fract(p) - 0.5;
  float h = hash13(ip);
  if (h < 0.984) return 0.0;
  vec3 j = vec3(hash13(ip + 1.7), hash13(ip + 3.1), hash13(ip + 5.3)) - 0.5;
  float dd = length(fp - j * 0.6);
  float mag = (h - 0.984) / 0.016;
  float tw = 0.75 + 0.25 * sin(uTime * 2.7 + h * 120.0);
  return smoothstep(0.24, 0.0, dd) * (0.25 + mag * 1.3) * tw;
}

vec3 starColor(vec3 d) {
  float h = hash13(floor(d * 150.0) + 9.1);
  return mix(vec3(1.0, 0.82, 0.62), vec3(0.7, 0.82, 1.0), h);
}

vec3 milkyWay(vec3 ds) {
  vec3 n = normalize(vec3(0.35, 0.8, 0.5));
  float band = dot(ds, n);
  float core = exp(-band * band * 38.0);
  vec2 uv = vec2(atan(ds.z, ds.x) / 6.2832, ds.y * 0.5 + 0.5);
  float nz = texture(uCloudTex, uv * vec2(2.0, 1.0) + 0.2).r;
  float nz2 = texture(uCloudTex, uv * vec2(6.0, 3.0) + 0.6).r;
  float dust = smoothstep(0.38, 0.62, nz) * 0.7 + 0.3;
  float lane = smoothstep(0.55, 0.7, nz2) * 0.6;
  return vec3(0.55, 0.62, 0.95) * core * dust * (1.0 - lane) * 0.12;
}

vec3 aurora(vec3 d) {
  vec3 sum = vec3(0.0);
  float t = uTime * 0.02;
  for (int i = 0; i < 14; i++) {
    float fi = float(i) / 14.0;
    float hgt = 0.18 + fi * 0.5;
    vec2 p = d.xz * (hgt / max(d.y, 0.1)) * 1.3;
    float n = texture(uCloudTex, p * 0.04 + vec2(t, t * 0.3)).r;
    float n2 = texture(uCloudTex, p * 0.16 - vec2(t * 0.8, 0.0)).r;
    // 細いリボン状のカーテン
    float x = (n - 0.52) * 11.0;
    float curtain = exp(-x * x);
    float ray = 0.25 + 1.6 * pow(n2, 2.2);
    vec3 c = mix(vec3(0.08, 1.0, 0.4), vec3(0.55, 0.25, 1.0), smoothstep(0.35, 1.0, fi));
    sum += c * curtain * ray * (1.0 - fi * 0.35);
  }
  float fade = smoothstep(0.02, 0.28, d.y) * (1.0 - 0.5 * smoothstep(0.75, 1.0, d.y));
  return sum * fade * 0.075;
}

void main() {
  vec3 d = normalize(vDir);
  if (uUnderwater > 0.5) {
    gl_FragColor = vec4(uWaterFog, 0.0);
    return;
  }
  vec3 col = skyColor(d);
  float horizonFade = smoothstep(-0.02, 0.18, d.y);

  // 星・天の川・オーロラ
  if (uNight > 0.01 && d.y > -0.15) {
    vec3 ds = uSkyRotInv * d;
    float s = starField(ds);
    vec3 stars = starColor(ds) * s * 2.2 + milkyWay(ds) * 1.4;
    col += stars * uNight * horizonFade * (1.0 - uRain);
    if (uAurora > 0.01) col += aurora(d) * uAurora;
  }

  // 太陽
  float sd = dot(d, uSunDir);
  float sunVis = smoothstep(-0.04, 0.02, d.y);
  float sunDisc = smoothstep(0.99925, 0.99962, sd);
  col += vec3(1.0, 0.88, 0.68) * 16.0 * sunDisc * sunVis * (1.0 - uRain * 0.9);

  // 月（太陽との位置関係から満ち欠けを計算）
  vec3 md = uMoonDir;
  float mdot = dot(d, md);
  float mr = 0.034;
  float moonVis = mix(0.3, 1.0, uNight) * (1.0 - uRain * 0.85) * smoothstep(-0.05, 0.05, md.y);
  if (mdot > cos(mr * 2.0)) {
    vec3 upv = abs(md.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 t1 = normalize(cross(md, upv));
    vec3 t2 = cross(t1, md);
    vec2 q = vec2(dot(d, t1), dot(d, t2)) / mr;
    float r2 = dot(q, q);
    if (r2 < 1.0) {
      float z = sqrt(1.0 - r2);
      vec3 n = t1 * q.x + t2 * q.y - md * z;
      float lit = smoothstep(-0.05, 0.14, dot(n, uSunDir));
      float m1 = texture(uCloudTex, q * 0.2 + 0.31).r;
      float m2 = texture(uCloudTex, q * 0.75 + 0.7).r;
      float maria = smoothstep(0.42, 0.62, m1 * 0.7 + m2 * 0.3);
      vec3 mc = mix(vec3(0.95, 0.93, 0.86), vec3(0.55, 0.57, 0.64), maria);
      mc *= 0.85 + 0.3 * hash12(floor(q * 14.0));
      vec3 moonCol = mc * (lit * 7.0 + 0.06) * (1.0 - smoothstep(0.9, 1.0, sqrt(r2)) * 0.5);
      col = mix(col, moonCol, smoothstep(1.0, 0.94, sqrt(r2)) * moonVis);
    }
  }
  col += vec3(0.45, 0.55, 0.9) * pow(max(mdot, 0.0), 260.0) * 0.45 * moonVis;

  // 雲
  if (d.y > 0.004) {
    vec3 cam = cameraPosition;
    float hgt = uCloudAlt - cam.y;
    vec2 p = cam.xz + d.xz / max(d.y, 0.02) * max(hgt, 20.0);
    float dens = cloudDensity(p);
    float raw = cloudNoise(p);
    vec2 sdir = normalize(uLightDir.xz + 0.0001) * 70.0;
    float rawS = cloudNoise(p + sdir);
    float shade = clamp((rawS - raw) * 4.0 + 0.45, 0.0, 1.0);
    vec3 lightC = uLightColor * 0.38 + uAmbient * 0.5;
    vec3 shadeC = uAmbient * 0.75 + uSkyHorizon * 0.55;
    vec3 cc = mix(lightC, shadeC, shade);
    float rim = pow(1.0 - dens, 3.0) * smoothstep(0.0, 0.5, dens);
    cc += uGlowColor * pow(max(sd, 0.0), 6.0) * rim * 0.9 * uGlowAmount;
    cc *= 1.0 - 0.35 * uRain;
    float fade = smoothstep(0.004, 0.16, d.y);
    float a = dens * fade * (0.94 - 0.0 * uRain);
    cc = mix(skyColor(vec3(d.x, 0.0, d.z)), cc, fade * 0.9 + 0.1);
    col = mix(col, cc, a);
    // 巻雲
    vec2 p2 = cam.xz + d.xz / max(d.y, 0.05) * 520.0;
    float ci = texture(uCloudTex, p2 * vec2(0.00045, 0.0016) + uCloudOffset * 2.0).r;
    float cirrus = smoothstep(0.55, 0.78, ci) * 0.3 * fade * (1.0 - uRain);
    col += (uLightColor * 0.1 + uAmbient * 0.2) * cirrus + uGlowColor * cirrus * pow(max(sd, 0.0), 4.0) * uGlowAmount * 0.3;
  }
  gl_FragColor = vec4(col, 0.0);
}
`;

export class Sky {
  mesh: THREE.Mesh;
  private uInvProj = { value: new THREE.Matrix4() };
  private uCamWorld = { value: new THREE.Matrix4() };

  constructor(shared: Record<string, THREE.IUniform>) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      uniforms: { ...shared, uInvProj: this.uInvProj, uCamWorld: this.uCamWorld },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
  }

  update(camera: THREE.Camera) {
    camera.updateMatrixWorld();
    this.uInvProj.value.copy((camera as THREE.PerspectiveCamera).projectionMatrixInverse);
    this.uCamWorld.value.copy(camera.matrixWorld);
  }
}
