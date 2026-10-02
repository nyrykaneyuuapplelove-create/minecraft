// 複数のシェーダーで共有するGLSL断片（ユニフォーム宣言・空の色・雲・風など）

export const GLSL_UNIFORMS = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uGround;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGlowColor;
uniform float uGlowAmount;
uniform float uFogDensity;
uniform float uFogEnd;
uniform float uEdgeFog;
uniform float uUnderwater;
uniform vec3 uWaterFog;
uniform vec3 uBlockColor;
uniform float uFlicker;
uniform float uWet;
uniform float uRain;
uniform float uNight;
uniform sampler2D uCloudTex;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
uniform float uCloudAlt;
uniform float uCloudShadow;
uniform vec2 uWind;
uniform float uGust;
uniform float uSnowLine;
`;

export const GLSL_MATH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 srgb2lin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

export const GLSL_SKY_FN = /* glsl */ `
vec3 skyColor(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 col = mix(uSkyHorizon, uSkyZenith, pow(h, 0.45));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uGlowColor * (pow(sd, 3.0) * 0.30 + pow(sd, 24.0) * 0.55 + pow(sd, 220.0) * 0.8) * uGlowAmount;
  // 反太陽側の薄い帯（夕焼けの反対側が桃色に染まる）
  float ad = max(dot(d, -uSunDir), 0.0);
  col += uGlowColor * vec3(0.55, 0.3, 0.5) * pow(ad, 6.0) * uGlowAmount * 0.18 * (1.0 - h);
  return col;
}
vec3 fogColorFor(vec3 dir) {
  vec3 d = dir;
  d.y = max(d.y, 0.0) * 0.5;
  return skyColor(normalize(d));
}
`;

export const GLSL_CLOUD_FN = /* glsl */ `
// 雲の密度（0..1）。xz はワールド座標
float cloudNoise(vec2 xz) {
  vec2 uv = xz / 2600.0 + uCloudOffset;
  float a = texture(uCloudTex, uv).r;
  float b = texture(uCloudTex, uv * 3.1 + 0.37).r;
  float c = texture(uCloudTex, uv * 8.3 + 0.71).r;
  return a * 0.62 + b * 0.28 + c * 0.10;
}
float cloudDensity(vec2 xz) {
  float n = cloudNoise(xz);
  float th = 1.0 - uCloudCover;
  return smoothstep(th - 0.06, th + 0.17, n);
}
`;

export const GLSL_MOTION_FN = /* glsl */ `
// 風・波による頂点の動き。fl: フラグ, w: 揺れの重み(0..1)
vec3 applyMotion(vec3 wp, int fl, float w) {
  float t = uTime;
  if ((fl & 12) != 0) {
    float amp = ((fl & 8) != 0) ? 0.15 : 0.05;
    float ph = wp.x * 0.5 + wp.z * 0.4;
    float g = 0.65 + 0.35 * sin(t * 0.45 + wp.x * 0.03 + wp.z * 0.02) + uGust;
    wp.x += (sin(t * 1.7 + ph) * 0.6 + uWind.x * 0.5) * amp * w * g;
    wp.z += (cos(t * 1.35 + ph * 1.2) * 0.6 + uWind.y * 0.5) * amp * w * g;
  }
  if ((fl & 16) != 0) {
    wp.x += sin(t * 0.9 + wp.y * 0.55 + wp.x * 0.7) * 0.16 * w;
    wp.z += cos(t * 0.8 + wp.y * 0.5 + wp.z * 0.6) * 0.16 * w;
  }
  if ((fl & 1) != 0 && fract(wp.y) > 0.5) {
    wp.y += sin(t * 1.4 + wp.x * 0.9 + wp.z * 0.7) * 0.022 + sin(t * 1.1 - wp.x * 0.6 + wp.z * 1.1) * 0.018;
  }
  return wp;
}
`;
