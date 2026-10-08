import * as THREE from "three";

const cache = new Map<string, THREE.Material>();

function getOrCreate(key: string, factory: () => THREE.Material): THREE.Material {
  let material = cache.get(key);
  if (!material) {
    material = factory();
    cache.set(key, material);
  }
  return material;
}

export const MaterialsLib = {
  stone: (): THREE.Material =>
    getOrCreate("stone", () => new THREE.MeshStandardMaterial({ color: 0x8a8a8a, roughness: 0.9 })),
  metal: (): THREE.Material =>
    getOrCreate(
      "metal",
      () => new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 0.3, metalness: 0.8 }),
    ),
  grass: (): THREE.Material =>
    getOrCreate("grass", () => new THREE.MeshStandardMaterial({ color: 0x3c4a2f, roughness: 1 })),
};
