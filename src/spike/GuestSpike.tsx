// SPIKE (throwaway): connection test page, guest side.
import { useEffect, useState } from 'react';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { RELAYS, decodeSignal, encodeSignal, roomTag } from './signal';
import { createRelayBus } from './relayBus';
import { completeOffer, createOfferPeer, selectedPair, startPing } from './peer';
import { isKakaoInApp } from './env';

type PubResult = { relay: string; ok: boolean; ms: number };

export function GuestSpike({ roomId }: { roomId: string }) {
  const [status, setStatus] = useState('시작 중');
  const [pubs, setPubs] = useState<PubResult[]>([]);
  const [pair, setPair] = useState('-');
  const [rtt, setRtt] = useState<number | null>(null);
  const kakao = isKakaoInApp(navigator.userAgent);

  useEffect(() => {
    let cancelled = false;
    let stopPing = () => {};
    let unsub = () => {};
    const bus = createRelayBus(RELAYS);
    const id = bytesToHex(randomBytes(16));
    const t0 = performance.now();
    void (async () => {
      setStatus('연결 정보 만드는 중');
      const { pc, dc, sdp } = await createOfferPeer();
      if (cancelled) {
        pc.close();
        return;
      }
      pc.addEventListener('connectionstatechange', () => {
        setStatus(`${pc.connectionState} (${Math.round(performance.now() - t0)}ms)`);
        if (pc.connectionState === 'connected') {
          void selectedPair(pc).then((p) => setPair(p ? `${p.local}/${p.remote} ${p.protocol}` : '?'));
        }
      });
      dc.addEventListener('open', () => {
        stopPing = startPing(dc, setRtt);
      });
      let answered = false;
      unsub = bus.subscribe(roomTag(roomId), (content) => {
        const m = decodeSignal(content);
        if (!m || m.t !== 'answer' || m.id !== id || answered) return;
        answered = true;
        setStatus('응답 받음, 연결 중');
        void completeOffer(pc, m.sdp);
      });
      setStatus('릴레이에 올리는 중');
      setPubs(await bus.publish(roomTag(roomId), encodeSignal({ t: 'offer', id, sdp })));
      if (!answered) setStatus('호스트 응답 기다리는 중');
      setTimeout(() => {
        if (!answered && !cancelled) setStatus('호스트를 찾지 못함');
      }, 20000);
    })();
    return () => {
      cancelled = true;
      stopPing();
      unsub();
      bus.close();
    };
  }, [roomId]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      {kakao && (
        <p style={{ background: '#fde047', padding: 12 }}>카카오톡 안에서 열렸습니다. Safari 또는 Chrome으로 열어 주세요.</p>
      )}
      <h1>연결 시험 · 게스트</h1>
      <p>방: {roomId.slice(0, 6)}</p>
      <p>상태: {status}</p>
      <p>후보: {pair}</p>
      <p>RTT: {rtt === null ? '-' : `${rtt}ms`}</p>
      <ul>
        {pubs.map((p) => (
          <li key={p.relay}>{p.relay}: {p.ok ? '성공' : '실패'} ({p.ms}ms)</li>
        ))}
      </ul>
      <p style={{ fontSize: 12, color: '#666' }}>{navigator.userAgent}</p>
    </main>
  );
}
