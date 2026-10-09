import { ObjectState } from "@/data/types";

type Gender = "neuter" | "feminine" | "masculine";

interface ObjectDisplay {
  name: string;
  gender: Gender;
}

const OBJECT_DISPLAY: Record<string, ObjectDisplay> = {
  gravestone_cross_a: { name: "Надгробие", gender: "neuter" },
  gravestone_arch_a: { name: "Надгробие", gender: "neuter" },
  gravestone_slab_a: { name: "Надгробие", gender: "neuter" },
  vase_clay_01: { name: "Ваза", gender: "feminine" },
};

const STATE_PHRASES: Record<ObjectState, Record<Gender, string>> = {
  [ObjectState.NORMAL]: { neuter: "", feminine: "", masculine: "" },
  [ObjectState.DISPLACED]: { neuter: "сдвинуто", feminine: "сдвинута", masculine: "сдвинут" },
  [ObjectState.FALLEN]: { neuter: "упало", feminine: "упала", masculine: "упал" },
  [ObjectState.MISSING]: { neuter: "пропало", feminine: "пропала", masculine: "пропал" },
  [ObjectState.BROKEN]: { neuter: "повреждено", feminine: "повреждена", masculine: "повреждён" },
  [ObjectState.ANOMALY]: { neuter: "аномалия", feminine: "аномалия", masculine: "аномалия" },
};

/** Человекочитаемая подпись задачи для блокнота/HUD: "Надгробие: сдвинуто" вместо
 *  сырого instanceId+ObjectState. objectId неизвестный каталогу — просто сам objectId. */
export function formatTaskLabel(objectId: string, state: ObjectState): string {
  const display = OBJECT_DISPLAY[objectId] ?? { name: objectId, gender: "neuter" as const };
  const phrase = STATE_PHRASES[state][display.gender];
  return phrase ? `${display.name}: ${phrase}` : display.name;
}
