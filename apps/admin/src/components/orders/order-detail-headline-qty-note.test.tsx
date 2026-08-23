// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

import { OrderFocalRow } from './order-detail-summary-cards';

// order-detail-headline-qty-note.test.tsx — 2026-08-21 線 E 建。
//
// 🔴 **守的是什麼**:頭條「件數 已訂 / 到貨」答不出來時,旁邊那一行要**講對是哪一種答不出來**。
//    修之前:三條路共用一個裸「未知」——24px、整個面板最大的字,**沒說原因、沒說怎麼辦**。
//    (同一個面板裡的取消區早就有正確形狀:原因 + 下一步 + 「這不是你操作錯誤」。)
//
// 🔴 **三條路的【下一步】不同,所以不能共用一句話**:
//    truncated 品項清單沒完整載入 ⇒ 重新整理
//    noItems   這張單根本沒有品項 ⇒ 沒有東西要做
//    notReady  數量資料還沒建立   ⇒ 去看標「數量資料尚未就緒」的那幾項 / 找系統維護
//
// ⚠️ **擋得住 / 擋不住**:
//   擋得住 —— 三條路任兩條被合併成同一句、某一句被刪掉、有值時多印了一行。
//   **擋不住** —— ①那三句話的**用字**對不對(那是 Sean 的,本檔只釘「三句互不相同且各自出現在對的路上」)
//               ②`notReady` 那條重新整理到底有沒有用(**未驗** ⇒ 那句話刻意不提重整)
//               ③版面/字級。

vi.mock('server-only', () => ({}));

const SUMMARY = {
  quantity: 2,
  orderedQuantity: 2,
  instockQuantity: 1,
  shippedQuantity: 0,
  cancelledQuantity: 0,
};

const detailWith = (over: Record<string, unknown>): AdminOrderDetail =>
  ({
    id: '11111111-1111-4111-8111-111111111111',
    displayId: 'ABC123',
    createdAt: '2026-08-10T02:00:00+00:00',
    paymentStatus: 'partiallyPaid',
    invoiceStatus: 'not_issued',
    paidAt: null,
    cancelledAt: null,
    orderSource: 'storefront',
    paymentChannel: 'tappay',
    shippingMethod: 'homeDelivery',
    invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: null },
    invoiceNumber: null,
    invoiceAmount: null,
    customer: { name: '沈佑霖', phone: null, email: null },
    customerUserId: null,
    shippingAddress: { name: null, phone: null, line: null },
    total: { amount: 23800, currency: 'TWD' },
    items: [{ id: 'i1', quantity: 2, quantitySummary: SUMMARY }],
    itemsTruncated: false,
    notes: [],
    ...over,
  }) as unknown as AdminOrderDetail;

/**
 * 取【小標是「件數 已訂 / 到貨」的那一格】的全文,不讀整個容器。
 *
 * 🔴 **為什麼不用 `container.textContent`**:左邊兩格在 `unknown` 態也會印「未知」
 *    ⇒ `toContain` 分不出是誰印的。隔壁 `order-detail-headline.test.tsx` 的檔頭
 *    記著這把尺第一版就是這樣被突變測試打回來的。
 * 🔴 **量具自檢**:找不到那一格就 throw —— 「找不到」與「值不對」必須分得開。
 */
function qtyCell(detail: AdminOrderDetail): string {
  const { container } = render(
    <OrderFocalRow detail={detail} payments={{ status: 'ok', rows: [] } as never} />,
  );
  const section = [...container.querySelectorAll('section')].find(
    (el) => el.querySelector('p:last-of-type')?.textContent === '件數 已訂 / 到貨',
  );
  if (!section) throw new Error('找不到小標為「件數 已訂 / 到貨」的那一格 —— 整格被刪掉了?');
  return section.textContent ?? '';
}

describe('頭條「件數」答不出來時,旁邊那一行', () => {
  afterEach(cleanup);

  it('🔴 `truncated`(品項清單沒完整載入)⇒ 講「沒有完整載入」並叫他重新整理', () => {
    const t = qtyCell(detailWith({ itemsTruncated: true }));
    expect(t).toContain('未知');
    expect(t).toContain('沒有完整載入');
    expect(t).toContain('請重新整理');
  });

  it('🔴 `noItems`(零品項單)⇒ 講「沒有任何品項」,**不得**叫他重新整理或去找維護', () => {
    const t = qtyCell(detailWith({ items: [] }));
    expect(t).toContain('未知');
    expect(t).toContain('沒有任何品項');
    expect(t).not.toContain('請重新整理');
    expect(t).not.toContain('系統維護');
  });

  it('🔴 `notReady`(數量資料還沒建立)⇒ 指去標記那幾項 + 找誰,而**刻意不提重新整理**(重整有沒有用未驗)', () => {
    const t = qtyCell(detailWith({ items: [{ id: 'i1', quantity: 2, quantitySummary: null }] }));
    expect(t).toContain('未知');
    expect(t).toContain('數量資料尚未就緒');
    expect(t).toContain('系統維護');
    expect(t).not.toContain('請重新整理');
  });

  it('🔴 三條路**互不相同** —— 少了這一格,把三句寫成同一句也會全綠', () => {
    const a = qtyCell(detailWith({ itemsTruncated: true }));
    cleanup();
    const b = qtyCell(detailWith({ items: [] }));
    cleanup();
    const c = qtyCell(detailWith({ items: [{ id: 'i1', quantity: 2, quantitySummary: null }] }));
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it('🔴 **負對照**:算得出件數時只印數字、**不多印那一行** —— 少了它,無條件印一行也會全綠', () => {
    const t = qtyCell(detailWith({}));
    expect(t).toContain('2 / 1');
    expect(t).not.toContain('未知');
    expect(t).not.toContain('算不出件數');
  });
});
