import { GLSL_UNIFORMS, GLSL_MATH, GLSL_SKY_FN, GLSL_CLOUD_FN, GLSL_MOTION_FN } from "./glslCommon";

export const TERRAIN_VS = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_MOTION_FN}
attribute vec4 aData;
attribute vec4 aLight;
attribute vec4 aColor;
varying vec2 vUv;
flat varying vec3 vInfo;
varying vec3 vLight;
varying float vDepth;
varying float vShore;
varying vec3 vColor;
varying vec3 vWorld;

void main() {
  int fl = int(aData.z + 0.5);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz = applyMotion(wp.xyz, fl, aData.w / 255.0);
  vWorld = wp.xyz;
  vUv = uv;
  vInfo = vec3(aData.x, aData.y, aData.z);
  vLight = aLight.xyz;
  vDepth = aLight.w;
  vShore = aData.w / 255.0;
  vColor = pow(aColor.rgb, vec3(2.2));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TERRAIN_FS = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_MATH}
${GLSL_SKY_FN}
${GLSL_CLOUD_FN}
uniform sampler2DArray uAlbedo;
uniform sampler2DArray uMask;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowOn;
uniform vec2 uShadowTexel;

varying vec2 vUv;
flat varying vec3 vInfo;
varying vec3 vLight;
varying float vDepth;
varying float vShore;
varying vec3 vColor;
varying vec3 vWorld;

vec3 faceNormal(int f) {
  if (f == 0) return vec3(1.0, 0.0, 0.0);
  if (f == 1) return vec3(-1.0, 0.0, 0.0);
  if (f == 2 || f == 6) return vec3(0.0, 1.0, 0.0);
  if (f == 3) return vec3(0.0, -1.0, 0.0);
  if (f == 4) return vec3(0.0, 0.0, 1.0);
  return vec3(0.0, 0.0, -1.0);
}

float shadowTerm(vec3 wp, vec3 N) {
  if (uShadowOn < 0.5) return 1.0;
  vec3 p = wp + N * 0.08 + uLightDir * 0.04;
  vec4 sc = uShadowMatrix * vec4(p, 1.0);
  vec3 c = sc.xyz / sc.w * 0.5 + 0.5;
  if (c.z > 1.0 || c.z < 0.0) return 1.0;
  vec2 e = abs(c.xy * 2.0 - 1.0);
  float edge = 1.0 - smoothstep(0.72, 1.0, max(e.x, e.y));
  if (edge <= 0.0) return 1.0;
  float bias = 0.00035;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      float d = texture(uShadowMap, c.xy + vec2(float(i), float(j)) * uShadowTexel * 1.25).r;
      s += (c.z - bias > d) ? 0.0 : 1.0;
    }
  }
  s /= 9.0;
  return mix(1.0, s, edge);
}

float cloudShade(vec3 wp) {
  if (uCloudShadow <= 0.0) return 1.0;
  vec3 L = uLightDir;
  float t = (uCloudAlt - wp.y) / max(L.y, 0.15);
  vec2 xz = wp.xz + L.xz * t;
  return 1.0 - cloudDensity(xz) * uCloudShadow;
}

float wave(vec2 p) {
  float t = uTime;
  return texture(uCloudTex, p * 0.055 + vec2(t * 0.018, t * 0.011)).r * 0.6 +
         texture(uCloudTex, p * 0.16 + vec2(-t * 0.027, t * 0.02)).r * 0.4;
}

vec3 applyFog(vec3 col, vec3 V, float dist) {
  float haze = 1.0 - exp(-dist * uFogDensity);
  float edge = smoothstep(uFogEnd * 0.72, uFogEnd * 0.97, dist);
  float f = 1.0 - (1.0 - haze) * (1.0 - edge);
  vec3 fogC = fogColorFor(V);
  if (uUnderwater > 0.5) {
    f = 1.0 - exp(-dist * 0.055);
    fogC = uWaterFog;
  }
  return mix(col, fogC, clamp(f, 0.0, 1.0));
}

void main() {
  int face = int(vInfo.y + 0.5);
  int fl = int(vInfo.z + 0.5);
  vec3 N = faceNormal(face);
#ifdef DOUBLE_SIDED
  if (!gl_FrontFacing && face < 6) N = -N;
#endif
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  V /= max(dist, 0.0001);

  // MSAAの補間で縁のピクセルがわずかに範囲外になるため、必ずクランプする
  float sky = clamp(vLight.x, 0.0, 1.0);
  float blk = clamp(vLight.y, 0.0, 1.0);
  float ao = clamp(vLight.z, 0.0, 1.0) * 3.0;
  float aoF = 1.0 - ao * 0.2;
  float skyB = pow(sky, 1.6);
  float blkB = pow(blk, 2.0);
  float expo = smoothstep(0.6, 0.95, sky);

  float sunVis = 0.0;
  if (expo > 0.0) {
    sunVis = shadowTerm(vWorld, N) * cloudShade(vWorld) * expo;
  }

#ifdef WATER
  vec3 outCol;
  float outA;
  if ((fl & 1) != 0) {
    vec2 w2 = vWorld.xz;
    float e = 0.07;
    float h0 = wave(w2), hx = wave(w2 + vec2(e, 0.0)), hz = wave(w2 + vec2(0.0, e));
    float rough = 0.5 + uRain * 1.4;
    vec3 Nw = normalize(vec3((h0 - hx) / e * 0.09 * rough, 1.0, (h0 - hz) / e * 0.09 * rough));
    vec3 Nu = (face == 2) ? Nw : N;
    bool below = !gl_FrontFacing;
    float cosv = clamp(dot(-V, below ? -Nu : Nu), 0.0, 1.0);
    float depth = clamp(vDepth, 0.0, 1.0);
    vec3 wc = vColor;
    vec3 deepC = wc * wc * 0.3;
    vec3 body = mix(wc * vec3(0.8, 1.0, 0.95), deepC, smoothstep(0.0, 0.85, depth));
    vec3 lightIn = uAmbient * skyB * 1.15 + uLightColor * 0.2 * sunVis + uBlockColor * blkB;
    vec3 lit = body * lightIn;
    float fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
    vec3 R = reflect(V, Nu);
    R.y = abs(R.y);
    vec3 refl = skyColor(R);
    float sunSpec = min(pow(max(dot(R, uLightDir), 0.0), 500.0) * 14.0, 7.0);
    outCol = lit + refl * fres * 0.9 + uLightColor * sunSpec * sunVis * (1.0 - 0.8 * uUnderwater);
    outA = mix(0.40, 0.93, smoothstep(0.0, 0.8, depth));
    outA = mix(outA, 1.0, fres * 0.75);
    // 岸の泡
    float fn = texture(uCloudTex, w2 * 0.33 + vec2(uTime * 0.025, 0.0)).r;
    float foam = smoothstep(0.52, 0.95, clamp(vShore, 0.0, 1.0) * 1.5 + fn * 0.55 - 0.3 + sin(uTime * 1.6 + fn * 7.0) * 0.07);
    vec3 foamC = (uAmbient * skyB * 0.9 + uLightColor * 0.45 * sunVis) * 0.85;
    outCol = mix(outCol, foamC, foam * 0.85);
    outA = max(outA, foam * 0.9);
    if (below) {
      vec3 sv = skyColor(normalize(vec3(V.x * 0.7, abs(V.y) + 0.15, V.z * 0.7)));
      outCol = mix(uWaterFog * 0.9, sv * 0.85, smoothstep(0.55, 0.85, cosv)) + uLightColor * sunVis * 0.05;
      outA = 0.96;
    }
  } else {
    vec4 tex = texture(uAlbedo, vec3(vUv, vInfo.x));
    vec3 albedo = srgb2lin(tex.rgb);
    float ndl = max(dot(N, uLightDir), 0.0);
    vec3 amb = mix(uGround, uAmbient, N.y * 0.5 + 0.5) * skyB * aoF;
    vec3 lit = albedo * (amb + uLightColor * ndl * sunVis + uBlockColor * blkB * aoF * uFlicker);
    float cosv = clamp(dot(-V, N), 0.0, 1.0);
    float fres = 0.04 + 0.5 * pow(1.0 - cosv, 4.0);
    vec3 R = reflect(V, N);
    outCol = lit + skyColor(vec3(R.x, abs(R.y), R.z)) * fres * 0.5 * skyB;
    outA = tex.a;
  }
  outCol = applyFog(outCol, V, dist);
  gl_FragColor = vec4(outCol, outA);
#else
  vec4 tex = texture(uAlbedo, vec3(vUv, vInfo.x));
#ifdef CUTOUT
  if (tex.a < 0.5) discard;
#endif
  vec4 mask = texture(uMask, vec3(vUv, vInfo.x));
  vec3 col;
  if ((fl & 2) != 0) {
    // 溶岩：手続き的に流れる
    vec2 p = abs(N.y) > 0.5 ? vWorld.xz : vec2(vWorld.x + vWorld.z, vWorld.y);
    float t = uTime * 0.035;
    float n1 = texture(uCloudTex, p * 0.05 + vec2(t, t * 0.6)).r;
    float n2 = texture(uCloudTex, p * 0.13 - vec2(t * 0.8, t)).r;
    float n = n1 * 0.6 + n2 * 0.4;
    vec3 lc = mix(vec3(0.30, 0.02, 0.0), vec3(1.0, 0.26, 0.02), smoothstep(0.35, 0.58, n));
    lc = mix(lc, vec3(1.0, 0.74, 0.2), smoothstep(0.57, 0.72, n));
    col = lc * 2.6;
  } else {
    vec3 albedo = srgb2lin(tex.rgb) * mix(vec3(1.0), vColor, mask.r);
    if (fl == 0) {
      float vr = hash13(floor(vWorld - N * 0.02));
      albedo *= 0.93 + 0.14 * vr;
      albedo *= 1.0 - 0.3 * uWet;
    }
    float ndl = (face == 6) ? 0.22 + 0.7 * max(uLightDir.y, 0.0) : max(dot(N, uLightDir), 0.0);
    float through = 0.0;
    if ((fl & 4) != 0) {
      ndl = max(dot(N, uLightDir) * 0.5 + 0.5, 0.0);
      ndl *= ndl;
      through = pow(max(dot(V, uLightDir), 0.0), 3.0) * 0.55;
    }
    vec3 Nl = (face == 6) ? vec3(0.0, 1.0, 0.0) : N;
    vec3 amb = mix(uGround, uAmbient, Nl.y * 0.5 + 0.5) * skyB * aoF;
    vec3 light = amb + uLightColor * (ndl + through) * sunVis + uBlockColor * blkB * aoF * uFlicker;
    col = albedo * light;
    col += albedo * mask.g * 2.4;
  }
  col = applyFog(col, V, dist);
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export const SHADOW_VS = /* glsl */ `
${GLSL_UNIFORMS}
${GLSL_MOTION_FN}
attribute vec4 aData;
varying vec2 vUv;
flat varying float vLayer;
void main() {
  int fl = int(aData.z + 0.5);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  wp.xyz = applyMotion(wp.xyz, fl, aData.w / 255.0);
  vUv = uv;
  vLayer = aData.x;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SHADOW_FS = /* glsl */ `
uniform sampler2DArray uAlbedo;
varying vec2 vUv;
flat varying float vLayer;
void main() {
#ifdef CUTOUT
  if (texture(uAlbedo, vec3(vUv, vLayer)).a < 0.5) discard;
#endif
  gl_FragColor = vec4(1.0);
}
`;
