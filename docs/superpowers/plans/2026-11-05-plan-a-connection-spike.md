# 계획 A: 웹 연결 기술 검증 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** github.io에 시험 페이지를 배포해, 서버 없이 iPhone·Android 브라우저끼리 WebRTC로 연결되는지와 폰 브라우저의 암호 계산 속도를 실측한다.

**Architecture:** Vite + React 정적 사이트를 GitHub Actions로 GitHub Pages에 배포한다. 시험 페이지는 호스트 모드(QR 표시, 연결 수락)와 게스트 모드(링크 접속, 연결 요청)를 갖고, 연결 정보는 Nostr 공용 릴레이로 교환한다. `src/spike/`의 코드는 버리는 코드이며 계획 C에서 정식 구현으로 대체한다. 프로젝트 골격과 배포 파이프라인은 계속 쓴다.

**Tech Stack:** TypeScript 6.0.3, Vite 8.3.5, React 19.3.1, Vitest 5.1.0, nostr-tools 2.25.5, qrcode 1.5.4, @noble/curves 2.4.0, @noble/hashes 2.4.0, pnpm 11.5.1, Node 22

**Spec:** `docs/superpowers/specs/2026-11-04-mafia-no-moderator-design.md` (12절 1단계, 4절, 11.4절)

## Global Constraints

- 배포 주소: `https://moxiedani.github.io/mxfia/` (GitHub 계정 `moxieDani`, 저장소 `mxfia`), Vite `base: '/mxfia/'`
- 직접 운영하는 서버 없음. 공용 Nostr 릴레이와 공용 STUN만 사용
- 방 정보는 URL fragment(`#` 뒤)에만 둔다
- 지원 대상: iOS 16.4+ Safari, 최신 Android Chrome
- `src/spike/`는 버리는 코드다. 다른 폴더에서 `src/spike/`를 import하지 않는다
- 패키지 버전은 이 문서의 Tech Stack 버전으로 고정한다 (`pnpm add 패키지@버전`)

## Review Focus

- 여러 릴레이가 같은 이벤트를 중복 전달 → 같은 offer를 두 번 처리하지 않아야 한다 (Task 2 `RelayBus` 중복 제거 테스트)
- 게스트가 카카오톡 인앱 브라우저로 접속 → 외부 브라우저 안내가 보여야 한다 (Task 2 `isKakaoInApp` 테스트)
- 네트워크가 없어 ICE 수집이 끝나지 않음 → 3초 후 수집된 후보로 진행해야 한다 (Task 2 `waitIceComplete` 타임아웃 테스트)
- 호스트 페이지가 열려 있지 않은 방에 게스트 접속 → 20초 후 "호스트를 찾지 못함" 표시 (Task 2 수동 확인 항목)
- `#bench`나 잘못된 fragment로 접속 → 게스트 모드로 오인하지 않아야 한다 (Task 2 `parseRoom` 테스트)

---

### Task 1: 프로젝트 골격과 github.io 배포

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `.gitignore`, `.github/workflows/pages.yml`

**Interfaces:**
- Produces: `pnpm build`(타입 검사 + 빌드), `pnpm test`(Vitest, `tests/**/*.test.ts`, Node 환경), `pnpm typecheck`. `src/App.tsx`는 `location.hash`로 화면을 고른다. Task 1에서는 제목 "mxfia"만 보여준다.

- [ ] **Step 1: 골격 파일 작성**
  - `package.json`: `"type": "module"`, `"packageManager": "pnpm@11.5.1"`, scripts `dev: vite`, `build: tsc --noEmit && vite build`, `typecheck: tsc --noEmit`, `test: vitest run`
  - 의존성: `react@19.3.1 react-dom@19.3.1`, 개발 의존성: `vite@8.3.5 @vitejs/plugin-react@6.2.1 typescript@6.0.3 vitest@5.1.0 @types/react@19.3.0 @types/react-dom @types/node`
  - `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `target ES2022`, `module ESNext`, `moduleResolution bundler`, `jsx react-jsx`, `include ["src", "tests"]`
  - `vite.config.ts`: `base: '/mxfia/'`, React 플러그인, `test: { include: ['tests/**/*.test.ts'], environment: 'node', passWithNoTests: true }`
  - `.gitignore`: `node_modules`, `dist`
- [ ] **Step 2: Pages 워크플로 작성** — `.github/workflows/pages.yml`: `main` 푸시와 수동 실행에 반응한다. checkout → pnpm 설치(`packageManager` 필드 사용) → Node 22 → `pnpm install --frozen-lockfile` → `pnpm test` → `pnpm build` → `dist` 업로드 → Pages 배포. 권한은 `pages: write`, `id-token: write`. 액션은 `actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `actions/upload-pages-artifact`, `actions/deploy-pages`의 현재 최신 메이저 버전을 쓴다.
- [ ] **Step 3: 로컬 빌드 확인**

Run: `pnpm install && pnpm build`
Expected: 오류 없이 `dist/index.html` 생성, `dist/index.html` 안의 에셋 경로가 `/mxfia/`로 시작

- [ ] **Step 4: 커밋**

```bash
git add -A && git commit -m "chore: scaffold Vite React app with GitHub Pages workflow"
```

- [ ] **Step 5: GitHub 저장소 생성과 Pages 활성화 (사용자 확인 후 실행)** — 공개 저장소를 만드는 외부 작업이므로 실행 전에 사용자에게 확인받는다.

```bash
gh repo create moxieDani/mxfia --public --source=. --remote=origin --push
gh api -X POST repos/moxieDani/mxfia/pages -f build_type=workflow
gh run watch --exit-status
```

- [ ] **Step 6: 배포 확인**

Run: `curl -s -o /dev/null -w '%{http_code}' https://moxiedani.github.io/mxfia/`
Expected: `200`

---

### Task 2: 시그널링과 WebRTC 연결 시험 화면

**Files:**
- Create: `src/spike/signal.ts`, `src/spike/env.ts`, `src/spike/relayBus.ts`, `src/spike/peer.ts`, `src/spike/HostSpike.tsx`, `src/spike/GuestSpike.tsx`
- Modify: `src/App.tsx` (fragment가 `#room=`이면 `GuestSpike`, 아니면 `HostSpike`)
- Test: `tests/spike/signal.test.ts`, `tests/spike/env.test.ts`, `tests/spike/relayBus.test.ts`, `tests/spike/peer.test.ts`

**Interfaces:**
- Consumes: Task 1 골격
- Produces (`src/spike/signal.ts`):
  - `SIGNAL_KIND = 25050` (Nostr ephemeral 범위)
  - `RELAYS: string[] = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band']`
  - `ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]`
  - `type SignalMsg = { t: 'offer'; id: string; sdp: string } | { t: 'answer'; id: string; sdp: string }` (`id`는 게스트가 만든 무작위 16바이트 hex)
  - `encodeSignal(m: SignalMsg): string`, `decodeSignal(s: string): SignalMsg | null`
  - `roomTag(roomId: string): string` — `'mxfia/' + roomId`의 SHA-256 hex (64자)
  - `joinLink(pageUrl: string, roomId: string): string` → `${pageUrl}#room=${roomId}`
  - `parseRoom(hash: string): string | null` — `#room=<32자 hex>`만 인정
- Produces (`src/spike/env.ts`): `isKakaoInApp(ua: string): boolean`
- Produces (`src/spike/relayBus.ts`):
  - `interface RelayBus { publish(tag: string, content: string): Promise<{ relay: string; ok: boolean; ms: number }[]>; subscribe(tag: string, on: (content: string, relay: string) => void): () => void; close(): void }`
  - `createRelayBus(relays: string[], pool?: PoolLike): RelayBus` — nostr-tools `SimplePool` 사용. 세션마다 `generateSecretKey()`로 만든 키로 kind `SIGNAL_KIND`, 태그 `['t', tag]` 이벤트에 서명한다. 구독 콜백은 이벤트 id 기준으로 중복을 제거하고, 처음 전달한 릴레이를 함께 넘긴다. `PoolLike`는 테스트에서 가짜 풀을 넣기 위한 `SimplePool`의 `publish`/`subscribe`/`close` 부분 타입이다.
- Produces (`src/spike/peer.ts`):
  - `waitIceComplete(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void>` — `icegatheringstate`가 `complete`가 되거나 시간이 지나면 resolve
  - `createOfferPeer(): Promise<{ pc: RTCPeerConnection; dc: RTCDataChannel; sdp: string }>` — 후보를 다 모은 뒤의 SDP(non-trickle)
  - `acceptOffer(sdp: string): Promise<{ pc: RTCPeerConnection; answerSdp: string; channel: Promise<RTCDataChannel> }>`
  - `completeOffer(pc: RTCPeerConnection, answerSdp: string): Promise<void>`
  - `selectedPair(pc: RTCPeerConnection): Promise<{ local: string; remote: string; protocol: string } | null>` — `getStats()`의 선택된 candidate-pair의 `candidateType`(host/srflx/prflx/relay)
  - `startPing(dc: RTCDataChannel, onRtt: (ms: number) => void): () => void` — 1초마다 `{"ping":t}`, 받는 쪽은 `{"pong":t}`로 회신

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/spike/signal.test.ts
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
```

```ts
// tests/spike/env.test.ts
import { it, expect } from 'vitest';
import { isKakaoInApp } from '../../src/spike/env';

it('detects KakaoTalk in-app browser only', () => {
  expect(isKakaoInApp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.4.5')).toBe(true);
  expect(isKakaoInApp('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36')).toBe(false);
});
```

```ts
// tests/spike/relayBus.test.ts
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
```

```ts
// tests/spike/peer.test.ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm test`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: `signal.ts`, `env.ts`, `relayBus.ts`, `peer.ts` 구현** — `pnpm add nostr-tools@2.25.5 qrcode@1.5.4 @noble/hashes@2.4.0 && pnpm add -D @types/qrcode@1.5.6`. `roomTag`는 `@noble/hashes/sha2.js`의 `sha256`을 쓴다. 릴레이에서 실제로 받은 이벤트에서 릴레이 주소를 얻는 방법은 nostr-tools `SimplePool`의 `seenOn` 또는 구독 옵션을 확인해서 정한다. 가짜 풀 테스트는 구독 콜백에 전달되는 이벤트 id 기준의 중복 제거만 검증한다.
- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: 시험 화면 구현**
  - `HostSpike`: 처음 로드할 때 roomId(16바이트 hex)를 만들고 `joinLink(location.origin + location.pathname, roomId)`의 QR과 링크를 표시한다. `roomTag(roomId)`를 구독해서 offer를 받으면 `acceptOffer`를 실행하고 answer를 게시한다. 게스트마다 한 줄씩 id 앞 6자, offer를 전달한 릴레이, 연결 상태, `selectedPair`, RTT를 표시한다.
  - `GuestSpike`: `isKakaoInApp(navigator.userAgent)`이면 상단에 "Safari 또는 Chrome으로 열어 주세요" 배너를 띄운다. offer를 만들어 게시한 뒤 릴레이별 게시 결과(`ok`, `ms`)를 표시한다. 20초 안에 answer가 없으면 "호스트를 찾지 못함"을 표시한다. 연결되면 상태, `selectedPair`, RTT를 표시한다.
  - 두 화면 모두 화면 하단에 `navigator.userAgent`를 표시한다 (결과 기록용).
- [ ] **Step 6: 로컬 수동 확인**

Run: `pnpm dev` → 브라우저 탭 A에서 `http://localhost:5173/mxfia/` 열기 → 표시된 링크를 탭 B에서 열기
Expected: 탭 A 목록에 게스트 1줄이 생기고 상태 `connected`, RTT 숫자가 1초마다 갱신. 탭 B도 `connected`.

- [ ] **Step 7: 커밋과 배포**

```bash
git add -A && git commit -m "feat(spike): WebRTC connection test page with Nostr signaling"
git push && gh run watch --exit-status
```

---

### Task 3: 암호 속도 측정 화면

**Files:**
- Create: `src/spike/bench.ts`, `src/spike/Bench.tsx`
- Modify: `src/App.tsx` (fragment가 `#bench`이면 `Bench`)
- Test: `tests/spike/bench.test.ts`

**Interfaces:**
- Produces: `DEAL_MULTS_12 = 1750`, `benchScalarMult(iterations: number): { perMultMs: number }`, `estimateDealMs(perMultMs: number): number`
- `DEAL_MULTS_12`의 근거 (스펙 5절, 12명): 차례로 진행하는 섞기 12명 × 48회 = 576, 각 기기의 부분 해독과 증명 66, 모든 증명 검증 264개 × 4 = 1056, 키 증명 검증 등 약 50. 합계 약 1750회의 ristretto255 스칼라 곱셈.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/spike/bench.test.ts
import { it, expect } from 'vitest';
import { benchScalarMult, estimateDealMs, DEAL_MULTS_12 } from '../../src/spike/bench';

it('measures a positive per-multiplication time', () => {
  expect(benchScalarMult(20).perMultMs).toBeGreaterThan(0);
});
it('estimates deal time from the 12-player multiplication count', () => {
  expect(DEAL_MULTS_12).toBe(1750);
  expect(estimateDealMs(2)).toBe(3500);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm test tests/spike/bench.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `pnpm add @noble/curves@2.4.0`. `ristretto255.Point`(`@noble/curves/ed25519.js`)의 `multiply`를 매번 다른 무작위 스칼라와 다른 점에 대해 `iterations`회 실행하고, `performance.now()`로 평균을 잰다. `Bench` 화면에는 "측정 시작" 버튼이 있고, 300회 측정 결과로 곱셈 1회 시간, 12명 예상 시간, `navigator.userAgent`를 표시한다.
- [ ] **Step 4: 통과 확인** — Run: `pnpm test` / Expected: PASS
- [ ] **Step 5: 커밋과 배포**

```bash
git add -A && git commit -m "feat(spike): crypto benchmark page"
git push && gh run watch --exit-status
```

---

### Task 4: 실기기 시험과 결과 기록 (사용자와 함께)

**Files:**
- Create: `docs/superpowers/spikes/2026-11-05-connection-spike-results.md`

실제 폰이 필요하므로 사용자가 시험하고, 실행자는 결과를 받아 기록하고 판정한다.

- [ ] **Step 1: 결과 문서 틀 작성** — 아래 표를 만든다. 열은 `연결 성공`, `연결까지 걸린 시간`, `selectedPair (local/remote)`, `RTT`, `offer를 전달한 릴레이`, `비고`다.

| # | 호스트 | 게스트 | 네트워크 |
|---|---|---|---|
| 1 | iPhone Safari | Android Chrome | 같은 와이파이 |
| 2 | Android Chrome | iPhone Safari | 같은 와이파이 |
| 3 | iPhone Safari | iPhone + Android 3대 이상 | 같은 와이파이 |
| 4 | iPhone 핫스팟의 iPhone Safari | Android Chrome | 핫스팟 |
| 5 | Android 핫스팟의 Android Chrome | iPhone Safari | 핫스팟 |
| 6 | 아무 기기 | 카카오톡으로 받은 링크 (인앱 브라우저) | 같은 와이파이 |

그 아래에 기기별 `#bench` 결과(기기명, 곱셈 1회 ms, 12명 예상 ms) 표를 둔다.

- [ ] **Step 2: 사용자에게 시험 요청** — 시험 페이지 주소, `#bench` 주소, 위 표를 전달하고, 각 행의 화면 스크린샷이나 수치를 받는다.
- [ ] **Step 3: 결과 기록과 판정** — 결과 문서에 다음 판정을 적는다.
  - **릴레이:** 모든 시도에서 offer를 전달한 릴레이가 하나 이상 있으면 Nostr를 유지하고, 계획 C의 `RELAYS`를 실제로 전달된 릴레이로 정한다. 없으면 계획 C에서 MQTT 공용 브로커로 바꾼다.
  - **연결:** 1~3행이 성공하면 진행한다. 4~5행만 실패하면 계획 C의 안내 문구에 반영한다. 1~3행이 실패하면 중단하고 사용자와 설계를 다시 논의한다.
  - **카카오톡:** 6행이 실패하면 인앱 브라우저 안내가 필수라고 기록한다.
  - **속도:** 모든 기기의 12명 예상 시간이 10초 이내면 그대로 진행한다. 넘으면 계획 B에 최적화 작업을 추가한다 (예: 증명 일괄 검증).
- [ ] **Step 4: 커밋**

```bash
git add docs/superpowers/spikes/ && git commit -m "docs: record connection spike results"
```
