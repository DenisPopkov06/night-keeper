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

import type { ObjectCatalogEntry } from "@/data/types";

export const OBJECTS_CATALOG: Record<string, ObjectCatalogEntry> = {};
