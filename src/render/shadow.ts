// 太陽/月からの平行光源によるシャドウマップ（プレイヤー追従・テクセルスナップ付き）
import * as THREE from "three";

export class Shadow {
  rt!: THREE.WebGLRenderTarget;
  camera: THREE.OrthographicCamera;
  scene = new THREE.Scene();
  size = 2048;
  radius = 60;
  enabled = true;
  private frame = 0;
  skip = 1;

  constructor(private uniforms: { uShadowMap: THREE.IUniform; uShadowMatrix: THREE.IUniform; uShadowOn: THREE.IUniform; uShadowTexel: THREE.IUniform }, group: THREE.Group) {
    this.camera = new THREE.OrthographicCamera(-this.radius, this.radius, this.radius, -this.radius, 0.5, 520);
    this.scene.add(group);
    this.resize(this.size);
  }

  resize(size: number) {
    this.size = size;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(size, size),
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });
    this.uniforms.uShadowMap.value = this.rt.depthTexture;
    this.uniforms.uShadowTexel.value.set(1 / size, 1 / size);
  }

  setRadius(r: number) {
    this.radius = r;
    const c = this.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.updateProjectionMatrix();
  }

  update(renderer: THREE.WebGLRenderer, lightDir: THREE.Vector3, focus: THREE.Vector3, active: boolean) {
    this.uniforms.uShadowOn.value = this.enabled && active ? 1 : 0;
    if (!this.enabled || !active) return;
    if (this.skip > 1 && this.frame++ % this.skip !== 0) return;
    const cam = this.camera;
    const L = lightDir.clone().normalize();
    const D = 260;
    const target = focus.clone();
    cam.up.set(Math.abs(L.y) > 0.98 ? 1 : 0, Math.abs(L.y) > 0.98 ? 0 : 1, 0);
    cam.position.copy(target).addScaledVector(L, D);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    // 光空間でテクセルにスナップ（影のちらつき防止）
    const ts = (2 * this.radius) / this.size;
    const v = target.clone().applyMatrix4(cam.matrixWorldInverse);
    const sx = Math.round(v.x / ts) * ts - v.x;
    const sy = Math.round(v.y / ts) * ts - v.y;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const upv = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const off = right.multiplyScalar(sx).addScaledVector(upv, sy);
    target.add(off);
    cam.position.copy(target).addScaledVector(L, D);
    cam.lookAt(target);
    cam.updateMatrixWorld();
    (this.uniforms.uShadowMatrix.value as THREE.Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, cam);
    renderer.setRenderTarget(prevTarget);
  }
}
