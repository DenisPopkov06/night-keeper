// Каталог объектов: objectId → путь к модели → базовые свойства. Наполняет дизайнер.
//
// СОГЛАШЕНИЕ ОБ ИМЕНАХ (единое на всё, от Blender до кода):
//
//   <тип>_<название>_<вариант>
//
//   - латиница, нижний регистр, snake_case, без пробелов и кириллицы
//   - вариант — буква (a, b, c) или двузначный номер (01, 02)
//   - примеры: gravestone_cross_a, vase_clay_01, fence_iron_02
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
//     2048×2048 — только для крупного (ограда, часовня, модель зоны)
//   - один набор текстур (атлас) на проп; без текстур — просто цвет материала
//   - карты, три штуки:
//       albedo — цвет, sRGB (в Blender: Color Space = sRGB)
//       normal — нормали в формате OpenGL (как в Blender), Color Space = Non-Color
//       ORM    — одна карта на три параметра, Color Space = Non-Color:
//                R = ambient occlusion, G = roughness, B = metalness
//   - формат: PNG или JPG; в .glb встраиваются при экспорте (пресет night_keeper_glb)
//   - исходники в высоком разрешении — assets_src/textures_src/, в билд не попадают;
//     в public/textures/ — только текстуры, не упакованные в .glb
//   - имя файла текстуры: <objectId>_albedo / _normal / _orm

import type { ObjectCatalogEntry } from "@/data/types";

export const OBJECTS_CATALOG: Record<string, ObjectCatalogEntry> = {};
