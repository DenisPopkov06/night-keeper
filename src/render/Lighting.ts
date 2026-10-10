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
