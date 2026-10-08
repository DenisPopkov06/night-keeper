import * as THREE from "three";
import { Clock } from "@/core/Clock";
import { InputManager } from "@/core/InputManager";
import { AssetLoader } from "@/core/AssetLoader";
import { SceneManager } from "@/core/SceneManager";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new Clock();
  private readonly input = new InputManager();
  private readonly assetLoader = new AssetLoader();
  readonly sceneManager = new SceneManager(this.assetLoader);

  private running = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(
      70,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );

    this.input.attach(canvas);
    window.addEventListener("resize", () => this.onResize());
    this.onResize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
  }

  private readonly loop = (nowMs: number): void => {
    if (!this.running) return;

    const delta = this.clock.tick(nowMs);
    this.update(delta);
    this.renderer.render(this.sceneManager.scene, this.camera);

    requestAnimationFrame(this.loop);
  };

  private update(_deltaSec: number): void {
    // TODO: вызов update() у активных систем (PlayerController, FlashlightSystem и т.д.) — задача 5.2
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
