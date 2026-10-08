export interface ShiftReportData {
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
  private readonly tasksEl: HTMLElement;
  private readonly timeEl: HTMLElement;
  private readonly scoreEl: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onNextShift: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "shift-report";
    this.root.style.display = "none";

    const title = document.createElement("h2");
    title.className = "shift-report__title";
    title.textContent = "Смена окончена";

    this.tasksEl = document.createElement("p");
    this.tasksEl.className = "shift-report__tasks";

    this.timeEl = document.createElement("p");
    this.timeEl.className = "shift-report__time";

    this.scoreEl = document.createElement("p");
    this.scoreEl.className = "shift-report__score";

    const nextShiftButton = document.createElement("button");
    nextShiftButton.className = "shift-report__next";
    nextShiftButton.textContent = "Следующая смена";
    nextShiftButton.addEventListener("click", () => this.onNextShift());

    this.root.append(title, this.tasksEl, this.timeEl, this.scoreEl, nextShiftButton);
    parent.appendChild(this.root);
  }

  show(data: ShiftReportData): void {
    this.tasksEl.textContent = `Задачи: ${data.tasksCompleted} / ${data.tasksTotal}`;
    this.timeEl.textContent = `Время: ${formatDuration(data.timeSpentSec)}`;
    this.scoreEl.textContent = `Очки: ${data.score}`;
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }
}
