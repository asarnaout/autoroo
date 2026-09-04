import type { InputFrame } from './contracts';

export type InputAction = 'pause' | 'restart' | null;

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
  private accelerate = false;
  private brake = false;
  private readonly laneQueue: (-1 | 1)[] = [];
  private jumpQueued = false;
  private jumpHeld = false;

  keyDown(code: string, repeat = false): InputAction {
    if (code === 'ArrowUp') this.accelerate = true;
    if (code === 'ArrowDown') this.brake = true;
    if (code === 'Space') {
      this.jumpHeld = true;
      if (!repeat) this.jumpQueued = true;
    }
    if (repeat) return null;

    if (code === 'ArrowLeft' && this.laneQueue.length < 4)
      this.laneQueue.push(-1);
    if (code === 'ArrowRight' && this.laneQueue.length < 4)
      this.laneQueue.push(1);
    if (code === 'Escape') return 'pause';
    if (code === 'Enter' || code === 'KeyR') return 'restart';
    return null;
  }

  keyUp(code: string): void {
    if (code === 'ArrowUp') this.accelerate = false;
    if (code === 'ArrowDown') this.brake = false;
    if (code === 'Space') this.jumpHeld = false;
  }

  consume(): InputFrame {
    const laneDelta = this.laneQueue.shift() ?? 0;
    const jumpPressed = this.jumpQueued || this.jumpHeld;
    this.jumpQueued = false;
    return {
      accelerate: this.accelerate,
      brake: this.brake,
      laneDelta,
      jumpPressed,
    };
  }

  clear(): void {
    this.accelerate = false;
    this.brake = false;
    this.laneQueue.length = 0;
    this.jumpQueued = false;
    this.jumpHeld = false;
  }
}

export function isGameKey(code: string): boolean {
  return GAME_KEYS.has(code);
}
