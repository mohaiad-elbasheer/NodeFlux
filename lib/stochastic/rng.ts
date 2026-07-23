// Seeded, dependency-free PRNG (mulberry32) plus standard-normal sampling.
// Every Monte Carlo result in NodeFlux is reproducible from its seed.

export type Rng = () => number;

/** mulberry32: fast 32-bit PRNG with good statistical quality for MC use. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derive a stream-specific seed so parallel streams don't overlap. */
export function deriveSeed(seed: number, streamId: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < streamId.length; i++) {
    h ^= streamId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** Standard normal via Box–Muller (single-value form; second value dropped
 * to keep the draw count per scenario deterministic). */
export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng(); // avoid log(0)
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
