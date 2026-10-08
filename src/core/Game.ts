import * as THREE from "three";
import { Clock } from "@/core/Clock";
import { InputManager } from "@/core/InputManager";
import { AssetLoader } from "@/core/AssetLoader";
import { SceneManager } from "@/core/SceneManager";
import { PlayerController } from "@/systems/PlayerController";
import { FlashlightSystem } from "@/systems/FlashlightSystem";
import { InteractionSystem } from "@/systems/InteractionSystem";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new Clock();
  private readonly input = new InputManager();
  private readonly assetLoader = new AssetLoader();
  readonly sceneManager = new SceneManager(this.assetLoader);

  private readonly playerController: PlayerController;
  readonly flashlight = new FlashlightSystem();
  private readonly interaction: InteractionSystem;

  private running = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.camera = new THREE.PerspectiveCamera(
      70,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );
    // Камера добавляется в сцену, чтобы прикреплённый к ней SpotLight (фонарик)
    // попадал в граф рендера — THREE обходит scene.children, а не камеру отдельно.
    this.sceneManager.scene.add(this.camera);

    this.playerController = new PlayerController(this.camera, this.input);
    this.interaction = new InteractionSystem(this.camera);
    this.flashlight.attachToCamera(this.camera);

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

  private update(deltaSec: number): void {
    this.playerController.update(deltaSec);
    this.flashlight.update(deltaSec);
    this.interaction.update(this.sceneManager.getInteractableObjects());

    if (this.input.consumeKeyPress("KeyF")) this.flashlight.toggle();
    if (this.input.consumeKeyPress("KeyE")) this.interaction.interact();
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
