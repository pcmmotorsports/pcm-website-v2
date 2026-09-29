import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

import { changePct, matchesDirection } from './price-change-repository';

describe('changePct', () => {
  it('一般情況:小數一位, 漲正跌負', () => {
    expect(changePct(58000, 61200)).toBe(5.5);
    expect(changePct(1000, 850)).toBe(-15);
  });
  it('🔴 舊價 0 或沒有價格、新價沒有價格 ⇒ null(不印 Infinity / NaN)', () => {
    expect(changePct(0, 500)).toBeNull();
    expect(changePct(null, 500)).toBeNull();
    expect(changePct(500, null)).toBeNull();
  });
});

describe('matchesDirection', () => {
  it('不篩 ⇒ 全部都算', () => {
    expect(matchesDirection({ oldPrice: null, newPrice: 1 })).toBe(true);
  });
  it('漲 / 跌照新舊價比;有一側沒有價格 ⇒ 兩邊都不算', () => {
    expect(matchesDirection({ oldPrice: 100, newPrice: 120 }, 'up')).toBe(true);
    expect(matchesDirection({ oldPrice: 100, newPrice: 120 }, 'down')).toBe(false);
    expect(matchesDirection({ oldPrice: 100, newPrice: 80 }, 'down')).toBe(true);
    expect(matchesDirection({ oldPrice: null, newPrice: 80 }, 'down')).toBe(false);
    expect(matchesDirection({ oldPrice: 100, newPrice: null }, 'up')).toBe(false);
  });
});
