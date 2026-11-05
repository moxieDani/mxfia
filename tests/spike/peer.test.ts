import { it, expect, vi } from 'vitest';
import { waitIceComplete } from '../../src/spike/peer';

it('waitIceComplete resolves after timeout when gathering never completes', async () => {
  vi.useFakeTimers();
  const pc = { iceGatheringState: 'gathering', addEventListener() {}, removeEventListener() {} } as unknown as RTCPeerConnection;
  const p = waitIceComplete(pc, 3000);
  vi.advanceTimersByTime(3000);
  await expect(p).resolves.toBeUndefined();
  vi.useRealTimers();
});
