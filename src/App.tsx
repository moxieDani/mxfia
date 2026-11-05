import { useEffect, useState } from 'react';
import { parseRoom } from './spike/signal';
import { HostSpike } from './spike/HostSpike';
import { GuestSpike } from './spike/GuestSpike';

export function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  const room = parseRoom(hash);
  if (room) return <GuestSpike roomId={room} />;
  return <HostSpike />;
}
