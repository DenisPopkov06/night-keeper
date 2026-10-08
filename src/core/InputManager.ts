export class InputManager {
  private readonly keysDown = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;

  attach(_target: HTMLElement): void {
    // TODO: подписка на keydown/keyup/mousemove/touch — задача 5.2/5.3
  }

  detach(): void {
    // TODO
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }
}
