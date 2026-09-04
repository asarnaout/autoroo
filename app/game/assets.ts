import type { AssetCredit } from './contracts';

export const MODEL_URLS = {
  sports: '/models/vehicles/sports-bbb1c718.glb',
  sedan: '/models/vehicles/sedan-bf00f2f0.glb',
  suv: '/models/vehicles/suv-1a9ce2bb.glb',
  bus: '/models/vehicles/bus-77d6b810.glb',
  towerA: '/models/scenery/nyc-tower-a-43bbf652.glb',
  towerB: '/models/scenery/nyc-tower-b-9e4587c6.glb',
  midriseA: '/models/scenery/nyc-midrise-a-0896a35a.glb',
  midriseLow: '/models/scenery/nyc-midrise-low-d4b44d13.glb',
  brownstoneA: '/models/scenery/nyc-brownstone-a-ba36b2c8.glb',
  shop: '/models/scenery/shop-28927811.glb',
  treeSmall: '/models/scenery/nature-tree-small-d7ec2ac1.glb',
  treeBroadleaf: '/models/scenery/nature-tree-broadleaf-c4024af5.glb',
} as const;

export const MUSIC_URLS = {
  peckhamMarketRoute: '/audio/music/peckham-market-route.mp3',
} as const;

export type ModelKey = keyof typeof MODEL_URLS;

export const PLAYER_CAR_COLOR = '#071b3f';

export interface ModelConfig {
  readonly key: ModelKey;
  readonly scale: number;
  readonly yaw: number;
  readonly groundY: number;
  readonly bodyMaterials?: readonly string[];
  readonly color?: string;
  readonly headlightMaterials?: readonly string[];
  readonly taillightMaterials?: readonly string[];
}

export const MODEL_CONFIGS: Readonly<Record<ModelKey, ModelConfig>> = {
  sports: {
    key: 'sports',
    scale: 1.15,
    yaw: 0,
    groundY: 0,
    bodyMaterials: ['White'],
    color: PLAYER_CAR_COLOR,
    headlightMaterials: ['Headlights'],
    taillightMaterials: ['TailLights'],
  },
  sedan: {
    key: 'sedan',
    scale: 1.08,
    yaw: 0,
    groundY: 0,
    bodyMaterials: ['Blue'],
    color: '#f3bd3d',
    headlightMaterials: ['Headlights'],
    taillightMaterials: ['TailLights'],
  },
  suv: {
    key: 'suv',
    scale: 1.03,
    yaw: 0,
    groundY: 0,
    bodyMaterials: ['White'],
    color: '#2e9b91',
    headlightMaterials: ['Headlights'],
    taillightMaterials: ['TailLights'],
  },
  bus: {
    key: 'bus',
    scale: 0.24,
    yaw: 0,
    groundY: 0,
    bodyMaterials: ['039BE5'],
    color: '#7656d6',
    headlightMaterials: ['FF9800'],
    taillightMaterials: ['F44336'],
  },
  towerA: { key: 'towerA', scale: 13, yaw: 0, groundY: 0 },
  towerB: { key: 'towerB', scale: 12, yaw: 0, groundY: 0 },
  midriseA: { key: 'midriseA', scale: 7, yaw: 0, groundY: 0 },
  midriseLow: { key: 'midriseLow', scale: 9, yaw: 0, groundY: 0 },
  brownstoneA: { key: 'brownstoneA', scale: 5.5, yaw: Math.PI, groundY: 0 },
  // The authored storefront is local +Z; a half turn normalises it to the
  // local -Z facade convention used by the other roadside models.
  shop: { key: 'shop', scale: 4, yaw: Math.PI, groundY: 0 },
  treeSmall: { key: 'treeSmall', scale: 5, yaw: 0, groundY: 0 },
  treeBroadleaf: { key: 'treeBroadleaf', scale: 5.2, yaw: 0, groundY: 0 },
};

const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';

export const ASSET_CREDITS: readonly AssetCredit[] = [
  {
    file: MODEL_URLS.sports,
    sha256: 'bbb1c718d2aaf5f4344e9fb2cd66d8332a998a515b09ddd4dfa14698d787124e',
    author: 'Quaternius',
    title: 'Sports car',
    source: 'https://quaternius.com',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited unchanged; the White body material is recoloured and the named head/tail lenses are made emissive at runtime for Autoroo.',
  },
  {
    file: MODEL_URLS.sedan,
    sha256: 'bf00f2f0386a25aa310abc0424d22586e46a59ee6c737e6b375c97c9f01bd462',
    author: 'Quaternius',
    title: 'Sedan',
    source: 'https://quaternius.com',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited unchanged; the Blue body material is recoloured and the named head/tail lenses are made emissive at runtime for Autoroo.',
  },
  {
    file: MODEL_URLS.suv,
    sha256: '1a9ce2bba813dca5005abab09715b01b8b5f4a9c48d7260463afdfeb876aa8b6',
    author: 'Quaternius',
    title: 'SUV',
    source: 'https://quaternius.com',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited unchanged; the White body material is recoloured and the named head/tail lenses are made emissive at runtime for Autoroo.',
  },
  {
    file: MODEL_URLS.bus,
    sha256: '77d6b810fbe9cbe8208bf5cf1d24146144dfc12726c03e257da9693ca32f9bb4',
    author: '“jeremy” (Poly Pizza)',
    title: 'Single-deck city bus',
    source: 'https://poly.pizza/m/bsvS0E1eo4R',
    license: 'CC-BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    modificationNotes:
      'Inherited unchanged; material 039BE5 is recoloured and the mapped front/rear lenses are made emissive at runtime for Autoroo.',
  },
  {
    file: MODEL_URLS.towerA,
    sha256: '43bbf6529e19c16ecfdf7ea563c63a1a46311997c6da5508a40d0977f927750c',
    author: 'Kenney',
    title: 'Skyscraper',
    source: 'https://poly.pizza/m/XST1j6kYsL',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited byte-identical model; no Autoroo modification.',
  },
  {
    file: MODEL_URLS.towerB,
    sha256: '9e4587c640afbb45b3def91b3a9fd40c7b705391c9668e304f245886d1cb1cdd',
    author: 'Kenney',
    title: 'Skyscraper',
    source: 'https://poly.pizza/m/JTsKOSB23Y',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited byte-identical model; no Autoroo modification.',
  },
  {
    file: MODEL_URLS.midriseA,
    sha256: '0896a35a458a8e2bb9de5012ee8c4e5d56892a69be8ad09092053d325d2afca5',
    author: 'Kenney',
    title: 'Skyscraper',
    source: 'https://poly.pizza/m/obYD8hWLTZ',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited Curbside Rush NYC palette pass; solid roof material recoloured.',
  },
  {
    file: MODEL_URLS.midriseLow,
    sha256: 'd4b44d13cc656070a652c565434c18008f53eb4446654849576919864eac7b8b',
    author: 'Kenney',
    title: 'Low Building',
    source: 'https://poly.pizza/m/4RoPd9BkSx',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited byte-identical model; no Autoroo modification.',
  },
  {
    file: MODEL_URLS.brownstoneA,
    sha256: 'ba36b2c859fceb50ad813029c2bb23230d19783794f5ce3c1a2afc3699b85f24',
    author: 'Kay Lousberg',
    title: 'Building',
    source: 'https://poly.pizza/m/otRsYa6pan',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited Curbside Rush NYC palette; existing window panes moved to _Glass and a dead index buffer removed. Geometry and licence are otherwise unchanged.',
  },
  {
    file: MODEL_URLS.shop,
    sha256: '289278117dd1564c1ae190faa85c9dc309df94e45675431765e362b0b0ad36a5',
    author: 'Kay Lousberg',
    title: 'Building',
    source: 'https://poly.pizza/m/EL3ePInr1N',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited byte-identical model; no Autoroo modification.',
  },
  {
    file: MODEL_URLS.treeSmall,
    sha256: 'd7ec2ac1df8d1ee3e899afa92b8c94530e2179deedfe34010a4357091169a14e',
    author: 'Kenney',
    title: 'Nature Kit 2.1 — tree_small',
    source: 'https://kenney.nl/assets/nature-kit',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited Curbside Rush JSON-only natural palette; metallic 0 and roughness 0.9. Geometry untouched.',
  },
  {
    file: MODEL_URLS.treeBroadleaf,
    sha256: 'c4024af59ca592beb255037b5b7a6f0a874911e168dc2c48c362cea1826735e7',
    author: 'Kenney',
    title: 'Nature Kit 2.1 — tree_default',
    source: 'https://kenney.nl/assets/nature-kit',
    license: 'CC0 1.0',
    licenseUrl: CC0,
    modificationNotes:
      'Inherited Curbside Rush JSON-only natural palette; metallic 0 and roughness 0.9. Geometry untouched.',
  },
  {
    file: MUSIC_URLS.peckhamMarketRoute,
    sha256: '7a4cb6fb4e134295a0987264556acaf110c9563fdfdd897c1095ad96a6586dda',
    author: 'Project owner via Suno (artist: rykard12)',
    title: 'Peckham Market Route',
    source: 'https://suno.com',
    license: 'Suno paid-plan output rights',
    licenseUrl: 'https://suno.com/terms-of-service',
    modificationNotes:
      'Downloaded from Suno and supplied for Curbside Rush on 2026-08-08. Copied byte-identically into Autoroo and renamed from london-peckham-market-route.mp3.',
  },
] as const;

export const RESTRICTED_ASSET_BASENAMES = ['london-double-decker.glb'] as const;
