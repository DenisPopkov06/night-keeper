import * as THREE from "three";

export const LIGHTING_CONFIG = {
  moonColor: 0x8fa6c9,
  moonIntensity: 1.5,
  // Знаки x/z намеренно противоположны исходным расчётам дизайнера (юго-восток,
  // высота 54°, позиция геометрически позади spawnPoint) — так луна оказывается
  // перед игроком при старте смены; дизайнер пересобирает sky_night.jpg под это.
  moonPosition: new THREE.Vector3(-15, 25, -10),
  ambientColor: 0x1a2030,
  ambientIntensity: 0.6,
  // Раньше туман почти чёрный и обрывался на 40м — дальний лес за оградой читался
  // сплошным тёмным силуэтом. Новые цифры (запрос дизайнера) растворяют его в
  // несколько голубоватых слоёв в цвет горизонта sky_night.jpg, без шва неба и земли.
  fogColor: 0x1c2c4c,
  fogNear: 5,
  fogFar: 62,
  shadowFrustumSize: 25,
  shadowMapSize: 1024,
};

// Постепенное затемнение по сменам (раздел 8 ТЗ смещается в сторону "фонарик не
// опция, а необходимость"): смена 1 — текущая яркость без изменений, дальше луна
// и общая подсветка линейно гаснут к минимуму к DARKNESS_RAMP_END_SHIFT и дальше
// не темнеют. Минимумы не нулевые — совсем без луны/подсветки геометрия тонет в
// чистый чёрный (нет GI/light-проб, см. createAmbientFill), а не просто "темно".
// Было 0.18/0.5 — на 4-й смене всё ещё можно было разглядеть дорогу и так;
// 0.04/0.08 — ориентироваться без фонарика уже реально нельзя, только силуэты.
const DARKNESS_RAMP_END_SHIFT = 4;
const MIN_AMBIENT_INTENSITY = 0.04;
const MIN_MOON_INTENSITY = 0.08;

function darknessRampProgress(shiftIndex: number): number {
  return Math.min(1, Math.max(0, (shiftIndex - 1) / (DARKNESS_RAMP_END_SHIFT - 1)));
}

/** Интенсивность AmbientLight для конкретной смены — 1-я смена как сейчас,
 *  к 3-4-й линейно темнеет до MIN_AMBIENT_INTENSITY, дальше остаётся минимумом. */
export function ambientIntensityForShift(shiftIndex: number): number {
  const t = darknessRampProgress(shiftIndex);
  return LIGHTING_CONFIG.ambientIntensity - t * (LIGHTING_CONFIG.ambientIntensity - MIN_AMBIENT_INTENSITY);
}

/** То же самое для лунного DirectionalLight. */
export function moonIntensityForShift(shiftIndex: number): number {
  const t = darknessRampProgress(shiftIndex);
  return LIGHTING_CONFIG.moonIntensity - t * (LIGHTING_CONFIG.moonIntensity - MIN_MOON_INTENSITY);
}

export function createMoonLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(LIGHTING_CONFIG.moonColor, LIGHTING_CONFIG.moonIntensity);
  light.position.copy(LIGHTING_CONFIG.moonPosition);
  light.castShadow = true;

  const frustum = LIGHTING_CONFIG.shadowFrustumSize;
  light.shadow.camera.left = -frustum;
  light.shadow.camera.right = frustum;
  light.shadow.camera.top = frustum;
  light.shadow.camera.bottom = -frustum;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 80;
  light.shadow.mapSize.set(LIGHTING_CONFIG.shadowMapSize, LIGHTING_CONFIG.shadowMapSize);
  light.shadow.bias = -0.0015;

  return light;
}

/** Слабая общая подсветка, чтобы тени не проваливались в чистый чёрный — не луна,
 *  а просто базовая видимость геометрии, пока нет полноценного GI/light-пробов. */
export function createAmbientFill(): THREE.AmbientLight {
  return new THREE.AmbientLight(LIGHTING_CONFIG.ambientColor, LIGHTING_CONFIG.ambientIntensity);
}

export function createSceneFog(): THREE.Fog {
  return new THREE.Fog(LIGHTING_CONFIG.fogColor, LIGHTING_CONFIG.fogNear, LIGHTING_CONFIG.fogFar);
}

// THREE.Fog — только по дистанции от камеры, поэтому у самой ограды (ZONE=19.5 в
// assets_src/blender/zone_lib.py) он не спасает: стык голой terrain_outer и первой
// линии леса (лес начинается только с ~22.5м от центра) при этом всего в паре метров
// от игрока — ближе fogNear, тумана там почти нет, и граница карты читается слишком
// чётко. При этом надгробия у спавна — на такой же дистанции от камеры, так что
// просто уменьшить fogNear занесло бы туман и на них. Нужна стена, завязанная не на
// дистанцию камеры, а на положение в мире — просто за оградой, по всему периметру.
const FOG_WALL_HALF_EXTENT = 20;
const FOG_WALL_HEIGHT = 9;
// Было 0.6 — за оградой ещё угадывались силуэты леса сквозь туман. Густой туман
// должен прятать их почти полностью у земли, а не просвечивать.
const FOG_WALL_OPACITY = 0.92;
// Доля высоты (снизу), где туман держится на полной плотности, прежде чем начать
// гаснуть к верхнему краю — плотный "ковёр" понизу, а не ровный градиент от самой
// земли (иначе даже у основания тумана было бы уже заметно светлее).
const FOG_WALL_FADE_START = 0.35;
// Сегментов по высоте — чтобы градиент прозрачности был плавным, а не полосами.
const FOG_WALL_SEGMENTS = 8;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Плоскость с вершинным альфа-градиентом: сплошная (FOG_WALL_OPACITY) до
 *  FOG_WALL_FADE_START высоты, дальше плавно (smoothstep, не линейно) гаснет к нулю
 *  у верхнего края — раньше вся плоскость была одной сплошной прозрачностью, и её
 *  верхний край рисовал чёткую прямую линию поперёк неба, читаясь как плоская
 *  "стена", а не туман. */
function createGradientFadePlane(width: number, height: number, segments: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(width, height, 1, segments);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 4);

  for (let i = 0; i < position.count; i++) {
    // PlaneGeometry идёт от -height/2 (низ) до +height/2 (верх) по локальному Y.
    const localY = position.getY(i);
    const heightFraction = THREE.MathUtils.clamp(localY / height + 0.5, 0, 1);
    const fadeT = THREE.MathUtils.clamp(
      (heightFraction - FOG_WALL_FADE_START) / (1 - FOG_WALL_FADE_START),
      0,
      1,
    );
    const alpha = FOG_WALL_OPACITY * (1 - smoothstep(fadeT));
    colors.set([1, 1, 1, alpha], i * 4);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
  return geometry;
}

/** Полупрозрачные стены цвета тумана чуть за оградой по всему периметру — скрывают
 *  стык поля и леса в упор, но сами попадают под обычный fog, поэтому издалека (через
 *  открытое поле) сливаются в ту же дымку горизонта. Прозрачность гаснет к верху
 *  вершинным градиентом, а не обрывается ровным краем — иначе это выглядит плоской
 *  преградой, а не туманом. */
export function createBoundaryFogWall(): THREE.Group {
  const group = new THREE.Group();
  group.name = "boundary-fog-wall";

  const material = new THREE.MeshBasicMaterial({
    color: LIGHTING_CONFIG.fogColor,
    transparent: true,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const geometry = createGradientFadePlane(FOG_WALL_HALF_EXTENT * 2, FOG_WALL_HEIGHT, FOG_WALL_SEGMENTS);

  const sides = [
    { x: 0, z: FOG_WALL_HALF_EXTENT, rotationY: 0 },
    { x: 0, z: -FOG_WALL_HALF_EXTENT, rotationY: 0 },
    { x: FOG_WALL_HALF_EXTENT, z: 0, rotationY: Math.PI / 2 },
    { x: -FOG_WALL_HALF_EXTENT, z: 0, rotationY: Math.PI / 2 },
  ];
  for (const side of sides) {
    const plane = new THREE.Mesh(geometry, material);
    plane.position.set(side.x, FOG_WALL_HEIGHT / 2, side.z);
    plane.rotation.y = side.rotationY;
    group.add(plane);
  }

  return group;
}
