// 手続き的オーディオ（外部の音源は使わない）：効果音・環境音・生成型のピアノBGM
import type { SoundKind } from "./blocks";
import { Biome } from "./biomes";

export interface AudioState {
  dt: number;
  day: number;
  night: number;
  rain: number;
  biome: number;
  exposure: number; // 屋外度 0(洞窟/屋内)..1(屋外)
  deep: number; // 地下の深さ 0..1
  altitude: number;
  wind: number;
  underwater: boolean;
  waterNear: number;
  lavaNear: number;
  snowing: boolean;
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export class AudioEngine {
  ctx: AudioContext | null = null;
  vol = { master: 0.8, music: 0.5, amb: 0.7, sfx: 0.8 };
  private master!: GainNode;
  private lp!: BiquadFilterNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private reverbIn!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private ambient: Record<string, GainNode> = {};
  private filters: Record<string, BiquadFilterNode> = {};
  private birdTimer = 3;
  private owlTimer = 20;
  private dripTimer = 4;
  private nextMusic = 28;
  private music: { end: number; bar: number; nextBar: number; chords: number[][]; scale: number[]; root: number; bars: number; tempo: number; style: number } | null = null;
  private clock = 0;
  started = false;

  init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 22000;
    this.master.connect(this.lp);
    this.lp.connect(ctx.destination);
    const bus = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(this.master);
      return g;
    };
    this.musicBus = bus(0.5);
    this.ambBus = bus(0.7);
    this.sfxBus = bus(0.8);
    // リバーブ
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lpState = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        lpState += (n - lpState) * (0.5 - 0.42 * t);
        d[i] = lpState * Math.pow(1 - t, 2.4) * (i < 400 ? i / 400 : 1);
      }
    }
    conv.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    const wet = ctx.createGain();
    wet.gain.value = 0.7;
    this.reverbIn.connect(conv);
    conv.connect(wet);
    wet.connect(this.master);
    // ノイズバッファ
    const mk = (secs: number, fn: (i: number, prev: number) => number) => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * secs), ctx.sampleRate);
      const d = b.getChannelData(0);
      let p = 0;
      for (let i = 0; i < d.length; i++) d[i] = p = fn(i, p);
      return b;
    };
    this.white = mk(3, () => Math.random() * 2 - 1);
    this.brown = mk(4, (_, p) => (p + 0.02 * (Math.random() * 2 - 1)) / 1.02);
    // 低音ノイズの音量補正
    const bd = this.brown.getChannelData(0);
    for (let i = 0; i < bd.length; i++) bd[i] *= 3.2;
    this.buildAmbient();
    this.applyVolumes();
    this.started = true;
  }

  setVolumes(v: { master: number; music: number; amb: number; sfx: number }) {
    this.vol = v;
    this.applyVolumes();
  }
  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.vol.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.vol.music * 1.7, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.amb * 1.35, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  // ---- 連続的な環境音 -----------------------------------------------------------
  private loop(buf: AudioBuffer, rate = 1) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private buildAmbient() {
    const ctx = this.ctx!;
    const chain = (name: string, src: AudioNode, filters: BiquadFilterNode[], out: AudioNode = this.ambBus) => {
      let node: AudioNode = src;
      for (const f of filters) {
        node.connect(f);
        node = f;
      }
      const g = ctx.createGain();
      g.gain.value = 0;
      node.connect(g);
      g.connect(out);
      this.ambient[name] = g;
    };
    const bq = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    // 風
    const wf = bq("bandpass", 500, 0.5);
    chain("wind", this.loop(this.brown), [wf, bq("lowpass", 1800)]);
    this.filters.wind = wf;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg);
    lg.connect(wf.frequency);
    lfo.start();
    // 雨
    const rf = bq("lowpass", 7000);
    chain("rain", this.loop(this.white), [bq("highpass", 700), rf]);
    this.filters.rain = rf;
    // 水辺
    const wtf = bq("lowpass", 650);
    chain("water", this.loop(this.brown, 0.9), [wtf]);
    const wlfo = ctx.createOscillator();
    wlfo.frequency.value = 0.16;
    const wlg = ctx.createGain();
    wlg.gain.value = 0.12;
    wlfo.connect(wlg);
    wlg.connect(this.ambient.water.gain);
    wlfo.start();
    // 洞窟のドローン
    const droneG = ctx.createGain();
    droneG.gain.value = 0;
    for (const f of [46, 46.7, 69.3]) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.value = f > 60 ? 0.35 : 0.6;
      o.connect(og);
      og.connect(droneG);
      o.start();
    }
    droneG.connect(this.ambBus);
    this.ambient.cave = droneG;
    chain("rumble", this.loop(this.brown, 0.6), [bq("lowpass", 150)]);
    // 溶岩のはじける音
    const crackle = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const cd = crackle.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.9 : 0;
    chain("lava", this.loop(crackle), [bq("bandpass", 2400, 3), bq("lowpass", 6000)]);
    // 虫（夜）
    const cb = (rate: number, len: number) => {
      const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const t = i / ctx.sampleRate;
        const phase = (t % 0.42) / 0.42;
        let e = 0;
        for (let k = 0; k < 3; k++) {
          const c = 0.05 + k * 0.1;
          const x = (phase - c) / 0.035;
          if (x > -1 && x < 1) e = Math.max(e, Math.cos(x * Math.PI * 0.5) ** 2);
        }
        d[i] = Math.sin(2 * Math.PI * rate * t) * e * 0.5 * (1 + 0.3 * Math.sin(t * 40));
      }
      return b;
    };
    chain("cricket", this.loop(cb(4350, 1.26)), []);
    chain("cricket2", this.loop(cb(5150, 1.47), 1.03), []);
  }

  private setAmb(name: string, v: number, tc = 0.6) {
    const g = this.ambient[name];
    if (g) g.gain.setTargetAtTime(Math.max(0, v), this.ctx!.currentTime, tc);
  }

  // ---- ワンショット --------------------------------------------------------------
  private burst(o: { type: BiquadFilterType; freq: number; freqEnd?: number; q?: number; dur: number; gain: number; attack?: number; delay?: number; send?: number; bus?: AudioNode; rate?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = (o.rate ?? 1) * rnd(0.85, 1.15);
    const f = ctx.createBiquadFilter();
    f.type = o.type;
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.bus ?? this.sfxBus);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      g.connect(s);
      s.connect(this.reverbIn);
    }
    src.start(t, Math.random() * 2);
    src.stop(t + o.dur + 0.05);
  }

  private tone(o: { type?: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; attack?: number; delay?: number; send?: number; bus?: AudioNode; pan?: number }) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + o.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g);
    let out: AudioNode = g;
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = o.pan;
      g.connect(p);
      out = p;
    }
    out.connect(o.bus ?? this.sfxBus);
    if (o.send) {
      const s = ctx.createGain();
      s.gain.value = o.send;
      out.connect(s);
      s.connect(this.reverbIn);
    }
    osc.start(t);
    osc.stop(t + o.dur + 0.05);
  }

  private mat(kind: SoundKind, phase: "break" | "place" | "step", g = 1) {
    const big = phase === "break" ? 1 : phase === "place" ? 0.7 : 0.4;
    const d = phase === "break" ? 1 : phase === "place" ? 0.65 : 0.35;
    switch (kind) {
      case "stone":
        this.burst({ type: "bandpass", freq: rnd(900, 1300), q: 0.9, dur: 0.17 * d + 0.03, gain: 0.5 * big * g });
        this.tone({ freq: rnd(110, 150), freqEnd: 70, dur: 0.13 * d + 0.03, gain: 0.35 * big * g, type: "triangle" });
        break;
      case "grass":
        this.burst({ type: "bandpass", freq: rnd(2200, 3200), q: 0.6, dur: 0.2 * d + 0.03, gain: 0.34 * big * g });
        this.burst({ type: "lowpass", freq: 500, dur: 0.1 * d + 0.02, gain: 0.2 * big * g });
        break;
      case "dirt":
        this.burst({ type: "lowpass", freq: rnd(500, 800), dur: 0.17 * d + 0.03, gain: 0.5 * big * g });
        this.burst({ type: "bandpass", freq: 1600, q: 1.2, dur: 0.06, gain: 0.14 * big * g });
        break;
      case "sand":
        this.burst({ type: "bandpass", freq: rnd(3200, 4400), q: 0.7, dur: 0.2 * d + 0.04, gain: 0.3 * big * g });
        break;
      case "gravel":
        for (let i = 0; i < (phase === "step" ? 2 : 4); i++) this.burst({ type: "bandpass", freq: rnd(1500, 2600), q: 1.4, dur: 0.05, gain: 0.3 * big * g, delay: i * 0.035 });
        break;
      case "wood":
        this.tone({ freq: rnd(180, 230), freqEnd: 120, dur: 0.1 * d + 0.03, gain: 0.5 * big * g, type: "triangle" });
        this.burst({ type: "bandpass", freq: 1300, q: 2, dur: 0.07, gain: 0.25 * big * g });
        if (phase === "break") this.tone({ freq: rnd(160, 200), freqEnd: 100, dur: 0.12, gain: 0.35, type: "triangle", delay: 0.06 });
        break;
      case "glass":
        for (let i = 0; i < (phase === "break" ? 5 : 2); i++) this.tone({ freq: rnd(1800, 4800), dur: 0.12 + Math.random() * 0.1, gain: 0.12 * big * g, delay: i * 0.025, send: 0.3 });
        this.burst({ type: "highpass", freq: 5000, dur: 0.08, gain: 0.25 * big * g });
        break;
      case "snow":
        this.burst({ type: "bandpass", freq: rnd(1800, 2600), q: 2.5, dur: 0.1 * d + 0.04, gain: 0.3 * big * g });
        this.burst({ type: "bandpass", freq: rnd(2800, 3600), q: 2.5, dur: 0.07, gain: 0.18 * big * g, delay: 0.03 });
        break;
      case "plant":
        this.burst({ type: "bandpass", freq: rnd(2600, 3600), q: 0.5, dur: 0.14 * d + 0.03, gain: 0.26 * big * g });
        break;
      case "metal":
        this.tone({ freq: rnd(900, 1400), dur: 0.22 * d + 0.05, gain: 0.25 * big * g, send: 0.25 });
        this.burst({ type: "bandpass", freq: 2500, q: 3, dur: 0.05, gain: 0.2 * big * g });
        break;
      case "water":
        this.burst({ type: "bandpass", freq: 1000, freqEnd: 400, q: 1, dur: 0.22, gain: 0.3 * big * g });
        break;
    }
  }

  play(phase: "break" | "place" | "step", kind: SoundKind, g = 1) {
    if (!this.ctx) return;
    this.mat(kind, phase, g);
  }
  land(kind: SoundKind, strength: number) {
    if (!this.ctx) return;
    this.mat(kind, "step", 1 + Math.min(1.6, strength * 1.5));
    this.burst({ type: "lowpass", freq: 300, dur: 0.14, gain: Math.min(0.5, strength * 0.5) });
  }
  splash(strength: number) {
    if (!this.ctx) return;
    const s = Math.min(1.5, 0.5 + strength);
    this.burst({ type: "bandpass", freq: 1400, freqEnd: 350, q: 0.9, dur: 0.5, gain: 0.5 * s, send: 0.15 });
    this.burst({ type: "highpass", freq: 4000, dur: 0.3, gain: 0.2 * s });
  }
  thunder(distance: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const delay = 0.15 + distance * 3.5;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.brown;
    src.playbackRate.value = rnd(0.5, 0.8);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(900 - distance * 500, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 4.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.6 - distance * 0.7, t + 0.12);
    g.gain.setTargetAtTime(0.0001, t + 0.5, 1.1 + distance);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    g.connect(s);
    s.connect(this.reverbIn);
    src.start(t, Math.random() * 2);
    src.stop(t + 6);
    this.burst({ type: "highpass", freq: 1200, dur: 0.18, gain: 0.7 * (1 - distance * 0.6), delay, send: 0.3 });
  }
  click() {
    if (!this.ctx) return;
    this.tone({ freq: 880, freqEnd: 660, dur: 0.05, gain: 0.08, type: "triangle" });
  }

  // ---- 環境音の更新 -----------------------------------------------------------------
  update(s: AudioState) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    this.clock += s.dt;
    const now = ctx.currentTime;
    const out = s.exposure;
    const under = s.underwater ? 1 : 0;

    // 水中は全体をこもらせる
    this.lp.frequency.setTargetAtTime(under ? 480 : 22000, now, 0.06);

    const alt = Math.min(1, Math.max(0, (s.altitude - 62) / 70));
    const windG = (0.04 + s.wind * 0.3 + alt * 0.22 + s.rain * 0.1) * (0.12 + 0.88 * out) * (1 - under * 0.7);
    this.setAmb("wind", windG);
    this.filters.wind.frequency.setTargetAtTime(380 + s.wind * 500 + alt * 300, now, 0.5);

    const rainG = s.rain * (s.snowing ? 0.04 : 0.4) * (0.25 + 0.75 * out) * (1 - under * 0.8);
    this.setAmb("rain", rainG);
    this.filters.rain.frequency.setTargetAtTime(700 + 6300 * out, now, 0.4);

    this.setAmb("water", Math.min(1, s.waterNear) * 0.28 * (1 - under * 0.5) * (0.5 + 0.5 * out));
    this.setAmb("cave", s.deep * 0.09 * (1 - under));
    this.setAmb("rumble", s.deep * 0.2 * (1 - under));
    this.setAmb("lava", s.lavaNear * 0.5);

    const cricketBiome = s.biome === Biome.BAMBOO_GROVE || s.biome === Biome.FOREST || s.biome === Biome.BIRCH_FOREST || s.biome === Biome.PLAINS || s.biome === Biome.MEADOW || s.biome === Biome.SWAMP || s.biome === Biome.SAVANNA || s.biome === Biome.CHERRY_GROVE || s.biome === Biome.AUTUMN_FOREST;
    const cr = cricketBiome ? s.night * (1 - s.rain) * out * (1 - under) * (s.biome === Biome.SWAMP ? 1.4 : 1) : 0;
    this.setAmb("cricket", cr * 0.055, 1.2);
    this.setAmb("cricket2", cr * 0.04, 1.2);

    // 鳥
    const birdBiome =
      s.biome === Biome.FOREST ? 1 : s.biome === Biome.BAMBOO_GROVE ? 0.9 : s.biome === Biome.BIRCH_FOREST ? 1 : s.biome === Biome.CHERRY_GROVE ? 0.9 : s.biome === Biome.PLAINS ? 0.55 : s.biome === Biome.MEADOW ? 0.8 : s.biome === Biome.TAIGA ? 0.35 : s.biome === Biome.AUTUMN_FOREST ? 0.7 : s.biome === Biome.SAVANNA ? 0.5 : 0;
    const birdAct = birdBiome * s.day * (1 - s.rain) * out * (1 - under);
    this.birdTimer -= s.dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = birdAct > 0.05 ? rnd(1.2, 6) / Math.max(0.3, birdAct) : rnd(3, 8);
      if (birdAct > 0.08 && Math.random() < birdAct) this.bird(birdAct);
    }
    // フクロウ
    this.owlTimer -= s.dt;
    if (this.owlTimer <= 0) {
      this.owlTimer = rnd(22, 70);
      const owlBiome = s.biome === Biome.FOREST || s.biome === Biome.BIRCH_FOREST || s.biome === Biome.TAIGA || s.biome === Biome.SWAMP || s.biome === Biome.AUTUMN_FOREST;
      if (owlBiome && s.night > 0.7 && s.rain < 0.3 && out > 0.5) this.owl();
    }
    // 洞窟のしずく
    this.dripTimer -= s.dt;
    if (this.dripTimer <= 0) {
      this.dripTimer = rnd(2.5, 8);
      if (s.deep > 0.2 && !s.underwater) {
        const f = rnd(1300, 2300);
        this.tone({ freq: f, freqEnd: f * 0.8, dur: 0.18, gain: 0.07 + 0.05 * s.deep, send: 0.9, pan: rnd(-0.7, 0.7) });
        this.tone({ freq: f * 1.5, dur: 0.1, gain: 0.03, send: 0.8, delay: 0.01 });
      }
    }
    this.musicTick(s);
  }

  private bird(act: number) {
    const ctx = this.ctx!;
    const pan = rnd(-0.85, 0.85);
    const kind = Math.floor(Math.random() * 4);
    const base = rnd(2300, 4200);
    const g = 0.03 + 0.045 * act;
    const bus = this.ambBus;
    const t = (f0: number, f1: number, dur: number, delay: number, gain = g) => this.tone({ freq: f0, freqEnd: f1, dur, gain, delay, pan, send: 0.35, bus, attack: 0.012 });
    if (kind === 0) {
      t(base, base * 1.25, 0.11, 0); t(base * 1.3, base * 0.95, 0.13, 0.15);
    } else if (kind === 1) {
      for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++) t(base * (1 + (i % 2) * 0.12), base * (1.1 + (i % 2) * 0.1), 0.045, i * 0.075, g * 0.8);
    } else if (kind === 2) {
      t(base * 1.2, base * 0.7, 0.28, 0); t(base * 1.05, base * 0.62, 0.25, 0.33);
    } else {
      t(base * 0.8, base * 1.4, 0.09, 0); t(base * 1.4, base * 1.5, 0.05, 0.12); t(base * 1.45, base * 0.9, 0.16, 0.2); t(base * 0.9, base * 1.3, 0.1, 0.5);
    }
    void ctx;
  }

  private owl() {
    const pan = rnd(-0.7, 0.7);
    const f = rnd(330, 420);
    for (let i = 0; i < 3; i++) this.tone({ freq: f, freqEnd: f * 0.9, dur: i === 0 ? 0.3 : 0.45, gain: 0.07, delay: i === 0 ? 0 : 0.5 + i * 0.28, pan, send: 1.0, attack: 0.07, bus: this.ambBus });
  }

  // ---- 生成型BGM（ピアノ風） --------------------------------------------------------------
  private pianoNote(midi: number, t: number, vel: number, dur: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const out = ctx.createGain();
    out.gain.value = vel * 0.2;
    out.connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.7;
    out.connect(send);
    send.connect(this.reverbIn);
    const partials: [number, number, number][] = [[1, 1, 1], [2, 0.42, 0.7], [3, 0.24, 0.5], [4, 0.13, 0.35], [5.01, 0.07, 0.25], [6.03, 0.035, 0.2]];
    for (const [r, a, d] of partials) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f * r * (1 + (Math.random() - 0.5) * 0.0008);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(a, t + 0.007);
      g.gain.setTargetAtTime(0.0001, t + 0.02, (dur * d) / 4.2);
      o.connect(g);
      g.connect(out);
      o.start(t);
      o.stop(t + dur + 0.3);
    }
    // ハンマー音
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const bf = ctx.createBiquadFilter();
    bf.type = "bandpass";
    bf.frequency.value = Math.min(6000, f * 3);
    bf.Q.value = 0.9;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(vel * 0.05, t);
    hg.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    src.connect(bf);
    bf.connect(hg);
    hg.connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.06);
  }

  private pad(midis: number[], t: number, dur: number) {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + dur * 0.4);
    g.gain.setTargetAtTime(0.0001, t + dur * 0.7, dur * 0.25);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 800;
    lp.connect(g);
    g.connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    g.connect(send);
    send.connect(this.reverbIn);
    for (const m of midis) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 1.5);
      }
    }
  }

  private newPiece(s: AudioState) {
    const ctx = this.ctx!;
    const roots = [0, 2, 3, 5, 7, 9];
    const root = 48 + pick(roots);
    // style: 0 明るい昼, 1 夜のしずけさ, 2 雨
    const style = s.rain > 0.3 ? 2 : s.night > 0.5 ? 1 : 0;
    const M7 = [0, 4, 7, 11], m7 = [0, 3, 7, 10], A9 = [0, 4, 7, 14], S2 = [0, 2, 7, 12], m9 = [0, 3, 7, 14];
    const progs: number[][][] = [
      [[0, 9, 5, 7], [0, 4, 5, 0], [0, 5, 9, 7]],
      [[0, 8, 5, 10], [0, 3, 8, 7]],
      [[0, 5, 3, 10], [0, 8, 3, 5]],
    ];
    const degrees = pick(progs[style]);
    const qualities = style === 0 ? [M7, m7, M7, S2] : style === 1 ? [m9, M7, m7, A9] : [m7, A9, M7, S2];
    const chords = degrees.map((d, i) => qualities[i % 4].map((n) => root + d + n));
    const scale = style === 0 ? [0, 2, 4, 7, 9, 11, 14] : style === 1 ? [0, 3, 5, 7, 10, 12, 14] : [0, 2, 3, 7, 9, 10, 14];
    const tempo = style === 0 ? rnd(58, 70) : rnd(46, 58);
    const bars = Math.floor(rnd(16, 26));
    const beat = 60 / tempo;
    const start = ctx.currentTime + 0.3;
    this.music = { end: start + bars * 4 * beat + 8, bar: 0, nextBar: start, chords, scale: scale.map((n) => root + 12 + n), root, bars, tempo, style };
  }

  private musicTick(s: AudioState) {
    const ctx = this.ctx!;
    if (this.vol.music < 0.01) return;
    const m = this.music;
    if (!m) {
      this.nextMusic -= s.dt;
      if (this.nextMusic <= 0 && !s.underwater && s.deep < 0.6) this.newPiece(s);
      return;
    }
    const beat = 60 / m.tempo;
    const barLen = 4 * beat;
    while (m.nextBar < ctx.currentTime + 1.6 && m.bar < m.bars) {
      const t0 = m.nextBar;
      const chord = m.chords[m.bar % m.chords.length];
      const last = m.bar === m.bars - 1;
      this.pad(chord.slice(0, 3).map((n) => n - 12), t0, barLen * 1.1);
      // アルペジオ
      const pattern = pick([[0, 1, 2, 1, 3, 2, 1, 2], [0, 2, 1, 3, 2, 1, 0, 1], [0, 1, 2, 3, 2, 1, 2, 1]]);
      if (last) {
        chord.forEach((n, i) => this.pianoNote(n, t0 + i * beat * 0.35, 0.5 - i * 0.05, 6));
      } else {
        for (let i = 0; i < 8; i++) {
          if (Math.random() < (i === 0 ? 0.05 : 0.3)) continue;
          const n = chord[pattern[i] % chord.length] + (pattern[i] >= 3 ? 12 : 0);
          this.pianoNote(n, t0 + i * beat * 0.5 + rnd(-0.01, 0.015), rnd(0.28, 0.5) * (i % 4 === 0 ? 1.15 : 0.85), 3.4);
        }
        // メロディ
        for (const b of [0, 2]) {
          if (Math.random() < 0.45) {
            const n = pick(m.scale) + (Math.random() < 0.3 ? 12 : 0);
            this.pianoNote(n, t0 + b * beat + rnd(0.0, 0.05), rnd(0.35, 0.55), 4.5);
          }
        }
      }
      m.nextBar += barLen;
      m.bar++;
    }
    if (ctx.currentTime > m.end) {
      this.music = null;
      this.nextMusic = rnd(120, 280);
    }
  }
}
