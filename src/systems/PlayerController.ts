import * as THREE from "three";
import { InputManager } from "@/core/InputManager";
import type { Vec3 } from "@/data/types";
import type { CollisionCircle, CollisionRect } from "@/core/SceneManager";

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
// у коллизии). Два разных прыжка в зависимости от того, зажат ли спринт в момент
// толчка: обычный — пик ~1.2м, ~0.95с в воздухе, хватает перемахнуть небольшой
// объект (надгробие/бочку/ящик); с разбега (спринт) — заметно выше и дольше, только
// так хватает времени и скорости перелететь по-настоящему крупный объект (скамья,
// валун) — простым прыжком с места их перепрыгнуть по-прежнему нельзя.
const JUMP_SPEED = 5.2;
// Было 7.5 (пик ~2.6м) — ощущалось слишком высоко/долго. 6.5 (пик ~1.9м) заметно
// ниже, но всё ещё с комфортным запасом по времени/скорости перелететь скамью или
// крупный валун с разбега (6.0 давало слишком узкое окно по таймингу прыжка).
const RUNNING_JUMP_SPEED = 6.5;
const GRAVITY = 11;
// Высота, с которой перешагиваемые (vaultable) круги перестают блокировать — чуть
// ниже пика прыжка, а не сразу от земли, чтобы отрыв от земли не читерил коллизию.
const VAULT_CLEAR_HEIGHT = 0.4;
// Скорость (м/с), с которой игрока плавно выталкивает из круга, если он всё же
// приземлился внутри — не мгновенный "телепорт" на границу, а быстрое, но плавное
// соскальзывание наружу за несколько кадров.
const PUSH_OUT_SPEED = 5;
const EMPTY_EXCLUDED: ReadonlySet<THREE.Object3D> = new Set();

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
  // Был ли текущий/последний прыжок "с разбега" (спринт зажат в момент толчка) —
  // только такой прыжок открывает vaultRequiresSprint-круги (скамья, валуны).
  private runningJump = false;

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
    isSprinting = false,
    collisionCircles: readonly CollisionCircle[] = [],
    collisionMeshes: readonly THREE.Object3D[] = [],
    raycastExcluded: ReadonlySet<THREE.Object3D> = EMPTY_EXCLUDED,
    collisionRects: readonly CollisionRect[] = [],
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
      this.moveWithCollision(
        this.moveInput,
        this.activeCircles(collisionCircles),
        collisionMeshes,
        raycastExcluded,
        collisionRects,
      );
    }

    this.updateJump(deltaSec, isSprinting);
    // Если прыжок перенёс игрока почти через надгробие/валун/бочку, но высоты не
    // хватило пройти его целиком (приземлился ещё внутри minDist) — выталкиваем
    // наружу, а не оставляем "застрявшим" до следующего прыжка.
    this.resolveCircleOverlaps(this.activeCircles(collisionCircles), deltaSec);

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
  private updateJump(deltaSec: number, isSprinting: boolean): void {
    if (this.input.consumeKeyPress("Space") && this.jumpHeight <= 0) {
      this.runningJump = isSprinting;
      this.verticalVelocity = this.runningJump ? RUNNING_JUMP_SPEED : JUMP_SPEED;
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

  /** На пике прыжка перешагиваемые (vaultable) круги — надгробия, бочки, ящики —
   *  не блокируют; те же, что помечены vaultRequiresSprint (скамья, валуны),
   *  открываются только прыжком с разбега (this.runningJump). Меши (забор/дом/
   *  ворота) и невысокие vaultable: false круги (фонарный столб и т.п.) остаются
   *  стеной всегда. */
  private activeCircles(circles: readonly CollisionCircle[]): readonly CollisionCircle[] {
    if (this.jumpHeight <= VAULT_CLEAR_HEIGHT) return circles;
    return circles.filter((c) => !c.vaultable || (c.vaultRequiresSprint && !this.runningJump));
  }

  /** Выталкивает игрока наружу, если он оказался внутри круга-коллайдера (а не просто
   *  блокирует шаг туда, как isBlocked) — иначе застревание внутри (неудачное
   *  приземление после прыжка через невысокий объект) было бы неисправимым без
   *  повторного прыжка: любой шаг наружу тоже на долю секунды остаётся внутри
   *  minDist и blocking-проверка в isBlocked его бы тоже отклонила. Выталкивает не
   *  мгновенно на границу (ощущалось бы телепортом), а с ограниченной скоростью —
   *  плавное соскальзывание наружу за несколько кадров. */
  private resolveCircleOverlaps(circles: readonly CollisionCircle[], deltaSec: number): void {
    const maxStep = PUSH_OUT_SPEED * deltaSec;
    for (const circle of circles) {
      const dx = this.camera.position.x - circle.x;
      const dz = this.camera.position.z - circle.z;
      const minDist = circle.radius + PLAYER_RADIUS;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist) continue;

      const dist = Math.sqrt(distSq);
      if (dist < 1e-4) {
        this.camera.position.x += Math.min(minDist, maxStep);
        continue;
      }
      const push = Math.min(minDist - dist, maxStep) / dist;
      this.camera.position.x += dx * push;
      this.camera.position.z += dz * push;
    }
  }

  /** Двигает по осям раздельно (X, потом Z) — так движение вдоль стены не "залипает"
   *  полностью, когда игрок одновременно идёт и в разрешённом, и в заблокированном
   *  направлении (простое скольжение без вычисления нормали поверхности). */
  private moveWithCollision(
    step: THREE.Vector3,
    circles: readonly CollisionCircle[],
    meshes: readonly THREE.Object3D[],
    raycastExcluded: ReadonlySet<THREE.Object3D>,
    rects: readonly CollisionRect[],
  ): void {
    this.tmpStep.set(step.x, 0, 0);
    if (!this.isBlocked(this.tmpStep, circles, meshes, raycastExcluded, rects)) this.camera.position.add(this.tmpStep);

    this.tmpStep.set(0, 0, step.z);
    if (!this.isBlocked(this.tmpStep, circles, meshes, raycastExcluded, rects)) this.camera.position.add(this.tmpStep);
  }

  private isBlocked(
    step: THREE.Vector3,
    circles: readonly CollisionCircle[],
    meshes: readonly THREE.Object3D[],
    raycastExcluded: ReadonlySet<THREE.Object3D>,
    rects: readonly CollisionRect[],
  ): boolean {
    if (step.x === 0 && step.z === 0) return false;

    this.tmpNextPos.copy(this.camera.position).add(step);
    for (const circle of circles) {
      const dx = this.tmpNextPos.x - circle.x;
      const dz = this.tmpNextPos.z - circle.z;
      const minDist = circle.radius + PLAYER_RADIUS;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    }

    // Прямоугольники (ограда) — ближайшая точка на прямоугольнике к игроку
    // (клампом координат к его границам), блокирует, если она ближе PLAYER_RADIUS.
    // Всегда сплошная стена, без vaultable — высоту/прыжок не проверяем.
    for (const rect of rects) {
      const nearX = THREE.MathUtils.clamp(this.tmpNextPos.x, rect.minX, rect.maxX);
      const nearZ = THREE.MathUtils.clamp(this.tmpNextPos.z, rect.minZ, rect.maxZ);
      const dx = this.tmpNextPos.x - nearX;
      const dz = this.tmpNextPos.z - nearZ;
      if (dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS) return true;
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

      // Высоты лучей — от groundEyeY (высоты глаз на земле), а не от текущего
      // camera.position.y: иначе во время прыжка обе высоты уезжали бы вверх вместе
      // с игроком и на пике могли бы пройти над забором/воротами — ровно то же
      // самое правило коллизии (меш всегда стена), что и без прыжка.
      for (const heightDrop of [0, LOW_RAY_HEIGHT_DROP]) {
        for (const sign of [0, 1, -1]) {
          this.tmpRayOrigin.set(this.camera.position.x, this.groundEyeY - heightDrop, this.camera.position.z);
          if (sign !== 0) this.tmpRayOrigin.addScaledVector(this.tmpPerp, sign);
          this.raycaster.set(this.tmpRayOrigin, this.tmpDirection);
          const hits = this.raycaster.intersectObjects(meshes as THREE.Object3D[], true);
          if (hits.some((hit) => !raycastExcluded.has(hit.object))) return true;
        }
      }
    }

    return false;
  }
}
