import { SaveSystem } from "@/systems/SaveSystem";

export class PauseMenu {
  private readonly root: HTMLElement;
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly saveSystem: SaveSystem,
    private readonly onResume: () => void,
    private readonly onExitToMenu: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "pause-menu";
    this.root.style.display = "none";

    const resumeButton = document.createElement("button");
    resumeButton.className = "pause-menu__resume";
    resumeButton.textContent = "Продолжить";
    resumeButton.addEventListener("click", () => this.onResume());

    const volumeLabel = document.createElement("label");
    volumeLabel.className = "pause-menu__volume-label";
    volumeLabel.textContent = "Громкость";

    const volumeInput = document.createElement("input");
    volumeInput.className = "pause-menu__volume";
    volumeInput.type = "range";
    volumeInput.min = "0";
    volumeInput.max = "100";
    volumeInput.addEventListener("input", () => {
      void this.persistVolume(Number(volumeInput.value) / 100);
    });
    volumeLabel.appendChild(volumeInput);

    // Громкость подтягивается из сохранения асинхронно — пока нет самого
    // AudioManager/Howler-интеграции, значение только читается/пишется, чтобы
    // не стоять пустым местом, когда звук появится.
    void this.saveSystem.load().then((data) => {
      volumeInput.value = String(Math.round(data.soundVolume * 100));
    });

    const exitButton = document.createElement("button");
    exitButton.className = "pause-menu__exit";
    exitButton.textContent = "В меню";
    exitButton.addEventListener("click", () => this.onExitToMenu());

    this.root.append(resumeButton, volumeLabel, exitButton);
    parent.appendChild(this.root);
  }

  private async persistVolume(soundVolume: number): Promise<void> {
    const current = await this.saveSystem.load();
    this.saveSystem.save({ ...current, soundVolume });
  }

  show(): void {
    this.visible = true;
    this.root.style.display = "block";
  }

  hide(): void {
    this.visible = false;
    this.root.style.display = "none";
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isVisible(): boolean {
    return this.visible;
  }
}
