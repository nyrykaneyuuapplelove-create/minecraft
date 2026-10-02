// 三人称視点用の簡易プレイヤーモデル（箱の組み合わせ）
import * as THREE from "three";
import type { Player } from "./player";

const box = (w: number, h: number, d: number, color: number, oy = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, oy, 0);
  const m = new THREE.MeshBasicMaterial({ color });
  return { mesh: new THREE.Mesh(g, m), mat: m, base: new THREE.Color(color) };
};

export class PlayerModel {
  group = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private body = new THREE.Group();
  private parts: { mat: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  private swing = 0;

  constructor() {
    const add = (parent: THREE.Object3D, b: ReturnType<typeof box>) => {
      parent.add(b.mesh);
      this.parts.push(b);
    };
    // 頭と髪
    this.head.position.set(0, 1.45, 0);
    add(this.head, box(0.5, 0.5, 0.5, 0xe0b090, 0.25));
    const hair = box(0.54, 0.22, 0.54, 0x3a2a22, 0.5);
    add(this.head, hair);
    const hairBack = box(0.54, 0.4, 0.14, 0x3a2a22, 0.2);
    hairBack.mesh.position.z = 0.2;
    add(this.head, hairBack);
    // 目
    const eyeL = box(0.08, 0.08, 0.02, 0x20242c, 0.22);
    eyeL.mesh.position.set(-0.12, 0, -0.26);
    const eyeR = box(0.08, 0.08, 0.02, 0x20242c, 0.22);
    eyeR.mesh.position.set(0.12, 0, -0.26);
    add(this.head, eyeL);
    add(this.head, eyeR);
    // 胴（ジャケット）
    this.body.position.set(0, 0.72, 0);
    add(this.body, box(0.5, 0.75, 0.26, 0x2f7f9a, 0.37));
    add(this.body, box(0.52, 0.12, 0.28, 0xd8c070, 0.03));
    // 腕
    this.armL.position.set(-0.35, 1.42, 0);
    add(this.armL, box(0.2, 0.7, 0.2, 0x2f7f9a, -0.3));
    this.armR.position.set(0.35, 1.42, 0);
    add(this.armR, box(0.2, 0.7, 0.2, 0x2f7f9a, -0.3));
    // 脚
    this.legL.position.set(-0.13, 0.72, 0);
    add(this.legL, box(0.24, 0.72, 0.24, 0x2c3558, -0.36));
    this.legR.position.set(0.13, 0.72, 0);
    add(this.legR, box(0.24, 0.72, 0.24, 0x2c3558, -0.36));
    for (const l of [this.legL, this.legR]) {
      const boot = box(0.26, 0.16, 0.28, 0x4a3426, -0.64);
      add(l, boot);
    }
    this.group.add(this.head, this.body, this.armL, this.armR, this.legL, this.legR);
    this.group.visible = false;
  }

  update(p: Player, alpha: number, visible: boolean, light: THREE.Vector3, dt: number, pitch: number) {
    this.group.visible = visible;
    if (!visible) return;
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, z = p.pz + (p.z - p.pz) * alpha;
    this.group.position.set(x, y, z);
    // 向き：体は進行方向寄り、頭は視線
    this.group.rotation.y = p.yaw + Math.PI;
    this.head.rotation.x = -pitch * 0.9;
    const speed = Math.hypot(p.x - p.px, p.z - p.pz) * 20;
    const target = p.onGround || p.inWater ? Math.min(1, speed / 4) : 0.1;
    this.swing += (target - this.swing) * Math.min(1, dt * 10);
    const ph = p.walkDist * 0.6 * Math.PI;
    const a = Math.sin(ph) * 0.9 * this.swing;
    this.armL.rotation.x = a;
    this.armR.rotation.x = -a;
    this.legL.rotation.x = -a;
    this.legR.rotation.x = a;
    const sneak = p.sneaking ? 1 : 0;
    this.body.rotation.x = sneak * 0.35;
    this.group.scale.y = p.sneaking ? 0.92 : 1;
    if (p.flying && p.sprinting) this.group.rotation.x = 0.0;
    // 明るさ
    const l = Math.min(1.4, Math.max(0.05, (light.x + light.y + light.z) / 3));
    for (const q of this.parts) q.mat.color.copy(q.base).multiplyScalar(l);
  }
}
