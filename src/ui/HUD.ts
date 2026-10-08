export class HUD {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";
    parent.appendChild(this.root);
  }

  setFlashlightCharge(_percent: number): void {
    // TODO: отрисовка индикатора заряда — задача 5.5, подписка на FlashlightSystem
  }

  setTaskList(_taskLabels: string[]): void {
    // TODO: список задач смены с чек-марками — задача 5.5
  }

  setTimeRemaining(_seconds: number): void {
    // TODO: таймер — задача 5.5
  }

  destroy(): void {
    this.root.remove();
  }
}
