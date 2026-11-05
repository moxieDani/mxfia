// SPIKE (throwaway): connection test page, host side.
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { RELAYS, decodeSignal, encodeSignal, joinLink, roomTag } from './signal';
import { createRelayBus } from './relayBus';
import { acceptOffer, selectedPair, startPing } from './peer';

type GuestRow = { id: string; relay: string; state: string; pair: string; rtt: number | null };

export function HostSpike() {
  const [roomId] = useState(() => bytesToHex(randomBytes(16)));
  const link = joinLink(location.origin + location.pathname, roomId);
  const [qr, setQr] = useState('');
  const [rows, setRows] = useState<Record<string, GuestRow>>({});

  useEffect(() => {
    void QRCode.toDataURL(link, { margin: 1, width: 280 }).then(setQr);
  }, [link]);

  useEffect(() => {
    const bus = createRelayBus(RELAYS);
    const handled = new Set<string>();
    const stops: (() => void)[] = [];
    const update = (id: string, patch: Partial<GuestRow>) =>
      setRows((r) => (r[id] ? { ...r, [id]: { ...r[id], ...patch } } : r));
    const unsub = bus.subscribe(roomTag(roomId), (content, relay) => {
      const m = decodeSignal(content);
      if (!m || m.t !== 'offer' || handled.has(m.id)) return;
      handled.add(m.id);
      setRows((r) => ({ ...r, [m.id]: { id: m.id, relay, state: 'answering', pair: '-', rtt: null } }));
      void (async () => {
        const { pc, answerSdp, channel } = await acceptOffer(m.sdp);
        pc.addEventListener('connectionstatechange', () => {
          update(m.id, { state: pc.connectionState });
          if (pc.connectionState === 'connected') {
            void selectedPair(pc).then((p) => update(m.id, { pair: p ? `${p.local}/${p.remote} ${p.protocol}` : '?' }));
          }
        });
        await bus.publish(roomTag(roomId), encodeSignal({ t: 'answer', id: m.id, sdp: answerSdp }));
        const dc = await channel;
        const start = () => stops.push(startPing(dc, (rtt) => update(m.id, { rtt })));
        if (dc.readyState === 'open') start();
        else dc.addEventListener('open', start, { once: true });
      })();
    });
    return () => {
      unsub();
      stops.forEach((s) => s());
      bus.close();
    };
  }, [roomId]);

  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>연결 시험 · 호스트</h1>
      {qr && <img src={qr} alt="참가 QR" width={280} height={280} />}
      <p style={{ wordBreak: 'break-all' }}>
        <a href={link}>{link}</a>
      </p>
      <table>
        <thead>
          <tr><th>게스트</th><th>릴레이</th><th>상태</th><th>후보</th><th>RTT</th></tr>
        </thead>
        <tbody>
          {Object.values(rows).map((g) => (
            <tr key={g.id}>
              <td>{g.id.slice(0, 6)}</td><td>{g.relay}</td><td>{g.state}</td><td>{g.pair}</td>
              <td>{g.rtt === null ? '-' : `${g.rtt}ms`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: '#666' }}>{navigator.userAgent}</p>
    </main>
  );
}
