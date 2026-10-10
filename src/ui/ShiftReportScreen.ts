export interface ShiftReportData {
  /** Все задачи смены выполнены до того, как кончилось время (ShiftEndReason
   *  "all_tasks_done") — иначе смена провалена (время вышло раньше), и кнопка ниже
   *  начинает игру заново с 1-й смены, а не продолжает со следующей (см. Game.onShiftEnd). */
  won: boolean;
  tasksCompleted: number;
  tasksTotal: number;
  timeSpentSec: number;
  score: number;
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export class ShiftReportScreen {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly tasksEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly scoreEl: HTMLElement;
  private readonly nextShiftButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private readonly onNextShift: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "shift-report";
    this.root.style.display = "none";

    this.titleEl = document.createElement("h2");
    this.titleEl.className = "shift-report__title";

    this.tasksEl = document.createElement("p");
    this.tasksEl.className = "shift-report__tasks";

    this.timeEl = document.createElement("p");
    this.timeEl.className = "shift-report__time";

    this.scoreEl = document.createElement("p");
    this.scoreEl.className = "shift-report__score";

    this.nextShiftButton = document.createElement("button");
    this.nextShiftButton.className = "shift-report__next";
    this.nextShiftButton.addEventListener("click", () => this.onNextShift());

    this.root.append(this.titleEl, this.tasksEl, this.timeEl, this.scoreEl, this.nextShiftButton);
    parent.appendChild(this.root);
  }

  show(data: ShiftReportData): void {
    this.titleEl.textContent = data.won ? "Смена окончена" : "Смена провалена";
    this.tasksEl.textContent = `Задачи: ${data.tasksCompleted} / ${data.tasksTotal}`;
    this.timeEl.textContent = `Время: ${formatDuration(data.timeSpentSec)}`;
    this.scoreEl.textContent = `Очки: ${data.score}`;
    this.nextShiftButton.textContent = data.won ? "Следующая смена" : "Начать заново";
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }
}
