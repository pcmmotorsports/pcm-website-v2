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

function detailWithName(name: string | null): AdminOrderDetail {
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
    shippingAddress: { name: '收件人', phone: '0912345678', line: '新北市新莊區化成路736巷18號' },
    customerUserId: '22222222-2222-4222-8222-222222222222',
    customer: { name, email: 'a@b.c', phone: '0912345678' },
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

describe('PickingDoc · 客人名字的 emoji 濾除【接線】', () => {
  it('🔴 名字含 U+1F3CD 🏍 ⇒ 那顆 emoji 不得出現在紙上, 而中文原樣留著', () => {
    const { container } = render(<PickingDoc detail={detailWithName('王小明🏍')} />);
    expect(container.textContent).toContain('王小明');
    expect(container.textContent).not.toContain('\u{1F3CD}');
  });

  // 🔴 負對照(不可省):純中文名要**逐字**出現。
  //    沒有它, 一個「把客人名字整個不印」的實作也會通過上面那一格。
  it('🔴 純中文名 ⇒ 逐字出現在紙上', () => {
    const { container } = render(<PickingDoc detail={detailWithName('王小明')} />);
    // 🔴 A3-4'(2026-08-29):~~舊版把客人印成一行 `客人:XXX`~~
    //    ⇒ 換成稿的 `.pd-info` 客戶欄(姓名 / 電話 / 地址三格)⇒ 標籤是「姓名」不是「客人」。
    //    📌 本格守的是【emoji 有沒有被濾掉】, 那個目的沒有變 ⇒ 只改錨。
    expect(container.querySelector('.pd-info')?.textContent).toContain('王小明');
  });

  // 🔴 罕用漢字要留著 —— 它同時證明「本片沒有解決域外字那一族」。
  it('🔴 罕用漢字(堃)留著 ⇒ 而那表示它仍可能在 PDF 上變方框(本片未解)', () => {
    const { container } = render(<PickingDoc detail={detailWithName('陳堃')} />);
    expect(container.textContent).toContain('陳堃');
  });

  it('名字整串都是 emoji ⇒ 印「—」而不是空白', () => {
    const { container } = render(<PickingDoc detail={detailWithName('🏍')} />);
    // 🔴 A3-4'(2026-08-29):~~舊版把客人印成一行 `客人:XXX`~~
    //    ⇒ 換成稿的 `.pd-info` 客戶欄(姓名 / 電話 / 地址三格)⇒ 標籤是「姓名」不是「客人」。
    //    📌 本格守的是【emoji 有沒有被濾掉】, 那個目的沒有變 ⇒ 只改錨。
    expect(container.querySelector('.pd-info')?.textContent).toContain('—');
  });

  it('名字為 null ⇒ 印「—」(既有行為不變)', () => {
    const { container } = render(<PickingDoc detail={detailWithName(null)} />);
    // 🔴 A3-4'(2026-08-29):~~舊版把客人印成一行 `客人:XXX`~~
    //    ⇒ 換成稿的 `.pd-info` 客戶欄(姓名 / 電話 / 地址三格)⇒ 標籤是「姓名」不是「客人」。
    //    📌 本格守的是【emoji 有沒有被濾掉】, 那個目的沒有變 ⇒ 只改錨。
    expect(container.querySelector('.pd-info')?.textContent).toContain('—');
  });
});

