// @vitest-environment node
// notify-secret.test.ts — requireNotifySecret 強度驗(M-3 3DS-6a、Q1=A 抽出單一真相)。
// 從 3DS-2 route 內聯版 byte 等價抽出;route.test.ts 仍經 route 間接覆蓋(404/500),此處直接單元測釘規則。

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { requireNotifySecret } from './notify-secret';

const ORIGINAL = process.env.TAPPAY_NOTIFY_PATH_SECRET;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
  else process.env.TAPPAY_NOTIFY_PATH_SECRET = ORIGINAL;
});

describe('requireNotifySecret', () => {
  it('≥32 URL-safe → 回原值', () => {
    const s = 'a'.repeat(48);
    process.env.TAPPAY_NOTIFY_PATH_SECRET = s;
    expect(requireNotifySecret()).toBe(s);
  });

  it('恰 32 字 URL-safe(含 _ -)→ 通過(邊界)', () => {
    const s = 'A1_-'.repeat(8); // 32 字、全 ^[A-Za-z0-9_-]+$
    expect(s.length).toBe(32);
    process.env.TAPPAY_NOTIFY_PATH_SECRET = s;
    expect(requireNotifySecret()).toBe(s);
  });

  it('未設 → throw', () => {
    delete process.env.TAPPAY_NOTIFY_PATH_SECRET;
    expect(() => requireNotifySecret()).toThrow();
  });

  it('<32 → throw(強度不足)', () => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = 'a'.repeat(31);
    expect(() => requireNotifySecret()).toThrow();
  });

  it.each(['/', '.', ' ', '+', '='])('含非 URL-safe 字元(%s)→ throw', (ch) => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = `${'a'.repeat(40)}${ch}${'b'.repeat(8)}`;
    expect(() => requireNotifySecret()).toThrow();
  });

  it('空字串 → throw', () => {
    process.env.TAPPAY_NOTIFY_PATH_SECRET = '';
    expect(() => requireNotifySecret()).toThrow();
  });
});
