import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import { CreateTube } from '@babylonjs/core/Meshes/Builders/tubeBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { BoosterKind, BoosterPickup, BoosterState } from './contracts';
import { BOOSTER_INFO, BOOSTER_POOL_SIZE, makeBoosterState } from './boosters';
import { LANE_X } from './constants';

function material(
  scene: Scene,
  name: string,
  hex: string,
  alpha = 1,
): StandardMaterial {
  const result = new StandardMaterial(name, scene);
  result.diffuseColor = Color3.FromHexString(hex);
  result.emissiveColor = result.diffuseColor.scale(0.3);
  result.specularColor = new Color3(0.65, 0.65, 0.65);
  result.specularPower = 56;
  result.alpha = alpha;
  return result;
}

/** Original first-party geometry. No downloaded models, textures, or fonts. */
export function createBoosterModel(
  scene: Scene,
  kind: BoosterKind,
): TransformNode {
  const root = new TransformNode(`original-${kind}`, scene);
  const body = material(scene, `${kind}-candy`, BOOSTER_INFO[kind].color);
  const pink = material(scene, `${kind}-pink`, '#ff56a2');
  const cream = material(scene, `${kind}-cream`, '#fff7d6');
  const dark = material(scene, `${kind}-ink`, '#142040');
  const purple = material(scene, `${kind}-purple`, '#9964f5');
  const metal = material(scene, `${kind}-silver`, '#bfddf3');
  const meshes: Mesh[] = [];
  const add = (
    mesh: Mesh,
    paint: StandardMaterial,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    mesh.material = paint;
    mesh.position.set(x, y, z);
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };
  const ball = (
    name: string,
    paint: StandardMaterial,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy = sx,
    sz = sx,
  ): Mesh => {
    const mesh = add(
      CreateSphere(name, { diameter: 1, segments: 12 }, scene),
      paint,
      x,
      y,
      z,
    );
    mesh.scaling.set(sx, sy, sz);
    return mesh;
  };
  const ring = (
    name: string,
    paint: StandardMaterial,
    diameter: number,
    thickness: number,
    y: number,
  ): Mesh =>
    add(
      CreateTorus(name, { diameter, thickness, tessellation: 28 }, scene),
      paint,
      0,
      y,
      0,
    );
  const eyes = (y: number, z: number, spread = 0.27): void => {
    for (const side of [-1, 1]) {
      const size = side < 0 ? 0.42 : 0.34;
      ball(
        `${kind}-eye`,
        cream,
        side * spread,
        y + (side < 0 ? 0.035 : -0.02),
        z,
        size,
        size * 1.1,
        size * 0.7,
      );
      ball(
        `${kind}-pupil`,
        dark,
        side * spread + 0.055,
        y + 0.015,
        z - size * 0.34,
        size * 0.42,
        size * 0.53,
        0.09,
      );
      ball(
        `${kind}-eye-glint`,
        cream,
        side * spread + 0.08,
        y + 0.07,
        z - size * 0.39,
        0.045,
      );
    }
  };

  if (kind === 'boing') {
    ball('suction-boot', pink, 0, -0.65, 0, 1.3, 0.28, 0.95);
    ring('boot-rim', cream, 0.72, 0.11, -0.56);
    const path = Array.from({ length: 97 }, (_, i) => {
      const angle = (i / 96) * Math.PI * 8;
      return new Vector3(
        Math.cos(angle) * 0.29,
        -0.52 + (i / 96) * 0.85,
        Math.sin(angle) * 0.29,
      );
    });
    add(
      CreateTube(
        'four-turn-spring',
        { path, radius: 0.075, tessellation: 8 },
        scene,
      ),
      metal,
      0,
      0,
      0,
    );
    ball('lime-goober', body, 0, 0.48, 0, 1.3, 0.74, 0.93);
    ball('left-antenna', body, -0.43, 0.91, 0, 0.24, 0.51, 0.24).rotation.z =
      -0.28;
    ball('right-antenna', body, 0.4, 0.85, 0, 0.22, 0.4, 0.22).rotation.z = 0.4;
    eyes(0.57, -0.44);
    ball('happy-mouth', dark, 0.03, 0.29, -0.46, 0.32, 0.2, 0.08);
    ball('blep', pink, 0.06, 0.2, -0.52, 0.2, 0.25, 0.09).rotation.z = -0.2;
  } else if (kind === 'rocket') {
    ball('tangerine-fuselage', body, 0, 0, 0, 0.92, 1.7, 0.88);
    add(
      CreateCylinder(
        'crooked-nose',
        {
          height: 0.68,
          diameterTop: 0.02,
          diameterBottom: 0.78,
          tessellation: 16,
        },
        scene,
      ),
      pink,
      0.04,
      0.99,
      0,
    ).rotation.z = -0.14;
    ring('waistband', cream, 0.8, 0.12, -0.41);
    add(
      CreateCylinder(
        'nozzle',
        {
          height: 0.3,
          diameterTop: 0.46,
          diameterBottom: 0.66,
          tessellation: 12,
        },
        scene,
      ),
      dark,
      0,
      -0.87,
      0,
    );
    for (const side of [-1, 1]) {
      ball(
        'silly-fin',
        purple,
        side * 0.55,
        -0.6,
        0.04,
        0.28,
        0.78,
        0.5,
      ).rotation.z = side * 0.45;
    }
    ball('pilot-window', cream, 0, 0.24, -0.39, 0.84, 0.6, 0.12);
    eyes(0.27, -0.47, 0.21);
    ball('screaming-mouth', dark, 0, -0.17, -0.45, 0.26, 0.3, 0.06);
    ball('tongue', pink, 0, -0.24, -0.49, 0.17, 0.09, 0.03);
    ball('yellow-flame', cream, 0, -1.18, 0, 0.28, 0.5, 0.28);
  } else {
    const inflatable = ring('inflatable-buddy', body, 1.18, 0.4, 0);
    inflatable.rotation.x = Math.PI / 2;
    const inner = ball('bubble-centre', purple, 0, 0, 0.09, 0.94, 0.94, 0.25);
    inner.material = material(scene, 'bubble-glass', '#8cebff', 0.38);
    eyes(0.57, -0.22, 0.3);
    ball('smile', dark, 0, -0.44, -0.24, 0.33, 0.13, 0.09);
    ball('left-cheek', pink, -0.49, 0.18, -0.29, 0.2, 0.13, 0.06);
    ball('right-cheek', pink, 0.49, 0.18, -0.29, 0.2, 0.13, 0.06);
    ball('valve', cream, 0.74, -0.1, 0, 0.27, 0.18, 0.2);
    for (const side of [-1, 1]) {
      ball(
        'flipper',
        purple,
        side * 0.39,
        -0.73,
        0,
        0.42,
        0.21,
        0.42,
      ).rotation.z = side * 0.25;
    }
    ball(
      'bubble-highlight',
      cream,
      -0.16,
      0.14,
      -0.07,
      0.13,
      0.3,
      0.035,
    ).rotation.z = -0.45;
  }

  // One mesh per material; every pickup instance reuses this geometry.
  const byMaterial = new Map<StandardMaterial, Mesh[]>();
  for (const mesh of meshes) {
    const paint = mesh.material as StandardMaterial;
    const group = byMaterial.get(paint) ?? [];
    group.push(mesh);
    byMaterial.set(paint, group);
    mesh.computeWorldMatrix(true);
  }
  for (const [paint, group] of byMaterial) {
    const merged = Mesh.MergeMeshes(group, true, true)!;
    merged.name = `${kind}-${paint.name}`;
    merged.parent = root;
    merged.isPickable = false;
  }
  return root;
}

interface PickupVisual {
  root: TransformNode;
  models: Record<BoosterKind, TransformNode>;
  halo: Mesh;
}

function instanceModel(
  source: TransformNode,
  name: string,
  parent: TransformNode,
  scene: Scene,
): TransformNode {
  const root = new TransformNode(name, scene);
  root.parent = parent;
  for (const mesh of source.getChildMeshes()) {
    if (!(mesh instanceof Mesh)) continue;
    mesh.createInstance(`${name}-${mesh.name}`).parent = root;
  }
  return root;
}

export class BoosterVisuals {
  private readonly pool: PickupVisual[] = [];
  private readonly bubble: Mesh;
  private readonly bubbleEyes: TransformNode;
  private readonly spring: TransformNode;
  private readonly rocketPack: TransformNode;
  private readonly puffs: Mesh[] = [];
  private readonly burst: Mesh;
  private readonly haloMaterials: Record<BoosterKind, StandardMaterial>;

  constructor(scene: Scene) {
    const templates = {
      boing: createBoosterModel(scene, 'boing'),
      rocket: createBoosterModel(scene, 'rocket'),
      shield: createBoosterModel(scene, 'shield'),
    };
    this.haloMaterials = {
      boing: material(scene, 'boing-halo', BOOSTER_INFO.boing.color),
      rocket: material(scene, 'rocket-halo', BOOSTER_INFO.rocket.color),
      shield: material(scene, 'shield-halo', BOOSTER_INFO.shield.color),
    };
    for (let i = 0; i < BOOSTER_POOL_SIZE; i += 1) {
      const root = new TransformNode(`pickup-slot-${i}`, scene);
      const models = {
        boing: instanceModel(templates.boing, `spring-${i}`, root, scene),
        rocket: instanceModel(templates.rocket, `rocket-${i}`, root, scene),
        shield: instanceModel(templates.shield, `buddy-${i}`, root, scene),
      };
      const halo = CreateTorus(
        `pickup-halo-${i}`,
        { diameter: 2.3, thickness: 0.055, tessellation: 28 },
        scene,
      );
      halo.parent = root;
      halo.position.y = -0.85;
      halo.isPickable = false;
      root.setEnabled(false);
      this.pool.push({ root, models, halo });
    }
    const effects = new TransformNode('booster-effects', scene);
    this.spring = instanceModel(templates.boing, 'car-boing', effects, scene);
    this.rocketPack = instanceModel(
      templates.rocket,
      'car-rocket',
      effects,
      scene,
    );
    this.bubbleEyes = instanceModel(
      templates.shield,
      'car-bubble-buddy',
      effects,
      scene,
    );
    this.bubble = CreateSphere(
      'car-protection-bubble',
      { diameter: 1, segments: 24 },
      scene,
    );
    this.bubble.material = material(scene, 'protection-soap', '#63e7ff', 0.18);
    this.bubble.scaling.set(3.4, 3.1, 5.2);
    this.burst = CreateTorus(
      'booster-shock-ring',
      { diameter: 1, thickness: 0.08, tessellation: 32 },
      scene,
    );
    this.burst.material = this.haloMaterials.boing;
    for (let i = 0; i < 16; i += 1) {
      const puff = CreateSphere(
        `booster-puff-${i}`,
        { diameter: 0.5, segments: 8 },
        scene,
      );
      puff.material = material(
        scene,
        `puff-paint-${i}`,
        ['#fff7d6', '#ffac69', '#b4ff49', '#63e7ff'][i % 4],
      );
      puff.isPickable = false;
      puff.setEnabled(false);
      this.puffs.push(puff);
    }
    for (const template of Object.values(templates)) template.setEnabled(false);
    this.update([], makeBoosterState(), 0, 0, 0, 0);
  }

  update(
    pickups: readonly BoosterPickup[],
    state: Readonly<BoosterState>,
    playerZ: number,
    playerX: number,
    playerY: number,
    seconds: number,
  ): void {
    for (let i = 0; i < this.pool.length; i += 1) {
      const entry = this.pool[i];
      const pickup = pickups[i];
      entry.root.setEnabled(
        !!pickup &&
          pickup.absoluteZM - playerZ > -5 &&
          pickup.absoluteZM - playerZ < 275,
      );
      if (!pickup) continue;
      entry.root.position.set(
        LANE_X[pickup.lane],
        pickup.yM,
        pickup.absoluteZM - playerZ,
      );
      for (const kind of ['boing', 'rocket', 'shield'] as const) {
        const model = entry.models[kind];
        model.setEnabled(pickup.kind === kind);
        // Face the chase camera. A wobble keeps the face legible from far away.
        model.rotation.set(
          Math.sin(seconds * 2.8 + i) * 0.08,
          Math.sin(seconds * 1.8 + i) * 0.45,
          Math.sin(seconds * 3.5 + i) * 0.12,
        );
        model.position.y = Math.sin(seconds * 3 + pickup.absoluteZM) * 0.12;
        model.scaling.setAll(pickup.kind === 'rocket' ? 0.85 : 1);
      }
      entry.halo.material = this.haloMaterials[pickup.kind];
      entry.halo.rotation.z = Math.sin(seconds * 2 + i) * 0.08;
    }
    const shieldReady = state.shieldCount > 0;
    const protectedNow = shieldReady || state.protectionS > 0;
    this.bubble.setEnabled(protectedNow);
    this.bubble.position.set(playerX, playerY + 0.9, 0);
    this.bubble.visibility = shieldReady
      ? 1
      : 0.35 + 0.45 * Math.abs(Math.sin(seconds * 24));
    this.bubbleEyes.setEnabled(shieldReady);
    this.bubbleEyes.position.set(playerX, playerY + 1.35, -1.85);
    this.bubbleEyes.scaling.setAll(0.48);
    this.bubbleEyes.rotation.z = Math.sin(seconds * 5) * 0.09;

    const boing = state.effect === 'boing';
    const rocket = state.rocket !== null;
    this.spring.setEnabled(boing);
    this.spring.position.set(playerX, playerY - 0.55, 0);
    this.spring.scaling.set(
      0.8,
      0.8 + Math.abs(Math.sin(seconds * 22)) * 0.65,
      0.8,
    );
    this.rocketPack.setEnabled(rocket);
    this.rocketPack.position.set(playerX, playerY + 0.35, -2.1);
    this.rocketPack.rotation.x = -Math.PI / 2;
    this.rocketPack.rotation.z = Math.sin(seconds * 24) * 0.1;
    const burst = state.effect !== null && !rocket;
    const duration =
      state.effect === 'boing' ? 0.8 : state.effect === 'landing' ? 0.65 : 0.75;
    const progress = Math.max(
      0,
      Math.min(1, 1 - state.effectRemainingS / duration),
    );
    this.burst.setEnabled(burst);
    this.burst.material =
      this.haloMaterials[
        state.effect === 'shield-pop'
          ? 'shield'
          : state.effect === 'landing'
            ? 'rocket'
            : 'boing'
      ];
    this.burst.position.set(playerX, Math.max(0.2, playerY - 0.25), 0);
    this.burst.scaling.setAll(1 + progress * 7);
    this.burst.visibility = 1 - progress;
    for (let i = 0; i < this.puffs.length; i += 1) {
      const puff = this.puffs[i];
      puff.setEnabled(burst || rocket);
      if (rocket) {
        const t = (seconds * 2 + i / this.puffs.length) % 1;
        puff.position.set(
          playerX + Math.sin(i * 9) * t * 1.5,
          playerY + 0.4 - t * 1.6,
          -2.5 - t * 12,
        );
        puff.scaling.setAll(0.6 + t * 2.7);
        puff.visibility = (1 - t) * 0.85;
      } else {
        const angle = (i / this.puffs.length) * Math.PI * 2;
        puff.position.set(
          playerX + Math.cos(angle) * progress * 4,
          Math.max(0.2, playerY + Math.sin(i * 4) * progress * 2),
          Math.sin(angle) * progress * 4,
        );
        puff.scaling.setAll(1.2 - progress * 0.9);
        puff.visibility = 1 - progress;
      }
    }
  }
}
