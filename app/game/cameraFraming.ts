/** Keep the player's tyres above the thumb controls, with traffic in view. */
export function chaseCameraFraming(
  width: number,
  height: number,
  touch: boolean,
) {
  if (!touch) return { height: 9.8, z: -17, targetZ: 27, fov: 0.78 };
  if (height > width) {
    // Reserve the 178px controls, a 34px home indicator and 12px breathing room.
    // Project the rear tyre (y=0, z=-2.6) to that limit on shorter viewports.
    const rearScreenFraction = 1 - 224 / height;
    const rearViewAngle = Math.atan(
      (1 - 2 * rearScreenFraction) * Math.tan(0.5),
    );
    const pitch = rearViewAngle - Math.atan2(-10.2, 17.4);
    return {
      height: 10.2,
      z: -20,
      targetZ: Math.min(10, 8.9 / Math.tan(pitch) - 20),
      fov: 1,
    };
  }
  return { height: 9.8, z: -20, targetZ: 22, fov: 0.86 };
}
