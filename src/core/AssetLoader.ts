import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";

export class AssetLoader {
  private readonly loader: GLTFLoader;
  private readonly cache = new Map<string, Promise<GLTF>>();

  constructor() {
    const dracoLoader = new DRACOLoader();
    // Абсолютный "/draco/" не сработал бы, если сборку разместят в подкаталоге
    // (как иногда бывает на Яндекс Играх) — BASE_URL учитывает фактический base.
    dracoLoader.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    this.loader = new GLTFLoader();
    this.loader.setDRACOLoader(dracoLoader);
  }

  loadModel(modelPath: string): Promise<GLTF> {
    const cached = this.cache.get(modelPath);
    if (cached) return cached;

    const pending = this.loader.loadAsync(modelPath);
    this.cache.set(modelPath, pending);
    return pending;
  }
}
