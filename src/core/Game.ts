import * as THREE from "three";
import { ObjectState, type ZoneLayout } from "@/data/types";
import { Clock } from "@/core/Clock";
import { InputManager } from "@/core/InputManager";
import { AssetLoader } from "@/core/AssetLoader";
import { SceneManager } from "@/core/SceneManager";
import { PlayerController } from "@/systems/PlayerController";
import { FlashlightSystem } from "@/systems/FlashlightSystem";
import { InteractionSystem } from "@/systems/InteractionSystem";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ShiftManager, type ShiftEndReason } from "@/systems/ShiftManager";
import { getShiftConfig } from "@/systems/DifficultyScaler";
import { HintSystem, distanceTo, findNearestInstanceId, relativeBearing } from "@/systems/HintSystem";
import { SaveSystem } from "@/systems/SaveSystem";
import { trackEvent } from "@/sdk/Analytics";
import { showFullscreenAd } from "@/sdk/Ads";
import { HUD, type HUDTask } from "@/ui/HUD";
import { formatTaskLabel } from "@/ui/taskLabels";
import { ShiftReportScreen } from "@/ui/ShiftReportScreen";
import { PauseMenu } from "@/ui/PauseMenu";
import { createPostProcessing, type PostProcessingPipeline } from "@/render/PostProcessing";

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new Clock();
  private readonly input = new InputManager();
  private readonly assetLoader = new AssetLoader();
  private readonly stateMachine = new ObjectStateMachine();
  readonly sceneManager = new SceneManager(this.assetLoader, this.stateMachine);

  private readonly playerController: PlayerController;
  readonly flashlight = new FlashlightSystem();
  private readonly interaction: InteractionSystem;
  readonly shiftManager: ShiftManager;
  readonly hintSystem: HintSystem;
  private readonly saveSystem = new SaveSystem();

  private readonly hud: HUD;
  private readonly shiftReportScreen: ShiftReportScreen;
  private readonly pauseMenu: PauseMenu;
  private readonly postProcessing: PostProcessingPipeline;

  private running = false;
  private currentShiftIndex = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(
      70,
      canvas.clientWidth / canvas.clientHeight,
      0.1,
      1000,
    );
    // Камера добавляется в сцену, чтобы прикреплённый к ней SpotLight (фонарик)
    // попадал в граф рендера — THREE обходит scene.children, а не камеру отдельно.
    this.sceneManager.scene.add(this.camera);
    this.postProcessing = createPostProcessing(this.renderer, this.sceneManager.scene, this.camera);

    this.playerController = new PlayerController(this.camera, this.input);
    this.shiftManager = new ShiftManager(this.stateMachine, (reason) => this.onShiftEnd(reason));
    this.interaction = new InteractionSystem(
      this.camera,
      this.stateMachine,
      this.shiftManager,
      this.sceneManager,
    );
    this.hintSystem = new HintSystem(this.sceneManager.scene);
    this.flashlight.attachToCamera(this.camera);

    this.hud = new HUD(uiRoot);
    this.shiftReportScreen = new ShiftReportScreen(uiRoot, () => {
      showFullscreenAd(undefined, () => this.startShift());
    });
    this.pauseMenu = new PauseMenu(
      uiRoot,
      this.saveSystem,
      () => this.togglePause(),
      () => window.location.reload(), // нет отдельного экрана главного меню — пока просто рестарт
    );

    this.input.attach(canvas);
    window.addEventListener("resize", () => this.onResize());
    this.onResize();
  }

  /** Загружает зону и запускает первую смену в ней. */
  async beginFirstShift(layout: ZoneLayout): Promise<void> {
    await this.sceneManager.loadZone(layout);
    this.startShift();
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
    this.postProcessing.update(delta);
    this.postProcessing.render();

    requestAnimationFrame(this.loop);
  };

  private update(deltaSec: number): void {
    // Пока открыт экран итогов смены — Escape не должен открывать поверх него паузу,
    // там и так уже всё остановлено, а курсор специально отпущен под клик по кнопке.
    if (!this.shiftReportScreen.isVisible() && this.input.consumeKeyPress("Escape")) {
      this.togglePause();
    }

    const flashlightPressed = this.input.consumeKeyPress("KeyF");
    const interactPressed = this.input.consumeKeyPress("KeyE");

    if (!this.pauseMenu.isVisible()) {
      this.playerController.update(
        deltaSec,
        this.interaction.getMoveSpeedMultiplier(),
        this.sceneManager.getCollisionCircles(),
        this.sceneManager.getStaticCollisionMeshes(),
      );
      this.flashlight.update(deltaSec);
      this.hintSystem.update(deltaSec);

      const holdingInteract = this.input.isKeyDown("KeyE");
      this.interaction.update(this.sceneManager.getInteractableObjects(), holdingInteract, deltaSec);
      this.shiftManager.update(this.clock.getShiftRemainingSec());

      if (flashlightPressed) this.flashlight.toggle();
      if (interactPressed) this.interaction.interact();
    }

    this.hud.update({
      flashlightChargePercent: this.flashlight.getChargePercent(),
      flashlightOn: this.flashlight.isOn(),
      remainingSec: this.clock.getShiftRemainingSec(),
      tasks: this.buildHudTasks(),
      interactionPrompt: this.interaction.getInteractionPrompt(),
      nearestTaskDirection: this.buildNearestTaskDirection(),
      // Пока открыт экран (пауза/итоги) — подсказка про захват курсора неуместна,
      // хоть курсор формально и не захвачен.
      pointerLocked:
        this.pauseMenu.isVisible() || this.shiftReportScreen.isVisible() || this.input.isPointerLocked(),
    });
  }

  private buildHudTasks(): HUDTask[] {
    const config = this.shiftManager.getCurrentConfig();
    if (!config) return [];

    const completed = this.shiftManager.getCompletedTaskIds();
    return config.tasks.map((task) => {
      const objectId = this.sceneManager.getObjectByInstanceId(task.instanceId)?.userData
        .objectId as string | undefined;
      return {
        label: objectId ? formatTaskLabel(objectId, task.state) : `${task.instanceId} (${task.state})`,
        done: completed.has(task.instanceId),
      };
    });
  }

  /** Бесплатная общая подсказка блокнота смотрителя (раздел 6 ТЗ): примерное
   *  направление + расстояние до ближайшей невыполненной задачи, без точной метки
   *  (точная подсветка — платный HintSystem за rewarded-рекламу, это другое). */
  private buildNearestTaskDirection(): { bearingRadians: number; distanceMeters: number } | null {
    const config = this.shiftManager.getCurrentConfig();
    if (!config) return null;

    const completed = this.shiftManager.getCompletedTaskIds();
    const playerPosition = new THREE.Vector3();
    this.camera.getWorldPosition(playerPosition);

    const candidates = config.tasks
      .filter((task) => !completed.has(task.instanceId))
      .map((task) => {
        const object = this.sceneManager.getObjectByInstanceId(task.instanceId);
        if (!object) return null;
        const worldPos = object.getWorldPosition(new THREE.Vector3());
        return { instanceId: task.instanceId, position: worldPos };
      })
      .filter((c): c is { instanceId: string; position: THREE.Vector3 } => c !== null);

    const nearestId = findNearestInstanceId(playerPosition, candidates);
    const nearest = candidates.find((c) => c.instanceId === nearestId);
    if (!nearest) return null;

    return {
      bearingRadians: relativeBearing(playerPosition, nearest.position, this.camera.rotation.y),
      distanceMeters: distanceTo(playerPosition, nearest.position),
    };
  }

  private togglePause(): void {
    if (this.pauseMenu.isVisible()) {
      this.pauseMenu.hide();
      this.clock.resume();
      // Без этого пришлось бы ещё раз кликать по канвасу, чтобы заново поймать
      // курсор — браузер сам снимает pointer lock при открытии паузы (Escape).
      this.input.requestPointerLock();
    } else {
      this.pauseMenu.show();
      this.clock.pause();
    }
  }

  private startShift(): void {
    const layout = this.sceneManager.getCurrentLayout();
    if (!layout) {
      console.warn("[Game] startShift() called without a loaded zone");
      return;
    }

    this.playerController.teleportTo(layout.spawnPoint);

    const config = getShiftConfig(this.currentShiftIndex, layout.zoneId, layout.objects);
    this.shiftManager.startShift(config);

    // ShiftManager уже перевёл объекты в MISSING в ObjectStateMachine — здесь только
    // физически "роняем" соответствующий инстанс в точку spawnPosition (в траву рядом).
    for (const task of config.tasks) {
      if (task.state === ObjectState.MISSING && task.spawnPosition) {
        this.sceneManager.relocateInstance(task.instanceId, task.spawnPosition);
      }
    }

    this.clock.startShiftTimer(config.timeLimitSec);
    this.clock.resume();
    trackEvent({ name: "shift_start", shiftIndex: this.currentShiftIndex });
    this.shiftReportScreen.hide();
    // Курсор был отпущен под клик по кнопке "следующая смена" — захватываем обратно,
    // чтобы не заставлять игрока кликать по канвасу ещё раз в начале смены.
    this.input.requestPointerLock();

    this.currentShiftIndex += 1;
  }

  private onShiftEnd(reason: ShiftEndReason): void {
    this.clock.pause();
    this.interaction.forceDropCarried();
    // Экран итогов смены кликабелен — без этого пришлось бы жать Escape вручную,
    // чтобы вообще увидеть курсор и нажать "следующая смена".
    this.input.exitPointerLock();

    const config = this.shiftManager.getCurrentConfig();
    const shiftIndex = config?.shiftIndex ?? 0;
    trackEvent({ name: "shift_end", shiftIndex, reason });
    void this.persistShiftProgress(shiftIndex);

    this.shiftReportScreen.show({
      tasksCompleted: this.shiftManager.getCompletedCount(),
      tasksTotal: config?.tasks.length ?? 0,
      timeSpentSec: config ? config.timeLimitSec - this.clock.getShiftRemainingSec() : 0,
      // Формула очков не определена в ТЗ — временно используем число
      // выполненных задач, пока не появится реальная система подсчёта.
      score: this.shiftManager.getCompletedCount(),
    });
  }

  private async persistShiftProgress(completedShiftIndex: number): Promise<void> {
    const current = await this.saveSystem.load();
    this.saveSystem.save({ ...current, shiftIndex: completedShiftIndex + 1 });
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.postProcessing.setSize(clientWidth, clientHeight);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
