// ユーザー設定（localStorage に保存）
export interface Settings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  shadows: boolean;
  shadowQuality: number; // 0:低 1:中 2:高
  bloom: boolean;
  godRays: boolean;
  resolution: number; // 描画解像度の倍率
  msaa: number; // 0 / 2 / 4
  particles: boolean;
  farTerrain: boolean;
  bobbing: boolean;
  masterVol: number;
  musicVol: number;
  ambientVol: number;
  sfxVol: number;
  timeSpeed: number;
  brightness: number;
  showFps: boolean;
}

const DEFAULTS: Settings = {
  renderDistance: 12,
  fov: 72,
  sensitivity: 0.5,
  shadows: true,
  shadowQuality: 1,
  bloom: true,
  godRays: true,
  resolution: 1,
  msaa: 4,
  particles: true,
  farTerrain: true,
  bobbing: true,
  masterVol: 0.8,
  musicVol: 0.5,
  ambientVol: 0.7,
  sfxVol: 0.8,
  timeSpeed: 1,
  brightness: 1,
  showFps: false,
};

const KEY = "hakoniwa:settings:v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const settings: Settings = loadSettings();
