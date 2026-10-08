export interface ZoneDifficultyConfig {
  zoneId: string;
  minShiftIndex: number;
}

/**
 * Список зон и их параметры сложности. Наполняет дизайнер/бэкенд по мере добавления зон.
 */
export const ZONES_CONFIG: ZoneDifficultyConfig[] = [];
