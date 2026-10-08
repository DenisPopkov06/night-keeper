export interface AtmosphericEvent {
  id: string;
  triggerAtSec?: number;
  zoneId?: string;
}

/**
 * Исполняет список атмосферных событий, заданных дизайнером (ТЗ из раздела 4.3).
 * Конфиг сценариев не хардкодится в коде системы — задача 5.3.
 */
export class EventTriggerSystem {
  private readonly events: AtmosphericEvent[] = [];

  configure(events: AtmosphericEvent[]): void {
    this.events.length = 0;
    this.events.push(...events);
  }

  update(_elapsedSec: number): void {
    // TODO: проверка условий срабатывания, проигрывание звука/анимации/света — задача 5.3
  }
}
