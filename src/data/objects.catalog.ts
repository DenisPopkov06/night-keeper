import type { ObjectCatalogEntry } from "@/data/types";

/**
 * Наполняет дизайнер по мере добавления 3D-объектов.
 * objectId здесь обязан совпадать с objectId, используемым в src/levels/*\/layout.json.
 */
export const OBJECTS_CATALOG: Record<string, ObjectCatalogEntry> = {};
