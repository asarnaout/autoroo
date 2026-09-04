import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASSET_CREDITS,
  MODEL_CONFIGS,
  MODEL_URLS,
  MUSIC_URLS,
  RESTRICTED_ASSET_BASENAMES,
} from '../app/game/assets';
import { RENDER_POOL_LIMITS, VEHICLE_DIMENSIONS } from '../app/game/constants';

const publicRoot = join(process.cwd(), 'public');

function allFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

describe('curated asset supply chain', () => {
  it('credits and byte-pins every committed GLB', () => {
    const creditsDocument = readFileSync(
      join(process.cwd(), 'CREDITS.md'),
      'utf8',
    );
    const glbs = allFiles(join(publicRoot, 'models'))
      .filter((file) => file.endsWith('.glb'))
      .map((file) => `/${relative(publicRoot, file)}`)
      .sort();
    const credited = ASSET_CREDITS.filter((credit) =>
      credit.file.endsWith('.glb'),
    )
      .map((credit) => credit.file)
      .sort();
    expect(glbs).toEqual(credited);
    for (const credit of ASSET_CREDITS.filter((entry) =>
      entry.file.endsWith('.glb'),
    )) {
      const bytes = readFileSync(join(publicRoot, credit.file));
      expect(bytes.subarray(0, 4).toString('ascii')).toBe('glTF');
      expect(bytes.readUInt32LE(4)).toBe(2);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        credit.sha256,
      );
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.source).toMatch(/^https:\/\//);
      expect(credit.licenseUrl).toMatch(/^https:\/\//);
      expect(creditsDocument).toContain(basename(credit.file));
      expect(creditsDocument).toContain(credit.source);
      expect(creditsDocument).toContain(credit.licenseUrl);
    }
  });

  it('credits and byte-pins every committed music track', () => {
    const creditsDocument = readFileSync(
      join(process.cwd(), 'CREDITS.md'),
      'utf8',
    );
    const tracks = allFiles(join(publicRoot, 'audio'))
      .filter((file) => file.endsWith('.mp3'))
      .map((file) => `/${relative(publicRoot, file)}`)
      .sort();
    const credited = ASSET_CREDITS.filter((credit) =>
      credit.file.endsWith('.mp3'),
    )
      .map((credit) => credit.file)
      .sort();
    expect(tracks).toEqual(credited);
    expect(tracks).toEqual([MUSIC_URLS.peckhamMarketRoute]);
    for (const credit of ASSET_CREDITS.filter((entry) =>
      entry.file.endsWith('.mp3'),
    )) {
      const bytes = readFileSync(join(publicRoot, credit.file));
      expect(bytes.subarray(0, 3).toString('ascii')).toBe('ID3');
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        credit.sha256,
      );
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.source).toBe('https://suno.com');
      expect(credit.licenseUrl).toBe('https://suno.com/terms-of-service');
      expect(creditsDocument).toContain(basename(credit.file));
      expect(creditsDocument).toContain(credit.source);
      expect(creditsDocument).toContain(credit.licenseUrl);
    }
  });

  it('hard-fails if restricted vehicles or map data enter the build', () => {
    const files = allFiles(publicRoot);
    const basenames = files.map((file) => basename(file));
    for (const restricted of RESTRICTED_ASSET_BASENAMES)
      expect(basenames).not.toContain(restricted);
    expect(
      files
        .map((file) => relative(publicRoot, file).replaceAll('\\', '/'))
        .filter((file) =>
          /(london.*double|double.*decker|osm|map-data)/i.test(file),
        ),
    ).toEqual([]);
  });

  it('pins render scale/orientation, collider, and pool contracts', () => {
    expect(MODEL_CONFIGS.sports).toMatchObject({
      scale: 1.15,
      yaw: 0,
      groundY: 0.058,
      bodyMaterials: ['White'],
      color: '#0b3d82',
      headlightMaterials: ['Headlights'],
      taillightMaterials: ['TailLights'],
    });
    expect(MODEL_CONFIGS.sedan).toMatchObject({
      scale: 1.08,
      yaw: 0,
      groundY: 0.034,
      headlightMaterials: ['Headlights'],
      taillightMaterials: ['TailLights'],
    });
    expect(MODEL_CONFIGS.suv).toMatchObject({
      scale: 1.03,
      yaw: 0,
      groundY: 0.059,
      headlightMaterials: ['Headlights'],
      taillightMaterials: ['TailLights'],
    });
    expect(MODEL_CONFIGS.bus).toMatchObject({
      scale: 0.24,
      yaw: 0,
      groundY: 0.03,
      headlightMaterials: ['FF9800'],
      taillightMaterials: ['F44336'],
    });
    expect(VEHICLE_DIMENSIONS.sedan).toEqual({
      lengthM: 4,
      widthM: 1.8,
      heightM: 1.45,
    });
    expect(VEHICLE_DIMENSIONS.bus).toEqual({
      lengthM: 7,
      widthM: 2.2,
      heightM: 2.7,
    });
    expect(RENDER_POOL_LIMITS).toEqual({
      frontCars: 40,
      buses: 16,
      rearCars: 4,
      roadTiles: 16,
    });
    expect(Object.keys(MODEL_URLS)).toHaveLength(12);
  });
});
