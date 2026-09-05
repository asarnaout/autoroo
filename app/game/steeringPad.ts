import type { DrivingControl } from './input';

export type SteeringDirection = 'left' | 'right';

export interface SteeringBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface SteeringContact {
  direction: SteeringDirection;
  readonly bounds?: SteeringBounds;
}

// CSS pixels. This guard applies only to reversing an existing contact;
// a fresh tap anywhere in either half responds immediately.
const REVERSAL_GUARD_PX = 12;
const VERTICAL_DRIFT_ALLOWANCE_PX = 16;

/** One lane step per tap or deliberate crossing, never an automatic repeat. */
export class SteeringPadInput {
  private readonly contacts = new Map<string, SteeringContact>();

  constructor(
    private readonly onPress: (control: DrivingControl, source: string) => void,
    private readonly onRelease: (source: string) => void,
  ) {}

  press(direction: SteeringDirection, source: string): boolean {
    if (this.contacts.has(source)) return false;
    this.contacts.set(source, { direction });
    this.onPress(direction, source);
    return true;
  }

  pointerDown(
    source: string,
    x: number,
    y: number,
    bounds: SteeringBounds,
  ): boolean {
    if (
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      x < bounds.left ||
      x > bounds.left + bounds.width ||
      y < bounds.top ||
      y > bounds.top + bounds.height ||
      this.contacts.has(source)
    )
      return false;

    const direction = x < bounds.left + bounds.width / 2 ? 'left' : 'right';
    this.contacts.set(source, { direction, bounds: { ...bounds } });
    this.onPress(direction, source);
    return true;
  }

  pointerMove(source: string, x: number, y: number): boolean {
    const contact = this.contacts.get(source);
    if (!contact?.bounds) return false;
    const { left, top, width, height } = contact.bounds;
    // A steering finger remains a steering finger, even near Jump. Moving
    // vertically out of the pad cannot accidentally add another lane step.
    if (
      y < top - VERTICAL_DRIFT_ALLOWANCE_PX ||
      y > top + height + VERTICAL_DRIFT_ALLOWANCE_PX
    )
      return false;

    const split = left + width / 2;
    const reverse =
      contact.direction === 'left'
        ? x >= split + REVERSAL_GUARD_PX
        : x <= split - REVERSAL_GUARD_PX;
    if (!reverse) return false;

    this.onRelease(source);
    contact.direction = contact.direction === 'left' ? 'right' : 'left';
    this.onPress(contact.direction, source);
    return true;
  }

  release(source: string): boolean {
    if (!this.contacts.delete(source)) return false;
    this.onRelease(source);
    return true;
  }

  clear(): void {
    for (const source of this.contacts.keys()) this.onRelease(source);
    this.contacts.clear();
  }

  isPressed(direction: SteeringDirection): boolean {
    for (const contact of this.contacts.values()) {
      if (contact.direction === direction) return true;
    }
    return false;
  }
}
