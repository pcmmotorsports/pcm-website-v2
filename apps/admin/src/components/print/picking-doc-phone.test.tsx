// @vitest-environment jsdom
//
// picking-doc 的 emoji 濾除【接線】守門(`#240`/Q1-A1)。
//
// 🔴🔴 **這支存在的理由是量出來的, 而它是 A1 最重要的一格**:
//    `strip-pictographs.test.ts` 把那支函式測得很細(7 格 + 負對照),
//    **而我把 `picking-doc.tsx:198` 的呼叫【整個拿掉】之後,
//      `components/print` + `app/print` 共 125 格【一格都沒紅】。**
//    ⇒ 函式有守門, **而「它真的被呼叫」沒有守門**。
//    📌 這正是 memory `feedback_half-done-is-a-spectrum-and-deeper-looks-more-finished`:
//       **有函式要問誰在呼叫。** 一支測得很漂亮而沒有人用的函式, 看起來比空的還完整。

import { describe, expect, it } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { AdminOrderDetail } from '@pcm/domain';
import { PickingDoc } from './picking-doc';

afterEach(cleanup);

const money = (n: number) => ({ amount: n as never, currency: 'TWD' as const });

function detailWithPhones(custPhone: string | null, snapPhone: string | null): AdminOrderDetail {
  const name = '探針客人';
  return {
    id: '11111111-1111-4111-8111-111111111111',
    displayId: 'PCM-2099-0001',
    createdAt: '2099-04-15T10:00:00Z',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'storefront',
    paymentChannel: 'tappay',
    paymentMethod: 'tappay',
    paidAt: '2099-04-15T10:00:00Z',
    subtotal: money(12000),
    shippingFee: money(100),
    discountTotal: money(50),
    total: money(12050),
    shippingMethod: 'home',
    shippingAddress: { name: '收件人', phone: snapPhone, line: '新北市新莊區化成路736巷18號' },
    customerUserId: '22222222-2222-4222-8222-222222222222',
    customer: { name, email: 'a@b.c', phone: custPhone },
    invoiceRequest: { type: 'personal', taxId: null, title: null, carrier: '/ABC1234', donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'pending',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
  } as unknown as AdminOrderDetail;
}

// 🛑 **本檔的 fixture `items: []` ⇒ 四格渲染的是 picking-doc 的「本單不得出貨」版(BlockedSheet),
//    不是正常出貨的那張紙。**(code-reviewer 2026-09-03 nit)
//    行為上仍然打到那一行(突變證實:改回 `??` ⇒ 精準紅 2 格), 而**覆蓋面不要讀寬**:
//    正常出貨那張紙的同一格【本檔沒有測到】。
describe('⟦b4-PICKPHONE1⟧ 出貨的紙上要印得出電話 —— 而空字串不是 NULL', () => {

  // 🔴 期望值從【規格】推, 不是從實作抄:
  //    Sean 2026-08-29 拍板逐字「訂單明細要印電話地址」
  //    ⇒ 只要【任何一個來源有電話】, 紙上就該有那支電話。
  //    而 `customers.phone` 在 DB 裡存的是空字串(2026-09-03 實測 is null=false / length=0)
  //    ⇒ 用 `??` 的話第一個就判「有值」⇒ 不 fallback ⇒ 印空白。

  it('🔴 客戶欄是【空字串】而收件快照有電話 ⇒ 紙上要印快照那一支', () => {
    const { container } = render(<PickingDoc detail={detailWithPhones('', '0987654321')} />);
    expect(container.textContent).toContain('0987654321');
  });

  it('🔵 正對照:客戶欄有電話 ⇒ 照印客戶那一支(證明上面那格不是恆真)', () => {
    const { container } = render(<PickingDoc detail={detailWithPhones('0911222333', '0987654321')} />);
    expect(container.textContent).toContain('0911222333');
  });

  it('🔵 負對照:兩個來源都空 ⇒ 印破折號, 不得印空白', () => {
    // 🛑 scope 到【電話那一格】, 不掃整份 textContent(code-reviewer nit):
    //    掃整份今天有判別力, 而那是碰巧 —— 任何人在別處加一個破折號它就變恆真。
    const { container } = render(<PickingDoc detail={detailWithPhones('', '')} />);
    const cell = [...container.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && el.textContent?.trim() === '—',
    );
    expect(cell, '找不到任何一格印出破折號').toBeTruthy();
  });

  it('🔵 而 null 那條路本來就會過 —— 釘住它, 免得修法把它弄壞', () => {
    const { container } = render(<PickingDoc detail={detailWithPhones(null, '0987654321')} />);
    expect(container.textContent).toContain('0987654321');
  });
});
