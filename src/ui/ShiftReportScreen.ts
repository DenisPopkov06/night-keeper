export interface ShiftReportData {
  tasksCompleted: number;
  tasksTotal: number;
  timeSpentSec: number;
  score: number;
}

export class ShiftReportScreen {
  private readonly root: HTMLElement;

  constructor(
    parent: HTMLElement,
    private readonly onNextShift: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "shift-report";
    this.root.style.display = "none";

    const nextShiftButton = document.createElement("button");
    nextShiftButton.className = "shift-report__next";
    nextShiftButton.addEventListener("click", () => this.onNextShift());

    this.root.append(nextShiftButton);
    parent.appendChild(this.root);
  }

  show(_data: ShiftReportData): void {
    this.root.style.display = "block";
    // TODO: разметка итогов (очки, время, выполненные задачи) — задача 5.5
  }

  hide(): void {
    this.root.style.display = "none";
  }
}
