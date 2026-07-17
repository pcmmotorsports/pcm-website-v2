import { describe, expect, it } from 'vitest';
import type { EmailSendErrorCode } from '@pcm/ports';
import { computeEmailBackoff, LEASE_RECLAIM_RETRY_DELAY_MS } from './email-backoff';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const FAILED_AT = new Date('2026-07-17T10:00:00.000Z');

/**
 * 🔴 union 全集(`satisfies Record<EmailSendErrorCode, true>` 逼窮舉:union 增員漏補本表 →
 * typecheck 必紅、減員留冗鍵也紅;codex 關卡2 R1 nit —— 純陣列字面清單靠人記得同步、逼不了)。
 */
const ALL_CODES_MAP = {
  http_400: true,
  http_401: true,
  http_403: true,
  http_404: true,
  http_408: true,
  http_409: true,
  http_422: true,
  http_429: true,
  http_500: true,
  http_502: true,
  http_503: true,
  http_504: true,
  rate_limited: true,
  quota_daily_exceeded: true,
  quota_monthly_exceeded: true,
  network_error: true,
  provider_error: true,
} satisfies Record<EmailSendErrorCode, true>;

const ALL_CODES = Object.keys(ALL_CODES_MAP) as readonly EmailSendErrorCode[];

const QUOTA_CODES: readonly EmailSendErrorCode[] = [
  'quota_daily_exceeded',
  'quota_monthly_exceeded',
  'http_429',
];

const EXPONENTIAL_CODES: readonly EmailSendErrorCode[] = ALL_CODES.filter(
  (c) => !QUOTA_CODES.includes(c) && c !== 'rate_limited',
);

function delayOf(code: EmailSendErrorCode, attempts: number, random: () => number): number {
  return computeEmailBackoff(code, attempts, FAILED_AT, random).getTime() - FAILED_AT.getTime();
}

describe('computeEmailBackoff — §⑨ 三列', () => {
  it.each(QUOTA_CODES.map((c) => [c] as const))(
    '%s:random=0 → 恰 +24h(下界字面;禁指數 = attempts 不影響)',
    (code) => {
      expect(delayOf(code, 1, () => 0)).toBe(DAY_MS);
      // §⑨ 字面=quota 列「禁指數退避」→ 引申:attempts 1 與 5 結果必須相同
      expect(delayOf(code, 5, () => 0)).toBe(DAY_MS);
    },
  );

  it.each(QUOTA_CODES.map((c) => [c] as const))(
    '%s:jitter 只加不減、上界 < +24h30m(≥24h 合約下界不破)',
    (code) => {
      const max = delayOf(code, 1, () => 0.999999);
      expect(max).toBeGreaterThanOrEqual(DAY_MS);
      expect(max).toBeLessThan(DAY_MS + 30 * MINUTE_MS);
    },
  );

  it('rate_limited:15 分 + jitter(0..5 分)、禁指數', () => {
    expect(delayOf('rate_limited', 1, () => 0)).toBe(15 * MINUTE_MS);
    expect(delayOf('rate_limited', 5, () => 0)).toBe(15 * MINUTE_MS);
    const max = delayOf('rate_limited', 1, () => 0.999999);
    expect(max).toBeGreaterThanOrEqual(15 * MINUTE_MS);
    expect(max).toBeLessThan(20 * MINUTE_MS);
  });
});

describe('computeEmailBackoff — 兜底列(指數 5min × 2^(attempts-1)、上限 2h)', () => {
  it.each([
    [1, 5 * MINUTE_MS],
    [2, 10 * MINUTE_MS],
    [3, 20 * MINUTE_MS],
    [4, 40 * MINUTE_MS],
    [5, 80 * MINUTE_MS],
    [6, 2 * HOUR_MS],
    [50, 2 * HOUR_MS],
  ] as const)('attempts=%i → %i ms', (attempts, expected) => {
    for (const code of EXPONENTIAL_CODES) {
      expect(delayOf(code, attempts, () => 0.5)).toBe(expected); // random 不參與兜底列
    }
  });

  it.each([
    [0, 5 * MINUTE_MS],
    [-3, 5 * MINUTE_MS],
    [Number.NaN, 5 * MINUTE_MS],
    [2.9, 10 * MINUTE_MS],
  ] as const)('非法/非整數 attempts=%s → 防禦性 clamp', (attempts, expected) => {
    expect(delayOf('provider_error', attempts, () => 0)).toBe(expected);
  });
});

describe('政策映射完整性', () => {
  it('union 全集恰 17 碼、每碼皆可計算出未來時點(窮舉 Record 的 runtime 對照)', () => {
    expect(ALL_CODES).toHaveLength(17);
    for (const code of ALL_CODES) {
      const next = computeEmailBackoff(code, 1, FAILED_AT, () => 0);
      expect(next.getTime()).toBeGreaterThan(FAILED_AT.getTime());
    }
  });

  it('lease 回收延遲 = 5 分(§⑩ 單值、非逐列;毒信慢燒節奏由 lease 長度主導)', () => {
    expect(LEASE_RECLAIM_RETRY_DELAY_MS).toBe(5 * MINUTE_MS);
  });
});
