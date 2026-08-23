// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

import { OrderInfoCards } from './order-detail-summary-cards';

// order-detail-summary-field-empty.test.tsx — 2026-08-21 線 E 建。
//
// 🔴 **守的是什麼**:`Field` 的空值分支要接得住 **空字串**,不只 `null`。
//    舊寫法是 `{value ?? '—'}` ⇒ `'' ?? '—'` 仍然是 `''` ⇒ 那一格渲染成一個空 `<span>`。
//    真瀏覽器實量(2026-08-21,`localhost:3021` 鑽機、同一張單):
//      電話 span 內容 `""`(什麼都沒有) / 發票號碼 `—`(它是 `null`,舊寫法接得住)
//    ⇒ **同一個元件、兩種結果**,而畫面上「空白」同時相容於
//      【客人沒留電話】與【電話沒載到】—— 員工不知道要不要去跟客人要電話。
//
// ⚠️ **擋得住 / 擋不住**(不要拿它當更強的東西用):
//   擋得住 —— 空值分支被拿掉、被改回只接 `null`、或 `'—'` 被改成別的字。
//   **擋不住** —— ①「—」分不出「沒留」與「沒載到」(那要呼叫端傳兩種不同的空,資料層的事)
//               ②版面/字級 ③`atomic` 那條路的 tooltip 行為。
//
// 🔴 **突變覆核(2026-08-21 當場跑,兩個世界都演過)**:
//   把 `value == null || value === ''` 改回 `value == null` ⇒ 本檔第一格 **紅**
//   (實得 `""`、期望 `"—"`);還原 ⇒ **綠**。負對照那一格兩個世界都綠 ⇒ 它不是靠空值分支過的。

vi.mock('server-only', () => ({}));

const detailWith = (phone: string | null): AdminOrderDetail =>
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
    customer: { name: '沈佑霖', phone, email: null },
    customerUserId: null,
    shippingAddress: { name: null, phone: null, line: null },
    total: { amount: 23800, currency: 'TWD' },
    items: [],
    itemsTruncated: false,
    notes: [],
  }) as unknown as AdminOrderDetail;

/**
 * 取【標籤是 `label` 的那一列】的值,不讀整個容器的文字。
 *
 * 🔴 **為什麼不用 `container.textContent`**:同一份卡片上還有「姓名」「Email」等好幾格,
 *    而 `—` 在別格也會出現(發票號碼/發票金額本來就是 `—`)
 *    ⇒ `toContain('—')` 在電話那格印成空白時**照樣會綠**。這正是隔壁
 *    `order-detail-headline.test.tsx` 的檔頭記過的同一個坑。
 * 🔴 **量具自檢**:找不到那一列就 throw —— 「找不到」與「值不對」必須分得開,
 *    否則整格被刪掉時這條斷言會因為什麼都沒有而變綠。
 */
function fieldValue(detail: AdminOrderDetail, label: string): string {
  const { container } = render(
    <OrderInfoCards detail={detail} />,
  );
  const row = [...container.querySelectorAll('div')].find(
    (el) => el.children.length === 2 && el.children[0]?.textContent === label,
  );
  if (!row) throw new Error(`找不到標籤為「${label}」的那一列 —— 整格被刪掉了?`);
  return row.children[1]?.textContent ?? '';
}

describe('Field 空值分支', () => {
  afterEach(cleanup);

  it("🔴 電話是**空字串**時印「—」,不是印一片空白(`?? ` 接不住 `''`)", () => {
    expect(fieldValue(detailWith(''), '電話')).toBe('—');
  });

  it('🔴 電話是 `null` 時同樣印「—」(舊寫法本來就過,這一格防修法改壞它)', () => {
    expect(fieldValue(detailWith(null), '電話')).toBe('—');
  });

  it('🔴 **負對照**:電話有值時原樣印出來 —— 少了它,把整格寫死成「—」也會全綠', () => {
    expect(fieldValue(detailWith('0912345678'), '電話')).toBe('0912345678');
  });
});
