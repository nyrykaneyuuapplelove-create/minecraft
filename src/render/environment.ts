// 時間帯・天候・空の色・光源の状態を管理し、全シェーダーで共有するユニフォームを更新する。

import * as THREE from "three";
import { mulberry32 } from "../noise";

export type WeatherKind = "clear" | "rain" | "thunder";

const TILT = 0.38;
const lin = (c: [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);
const mix3 = (out: THREE.Vector3, a: number[], b: number[], t: number) => out.set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function makeCloudTexture(): THREE.DataTexture {
  const S = 256;
  const rng = mulberry32(90210);
  const octs = [4, 8, 16, 32, 64];
  const weights = [0.4, 0.28, 0.18, 0.09, 0.05];
  const grids = octs.map((n) => Float32Array.from({ length: n * n }, () => rng()));
  const val = new Float32Array(S * S);
  let mn = 1, mx = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (let o = 0; o < octs.length; o++) {
        const n = octs[o];
        const fx = (x / S) * n, fy = (y / S) * n;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10), sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const g = grids[o];
        const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
        const c = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        v += weights[o] * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
      val[y * S + x] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }
  const data = new Uint8Array(S * S);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(((val[i] - mn) / (mx - mn)) * 255);
  const tex = new THREE.DataTexture(data, S, S, THREE.RedFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export class Environment {
  uniforms: Record<string, THREE.IUniform>;
  /** 0..24000（0=日の出, 6000=正午, 12000=日没, 18000=真夜中） */
  tick = 700;
  dayCount = 0;
  /** 1 = 20分で1日 */
  timeSpeed = 1;
  frozen = false;

  rain = 0;
  rainTarget = 0;
  weather: WeatherKind = "clear";
  weatherTimer = 240;
  autoWeather = true;
  flash = 0;
  private flashTimer = 8;
  private rng = mulberry32(4242);

  sunDir = new THREE.Vector3(1, 0.3, 0.1);
  moonDir = new THREE.Vector3(-1, -0.3, 0);
  moonIllum = 1;
  dayFactor = 1;
  /** 空の明るさ（0..1）: 星や夜行性の演出に使う */
  night = 0;
  aurora = 0;
  skyRot = new THREE.Matrix3();
  windDir = new THREE.Vector2(0.8, 0.45).normalize();
  windPhase = 0;
  cloudCover = 0.42;
  cloudOffset = new THREE.Vector2(0.13, 0.31);
  underwater = false;
  waterTint = new THREE.Color(0.2, 0.42, 0.86);
  snowing = false;
  fogEnd = 160;
  /** 太陽の輝度（光の強さ）0..1 */
  sunIntensity = 1;
  skyBrightness = 1;

  constructor(cloudTex: THREE.Texture) {
    const v3 = (x = 0, y = 0, z = 0) => ({ value: new THREE.Vector3(x, y, z) });
    const f = (x = 0) => ({ value: x });
    this.uniforms = {
      uTime: f(),
      uSunDir: v3(1, 0.3, 0),
      uMoonDir: v3(-1, -0.3, 0),
      uLightDir: v3(0, 1, 0),
      uLightColor: v3(1, 1, 1),
      uAmbient: v3(0.5, 0.6, 0.8),
      uGround: v3(0.2, 0.2, 0.2),
      uSkyZenith: v3(0.05, 0.16, 0.6),
      uSkyHorizon: v3(0.5, 0.68, 0.92),
      uGlowColor: v3(1, 0.7, 0.4),
      uGlowAmount: f(0.3),
      uFogDensity: f(0.0016),
      uFogEnd: f(160),
      uUnderwater: f(0),
      uWaterFog: v3(0.05, 0.2, 0.3),
      uBlockColor: v3(1.5, 0.9, 0.45),
      uFlicker: f(1),
      uWet: f(0),
      uRain: f(0),
      uNight: f(0),
      uCloudTex: { value: cloudTex },
      uCloudCover: f(0.42),
      uCloudOffset: { value: new THREE.Vector2() },
      uCloudAlt: f(190),
      uCloudShadow: f(0.5),
      uWind: { value: new THREE.Vector2(0.8, 0.45) },
      uGust: f(0),
      uAurora: f(0),
      uSkyRotInv: { value: new THREE.Matrix3() },
      uMoonPhase: f(1),
      uSnowLine: f(0),
    };
  }

  setTime(t: number) {
    this.tick = ((t % 24000) + 24000) % 24000;
  }

  setWeather(w: WeatherKind) {
    this.weather = w;
    this.rainTarget = w === "clear" ? 0 : w === "rain" ? 0.7 : 1;
    this.weatherTimer = w === "clear" ? 300 + this.rng() * 600 : 120 + this.rng() * 240;
  }

  update(dt: number, time: number, fogEnd: number) {
    const u = this.uniforms;
    if (!this.frozen) {
      const prev = this.tick;
      this.tick += dt * 20 * this.timeSpeed;
      if (this.tick >= 24000) {
        this.tick -= 24000;
        this.dayCount++;
      }
      void prev;
    }

    // ---- 天候の遷移 ----
    if (this.autoWeather) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        if (this.weather === "clear") this.setWeather(this.rng() < 0.7 ? "rain" : "thunder");
        else this.setWeather("clear");
      }
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dt * 0.35);
    if (Math.abs(this.rainTarget - this.rain) < 0.001) this.rain = this.rainTarget;
    const rain = this.rain;

    // 雷
    this.flash = Math.max(0, this.flash - dt * 2.2);
    if (this.weather === "thunder" && this.rain > 0.5) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.flash = 1;
        this.flashTimer = 6 + this.rng() * 18;
        this.onThunder?.(this.rng());
      }
    }

    // ---- 天体 ----
    const a = (this.tick / 24000) * Math.PI * 2;
    const ct = Math.cos(TILT), st = Math.sin(TILT);
    this.sunDir.set(Math.cos(a), Math.sin(a) * ct, Math.sin(a) * st).normalize();
    const phaseIdx = this.dayCount % 8;
    const moonOff = (phaseIdx / 8) * Math.PI * 2; // 0 = 満月（太陽の真逆）
    const ma = a + Math.PI + moonOff;
    this.moonDir.set(Math.cos(ma), Math.sin(ma) * ct, Math.sin(ma) * st).normalize();
    // 月の満ち欠け：太陽との位相差
    this.moonIllum = Math.min(1, Math.max(0.1, 0.5 - 0.5 * this.sunDir.dot(this.moonDir)));
    // 星空の回転（軌道面の法線まわりに -a）
    const axis = new THREE.Vector3(0, -st, ct);
    const rot = new THREE.Matrix4().makeRotationAxis(axis, -a);
    this.skyRot.setFromMatrix4(rot);

    const e = this.sunDir.y;
    const dayF = smooth(-0.1, 0.26, e);
    this.dayFactor = dayF;
    const twi = Math.exp(-Math.pow((e - 0.015) / 0.17, 2));
    this.night = 1 - smooth(-0.22, 0.04, e);

    // ---- 空の色（リニアHDR） ----
    const dim = 1 - 0.55 * rain;
    const zen = new THREE.Vector3(), hor = new THREE.Vector3();
    mix3(zen, [0.0018, 0.0035, 0.014], [0.045, 0.15, 0.6], dayF);
    mix3(hor, [0.005, 0.009, 0.026], [0.5, 0.68, 0.93], dayF);
    // 夕焼け・朝焼け
    const tz = new THREE.Vector3(0.1, 0.12, 0.36), th = new THREE.Vector3(1.5, 0.52, 0.2);
    zen.lerp(tz, twi * 0.65);
    hor.lerp(th, twi * 0.8);
    // 雨：灰色に
    const grayZ = new THREE.Vector3(0.18, 0.2, 0.24).multiplyScalar(0.25 + 0.75 * dayF);
    const grayH = new THREE.Vector3(0.3, 0.33, 0.37).multiplyScalar(0.25 + 0.75 * dayF);
    zen.lerp(grayZ, rain * 0.85);
    hor.lerp(grayH, rain * 0.85);
    // 雷光
    zen.addScalar(this.flash * 0.5);
    hor.addScalar(this.flash * 0.7);
    (u.uSkyZenith.value as THREE.Vector3).copy(zen);
    (u.uSkyHorizon.value as THREE.Vector3).copy(hor);
    (u.uGlowColor.value as THREE.Vector3).set(1.4, 0.7 + 0.35 * (1 - twi), 0.32 + 0.4 * (1 - twi));
    u.uGlowAmount.value = (0.22 + twi * 1.1) * (1 - rain * 0.85) * smooth(-0.2, 0.0, e);

    // ---- 光 ----
    const sunI = smooth(-0.045, 0.2, e);
    const sunT = smooth(0.0, 0.5, e);
    const sunCol = new THREE.Vector3();
    mix3(sunCol, [2.8, 1.15, 0.5], [2.3, 2.1, 1.85], sunT);
    sunCol.multiplyScalar(sunI * (1 - 0.88 * rain));
    this.sunIntensity = sunI * (1 - 0.88 * rain);
    const moonUp = smooth(-0.08, 0.12, this.moonDir.y);
    const moonCol = new THREE.Vector3(0.34, 0.45, 0.85).multiplyScalar(this.moonIllum * moonUp * 0.8 * (1 - 0.6 * rain) * (1 - dayF));
    const ws = sunCol.length(), wm = moonCol.length();
    const dir = new THREE.Vector3();
    if (ws + wm < 1e-4) dir.copy(this.sunDir);
    else dir.copy(this.sunDir).multiplyScalar(ws).addScaledVector(this.moonDir, wm).normalize();
    (u.uLightDir.value as THREE.Vector3).copy(dir);
    (u.uLightColor.value as THREE.Vector3).copy(sunCol).add(moonCol);
    (u.uSunDir.value as THREE.Vector3).copy(this.sunDir);
    (u.uMoonDir.value as THREE.Vector3).copy(this.moonDir);
    u.uMoonPhase.value = this.moonIllum;

    // 環境光
    const ambDay = new THREE.Vector3(0.58, 0.7, 0.98).multiplyScalar(1.0);
    const ambTwi = new THREE.Vector3(0.72, 0.56, 0.6).multiplyScalar(0.9);
    const ambNight = new THREE.Vector3(0.05, 0.075, 0.17).multiplyScalar(0.75 + 1.1 * this.moonIllum * moonUp);
    const amb = ambNight.clone().lerp(ambDay, dayF).lerp(ambTwi, twi * 0.55);
    amb.multiplyScalar(1 - 0.38 * rain);
    amb.addScalar(this.flash * 0.6);
    (u.uAmbient.value as THREE.Vector3).copy(amb);
    (u.uGround.value as THREE.Vector3).copy(amb).multiplyScalar(0.52).multiply(new THREE.Vector3(1.1, 0.95, 0.8));
    this.skyBrightness = Math.min(1, 0.1 + dayF * 0.9) * (1 - 0.5 * rain);

    // ブロックライト（松明）：暖色。ゆらぎ付き
    const fl = 1 + 0.035 * Math.sin(time * 9.3) + 0.03 * Math.sin(time * 15.7 + 1.3) + 0.02 * Math.sin(time * 23.1);
    u.uFlicker.value = fl;
    (u.uBlockColor.value as THREE.Vector3).set(1.55, 0.88, 0.42);

    // ---- 霧・距離 ----
    this.fogEnd = fogEnd;
    u.uFogEnd.value = fogEnd;
    const haze = 0.0011 + rain * 0.0035 + twi * 0.0006;
    u.uFogDensity.value = haze;

    // ---- 水中 ----
    u.uUnderwater.value = this.underwater ? 1 : 0;
    const wcol = this.waterTint;
    const light = 0.12 + 0.88 * this.skyBrightness;
    (u.uWaterFog.value as THREE.Vector3).set(
      Math.pow(wcol.r, 2.2) * 0.45 * light + 0.002,
      Math.pow(wcol.g, 2.2) * 0.75 * light + 0.006,
      Math.pow(wcol.b, 2.2) * 0.95 * light + 0.012,
    );

    // ---- 雲・風 ----
    this.windPhase += dt * 0.15;
    const gust = Math.max(0, Math.sin(time * 0.31) * Math.sin(time * 0.13 + 1.7)) * (0.35 + rain * 0.8);
    u.uGust.value = gust;
    const windStr = 0.7 + rain * 0.9;
    (u.uWind.value as THREE.Vector2).set(this.windDir.x * windStr, this.windDir.y * windStr);
    this.cloudOffset.x += this.windDir.x * dt * 0.00032 * (1 + rain);
    this.cloudOffset.y += this.windDir.y * dt * 0.00032 * (1 + rain);
    (u.uCloudOffset.value as THREE.Vector2).copy(this.cloudOffset);
    const cc = 0.4 + 0.07 * Math.sin(time * 0.009) + 0.05 * Math.sin(time * 0.0031 + 2) + rain * 0.5;
    this.cloudCover += (cc - this.cloudCover) * Math.min(1, dt * 0.5);
    u.uCloudCover.value = this.cloudCover;
    u.uCloudShadow.value = 0.5 * (1 - rain * 0.6) * Math.max(dayF, 0.3 * this.moonIllum);
    u.uTime.value = time;
    u.uRain.value = rain;
    u.uWet.value = Math.min(1, rain * 1.3);
    u.uNight.value = this.night;
    u.uAurora.value = this.aurora * this.night * (1 - rain);
    (u.uSkyRotInv.value as THREE.Matrix3).copy(this.skyRot);
  }

  onThunder?: (r: number) => void;
}
