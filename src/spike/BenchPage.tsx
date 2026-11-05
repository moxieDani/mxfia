// SPIKE (throwaway): crypto speed page.
import { useState } from 'react';
import { benchScalarMult, estimateDealMs, DEAL_MULTS_12 } from './bench';

export function Bench() {
  const [result, setResult] = useState<{ perMultMs: number; dealMs: number } | null>(null);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      const { perMultMs } = benchScalarMult(300);
      setResult({ perMultMs, dealMs: estimateDealMs(perMultMs) });
      setRunning(false);
    }, 50);
  };
  return (
    <main style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>암호 속도 측정</h1>
      <button onClick={run} disabled={running}>{running ? '측정 중…' : '측정 시작'}</button>
      {result && (
        <>
          <p>곱셈 1회: {result.perMultMs.toFixed(3)}ms</p>
          <p>12명 역할 배정 예상 ({DEAL_MULTS_12}회): {(result.dealMs / 1000).toFixed(2)}초</p>
        </>
      )}
      <p style={{ fontSize: 12, color: '#666' }}>{navigator.userAgent}</p>
    </main>
  );
}
