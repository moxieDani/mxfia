import { describe, it, expect } from 'vitest';
import { encodeSignal, decodeSignal, roomTag, joinLink, parseRoom } from '../../src/spike/signal';

describe('signal', () => {
  it('round-trips offer and answer', () => {
    const m = { t: 'offer', id: 'ab'.repeat(16), sdp: 'v=0' } as const;
    expect(decodeSignal(encodeSignal(m))).toEqual(m);
  });
  it('rejects malformed input', () => {
    expect(decodeSignal('not json')).toBeNull();
    expect(decodeSignal('{"t":"offer","id":"x"}')).toBeNull();
    expect(decodeSignal('{"t":"hello","id":"x","sdp":"y"}')).toBeNull();
  });
  it('roomTag is a deterministic sha256 hex', () => {
    expect(roomTag('r1')).toMatch(/^[0-9a-f]{64}$/);
    expect(roomTag('r1')).toBe(roomTag('r1'));
    expect(roomTag('r1')).not.toBe(roomTag('r2'));
  });
  it('builds and parses join links', () => {
    const id = '0123456789abcdef0123456789abcdef';
    expect(joinLink('https://moxiedani.github.io/mxfia/', id)).toBe(`https://moxiedani.github.io/mxfia/#room=${id}`);
    expect(parseRoom(`#room=${id}`)).toBe(id);
    expect(parseRoom('#bench')).toBeNull();
    expect(parseRoom('#room=xyz')).toBeNull();
    expect(parseRoom('')).toBeNull();
  });
});
