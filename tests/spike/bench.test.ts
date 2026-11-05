import { it, expect } from 'vitest';
import { benchScalarMult, estimateDealMs, DEAL_MULTS_12 } from '../../src/spike/bench';

it('measures a positive per-multiplication time', () => {
  expect(benchScalarMult(20).perMultMs).toBeGreaterThan(0);
});
it('estimates deal time from the 12-player multiplication count', () => {
  expect(DEAL_MULTS_12).toBe(1750);
  expect(estimateDealMs(2)).toBe(3500);
});
