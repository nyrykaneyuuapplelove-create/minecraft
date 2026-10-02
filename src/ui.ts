// DOMベースのUI：タイトル・ロード・HUD・ホットバー・インベントリ・チャット・ポーズ・設定
import { BLOCKS, CATEGORIES, type Category } from "./blocks";
import { settings, saveSettings, type Settings } from "./settings";

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

interface SliderDef {
  key: keyof Settings;
  label: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}
interface ToggleDef {
  key: keyof Settings;
  label: string;
}

const SLIDERS: (SliderDef | ToggleDef | string)[] = [
  "表示",
  { key: "renderDistance", label: "描画距離", min: 4, max: 20, step: 1, fmt: (v) => `${v} チャンク` },
  { key: "fov", label: "視野角", min: 50, max: 110, step: 1 },
  { key: "resolution", label: "描画解像度", min: 0.5, max: 1.25, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "brightness", label: "明るさ", min: 0.6, max: 1.6, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: "shadows", label: "影" },
  { key: "bloom", label: "ブルーム（光のにじみ）" },
  { key: "godRays", label: "光芒（ゴッドレイ）" },
  { key: "particles", label: "パーティクル" },
  { key: "farTerrain", label: "遠景（霞の向こうの山並み）" },
  { key: "bobbing", label: "視点の揺れ" },
  { key: "showFps", label: "FPS表示" },
  "操作",
  { key: "sensitivity", label: "マウス感度", min: 0.1, max: 1.5, step: 0.05, fmt: (v) => `${Math.round(v * 200)}%` },
  "時間",
  { key: "timeSpeed", label: "時間の流れ", min: 0, max: 8, step: 0.25, fmt: (v) => (v === 0 ? "停止" : `x${v}`) },
  "音",
  { key: "masterVol", label: "全体の音量", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "musicVol", label: "音楽", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "ambientVol", label: "環境音", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: "sfxVol", label: "効果音", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
];

const PRESETS: Record<string, Partial<Settings>> = {
  low: { renderDistance: 7, shadows: false, shadowQuality: 0, bloom: false, godRays: false, resolution: 0.75, particles: false, farTerrain: false },
  medium: { renderDistance: 10, shadows: true, shadowQuality: 0, bloom: true, godRays: false, resolution: 0.9, particles: true, farTerrain: true },
  high: { renderDistance: 12, shadows: true, shadowQuality: 1, bloom: true, godRays: true, resolution: 1, particles: true, farTerrain: true },
  ultra: { renderDistance: 16, shadows: true, shadowQuality: 2, bloom: true, godRays: true, resolution: 1.15, particles: true, farTerrain: true },
};

const CONTROLS: [string, string][] = [
  ["W A S D", "移動"],
  ["マウス", "視点の移動"],
  ["Space", "ジャンプ（2回押しで飛行／解除）"],
  ["Shift", "しゃがむ（飛行中は下降）"],
  ["Ctrl / W 2回", "ダッシュ"],
  ["左クリック", "ブロックを壊す（長押しで連続）"],
  ["右クリック", "ブロックを置く（長押しで連続）"],
  ["中クリック", "見ているブロックを選ぶ"],
  ["1〜9 / ホイール", "ホットバーの切り替え"],
  ["E", "インベントリ（ブロック一覧）"],
  ["T / ／", "チャット・コマンド入力"],
  ["F1", "HUDの表示切替"],
  ["F2", "スクリーンショット"],
  ["F3", "デバッグ情報"],
  ["F5", "視点切り替え（一人称／三人称）"],
  ["F11", "フルスクリーン"],
  ["Esc", "ポーズメニュー"],
];

const TIPS = [
  "Space を素早く2回押すと、空を飛べます。",
  "/time set night で夜に、/weather rain で雨になります。",
  "夜は星と月の満ち欠けが見えます。寒い土地ではオーロラが出ることも。",
  "松明やランタンは、洞窟や夜道をあたたかく照らします。",
  "桜の丘では、花びらがゆっくり舞い降ります。",
  "木漏れ日や雲の影は、時間とともに動きます。",
  "F2 でスクリーンショットを保存できます。",
  "Shift でしゃがむと、ブロックの縁から落ちません。",
];

export class UI {
  root: HTMLElement;
  // HUD
  hud = el("div");
  crosshair = el("div");
  hotbar = el("div");
  itemName = el("div");
  debug = el("div", "hidden");
  debugR = el("div", "hidden");
  fpsEl = el("div", "hidden");
  chat = el("div", "hidden");
  chatLog = el("div");
  chatInput = el("input") as HTMLInputElement;
  toastEl = el("div");
  banner = el("div");
  // screens
  title = el("div");
  loading = el("div", "hidden");
  pauseEl = el("div", "overlay hidden");
  settingsEl = el("div", "overlay hidden");
  controlsEl = el("div", "overlay hidden");
  inventoryEl = el("div", "overlay hidden");
  newWorldEl = el("div", "overlay hidden");

  icons = new Map<number, string>();
  private slotEls: HTMLElement[] = [];
  private itemNameTimer = 0;
  private toastTimer = 0;
  private bannerTimer = 0;
  private chatOpen = false;
  private invCategory: Category | "all" = "natural";
  private invFilter = "";
  private hoverBlock = 0;
  private loadingBar!: HTMLElement;
  private loadingText!: HTMLElement;
  private loadingTip!: HTMLElement;
  private invGrid!: HTMLElement;
  private invHot!: HTMLElement;
  private invNameEl!: HTMLElement;
  continueBtn!: HTMLButtonElement;

  // コールバック
  onPlay?: () => void;
  onContinue?: () => void;
  onNewWorld?: (seed: string) => void;
  onResume?: () => void;
  onQuit?: () => void;
  onScreenshot?: () => void;
  onSettings?: (key: keyof Settings) => void;
  onAssign?: (id: number, slot: number | null) => void;
  onSlot?: (slot: number) => void;
  onCommand?: (text: string) => void;
  onChatClose?: () => void;
  onInventoryClose?: () => void;
  hotbarData: number[] = [];
  selected = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.buildHud();
    this.buildTitle();
    this.buildLoading();
    this.buildPause();
    this.buildSettings();
    this.buildControls();
    this.buildInventory();
    this.buildNewWorld();
    root.append(this.hud, this.title, this.loading, this.pauseEl, this.settingsEl, this.controlsEl, this.inventoryEl, this.newWorldEl);
    this.hud.classList.add("hidden");
  }

  // ---------- HUD ----------
  private buildHud() {
    this.hud.id = "hud";
    this.crosshair.id = "crosshair";
    this.hotbar.id = "hotbar";
    for (let i = 0; i < 9; i++) {
      const s = el("div", "slot", `<span class="n">${i + 1}</span><img alt="" />`);
      this.hotbar.append(s);
      this.slotEls.push(s);
    }
    this.itemName.id = "itemname";
    this.debug.id = "debug";
    this.debugR.id = "debugR";
    this.fpsEl.id = "fps";
    this.chat.id = "chat";
    this.chatLog.id = "chatlog";
    this.chatInput.id = "chatinput";
    this.chatInput.type = "text";
    this.chatInput.autocomplete = "off";
    this.chatInput.spellcheck = false;
    this.chatInput.className = "hidden";
    this.chat.append(this.chatLog, this.chatInput);
    this.chat.classList.remove("hidden");
    this.toastEl.id = "toast";
    this.banner.id = "banner";
    this.banner.innerHTML = `<div class="b1"></div><div class="rule"></div><div class="b2"></div>`;
    this.hud.append(this.crosshair, this.hotbar, this.itemName, this.debug, this.debugR, this.fpsEl, this.chat, this.toastEl, this.banner);
    this.chatInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const v = this.chatInput.value.trim();
        this.closeChat();
        if (v) this.onCommand?.(v);
      } else if (e.key === "Escape") {
        this.closeChat();
      }
    });
    this.chatInput.addEventListener("keyup", (e) => e.stopPropagation());
  }

  setHudVisible(v: boolean) {
    this.hud.classList.toggle("hidden", !v);
  }
  toggleCrosshairOnly(hide: boolean) {
    this.hotbar.classList.toggle("hidden", hide);
    this.crosshair.classList.toggle("hidden", hide);
  }

  updateHotbar(data: number[], selected: number) {
    this.hotbarData = data;
    this.selected = selected;
    this.slotEls.forEach((s, i) => {
      const img = s.querySelector("img") as HTMLImageElement;
      const id = data[i];
      if (id) {
        img.src = this.icons.get(id) ?? "";
        img.style.visibility = "visible";
      } else img.style.visibility = "hidden";
      s.classList.toggle("sel", i === selected);
    });
    this.refreshInvHot();
  }

  showItemName(name: string) {
    this.itemName.textContent = name;
    this.itemName.classList.add("show");
    clearTimeout(this.itemNameTimer);
    this.itemNameTimer = window.setTimeout(() => this.itemName.classList.remove("show"), 1600);
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), 2200);
  }

  showBanner(main: string, sub: string) {
    (this.banner.querySelector(".b1") as HTMLElement).textContent = main;
    (this.banner.querySelector(".b2") as HTMLElement).textContent = sub;
    this.banner.classList.add("show");
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove("show"), 3600);
  }

  setDebug(left: string | null, right?: string) {
    if (left === null) {
      this.debug.classList.add("hidden");
      this.debugR.classList.add("hidden");
      return;
    }
    this.debug.classList.remove("hidden");
    this.debug.textContent = left;
    this.debugR.classList.remove("hidden");
    this.debugR.textContent = right ?? "";
  }

  setFps(v: string | null) {
    if (v === null) this.fpsEl.classList.add("hidden");
    else {
      this.fpsEl.classList.remove("hidden");
      this.fpsEl.textContent = v;
    }
  }

  // ---------- チャット ----------
  get isChatOpen() {
    return this.chatOpen;
  }
  openChat(prefill = "") {
    this.chatOpen = true;
    this.chatInput.classList.remove("hidden");
    this.chatInput.value = prefill;
    for (const l of Array.from(this.chatLog.children)) l.classList.remove("old");
    setTimeout(() => this.chatInput.focus(), 0);
  }
  closeChat() {
    this.chatOpen = false;
    this.chatInput.classList.add("hidden");
    this.chatInput.blur();
    this.onChatClose?.();
  }
  log(msg: string) {
    const l = el("div", "line");
    l.textContent = msg;
    this.chatLog.append(l);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild?.remove();
    setTimeout(() => l.classList.add("old"), 7000);
  }

  // ---------- タイトル ----------
  private buildTitle() {
    this.title.id = "title";
    this.title.innerHTML = `
      <div class="logo">HAKONIWA</div>
      <div class="jp">箱 庭</div>
      <div class="tag">ひとつの世界を、ゆっくり歩こう</div>
      <div class="menu">
        <button class="btn primary" data-a="continue">ワールドに入る</button>
        <button class="btn" data-a="new">新しいワールド</button>
        <button class="btn" data-a="settings">設定</button>
        <button class="btn" data-a="controls">操作方法</button>
      </div>
      <div class="foot">${matchMedia("(pointer: coarse)").matches ? "このゲームはキーボードとマウスで遊びます（PC推奨）" : "マウスとキーボードで遊ぶブラウザゲームです。 / ヘッドホン推奨"}</div>`;
    this.continueBtn = this.title.querySelector('[data-a="continue"]') as HTMLButtonElement;
    this.title.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "continue") this.onContinue?.();
      else if (a === "new") this.newWorldEl.classList.remove("hidden");
      else if (a === "settings") this.openSettings();
      else if (a === "controls") this.controlsEl.classList.remove("hidden");
    });
  }
  showTitle(v: boolean) {
    this.title.classList.toggle("hidden", !v);
  }

  private buildNewWorld() {
    this.newWorldEl.innerHTML = `<div class="panel" style="width:min(460px,92vw)">
      <h2>新しいワールド</h2>
      <div class="row"><label>シード値（空欄でランダム）</label></div>
      <div class="row" style="border:0"><input type="text" id="seedin" placeholder="例: hakoniwa" style="width:100%" /></div>
      <div style="font-size:13px;color:var(--muted);margin-top:6px">同じシード値なら、同じ世界が生まれます。<br/>※ 現在のワールドの建築は、新しい世界では引き継がれません。</div>
      <div class="btns"><button class="btn small" data-a="cancel">キャンセル</button><button class="btn small primary" data-a="go">作成して入る</button></div></div>`;
    this.newWorldEl.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "cancel") this.newWorldEl.classList.add("hidden");
      else if (a === "go") {
        const v = (this.newWorldEl.querySelector("#seedin") as HTMLInputElement).value;
        this.newWorldEl.classList.add("hidden");
        this.onNewWorld?.(v);
      }
    });
    this.newWorldEl.addEventListener("keydown", (e) => e.stopPropagation());
  }

  // ---------- ロード ----------
  private buildLoading() {
    this.loading.id = "loading";
    this.loading.innerHTML = `<div class="t">ワールドを生成中…</div><div class="bar"><i></i></div><div class="tip"></div>`;
    this.loadingBar = this.loading.querySelector("i") as HTMLElement;
    this.loadingText = this.loading.querySelector(".t") as HTMLElement;
    this.loadingTip = this.loading.querySelector(".tip") as HTMLElement;
  }
  showLoading(v: boolean) {
    this.loading.classList.toggle("hidden", !v);
    if (v) this.loadingTip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  }
  setLoading(p: number) {
    this.loadingBar.style.width = `${Math.round(p * 100)}%`;
    this.loadingText.textContent = `ワールドを生成中… ${Math.round(p * 100)}%`;
  }

  // ---------- ポーズ ----------
  private buildPause() {
    this.pauseEl.innerHTML = `<div class="panel" style="width:min(380px,90vw)"><h2>ポーズ</h2>
      <div class="menu" style="width:100%">
        <button class="btn primary" data-a="resume">ゲームに戻る</button>
        <button class="btn" data-a="settings">設定</button>
        <button class="btn" data-a="controls">操作方法</button>
        <button class="btn" data-a="fullscreen">フルスクリーン切替</button>
        <button class="btn" data-a="shot">スクリーンショット</button>
        <button class="btn" data-a="quit">保存してタイトルへ</button>
      </div></div>`;
    this.pauseEl.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest("button")?.dataset.a;
      if (a === "resume") this.onResume?.();
      else if (a === "settings") this.openSettings();
      else if (a === "controls") this.controlsEl.classList.remove("hidden");
      else if (a === "shot") this.onScreenshot?.();
      else if (a === "fullscreen") {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.();
      } else if (e.target === this.pauseEl) this.onResume?.();
      else if (a === "quit") this.onQuit?.();
    });
  }
  showPause(v: boolean) {
    this.pauseEl.classList.toggle("hidden", !v);
  }
  get anyOverlayOpen() {
    return [this.pauseEl, this.settingsEl, this.controlsEl, this.inventoryEl, this.newWorldEl].some((e) => !e.classList.contains("hidden"));
  }

  // ---------- 設定 ----------
  private buildSettings() {
    const panel = el("div", "panel");
    panel.style.width = "min(560px, 94vw)";
    panel.innerHTML = `<h2>設定</h2>`;
    const pr = el("div", "row");
    pr.append(el("label", undefined, "画質プリセット"));
    const psel = el("select") as HTMLSelectElement;
    psel.innerHTML = `<option value="">カスタム</option><option value="low">低（軽量）</option><option value="medium">標準</option><option value="high">高</option><option value="ultra">最高</option>`;
    psel.addEventListener("change", () => {
      const pre = PRESETS[psel.value];
      if (!pre) return;
      Object.assign(settings, pre);
      saveSettings(settings);
      this.onSettings?.("renderDistance");
      this.settingsEl.innerHTML = "";
      this.buildSettings();
    });
    pr.append(psel);
    panel.append(pr);
    for (const d of SLIDERS) {
      if (typeof d === "string") {
        panel.append(el("div", "sub", d));
        continue;
      }
      const row = el("div", "row");
      const label = el("label", undefined, d.label);
      row.append(label);
      if ("min" in d) {
        const inp = el("input") as HTMLInputElement;
        inp.type = "range";
        inp.min = String(d.min);
        inp.max = String(d.max);
        inp.step = String(d.step);
        const val = el("span", "val");
        const upd = () => {
          const v = Number(settings[d.key]);
          inp.value = String(v);
          val.textContent = d.fmt ? d.fmt(v) : String(v);
        };
        upd();
        inp.addEventListener("input", () => {
          (settings[d.key] as number) = Number(inp.value);
          upd();
          saveSettings(settings);
          this.onSettings?.(d.key);
        });
        row.append(inp, val);
      } else {
        const cb = el("input") as HTMLInputElement;
        cb.type = "checkbox";
        cb.checked = Boolean(settings[d.key]);
        cb.style.width = "20px";
        cb.style.height = "20px";
        cb.addEventListener("change", () => {
          (settings[d.key] as boolean) = cb.checked;
          saveSettings(settings);
          this.onSettings?.(d.key);
        });
        row.append(cb);
      }
      panel.append(row);
    }
    const sq = el("div", "row");
    sq.append(el("label", undefined, "影の品質"));
    const sel = el("select") as HTMLSelectElement;
    sel.innerHTML = `<option value="0">低</option><option value="1">中</option><option value="2">高</option>`;
    sel.value = String(settings.shadowQuality);
    sel.addEventListener("change", () => {
      settings.shadowQuality = Number(sel.value);
      saveSettings(settings);
      this.onSettings?.("shadowQuality");
    });
    sq.append(sel);
    panel.append(sq);
    const btns = el("div", "btns");
    const close = el("button", "btn small primary", "閉じる");
    close.addEventListener("click", () => this.settingsEl.classList.add("hidden"));
    btns.append(close);
    panel.append(btns);
    this.settingsEl.append(panel);
  }
  openSettings() {
    this.settingsEl.classList.remove("hidden");
  }

  private buildControls() {
    const rows = CONTROLS.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join("");
    this.controlsEl.innerHTML = `<div class="panel" style="width:min(560px,94vw)"><h2>操作方法</h2><div class="keys">${rows}</div>
      <div class="btns"><button class="btn small primary" data-a="close">閉じる</button></div></div>`;
    this.controlsEl.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")?.dataset.a === "close") this.controlsEl.classList.add("hidden");
    });
  }

  // ---------- インベントリ ----------
  private buildInventory() {
    const panel = el("div", "panel");
    panel.innerHTML = `<h2>ブロック</h2><input type="text" class="search" placeholder="名前で検索（例: 桜、ガラス）" />`;
    const tabs = el("div", "tabs");
    const all = [{ key: "all" as const, label: "すべて" }, ...CATEGORIES];
    for (const c of all) {
      const b = el("button", c.key === this.invCategory ? "on" : "", c.label);
      b.dataset.k = c.key;
      tabs.append(b);
    }
    this.invGrid = el("div", "grid");
    this.invHot = el("div", "inv-hot");
    this.invNameEl = el("div");
    this.invNameEl.id = "invname";
    panel.append(tabs, this.invGrid, this.invNameEl, this.invHot);
    const note = el("div");
    note.style.cssText = "margin-top:8px;font-size:12px;color:var(--muted);text-align:center";
    note.textContent = "クリックで選択中のスロットに入れます。アイコンにカーソルを合わせて 1〜9 でそのスロットへ。";
    panel.append(note);
    this.inventoryEl.append(panel);
    const search = panel.querySelector(".search") as HTMLInputElement;
    search.addEventListener("input", () => {
      this.invFilter = search.value.trim();
      this.renderInvGrid();
    });
    search.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") this.onInventoryClose?.();
    });
    tabs.addEventListener("click", (e) => {
      const k = (e.target as HTMLElement).dataset.k as Category | "all" | undefined;
      if (!k) return;
      this.invCategory = k;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", (b as HTMLElement).dataset.k === k));
      this.renderInvGrid();
    });
    this.invGrid.addEventListener("click", (e) => {
      const id = Number((e.target as HTMLElement).closest(".cell")?.getAttribute("data-id"));
      if (id) this.onAssign?.(id, null);
    });
    this.invGrid.addEventListener("mouseover", (e) => {
      const c = (e.target as HTMLElement).closest(".cell");
      this.hoverBlock = c ? Number(c.getAttribute("data-id")) : 0;
      this.invNameEl.textContent = this.hoverBlock ? BLOCKS[this.hoverBlock].label : "";
    });
    this.invGrid.addEventListener("mouseleave", () => {
      this.hoverBlock = 0;
      this.invNameEl.textContent = "";
    });
    this.invHot.addEventListener("click", (e) => {
      const c = (e.target as HTMLElement).closest(".cell");
      if (c) this.onSlot?.(Number(c.getAttribute("data-slot")));
    });
    this.inventoryEl.addEventListener("click", (e) => {
      if (e.target === this.inventoryEl) this.onInventoryClose?.();
    });
  }
  renderInvGrid() {
    this.invGrid.innerHTML = "";
    const q = this.invFilter.toLowerCase();
    for (const b of BLOCKS) {
      if (!b || b.hidden || b.id === 0 || !b.category) continue;
      if (this.invCategory !== "all" && b.category !== this.invCategory) continue;
      if (q && !b.label.toLowerCase().includes(q) && !b.name.includes(q)) continue;
      const c = el("div", "cell", `<img alt="" src="${this.icons.get(b.id) ?? ""}"/>`);
      c.dataset.id = String(b.id);
      c.title = b.label;
      this.invGrid.append(c);
    }
  }
  private refreshInvHot() {
    this.invHot.innerHTML = "";
    for (let i = 0; i < 9; i++) {
      const id = this.hotbarData[i];
      const c = el("div", "cell" + (i === this.selected ? " sel" : ""), id ? `<img alt="" src="${this.icons.get(id) ?? ""}"/>` : "");
      c.dataset.slot = String(i);
      this.invHot.append(c);
    }
  }
  showInventory(v: boolean) {
    this.inventoryEl.classList.toggle("hidden", !v);
    if (v) {
      this.renderInvGrid();
      this.refreshInvHot();
    }
  }
  /** インベントリ内でホバー中のブロックに数字キーでスロット割り当て。処理したら true */
  assignHover(slot: number): boolean {
    if (!this.hoverBlock || this.inventoryEl.classList.contains("hidden")) return false;
    this.onAssign?.(this.hoverBlock, slot);
    return true;
  }
}
