// SPIKE (throwaway): measures ristretto255 scalar multiplication speed on this device.
import { ristretto255 } from '@noble/curves/ed25519.js';
import { bytesToNumberLE } from '@noble/curves/utils.js';
import { randomBytes } from '@noble/hashes/utils.js';

// 12 players: sequential shuffles 12 × 48 = 576, own partials + proofs 66,
// verifying every partial proof 264 × 4 = 1056, key proofs and the rest ≈ 50.
export const DEAL_MULTS_12 = 1750;

const Point = ristretto255.Point;

function randomScalar(): bigint {
  const k = Point.Fn.create(bytesToNumberLE(randomBytes(64)));
  return k === 0n ? 1n : k;
}

export function benchScalarMult(iterations: number): { perMultMs: number } {
  const scalars = Array.from({ length: iterations }, randomScalar);
  let p = Point.BASE.multiply(randomScalar());
  const t0 = performance.now();
  for (const k of scalars) p = p.multiply(k);
  const elapsed = performance.now() - t0;
  if (p.is0()) throw new Error('unexpected identity');
  return { perMultMs: Math.max(elapsed / iterations, Number.MIN_VALUE) };
}

export function estimateDealMs(perMultMs: number): number {
  return perMultMs * DEAL_MULTS_12;
}
