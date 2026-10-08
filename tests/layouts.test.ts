/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";
import { OBJECTS_CATALOG } from "@/data/objects.catalog";
import { ObjectState, type ZoneLayout } from "@/data/types";

// Контракт «дизайнер ↔ бэкенд»: всё, что расставлено в layout.json, должно существовать в каталоге
// и в public/. Ловит опечатки в objectId и пропавшие модели до запуска игры.
const layouts = import.meta.glob("../src/levels/*/layout.json", {
  eager: true,
  import: "default",
}) as Record<string, ZoneLayout>;

// Только ключи (пути) — сами файлы не загружаются.
const publicModels = new Set(
  Object.keys(import.meta.glob("../public/models/**/*.glb")).map((p) => p.replace("../public/", "")),
);
const STATES = new Set<string>(Object.values(ObjectState));
const LIMIT = 19; // внутри ограды (±19.5)

describe("OBJECTS_CATALOG", () => {
  it.each(Object.entries(OBJECTS_CATALOG))("%s: модель существует", (_id, entry) => {
    expect(publicModels.has(entry.modelPath), `нет public/${entry.modelPath}`).toBe(true);
  });
});

describe.each(Object.entries(layouts))("layout %s", (path, layout) => {
  it("zoneId совпадает с папкой, модель зоны указана", () => {
    expect(path).toContain(`zone_${layout.zoneId}/`);
    expect(layout.modelPath).toBe(`models/zone_${layout.zoneId}.glb`);
  });

  it("instanceId уникальны", () => {
    const ids = layout.objects.map((o) => o.instanceId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("objectId есть в каталоге, состояние и позиция корректны", () => {
    for (const o of layout.objects) {
      expect(OBJECTS_CATALOG[o.objectId], `${o.instanceId}: "${o.objectId}" нет в каталоге`).toBeDefined();
      expect(STATES.has(o.defaultState), `${o.instanceId}: состояние ${o.defaultState}`).toBe(true);
      expect(Number.isFinite(o.rotationY)).toBe(true);
      expect(Math.abs(o.position.x)).toBeLessThanOrEqual(LIMIT);
      expect(Math.abs(o.position.z)).toBeLessThanOrEqual(LIMIT);
    }
  });

  it("модель зоны с объектами существует в public/models", () => {
    if (layout.objects.length > 0) expect(publicModels.has(layout.modelPath)).toBe(true);
  });
});
