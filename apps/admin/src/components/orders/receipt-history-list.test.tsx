// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ReceiptHistoryList } from './receipt-history-list';
import type { OrderItemReceiptRow } from '../../lib/orders/receipt-repository';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';

vi.mock('server-only', () => ({}));
// 🆕 2026-09-14:`ReceiptDeleteButton` 讀 `useRouter`(列表到貨彈窗撤完要導回列表);jsdom 沒掛 app router ⇒ 保留真模組、只換這一支。
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));

const ITEM = 'item-1';

function receipt(over: Partial<OrderItemReceiptRow> = {}): OrderItemReceiptRow {
  return {
    id: 'rc-1',
    orderItemId: ITEM,
    quantity: 3,
    surplusQuantity: 0,
    receivedAt: '2026-09-01T00:00:00.000Z',
    receivedBy: 'sean',
    note: null,
    ...over,
  };
}

function blockingGroup(): OrderShipmentGroup {
  return {
    shipment: { id: 'sh-1', shipmentReference: 'SH-001', shippedAt: null, voidedAt: null },
    lines: [{ orderItemId: ITEM, title: '零件', quantity: 1 }],
  } as unknown as OrderShipmentGroup;
}

afterEach(() => cleanup());

const WIRE = { orderId: 'o-1', returnTo: '/orders/o-1' } as const;

describe('ReceiptHistoryList — 逐筆到貨列表(#450)', () => {
  // 🔴🔴 **這是本片最貴的一個錯:撤掉【別筆】。**
  //    突變證過:把每一列的 `receiptId={r.id}` 改成 `mine[0].id` ⇒ **typecheck 零錯、全套零紅**
  //    ⇒ 📌 一個「刪錯一筆不可逆資料」的缺陷, 在編譯與既有測試上**完全沒有形狀**。
  //    ⇒ ⇒ 所以這一格不驗「有沒有鈕」, 驗的是**每一顆鈕帶的 id 各不相同、且對得上那一列**。
  it('🔴 每一列的撤銷表單要帶【自己那一筆】的 id, 不是全部帶同一個', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ id: 'rc-1' }), receipt({ id: 'rc-2' }), receipt({ id: 'rc-3' })]}
        shipmentGroups={[]}
      />,
    );
    const ids = [...container.querySelectorAll('input[name="receipt_id"]')].map((el) =>
      el.getAttribute('value'),
    );
    expect(ids).toEqual(['rc-1', 'rc-2', 'rc-3']);
  });

  it('🔴 被包裹擋住 ⇒ 那句話印【一次】, 而每一列都【沒有】撤銷鈕', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ id: 'rc-1' }), receipt({ id: 'rc-2' })]}
        shipmentGroups={[blockingGroup()]}
      />,
    );
    // 🎯 一次 —— 它是**品項級**的事實, 不是逐列的。
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.textContent).toContain('這個品項已經包進出貨單');
    expect(container.textContent).toContain('SH-001');
    // 🔴🔴 **而每一列【照樣有鈕】—— 這一格 2026-09-03 翻面了。**
    //    ⛔ ~~原本斷言 blocked 時零鈕~~ ⇒ 而那建立在一個**假前提**上:
    //    我以為「撤不撤得掉」是品項級的全中或全不中。
    //    🛑 codex 抓到 DB 還有**第二層**守門(刪掉之後重算 instock, 與**那一筆的數量**有關)
    //    ⇒ 同一品項底下, 撤 1 件那筆可能過、撤 3 件那筆可能不過。
    //    ⇒ 📌 **拿一個算不準的預測去關掉一條真的可能走得通的路, 比多按一次貴得多。**
    expect(container.querySelectorAll('input[name="receipt_id"]')).toHaveLength(2);
    // 🔵 而那兩列本身**要看得到** —— 那筆到貨仍然是事實。
    expect(container.textContent).toContain('2026-09-01');
  });

  it('🔵 負對照:沒有包裹擋 ⇒ 沒有那句話, 而每一列都有鈕', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt(), receipt({ id: 'rc-2' })]}
        shipmentGroups={[]}
      />,
    );
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('input[name="receipt_id"]')).toHaveLength(2);
    // 🔵 兩個世界的差別現在**只在那句提醒**, 不在鈕的有無 —— 這一行把它釘住。
    expect(container.textContent).not.toContain('已經包進出貨單');
  });

  it('🔴 `receipts` 是 null ⇒ 說「讀不到」, 而**不是**靜靜地不列', () => {
    const { container } = render(
      <ReceiptHistoryList {...WIRE} orderItemId={ITEM} receipts={null} shipmentGroups={[]} />,
    );
    // 🛑 少了這一格, 讀取失敗與「這個品項沒有到貨」在畫面上長一模一樣。
    expect(container.textContent).toContain('讀不到');
  });

  it('🔵 負對照:別的品項的到貨不得混進來(這是逐品項的清單)', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ id: 'mine' }), receipt({ id: 'other', orderItemId: 'item-2' })]}
        shipmentGroups={[]}
      />,
    );
    const ids = [...container.querySelectorAll('input[name="receipt_id"]')].map((el) =>
      el.getAttribute('value'),
    );
    expect(ids).toEqual(['mine']);
  });

  it('🔵 這個品項零到貨 ⇒ 整區不畫(不要留一個空標題)', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ id: 'other', orderItemId: 'item-2' })]}
        shipmentGroups={[]}
      />,
    );
    expect(container.textContent).toBe('');
  });
});

// ── 🔴 到貨日期要印【台北】那一天,不是 UTC 那一天(2026-09-20 走查正式站撞到)────────────
//    🔬 實例:員工凌晨 02:22(台北)登記 ⇒ 舊碼 `receivedAt.slice(0, 10)` 切的是 ISO 前十碼
//       = UTC 牆上日期 = 前一天 ⇒ 清單印「2026-09-19」。
//    🎯 **存進去的是對的** —— `receipt-actions.ts:120` 走 `toTaipeiIso`,而且如果存錯了
//       (把台北當成 UTC 存)這一格印出來會是 09-20 不是 09-19 ⇒ 觀察到的 09-19 反而證明存對了。
//    ⇒ 📌 所以這是**只在顯示層**的錯,修顯示就好,不要去動已經存進去的資料。
describe('ReceiptHistoryList — 到貨日期用台北時區,不是 UTC', () => {
  it('台北 2026-09-20 02:22 登記(= UTC 09-19 18:22)⇒ 印 2026-09-20', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ receivedAt: '2026-09-19T18:22:00.000Z' })]}
        shipmentGroups={[]}
      />,
    );
    const text = container.textContent ?? '';
    expect(text, '印出來要是台北那一天').toContain('2026-09-20');
    expect(text, '不可以印 UTC 那一天').not.toContain('2026-09-19');
  });

  // ⚪ 負對照:一個【台北與 UTC 同一天】的時點, 兩種寫法都會過 ⇒ 它證不到這件事。
  //    留著是為了證明上面那一格【不是恆紅也不是恆綠】:換成這個時點, 舊碼也會通過。
  it('負對照:台北 2026-09-19 14:00(= UTC 同日 06:00)⇒ 兩種寫法都印 2026-09-19', () => {
    const { container } = render(
      <ReceiptHistoryList
        {...WIRE}
        orderItemId={ITEM}
        receipts={[receipt({ receivedAt: '2026-09-19T06:00:00.000Z' })]}
        shipmentGroups={[]}
      />,
    );
    expect(container.textContent ?? '').toContain('2026-09-19');
  });
});
