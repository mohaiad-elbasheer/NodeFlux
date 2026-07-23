// Sampling for the distributions used by the lead-time model.
//
// PERT(min, mode, max): the standard three-point estimate distribution for
// activity durations — a scaled Beta with alpha = 1 + 4(mode-min)/(max-min),
// beta = 1 + 4(max-mode)/(max-min). Analytic mean (min + 4*mode + max) / 6
// is used by the statistical test suite.

import { normal, type Rng } from "./rng";

export interface PertParams {
  min: number;
  mode: number;
  max: number;
}

export function pertMean(p: PertParams): number {
  return (p.min + 4 * p.mode + p.max) / 6;
}

/** Marsaglia–Tsang gamma sampler (shape >= 1), with Johnk boost for shape < 1. */
export function gammaSample(rng: Rng, shape: number): number {
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a+1) * U^(1/a)
    const u = rng();
    return gammaSample(rng, shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function betaSample(rng: Rng, alpha: number, beta: number): number {
  const x = gammaSample(rng, alpha);
  const y = gammaSample(rng, beta);
  return x / (x + y);
}

export function pertSample(rng: Rng, p: PertParams): number {
  const range = p.max - p.min;
  if (range <= 1e-9) return p.mode;
  const alpha = 1 + (4 * (p.mode - p.min)) / range;
  const beta = 1 + (4 * (p.max - p.mode)) / range;
  return p.min + range * betaSample(rng, alpha, beta);
}

/** Lognormal with given log-space parameters. Mean = exp(mu + sigma^2 / 2). */
export function lognormalSample(rng: Rng, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * normal(rng));
}
