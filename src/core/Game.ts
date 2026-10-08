import * as THREE from "three";
import { Clock } from "@/core/Clock";
import { InputManager } from "@/core/InputManager";
import { AssetLoader } from "@/core/AssetLoader";
import { SceneManager } from "@/core/SceneManager";
import { PlayerController } from "@/systems/PlayerController";
import { FlashlightSystem } from "@/systems/FlashlightSystem";
import { InteractionSystem } from "@/systems/InteractionSystem";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ShiftManager, type ShiftEndReason } from "@/systems/ShiftManager";
import { HintSystem } from "@/systems/HintSystem";
import { SaveSystem } from "@/systems/SaveSystem";
import { trackEvent } from "@/sdk/Analytics";

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
  private readonly stateMachine = new ObjectStateMachine();
  readonly shiftManager: ShiftManager;
  readonly hintSystem: HintSystem;
  private readonly saveSystem = new SaveSystem();

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
    this.shiftManager = new ShiftManager(this.stateMachine, (reason) => this.onShiftEnd(reason));
    this.interaction = new InteractionSystem(this.camera, this.stateMachine, this.shiftManager);
    this.hintSystem = new HintSystem(this.sceneManager.scene);
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
    this.hintSystem.update(deltaSec);

    const holdingInteract = this.input.isKeyDown("KeyE");
    this.interaction.update(this.sceneManager.getInteractableObjects(), holdingInteract, deltaSec);
    this.shiftManager.update(this.clock.getShiftRemainingSec());

    if (this.input.consumeKeyPress("KeyF")) this.flashlight.toggle();
    if (this.input.consumeKeyPress("KeyE")) this.interaction.interact();
  }

  private onShiftEnd(reason: ShiftEndReason): void {
    this.clock.pause();

    const shiftIndex = this.shiftManager.getCurrentConfig()?.shiftIndex ?? 0;
    trackEvent({ name: "shift_end", shiftIndex, reason });
    void this.persistShiftProgress(shiftIndex);

    // TODO: показать ShiftReportScreen + Ads.showFullscreenAd перед следующей сменой
    // (кнопка "следующая смена" на экране итогов) — задача 5.5
  }

  private async persistShiftProgress(completedShiftIndex: number): Promise<void> {
    const current = await this.saveSystem.load();
    this.saveSystem.save({ ...current, shiftIndex: completedShiftIndex + 1 });
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
