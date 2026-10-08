import * as THREE from "three";
import type { ZoneLayout, PlacedObject } from "@/data/types";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { AssetLoader } from "@/core/AssetLoader";

function disposeObject(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      node.geometry.dispose();
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      for (const material of materials) material.dispose();
    }
  });
}

export class SceneManager {
  readonly scene = new THREE.Scene();

  private zoneRoot: THREE.Group | null = null;
  private currentZoneId: string | null = null;
  private currentLayout: ZoneLayout | null = null;
  private readonly interactableObjects: THREE.Object3D[] = [];

  constructor(private readonly assetLoader: AssetLoader) {}

  async loadZone(layout: ZoneLayout): Promise<void> {
    this.unloadCurrentZone();

    const zoneRoot = new THREE.Group();
    zoneRoot.name = `zone:${layout.zoneId}`;

    try {
      const zoneGltf = await this.assetLoader.loadModel(layout.modelPath);
      zoneRoot.add(zoneGltf.scene.clone(true));
    } catch (error) {
      // Контент приходит от дизайнера постепенно — отсутствующая/битая модель зоны
      // не должна ронять весь игровой цикл, только оставлять зону без базовой геометрии.
      console.warn(`[SceneManager] не удалось загрузить модель зоны "${layout.modelPath}"`, error);
    }

    await Promise.all(
      layout.objects.map((placed) => this.spawnPlacedObject(placed, zoneRoot)),
    );

    this.scene.add(zoneRoot);
    this.zoneRoot = zoneRoot;
    this.currentZoneId = layout.zoneId;
    this.currentLayout = layout;
  }

  private async spawnPlacedObject(placed: PlacedObject, parent: THREE.Group): Promise<void> {
    const catalogEntry = OBJECTS_CATALOG[placed.objectId];
    if (!catalogEntry) {
      console.warn(`[SceneManager] objectId "${placed.objectId}" отсутствует в OBJECTS_CATALOG`);
      return;
    }

    let gltf;
    try {
      gltf = await this.assetLoader.loadModel(catalogEntry.modelPath);
    } catch (error) {
      console.warn(`[SceneManager] не удалось загрузить модель объекта "${placed.objectId}"`, error);
      return;
    }

    const instance = gltf.scene.clone(true);
    instance.position.set(placed.position.x, placed.position.y, placed.position.z);
    instance.rotation.y = THREE.MathUtils.degToRad(placed.rotationY);
    instance.userData.instanceId = placed.instanceId;
    instance.userData.objectId = placed.objectId;
    instance.userData.interactable = catalogEntry.interactable;

    parent.add(instance);
    if (catalogEntry.interactable) this.interactableObjects.push(instance);
  }

  unloadCurrentZone(): void {
    if (this.zoneRoot) {
      this.scene.remove(this.zoneRoot);
      disposeObject(this.zoneRoot);
    }
    this.zoneRoot = null;
    this.interactableObjects.length = 0;
    this.currentZoneId = null;
    this.currentLayout = null;
  }

  getCurrentZoneId(): string | null {
    return this.currentZoneId;
  }

  getCurrentLayout(): ZoneLayout | null {
    return this.currentLayout;
  }

  getInteractableObjects(): THREE.Object3D[] {
    return this.interactableObjects;
  }
}
