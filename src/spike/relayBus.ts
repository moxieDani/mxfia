// SPIKE (throwaway): replaced by src/signaling in plan C.
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { SIGNAL_KIND } from './signal';

export type PoolLike = Pick<SimplePool, 'publish' | 'subscribe' | 'close'> & { seenOn?: SimplePool['seenOn'] };

export interface RelayBus {
  publish(tag: string, content: string): Promise<{ relay: string; ok: boolean; ms: number }[]>;
  subscribe(tag: string, on: (content: string, relay: string) => void): () => void;
  close(): void;
}

function trackedPool(): SimplePool {
  const p = new SimplePool();
  p.trackRelays = true;
  return p;
}

export function createRelayBus(relays: string[], pool: PoolLike = trackedPool()): RelayBus {
  const sk = generateSecretKey();
  return {
    async publish(tag, content) {
      const ev = finalizeEvent({ kind: SIGNAL_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['t', tag]], content }, sk);
      return Promise.all(
        relays.map(async (relay) => {
          const t0 = performance.now();
          try {
            await Promise.all(pool.publish([relay], ev));
            return { relay, ok: true, ms: Math.round(performance.now() - t0) };
          } catch {
            return { relay, ok: false, ms: Math.round(performance.now() - t0) };
          }
        }),
      );
    },
    subscribe(tag, on) {
      const seen = new Set<string>();
      const sub = pool.subscribe(relays, { kinds: [SIGNAL_KIND], '#t': [tag] }, {
        onevent(ev) {
          if (seen.has(ev.id)) return;
          seen.add(ev.id);
          const first = pool.seenOn?.get(ev.id)?.values().next().value;
          on(ev.content, first?.url ?? 'unknown');
        },
      });
      return () => sub.close();
    },
    close() {
      pool.close(relays);
    },
  };
}
