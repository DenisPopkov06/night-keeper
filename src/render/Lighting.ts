import * as THREE from "three";

export const LIGHTING_CONFIG = {
  moonColor: 0x8fa6c9,
  moonIntensity: 0.4,
  fogColor: 0x0a0d14,
  fogNear: 5,
  fogFar: 40,
};

export function createMoonLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(LIGHTING_CONFIG.moonColor, LIGHTING_CONFIG.moonIntensity);
  light.castShadow = true;
  return light;
}

export function createSceneFog(): THREE.Fog {
  return new THREE.Fog(LIGHTING_CONFIG.fogColor, LIGHTING_CONFIG.fogNear, LIGHTING_CONFIG.fogFar);
}
