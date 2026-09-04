export function mix32(value: number): number {
  let x = value >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

export function hashParts(seed: number, ...parts: number[]): number {
  let hash = mix32(seed ^ 0xa5b35705);
  for (let index = 0; index < parts.length; index += 1) {
    hash = mix32(
      hash ^ Math.imul(parts[index] | 0, 0x9e3779b1 + index * 0x85ebca6b),
    );
  }
  return hash >>> 0;
}

export function hashUnit(seed: number, ...parts: number[]): number {
  return hashParts(seed, ...parts) / 0x1_0000_0000;
}

export function hashChoice<T>(
  values: readonly T[],
  seed: number,
  ...parts: number[]
): T {
  return values[hashParts(seed, ...parts) % values.length];
}

export function stableHash(text: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = mix32(second ^ code ^ index);
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}
