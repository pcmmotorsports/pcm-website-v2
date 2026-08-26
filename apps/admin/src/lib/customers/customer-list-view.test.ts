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
  parseAge,
  birthdayRangeForAges,
  todayInTaipei,
} from './customer-list-view';

/**
 * 🔴 固定的「今天」—— 本檔**一次都不呼叫 `new Date()`**。
 * 純函式吃 `today` 是刻意的:讓測試不會在某一天自己變色。
 * (`todayInTaipei()` 本身另有一格單測, 它是唯一碰時鐘的地方。)
 */
const TODAY = '2026-08-26';

describe('parseCustomerListSearchParams — tier 白名單守門', () => {
  it('合法 tier → filter 帶入;page 解析', () => {
    const { filter, page } = parseCustomerListSearchParams({ tier: 'premiumStore', page: '2' }, TODAY);
    expect(filter).toEqual({ tier: 'premiumStore' });
    expect(page).toBe(2);
  });

  it('非法 tier 忽略(注入不透傳)', () => {
    expect(parseCustomerListSearchParams({ tier: 'vip; DROP' }, TODAY).filter).toEqual({
      tier: undefined,
    });
    expect(parseCustomerListSearchParams({ tier: '' }, TODAY).filter).toEqual({ tier: undefined });
  });

  it('缺 searchParams → tier undefined + page 1', () => {
    const { filter, page } = parseCustomerListSearchParams({}, TODAY);
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
    expect(parseCustomerListSearchParams({ sort: 'spend', dir: 'asc' }, TODAY).sort).toEqual({
      key: 'spend',
      ascending: true,
    });
    expect(parseCustomerListSearchParams({ sort: 'orders', dir: 'desc' }, TODAY).sort).toEqual({
      key: 'orders',
      ascending: false,
    });
    expect(parseCustomerListSearchParams({ sort: 'last_order' }, TODAY).sort).toEqual({
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
      expect(parseCustomerListSearchParams({ sort: bad }, TODAY).sort).toBeUndefined();
    }
    // dir 亂寫 ⇒ 軸仍成立、方向落回該軸預設(不是整個排序失效)
    expect(parseCustomerListSearchParams({ sort: 'spend', dir: '亂寫' }, TODAY).sort).toEqual({
      key: 'spend',
      ascending: false,
    });
    // 🔴 正對照:白名單內的值要真的認得出來 —— 沒有這一格,「永遠回 undefined」也會綠
    expect(parseCustomerListSearchParams({ sort: 'spend' }, TODAY).sort).toBeDefined();
  });

  it('🔴 同名參數送兩份 ⇒ 當沒指定(不取第一個 —— 那會讓網址說了兩件事而只套一件)', () => {
    expect(parseCustomerListSearchParams({ sort: ['spend', 'orders'] }, TODAY).sort).toBeUndefined();
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

// ───────────── aria-sort(2026-08-19;主視窗裁「本片補完再交」)─────────────
//
// 🔴 這幾格斷的是**表格渲染出來的 `<th>` 屬性**,不是那個 helper 的回傳值 ——
//    helper 對了而沒有接到 `<th>` 上,讀屏使用者一樣聽不到,**而單測會全綠**。

/* ══ 生日兩軸(Sean 2026-08-26 `e:丙`)══════════════════════════════════════ */

describe('parseAge — 年齡值域守門', () => {
  it('合法整數過;空 / 未給 ⇒ undefined', () => {
    expect(parseAge('30')).toBe(30);
    expect(parseAge('0')).toBe(0);
    expect(parseAge(undefined)).toBeUndefined();
    expect(parseAge('')).toBeUndefined();
    expect(parseAge('   ')).toBeUndefined();
  });

  it('🔴 `30abc` ⇒ undefined,不是 30', () => {
    // parseInt('30abc') 會回 30 —— 那是使用者打錯字,不該被當成 30。
    expect(parseAge('30abc')).toBeUndefined();
  });

  it('非整數 / 負數 / 超出上界 ⇒ undefined(不擲錯)', () => {
    expect(parseAge('30.5')).toBeUndefined();
    expect(parseAge('-1')).toBeUndefined();
    expect(parseAge('131')).toBeUndefined();
    expect(parseAge('abc')).toBeUndefined();
    // 🔴 手滑把年份打進年齡欄 ⇒ 擋得住
    expect(parseAge('1990')).toBeUndefined();
    // ⚠️ 而**擋不住的那一種**:把 85 當年份打 ⇒ 它在值域內、看起來完全合法。
    //    這一格是**明寫的天花板**,不是缺口 —— 值域守門攔不了「合法而錯」的值。
    expect(parseAge('85')).toBe(85);
  });
});

describe('birthdayRangeForAges — 年齡 → 生日日期區間(純函式,不碰時鐘)', () => {
  const TODAY_2026 = '2026-08-26';

  it('兩端都含:30-40 歲 ⇒ 已滿 30、還沒滿 41', () => {
    const r = birthdayRangeForAges(30, 40, TODAY_2026);
    // 最年輕:今天剛好滿 30 的人(1996-08-26 生)要**被包含**
    expect(r.birthdayTo).toBe('1996-08-26');
    // 最年長:今天剛好滿 41 的人(1985-08-26 生)要**被排除** ⇒ 下界是隔天
    expect(r.birthdayFrom).toBe('1985-08-27');
  });

  it('只給一端 ⇒ 另一端不設限', () => {
    expect(birthdayRangeForAges(30, undefined, TODAY_2026)).toEqual({ birthdayTo: '1996-08-26' });
    expect(birthdayRangeForAges(undefined, 40, TODAY_2026)).toEqual({ birthdayFrom: '1985-08-27' });
    expect(birthdayRangeForAges(undefined, undefined, TODAY_2026)).toEqual({});
  });

  it('🔴 今天是 2/29 時不炸,而【3/1 生的人會差一歲】—— 釘住這個已知偏差', () => {
    // ⚠️ **這一格的理由 2026-08-26 被 `code-reviewer` 更正過, 舊版的理由是錯的**:
    //    舊註解說口徑是「2/29 出生的人被正規化到 3/1」—— 那是 docstring 講的另一件事。
    //    🔴 **這裡真正發生的是**:today = 2/29 時, `2/29 - 1 年` 被 JS 正規化成 3/1
    //    ⇒ 2023-03-01 生的人**今天(2024-02-29)其實還沒滿 1 歲**, 而這裡把他算進 1 歲。
    //    ⇒ 也就是**受害者是 3/1 生的人**, 不是 2/29 生的人。
    //    範圍:四年一次 × 生日恰為 3/1 ⇒ 命中率約 1/365。判為**已知偏差, 不修**。
    //    📌 而釘住它是為了:**下一個人改這裡的時候, 知道自己在改什麼。**
    //       照舊版那個(錯的)理由去改, 會改錯。
    const r = birthdayRangeForAges(1, 1, '2024-02-29');
    expect(r.birthdayTo).toBe('2023-03-01');
    expect(r.birthdayFrom).toBe('2022-03-02');
  });

  it('🔴 不是用天數除以 365:跨多個閏年仍然對得上日曆', () => {
    // 100 歲:1926-08-26。除以 365 的寫法會漂掉約 24 天(1926 到 2026 有 ~24 個閏日)。
    expect(birthdayRangeForAges(100, undefined, TODAY_2026).birthdayTo).toBe('1926-08-26');
  });
});

describe('parseCustomerListSearchParams — 生日兩軸', () => {
  it('月份合法 ⇒ 進 filter;非法 ⇒ 忽略', () => {
    expect(parseCustomerListSearchParams({ bmonth: '7' }, TODAY).filter.birthMonth).toBe(7);
    expect(parseCustomerListSearchParams({ bmonth: '13' }, TODAY).filter.birthMonth).toBeUndefined();
    expect(parseCustomerListSearchParams({ bmonth: '0' }, TODAY).filter.birthMonth).toBeUndefined();
    expect(parseCustomerListSearchParams({ bmonth: 'x' }, TODAY).filter.birthMonth).toBeUndefined();
  });

  it('🔴 年齡與日期【同源】—— 兩者只在這支函式裡一起被設定', () => {
    // 這一格釘的是 `AdminCustomerFilter.ageMin` docstring 裡那條不變式:
    // ageMin/ageMax(進網址)與 birthdayFrom/To(進查詢)**要嘛都在, 要嘛都不在**。
    // 🔴 只有一半在 ⇒ 「網址說的」與「查詢做的」漂開, 而畫面上看不出來。
    const both = parseCustomerListSearchParams({ agemin: '30', agemax: '40' }, TODAY).filter;
    expect(both.ageMin !== undefined).toBe(both.birthdayTo !== undefined);
    expect(both.ageMax !== undefined).toBe(both.birthdayFrom !== undefined);

    const neither = parseCustomerListSearchParams({}, TODAY).filter;
    expect(neither.ageMin).toBeUndefined();
    expect(neither.birthdayTo).toBeUndefined();

    // 打反 ⇒ 四個都不在(不是一半)
    const swapped = parseCustomerListSearchParams({ agemin: '50', agemax: '20' }, TODAY).filter;
    expect(swapped.ageMin).toBeUndefined();
    expect(swapped.ageMax).toBeUndefined();
    expect(swapped.birthdayFrom).toBeUndefined();
    expect(swapped.birthdayTo).toBeUndefined();
  });

  it('🔴 `agemin=0x1E` 不得被當成 30(非十進位字面量)', () => {
    for (const bad of ['0x1E', '1e2', '0b101', '0o17', '+30', '30.', ' 30 ']) {
      const got = parseCustomerListSearchParams({ agemin: bad }, TODAY).filter.ageMin;
      // ⚠️ ' 30 ' 是例外:trim 後是合法十進位, 它應該過
      if (bad === ' 30 ') expect(got).toBe(30);
      else expect(got, `${bad} 不該被接受`).toBeUndefined();
    }
  });

  it('年齡 ⇒ filter 裡【日期與年齡都有】;而 ageInputs 保留原值給輸入框回填', () => {
    const { filter, ageInputs } = parseCustomerListSearchParams(
      { agemin: '30', agemax: '40' },
      TODAY,
    );
    expect(filter.birthdayTo).toBe('1996-08-26');
    expect(filter.birthdayFrom).toBe('1985-08-27');
    expect(filter.ageMin).toBe(30);
    expect(filter.ageMax).toBe(40);
    expect(ageInputs).toEqual({ min: 30, max: 40, swapped: false });
  });

  it('🔴 上下界打反 ⇒ 當成不限 + 掛 swapped 訊號(不是靜靜回零筆)', () => {
    const { filter, ageInputs } = parseCustomerListSearchParams(
      { agemin: '50', agemax: '20' },
      TODAY,
    );
    expect(filter.birthdayFrom).toBeUndefined();
    expect(filter.birthdayTo).toBeUndefined();
    expect(ageInputs.swapped).toBe(true);
    // 🔴 訊號要在 —— 沒有它的話,「這個條件沒有人」與「你打反了」在畫面上長得一樣。
    // 🔴 而【使用者打的字要留著】(R1 nit):清空的話, 那句警告指不到任何東西 ——
    //    他低頭一看兩格都是空的。
    expect(ageInputs.min).toBe(50);
    expect(ageInputs.max).toBe(20);
  });
});

describe('buildCustomerListHref — 生日兩軸要能翻頁不丟', () => {
  it('月份與年齡都帶得過去 —— 🔴 而年齡是從 filter 讀的, 不是額外參數', () => {
    const href = buildCustomerListHref({ birthMonth: 7, ageMin: 30, ageMax: 40 }, 2);
    expect(href).toContain('bmonth=7');
    expect(href).toContain('agemin=30');
    expect(href).toContain('agemax=40');
  });

  it('🔴 三條真實路徑都不丟年齡 —— 翻頁 / 清關鍵字 / 按欄頭排序', () => {
    // 這一格是 R1 must-fix 1 的證人:上一版年齡走第 4 個 optional 參數,
    // 而這三個呼叫點**全部忘了傳** ⇒ 年齡靜靜消失而月份還在 ⇒ 筆數變多、畫面自洽、零訊號。
    const f = { tier: 'store', birthMonth: 7, ageMin: 30, ageMax: 40 } as const;
    const paths = [
      buildCustomerListHref(f, 2, { key: 'spend', ascending: false }), // 翻頁
      buildCustomerListHref(f, 1), // 清關鍵字
      buildCustomerSortHref(f, undefined, 'orders'), // 按欄頭排序
    ];
    for (const href of paths) {
      expect(href, href).toContain('agemin=30');
      expect(href, href).toContain('agemax=40');
      expect(href, href).toContain('bmonth=7');
    }
  });

  it('🔴 網址帶【年齡】不帶換算後的日期', () => {
    // 日期是衍生值(依賴「今天」)⇒ 存進網址的話,同一條網址明天會篩到不同的人,
    // 而使用者以為自己存的是同一個查詢。
    const href = buildCustomerListHref(
      { ageMin: 30, ageMax: 40, birthdayFrom: '1985-08-27', birthdayTo: '1996-08-26' },
      1,
    );
    expect(href).not.toContain('1985');
    expect(href).not.toContain('1996');
    expect(href).toContain('agemin=30');
  });
});

describe('todayInTaipei — 唯一碰時鐘的地方', () => {
  it('🔴 UTC 還在前一天的那八小時,它已經是今天', () => {
    // 這正是為什麼年齡邊界不能用伺服器的 new Date():
    // 台灣 8/26 早上 7 點 = UTC 8/25 23:00 ⇒ 用 UTC 算會少一天,而畫面完全正常。
    expect(todayInTaipei(new Date('2026-08-25T23:00:00Z'))).toBe('2026-08-26');
    expect(new Date('2026-08-25T23:00:00Z').toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('台灣午夜前一刻仍是當天', () => {
    expect(todayInTaipei(new Date('2026-08-26T15:59:00Z'))).toBe('2026-08-26');
    expect(todayInTaipei(new Date('2026-08-26T16:00:00Z'))).toBe('2026-08-27');
  });
});
