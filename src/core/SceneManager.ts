import * as THREE from "three";
import type { ZoneLayout } from "@/data/types";
import { AssetLoader } from "@/core/AssetLoader";

export class SceneManager {
  readonly scene = new THREE.Scene();
  private currentZoneId: string | null = null;

  constructor(private readonly assetLoader: AssetLoader) {}

  async loadZone(layout: ZoneLayout): Promise<void> {
    await this.assetLoader.loadModel(layout.modelPath);
    // TODO: расставить PlacedObject[] в сцене, выгрузить предыдущую зону — задача 5.2
    this.currentZoneId = layout.zoneId;
  }

  unloadCurrentZone(): void {
    this.currentZoneId = null;
  }

  getCurrentZoneId(): string | null {
    return this.currentZoneId;
  }
}
