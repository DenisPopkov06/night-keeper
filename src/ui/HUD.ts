export interface HUDTask {
  label: string;
  done: boolean;
}

export interface HUDState {
  flashlightChargePercent: number;
  remainingSec: number;
  tasks: HUDTask[];
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/** Сериализация задач для дешёвого сравнения "изменился ли список" между кадрами. */
function serializeTasks(tasks: HUDTask[]): string {
  return tasks.map((t) => `${t.label}:${t.done}`).join("|");
}

export class HUD {
  private readonly root: HTMLElement;
  private readonly flashlightBar: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly taskListEl: HTMLElement;

  private lastChargePercent = -1;
  private lastTimerText = "";
  private lastTasksSignature = "";

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";

    const flashlight = document.createElement("div");
    flashlight.className = "hud__flashlight";
    this.flashlightBar = document.createElement("div");
    this.flashlightBar.className = "hud__flashlight-bar";
    flashlight.appendChild(this.flashlightBar);

    this.timerEl = document.createElement("div");
    this.timerEl.className = "hud__timer";

    this.taskListEl = document.createElement("ul");
    this.taskListEl.className = "hud__tasks";

    this.root.append(flashlight, this.timerEl, this.taskListEl);
    parent.appendChild(this.root);
  }

  update(state: HUDState): void {
    this.setFlashlightCharge(state.flashlightChargePercent);
    this.setTimeRemaining(state.remainingSec);
    this.setTaskList(state.tasks);
  }

  private setFlashlightCharge(percent: number): void {
    const rounded = Math.round(Math.max(0, Math.min(100, percent)));
    if (rounded === this.lastChargePercent) return;
    this.lastChargePercent = rounded;
    this.flashlightBar.style.width = `${rounded}%`;
  }

  private setTaskList(tasks: HUDTask[]): void {
    const signature = serializeTasks(tasks);
    if (signature === this.lastTasksSignature) return;
    this.lastTasksSignature = signature;

    this.taskListEl.replaceChildren(
      ...tasks.map((task) => {
        const item = document.createElement("li");
        item.className = task.done ? "hud__task-item hud__task-item--done" : "hud__task-item";

        const checkbox = document.createElement("span");
        checkbox.className = "hud__task-checkbox";
        checkbox.textContent = task.done ? "✓" : "";

        const label = document.createElement("span");
        label.className = "hud__task-label";
        label.textContent = task.label;

        item.append(checkbox, label);
        return item;
      }),
    );
  }

  private setTimeRemaining(seconds: number): void {
    const text = formatTime(seconds);
    if (text === this.lastTimerText) return;
    this.lastTimerText = text;
    this.timerEl.textContent = text;
  }

  destroy(): void {
    this.root.remove();
  }
}
