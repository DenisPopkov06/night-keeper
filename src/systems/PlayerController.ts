import * as THREE from "three";
import { InputManager } from "@/core/InputManager";
import type { Vec3 } from "@/data/types";
import type { CollisionCircle } from "@/core/SceneManager";

const MOUSE_SENSITIVITY = 0.0025;
// Референсный рост персонажа из раздела 4.1 ТЗ (~1.7м) минус небольшой запас
// до уровня глаз, чтобы камера не торчала выше модели персонажа (когда она появится).
const EYE_HEIGHT = 1.6;
const PLAYER_RADIUS = 0.35;
// Высота глаз ловит стволы деревьев/столбы, но пропускает всё, что ниже — бочки,
// ящики, лавочки, валуны редко выше полуметра. Второй, низкий уровень лучей
// (относительно камеры) добавляет шанс зацепить и такие объекты тоже.
const LOW_RAY_HEIGHT_DROP = 1.1;

// Прыжок — простая баллистика по высоте камеры, без физдвижка (тот же подход, что и
// у коллизии). JUMP_SPEED/GRAVITY подобраны так, чтобы прыжок перелетал через
// надгробие/бочку/ящик (ростом до ~0.6м), но не читался как "полёт".
const JUMP_SPEED = 4.2;
const GRAVITY = 13;
// Высота, с которой перешагиваемые (vaultable) круги перестают блокировать — чуть
// ниже пика прыжка, а не сразу от земли, чтобы отрыв от земли не читерил коллизию.
const VAULT_CLEAR_HEIGHT = 0.45;

export class PlayerController {
  private readonly moveInput = new THREE.Vector3();
  private readonly yawOnly = new THREE.Euler(0, 0, 0, "YXZ");
  private readonly moveSpeed = 3;
  private readonly raycaster = new THREE.Raycaster();
  private readonly tmpStep = new THREE.Vector3();
  private readonly tmpNextPos = new THREE.Vector3();
  private readonly tmpDirection = new THREE.Vector3();
  private readonly tmpPerp = new THREE.Vector3();
  private readonly tmpRayOrigin = new THREE.Vector3();

  // Высота глаз на земле (без прыжка) — отдельно от camera.position.y, который во
  // время прыжка временно выше. groundEyeY не меняется XZ-движением зоны (та всегда
  // плоская — см. layout.json, у всех объектов y:0), только teleportTo.
  private groundEyeY = EYE_HEIGHT;
  private jumpHeight = 0;
  private verticalVelocity = 0;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: InputManager,
  ) {
    this.camera.rotation.order = "YXZ";
  }

  /** Ставит камеру в точку спавна зоны на высоте глаз — spawnPoint в ZoneLayout
   *  задаёт позицию на уровне пола, а не камеры. */
  teleportTo(spawnPoint: Vec3): void {
    this.groundEyeY = spawnPoint.y + EYE_HEIGHT;
    this.jumpHeight = 0;
    this.verticalVelocity = 0;
    this.camera.position.set(spawnPoint.x, this.groundEyeY, spawnPoint.z);
  }

  /** speedMultiplier — например, замедление при переносе предмета (раздел 2 ТЗ).
   *  collisionCircles/collisionMeshes — простая коллизия без физдвижка (раздел 1 ТЗ:
   *  "полноценный физдвижок не нужен для walking sim"): круги для расставленных
   *  объектов (надгробия) + луч вперёд по статической геометрии зоны (деревья,
   *  фонари, ограда). */
  update(
    deltaSec: number,
    speedMultiplier = 1,
    collisionCircles: readonly CollisionCircle[] = [],
    collisionMeshes: readonly THREE.Object3D[] = [],
  ): void {
    this.moveInput.set(0, 0, 0);
    if (this.input.isKeyDown("KeyW")) this.moveInput.z -= 1;
    if (this.input.isKeyDown("KeyS")) this.moveInput.z += 1;
    if (this.input.isKeyDown("KeyA")) this.moveInput.x -= 1;
    if (this.input.isKeyDown("KeyD")) this.moveInput.x += 1;

    const virtualMove = this.input.getVirtualMove();
    this.moveInput.x += virtualMove.x;
    this.moveInput.z += virtualMove.y;

    if (this.moveInput.lengthSq() > 0) {
      if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
      this.yawOnly.y = this.camera.rotation.y;
      this.moveInput.applyEuler(this.yawOnly);
      this.moveInput.multiplyScalar(this.moveSpeed * speedMultiplier * deltaSec);
      // На пике прыжка перешагиваемые (vaultable) круги — надгробия, бочки, ящики,
      // валуны — не блокируют; меши (забор/дом/ворота/скамья) и невысокие vaultable:
      // false круги (фонарный столб и т.п.) остаются стеной и в прыжке.
      const activeCircles =
        this.jumpHeight > VAULT_CLEAR_HEIGHT ? collisionCircles.filter((c) => !c.vaultable) : collisionCircles;
      this.moveWithCollision(this.moveInput, activeCircles, collisionMeshes);
    }

    this.updateJump(deltaSec);

    const { x: deltaX, y: deltaY } = this.input.consumeMouseDelta();
    this.camera.rotation.y -= deltaX * MOUSE_SENSITIVITY;
    this.camera.rotation.x -= deltaY * MOUSE_SENSITIVITY;
    this.camera.rotation.x = THREE.MathUtils.clamp(
      this.camera.rotation.x,
      -Math.PI / 2 + 0.01,
      Math.PI / 2 - 0.01,
    );
  }

  /** Пробел — прыжок простой баллистикой по высоте камеры (не физдвижок, тот же
   *  подход, что у коллизии). Только по земле уходит в прыжок — двойной прыжок
   *  в воздухе не даём. moveWithCollision уже отработал XZ этим кадром, так что
   *  camera.position.y можно просто переустановить поверх него. */
  private updateJump(deltaSec: number): void {
    if (this.input.consumeKeyPress("Space") && this.jumpHeight <= 0) {
      this.verticalVelocity = JUMP_SPEED;
    }

    if (this.jumpHeight > 0 || this.verticalVelocity > 0) {
      this.verticalVelocity -= GRAVITY * deltaSec;
      this.jumpHeight += this.verticalVelocity * deltaSec;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.verticalVelocity = 0;
      }
    }

    this.camera.position.y = this.groundEyeY + this.jumpHeight;
  }

  /** Двигает по осям раздельно (X, потом Z) — так движение вдоль стены не "залипает"
   *  полностью, когда игрок одновременно идёт и в разрешённом, и в заблокированном
   *  направлении (простое скольжение без вычисления нормали поверхности). */
  private moveWithCollision(
    step: THREE.Vector3,
    circles: readonly CollisionCircle[],
    meshes: readonly THREE.Object3D[],
  ): void {
    this.tmpStep.set(step.x, 0, 0);
    if (!this.isBlocked(this.tmpStep, circles, meshes)) this.camera.position.add(this.tmpStep);

    this.tmpStep.set(0, 0, step.z);
    if (!this.isBlocked(this.tmpStep, circles, meshes)) this.camera.position.add(this.tmpStep);
  }

  private isBlocked(
    step: THREE.Vector3,
    circles: readonly CollisionCircle[],
    meshes: readonly THREE.Object3D[],
  ): boolean {
    if (step.x === 0 && step.z === 0) return false;

    this.tmpNextPos.copy(this.camera.position).add(step);
    for (const circle of circles) {
      const dx = this.tmpNextPos.x - circle.x;
      const dz = this.tmpNextPos.z - circle.z;
      const minDist = circle.radius + PLAYER_RADIUS;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }

    if (meshes.length > 0) {
      const stepLength = step.length();
      this.tmpDirection.copy(step).normalize();
      this.raycaster.far = stepLength + PLAYER_RADIUS;

      // Один луч точно по курсу движения ловит только то, что прямо по центру —
      // ствол дерева/столб фонаря чуть в стороне от линии движения он бы пропустил
      // (игрок проходил бы в него на часть своего радиуса). Поэтому с запасом
      // проверяем ещё по лучу слева и справа на ширине PLAYER_RADIUS, и на двух
      // высотах (глаза + низкий), чтобы не пропускать невысокие препятствия.
      this.tmpPerp.set(-this.tmpDirection.z, 0, this.tmpDirection.x).multiplyScalar(PLAYER_RADIUS);

      for (const heightDrop of [0, LOW_RAY_HEIGHT_DROP]) {
        for (const sign of [0, 1, -1]) {
          this.tmpRayOrigin.copy(this.camera.position);
          this.tmpRayOrigin.y -= heightDrop;
          if (sign !== 0) this.tmpRayOrigin.addScaledVector(this.tmpPerp, sign);
          this.raycaster.set(this.tmpRayOrigin, this.tmpDirection);
          if (this.raycaster.intersectObjects(meshes as THREE.Object3D[], true).length > 0) return true;
        }
      }
    }

    return false;
  }
}
