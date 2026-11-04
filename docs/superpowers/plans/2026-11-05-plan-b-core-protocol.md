# 계획 B: 프로토콜과 게임 진행 코어 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 역할 배정, 밤 행동, 승리 판정, 게임 후 검증을 순수 TypeScript로 구현하고, 가상 플레이어 6~12명으로 Node에서 한 판 전체를 자동 검증한다.

**Architecture:** `src/protocol/`은 암호 기본 연산과 각 단계의 순수 함수다. `src/engine/`은 서명된 메시지 형식, 호스트의 순번 부여(`Sequencer`), 로그를 재생하는 공개 상태 리듀서(`apply`), 각 기기의 비밀을 들고 로그에 반응하는 `PlayerAgent`, 게임 후 검증(`audit`)이다. 테스트는 메모리 안에서 Sequencer와 Agent들을 직접 연결하는 시뮬레이터(`tests/helpers/sim.ts`)로 돌린다. 실제 연결(WebRTC)과 화면은 계획 C의 몫이다.

**Tech Stack:** TypeScript 6.0.3, Vitest 5.1.0, @noble/curves 2.4.0 (`ristretto255`, `ristretto255_hasher`, `ed25519`, `x25519` — 모두 `@noble/curves/ed25519.js`), @noble/hashes 2.4.0 (`sha256` `@noble/hashes/sha2.js`, `hkdf` `@noble/hashes/hkdf.js`, `randomBytes` `@noble/hashes/utils.js`), @noble/ciphers 2.4.0 (`xchacha20poly1305` `@noble/ciphers/chacha.js`)

**Spec:** `docs/superpowers/specs/2026-11-04-mafia-no-moderator-design.md` (2, 3.3, 5, 6, 7, 8, 11.1, 11.2절)

**선행 조건:** 계획 A Task 1(프로젝트 골격)이 끝나 있어야 한다.

## Global Constraints

- `src/protocol/`, `src/engine/`은 DOM과 브라우저 전용 API를 쓰지 않는다 (Node와 브라우저 공용). 난수는 `@noble/hashes/utils.js`의 `randomBytes`만 쓴다
- 군: ristretto255. hash-to-curve DST `'mxfia-v1-h2c'`, Fiat–Shamir DST `'mxfia-v1-fs'`
- 증명 문맥 문자열 (정확히 이 형식):
  - 키 증명 `key/${gameId}/${seat}`
  - 배분 부분 해독 `deal/${gameId}/${card}/${'a'|'b'}/${seat}`
  - 경찰 응답 `query/${gameId}/${night}/${seat}`
- 쌍별 키 info: `mxfia/${stage}/${gameId}/${night}/${from}->${to}` (`stage`는 `'act'` 또는 `'resp'`). 마피아 키 info: `mxfia/mafia/${gameId}`. 개인 블롭 키 info: `mxfia/self/${gameId}`. 동점 처리 info: `tie/${night}`
- 고정 크기: `BLOB_SIZE = 32`, `ACTION_SIZE = 16`, `RESPONSE_SIZE = 160`. 봉인 결과 = nonce 24 + size + 태그 16 바이트
- 인원 구성: 6~8명 마피아 2, 9~12명 마피아 3, 경찰 1, 의사 1, 나머지 시민. 덱 순서는 `['citizen','doctor','mafia','police']` 순
- `DEFAULT_CONFIG = { discussionSec: 180, nightSec: 30, voteSec: 30 }`
- 메시지: `env.json = JSON.stringify(body)`, 서명은 `utf8(env.json)`에 대한 Ed25519
- 로그 해시: `genesisHash = toB64(sha256(utf8('mxfia/log/' + gameId)))`, `nextHash(prev, e) = toB64(sha256(concat(fromB64(prev), utf8(JSON.stringify([e.seq, e.env.from, e.env.json, e.env.sig])))))`
- 스펙 변경 반영: 마피아가 아닌 기기의 밤 블롭은 무작위 바이트 대신 개인 블롭 키로 봉인한다 (겉보기 동일, 게임 후 시민의 "의심 가는 사람"을 복원하기 위해)

## Review Focus

- 경찰·의사·마피아가 죽은 뒤에도 그 기기가 모든 단계 메시지를 보내야 게임이 멈추지 않는다 (Task 11 "역할자가 죽어도 진행" 테스트)
- 의사가 정확히 처형 대상을 지키거나 자기 자신을 지킨 경우 아무도 죽지 않아야 한다 (Task 11 테스트 2개)
- 경찰이 그날 밤 처형된 사람을 조사해도 결과를 받아야 한다 (Task 11 테스트)
- 죽은 사람에게 한 투표, 죽은 사람이 한 투표는 무시해야 한다 (Task 9 `tally` 테스트)
- 재접속 후 다시 보낸 중복 메시지는 경고 없이 무시해야 한다 (Task 13 테스트)

---

### Task 1: 공용 타입과 바이트 유틸

**Files:**
- Create: `src/protocol/types.ts`, `src/protocol/bytes.ts`
- Test: `tests/protocol/bytes.test.ts`

**Interfaces:**
- Produces (`types.ts`): `type Seat = number`, `type B64 = string`, `type Role = 'citizen' | 'doctor' | 'mafia' | 'police'`
- Produces (`bytes.ts`): `utf8(s: string): Uint8Array`, `concat(...parts: Uint8Array[]): Uint8Array`, `toB64(b: Uint8Array): B64` (base64url, 패딩 없음), `fromB64(s: B64): Uint8Array` (잘못된 문자열이면 throw), `equalBytes(a, b): boolean`, `u16(n: number): Uint8Array` (빅엔디언 2바이트)

- [ ] **Step 1: 의존성 추가와 실패하는 테스트 작성** — `pnpm add @noble/curves@2.4.0 @noble/hashes@2.4.0 @noble/ciphers@2.4.0`

```ts
// tests/protocol/bytes.test.ts
import { describe, it, expect } from 'vitest';
import { utf8, concat, toB64, fromB64, equalBytes, u16 } from '../../src/protocol/bytes';

describe('bytes', () => {
  it('base64url round trip without padding', () => {
    const b = new Uint8Array([0, 255, 251, 1, 2]);
    const s = toB64(b);
    expect(s).not.toMatch(/[+/=]/);
    expect(fromB64(s)).toEqual(b);
  });
  it('concat and equality', () => {
    expect(concat(utf8('ab'), utf8('c'))).toEqual(utf8('abc'));
    expect(equalBytes(utf8('x'), utf8('x'))).toBe(true);
    expect(equalBytes(utf8('x'), utf8('y'))).toBe(false);
  });
  it('u16 is big-endian', () => expect(u16(258)).toEqual(new Uint8Array([1, 2])));
  it('fromB64 rejects invalid input', () => expect(() => fromB64('***')).toThrow());
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm test tests/protocol/bytes.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현** — `toB64`/`fromB64`는 `btoa`/`atob`(Node 22와 브라우저 공통)으로 구현하고 `+/`↔`-_` 치환, `=` 제거·복원.
- [ ] **Step 4: 통과 확인** — Run: `pnpm test tests/protocol/bytes.test.ts` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): byte and base64url utilities"`

---

### Task 2: 군 연산과 ElGamal

**Files:**
- Create: `src/protocol/group.ts`, `src/protocol/elgamal.ts`
- Test: `tests/protocol/group.test.ts`, `tests/protocol/elgamal.test.ts`

**Interfaces:**
- Produces (`group.ts`):
  - `Point` (값: `ristretto255.Point`, 타입: 그 인스턴스 타입), `G: Point`, `O: Point`, `ORDER: bigint`
  - `randomScalar(): bigint` — `[1, ORDER)` 균등. 64바이트 난수를 ORDER로 줄이고 0이면 다시 뽑는다
  - `mul(p: Point, k: bigint): Point` — `k mod ORDER`가 0이면 `O` (noble의 `multiply`는 0에서 throw하므로)
  - `hashToPoint(label: string): Point` — `ristretto255_hasher.hashToCurve(utf8(label), { DST: 'mxfia-v1-h2c' })`
  - `challenge(...parts: (Uint8Array | Point | string)[]): bigint` — 각 부분을 바이트로 바꿔 `u16(길이) ‖ 바이트`로 이어 붙인 뒤 `ristretto255_hasher.hashToScalar(…, { DST: 'mxfia-v1-fs' })`
  - `ptToB64(p: Point): B64`, `ptFromB64(s: B64): Point`, `scToB64(k: bigint): B64`, `scFromB64(s: B64): bigint` (스칼라는 `Point.Fn.toBytes`/`fromBytes` 32바이트)
- Produces (`elgamal.ts`):
  - `interface Ct { c1: Point; c2: Point }`, `interface CtJson { c1: B64; c2: B64 }`
  - `trivial(M: Point): Ct` = `(O, M)`
  - `encrypt(pk: Point, M: Point, r: bigint): Ct` = `(r·G, M + r·pk)`
  - `reencrypt(pk: Point, ct: Ct, rho: bigint): Ct` = `(c1 + ρ·G, c2 + ρ·pk)`
  - `addCt(a: Ct, b: Ct): Ct`, `partial(x: bigint, ct: Ct): Point` = `x·c1`, `open(ct: Ct, partials: Point[]): Point` = `c2 − Σ partials`
  - `ctToJson`, `ctFromJson`, `ctBytes(ct: Ct): Uint8Array` (c1‖c2, 64바이트)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/protocol/group.test.ts
import { it, expect } from 'vitest';
import { G, O, ORDER, randomScalar, mul, hashToPoint, challenge, ptToB64, ptFromB64, scToB64, scFromB64 } from '../../src/protocol/group';

it('randomScalar stays in [1, ORDER)', () => {
  for (let i = 0; i < 50; i++) { const k = randomScalar(); expect(k > 0n && k < ORDER).toBe(true); }
});
it('mul by zero is the identity', () => expect(mul(G, 0n).equals(O)).toBe(true));
it('hashToPoint is deterministic and label-specific', () => {
  expect(hashToPoint('a').equals(hashToPoint('a'))).toBe(true);
  expect(hashToPoint('a').equals(hashToPoint('b'))).toBe(false);
});
it('point and scalar base64 round trips', () => {
  const k = randomScalar();
  expect(scFromB64(scToB64(k))).toBe(k);
  expect(ptFromB64(ptToB64(mul(G, k))).equals(mul(G, k))).toBe(true);
});
it('challenge is unambiguous across part boundaries', () => {
  expect(challenge('ab', 'c')).not.toBe(challenge('a', 'bc'));
});
```

```ts
// tests/protocol/elgamal.test.ts
import { it, expect } from 'vitest';
import { G, randomScalar, mul, hashToPoint } from '../../src/protocol/group';
import { encrypt, reencrypt, addCt, partial, open, trivial, ctToJson, ctFromJson } from '../../src/protocol/elgamal';

const x1 = randomScalar(), x2 = randomScalar();
const pk = mul(G, x1).add(mul(G, x2));
const M = hashToPoint('m');
const both = (ct: ReturnType<typeof encrypt>) => open(ct, [partial(x1, ct), partial(x2, ct)]);

it('two-party decryption recovers the plaintext', () => expect(both(encrypt(pk, M, randomScalar())).equals(M)).toBe(true));
it('re-encryption keeps the plaintext and changes c1', () => {
  const ct = encrypt(pk, M, randomScalar());
  const re = reencrypt(pk, ct, randomScalar());
  expect(both(re).equals(M)).toBe(true);
  expect(re.c1.equals(ct.c1)).toBe(false);
});
it('ciphertexts add homomorphically', () => {
  const M2 = hashToPoint('m2');
  expect(both(addCt(encrypt(pk, M, randomScalar()), encrypt(pk, M2, randomScalar()))).equals(M.add(M2))).toBe(true);
});
it('trivial encryption opens without partials', () => expect(open(trivial(M), []).equals(M)).toBe(true));
it('json round trip', () => {
  const ct = encrypt(pk, M, randomScalar());
  const back = ctFromJson(ctToJson(ct));
  expect(back.c1.equals(ct.c1) && back.c2.equals(ct.c2)).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm test tests/protocol` / Expected: FAIL
- [ ] **Step 3: `group.ts`, `elgamal.ts` 구현**
- [ ] **Step 4: 통과 확인** — Run: `pnpm test tests/protocol` / Expected: PASS
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): ristretto255 helpers and ElGamal"`

---

### Task 3: 지식 증명과 부분 해독 증명

**Files:**
- Create: `src/protocol/proofs.ts`
- Test: `tests/protocol/proofs.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `interface KeyProof { t: B64; z: B64 }`, `proveKey(x: bigint, ctx: string): KeyProof`, `verifyKey(X: Point, p: KeyProof, ctx: string): boolean` — Schnorr: `t = k·G`, `c = challenge(ctx, X, t)`, `z = k + c·x`, 검증 `z·G == t + c·X`
  - `interface DleqProof { a: B64; b: B64; z: B64 }`, `interface Partial { d: B64; proof: DleqProof }`
  - `provePartial(x: bigint, ct: Ct, ctx: string): Partial` — `d = x·c1`, Chaum–Pedersen: `a = k·G`, `b = k·c1`, `c = challenge(ctx, X, c1, d, a, b)` (`X = x·G`), `z = k + c·x`
  - `verifyPartial(X: Point, ct: Ct, p: Partial, ctx: string): boolean` — `z·G == a + c·X` 그리고 `z·c1 == b + c·d`. 형식이 잘못되면 throw하지 않고 false
  - `partialToBytes(p: Partial): Uint8Array` (d‖a‖b‖z, 128바이트), `partialFromBytes(b: Uint8Array): Partial`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/protocol/proofs.test.ts
import { it, expect } from 'vitest';
import { G, randomScalar, mul, hashToPoint, ptToB64, ptFromB64 } from '../../src/protocol/group';
import { encrypt, partial } from '../../src/protocol/elgamal';
import { proveKey, verifyKey, provePartial, verifyPartial, partialToBytes, partialFromBytes } from '../../src/protocol/proofs';

const x = randomScalar(), X = mul(G, x);

it('key proof verifies only for the same key and context', () => {
  const p = proveKey(x, 'key/g/1');
  expect(verifyKey(X, p, 'key/g/1')).toBe(true);
  expect(verifyKey(X, p, 'key/g/2')).toBe(false);
  expect(verifyKey(mul(G, randomScalar()), p, 'key/g/1')).toBe(false);
});
it('partial proof verifies and matches x·c1', () => {
  const ct = encrypt(X, hashToPoint('m'), randomScalar());
  const p = provePartial(x, ct, 'c');
  expect(verifyPartial(X, ct, p, 'c')).toBe(true);
  expect(ptFromB64(p.d).equals(partial(x, ct))).toBe(true);
  expect(verifyPartial(X, ct, { ...p, d: ptToB64(mul(G, 5n)) }, 'c')).toBe(false);
  expect(verifyPartial(X, ct, p, 'other')).toBe(false);
  expect(verifyPartial(X, ct, { ...p, d: 'garbage' }, 'c')).toBe(false);
});
it('partial binary encoding is 128 bytes and round-trips', () => {
  const p = provePartial(x, encrypt(X, hashToPoint('m'), randomScalar()), 'c');
  const b = partialToBytes(p);
  expect(b.length).toBe(128);
  expect(partialFromBytes(b)).toEqual(p);
});
```

- [ ] **Step 2: 실패 확인** — Run: `pnpm test tests/protocol/proofs.test.ts` / Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): Schnorr and Chaum-Pedersen proofs"`

---

### Task 4: 서명과 쌍별 암호 채널

**Files:**
- Create: `src/protocol/sign.ts`, `src/protocol/channel.ts`
- Test: `tests/protocol/channel.test.ts`

**Interfaces:**
- Produces (`sign.ts`): `interface SignKeys { sk: Uint8Array; pk: Uint8Array }`, `newSignKeys(): SignKeys`, `sign(sk: Uint8Array, msg: string): B64`, `verify(pk: Uint8Array, msg: string, sig: B64): boolean` (형식 오류도 false)
- Produces (`channel.ts`):
  - `interface DhKeys { sk: Uint8Array; pk: Uint8Array }`, `newDhKeys(): DhKeys`, `dhPublic(sk: Uint8Array): Uint8Array`
  - `pairKey(mySk: Uint8Array, theirPk: Uint8Array, info: string): Uint8Array` — `hkdf(sha256, x25519.getSharedSecret(mySk, theirPk), undefined, utf8(info), 32)`
  - `deriveKey(secret: Uint8Array, info: string): Uint8Array` — `hkdf(sha256, secret, undefined, utf8(info), 32)`
  - `sealedLength(size: number): number` = `24 + size + 16`
  - `sealFixed(key: Uint8Array, pt: Uint8Array, size: number): B64` — 평문을 `u16(길이) ‖ pt ‖ 0…`으로 `size`바이트로 채워 XChaCha20-Poly1305로 봉인, 결과는 `nonce ‖ 암호문`. `pt.length > size − 2`이면 throw
  - `openFixed(key: Uint8Array, box: B64, size: number): Uint8Array | null` — 실패하면 null

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/protocol/channel.test.ts
import { it, expect } from 'vitest';
import { utf8, fromB64 } from '../../src/protocol/bytes';
import { newSignKeys, sign, verify } from '../../src/protocol/sign';
import { newDhKeys, pairKey, sealFixed, openFixed, sealedLength } from '../../src/protocol/channel';

it('signatures verify only for the exact message', () => {
  const k = newSignKeys();
  const sig = sign(k.sk, 'hello');
  expect(verify(k.pk, 'hello', sig)).toBe(true);
  expect(verify(k.pk, 'hellO', sig)).toBe(false);
  expect(verify(k.pk, 'hello', 'garbage')).toBe(false);
});
it('pair keys are symmetric and info-bound', () => {
  const a = newDhKeys(), b = newDhKeys();
  expect(pairKey(a.sk, b.pk, 'i')).toEqual(pairKey(b.sk, a.pk, 'i'));
  expect(pairKey(a.sk, b.pk, 'i')).not.toEqual(pairKey(a.sk, b.pk, 'j'));
});
it('fixed-size sealing hides plaintext length', () => {
  const key = pairKey(newDhKeys().sk, newDhKeys().pk, 'i');
  const short = sealFixed(key, utf8('hi'), 32);
  const long = sealFixed(key, new Uint8Array(30), 32);
  expect(fromB64(short).length).toBe(sealedLength(32));
  expect(fromB64(long).length).toBe(sealedLength(32));
  expect(openFixed(key, short, 32)).toEqual(utf8('hi'));
  expect(openFixed(pairKey(newDhKeys().sk, newDhKeys().pk, 'i'), short, 32)).toBeNull();
  expect(() => sealFixed(key, new Uint8Array(31), 32)).toThrow();
});
```

- [ ] **Step 2: 실패 확인** — Expected: FAIL
- [ ] **Step 3: 구현**
- [ ] **Step 4: 통과 확인** — Expected: PASS
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): signatures and fixed-size pairwise channel"`

---

### Task 5: 역할 구성

**Files:**
- Create: `src/protocol/roles.ts`
- Test: `tests/protocol/roles.test.ts`

**Interfaces:**
- Produces: `ROLE_ORDER: Role[] = ['citizen','doctor','mafia','police']`, `composition(n: number): Role[]` (ROLE_ORDER 순, 6~12 밖이면 `RangeError`), `rolePoint(role: Role): Point` = `hashToPoint('mxfia/role/' + role)`, `roleFromPoint(M: Point): Role | null`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/protocol/roles.test.ts
import { it, expect } from 'vitest';
import { composition, rolePoint, roleFromPoint, ROLE_ORDER } from '../../src/protocol/roles';
import { hashToPoint } from '../../src/protocol/group';

const count = (n: number, r: string) => composition(n).filter((x) => x === r).length;

it('matches the spec table', () => {
  expect(composition(6)).toEqual(['citizen', 'citizen', 'doctor', 'mafia', 'mafia', 'police']);
  expect(count(8, 'mafia')).toBe(2);
  expect(composition(9)).toEqual(['citizen', 'citizen', 'citizen', 'citizen', 'doctor', 'mafia', 'mafia', 'mafia', 'police']);
  expect(count(12, 'citizen')).toBe(7);
  for (let n = 6; n <= 12; n++) { expect(composition(n)).toHaveLength(n); expect(count(n, 'police')).toBe(1); expect(count(n, 'doctor')).toBe(1); }
});
it('rejects out-of-range player counts', () => {
  expect(() => composition(5)).toThrow(RangeError);
  expect(() => composition(13)).toThrow(RangeError);
});
it('role points round-trip and unknown points map to null', () => {
  for (const r of ROLE_ORDER) expect(roleFromPoint(rolePoint(r))).toBe(r);
  expect(roleFromPoint(hashToPoint('x'))).toBeNull();
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/protocol/roles.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): role composition and role points"`

---

### Task 6: 역할 배정 (마피아 비밀, 덱, 섞기, 나눠주기)

**Files:**
- Create: `src/protocol/deal.ts`
- Test: `tests/protocol/deal.test.ts`

**Interfaces:**
- Consumes: Task 2~5
- Produces:
  - `jointKey(Xs: Point[]): Point` (합)
  - `interface MafiaContribution { s: bigint; r: bigint; E: Ct; commit: B64 }`, `contribute(pk: Point): MafiaContribution` (`E = encrypt(pk, s·G, r)`), `commitOf(E: Ct): B64` = `toB64(sha256(ctBytes(E)))`, `checkContribution(pk: Point, E: Ct, s: bigint, r: bigint): boolean`
  - `interface Card { a: Ct; b: Ct }`, `interface CardJson { a: CtJson; b: CtJson }`, `cardToJson`, `cardFromJson`
  - `buildDeck(roles: Role[], ES: Ct): Card[]` — `a = trivial(rolePoint(role))`, `b = role === 'mafia' ? ES : trivial(O)`
  - `interface ShuffleSecret { perm: number[]; rho: [bigint, bigint][] }`, `randomShuffle(n: number): ShuffleSecret` (Fisher–Yates, `randomBytes` 기반), `applyShuffle(pk: Point, deck: Card[], sec: ShuffleSecret): Card[]` — `out[i] = { a: reencrypt(pk, deck[perm[i]].a, rho[i][0]), b: reencrypt(pk, deck[perm[i]].b, rho[i][1]) }`
  - `interface CardPartials { card: number; a: Partial; b: Partial }`, `makePartials(x: bigint, deck: Card[], mySeat: Seat, gameId: string): CardPartials[]` (자기 카드 제외, card 오름차순), `checkPartials(X: Point, deck: Card[], seat: Seat, ps: CardPartials[], gameId: string): boolean` (자기 카드를 뺀 모든 카드를 정확히 한 번씩 덮고 증명이 모두 맞아야 true)
  - `interface OpenedCard { role: Role; S: Point | null }`, `openOwnCard(x: bigint, card: Card, othersA: Point[], othersB: Point[]): OpenedCard` (역할 점이 아니면 throw, 비밀 칸이 `O`이면 `S = null`)
  - `mafiaKey(S: Point, gameId: string): Uint8Array` = `deriveKey(S.toBytes(), 'mxfia/mafia/' + gameId)`

- [ ] **Step 1: 실패하는 테스트 작성** — 테스트 파일 안의 `runDeal`이 N명 전체 흐름을 순수 함수로 재현한다.

```ts
// tests/protocol/deal.test.ts
import { describe, it, expect } from 'vitest';
import { G, randomScalar, mul, ptFromB64 } from '../../src/protocol/group';
import { addCt } from '../../src/protocol/elgamal';
import { composition } from '../../src/protocol/roles';
import { jointKey, contribute, commitOf, checkContribution, buildDeck, randomShuffle, applyShuffle,
  makePartials, checkPartials, openOwnCard, mafiaKey, cardToJson } from '../../src/protocol/deal';

const gid = 'g1';
function runDeal(n: number) {
  const xs = Array.from({ length: n }, () => randomScalar());
  const Xs = xs.map((x) => mul(G, x));
  const pk = jointKey(Xs);
  const contribs = xs.map(() => contribute(pk));
  const ES = contribs.map((c) => c.E).reduce(addCt);
  let deck = buildDeck(composition(n), ES);
  for (let i = 0; i < n; i++) deck = applyShuffle(pk, deck, randomShuffle(n));
  const parts = xs.map((x, i) => makePartials(x, deck, i, gid));
  const opened = xs.map((x, j) => {
    const others = parts.flatMap((ps, i) => (i === j ? [] : ps.filter((p) => p.card === j)));
    return openOwnCard(x, deck[j]!, others.map((p) => ptFromB64(p.a.d)), others.map((p) => ptFromB64(p.b.d)));
  });
  return { xs, Xs, pk, contribs, deck, parts, opened };
}

describe('deal', () => {
  it.each([6, 9, 12])('deals the composition to %i players and shares S among mafia only', (n) => {
    const { opened } = runDeal(n);
    expect(opened.map((o) => o.role).sort()).toEqual([...composition(n)].sort());
    const mafia = opened.filter((o) => o.role === 'mafia');
    expect(mafia.every((o) => o.S !== null && o.S.equals(mafia[0]!.S!))).toBe(true);
    expect(opened.filter((o) => o.role !== 'mafia').every((o) => o.S === null)).toBe(true);
  });
  it('checks contributions against commit and secrets', () => {
    const pk = mul(G, randomScalar());
    const c = contribute(pk);
    expect(commitOf(c.E)).toBe(c.commit);
    expect(checkContribution(pk, c.E, c.s, c.r)).toBe(true);
    expect(checkContribution(pk, c.E, c.s + 1n, c.r)).toBe(false);
  });
  it('applyShuffle is reproducible and re-randomizes every card', () => {
    const { pk, deck } = runDeal(6);
    const sec = randomShuffle(6);
    const a = applyShuffle(pk, deck, sec), b = applyShuffle(pk, deck, sec);
    expect(a.map(cardToJson)).toEqual(b.map(cardToJson));
    const before = new Set(deck.map((c) => JSON.stringify(cardToJson(c))));
    expect(a.some((c) => before.has(JSON.stringify(cardToJson(c))))).toBe(false);
  });
  it('checkPartials rejects tampered or incomplete sets', () => {
    const { Xs, deck, parts } = runDeal(6);
    expect(checkPartials(Xs[1]!, deck, 1, parts[1]!, gid)).toBe(true);
    expect(checkPartials(Xs[1]!, deck, 1, parts[1]!.slice(1), gid)).toBe(false);
    const bad = parts[1]!.map((p, i) => (i === 0 ? { ...p, a: parts[2]![0]!.a } : p));
    expect(checkPartials(Xs[1]!, deck, 1, bad, gid)).toBe(false);
  });
  it('mafiaKey is 32 bytes and game-bound', () => {
    const S = mul(G, randomScalar());
    expect(mafiaKey(S, 'g1')).toHaveLength(32);
    expect(mafiaKey(S, 'g1')).not.toEqual(mafiaKey(S, 'g2'));
  });
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/protocol/deal.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): ElGamal mental-poker role dealing"`

---

### Task 7: 밤 행동과 승리 판정 함수

**Files:**
- Create: `src/protocol/night.ts`, `src/protocol/win.ts`
- Test: `tests/protocol/night.test.ts`

**Interfaces:**
- Consumes: Task 3~6
- Produces (`night.ts`):
  - `BLOB_SIZE = 32`, `ACTION_SIZE = 16`, `RESPONSE_SIZE = 160`
  - `interface BlobPayload { seat: Seat; night: number; tick: number; pick: Seat | null; final: boolean }` — 바이너리: seat 1, night 1, tick 2, pick 1(255 = 없음), final 1
  - `sealBlob(key: Uint8Array, p: BlobPayload): B64`, `openBlob(key: Uint8Array, box: B64): BlobPayload | null`
  - `selfBlobKey(dhSk: Uint8Array, gameId: string): Uint8Array` = `deriveKey(dhSk, 'mxfia/self/' + gameId)`
  - `killTarget(picks: (Seat | null)[], k: Uint8Array, night: number): Seat | null` — null 제외 최다 득표. 동점이면 후보를 오름차순 정렬하고 `deriveKey(k, 'tie/' + night)`의 앞 4바이트(빅엔디언) mod 후보 수 번째. 표가 없으면 null
  - `mafiaLeader(mafia: Seat[], alive: ReadonlySet<Seat>): Seat | null` — 살아 있는 마피아 중 최소 좌석
  - `type Action = 'none' | 'kill' | 'save' | 'query'`, `actionInfo(gameId: string, night: number, from: Seat, to: Seat, stage: 'act' | 'resp'): string`
  - `sealAction(key, night: number, a: Action): B64`, `openAction(key, box: B64, night: number): Action | null` (밤 번호가 다르면 null)
  - `sealResponse(key, night: number, p: Partial | null): B64`, `openResponse(key, box: B64, night: number): Partial | 'none' | null`
  - `fate(received: Action[], selfSaved: boolean): 'alive' | 'dead'` — `kill`을 받았고 `save`도 `selfSaved`도 없으면 `dead`
  - `investigate(cardA: Ct, otherPartials: Point[], d: Point): Role` — 역할 칸을 열어 역할 반환 (모르는 점이면 throw)
- Produces (`win.ts`): `type Verdict = 'continue' | 'endCitizen' | 'endMafia'`, `verdictFor(mafia: Seat[], alive: ReadonlySet<Seat>): Verdict` — 살아 있는 마피아 0이면 `endCitizen`, 살아 있는 마피아 수 ≥ 나머지 생존자 수면 `endMafia`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/protocol/night.test.ts
import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils.js';
import { fromB64 } from '../../src/protocol/bytes';
import { G, randomScalar, mul } from '../../src/protocol/group';
import { encrypt, partial } from '../../src/protocol/elgamal';
import { provePartial } from '../../src/protocol/proofs';
import { rolePoint } from '../../src/protocol/roles';
import { sealBlob, openBlob, killTarget, mafiaLeader, sealAction, openAction, sealResponse, openResponse,
  fate, investigate } from '../../src/protocol/night';
import { verdictFor } from '../../src/protocol/win';

const k = randomBytes(32);
const p = { seat: 3, night: 1, tick: 5, pick: 2, final: false };

describe('blobs', () => {
  it('open only with the sealing key; all blobs have equal length', () => {
    expect(openBlob(k, sealBlob(k, p))).toEqual(p);
    expect(openBlob(k, sealBlob(k, { ...p, pick: null, final: true }))).toEqual({ ...p, pick: null, final: true });
    expect(openBlob(randomBytes(32), sealBlob(k, p))).toBeNull();
    expect(fromB64(sealBlob(randomBytes(32), p)).length).toBe(fromB64(sealBlob(k, p)).length);
  });
});
describe('kill target and leader', () => {
  it('majority, single, none', () => {
    expect(killTarget([4, 4, 5], k, 1)).toBe(4);
    expect(killTarget([4, null], k, 1)).toBe(4);
    expect(killTarget([null, null], k, 1)).toBeNull();
  });
  it('tie-break is deterministic and order-independent', () => {
    const t = killTarget([4, 5], k, 1);
    expect([4, 5]).toContain(t);
    expect(killTarget([5, 4], k, 1)).toBe(t);
  });
  it('leader is the lowest living mafia', () => {
    expect(mafiaLeader([5, 2, 7], new Set([5, 7, 1]))).toBe(5);
    expect(mafiaLeader([2], new Set([1]))).toBeNull();
  });
});
describe('actions and responses', () => {
  it('actions round-trip, bind the night, and have equal length', () => {
    expect(openAction(k, sealAction(k, 2, 'kill'), 2)).toBe('kill');
    expect(openAction(k, sealAction(k, 2, 'kill'), 3)).toBeNull();
    expect(fromB64(sealAction(k, 2, 'none')).length).toBe(fromB64(sealAction(k, 2, 'query')).length);
  });
  it('responses carry a partial or none with equal length', () => {
    const x = randomScalar();
    const pr = provePartial(x, encrypt(mul(G, x), rolePoint('mafia'), randomScalar()), 'c');
    expect(openResponse(k, sealResponse(k, 1, pr), 1)).toEqual(pr);
    expect(openResponse(k, sealResponse(k, 1, null), 1)).toBe('none');
    expect(fromB64(sealResponse(k, 1, pr)).length).toBe(fromB64(sealResponse(k, 1, null)).length);
  });
  it('fate', () => {
    expect(fate(['kill'], false)).toBe('dead');
    expect(fate(['kill', 'save'], false)).toBe('alive');
    expect(fate(['kill'], true)).toBe('alive');
    expect(fate(['none', 'query'], false)).toBe('alive');
  });
  it('investigate opens the role half of a card', () => {
    const x1 = randomScalar(), x2 = randomScalar();
    const cardA = encrypt(mul(G, x1).add(mul(G, x2)), rolePoint('mafia'), randomScalar());
    expect(investigate(cardA, [partial(x1, cardA)], partial(x2, cardA))).toBe('mafia');
  });
});
describe('verdict', () => {
  it('boundaries', () => {
    expect(verdictFor([1, 2], new Set([0, 1, 2, 3, 4]))).toBe('continue');
    expect(verdictFor([1, 2], new Set([1, 2, 3, 4]))).toBe('endMafia');
    expect(verdictFor([1, 2], new Set([0, 3, 4]))).toBe('endCitizen');
    expect(verdictFor([1], new Set([1, 3]))).toBe('endMafia');
  });
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/protocol/night.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(protocol): night actions and win verdict"`

---

### Task 8: 메시지 형식과 호스트 순번 부여

**Files:**
- Create: `src/engine/messages.ts`, `src/engine/log.ts`, `tests/helpers/roster.ts`
- Test: `tests/engine/log.test.ts`

**Interfaces:**
- Consumes: Task 1, 4, 6, 7
- Produces (`messages.ts`):
  - `interface Config { discussionSec: number; nightSec: number; voteSec: number }`, `DEFAULT_CONFIG`
  - `interface RosterEntry { seat: Seat; name: string; signPk: B64; dhPk: B64 }`, `interface Roster { gameId: string; players: RosterEntry[] }` (seat = 배열 인덱스, 0번이 호스트)
  - `type TimerPhase = 'nightSelect' | 'discussion' | 'vote' | 'reveal'`
  - `type Body` (판별 필드 `k`):
    - 호스트 전용: `{ k: 'start'; config: Config }`, `{ k: 'timerEnd'; phase: TimerPhase }`, `{ k: 'forceEnd' }`
    - `{ k: 'keygen'; X: B64; proof: KeyProof }`, `{ k: 'mafiaCommit'; commit: B64 }`, `{ k: 'mafiaReveal'; E: CtJson }`
    - `{ k: 'shuffle'; deck: CardJson[] }`, `{ k: 'partials'; items: CardPartials[] }`
    - `{ k: 'blob'; night: number; box: B64 }`, `{ k: 'actions'; night: number; boxes: B64[] }`, `{ k: 'responses'; night: number; boxes: B64[] }` (`boxes[i]`는 좌석 i에게 가는 봉인, 자기 자리는 `''`)
    - `{ k: 'dawn'; night: number; status: 'alive' | 'dead'; logHash: B64 }` (이미 죽은 좌석은 `'dead'`)
    - `{ k: 'verdict'; cp: string; v: Verdict; logHash: B64 }` (`cp`는 `dawn-${n}` 또는 `exec-${day}`)
    - `{ k: 'vote'; day: number; target: Seat | null }`
    - `{ k: 'reveal'; x: B64; s: B64; r: B64; perm: number[]; rho: [B64, B64][]; dhSk: B64 }`
  - `HOST_KINDS = ['start', 'timerEnd', 'forceEnd']`
  - `interface Envelope { from: Seat; json: string; sig: B64 }`, `interface LogEntry { seq: number; env: Envelope }`
  - `seal(from: Seat, sk: Uint8Array, body: Body): Envelope`
  - `parse(env: Envelope, roster: Roster): Body | null` — 좌석이 명단에 없거나, 서명이 틀리거나, JSON이 잘못되거나, 호스트 전용 종류를 0번이 아닌 좌석이 보냈으면 null
- Produces (`log.ts`):
  - `genesisHash(gameId: string): B64`, `nextHash(prev: B64, e: LogEntry): B64` (Global Constraints 정의)
  - `class Sequencer { constructor(roster: Roster, hostSk: Uint8Array); submit(env: Envelope): LogEntry | null; host(body: Body): LogEntry; since(seq: number): LogEntry[]; readonly entries: readonly LogEntry[] }` — seq는 0부터. `submit`은 `parse`가 null이면 거절. `host`는 0번 좌석으로 서명. `since(s)`는 `seq > s`인 항목
- Produces (`tests/helpers/roster.ts`): `makeRoster(n: number): { roster: Roster; keys: { sign: SignKeys; dh: DhKeys }[] }` (gameId `'g-test'`, 이름 `P${seat}`)

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/log.test.ts
import { it, expect } from 'vitest';
import { makeRoster } from '../helpers/roster';
import { seal, parse, DEFAULT_CONFIG } from '../../src/engine/messages';
import { Sequencer, genesisHash, nextHash } from '../../src/engine/log';

const { roster, keys } = makeRoster(6);

it('parse verifies signer, signature, and host-only kinds', () => {
  const env = seal(1, keys[1]!.sign.sk, { k: 'vote', day: 1, target: 2 });
  expect(parse(env, roster)).toEqual({ k: 'vote', day: 1, target: 2 });
  expect(parse({ ...env, json: env.json.replace('2', '3') }, roster)).toBeNull();
  expect(parse({ ...env, from: 7 }, roster)).toBeNull();
  expect(parse(seal(1, keys[1]!.sign.sk, { k: 'forceEnd' }), roster)).toBeNull();
  expect(parse(seal(0, keys[0]!.sign.sk, { k: 'forceEnd' }), roster)).toEqual({ k: 'forceEnd' });
});
it('sequencer numbers entries and rejects bad envelopes', () => {
  const s = new Sequencer(roster, keys[0]!.sign.sk);
  expect(s.host({ k: 'start', config: DEFAULT_CONFIG }).seq).toBe(0);
  expect(s.submit(seal(2, keys[2]!.sign.sk, { k: 'vote', day: 1, target: null }))!.seq).toBe(1);
  expect(s.submit(seal(2, keys[3]!.sign.sk, { k: 'vote', day: 1, target: null }))).toBeNull();
  expect(s.entries).toHaveLength(2);
  expect(s.since(0).map((e) => e.seq)).toEqual([1]);
});
it('hash chain is deterministic and game-bound', () => {
  const s = new Sequencer(roster, keys[0]!.sign.sk);
  const e = s.host({ k: 'start', config: DEFAULT_CONFIG });
  expect(nextHash(genesisHash('g-test'), e)).toBe(nextHash(genesisHash('g-test'), e));
  expect(genesisHash('a')).not.toBe(genesisHash('b'));
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/log.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(engine): signed messages and host sequencer"`

---

### Task 9: 공개 상태 리듀서

**Files:**
- Create: `src/engine/state.ts`
- Test: `tests/engine/state.test.ts`

**Interfaces:**
- Consumes: Task 5~8
- Produces:
  - `type Winner = 'citizen' | 'mafia' | 'conflict' | 'forced'`
  - `type Phase = { k: 'lobby' } | { k: 'keygen' } | { k: 'mafiaCommit' } | { k: 'mafiaReveal' } | { k: 'shuffle'; turn: Seat } | { k: 'deal' } | { k: 'nightSelect'; night: number } | { k: 'nightFinal'; night: number } | { k: 'nightActions'; night: number } | { k: 'nightResponses'; night: number } | { k: 'dawn'; night: number } | { k: 'verdict'; cp: string; day: number; next: 'discussion' | 'night' } | { k: 'discussion'; day: number } | { k: 'vote'; day: number } | { k: 'reveal'; winner: Winner } | { k: 'over'; winner: Winner }`
  - `interface NightRecord { ticks: { seat: Seat; box: B64 }[]; finals: (B64 | null)[]; actions: (B64[] | null)[]; responses: (B64[] | null)[]; dawn: ('alive' | 'dead' | null)[] }`
  - `type WarningKind = 'badProof' | 'commitMismatch' | 'logHashMismatch' | 'verdictConflict'`
  - `interface PublicState { roster; gameId; n; config: Config; phase: Phase; pending: Set<Seat>; X: (Point | null)[]; pk: Point | null; commits: (B64 | null)[]; E: (Ct | null)[]; ES: Ct | null; decks: Card[][]; partials: (CardPartials[] | null)[]; alive: Set<Seat>; deaths: { seat: Seat; cause: 'night' | 'vote'; round: number }[]; nights: NightRecord[]; nightAlive: Seat[][]; votes: Map<Seat, Seat | null>[]; verdicts: Map<string, (Verdict | null)[]>; checkpointAlive: Map<string, Seat[]>; reveals: (Extract<Body, { k: 'reveal' }> | null)[]; hash: B64; phaseStartHash: B64; warnings: { kind: WarningKind; seat: Seat; at: string }[] }` (`nights`, `nightAlive`, `votes`는 밤·낮 번호를 인덱스로, 0번 칸은 비움)
  - `initialState(roster: Roster): PublicState`, `apply(s: PublicState, e: LogEntry): void` (상태를 직접 바꿈)
  - `tally(votes: Map<Seat, Seat | null>, alive: ReadonlySet<Seat>): Seat | null`
- 규칙 (모든 항목 공통): `parse`가 null이거나, 현재 단계에 맞지 않거나, 보낸 좌석이 `pending`에 없으면 그 항목은 상태를 바꾸지 않는다 (해시만 갱신). `apply`는 항목마다 `s.hash = nextHash(s.hash, e)`를 갱신하고, 단계가 바뀐 항목에서 `s.phaseStartHash = s.hash`로 둔다. "전원"은 모든 좌석(생사 무관)이다.

| 단계 | 받는 메시지 | 받을 때 처리 | 넘어가는 조건 → 다음 단계 |
|---|---|---|---|
| lobby | `start` | config 저장 | 즉시 → keygen (pending 전원) |
| keygen | `keygen` | `verifyKey(X, proof, key/${gameId}/${seat})` 실패면 warning `badProof`(at `setup`), 미반영 | 전원 → mafiaCommit, `pk = jointKey(X)` |
| mafiaCommit | `mafiaCommit` | commit 저장 | 전원 → mafiaReveal |
| mafiaReveal | `mafiaReveal` | `commitOf(E) ≠ commit`이면 warning `commitMismatch`(반영은 함) | 전원 → `ES = ΣE`, `decks = [buildDeck(composition(n), ES)]`, shuffle turn 0 |
| shuffle t | 좌석 t의 `shuffle` (카드 n장) | `decks.push(deck)` | 받으면 → turn t+1, t = n−1이면 deal (pending 전원) |
| deal | `partials` | `checkPartials(X[seat], decks[n], seat, items, gameId)` 실패면 warning `badProof`, 미반영 | 전원 → nightSelect 1, `nightAlive[1]` 기록 |
| nightSelect n | `blob` (아무 좌석, `night = n`) | `ticks`에 추가 | 호스트 `timerEnd('nightSelect')` → nightFinal n (pending 전원) |
| nightFinal n | `blob` | `finals[seat]` | 전원 → nightActions n |
| nightActions n | `actions` (`boxes` 길이 n, 자기 자리 `''`) | `actions[seat]` | 전원 → nightResponses n |
| nightResponses n | `responses` (같은 형식) | `responses[seat]` | 전원 → dawn n |
| dawn n | `dawn` | `logHash ≠ phaseStartHash`면 warning `logHashMismatch`(at `dawn-${n}`) | 전원 → `status = 'dead'`이고 살아 있는 좌석을 사망 처리(cause `night`, round n) → verdict `dawn-${n}` (day n, next `discussion`), `checkpointAlive` 기록 |
| verdict | `verdict` (`cp` 일치) | logHash 검사는 dawn과 같음 | 전원 → `end*`가 있으면 reveal (둘 다 있으면 `conflict` + warning `verdictConflict`), 없으면 next: discussion day / nightSelect day+1 (`nightAlive` 기록) |
| discussion d | — | — | `timerEnd('discussion')` → vote d |
| vote d | 살아 있는 좌석의 `vote` (`day = d`, target은 살아 있는 좌석이나 null) | 마지막 표로 덮어씀 (pending 미사용) | `timerEnd('vote')` → `tally` 결과가 있으면 사망 처리(cause `vote`, round d) → verdict `exec-${d}` (next `night`) |
| reveal | `reveal` | `reveals[seat]` | 전원 또는 `timerEnd('reveal')` → over |
| lobby·reveal·over 외 모든 단계 | 호스트 `forceEnd` | — | 즉시 → reveal `forced` (pending 전원) |

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/state.test.ts
import { it, expect } from 'vitest';
import { makeRoster } from '../helpers/roster';
import { seal, DEFAULT_CONFIG } from '../../src/engine/messages';
import { Sequencer } from '../../src/engine/log';
import { initialState, apply, tally } from '../../src/engine/state';
import { G, randomScalar, mul, ptToB64 } from '../../src/protocol/group';
import { proveKey } from '../../src/protocol/proofs';

const { roster, keys } = makeRoster(6);
const keygen = (seat: number, ctxSeat = seat) => {
  const x = randomScalar();
  return seal(seat, keys[seat]!.sign.sk, { k: 'keygen', X: ptToB64(mul(G, x)), proof: proveKey(x, `key/g-test/${ctxSeat}`) });
};

it('start → keygen, bad proofs warn, duplicates ignored, all keys → mafiaCommit', () => {
  const seq = new Sequencer(roster, keys[0]!.sign.sk);
  const s = initialState(roster);
  apply(s, seq.host({ k: 'start', config: DEFAULT_CONFIG }));
  expect(s.phase).toEqual({ k: 'keygen' });
  expect([...s.pending].sort()).toEqual([0, 1, 2, 3, 4, 5]);
  apply(s, seq.submit(keygen(1, 2))!);
  expect(s.warnings).toContainEqual({ kind: 'badProof', seat: 1, at: 'setup' });
  expect(s.pending.has(1)).toBe(true);
  apply(s, seq.submit(keygen(1))!);
  apply(s, seq.submit(keygen(1))!);
  expect(s.pending.has(1)).toBe(false);
  for (const seat of [0, 2, 3, 4, 5]) apply(s, seq.submit(keygen(seat))!);
  expect(s.phase).toEqual({ k: 'mafiaCommit' });
  expect(s.pk).not.toBeNull();
});
it('forceEnd moves any running phase to reveal', () => {
  const seq = new Sequencer(roster, keys[0]!.sign.sk);
  const s = initialState(roster);
  apply(s, seq.host({ k: 'start', config: DEFAULT_CONFIG }));
  apply(s, seq.host({ k: 'forceEnd' }));
  expect(s.phase).toEqual({ k: 'reveal', winner: 'forced' });
});
it('tally: unique max wins; ties, abstentions, dead voters and dead targets do not', () => {
  const alive = new Set([0, 1, 2, 3]);
  expect(tally(new Map([[0, 1], [1, 2], [2, 1], [3, null]]), alive)).toBe(1);
  expect(tally(new Map([[0, 1], [1, 2]]), alive)).toBeNull();
  expect(tally(new Map([[0, null], [1, null]]), alive)).toBeNull();
  expect(tally(new Map([[5, 1], [0, 2]]), alive)).toBe(2);
  expect(tally(new Map([[0, 5], [1, 5], [2, 1]]), alive)).toBe(1);
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/state.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(engine): public state reducer"`

---

### Task 10: 플레이어 에이전트 (준비 단계)와 시뮬레이터

**Files:**
- Create: `src/engine/agent.ts`, `tests/helpers/sim.ts`
- Test: `tests/engine/setup.test.ts`

**Interfaces:**
- Consumes: Task 1~9
- Produces (`agent.ts`):
  - `interface AgentSecrets { seat: Seat; sign: SignKeys; dh: DhKeys }`
  - `class PlayerAgent`
    - `constructor(roster: Roster, me: AgentSecrets)` — 생성 시 `x`, 마피아 기여(`contribute`는 pk가 정해진 뒤 만들므로 `s`, `r`만 미리 뽑아 둔다), `randomShuffle(n)`을 만든다
    - `readonly state: PublicState`, `readonly seat: Seat`
    - `onEntry(e: LogEntry): Envelope[]` — `apply` 후 `due()`의 결과를 돌려준다
    - `role: Role | null`, `teammates: Seat[]` (자기 제외, 마피아만 채워짐), `teammatePicks: Map<Seat, Seat | null>`, `pick: Seat | null`, `policeResults: { night: number; target: Seat; result: 'mafia' | 'notMafia' | 'noAnswer' }[]`
    - `validTargets(): Seat[]` — 밤 선택 가능 좌석. 살아 있는 좌석 중 마피아는 자기·동료 제외, 경찰과 시민은 자기 제외, 의사는 자기 포함. 죽은 에이전트는 `[]`
    - `select(target: Seat | null): boolean` — nightSelect 중이고 `validTargets()`에 있으면(또는 null) 반영
    - `tick(): Envelope | null` — nightSelect 중에만 블롭 1개 (`final: false`)
    - `vote(target: Seat | null): Envelope | null` — vote 단계의 살아 있는 에이전트만
    - 보호 메서드 (치트 테스트에서 덮어씀): `protected buildShuffle(prev: Card[]): Body`, `buildPartials(deck: Card[]): Body`, `buildActions(night: number): Body`, `buildResponses(night: number): Body`, `buildDawn(night: number): Body`, `buildVerdict(cp: string): Body`, `buildReveal(): Body | null`, `protected actionKey(from: Seat, to: Seat, stage: 'act' | 'resp', night: number): Uint8Array`
  - `due()`: 현재 단계에서 내가 `pending`이고 이 단계 키로 아직 안 보냈으면 메시지를 만든다 (단계 키: `phase.k` + 밤/낮 번호/cp/turn). 다음 표의 반응을 따른다.

| 단계 | 내 메시지 |
|---|---|
| keygen | `keygen` (`proveKey(x, key/${gameId}/${seat})`) |
| mafiaCommit | `contribute`와 같은 방식으로 `E = encrypt(pk, s·G, r)`를 만들고 `commitOf(E)` 전송 |
| mafiaReveal | `E` |
| shuffle (turn = 나) | `buildShuffle(decks[마지막])` = `applyShuffle` 결과 |
| deal | `buildPartials(decks[n])` = `makePartials` |
| nightSelect 1 진입 시 (1회) | 내 카드를 연다 (`openOwnCard`, 다른 좌석의 부분 해독값 사용). 마피아면 `kMafia = mafiaKey(S, gameId)` |
| nightSelect / nightFinal 중 블롭 수신 | 마피아면 모든 블롭을 `kMafia`로 열어 동료와 선택을 갱신 |
| nightFinal | 블롭 (`final: true`, `pick`). 마피아(살아 있음)는 `kMafia`, 그 외는 `selfBlobKey(dh.sk, gameId)`로 봉인 |
| nightActions | `buildActions(n)`: 모두 `none`으로 시작. 살아 있는 마피아 대표면 `killTarget`(살아 있는 마피아들의 최종 선택) 대상에게 `kill`. 살아 있는 의사는 선택이 자기가 아니면 그 대상에게 `save`. 살아 있는 경찰은 선택 대상에게 `query` |
| nightResponses | 나에게 온 `actions`를 연다. `query`를 보낸 좌석 q에게 `provePartial(x, myCard.a, query/${gameId}/${n}/${seat})`, 나머지는 `none` |
| dawn | 경찰이면 조사 대상의 응답으로 `investigate` 후 `policeResults`에 추가 (응답이 없거나 증명이 틀리면 `noAnswer`). `buildDawn`: 이미 죽었으면 `dead`, 아니면 `fate(받은 행동, 의사 자기 보호 여부)`. `logHash = phaseStartHash` |
| verdict | 마피아면 `verdictFor(동료 ∪ 나, alive)`, 아니면 `continue`. `logHash = phaseStartHash` |
| reveal | 모든 비밀 공개 |

- Produces (`tests/helpers/sim.ts`):
  - `interface Sim { n: number; roster: Roster; seq: Sequencer; agents: PlayerAgent[]; start(): void; deliver(envs: Envelope[]): void; tickAll(): void; endTimer(p: TimerPhase): void; forceEnd(): void; offline(seat: Seat): void; online(seat: Seat): void; replaceAgent(seat: Seat, a: PlayerAgent): void; seatsWithRole(r: Role): Seat[] }`
  - `createSim(n: number, make?: (roster: Roster, me: AgentSecrets) => PlayerAgent): Sim` — 동기식 큐. 제출된 봉투를 `seq.submit`에 넣고, 나온 항목을 온라인 에이전트 모두에게 `onEntry`로 전달하고, 반응을 다시 큐에 넣어 빌 때까지 반복한다. `start()`는 `seq.host(start)` 후 큐를 비운다 (nightSelect 1에서 멈춤). `online(seat)`은 그 에이전트의 `resync(seq.entries)`(Task 13) 결과를 전달한다

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/setup.test.ts
import { it, expect } from 'vitest';
import { createSim } from '../helpers/sim';
import { composition } from '../../src/protocol/roles';

it.each([6, 12])('n=%i: every agent learns exactly its own role', (n) => {
  const sim = createSim(n);
  sim.start();
  expect(sim.agents.every((a) => a.state.phase.k === 'nightSelect')).toBe(true);
  expect(sim.agents.map((a) => a.role).sort()).toEqual([...composition(n)].sort());
  expect(new Set(sim.agents.map((a) => a.state.hash)).size).toBe(1);
}, 60_000);
it('mafia find each other on the first tick; others learn nothing', () => {
  const sim = createSim(8);
  sim.start();
  sim.tickAll();
  const mafia = sim.seatsWithRole('mafia');
  for (const a of sim.agents) {
    expect([...a.teammates].sort()).toEqual(a.role === 'mafia' ? mafia.filter((m) => m !== a.seat).sort() : []);
  }
}, 60_000);
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/setup.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(engine): player agent setup phases and simulator"`

---

### Task 11: 밤·낮 진행과 전체 게임 시뮬레이션

**Files:**
- Modify: `src/engine/agent.ts` (밤·낮 반응 완성), `tests/helpers/sim.ts` (진행 도우미 추가)
- Test: `tests/engine/game.test.ts`

**Interfaces:**
- Consumes: Task 10
- Produces (`tests/helpers/sim.ts`):
  - `night(sim: Sim, picks: Partial<Record<Seat, Seat | null>>): void` — 살아 있는 좌석은 picks 값을 `select`(없으면 선택 안 함), `tickAll()`, `endTimer('nightSelect')`
  - `day(sim: Sim, votes: Partial<Record<Seat, Seat | null>>): void` — `endTimer('discussion')`, 각 좌석 `vote`, `endTimer('vote')`
  - `playRandomGame(sim: Sim, rand: () => number): void` — over가 될 때까지 (최대 30라운드) 밤에는 각자 `validTargets()`에서 무작위 선택, 낮에는 살아 있는 사람 모두가 같은 무작위 대상에게 투표. reveal은 자동 진행
  - `mulberry32(seed: number): () => number`
- 테스트에서 `alive(sim)`은 `sim.agents[0]!.state.alive`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/game.test.ts
import { describe, it, expect } from 'vitest';
import { createSim, night, day, playRandomGame, mulberry32 } from '../helpers/sim';

const setup = (n = 6) => {
  const sim = createSim(n);
  sim.start();
  const [m1, m2] = sim.seatsWithRole('mafia') as [number, number];
  const [doc] = sim.seatsWithRole('doctor') as [number];
  const [cop] = sim.seatsWithRole('police') as [number];
  const [c1, c2] = sim.seatsWithRole('citizen') as [number, number];
  return { sim, m1, m2, doc, cop, c1, c2, alive: () => sim.agents[0]!.state.alive };
};

describe('night', () => {
  it('kill without save kills the target', () => {
    const { sim, m1, m2, doc, c1, c2, alive } = setup();
    night(sim, { [m1]: c1, [m2]: c1, [doc]: c2 });
    expect(alive().has(c1)).toBe(false);
    expect(sim.agents[0]!.state.phase).toEqual({ k: 'discussion', day: 1 });
  }, 60_000);
  it('doctor saving the target means nobody dies', () => {
    const { sim, m1, m2, doc, c1, alive } = setup();
    night(sim, { [m1]: c1, [m2]: c1, [doc]: c1 });
    expect(alive().size).toBe(6);
  }, 60_000);
  it('doctor self-save survives', () => {
    const { sim, m1, m2, doc, alive } = setup();
    night(sim, { [m1]: doc, [m2]: doc, [doc]: doc });
    expect(alive().has(doc)).toBe(true);
  }, 60_000);
  it('police gets the right answer, even for a target killed that night', () => {
    const { sim, m1, m2, cop, c1 } = setup();
    night(sim, { [cop]: m1 });
    expect(sim.agents[cop]!.policeResults.at(-1)).toEqual({ night: 1, target: m1, result: 'mafia' });
    day(sim, {});
    night(sim, { [m1]: c1, [m2]: c1, [cop]: c1 });
    expect(sim.agents[cop]!.policeResults.at(-1)).toEqual({ night: 2, target: c1, result: 'notMafia' });
  }, 60_000);
  it('the game keeps going after the police and doctor die', () => {
    const { sim, m1, m2, cop, doc, alive } = setup(8);
    night(sim, { [m1]: cop, [m2]: cop });
    day(sim, {});
    night(sim, { [m1]: doc, [m2]: doc });
    expect(alive().has(cop) || alive().has(doc)).toBe(false);
    expect(sim.agents[0]!.state.phase.k).toBe('discussion');
  }, 60_000);
});
describe('day and verdict', () => {
  it('unique max is executed; a tie executes nobody', () => {
    const { sim, c1, c2, alive } = setup();
    night(sim, {});
    day(sim, { 0: c1, 1: c1, 2: c2 });
    expect(alive().has(c1)).toBe(false);
    night(sim, {});
    const [a, b] = [...alive()].filter((s) => s !== c2) as [number, number];
    day(sim, { [a]: c2, [b]: a });
    expect(alive().size).toBe(5);
  }, 60_000);
  it('dead mafia devices declare a citizen win after the last mafia is executed', () => {
    const { sim, m1, m2 } = setup();
    const everyone = (t: number) => Object.fromEntries([...sim.agents[0]!.state.alive].map((s) => [s, t]));
    night(sim, {});
    day(sim, everyone(m1));
    night(sim, {});
    day(sim, everyone(m2));
    expect(sim.agents[0]!.state.phase).toMatchObject({ winner: 'citizen' });
  }, 60_000);
  it('mafia win when they reach the remaining players', () => {
    const { sim, m1, m2, c1, c2 } = setup();
    night(sim, { [m1]: c1, [m2]: c1 });
    const everyone = Object.fromEntries([...sim.agents[0]!.state.alive].map((s) => [s, c2]));
    day(sim, everyone);
    expect(sim.agents[0]!.state.phase).toMatchObject({ winner: 'mafia' });
  }, 60_000);
});
describe('whole games', () => {
  it('random games for 6..12 players all finish with identical state on every device', () => {
    const rand = mulberry32(42);
    for (let n = 6; n <= 12; n++) for (let rep = 0; rep < 2; rep++) {
      const sim = createSim(n);
      sim.start();
      playRandomGame(sim, rand);
      const ph = sim.agents[0]!.state.phase;
      expect(ph.k).toBe('over');
      expect(['citizen', 'mafia']).toContain((ph as { winner: string }).winner);
      expect(new Set(sim.agents.map((a) => a.state.hash)).size).toBe(1);
    }
  }, 300_000);
  it('traffic uniformity: per night and kind, every seat sends identical message lengths', () => {
    const sim = createSim(8);
    sim.start();
    playRandomGame(sim, mulberry32(7));
    const byKey = new Map<string, Map<number, number[]>>();
    for (const { env } of sim.seq.entries) {
      const b = JSON.parse(env.json) as { k: string; night?: number };
      if (!['blob', 'actions', 'responses'].includes(b.k)) continue;
      const key = `${b.k}/${b.night}`;
      const m = byKey.get(key) ?? new Map<number, number[]>();
      m.set(env.from, [...(m.get(env.from) ?? []), env.json.length]);
      byKey.set(key, m);
    }
    for (const m of byKey.values()) {
      expect(m.size).toBe(8);
      expect(new Set([...m.values()].map((l) => l.join(','))).size).toBe(1);
    }
  }, 120_000);
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/game.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(engine): night, day, and verdict flow with full-game simulation"`

---

### Task 12: 게임 후 검증

**Files:**
- Create: `src/engine/audit.ts`, `tests/helpers/cheats.ts`
- Test: `tests/engine/audit.test.ts`

**Interfaces:**
- Consumes: Task 6~11 (`PlayerAgent`의 보호 메서드)
- Produces (`audit.ts`):
  - `type ViolationKind = 'keyMismatch' | 'contribution' | 'shuffle' | 'partial' | 'fakeBlob' | 'wrongKiller' | 'wrongKillTarget' | 'fakeSave' | 'fakeQuery' | 'badResponse' | 'missingResponse' | 'dawnLie' | 'verdictLie' | 'logMismatch' | 'noReveal'`
  - `interface Violation { seat: Seat; at: string; kind: ViolationKind }` — `at`은 `'setup'`, `` `night${n}` ``, verdict의 `cp`, `'reveal'` 중 하나
  - `interface TimelineNight { night: number; picks: (Seat | null)[]; kill: Seat | null; killed: Seat | null; save: Seat | null; query: Seat | null; queryResult: 'mafia' | 'notMafia' | 'noAnswer' | null }`
  - `interface AuditReport { roles: (Role | null)[]; violations: Violation[]; unverifiable: Seat[]; timeline: TimelineNight[] }`
  - `audit(roster: Roster, log: readonly LogEntry[]): AuditReport`
- 검증 절차: 로그 전체를 `initialState` + `apply`로 재생한다. 리듀서 경고를 위반으로 옮긴다 (`badProof` → setup은 `keyMismatch`, deal은 `partial`, `commitMismatch` → `contribution`, `logHashMismatch` → `logMismatch`). 공개된 비밀로 스펙 8.1절 표의 항목을 각각 재계산한다. 비밀을 공개하지 않은 좌석은 `unverifiable`과 `noReveal`에 넣고, 그 좌석의 비밀이 필요한 항목은 건너뛴다. 모든 비밀이 있을 때만 `roles`를 채운다.
- Produces (`tests/helpers/cheats.ts`): `PlayerAgent`를 상속한 치트 클래스. 각각 `armed = false` 필드를 갖고, `armed`일 때만 보호 메서드를 바꾼다.
  - `ShuffleSwapper`: `buildShuffle`이 이전 덱 대신 `decks[0]`을 섞는다
  - `FakeKiller`: `buildActions`에서 `target` 필드의 좌석에게 `kill`
  - `FakeQuerier`: `buildActions`에서 `target`에게 `query`
  - `DawnLiar`: `buildDawn`이 항상 `alive`
  - `Silent`: `buildResponses`가 모두 `none`
  - `FalseEnder`: `buildVerdict`가 `endMafia`
  - `HashForger`: `buildDawn`의 `logHash`를 다른 값으로
  - `NoRevealer`: `buildReveal`이 null

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/audit.test.ts
import { describe, it, expect } from 'vitest';
import { createSim, night, day, playRandomGame, mulberry32 } from '../helpers/sim';
import * as C from '../helpers/cheats';
import { audit } from '../../src/engine/audit';
import { PlayerAgent, type AgentSecrets } from '../../src/engine/agent';
import type { Roster } from '../../src/engine/messages';

const phaseOf = (sim: ReturnType<typeof createSim>) => sim.agents[0]!.state.phase.k;
const finish = (sim: ReturnType<typeof createSim>) => {
  if (phaseOf(sim) !== 'reveal' && phaseOf(sim) !== 'over') sim.forceEnd();
  if (phaseOf(sim) === 'reveal') sim.endTimer('reveal');
  return audit(sim.roster, sim.seq.entries);
};
const cheatSim = (Cls: new (r: Roster, me: AgentSecrets) => PlayerAgent) => createSim(6, (r, me) => new Cls(r, me));

describe('audit', () => {
  it('honest games have no violations and reveal every role', () => {
    for (let i = 0; i < 3; i++) {
      const sim = createSim(6 + i * 3);
      sim.start();
      playRandomGame(sim, mulberry32(i));
      const rep = audit(sim.roster, sim.seq.entries);
      expect(rep.violations).toEqual([]);
      expect(rep.unverifiable).toEqual([]);
      expect(rep.roles).toEqual(sim.agents.map((a) => a.role));
    }
  }, 300_000);
  it('timeline records the first night', () => {
    const sim = createSim(6);
    sim.start();
    const [m1, m2] = sim.seatsWithRole('mafia') as [number, number];
    const [c1] = sim.seatsWithRole('citizen') as [number];
    night(sim, { [m1]: c1, [m2]: c1 });
    const rep = finish(sim);
    expect(rep.timeline[0]).toMatchObject({ night: 1, kill: c1, killed: c1 });
    expect(rep.timeline[0]!.picks[m1]).toBe(c1);
  }, 60_000);
  it('detects a swapped deck', () => {
    const sim = cheatSim(C.ShuffleSwapper);
    (sim.agents[2] as C.ShuffleSwapper).armed = true;
    sim.start();
    expect(finish(sim).violations).toContainEqual({ seat: 2, at: 'setup', kind: 'shuffle' });
  }, 60_000);
  it.each([
    ['FakeKiller', 'wrongKiller'],
    ['FakeQuerier', 'fakeQuery'],
  ] as const)('%s sending a forged action is caught as %s', (cls, kind) => {
    const sim = cheatSim(C[cls]);
    sim.start();
    const [c1, c2] = sim.seatsWithRole('citizen') as [number, number];
    Object.assign(sim.agents[c1]!, { armed: true, target: c2 });
    night(sim, {});
    expect(finish(sim).violations).toContainEqual({ seat: c1, at: 'night1', kind });
  }, 60_000);
  it('catches a victim who hides their death', () => {
    const sim = cheatSim(C.DawnLiar);
    sim.start();
    const [m1, m2] = sim.seatsWithRole('mafia') as [number, number];
    const [c1] = sim.seatsWithRole('citizen') as [number];
    (sim.agents[c1] as C.DawnLiar).armed = true;
    night(sim, { [m1]: c1, [m2]: c1 });
    expect(sim.agents[0]!.state.alive.has(c1)).toBe(true);
    expect(finish(sim).violations).toContainEqual({ seat: c1, at: 'night1', kind: 'dawnLie' });
  }, 60_000);
  it('catches a target who refuses to answer the police', () => {
    const sim = cheatSim(C.Silent);
    sim.start();
    const [cop] = sim.seatsWithRole('police') as [number];
    const [c1] = sim.seatsWithRole('citizen') as [number];
    (sim.agents[c1] as C.Silent).armed = true;
    night(sim, { [cop]: c1 });
    expect(sim.agents[cop]!.policeResults.at(-1)!.result).toBe('noAnswer');
    expect(finish(sim).violations).toContainEqual({ seat: c1, at: 'night1', kind: 'missingResponse' });
  }, 60_000);
  it('catches a false game-over claim', () => {
    const sim = cheatSim(C.FalseEnder);
    sim.start();
    const [c1] = sim.seatsWithRole('citizen') as [number];
    (sim.agents[c1] as C.FalseEnder).armed = true;
    night(sim, {});
    expect(finish(sim).violations).toContainEqual({ seat: c1, at: 'dawn-1', kind: 'verdictLie' });
  }, 60_000);
  it('flags a forged log hash during the game and in the audit', () => {
    const sim = cheatSim(C.HashForger);
    sim.start();
    (sim.agents[3] as C.HashForger).armed = true;
    night(sim, {});
    expect(sim.agents[0]!.state.warnings).toContainEqual({ kind: 'logHashMismatch', seat: 3, at: 'dawn-1' });
    expect(finish(sim).violations).toContainEqual({ seat: 3, at: 'dawn-1', kind: 'logMismatch' });
  }, 60_000);
  it('marks a player who never reveals as unverifiable', () => {
    const sim = cheatSim(C.NoRevealer);
    (sim.agents[4] as C.NoRevealer).armed = true;
    sim.start();
    const rep = finish(sim);
    expect(rep.unverifiable).toEqual([4]);
    expect(rep.violations).toContainEqual({ seat: 4, at: 'reveal', kind: 'noReveal' });
  }, 60_000);
});
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/audit.test.ts`)
- [ ] **Step 5: 커밋** — `git add -A && git commit -m "feat(engine): post-game audit with cheat detection"`

---

### Task 13: 스냅샷 복구와 재접속

**Files:**
- Modify: `src/engine/agent.ts`, `tests/helpers/sim.ts` (`offline`, `online`, `replaceAgent` 완성)
- Test: `tests/engine/resync.test.ts`

**Interfaces:**
- Consumes: Task 10~12
- Produces (`agent.ts`):
  - `interface AgentSnapshot { seat: Seat; signSk: B64; signPk: B64; dhSk: B64; dhPk: B64; x: B64; s: B64; r: B64; perm: number[]; rho: [B64, B64][] }`
  - `snapshot(): AgentSnapshot` (JSON 직렬화 가능)
  - `static fromSnapshot(roster: Roster, snap: AgentSnapshot): PlayerAgent`
  - `resync(entries: readonly LogEntry[]): Envelope[]` — 보낸 기록(단계 키)을 비우고 상태를 처음부터 다시 만든다. 모든 항목에 `onEntry`와 같은 내부 처리(카드 열기, 블롭 해석, 받은 행동 기록 포함)를 하되 보낼 메시지는 버리고, 마지막에 `due()` 결과만 돌려준다
- 오프라인 에이전트는 항목을 받지 못하고 메시지도 내지 않는다. 다시 온라인이 되면 `sim`이 `resync(seq.entries)`의 결과를 전달한다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// tests/engine/resync.test.ts
import { it, expect } from 'vitest';
import { createSim, night } from '../helpers/sim';
import { PlayerAgent } from '../../src/engine/agent';

it('a player who drops mid-night stalls the night and resumes it after restoring from a snapshot', () => {
  const sim = createSim(6);
  sim.start();
  const snap = JSON.parse(JSON.stringify(sim.agents[3]!.snapshot()));
  sim.offline(3);
  sim.tickAll();
  sim.endTimer('nightSelect');
  expect(sim.agents[0]!.state.phase).toEqual({ k: 'nightFinal', night: 1 });
  expect([...sim.agents[0]!.state.pending]).toEqual([3]);
  sim.replaceAgent(3, PlayerAgent.fromSnapshot(sim.roster, snap));
  sim.online(3);
  expect(sim.agents[0]!.state.phase).toEqual({ k: 'discussion', day: 1 });
  expect(new Set(sim.agents.map((a) => a.state.hash)).size).toBe(1);
}, 60_000);
it('duplicate messages (e.g. resent after a reconnect) are ignored without warnings', () => {
  const sim = createSim(6);
  sim.start();
  night(sim, {});
  sim.deliver(sim.seq.entries.filter((e) => e.env.from === 2).map((e) => e.env));
  sim.offline(2);
  sim.online(2);
  expect(sim.agents[0]!.state.warnings).toEqual([]);
  expect(sim.agents[0]!.state.phase).toEqual({ k: 'discussion', day: 1 });
  expect(new Set(sim.agents.map((a) => a.state.hash)).size).toBe(1);
}, 60_000);
```

- [ ] **Step 2~4: 실패 확인 → 구현 → 통과 확인** (`pnpm test tests/engine/resync.test.ts`)
- [ ] **Step 5: 전체 테스트와 타입 검사**

Run: `pnpm typecheck && pnpm test`
Expected: 오류 0, 모든 테스트 PASS

- [ ] **Step 6: 커밋** — `git add -A && git commit -m "feat(engine): snapshot restore and resync"`
