// list-params.test.ts — 後台列表通用純工具單測(分頁數學 / param 解析 / 連結建構)。

import { describe, it, expect } from 'vitest';
import {
  firstValue,
  pickEnum,
  pickEnumMulti,
  allValues,
  parsePage,
  computePagination,
  buildListHref,
  detectPageTruncation,
  pageWindow,
} from './list-params';

describe('firstValue / pickEnum', () => {
  it('firstValue:string[] 取首個、string 直回、undefined 回 undefined', () => {
    expect(firstValue(['a', 'b'])).toBe('a');
    expect(firstValue('x')).toBe('x');
    expect(firstValue(undefined)).toBeUndefined();
  });

  it('pickEnum:命中白名單回值、非法 / 空 / 缺回 undefined', () => {
    const allowed = ['red', 'blue'] as const;
    expect(pickEnum('red', allowed)).toBe('red');
    expect(pickEnum(['blue', 'red'], allowed)).toBe('blue');
    expect(pickEnum('green', allowed)).toBeUndefined();
    expect(pickEnum('', allowed)).toBeUndefined();
    expect(pickEnum(undefined, allowed)).toBeUndefined();
    expect(pickEnum('red; DROP', allowed)).toBeUndefined(); // 注入不透傳
  });

  it('allValues:string → 單元素、string[] 原樣、缺 → 空陣列', () => {
    expect(allValues('a')).toEqual(['a']);
    expect(allValues(['a', 'b'])).toEqual(['a', 'b']);
    expect(allValues(undefined)).toEqual([]);
  });

  it('pickEnumMulti:收全部白名單命中值+去重保序;全非法 / 缺 → undefined', () => {
    const allowed = ['red', 'blue'] as const;
    expect(pickEnumMulti(['red', 'blue'], allowed)).toEqual(['red', 'blue']);
    expect(pickEnumMulti(['blue', 'red', 'blue'], allowed)).toEqual(['blue', 'red']); // 去重保序
    expect(pickEnumMulti('red', allowed)).toEqual(['red']); // 單值也走多值形狀
    expect(pickEnumMulti(['red', 'green'], allowed)).toEqual(['red']); // 非法逐值剔除
    expect(pickEnumMulti(['green', ''], allowed)).toBeUndefined();
    expect(pickEnumMulti(undefined, allowed)).toBeUndefined();
  });
});

describe('parsePage — 頁碼下界 1', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['0', 1],
    ['-2', 1],
    ['1.5', 1],
    ['abc', 1],
    ['5', 5],
  ])('%s → %i', (raw, expected) => {
    expect(parsePage(raw as string | undefined)).toBe(expected);
  });
});

describe('computePagination — range 由真實 shownCount 推導、永不謊報', () => {
  it('total 0 / shownCount 0 → totalPages 1、range 0、無上下頁', () => {
    expect(computePagination(0, 1, 20, 0)).toEqual({
      totalPages: 1,
      currentPage: 1,
      hasPrev: false,
      hasNext: false,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });

  it('37 筆 / 每頁 20 / 第 1 頁(本頁 20 列)→ 1–20、有下頁無上頁', () => {
    expect(computePagination(37, 1, 20, 20)).toEqual({
      totalPages: 2,
      currentPage: 1,
      hasPrev: false,
      hasNext: true,
      rangeStart: 1,
      rangeEnd: 20,
    });
  });

  it('37 筆 / 每頁 20 / 第 2 頁(本頁 17 列)→ 21–37、有上頁無下頁', () => {
    expect(computePagination(37, 2, 20, 17)).toEqual({
      totalPages: 2,
      currentPage: 2,
      hasPrev: true,
      hasNext: false,
      rangeStart: 21,
      rangeEnd: 37,
    });
  });

  it('page 超界(第 99 頁、本頁 0 列)→ range 0、currentPage clamp、可退回', () => {
    expect(computePagination(37, 99, 20, 0)).toEqual({
      totalPages: 2,
      currentPage: 2,
      hasPrev: true,
      hasNext: false,
      rangeStart: 0,
      rangeEnd: 0,
    });
  });

  it('整除邊界:40 筆 / 每頁 20 / 第 2 頁(本頁 20 列)→ 21–40、無下頁', () => {
    expect(computePagination(40, 2, 20, 20)).toMatchObject({
      totalPages: 2,
      hasNext: false,
      rangeStart: 21,
      rangeEnd: 40,
    });
  });
});

describe('buildListHref — 連結建構', () => {
  it('無篩選 + page 1 → path(乾淨)', () => {
    expect(buildListHref('/orders', [], 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留有值鍵 + page;空值鍵略過', () => {
    const href = buildListHref(
      '/orders',
      [
        ['payment_status', 'paid'],
        ['order_source', 'web'],
        ['payment_channel', undefined],
      ],
      2,
    );
    expect(href).toContain('/orders?');
    expect(href).toContain('payment_status=paid');
    expect(href).toContain('order_source=web');
    expect(href).not.toContain('payment_channel');
    expect(href).toContain('page=2');
  });

  it('page 1 省略 page 參數(但保留篩選)', () => {
    const href = buildListHref('/customers', [['tier', 'store']], 1);
    expect(href).toContain('tier=store');
    expect(href).not.toContain('page=');
  });

  it('自訂 pageParam 名', () => {
    expect(buildListHref('/x', [], 3, 'p')).toBe('/x?p=3');
  });

  it('多勾選軸 string[] → 同鍵重複 param 保序;空陣列略過(D-1b)', () => {
    const href = buildListHref(
      '/orders',
      [
        ['order_source', ['web', 'manual_line']],
        ['payment_channel', []],
      ],
      1,
    );
    expect(href).toBe('/orders?order_source=web&order_source=manual_line');
  });
});

// ─────────────── 商品分頁片(2026-08-19)

describe('detectPageTruncation', () => {
  // 🔴 **先寫負向對照,而且它排第一。**
  //    理由(`docs/patterns/guard-and-instrument-traps.md` 第一個母題):一個恆回 `null` 的
  //    守門,配上底下那堆「完整的頁 ⇒ null」的斷言,會**全部綠**。
  //    ⇒ 沒有這一發,這個不變式證不了自己有判別力。
  describe('🔴 負向對照:這些【必須】被抓到', () => {
    it('伺服器把 1000 列的頁砍成 500(非末頁)⇒ 抓到少 500 列', () => {
      // 20,341 件、第 1 頁、每頁 1000 ⇒ 應該滿 1000 列,實際只回 500
      const hit = detectPageTruncation(20341, 1, 1000, 500);
      expect(hit).not.toBeNull();
      expect(hit?.missing).toBe(500);
      expect(hit?.expected).toBe(1000);
      expect(hit?.shownCount).toBe(500);
      expect(hit?.offset).toBe(0);
    });

    it('中間某頁(第 87 頁)被砍 ⇒ 一樣抓得到', () => {
      // offset = 86 * 200 = 17,200;剩 3,141 列 ⇒ 應滿 200
      const hit = detectPageTruncation(20341, 87, 200, 199);
      expect(hit?.missing).toBe(1);
      expect(hit?.offset).toBe(17200);
    });

    it('少一列也要抓到 —— 這個病的實際症狀就是【少幾筆】,不是全空', () => {
      expect(detectPageTruncation(1000, 1, 200, 199)?.missing).toBe(1);
    });

    it('列比 total 允許的還多 ⇒ 也是異常(missing 為負)', () => {
      // total 說只剩 5 列,卻回了 20 列 ⇒ 兩個數字互相矛盾
      expect(detectPageTruncation(205, 2, 200, 20)?.missing).toBe(-15);
    });
  });

  describe('完整的頁 ⇒ null(不得誤報)', () => {
    it('滿頁', () => {
      expect(detectPageTruncation(20341, 1, 200, 200)).toBeNull();
    });

    it('末頁不滿,是正常的', () => {
      // 20,341 ÷ 200 ⇒ 第 102 頁 offset 20,200、剩 141 列
      expect(detectPageTruncation(20341, 102, 200, 141)).toBeNull();
    });

    it('恰好整除時的末頁', () => {
      expect(detectPageTruncation(400, 2, 200, 200)).toBeNull();
    });

    it('超界頁(網址被手改成 page=999)⇒ 空頁是對的,不是截斷', () => {
      expect(detectPageTruncation(20341, 999, 200, 0)).toBeNull();
    });

    it('零筆資料', () => {
      expect(detectPageTruncation(0, 1, 200, 0)).toBeNull();
    });
  });

  // 🔴 這一組釘住「白名單封頂 1000」的理由:它必須在【上限被改小】時仍然有效。
  it('伺服器上限被改成 300 而頁大小仍是 1000 ⇒ 照樣抓到(本函式不讀那個設定)', () => {
    expect(detectPageTruncation(20341, 1, 1000, 300)?.missing).toBe(700);
  });
});

describe('pageWindow', () => {
  it('總頁數 <= 窗寬 ⇒ 全部列出', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('第 1 頁 ⇒ 貼左邊,而【仍然是 10 個】(不是 6 個)', () => {
    // 🔴 這一條就是「前 5 後 5」寫法會壞掉的地方 —— 它在第 1 頁只給得出 6 個
    expect(pageWindow(1, 102)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('第 87 頁 ⇒ 窗滑過去、含 87', () => {
    const w = pageWindow(87, 102);
    expect(w).toHaveLength(10);
    expect(w).toContain(87);
    expect(w).toEqual([83, 84, 85, 86, 87, 88, 89, 90, 91, 92]);
  });

  it('最後一頁 ⇒ 貼右邊,長度仍是 10', () => {
    expect(pageWindow(102, 102)).toEqual([93, 94, 95, 96, 97, 98, 99, 100, 101, 102]);
  });

  it('任何頁都必定含 current,而且連續遞增 1', () => {
    for (const p of [1, 2, 5, 6, 50, 97, 98, 102]) {
      const w = pageWindow(p, 102);
      expect(w).toContain(p);
      expect(w.every((n, i) => i === 0 || n === w[i - 1]! + 1)).toBe(true);
      expect(w[0]).toBeGreaterThanOrEqual(1);
      expect(w[w.length - 1]).toBeLessThanOrEqual(102);
    }
  });

  it('只有 1 頁', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('零頁(total 0 ⇒ totalPages 被 computePagination 保底成 1)也不得回空陣列', () => {
    expect(pageWindow(1, 0)).toEqual([1]);
  });
});
