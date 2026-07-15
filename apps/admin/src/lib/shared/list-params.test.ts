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
        ['workflow_status', ['paid_wait', 'unset']],
        ['order_source', []],
      ],
      1,
    );
    expect(href).toBe('/orders?workflow_status=paid_wait&workflow_status=unset');
  });
});
