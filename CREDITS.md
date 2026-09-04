# Autoroo asset credits

Autoroo uses a deliberately small subset of models and music inherited from
Curbside Rush. The authoritative machine-readable manifest is
`app/game/assets.ts`; it drives the in-game Credits view and pins every imported
binary asset to its SHA-256, author, title, source, licence or rights basis, and
modification record. CC0 credits are retained voluntarily.

## CC0 — public domain

- **sports-bbb1c718.glb, sedan-bf00f2f0.glb, suv-1a9ce2bb.glb** — low-poly cars
  by **Quaternius** (<https://quaternius.com>), released **CC0 1.0**
  (<https://creativecommons.org/publicdomain/zero/1.0/>). The inherited bytes are
  unchanged; Autoroo recolours the named solid body materials at runtime.
- **shop-28927811.glb** ("Building") — by **Kay Lousberg** via Poly Pizza
  (<https://poly.pizza/m/EL3ePInr1N>), released **CC0 1.0**. Inherited unchanged.
- **nyc-tower-a-43bbf652.glb, nyc-tower-b-9e4587c6.glb,
  nyc-midrise-a-0896a35a.glb, nyc-midrise-low-d4b44d13.glb** — low-poly
  skyscrapers and mid-rise buildings by **Kenney** (<https://kenney.nl>) via
  Poly Pizza (<https://poly.pizza/m/XST1j6kYsL>,
  <https://poly.pizza/m/JTsKOSB23Y>, <https://poly.pizza/m/obYD8hWLTZ>,
  <https://poly.pizza/m/4RoPd9BkSx>), released **CC0 1.0**. Tower A, Tower B,
  and Midrise Low are inherited byte-identically. Midrise A retains Curbside
  Rush's NYC palette pass on its solid roof material.
- **nyc-brownstone-a-ba36b2c8.glb** ("Building") — by **Kay Lousberg**, City
  Builder Bits pack via Poly Pizza (<https://poly.pizza/m/otRsYa6pan>), released
  **CC0 1.0**. It retains Curbside Rush's NYC palette and existing-window-pane
  `_Glass` material split, plus removal of a dead index buffer; geometry and
  licence are otherwise unchanged.
- **nature-tree-broadleaf-c4024af5.glb, nature-tree-small-d7ec2ac1.glb** — from
  **Kenney's Nature Kit 2.1** (<https://kenney.nl/assets/nature-kit>), released
  **CC0 1.0**. These retain Curbside Rush's JSON-only natural-palette pass with
  metallic 0 and roughness 0.9; geometry is untouched.

## CC-BY — attribution required

- **bus-77d6b810.glb** (single-deck city bus) — by **"jeremy"** via Poly Pizza
  (<https://poly.pizza/m/bsvS0E1eo4R>), licensed **CC-BY 3.0**
  (<https://creativecommons.org/licenses/by/3.0/>). Required credit:
  **"jeremy" (Poly Pizza)**. The inherited bytes are unchanged; Autoroo
  recolours material `039BE5` at runtime.

## Music — Suno paid-plan output

- **peckham-market-route.mp3** ("Peckham Market Route") — downloaded from
  [Suno](https://suno.com) and supplied by the project owner for Curbside Rush
  on 2026-08-08, with embedded artist `rykard12`. It carries the same paid
  (Pro/Premier) plan terms recorded by Curbside Rush: Suno assigns the
  subscriber all right, title, and interest in output generated during the
  subscription term, including commercial use, and that grant survives the
  subscription ending. See Suno's [Terms of
  Service](https://suno.com/terms-of-service) and [rights
  FAQ](https://help.suno.com/en/articles/9601665). Rights are not granted
  retroactively to free-tier generations. Autoroo copies the Curbside Rush
  master byte-identically and renames
  `london-peckham-market-route.mp3` to `peckham-market-route.mp3`; SHA-256:
  `7a4cb6fb4e134295a0987264556acaf110c9563fdfdd897c1095ad96a6586dda`.

## Adapted first-party code

Road surfaces, lane markings, merge signs, the start countdown light, warning
lights, and related Babylon presentation techniques are newly reduced/adapted
from Curbside Rush's first-party procedural code. The inherited MIT notice is
preserved in `LICENSE` (Copyright (c) 2026 Ahmed Arnaout). Autoroo's endless
topology, deterministic fixed-tick simulation, gate certification, rear pressure,
render pools, HUD, synthesised sound effects, and WebMCP integration are
Autoroo-specific work.

## Explicit exclusions

`london-double-decker.glb` is a purchased Envato asset whose licence does not
permit redistribution. It is forbidden from this repository and the asset tests
fail if it appears. No Curbside Rush city map, OSM extract, or map-derived data is
copied into Autoroo.
