export interface HUDTask {
  label: string;
  done: boolean;
}

export interface HUDState {
  flashlightChargePercent: number;
  flashlightOn: boolean;
  remainingSec: number;
  tasks: HUDTask[];
}

const LOW_TIME_THRESHOLD_SEC = 30;

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
  private readonly flashlightHint: HTMLElement;
  private readonly timerEl: HTMLElement;
  private readonly taskListEl: HTMLElement;

  private lastChargePercent = -1;
  private lastTimerText = "";
  private lastTasksSignature = "";
  private lastIsLowTime = false;
  private flashlightUsedOnce = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "hud";

    const flashlight = document.createElement("div");
    flashlight.className = "hud__flashlight";
    this.flashlightBar = document.createElement("div");
    this.flashlightBar.className = "hud__flashlight-bar";
    flashlight.appendChild(this.flashlightBar);

    this.flashlightHint = document.createElement("div");
    this.flashlightHint.className = "hud__hint";
    this.flashlightHint.textContent = "F — фонарик";

    this.timerEl = document.createElement("div");
    this.timerEl.className = "hud__timer";

    this.taskListEl = document.createElement("ul");
    this.taskListEl.className = "hud__tasks";

    this.root.append(flashlight, this.flashlightHint, this.timerEl, this.taskListEl);
    parent.appendChild(this.root);
  }

  update(state: HUDState): void {
    this.setFlashlightCharge(state.flashlightChargePercent);
    this.setFlashlightHint(state.flashlightOn);
    this.setTimeRemaining(state.remainingSec);
    this.setTaskList(state.tasks);
  }

  private setFlashlightCharge(percent: number): void {
    const rounded = Math.round(Math.max(0, Math.min(100, percent)));
    if (rounded === this.lastChargePercent) return;
    this.lastChargePercent = rounded;
    this.flashlightBar.style.width = `${rounded}%`;
  }

  /** Подсказка клавиши видна, пока игрок ни разу не включил фонарик — он выключен
   *  по умолчанию (решение дизайнера), без подсказки не всем очевидно, что делать. */
  private setFlashlightHint(flashlightOn: boolean): void {
    if (flashlightOn) this.flashlightUsedOnce = true;
    this.flashlightHint.style.display = this.flashlightUsedOnce ? "none" : "";
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
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.timerEl.textContent = text;
    }

    const isLowTime = seconds <= LOW_TIME_THRESHOLD_SEC;
    if (isLowTime !== this.lastIsLowTime) {
      this.lastIsLowTime = isLowTime;
      this.timerEl.classList.toggle("hud__timer--low", isLowTime);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
