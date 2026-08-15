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
  customerEmailDisplay,
  LINE_NO_EMAIL_LABEL,
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

// ─────────────────────────────────────────────────────────────────────────────
// `customerEmailDisplay` — LINE 合成位址不顯示原字串(Sean 2026-08-16 拍板乙)
// ─────────────────────────────────────────────────────────────────────────────
describe('customerEmailDisplay', () => {
  it('🔴 LINE 合成位址 → 替代字面,且原字串一個字都不留', () => {
    const raw = 'line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local';
    const out = customerEmailDisplay(raw);
    expect(out).toBe(LINE_NO_EMAIL_LABEL);
    // 🔴 光斷言「等於替代字面」還不夠:要釘住**原字串沒有被夾帶出去**
    //    (例如未來有人改成 `${LABEL}(${raw})` 之類的「貼心」寫法)。
    expect(out).not.toContain('line_u');
    expect(out).not.toContain('pcmmotorsports.local');
  });

  it('真 Email 原樣通過(正向對照:證明本函式不是恆回替代字面)', () => {
    expect(customerEmailDisplay('sean@example.com')).toBe('sean@example.com');
  });

  /**
   * 🔴 替代字面必須與 storefront 那句**逐字相同** —— 兩邊講的是同一件事。
   * 這一格釘的是「不要各寫各的」,不是文案本身好不好。
   * 出處:`apps/storefront/src/components/account/tabs/ProfileTab.tsx:137` 的 placeholder。
   */
  it('替代字面與 storefront 逐字相同', () => {
    expect(LINE_NO_EMAIL_LABEL).toBe('LINE 帳號登入,無 Email');
  });

  it('子網域也算合成位址(判斷式來自 @pcm/schemas,本格釘的是我們有接到它)', () => {
    expect(customerEmailDisplay('a@sub.line.pcmmotorsports.local')).toBe(LINE_NO_EMAIL_LABEL);
  });
});

// 🔴 `null` 是「這單沒有客人 email」,不是「LINE 用戶」—— 兩者必須分得開。
//    這一格是第一版寫死 `string` 時炸掉 21 格頁級測試的那個洞。
it('null 原樣回傳,不轉成替代字面', () => {
  expect(customerEmailDisplay(null)).toBeNull();
});
