// 地形用マテリアル一式（不透明・切り抜き・半透明・影）と、テクスチャ配列の作成
import * as THREE from "three";
import { TERRAIN_VS, TERRAIN_FS, SHADOW_VS, SHADOW_FS } from "./terrainShader";
import { TEX, type TextureSet } from "../textures";

export interface TerrainMaterials {
  opaque: THREE.ShaderMaterial;
  cutout: THREE.ShaderMaterial;
  translucent: THREE.ShaderMaterial;
  shadowOpaque: THREE.ShaderMaterial;
  shadowCutout: THREE.ShaderMaterial;
  albedo: THREE.DataArrayTexture;
  mask: THREE.DataArrayTexture;
  shadowUniforms: {
    uShadowMap: THREE.IUniform;
    uShadowMatrix: THREE.IUniform;
    uShadowOn: THREE.IUniform;
    uShadowTexel: THREE.IUniform;
  };
}

function arrayTexture(data: Uint8Array, count: number, mip: boolean) {
  const t = new THREE.DataArrayTexture(data, TEX, TEX, count);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createTerrainMaterials(shared: Record<string, THREE.IUniform>, tex: TextureSet): TerrainMaterials {
  const albedo = arrayTexture(tex.albedo, tex.count, true);
  const mask = arrayTexture(tex.mask, tex.count, true);
  const shadowUniforms = {
    uShadowMap: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowOn: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
  };
  const uniforms = { ...shared, ...shadowUniforms, uAlbedo: { value: albedo }, uMask: { value: mask } };

  const opaque = new THREE.ShaderMaterial({ vertexShader: TERRAIN_VS, fragmentShader: TERRAIN_FS, uniforms });
  const cutout = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VS,
    fragmentShader: TERRAIN_FS,
    uniforms,
    side: THREE.DoubleSide,
    defines: { CUTOUT: "", DOUBLE_SIDED: "" },
  });
  const translucent = new THREE.ShaderMaterial({
    vertexShader: TERRAIN_VS,
    fragmentShader: TERRAIN_FS,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    defines: { WATER: "", DOUBLE_SIDED: "" },
  });

  const shadowOpaque = new THREE.ShaderMaterial({
    vertexShader: SHADOW_VS,
    fragmentShader: SHADOW_FS,
    uniforms: { ...shared, uAlbedo: { value: albedo } },
    colorWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: 1.5,
    polygonOffsetUnits: 2,
  });
  const shadowCutout = new THREE.ShaderMaterial({
    vertexShader: SHADOW_VS,
    fragmentShader: SHADOW_FS,
    uniforms: { ...shared, uAlbedo: { value: albedo } },
    side: THREE.DoubleSide,
    colorWrite: false,
    defines: { CUTOUT: "" },
  });
  return { opaque, cutout, translucent, shadowOpaque, shadowCutout, albedo, mask, shadowUniforms };
}
