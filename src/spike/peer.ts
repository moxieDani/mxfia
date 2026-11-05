// SPIKE (throwaway): replaced by src/transport in plan C.
import { ICE_SERVERS } from './signal';

function track(pc: RTCPeerConnection): RTCPeerConnection {
  const w = globalThis as unknown as { __pcs?: RTCPeerConnection[] };
  (w.__pcs ??= []).push(pc);
  return pc;
}

export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

export async function createOfferPeer(): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel; sdp: string }> {
  const pc = track(new RTCPeerConnection({ iceServers: ICE_SERVERS }));
  const dc = pc.createDataChannel('mxfia', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await waitIceComplete(pc);
  return { pc, dc, sdp: pc.localDescription!.sdp };
}

export async function acceptOffer(sdp: string): Promise<{ pc: RTCPeerConnection; answerSdp: string; channel: Promise<RTCDataChannel> }> {
  const pc = track(new RTCPeerConnection({ iceServers: ICE_SERVERS }));
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (e) => resolve(e.channel), { once: true });
  });
  await pc.setRemoteDescription({ type: 'offer', sdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIceComplete(pc);
  return { pc, answerSdp: pc.localDescription!.sdp, channel };
}

export async function completeOffer(pc: RTCPeerConnection, answerSdp: string): Promise<void> {
  await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
}

export async function selectedPair(pc: RTCPeerConnection): Promise<{ local: string; remote: string; protocol: string } | null> {
  const stats = await pc.getStats();
  let pairId: string | undefined;
  stats.forEach((s) => {
    if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
  });
  if (!pairId) {
    stats.forEach((s) => {
      if (s.type === 'candidate-pair' && s.state === 'succeeded' && (s.nominated || s.selected)) pairId = s.id;
    });
  }
  const pair = pairId ? stats.get(pairId) : undefined;
  if (!pair) return null;
  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  return { local: local?.candidateType ?? '?', remote: remote?.candidateType ?? '?', protocol: local?.protocol ?? '?' };
}

export function startPing(dc: RTCDataChannel, onRtt: (ms: number) => void): () => void {
  const onMessage = (e: MessageEvent) => {
    const m = JSON.parse(String(e.data)) as { ping?: number; pong?: number };
    if (m.ping !== undefined) dc.send(JSON.stringify({ pong: m.ping }));
    if (m.pong !== undefined) onRtt(Math.round(performance.now() - m.pong));
  };
  dc.addEventListener('message', onMessage);
  const timer = setInterval(() => {
    if (dc.readyState === 'open') dc.send(JSON.stringify({ ping: performance.now() }));
  }, 1000);
  return () => {
    clearInterval(timer);
    dc.removeEventListener('message', onMessage);
  };
}
