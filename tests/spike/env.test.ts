import { it, expect } from 'vitest';
import { isKakaoInApp } from '../../src/spike/env';

it('detects KakaoTalk in-app browser only', () => {
  expect(isKakaoInApp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 KAKAOTALK 10.4.5')).toBe(true);
  expect(isKakaoInApp('Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36')).toBe(false);
});
