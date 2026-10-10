import * as THREE from "three";
import { ObjectState, type ZoneLayout } from "@/data/types";
import { Clock } from "@/core/Clock";
import { InputManager } from "@/core/InputManager";
import { AssetLoader } from "@/core/AssetLoader";
import { SceneManager } from "@/core/SceneManager";
import { PlayerController } from "@/systems/PlayerController";
import { FlashlightSystem } from "@/systems/FlashlightSystem";
import { StaminaSystem } from "@/systems/StaminaSystem";
import { InteractionSystem } from "@/systems/InteractionSystem";
import { ObjectStateMachine } from "@/systems/ObjectStateMachine";
import { ShiftManager, type ShiftEndReason } from "@/systems/ShiftManager";
import { getShiftConfig } from "@/systems/DifficultyScaler";
import { HintSystem } from "@/systems/HintSystem";
import { SaveSystem } from "@/systems/SaveSystem";
import { trackEvent } from "@/sdk/Analytics";
import { showFullscreenAd } from "@/sdk/Ads";
import { HUD, type HUDTask } from "@/ui/HUD";
import { formatTaskLabel } from "@/ui/taskLabels";
import { ShiftReportScreen } from "@/ui/ShiftReportScreen";
import { PauseMenu } from "@/ui/PauseMenu";
import { createPostProcessing, type PostProcessingPipeline } from "@/render/PostProcessing";

const SPRINT_SPEED_MULTIPLIER = 1.6;

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
  private readonly stamina = new StaminaSystem();
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
      const wantsSprint = this.input.isKeyDown("ShiftLeft") || this.input.isKeyDown("ShiftRight");
      this.stamina.update(deltaSec, wantsSprint);
      const sprintMultiplier = this.stamina.isSprinting() ? SPRINT_SPEED_MULTIPLIER : 1;

      this.playerController.update(
        deltaSec,
        this.interaction.getMoveSpeedMultiplier() * sprintMultiplier,
        this.stamina.isSprinting(),
        this.sceneManager.getCollisionCircles(),
        this.sceneManager.getStaticCollisionMeshes(),
        this.sceneManager.getRaycastExcludedMeshes(),
        this.sceneManager.getCollisionRects(),
      );
      this.flashlight.update(deltaSec);
      this.hintSystem.update(deltaSec);
      this.sceneManager.updateAnimations(deltaSec);

      const holdingInteract = this.input.isKeyDown("KeyE");
      this.interaction.update(this.sceneManager.getInteractableObjects(), holdingInteract, deltaSec);
      this.shiftManager.update(this.clock.getShiftRemainingSec());

      if (flashlightPressed) this.flashlight.toggle();
      if (interactPressed) this.interaction.interact();
    }

    this.hud.update({
      flashlightChargePercent: this.flashlight.getChargePercent(),
      flashlightOn: this.flashlight.isOn(),
      staminaPercent: this.stamina.getStaminaPercent(),
      remainingSec: this.clock.getShiftRemainingSec(),
      tasks: this.buildHudTasks(),
      interactionPrompt: this.interaction.getInteractionPrompt(),
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
      const objectId = this.sceneManager.getBaseObjectId(task.instanceId);
      return {
        label: objectId ? formatTaskLabel(objectId, task.state) : `${task.instanceId} (${task.state})`,
        done: completed.has(task.instanceId),
      };
    });
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

    // Раскладка не должна быть одинаковой каждую смену — переставляем, кто где
    // стоит (надгробия между собой, горшки между собой), до того как выбираем
    // задания смены, чтобы они уже ссылались на актуальные позиции.
    this.sceneManager.reshufflePlacedObjects();
    this.sceneManager.applyShiftDarkness(this.currentShiftIndex);

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
    // чтобы вообще увидеть курсор и нажать кнопку на экране итогов.
    this.input.exitPointerLock();

    const config = this.shiftManager.getCurrentConfig();
    const shiftIndex = config?.shiftIndex ?? 0;
    // Смена проиграна, если время вышло, а не все задачи выполнены (all_tasks_done
    // возможен только когда они все закрыты — см. ShiftManager.handleStateChange).
    // Раньше currentShiftIndex уже был инкрементирован в startShift() ДО этого
    // момента и ничем не откатывался при поражении — "следующая смена" на экране
    // итогов вела на shiftIndex+1, даже если игрок не выполнил задания текущей.
    // Теперь при поражении откатываем к 1-й смене: игра начинается заново, а не
    // продолжается с того места, где не вышло уложиться в срок.
    const won = reason === "all_tasks_done";
    if (!won) this.currentShiftIndex = 1;
    trackEvent({ name: "shift_end", shiftIndex, reason });
    void this.persistShiftProgress(this.currentShiftIndex);

    this.shiftReportScreen.show({
      won,
      tasksCompleted: this.shiftManager.getCompletedCount(),
      tasksTotal: config?.tasks.length ?? 0,
      timeSpentSec: config ? config.timeLimitSec - this.clock.getShiftRemainingSec() : 0,
      // Формула очков не определена в ТЗ — временно используем число
      // выполненных задач, пока не появится реальная система подсчёта.
      score: this.shiftManager.getCompletedCount(),
    });
  }

  /** nextShiftIndex — какая смена начнётся по кнопке на экране итогов (currentShiftIndex
   *  на момент вызова: следующая по порядку при победе, 1 — после отката при поражении
   *  в onShiftEnd). Сохраняем его напрямую, а не "завершённая смена + 1" — иначе при
   *  поражении на экране итогов сохранился бы номер проваленной смены, и возврат в игру
   *  после перезагрузки страницы начинался бы с неё же, а не с первой. */
  private async persistShiftProgress(nextShiftIndex: number): Promise<void> {
    const current = await this.saveSystem.load();
    this.saveSystem.save({ ...current, shiftIndex: nextShiftIndex });
  }

  private onResize(): void {
    const { clientWidth, clientHeight } = this.canvas;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.postProcessing.setSize(clientWidth, clientHeight);
    this.camera.aspect = clientWidth / clientHeight;
    this.camera.updateProjectionMatrix();
  }
}
