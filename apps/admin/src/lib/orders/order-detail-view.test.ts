// order-detail-view.test.ts — 訂單明細顯示層純函式單測(M-4a Slice B)。

import { describe, it, expect } from 'vitest';
import {
  isOrderId,
  invoiceTypeLabel,
  shippingMethodLabel,
  customerDetailHref,
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
  // 🔴 `INVOICE_STATUS_LABEL` 三值標籤那條**隨常數搬到 `order-list-view.test.ts`**
  //    (A11a-5:發票欄進列表後它成了共用標籤)。測試跟著程式碼走,不留在這裡。

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

// OD 片 2(R2 important①):fail-closed 從 docstring 改成機制,這裡是那個機制的守門。
describe('customerDetailHref — 客人明細入口網址', () => {
  it('有 id → 拼出 /customers/<id>', () => {
    expect(customerDetailHref('cu-1')).toBe('/customers/cu-1');
  });

  /**
   * 🔴 這兩格是本片存在的理由。上一版靠「型別 string | null 會逼消費端處理」,
   * 但 TS 樣板字串接受 null、本 repo 未開 restrict-template-expressions
   * ⇒ `/customers/${x}` 在 x=null 時 typecheck 綠 lint 綠、產出 `/customers/null`。
   * 收斂到這一個函式之後,呼叫端拿到 null 只能不渲染,拼不出壞路徑。
   */
  it.each([
    ['null(投影退版 / 讀不到)', null],
    ['空字串(拼出來會變 /customers/)', ''],
  ])('🔴 %s → 回 null,不得拼出網址', (_label, input) => {
    expect(customerDetailHref(input)).toBeNull();
  });

  it('🔴 回傳值不得含字面 null / undefined(擋「把缺值 stringify 進網址」那種寫法)', () => {
    for (const input of [null, '']) {
      const href = customerDetailHref(input);
      expect(href === null || (!href.includes('null') && !href.includes('undefined'))).toBe(true);
    }
  });
});
