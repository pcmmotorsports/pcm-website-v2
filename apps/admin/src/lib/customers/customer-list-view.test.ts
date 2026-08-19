// customer-list-view.test.ts — 客戶列表顯示層純函式單測(M-4a 客戶管理第一片)。
// 客戶專屬:tier 白名單守門 / buildCustomerListHref / tier 標籤覆蓋 / 日期格式化。
// 通用分頁 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import {
  parseCustomerListSearchParams,
  buildCustomerListHref,
  buildCustomerSortHref,
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

// ───────────── 排序(2026-08-19;plan 已批)─────────────

describe('客戶列表排序 · 網址參數', () => {
  it('三個軸各自解析得出來,而網址值是 snake、domain 鍵是 camel', () => {
    expect(parseCustomerListSearchParams({ sort: 'spend', dir: 'asc' }).sort).toEqual({
      key: 'spend',
      ascending: true,
    });
    expect(parseCustomerListSearchParams({ sort: 'orders', dir: 'desc' }).sort).toEqual({
      key: 'orders',
      ascending: false,
    });
    expect(parseCustomerListSearchParams({ sort: 'last_order' }).sort).toEqual({
      key: 'lastOrder',
      ascending: false, // 沒給 dir ⇒ 該軸的預設方向（降冪）
    });
  });

  /**
   * 🔴🔴 **W6 `W6-06x` 指名要補的那一格。**
   *
   * `sort` 是這一片裡**唯一一個會變成 `.order(<欄名>)` 的 URL 參數** ——
   * **它是從網址流進查詢語句的那一條路。**
   * 白名單在型別層擋得住編譯期的錯,**擋不住執行期一個沒有人餵過的字串**。
   * 📌 而它與下面那格(關鍵字不得進 URL)是**同一個母題的兩半**:
   *    那格守「不該進 URL 的東西別進去」,本格守「**從 URL 進來的東西別直接出去**」。
   */
  it('🔴🔴 白名單外的 sort / dir 一律落回預設,而那個字串【不會到達查詢層】', () => {
    for (const bad of ['created_at', 'wallet_balance', 'name; drop', '', 'SPEND', 'lastOrder']) {
      expect(parseCustomerListSearchParams({ sort: bad }).sort).toBeUndefined();
    }
    // dir 亂寫 ⇒ 軸仍成立、方向落回該軸預設(不是整個排序失效)
    expect(parseCustomerListSearchParams({ sort: 'spend', dir: '亂寫' }).sort).toEqual({
      key: 'spend',
      ascending: false,
    });
    // 🔴 正對照:白名單內的值要真的認得出來 —— 沒有這一格,「永遠回 undefined」也會綠
    expect(parseCustomerListSearchParams({ sort: 'spend' }).sort).toBeDefined();
  });

  it('🔴 同名參數送兩份 ⇒ 當沒指定(不取第一個 —— 那會讓網址說了兩件事而只套一件)', () => {
    expect(parseCustomerListSearchParams({ sort: ['spend', 'orders'] }).sort).toBeUndefined();
  });

  it('欄頭連結:已經在這一軸 ⇒ 反向;不在 ⇒ 該軸預設方向;而【一律回 page 1】', () => {
    const none = buildCustomerSortHref({}, undefined, 'spend');
    expect(none).toContain('sort=spend');
    expect(none).toContain('dir=desc');
    expect(none).not.toContain('page=');

    const toggled = buildCustomerSortHref({}, { key: 'spend', ascending: false }, 'spend');
    expect(toggled).toContain('dir=asc');

    // 換一軸 ⇒ 不是反向，是新軸的預設方向
    const other = buildCustomerSortHref({}, { key: 'spend', ascending: true }, 'orders');
    expect(other).toContain('sort=orders');
    expect(other).toContain('dir=desc');
  });

  it('排序與 tier 並存 —— 改排序不洗掉 tier', () => {
    const href = buildCustomerSortHref({ tier: 'store' }, undefined, 'orders');
    expect(href).toContain('tier=store');
    expect(href).toContain('sort=orders');
  });

  it('翻頁帶著排序走 —— 少了它，第 2 頁會回到預設排序而箭頭還指在原欄', () => {
    const href = buildCustomerListHref({}, 3, { key: 'lastOrder', ascending: true });
    expect(href).toContain('sort=last_order');
    expect(href).toContain('dir=asc');
    expect(href).toContain('page=3');
  });

  /**
   * 🔴🔴 **`#525`:客戶搜尋詞是姓名 / Email / 電話 ⇒ 走 httpOnly cookie,刻意不進 URL。**
   *
   * 而排序參數進 URL **會誘使下一個人順手把搜尋詞也帶上** —— 訂單頁那些 builder 正是那樣寫的
   * ⇒ **他不是會不小心,他是會照既有做法做。**
   * ⇒ 所以這不是一句警語,是一道**會紅**的門。
   */
  it('🔴🔴 buildCustomerListHref 的輸出【永遠】不含關鍵字', () => {
    const cases = [
      buildCustomerListHref({}, 1),
      buildCustomerListHref({ tier: 'store' }, 2, { key: 'spend', ascending: true }),
      buildCustomerSortHref({ tier: 'premiumStore' }, { key: 'orders', ascending: false }, 'lastOrder'),
      // 🔴 硬塞:就算有人把 keyword 放進 filter（型別上它是合法的 AdminCustomerFilter 欄位），
      //    這支 builder 也不得把它寫進網址。**這一格就是那個負對照。**
      buildCustomerListHref({ tier: 'general', keyword: '王小明' }, 1, { key: 'spend', ascending: false }),
    ];
    for (const href of cases) {
      expect(href).not.toContain('keyword');
      expect(href).not.toContain('王小明');
      expect(href).not.toContain('q=');
    }
  });
});
