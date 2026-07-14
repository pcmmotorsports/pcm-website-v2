// order-detail-view.test.ts — 訂單明細顯示層純函式單測(M-4a Slice B)。

import { describe, it, expect } from 'vitest';
import {
  isOrderId,
  INVOICE_STATUS_LABEL,
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from './order-detail-view';

describe('isOrderId — 路由 id 形狀守門(非法直接 404、不打 DB)', () => {
  it('合法 UUID(大小寫皆可)→ true', () => {
    expect(isOrderId('11111111-2222-3333-4444-555555555555')).toBe(true);
    expect(isOrderId('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('非法形狀(display_id/注入/空/截斷)→ false', () => {
    for (const bad of ['PCM-2026-0001', "1' OR '1'='1", '', '11111111-2222', 'not-a-uuid']) {
      expect(isOrderId(bad)).toBe(false);
    }
  });
});

describe('標籤', () => {
  it('開票紀錄狀態三值皆有標籤', () => {
    expect(INVOICE_STATUS_LABEL.not_issued).toBe('未開立');
    expect(INVOICE_STATUS_LABEL.issued).toBe('已開立');
    expect(INVOICE_STATUS_LABEL.voided).toBe('已作廢');
  });

  it('開票需求型式:personal/company 中文、未知值原樣、null 透傳', () => {
    expect(invoiceTypeLabel('personal')).toBe('個人(二聯)');
    expect(invoiceTypeLabel('company')).toBe('公司(三聯)');
    expect(invoiceTypeLabel('donate')).toBe('donate');
    expect(invoiceTypeLabel(null)).toBeNull();
  });

  it('出貨方式:home → 宅配、未知值原樣(Slice C 起 admin 可改)', () => {
    expect(shippingMethodLabel('home')).toBe('宅配');
    expect(shippingMethodLabel('DHL Express')).toBe('DHL Express');
  });
});

describe('formatOrderDateTime — Asia/Taipei YYYY-MM-DD HH:mm', () => {
  it('UTC → 台北(+8)含時分、跨日正確', () => {
    expect(formatOrderDateTime('2099-04-15T16:30:00Z')).toBe('2099-04-16 00:30');
    expect(formatOrderDateTime('2099-04-15T02:05:00Z')).toBe('2099-04-15 10:05');
  });
});
