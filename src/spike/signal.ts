// SPIKE (throwaway): replaced by src/signaling in plan C.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const SIGNAL_KIND = 25050;
export const RELAYS: string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band'];
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];

export type SignalMsg = { t: 'offer'; id: string; sdp: string } | { t: 'answer'; id: string; sdp: string };

export function encodeSignal(m: SignalMsg): string {
  return JSON.stringify(m);
}

export function decodeSignal(s: string): SignalMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if ((o.t !== 'offer' && o.t !== 'answer') || typeof o.id !== 'string' || typeof o.sdp !== 'string') return null;
  return { t: o.t, id: o.id, sdp: o.sdp };
}

export function roomTag(roomId: string): string {
  return bytesToHex(sha256(utf8ToBytes('mxfia/' + roomId)));
}

export function joinLink(pageUrl: string, roomId: string): string {
  return `${pageUrl}#room=${roomId}`;
}

export function parseRoom(hash: string): string | null {
  const m = /^#room=([0-9a-f]{32})$/.exec(hash);
  return m ? m[1]! : null;
}
