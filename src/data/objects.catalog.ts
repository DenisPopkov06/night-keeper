// Каталог объектов: objectId → путь к модели → базовые свойства. Наполняет дизайнер.
//
// СОГЛАШЕНИЕ ОБ ИМЕНАХ (единое на всё, от Blender до кода):
//
//   <тип>_<название>_<вариант>
//
//   - латиница, нижний регистр, snake_case, без пробелов и кириллицы
//   - вариант — буква (a, b, c) или двузначный номер (01, 02)
//   - примеры: gravestone_cross_a, vase_clay_01, fence_iron_02
//   - «название» может быть составным (признак состояния — последним): gravestone_cross_broken_a, gravestone_arch_tilted_a
//
// Три имени обязаны совпадать:
//   1) objectId — ключ в этом файле и поле objectId в layout.json
//   2) файл модели — public/models/props/<objectId>.glb
//   3) имя объекта (и меша) в Blender
//
// Остальные имена:
//   - instanceId (экземпляр в зоне): <тип>_<NNN>, например grave_014; уникален в пределах зоны
//   - модель зоны: public/models/zone_<zoneId>.glb, например zone_old_cemetery.glb
//
// objectId из любого layout.json обязан существовать в этом каталоге.
//
// СТАНДАРТ ТЕКСТУР (чтобы все пропсы одинаково выглядели под светом из render/Lighting.ts):
//
//   - материалы PBR (glTF metallic-roughness): в Blender — Principled BSDF
//   - размер: квадрат, степень двойки; 1024×1024 по умолчанию на проп,
//     2048×2048 — только для крупного (ограда, часовня, модель зоны),
//     512×512 — для мелочи (ваза, свеча, табличка)
//   - один набор текстур (атлас) на проп; без текстур — просто цвет материала
//   - карты, три штуки:
//       albedo — цвет, sRGB (в Blender: Color Space = sRGB)
//       normal — нормали в формате OpenGL (как в Blender), Color Space = Non-Color
//       ORM    — одна карта на три параметра, Color Space = Non-Color:
//                R = ambient occlusion, G = roughness, B = metalness
//   - формат: JPG (quality 85) — встраивается в .glb при экспорте (пресет night_keeper_glb);
//     PNG слишком тяжёл для веба
//   - запечённые карты — assets_src/textures_src/ (в билд не попадают);
//     в public/textures/ — только текстуры, не упакованные в .glb
//   - имя файла текстуры: <objectId>_albedo / _normal / _orm
//   - у замкнутых мешей — одностороннее отображение (backface culling), без doubleSided
//   - пропсы строит и запекает assets_src/blender/bake_props.py (тексты надписей — в словаре PROPS)
//   - атмосфера зоны: за оградой лес (forest_near_* и forest_far_*, 620 деревьев разных видов) и рельеф с дальними холмами (terrain_outer) — прямо в zone_*.glb, плюс
//     направленный лунный свет moon_light (KHR_lights_punctual, то же направление, что LIGHTING_CONFIG.moonPosition);
//     небо с луной — public/textures/sky_night.jpg (equirect 4096×2048), строит assets_src/blender/sky_texture.py,
//     подключается как scene.background (EquirectangularReflectionMapping + SRGBColorSpace)
//   - детали зоны по отдельности (деревья, дом, ворота, фонарь, забор, бабочка, ...) — assets_src/blender/props_kit.py:
//     та же геометрия и бесшовные тайлы, что в модели зоны; origin — центр основания, «перед» модели смотрит на +Z
//   - зона: земля — ОДНА уникальная карта ground_old_cemetery_* (без тайлов и повторов); бесшовные тайлы tile_<имя>_albedo|normal|orm (дерево, кора, камень) —
//     повтор по мировым UV; строит assets_src/blender/zone_textures.py, геометрию — zone_lib.py

import { ObjectState, type ObjectCatalogEntry } from "@/data/types";

const GRAVESTONE_STATES = [ObjectState.DISPLACED, ObjectState.FALLEN, ObjectState.BROKEN];

// collisionRadius (м) — стартовая прикидка по типовому габариту надгробия,
// дизайнер может поправить под реальные размеры моделей.
const GRAVESTONE_COLLISION_RADIUS = 0.4;

function decor(objectId: string, collisionRadius?: number): ObjectCatalogEntry {
  return {
    modelPath: `models/props/${objectId}.glb`,
    interactable: false,
    repairableStates: [],
    ...(collisionRadius !== undefined && { collisionRadius }),
  };
}

export const OBJECTS_CATALOG: Record<string, ObjectCatalogEntry> = {
  gravestone_cross_a: {
    modelPath: "models/props/gravestone_cross_a.glb",
    interactable: true,
    repairableStates: GRAVESTONE_STATES,
    collisionRadius: GRAVESTONE_COLLISION_RADIUS,
  },
  gravestone_arch_a: {
    modelPath: "models/props/gravestone_arch_a.glb",
    interactable: true,
    repairableStates: GRAVESTONE_STATES,
    collisionRadius: GRAVESTONE_COLLISION_RADIUS,
  },
  gravestone_slab_a: {
    modelPath: "models/props/gravestone_slab_a.glb",
    interactable: true,
    repairableStates: GRAVESTONE_STATES,
    collisionRadius: GRAVESTONE_COLLISION_RADIUS,
  },
  vase_clay_01: {
    modelPath: "models/props/vase_clay_01.glb",
    interactable: true,
    repairableStates: [ObjectState.MISSING, ObjectState.DISPLACED],
    // Без collisionRadius — маленький переносимый предмет, сквозь него проходить можно.
  },

  // Декор — отдельные модели деталей зоны (props_kit.py): без задач и взаимодействия.
  // collisionRadius — по стволу/основанию. Дому, воротам, забору и скамье круг не подходит
  // (длинные/с проходом) — у них коллизии пока нет.
  tree_oak_a: decor("tree_oak_a", 0.6),
  tree_oak_b: decor("tree_oak_b", 0.5),
  tree_leafy_c: decor("tree_leafy_c", 0.45),
  tree_dead_a: decor("tree_dead_a", 0.5),
  house_keeper_a: decor("house_keeper_a"),
  gate_stone_a: decor("gate_stone_a"),
  lamp_post_a: decor("lamp_post_a", 0.3),
  // Подвесной фонарь: origin — точка подвеса, модель висит вниз на 0.68 м.
  lantern_iron_a: decor("lantern_iron_a"),
  // Секция 2.4 м вдоль X, origin — середина пролёта; в ряд ставить с шагом 2.4 м. b — сломанная.
  fence_wood_a: decor("fence_wood_a"),
  fence_wood_b: decor("fence_wood_b"),
  bench_wood_a: decor("bench_wood_a"),
  crate_wood_a: decor("crate_wood_a", 0.4),
  barrel_wood_a: decor("barrel_wood_a", 0.35),
  pot_clay_a: decor("pot_clay_a"),
  pedestal_cross_a: decor("pedestal_cross_a", 0.55),
  rock_mossy_a: decor("rock_mossy_a", 0.8),
  rock_mossy_b: decor("rock_mossy_b"),
  grass_tuft_a: decor("grass_tuft_a"),
  flowers_wild_a: decor("flowers_wild_a"),
  // Бабочка (размах 0.16 м), голова на +Z; в .glb анимация взмаха крыльев «flap» (0.25 с, по кругу).
  butterfly_blue_a: decor("butterfly_blue_a"),

  // Варианты надгробий по арт-листу (assets_src/blender/bake_props.py, текстуры запечены): разрушенные —
  // заготовки визуала для BROKEN/FALLEN вместо целого камня; наклонённые — «просевшая земля».
  gravestone_cross_broken_a: decor("gravestone_cross_broken_a", 0.4),
  gravestone_slab_broken_a: decor("gravestone_slab_broken_a", 0.6),
  gravestone_rubble_a: decor("gravestone_rubble_a", 0.45),
  gravestone_arch_broken_a: decor("gravestone_arch_broken_a", 0.4),
  gravestone_cross_tilted_a: decor("gravestone_cross_tilted_a", 0.45),
  gravestone_arch_tilted_a: decor("gravestone_arch_tilted_a", 0.45),
  gravestone_headstone_tilted_a: decor("gravestone_headstone_tilted_a", 0.45),

  // Венки (≈ 0.55 × 0.6 м с листьями, «лицом» к +Z, стоят на хвостах ленты — прислонить к надгробию) и цветы (пучки на земле).
  wreath_fresh_a: decor("wreath_fresh_a"),
  wreath_flower_a: decor("wreath_flower_a"),
  wreath_withered_a: decor("wreath_withered_a"),
  flowers_daisy_a: decor("flowers_daisy_a"),
  flowers_bluebell_a: decor("flowers_bluebell_a"),
  flowers_poppy_a: decor("flowers_poppy_a"),
  // ...остальные объекты по мере добавления дизайнером
};
