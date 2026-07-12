// order-list-view.test.ts — 後台訂單列表顯示層純函式單測(M-4a 訂單線第一片)。
// 純函式、無 server-only / DB;涵蓋 searchParams 白名單守門、分頁數學、連結建構、標籤覆蓋、格式化。

import { describe, it, expect } from 'vitest';
import {
  parseOrderListSearchParams,
  parsePage,
  computePagination,
  buildOrderListHref,
  formatOrderDate,
  formatOrderAmount,
  ORDERS_PAGE_SIZE,
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  PAYMENT_STATUS_VALUES,
  FULFILLMENT_STATUS_VALUES,
  ORDER_SOURCE_VALUES,
  PAYMENT_CHANNEL_VALUES,
} from './order-list-view';

describe('parseOrderListSearchParams — 白名單守門', () => {
  it('合法四軸值 → filter 帶入;page 解析', () => {
    const { filter, page } = parseOrderListSearchParams({
      payment_status: 'paid',
      fulfillment_status: 'shipped',
      order_source: 'manual_line',
      payment_channel: 'bank_transfer',
      page: '3',
    });
    expect(filter).toEqual({
      paymentStatus: 'paid',
      fulfillmentStatus: 'shipped',
      orderSource: 'manual_line',
      paymentChannel: 'bank_transfer',
    });
    expect(page).toBe(3);
  });

  it('非法篩選值一律忽略(等同不篩選)', () => {
    const { filter } = parseOrderListSearchParams({
      payment_status: 'HACK',
      fulfillment_status: '',
      order_source: 'web; DROP',
      payment_channel: 'paypal',
    });
    expect(filter).toEqual({
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
      orderSource: undefined,
      paymentChannel: undefined,
    });
  });

  it('string[] 值取首個', () => {
    const { filter } = parseOrderListSearchParams({
      payment_status: ['unpaid', 'paid'],
    });
    expect(filter.paymentStatus).toBe('unpaid');
  });

  it('缺 searchParams → 全 undefined + page 1', () => {
    const { filter, page } = parseOrderListSearchParams({});
    expect(filter).toEqual({
      paymentStatus: undefined,
      fulfillmentStatus: undefined,
      orderSource: undefined,
      paymentChannel: undefined,
    });
    expect(page).toBe(1);
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

describe('computePagination — 分頁數學(range 由真實 shownCount 推導、永不謊報)', () => {
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

  it('🔴 nit 修正:page 超界(第 99 頁、本頁 0 列)→ range 0(footer 不謊報有列)、currentPage clamp 2、可退回', () => {
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

describe('buildOrderListHref — 連結建構', () => {
  it('無篩選 + page 1 → /orders(乾淨)', () => {
    expect(buildOrderListHref({}, 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留篩選 + page', () => {
    const href = buildOrderListHref(
      { paymentStatus: 'paid', orderSource: 'web' },
      2,
    );
    expect(href).toContain('/orders?');
    expect(href).toContain('payment_status=paid');
    expect(href).toContain('order_source=web');
    expect(href).toContain('page=2');
  });

  it('page 1 省略 page 參數(但保留篩選)', () => {
    const href = buildOrderListHref({ fulfillmentStatus: 'shipped' }, 1);
    expect(href).toContain('fulfillment_status=shipped');
    expect(href).not.toContain('page=');
  });
});

describe('標籤覆蓋 — 每個 enum 值皆有中文標籤(漏 key = 編譯期紅,執行期再核非空)', () => {
  it('付款狀態', () => {
    for (const v of PAYMENT_STATUS_VALUES) expect(PAYMENT_STATUS_LABEL[v]).toBeTruthy();
  });
  it('出貨狀態', () => {
    for (const v of FULFILLMENT_STATUS_VALUES) expect(FULFILLMENT_STATUS_LABEL[v]).toBeTruthy();
  });
  it('來源', () => {
    for (const v of ORDER_SOURCE_VALUES) expect(ORDER_SOURCE_LABEL[v]).toBeTruthy();
  });
  it('管道', () => {
    for (const v of PAYMENT_CHANNEL_VALUES) expect(PAYMENT_CHANNEL_LABEL[v]).toBeTruthy();
  });
});

describe('格式化', () => {
  it('formatOrderDate:UTC timestamptz → Asia/Taipei YYYY-MM-DD(避 off-by-one)', () => {
    // 2099-04-15T16:30:00Z = 台灣 2099-04-16 00:30 → 應顯 04-16(非 04-15)
    expect(formatOrderDate('2099-04-15T16:30:00Z')).toBe('2099-04-16');
  });

  it('formatOrderAmount:整數元位千分位(非分、不除 100)', () => {
    expect(formatOrderAmount(5200)).toBe('5,200');
    expect(formatOrderAmount(0)).toBe('0');
    expect(formatOrderAmount(1234567)).toBe('1,234,567');
  });

  it('ORDERS_PAGE_SIZE = 20', () => {
    expect(ORDERS_PAGE_SIZE).toBe(20);
  });
});
