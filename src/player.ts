// プレイヤー物理（Java版と同じ 20TPS・同じ係数）。衝突は軸ごとのAABB掃引。
import { B, IS_LIQUID, collisionBoxes, isWaterLike } from "./blocks";
import type { World } from "./world";
import type { Input } from "./input";

const W = 0.3; // 半幅
const H_STAND = 1.8;
const H_SNEAK = 1.5;
const STEP = 0.6;

export interface AABB {
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
}

export class Player {
  x = 0; y = 80; z = 0;
  px = 0; py = 80; pz = 0; // 前tickの位置（補間用）
  vx = 0; vy = 0; vz = 0;
  yaw = 0; // three.js 規約（0 = -Z 向き）
  pitch = 0;
  onGround = false;
  flying = false;
  sprinting = false;
  sneaking = false;
  inWater = false;
  eyeInWater = false;
  inLava = false;
  creative = true;
  height = H_STAND;
  eye = 1.62;
  prevEye = 1.62;
  jumpCooldown = 0;
  collidedH = false;
  lastSpaceTap = -10;
  lastWTap = -10;
  wasWDown = false;
  wasSpaceDown = false;
  fallDistance = 0;
  /** イベント通知（効果音・パーティクル用） */
  onLand?: (speed: number, id: number) => void;
  onSplash?: (speed: number) => void;
  onStep?: (id: number) => void;
  private stepDist = 0;
  tickCount = 0;
  moving = false;
  walkDist = 0;

  constructor(private world: World) {}

  setPos(x: number, y: number, z: number) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.z = this.pz = z;
    this.vx = this.vy = this.vz = 0;
  }

  aabb(): AABB {
    return { x0: this.x - W, y0: this.y, z0: this.z - W, x1: this.x + W, y1: this.y + this.height, z1: this.z + W };
  }

  private boxesIn(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]) {
    out.length = 0;
    const w = this.world;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
          const id = w.getBlock(x, y, z);
          if (id === 0) continue;
          if (id === -1) {
            out.push(x, y, z, x + 1, y + 1, z + 1);
            continue;
          }
          const boxes = collisionBoxes(id);
          if (!boxes) continue;
          for (const b of boxes) out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
  }

  private tmp: number[] = [];

  /** 衝突を考慮して移動。戻り値は実際に移動した量 */
  private collideMove(box: AABB, dx: number, dy: number, dz: number, out: number[] = [0, 0, 0]) {
    const bs = this.tmp;
    this.boxesIn(box.x0 + Math.min(dx, 0) - 0.001, box.y0 + Math.min(dy, 0) - 0.001, box.z0 + Math.min(dz, 0) - 0.001, box.x1 + Math.max(dx, 0) + 0.001, box.y1 + Math.max(dy, 0) + 0.001, box.z1 + Math.max(dz, 0) + 0.001, bs);
    // Y
    for (let i = 0; i < bs.length; i += 6) {
      if (box.x1 <= bs[i] + 1e-7 || box.x0 >= bs[i + 3] - 1e-7 || box.z1 <= bs[i + 2] + 1e-7 || box.z0 >= bs[i + 5] - 1e-7) continue;
      if (dy > 0 && box.y1 <= bs[i + 1] + 1e-7) dy = Math.min(dy, bs[i + 1] - box.y1);
      else if (dy < 0 && box.y0 >= bs[i + 4] - 1e-7) dy = Math.max(dy, bs[i + 4] - box.y0);
    }
    box.y0 += dy; box.y1 += dy;
    const xFirst = Math.abs(dx) >= Math.abs(dz);
    const doX = () => {
      for (let i = 0; i < bs.length; i += 6) {
        if (box.y1 <= bs[i + 1] + 1e-7 || box.y0 >= bs[i + 4] - 1e-7 || box.z1 <= bs[i + 2] + 1e-7 || box.z0 >= bs[i + 5] - 1e-7) continue;
        if (dx > 0 && box.x1 <= bs[i] + 1e-7) dx = Math.min(dx, bs[i] - box.x1);
        else if (dx < 0 && box.x0 >= bs[i + 3] - 1e-7) dx = Math.max(dx, bs[i + 3] - box.x0);
      }
      box.x0 += dx; box.x1 += dx;
    };
    const doZ = () => {
      for (let i = 0; i < bs.length; i += 6) {
        if (box.y1 <= bs[i + 1] + 1e-7 || box.y0 >= bs[i + 4] - 1e-7 || box.x1 <= bs[i] + 1e-7 || box.x0 >= bs[i + 3] - 1e-7) continue;
        if (dz > 0 && box.z1 <= bs[i + 2] + 1e-7) dz = Math.min(dz, bs[i + 2] - box.z1);
        else if (dz < 0 && box.z0 >= bs[i + 5] - 1e-7) dz = Math.max(dz, bs[i + 5] - box.z0);
      }
      box.z0 += dz; box.z1 += dz;
    };
    if (xFirst) { doX(); doZ(); } else { doZ(); doX(); }
    out[0] = dx; out[1] = dy; out[2] = dz;
    return out;
  }

  private overlapsSolid(box: AABB): boolean {
    const bs: number[] = [];
    this.boxesIn(box.x0, box.y0, box.z0, box.x1, box.y1, box.z1, bs);
    for (let i = 0; i < bs.length; i += 6) {
      if (box.x1 > bs[i] + 1e-7 && box.x0 < bs[i + 3] - 1e-7 && box.y1 > bs[i + 1] + 1e-7 && box.y0 < bs[i + 4] - 1e-7 && box.z1 > bs[i + 2] + 1e-7 && box.z0 < bs[i + 5] - 1e-7) return true;
    }
    return false;
  }

  private move(dx: number, dy: number, dz: number) {
    const box = this.aabb();
    const wantX = dx, wantY = dy, wantZ = dz;
    // しゃがみ時の落下防止（縁から落ちない）
    if (this.sneaking && this.onGround && dy <= 0) {
      const step = 0.05;
      const sup = (ddx: number, ddz: number) => {
        const b = { x0: box.x0 + ddx, y0: box.y0 - STEP, z0: box.z0 + ddz, x1: box.x1 + ddx, y1: box.y0, z1: box.z1 + ddz };
        // 足元に支えがあるか（y0-STEP〜y0 の範囲で衝突があるか）
        const bs: number[] = [];
        this.boxesIn(b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, bs);
        for (let i = 0; i < bs.length; i += 6) {
          if (b.x1 > bs[i] && b.x0 < bs[i + 3] && b.z1 > bs[i + 2] && b.z0 < bs[i + 5] && b.y1 > bs[i + 1] && b.y0 < bs[i + 4]) return true;
        }
        return false;
      };
      while (dx !== 0 && !sup(dx, 0)) { dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step; }
      while (dz !== 0 && !sup(0, dz)) { dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step; }
      while (dx !== 0 && dz !== 0 && !sup(dx, dz)) {
        dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
        dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      }
    }
    const startBox: AABB = { ...box };
    const r = this.collideMove(box, dx, dy, dz);
    let rx = r[0], ry = r[1], rz = r[2];
    const hit = Math.abs(rx - dx) > 1e-9 || Math.abs(rz - dz) > 1e-9;
    const landed = dy < 0 && Math.abs(ry - dy) > 1e-9;
    // 段差を登る
    if ((this.onGround || landed) && hit && !this.flying) {
      const b2: AABB = { ...startBox };
      const up = this.collideMove(b2, 0, STEP, 0);
      const h = this.collideMove(b2, dx, 0, dz);
      const dn = this.collideMove(b2, 0, -up[1], 0);
      const sx = h[0], sz = h[2];
      if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-9) {
        rx = sx; rz = sz; ry = up[1] + dn[1];
        box.x0 = b2.x0; box.x1 = b2.x1; box.y0 = b2.y0; box.y1 = b2.y1; box.z0 = b2.z0; box.z1 = b2.z1;
      }
    }
    this.x += rx; this.y += ry; this.z += rz;
    this.collidedH = Math.abs(rx - wantX) > 1e-9 || Math.abs(rz - wantZ) > 1e-9;
    const collidedY = Math.abs(ry - wantY) > 1e-9;
    if (collidedY && wantY < 0) this.onGround = true;
    else if (wantY !== 0 || !landed) this.onGround = collidedY && wantY < 0;
    if (this.collidedH) {
      if (Math.abs(rx - wantX) > 1e-9) this.vx = 0;
      if (Math.abs(rz - wantZ) > 1e-9) this.vz = 0;
    }
    if (collidedY) this.vy = 0;
  }

  private blockFriction(): number {
    const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
    return id === B.ICE ? 0.98 : 0.6;
  }

  private fluidAt(): { water: boolean; lava: boolean; eye: boolean } {
    const w = this.world;
    const x = Math.floor(this.x), z = Math.floor(this.z);
    let water = false, lava = false;
    for (let dy = 0; dy < 2; dy++) {
      const id = w.getBlock(x, Math.floor(this.y + 0.4 + dy * 0.8), z);
      if (id >= 0 && isWaterLike(id)) water = true;
      if (id === B.LAVA) lava = true;
    }
    const eyeId = w.getBlock(x, Math.floor(this.y + this.eye), z);
    const eyeUp = w.getBlock(x, Math.floor(this.y + this.eye), z);
    return { water, lava, eye: eyeId >= 0 && isWaterLike(eyeUp) && this.waterSurfaceAboveEye(x, z) };
  }

  private waterSurfaceAboveEye(x: number, z: number) {
    const ey = this.y + this.eye;
    const id = this.world.getBlock(x, Math.floor(ey), z);
    if (!isWaterLike(id)) return false;
    const above = this.world.getBlock(x, Math.floor(ey) + 1, z);
    const top = isWaterLike(above) ? 1 : 0.875;
    return ey - Math.floor(ey) < top;
  }

  /** 1 tick（50ms）進める */
  tick(inp: Input, canMove: boolean) {
    this.tickCount++;
    this.px = this.x; this.py = this.y; this.pz = this.z;
    this.prevEye = this.eye;
    const fluid = this.fluidAt();
    this.inWater = fluid.water;
    this.inLava = fluid.lava;
    this.eyeInWater = fluid.eye;

    const now = this.tickCount;
    let fwd = 0, str = 0, jump = false, wantSneak = false, ctrl = false;
    if (canMove) {
      if (inp.isDown("KeyW")) fwd += 1;
      if (inp.isDown("KeyS")) fwd -= 1;
      if (inp.isDown("KeyA")) str += 1;
      if (inp.isDown("KeyD")) str -= 1;
      jump = inp.isDown("Space") || inp.taps.has("Space");
      wantSneak = inp.isDown("ShiftLeft") || inp.isDown("ShiftRight");
      ctrl = inp.isDown("ControlLeft") || inp.isDown("ControlRight");
      // Wのダブルタップでダッシュ
      const wDown = inp.isDown("KeyW") || inp.taps.has("KeyW");
      if (wDown && !this.wasWDown) {
        if (now - this.lastWTap < 7 && !this.sneaking) this.sprinting = true;
        this.lastWTap = now;
      }
      this.wasWDown = wDown;
      // スペースのダブルタップで飛行切り替え（クリエイティブ）
      if (jump && !this.wasSpaceDown) {
        if (this.creative && now - this.lastSpaceTap < 7) {
          this.flying = !this.flying;
          if (this.flying) this.vy = 0;
          this.lastSpaceTap = -10;
        } else this.lastSpaceTap = now;
      }
      this.wasSpaceDown = jump;
    } else {
      this.wasWDown = false;
      this.wasSpaceDown = false;
    }
    this.sneaking = wantSneak && !this.flying && !this.inWater;
    if (this.sneaking) this.sprinting = false;
    if (ctrl && fwd > 0 && !this.sneaking) this.sprinting = true;
    if (fwd <= 0) this.sprinting = false;

    // しゃがみで高さ変更
    this.height = this.sneaking ? H_SNEAK : H_STAND;
    const targetEye = this.sneaking ? 1.27 : 1.62;
    this.eye += (targetEye - this.eye) * 0.5;

    let ix = str, iz = fwd;
    if (this.sneaking) { ix *= 0.3; iz *= 0.3; }
    ix *= 0.98; iz *= 0.98;
    const len2 = ix * ix + iz * iz;
    if (len2 > 1) { const l = Math.sqrt(len2); ix /= l; iz /= l; }
    this.moving = len2 > 0.0001;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    // forward = (-sin yaw, -cos yaw)、left = (-cos yaw, sin yaw)
    const rel = (speed: number) => {
      this.vx += (-iz * sy - ix * cy) * speed;
      this.vz += (-iz * cy + ix * sy) * speed;
    };

    if (this.jumpCooldown > 0) this.jumpCooldown--;

    if (this.flying) {
      const fs = 0.05 * (this.sprinting || ctrl ? 2 : 1);
      rel(fs);
      if (jump) this.vy += 0.15;
      if (wantSneak) this.vy -= 0.15;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.91; this.vz *= 0.91; this.vy *= 0.6;
      if (this.onGround && !jump) this.flying = false;
    } else if (this.inWater) {
      rel(0.02);
      if (jump) this.vy += 0.04;
      const sprintSwim = this.sprinting ? 0.9 : 0.8;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= sprintSwim; this.vz *= sprintSwim; this.vy *= 0.8;
      this.vy -= 0.02;
      // 壁に当たり、上が空いていれば這い上がる
      if (this.collidedH && this.canClimbOut()) this.vy = 0.3;
    } else if (this.inLava) {
      rel(0.02);
      if (jump) this.vy += 0.04;
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vz *= 0.5; this.vy *= 0.5;
      this.vy -= 0.02;
    } else {
      const slip = this.blockFriction();
      const wasOnGround = this.onGround;
      const f = wasOnGround ? slip * 0.91 : 0.91;
      const base = this.sprinting ? 0.13 : 0.1;
      const accel = wasOnGround ? base * Math.pow(0.6 / slip, 3) : this.sprinting ? 0.026 : 0.02;
      rel(accel);
      if (jump && wasOnGround && this.jumpCooldown === 0) {
        this.vy = 0.42;
        if (this.sprinting) { this.vx += -sy * 0.2; this.vz += -cy * 0.2; }
        this.jumpCooldown = 10;
      }
      const prevVy = this.vy;
      this.move(this.vx, this.vy, this.vz);
      if (!wasOnGround && this.onGround && prevVy < -0.1) {
        const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
        this.onLand?.(-prevVy, id);
      }
      this.vy -= 0.08;
      this.vx *= f; this.vz *= f; this.vy *= 0.98;
      if (this.collidedH) this.sprinting = false;
    }
    // 水に入った瞬間
    if (this.inWater && !this.wasInWaterPrev && Math.abs(this.vy) > 0.15) this.onSplash?.(Math.abs(this.vy));
    this.wasInWaterPrev = this.inWater;
    // 足音用の歩行距離
    const hd = Math.hypot(this.x - this.px, this.z - this.pz);
    if (this.onGround && !this.flying && !this.inWater) {
      this.stepDist += hd;
      this.walkDist += hd;
      const stride = this.sneaking ? 2.4 : this.sprinting ? 1.7 : 2.0;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
        this.onStep?.(id);
      }
    } else if (this.inWater) {
      this.walkDist += hd * 0.6;
    }
    if (this.y < -20) this.setPos(this.x, 200, this.z);
  }
  private wasInWaterPrev = false;

  private canClimbOut(): boolean {
    const box = this.aabb();
    box.y0 += 0.6; box.y1 += 0.6;
    box.x0 += this.vx * 3; box.x1 += this.vx * 3; box.z0 += this.vz * 3; box.z1 += this.vz * 3;
    return !this.overlapsSolid(box);
  }

  /** ブロックを置いてもプレイヤーと重ならないか */
  intersectsBlock(bx: number, by: number, bz: number, id = -1): boolean {
    const b = this.aabb();
    const boxes = id > 0 ? collisionBoxes(id) : null;
    if (!boxes) return b.x1 > bx && b.x0 < bx + 1 && b.y1 > by && b.y0 < by + 1 && b.z1 > bz && b.z0 < bz + 1;
    for (const c of boxes) {
      if (b.x1 > bx + c[0] && b.x0 < bx + c[3] && b.y1 > by + c[1] && b.y0 < by + c[4] && b.z1 > bz + c[2] && b.z0 < bz + c[5]) return true;
    }
    return false;
  }

  eyePos(alpha: number, out: { x: number; y: number; z: number }) {
    out.x = this.px + (this.x - this.px) * alpha;
    out.y = this.py + (this.y - this.py) * alpha + this.prevEye + (this.eye - this.prevEye) * alpha;
    out.z = this.pz + (this.z - this.pz) * alpha;
  }
}
export { IS_LIQUID };
