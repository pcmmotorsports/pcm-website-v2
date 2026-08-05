// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail, AdminOrderItemProcurement } from '@pcm/domain';
import type { ProcurementActionState } from '../../lib/orders/procurement-action-state';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn<
    (prev: ProcurementActionState, form: FormData) => Promise<ProcurementActionState>
  >(),
}));
// `procurement-suppliers` → `lib/supplier.ts` → `supplier-repository.ts` → server-only。
// 只 mock 倉庫層,排序仍走真的那一把。
vi.mock('../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));

import { ItemProcurementSection } from './item-procurement-section';

const SUP_A = '33333333-3333-4333-8333-333333333333';
const SUP_B = '44444444-4444-4444-8444-444444444444';

function proc(over: Partial<AdminOrderItemProcurement> = {}): AdminOrderItemProcurement {
  return {
    id: 'p-1',
    supplierId: SUP_A,
    supplierLabel: 'RPM Carbon',
    supplierIsActive: true,
    allocatedQuantity: 3,
    receivedQuantity: 1,
    replyStatus: 'partial',
    contactChannel: 'LINE',
    submittedAt: null,
    supplierOrderNo: 'SO-123',
    exceptionReason: '原廠缺料',
    expectedArrivalDate: '2026-09-30',
    firstOrderedAt: null,
    statusChangedAt: null,
    createdAt: '2026-08-04T02:00:00+00:00',
    ...over,
  };
}

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    items: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        variantSku: 'SKU-1',
        title: '下導流',
        spec: null,
        quantity: 4,
        unitPrice: { amount: 100, currency: 'TWD' },
        lineTotal: { amount: 400, currency: 'TWD' },
        procurements: [proc()],
        procurementTruncated: false,
      },
    ],
    itemsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe('ItemProcurementSection — 採購列顯示', () => {
  // 🔴 斷言限定在**表格**內:供應商名字同時會出現在下拉選單的 <option> 裡
  //    (buildSupplierChoices 把既有採購的供應商併進選單)⇒ 不限定範圍會撞到兩個節點。
  it('顯示供應商 / 訂購 / 到貨 / 回覆狀態 / 單號 / 預計到貨 / 異常原因', () => {
    const { container } = render(
      <ItemProcurementSection detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    const table = container.querySelector('table')!;
    const text = table.textContent ?? '';
    expect(text).toContain('RPM Carbon');
    expect(text).toContain('部分出貨');
    expect(text).toContain('SO-123');
    expect(text).toContain('2026-09-30');
    expect(text).toContain('原廠缺料');
    // 訂購 3 / 到貨 1 都要在(數量欄是這張表最容易被排錯欄位的地方)
    const cells = [...table.querySelectorAll('tbody td')].map((td) => td.textContent);
    expect(cells[1]).toBe('3');
    expect(cells[2]).toBe('1');
  });

  it('沒有採購紀錄 → 明說「還沒有採購紀錄」,不是空白', () => {
    const d = detail();
    d.items[0]!.procurements = [];
    const { getByText } = render(
      <ItemProcurementSection detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(/還沒有採購紀錄/)).toBeTruthy();
  });

  // 🔴 A9a-2:label 為 null = 內嵌沒回來,不是「這家沒有名字」⇒ 誠實顯示缺、不得空白
  it('supplierLabel 為 null → 顯示「(供應商資料缺)」', () => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierLabel: null })];
    const { getByText } = render(
      <ItemProcurementSection detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText('(供應商資料缺)')).toBeTruthy();
  });

  it.each([
    [false, '(已停用)'],
    [null, '(狀態不明)'],
  ])('supplierIsActive=%s → 標記 %s', (isActive, label) => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierIsActive: isActive as boolean | null })];
    const { getByText } = render(
      <ItemProcurementSection detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(label)).toBeTruthy();
  });
});

describe('ItemProcurementSection — 兩個截斷旗標都要接', () => {
  it('itemsTruncated(外層)→ 顯示整單警告、且每個品項的表單都拒送', () => {
    const { container, getByText } = render(
      <ItemProcurementSection
        detail={detail({ itemsTruncated: true })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/品項清單這次沒有完整載入/)).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[name="procurement_stale"]')!.value,
    ).toBe('1');
  });

  it('procurementTruncated(內層)→ 顯示該品項的警告、該表單拒送', () => {
    const d = detail();
    d.items[0]!.procurementTruncated = true;
    const { container, getByText } = render(
      <ItemProcurementSection detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(/採購紀錄這次沒有完整載入/)).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('兩個都 false → 表單可送', () => {
    const { container } = render(
      <ItemProcurementSection detail={detail()} suppliers={[]} suppliersFailed={false} />,
    );
    expect(container.querySelector('button[type="submit"]')).not.toBeNull();
  });
});

describe('ItemProcurementSection — 供應商清單', () => {
  // 🔴 停用的既有供應商必須留在選單裡(否則那一列永遠改不了)
  it('選單 = 啟用清單 ∪ 既有採購的供應商(含已停用)', () => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierId: SUP_A, supplierIsActive: false })];
    const { container } = render(
      <ItemProcurementSection
        detail={d}
        suppliers={[{ id: SUP_B, label: 'Webike TW' }]}
        suppliersFailed={false}
      />,
    );
    const values = [...container.querySelectorAll('option')].map((o) => o.getAttribute('value'));
    expect(values).toContain(SUP_A);
    expect(values).toContain(SUP_B);
  });

  // 🔴 供應商清單載入失敗**不得靜默**:選單空掉會讓員工以為「這家不存在」而建重複的,
  //    而供應商不可刪除 ⇒ 製造永久垃圾列(`lib/supplier.ts:22-26` 逐字)。
  it('suppliersFailed → 顯示警告,不是靜默的空選單', () => {
    const { getByText } = render(
      <ItemProcurementSection detail={detail()} suppliers={[]} suppliersFailed />,
    );
    expect(getByText(/供應商清單載入失敗/)).toBeTruthy();
  });
});
