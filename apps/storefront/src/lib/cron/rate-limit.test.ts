// rate-limit.test.ts — cron 限流器單元測試(M-3 #254)
//
// 驗:① 每視窗放行 MAX_HITS 次、第 MAX_HITS+1 次超限回 false ② 被擋不佔額度(不延長視窗)
//     ③ 視窗老化後恢復 ④ per-key 獨立額度 ⑤ 注入 now 控時 ⑥ reset(單 key / 全清)。

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({})); // rate-limit.ts import 'server-only';單元測試非 RSC context 需 mock

import {
  CRON_RATE_MAX_HITS,
  CRON_RATE_WINDOW_MS,
  checkCronRateLimit,
  resetCronRateLimit,
} from './rate-limit';

afterEach(() => {
  resetCronRateLimit(); // module scope 狀態跨測試存活 → 每測試後全清隔離
});

describe('checkCronRateLimit — sliding window', () => {
  it('視窗內放行前 MAX_HITS 次、第 MAX_HITS+1 次超限', () => {
    const now = 1_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect(checkCronRateLimit('k', now)).toBe(true);
    }
    expect(checkCronRateLimit('k', now)).toBe(false);
  });

  it('被擋不佔額度:超限後同窗持續 false、不因被擋而延長', () => {
    const now = 2_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('k', now);
    expect(checkCronRateLimit('k', now)).toBe(false);
    expect(checkCronRateLimit('k', now)).toBe(false); // 再打仍 false,未累積
    // 視窗剛好滑過最初那批 → 立即恢復(證被擋請求未寫入時戳延長視窗)
    const afterWindow = now + CRON_RATE_WINDOW_MS + 1;
    expect(checkCronRateLimit('k', afterWindow)).toBe(true);
  });

  it('視窗老化後恢復額度', () => {
    const now = 3_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('k', now);
    expect(checkCronRateLimit('k', now)).toBe(false);
    const later = now + CRON_RATE_WINDOW_MS + 1;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect(checkCronRateLimit('k', later)).toBe(true);
    }
    expect(checkCronRateLimit('k', later)).toBe(false);
  });

  it('視窗邊界(半開窗):剛好 = windowStart 的舊時戳視為已過期(過期從嚴 = 放行從寬)', () => {
    const now = 4_000_000;
    checkCronRateLimit('k', now); // 記 now
    // 下次在 now + WINDOW_MS:windowStart = now、filter t > now 為 false → 舊筆過期、額度全回
    const boundary = now + CRON_RATE_WINDOW_MS;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect(checkCronRateLimit('k', boundary)).toBe(true);
    }
    expect(checkCronRateLimit('k', boundary)).toBe(false);
  });

  it('per-key 獨立:一 key 被 flood 不影響另一 key', () => {
    const now = 5_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('a', now);
    expect(checkCronRateLimit('a', now)).toBe(false);
    expect(checkCronRateLimit('b', now)).toBe(true); // b 全新額度
  });
});

describe('resetCronRateLimit', () => {
  it('帶 key 只清單一路由', () => {
    const now = 6_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('a', now);
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('b', now);
    resetCronRateLimit('a');
    expect(checkCronRateLimit('a', now)).toBe(true); // a 已清、恢復
    expect(checkCronRateLimit('b', now)).toBe(false); // b 未清、仍超限
  });

  it('未帶 key 全清', () => {
    const now = 7_000_000;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('a', now);
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) checkCronRateLimit('b', now);
    resetCronRateLimit();
    expect(checkCronRateLimit('a', now)).toBe(true);
    expect(checkCronRateLimit('b', now)).toBe(true);
  });
});

describe('限流常數(揭示可調、防未來誤改變寬鬆)', () => {
  it('視窗 60s、每窗上限 5', () => {
    expect(CRON_RATE_WINDOW_MS).toBe(60_000);
    expect(CRON_RATE_MAX_HITS).toBe(5);
  });
});
