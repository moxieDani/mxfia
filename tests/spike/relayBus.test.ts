import { it, expect } from 'vitest';
import { createRelayBus } from '../../src/spike/relayBus';

type Ev = { id: string; content: string };

it('delivers an event once even if several relays send it', () => {
  let emit: ((ev: Ev) => void) | undefined;
  const pool = {
    publish: () => [],
    subscribe: (_relays: string[], _filter: unknown, h: { onevent: (ev: Ev) => void }) => {
      emit = h.onevent;
      return { close() {} };
    },
    close() {},
  };
  const bus = createRelayBus(['wss://a', 'wss://b'], pool as never);
  const got: string[] = [];
  bus.subscribe('tag', (c) => got.push(c));
  emit!({ id: 'e1', content: 'hello' });
  emit!({ id: 'e1', content: 'hello' });
  emit!({ id: 'e2', content: 'world' });
  expect(got).toEqual(['hello', 'world']);
});
