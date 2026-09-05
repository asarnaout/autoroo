import { describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Scene } from '@babylonjs/core/scene';
import { BoosterVisuals, createBoosterModel } from '../app/game/boosterVisuals';
import { makeBoosterState } from '../app/game/boosters';

describe('original booster geometry and reusable effects', () => {
  it.each(['boing', 'shield', 'rocket'] as const)(
    'builds finite, compact %s geometry with no external textures',
    (kind) => {
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const root = createBoosterModel(scene, kind);
      const meshes = root.getChildMeshes();
      expect(meshes.length).toBeGreaterThan(3);
      expect(meshes.length).toBeLessThanOrEqual(8);
      let vertices = 0;
      for (const mesh of meshes) {
        const positions = mesh.getVerticesData('position')!;
        expect(positions.every(Number.isFinite)).toBe(true);
        vertices += mesh.getTotalVertices();
      }
      expect(vertices).toBeLessThan(14_000);
      expect(scene.textures).toHaveLength(0);
      const bounds = root.getHierarchyBoundingVectors(true);
      expect(bounds.max.y - bounds.min.y).toBeGreaterThan(1);
      scene.dispose();
      engine.dispose();
    },
  );

  it('activates instanced pickups and all effects without allocating new meshes each frame', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    new FreeCamera('test', new Vector3(0, 5, -12), scene);
    const visuals = new BoosterVisuals(scene);
    const meshCount = scene.meshes.length;
    const materialCount = scene.materials.length;
    const boosts = makeBoosterState();
    boosts.shieldReady = true;
    const pickups = [
      {
        id: 'spring',
        kind: 'boing' as const,
        lane: 1 as const,
        absoluteZM: 20,
        yM: 1.2,
      },
      {
        id: 'bubble',
        kind: 'shield' as const,
        lane: 2 as const,
        absoluteZM: 35,
        yM: 3.4,
      },
      {
        id: 'rocket',
        kind: 'rocket' as const,
        lane: 1 as const,
        absoluteZM: 50,
        yM: 4.8,
      },
    ];
    for (let frame = 0; frame < 240; frame += 1) {
      boosts.effect = frame < 60 ? 'boing' : 'shield-pop';
      boosts.effectRemainingS = 0.5;
      visuals.update(pickups, boosts, frame / 20, -1.8, 4, frame / 60);
    }
    expect(scene.meshes.length).toBe(meshCount);
    expect(scene.materials.length).toBe(materialCount);
    expect(scene.getTransformNodeByName('spring-0')?.isEnabled()).toBe(true);
    expect(scene.getTransformNodeByName('buddy-1')?.isEnabled()).toBe(true);
    expect(scene.getTransformNodeByName('rocket-2')?.isEnabled()).toBe(true);
    expect(scene.getMeshByName('car-protection-bubble')?.isEnabled()).toBe(
      true,
    );
    expect(() => scene.render()).not.toThrow();
    scene.dispose();
    engine.dispose();
  });
});
