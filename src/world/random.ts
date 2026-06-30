export const hashSeed = (seed: string) => {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const hashInts = (seed: number, x: number, z: number, salt = 0) => {
  let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
};

export const random01 = (seed: number, x: number, z: number, salt = 0) => hashInts(seed, x, z, salt) / 0xffffffff;

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class ValueNoise2D {
  constructor(private readonly seed: number) {}

  sample(x: number, z: number, frequency: number, salt = 0) {
    const fx = x * frequency;
    const fz = z * frequency;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fade(fx - x0);
    const tz = fade(fz - z0);

    const a = random01(this.seed, x0, z0, salt);
    const b = random01(this.seed, x0 + 1, z0, salt);
    const c = random01(this.seed, x0, z0 + 1, salt);
    const d = random01(this.seed, x0 + 1, z0 + 1, salt);

    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  fbm(x: number, z: number, frequency: number, octaves: number, salt = 0) {
    let value = 0;
    let amplitude = 1;
    let total = 0;
    let freq = frequency;

    for (let octave = 0; octave < octaves; octave += 1) {
      value += this.sample(x, z, freq, salt + octave * 31) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      freq *= 2;
    }

    return value / total;
  }
}
