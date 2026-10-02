// キーボード・マウス・ポインターロック。操作系はJava版マインクラフトに合わせる。

export class Input {
  down = new Set<string>();
  private edge = new Set<string>();
  buttons = [false, false, false];
  private btnEdge = [false, false, false];
  dx = 0;
  dy = 0;
  wheel = 0;
  locked = false;
  /** 入力を受け付ける状態（チャット欄などで false にする） */
  enabled = true;
  onLockChange?: (locked: boolean) => void;
  onKey?: (code: string, e: KeyboardEvent) => void;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        // ブラウザの既定動作（Tab移動・スクロール・F5リロードなど）を止める
        if (["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F5", "F3", "F1", "F2", "F7"].includes(e.code) || e.code.startsWith("Key") && (e.ctrlKey || e.metaKey) && false) e.preventDefault();
      }
      if (e.repeat) return;
      this.down.add(e.code);
      this.edge.add(e.code);
      this.onKey?.(e.code, e);
    });
    window.addEventListener("keyup", (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener("blur", () => {
      this.down.clear();
      this.buttons = [false, false, false];
    });
    canvas.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      e.preventDefault();
      this.buttons[e.button] = true;
      this.btnEdge[e.button] = true;
    });
    window.addEventListener("mouseup", (e) => {
      this.buttons[e.button] = false;
    });
    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      const mx = Math.max(-250, Math.min(250, e.movementX));
      const my = Math.max(-250, Math.min(250, e.movementY));
      this.dx += mx;
      this.dy += my;
    });
    window.addEventListener(
      "wheel",
      (e) => {
        if (!this.locked) return;
        e.preventDefault();
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    window.addEventListener("contextmenu", (e) => {
      if (this.locked) e.preventDefault();
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) {
        this.down.clear();
        this.buttons = [false, false, false];
      }
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    p?.catch?.(() => {});
  }
  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code: string) {
    return this.down.has(code);
  }
  /** このフレームで押されたか（読むと消費される） */
  pressed(code: string) {
    return this.edge.delete(code);
  }
  clicked(btn: number) {
    const v = this.btnEdge[btn];
    this.btnEdge[btn] = false;
    return v;
  }
  endFrame() {
    this.edge.clear();
    this.btnEdge = [false, false, false];
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
  }
}
