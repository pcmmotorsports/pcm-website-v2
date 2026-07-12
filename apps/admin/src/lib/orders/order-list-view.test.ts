// order-list-view.test.ts — 訂單列表顯示層純函式單測(M-4a 訂單線第一片)。
// 訂單專屬:searchParams 白名單守門 / buildOrderListHref / 標籤覆蓋 / 格式化。
// 通用分頁數學 / parsePage 的測試在 ../shared/list-params.test.ts。

import { describe, it, expect } from 'vitest';
import {
  parseOrderListSearchParams,
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

  it('非法篩選值一律忽略(等同不篩選、注入不透傳)', () => {
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
    const { filter } = parseOrderListSearchParams({ payment_status: ['unpaid', 'paid'] });
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

describe('buildOrderListHref — 訂單連結(保留篩選、page=1 省略)', () => {
  it('無篩選 + page 1 → /orders(乾淨)', () => {
    expect(buildOrderListHref({}, 1)).toBe('/orders');
  });

  it('帶篩選 + page>1 → 保留篩選 + page', () => {
    const href = buildOrderListHref({ paymentStatus: 'paid', orderSource: 'web' }, 2);
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

describe('標籤覆蓋 — 每個 enum 值皆有中文標籤', () => {
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
