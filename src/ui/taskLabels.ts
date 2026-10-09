import { ObjectState } from "@/data/types";

type Gender = "neuter" | "feminine" | "masculine" | "plural";

interface ObjectDisplay {
  name: string;
  gender: Gender;
}

const OBJECT_DISPLAY: Record<string, ObjectDisplay> = {
  gravestone_cross_a: { name: "Надгробие", gender: "neuter" },
  gravestone_arch_a: { name: "Надгробие", gender: "neuter" },
  gravestone_slab_a: { name: "Надгробие", gender: "neuter" },
  pot_clay_a: { name: "Горшок", gender: "masculine" },
  wreath_fresh_a: { name: "Венок", gender: "masculine" },
  wreath_flower_a: { name: "Венок", gender: "masculine" },
  wreath_withered_a: { name: "Венок", gender: "masculine" },
  flowers_daisy_a: { name: "Цветы", gender: "plural" },
  flowers_bluebell_a: { name: "Цветы", gender: "plural" },
  flowers_poppy_a: { name: "Цветы", gender: "plural" },
};

const STATE_PHRASES: Record<ObjectState, Record<Gender, string>> = {
  [ObjectState.NORMAL]: { neuter: "", feminine: "", masculine: "", plural: "" },
  [ObjectState.DISPLACED]: {
    neuter: "сдвинуто",
    feminine: "сдвинута",
    masculine: "сдвинут",
    plural: "сдвинуты",
  },
  [ObjectState.FALLEN]: { neuter: "упало", feminine: "упала", masculine: "упал", plural: "упали" },
  [ObjectState.MISSING]: {
    neuter: "пропало",
    feminine: "пропала",
    masculine: "пропал",
    plural: "пропали",
  },
  [ObjectState.BROKEN]: {
    neuter: "повреждено",
    feminine: "повреждена",
    masculine: "повреждён",
    plural: "повреждены",
  },
  [ObjectState.ANOMALY]: { neuter: "аномалия", feminine: "аномалия", masculine: "аномалия", plural: "аномалия" },
};

/** Человекочитаемая подпись задачи для блокнота/HUD: "Надгробие: сдвинуто" вместо
 *  сырого instanceId+ObjectState. objectId неизвестный каталогу — просто сам objectId
 *  (средний род как нейтральный запасной вариант). */
export function formatTaskLabel(objectId: string, state: ObjectState): string {
  const display = OBJECT_DISPLAY[objectId] ?? { name: objectId, gender: "neuter" as const };
  const phrase = STATE_PHRASES[state][display.gender];
  return phrase ? `${display.name}: ${phrase}` : display.name;
}
