export class InputManager {
  private readonly keysDown = new Set<string>();
  private readonly keysPressed = new Set<string>();
  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private target: HTMLElement | null = null;

  private touchLookId: number | null = null;
  private touchLookLastX = 0;
  private touchLookLastY = 0;
  private readonly virtualMove = { x: 0, y: 0 };
  private touchMoveId: number | null = null;
  private touchMoveOriginX = 0;
  private touchMoveOriginY = 0;

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.keysPressed.add(event.code);
    this.keysDown.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keysDown.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    this.mouseDeltaX += event.movementX;
    this.mouseDeltaY += event.movementY;
  };

  private readonly onClick = (): void => {
    // requestPointerLock() может отказать синхронно или через rejected promise
    // (нет user gesture, нет поддержки в embed-контексте) — это не ошибка игры.
    try {
      void this.target?.requestPointerLock()?.catch(() => {});
    } catch {
      // игнорируем — просто не получили pointer lock
    }
  };

  private readonly onTouchStart = (event: TouchEvent): void => {
    const target = this.target;
    if (!target) return;

    for (const touch of Array.from(event.changedTouches)) {
      const isLeftHalf = touch.clientX < target.clientWidth / 2;
      if (isLeftHalf && this.touchMoveId === null) {
        this.touchMoveId = touch.identifier;
        this.touchMoveOriginX = touch.clientX;
        this.touchMoveOriginY = touch.clientY;
      } else if (!isLeftHalf && this.touchLookId === null) {
        this.touchLookId = touch.identifier;
        this.touchLookLastX = touch.clientX;
        this.touchLookLastY = touch.clientY;
      }
    }
  };

  private readonly onTouchMove = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touchMoveId) {
        const dx = touch.clientX - this.touchMoveOriginX;
        const dy = touch.clientY - this.touchMoveOriginY;
        const joystickRadius = 48;
        this.virtualMove.x = Math.max(-1, Math.min(1, dx / joystickRadius));
        this.virtualMove.y = Math.max(-1, Math.min(1, dy / joystickRadius));
      } else if (touch.identifier === this.touchLookId) {
        this.mouseDeltaX += (touch.clientX - this.touchLookLastX) * 2;
        this.mouseDeltaY += (touch.clientY - this.touchLookLastY) * 2;
        this.touchLookLastX = touch.clientX;
        this.touchLookLastY = touch.clientY;
      }
    }
  };

  private readonly onTouchEnd = (event: TouchEvent): void => {
    for (const touch of Array.from(event.changedTouches)) {
      if (touch.identifier === this.touchMoveId) {
        this.touchMoveId = null;
        this.virtualMove.x = 0;
        this.virtualMove.y = 0;
      } else if (touch.identifier === this.touchLookId) {
        this.touchLookId = null;
      }
    }
  };

  attach(target: HTMLElement): void {
    this.target = target;
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    target.addEventListener("mousemove", this.onMouseMove);
    target.addEventListener("click", this.onClick);
    target.addEventListener("touchstart", this.onTouchStart, { passive: true });
    target.addEventListener("touchmove", this.onTouchMove, { passive: true });
    target.addEventListener("touchend", this.onTouchEnd, { passive: true });
    target.addEventListener("touchcancel", this.onTouchEnd, { passive: true });
  }

  detach(): void {
    const target = this.target;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    if (target) {
      target.removeEventListener("mousemove", this.onMouseMove);
      target.removeEventListener("click", this.onClick);
      target.removeEventListener("touchstart", this.onTouchStart);
      target.removeEventListener("touchmove", this.onTouchMove);
      target.removeEventListener("touchend", this.onTouchEnd);
      target.removeEventListener("touchcancel", this.onTouchEnd);
    }
    this.target = null;
    this.keysDown.clear();
    this.keysPressed.clear();
  }

  isKeyDown(code: string): boolean {
    return this.keysDown.has(code);
  }

  /** Было ли нажатие клавиши с момента последнего вызова (без автоповтора при удержании). */
  consumeKeyPress(code: string): boolean {
    const wasPressed = this.keysPressed.has(code);
    this.keysPressed.delete(code);
    return wasPressed;
  }

  /** Виртуальный джойстик (тач): x/y в диапазоне [-1, 1], аналог WASD. */
  getVirtualMove(): { x: number; y: number } {
    return { ...this.virtualMove };
  }

  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }
}
