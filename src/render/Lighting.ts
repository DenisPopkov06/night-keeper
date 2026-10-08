import * as THREE from "three";

export const LIGHTING_CONFIG = {
  moonColor: 0x8fa6c9,
  moonIntensity: 0.4,
  moonPosition: new THREE.Vector3(15, 25, 10),
  ambientColor: 0x1a2030,
  ambientIntensity: 0.25,
  fogColor: 0x0a0d14,
  fogNear: 5,
  fogFar: 40,
  shadowFrustumSize: 25,
  shadowMapSize: 1024,
};

export function createMoonLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(LIGHTING_CONFIG.moonColor, LIGHTING_CONFIG.moonIntensity);
  light.position.copy(LIGHTING_CONFIG.moonPosition);
  light.castShadow = true;

  const frustum = LIGHTING_CONFIG.shadowFrustumSize;
  light.shadow.camera.left = -frustum;
  light.shadow.camera.right = frustum;
  light.shadow.camera.top = frustum;
  light.shadow.camera.bottom = -frustum;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 80;
  light.shadow.mapSize.set(LIGHTING_CONFIG.shadowMapSize, LIGHTING_CONFIG.shadowMapSize);
  light.shadow.bias = -0.0015;

  return light;
}

/** Слабая общая подсветка, чтобы тени не проваливались в чистый чёрный — не луна,
 *  а просто базовая видимость геометрии, пока нет полноценного GI/light-пробов. */
export function createAmbientFill(): THREE.AmbientLight {
  return new THREE.AmbientLight(LIGHTING_CONFIG.ambientColor, LIGHTING_CONFIG.ambientIntensity);
}

export function createSceneFog(): THREE.Fog {
  return new THREE.Fog(LIGHTING_CONFIG.fogColor, LIGHTING_CONFIG.fogNear, LIGHTING_CONFIG.fogFar);
}
