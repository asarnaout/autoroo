import type { InputFrame } from './contracts';

export type InputAction = 'pause' | 'restart' | null;
export type DrivingControl = 'accelerate' | 'brake' | 'left' | 'right' | 'jump';

const KEY_CONTROLS: Readonly<Record<string, DrivingControl>> = {
  ArrowUp: 'accelerate',
  ArrowDown: 'brake',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'jump',
};

const GAME_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Escape',
  'Enter',
  'KeyR',
]);

export class InputBuffer {
  private readonly held = new Map<string, DrivingControl>();
  private autoAccelerate = true;
  private readonly laneQueue: (-1 | 1)[] = [];
  private jumpQueued = false;

  setAutoAccelerate(enabled: boolean): void {
    this.autoAccelerate = enabled;
  }

  press(control: DrivingControl, source: string): void {
    if (this.held.has(source)) return;
    this.held.set(source, control);
    if (control === 'jump') this.jumpQueued = true;
    if (this.laneQueue.length < 4) {
      if (control === 'left') this.laneQueue.push(-1);
      if (control === 'right') this.laneQueue.push(1);
    }
  }

  release(source: string): void {
    this.held.delete(source);
  }

  private isHeld(control: DrivingControl): boolean {
    for (const value of this.held.values()) {
      if (value === control) return true;
    }
    return false;
  }

  keyDown(code: string, repeat = false): InputAction {
    const control = KEY_CONTROLS[code];
    if (control && !repeat) this.press(control, `keyboard:${code}`);
    if (repeat) return null;

    if (code === 'Escape') return 'pause';
    if (code === 'Enter' || code === 'KeyR') return 'restart';
    return null;
  }

  keyUp(code: string): void {
    this.release(`keyboard:${code}`);
  }

  consume(): InputFrame {
    const laneDelta = this.laneQueue.shift() ?? 0;
    const jumpPressed = this.jumpQueued || this.isHeld('jump');
    const jumpTapped = this.jumpQueued;
    this.jumpQueued = false;
    return {
      accelerate: this.autoAccelerate || this.isHeld('accelerate'),
      brake: this.isHeld('brake'),
      laneDelta,
      jumpPressed,
      jumpTapped,
    };
  }

  clear(): void {
    this.held.clear();
    this.laneQueue.length = 0;
    this.jumpQueued = false;
  }
}

export function isGameKey(code: string): boolean {
  return GAME_KEYS.has(code);
}
