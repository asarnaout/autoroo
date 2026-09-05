import { describe, expect, it } from 'vitest';
import { chaseCameraFraming } from '../app/game/cameraFraming';

function screenY(
  worldY: number,
  worldZ: number,
  width: number,
  height: number,
) {
  const shot = chaseCameraFraming(width, height, true);
  const pitch = Math.atan2(shot.height - 1.3, shot.targetZ - shot.z);
  const dy = worldY - shot.height;
  const dz = worldZ - shot.z;
  const vertical = dy * Math.cos(pitch) + dz * Math.sin(pitch);
  const depth = -dy * Math.sin(pitch) + dz * Math.cos(pitch);
  return ((1 - vertical / (depth * Math.tan(shot.fov / 2))) * height) / 2;
}

describe('mobile chase camera', () => {
  it.each([
    [320, 568],
    [390, 664],
    [402, 715],
    [440, 780],
    [768, 1024],
  ])('keeps the car above the controls at %i × %i', (width, height) => {
    const rearTyreY = screenY(0, -2.6, width, height);
    expect(height - rearTyreY).toBeGreaterThan(178 + 34);
    expect(screenY(1.2, 0, width, height)).toBeGreaterThan(height * 0.4);
  });
  it('keeps the entire car visible in landscape with room between the thumb pads', () => {
    expect(screenY(0, -2.6, 874, 360)).toBeLessThan(330);
  });
});
