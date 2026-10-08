export class PauseMenu {
  private readonly root: HTMLElement;
  private visible = false;

  constructor(
    parent: HTMLElement,
    private readonly onResume: () => void,
    private readonly onExitToMenu: () => void,
  ) {
    this.root = document.createElement("div");
    this.root.className = "pause-menu";
    this.root.style.display = "none";

    const resumeButton = document.createElement("button");
    resumeButton.className = "pause-menu__resume";
    resumeButton.addEventListener("click", () => this.onResume());

    const exitButton = document.createElement("button");
    exitButton.className = "pause-menu__exit";
    exitButton.addEventListener("click", () => this.onExitToMenu());

    this.root.append(resumeButton, exitButton);
    parent.appendChild(this.root);
    // TODO: громкость музыки/звука, финальная вёрстка — задача 5.5
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? "block" : "none";
  }

  isVisible(): boolean {
    return this.visible;
  }
}
