// customer-list-view.test.ts — 客戶列表顯示層純函式單測(M-4a 客戶管理第一片)。
// 客戶專屬:tier 白名單守門 / buildCustomerListHref / tier 標籤覆蓋 / 日期格式化。
// 通用分頁 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import {
  parseCustomerListSearchParams,
  buildCustomerListHref,
  formatCustomerDate,
  CUSTOMERS_PAGE_SIZE,
  TIER_LABEL,
  TIER_VALUES,
} from './customer-list-view';

describe('parseCustomerListSearchParams — tier 白名單守門', () => {
  it('合法 tier → filter 帶入;page 解析', () => {
    const { filter, page } = parseCustomerListSearchParams({ tier: 'premiumStore', page: '2' });
    expect(filter).toEqual({ tier: 'premiumStore' });
    expect(page).toBe(2);
  });

  it('非法 tier 忽略(注入不透傳)', () => {
    expect(parseCustomerListSearchParams({ tier: 'vip; DROP' }).filter).toEqual({
      tier: undefined,
    });
    expect(parseCustomerListSearchParams({ tier: '' }).filter).toEqual({ tier: undefined });
  });

  it('缺 searchParams → tier undefined + page 1', () => {
    const { filter, page } = parseCustomerListSearchParams({});
    expect(filter).toEqual({ tier: undefined });
    expect(page).toBe(1);
  });
});

describe('buildCustomerListHref', () => {
  it('無篩選 + page 1 → /customers(乾淨)', () => {
    expect(buildCustomerListHref({}, 1)).toBe('/customers');
  });

  it('帶 tier + page>1 → 保留', () => {
    const href = buildCustomerListHref({ tier: 'store' }, 3);
    expect(href).toContain('/customers?');
    expect(href).toContain('tier=store');
    expect(href).toContain('page=3');
  });

  it('page 1 省略 page 參數(保留 tier)', () => {
    const href = buildCustomerListHref({ tier: 'general' }, 1);
    expect(href).toContain('tier=general');
    expect(href).not.toContain('page=');
  });
});

describe('tier 標籤 — 每個 MemberTier 皆有標籤(沿用 design 真權威)', () => {
  it('三級皆非空', () => {
    for (const v of TIER_VALUES) expect(TIER_LABEL[v]).toBeTruthy();
  });
  it('對齊 design 字面', () => {
    expect(TIER_LABEL.general).toBe('一般會員');
    expect(TIER_LABEL.store).toBe('店家會員');
    expect(TIER_LABEL.premiumStore).toBe('PREMIUM STORE');
  });
});

describe('格式化', () => {
  it('formatCustomerDate:UTC → Asia/Taipei YYYY-MM-DD(避 off-by-one)', () => {
    expect(formatCustomerDate('2099-04-15T16:30:00Z')).toBe('2099-04-16');
  });
  it('CUSTOMERS_PAGE_SIZE = 20', () => {
    expect(CUSTOMERS_PAGE_SIZE).toBe(20);
  });
});
