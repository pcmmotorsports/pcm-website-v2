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
    // #476 片1:預設 = **生效中**。片3 會用 `proc({ voidedAt: … })` 構造作廢列來測顯示標示。
    voidedAt: null,
    voidReason: null,
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
        // 🔴 這個 fixture 走 `as unknown as AdminOrderDetail` ⇒ 型別**擋不住漏欄**。
        //    #352-b-2 的衍生指標讀這一欄,漏給時整檔 8 格一起炸(本片實錘)⇒ 顯式給。
        quantitySummary: {
          quantity: 4,
          orderedQuantity: 4,
          instockQuantity: 1,
          cancelledQuantity: 0,
          cancellableQuantity: 3,
        },
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

/** #350d-3:表單的 `return_to` 值(用過得了 parser 的形狀:站內 /orders 路徑)。 */
const RETURN_TO = '/orders?payment_status=paid';

describe('ItemProcurementSection — 採購列顯示', () => {
  // 🔴 斷言限定在**表格**內:供應商名字同時會出現在下拉選單的 <option> 裡
  //    (buildSupplierChoices 把既有採購的供應商併進選單)⇒ 不限定範圍會撞到兩個節點。
  it('顯示供應商 / 訂購 / 到貨 / 回覆狀態 / 單號 / 預計到貨 / 異常原因', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
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
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(/還沒有採購紀錄/)).toBeTruthy();
  });

  // 🔴 A9a-2:label 為 null = 內嵌沒回來,不是「這家沒有名字」⇒ 誠實顯示缺、不得空白
  it('supplierLabel 為 null → 顯示「(供應商資料缺)」', () => {
    const d = detail();
    d.items[0]!.procurements = [proc({ supplierLabel: null })];
    const { getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
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
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(label)).toBeTruthy();
  });
});

describe('ItemProcurementSection — 兩個截斷旗標都要接', () => {
  it('itemsTruncated(外層)→ 顯示整單警告、且每個品項的表單都拒送', () => {
    const { container, getByText } = render(
      <ItemProcurementSection returnTo={RETURN_TO}
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
      <ItemProcurementSection returnTo={RETURN_TO} detail={d} suppliers={[]} suppliersFailed={false} />,
    );
    expect(getByText(/採購紀錄這次沒有完整載入/)).toBeTruthy();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });

  it('兩個都 false → 表單可送', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed={false} />,
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
      <ItemProcurementSection returnTo={RETURN_TO}
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
      <ItemProcurementSection returnTo={RETURN_TO} detail={detail()} suppliers={[]} suppliersFailed />,
    );
    expect(getByText(/供應商清單載入失敗/)).toBeTruthy();
  });
  // 🔴 #352-b 入口 1 的**正向**格 —— 沒有這一格,「截斷時收起來」那兩格會變成恆真:
  //    把 ReceiptRecordForm 整個刪掉,截斷格照樣綠(本來就沒鈕),而入口就這樣悄悄消失了。
  //    ⇒ 正負成對:沒截斷要看得到、截斷要看不到。
  it('沒截斷 → 每列採購都有「登錄到貨」入口', () => {
    const { getAllByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={detail()}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getAllByText('登錄到貨').length).toBeGreaterThan(0);
  });

  it('截斷 → 「登錄到貨」入口收起來(與警告文案「不能編輯採購」同一條不變式)', () => {
    const { queryByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={detail({ itemsTruncated: true })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(queryByText('登錄到貨')).toBeNull();
  });
});

// 🔴🔴 `#476` 片3:作廢列的顯示面。
//
// **這一組的存在理由**:片1 把 `voidedAt` 帶進讀模型、片2 讓表單只挑生效列,但**畫面上
// 作廢列與生效列長得一模一樣**,而「訂購數」已經把它扣掉了 ⇒ 員工看到「表格列了 3 件、
// 系統說還有 3 件沒登記來源」這種互相矛盾而沒有一行字解釋的畫面(`#476` 條目逐字)。
//
// ⚠️ **構造照正式庫走得到的形狀**:partial unique(`20260813120000` 步3)+ `Q-S1=A` 允許重下單
//    ⇒ 同鍵可有「一作廢 + 一生效」兩列;mapper 依 `createdAt` ASC 排 ⇒ 作廢的(較舊)排前面。
describe('🔴 #476 片3:作廢的採購列要看得出來,而且不給到貨入口', () => {
  const VOIDED = proc({
    id: 'p-void',
    supplierId: SUP_B,
    supplierLabel: 'Webike JP',
    supplierOrderNo: 'SO-舊-已作廢',
    createdAt: '2026-08-01T00:00:00+00:00',
    voidedAt: '2026-08-10T00:00:00+00:00',
    voidReason: '供應商回報缺料、改下另一家',
  });

  function withVoided(over: Parameters<typeof proc>[0] = {}) {
    const d = detail();
    return {
      ...d,
      items: [{ ...d.items[0]!, procurements: [VOIDED, proc(over)] }],
    } as typeof d;
  }

  it('作廢列標「(已作廢)」+ 刪除線;生效列兩者都不得有', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={withVoided()} suppliers={[]} suppliersFailed={false} />,
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    // 🔴 逐列比對,不是「整張表含有『已作廢』」—— 後者無法分辨標到哪一列
    expect(rows[0]!.textContent).toContain('(已作廢)');
    expect(rows[0]!.querySelector('.line-through')).not.toBeNull();
    expect(rows[1]!.textContent).not.toContain('(已作廢)');
    expect(rows[1]!.querySelector('.line-through')).toBeNull();
    // 🔴 整列淡化也要驗(codex nit:拿掉 `opacity-60` 原本 0 紅)——
    //    刪除線只在供應商那一格,整列淡化才是「一眼掃過去看得出哪幾列不算數」的那個訊號。
    expect(rows[0]!.className).toContain('opacity-60');
    expect(rows[1]!.className).not.toContain('opacity-60');
  });

  it('🔴 作廢列不給「登錄到貨」;同一張表的生效列照給(正負成對,免得整欄消失也綠)', () => {
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={withVoided()} suppliers={[]} suppliersFailed={false} />,
    );
    const rows = container.querySelectorAll('tbody tr');
    expect(rows[0]!.textContent).not.toContain('登錄到貨');
    expect(rows[1]!.textContent).toContain('登錄到貨');
  });

  // 🔴 codex 關卡2:全部 fixture 只有 `null` / `string` ⇒ `!= null` 與 `!== null` 兩種寫法在
  //    現有格上**完全等價**、五發突變都分不出來。這格專證方向:`undefined` 必須倒向「當生效」。
  //    (方向的理由與 `procurement-view.ts:findActiveProcurement` 同源:`=== null` 會讓
  //     缺欄時每一列都被判作廢 ⇒ 全表劃線 + 到貨入口全消失,而資料其實好好的。)
  it('🔴 voidedAt 為 undefined(投影退版)⇒ 當【生效】處理,不得全表判成作廢', () => {
    const d = detail();
    const missingCol = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [{ ...proc(), voidedAt: undefined, voidReason: undefined }],
        },
      ],
    } as unknown as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={missingCol} suppliers={[]} suppliersFailed={false} />,
    );
    const row = container.querySelector('tbody tr')!;
    expect(row.textContent).not.toContain('(已作廢)');
    expect(row.querySelector('.line-through')).toBeNull();
    expect(row.textContent).toContain('登錄到貨'); // 到貨入口不得被誤收
  });

  it('作廢與停用可以同時成立 ⇒ 兩個標記都要在,且**作廢排在前面**(順序是刻意的)', () => {
    const d = detail();
    const both = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: false })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={both} suppliers={[]} suppliersFailed={false} />,
    );
    const cell = container.querySelector('tbody tr td')!.textContent ?? '';
    expect(cell).toContain('(已作廢)');
    expect(cell).toContain('(已停用)');
    // 🔴 順序也要驗:元件註解明寫「作廢標示排在停用標示之前」是刻意的
    //    (「這筆撤了」比「這家停用了」更決定員工的下一步)。只驗兩者皆在的話,
    //    把兩塊 JSX 交換 0 紅 —— 那正是我自己寫進 §②-a 的「名稱/註解大於斷言」。
    expect(cell.indexOf('(已作廢)')).toBeLessThan(cell.indexOf('(已停用)'));
  });

  // 🔴🔴 **兩關審查各自獨立抓到的同一條**:第一版條件只寫 `if (p.voidedAt != null) continue;`,
  //    在 `suppliersFailed` 路徑上會關掉 `Q-S1=A` 的合法路 —— 那時 `suppliers=[]`,
  //    第二個迴圈是選單的**唯一**來源,一家**仍啟用**但只剩作廢列的供應商會整個消失。
  //    ⇒ 條件補上 `&& p.supplierIsActive === false`,並用下面這格釘住。
  it('🔴 供應商清單載入失敗 + 仍啟用 + 只剩作廢列 ⇒ 那家【必須】還在選單(Q-S1=A 要對它重下單)', () => {
    const d = detail();
    const onlyVoidedButActive = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [proc({ ...VOIDED, supplierIsActive: true })], // 仍啟用,只是這筆撤了
        },
      ],
    } as typeof d;
    const { container } = render(
      // 🔴 `suppliers=[]` + `suppliersFailed` = 真實的失敗路徑(`order-detail-route.tsx` 就這樣傳)
      <ItemProcurementSection returnTo={RETURN_TO} detail={onlyVoidedButActive} suppliers={[]} suppliersFailed />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });

  it('🔴 supplierIsActive 為 null(內嵌沒回來 = 不知道)⇒ 保留,不因為作廢就移除', () => {
    const d = detail();
    const unknown = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: null })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={unknown} suppliers={[]} suppliersFailed />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });

  it('🔴 只剩作廢列的**已停用**供應商不進選單(選了也只有空表單 + 被片2 擋)', () => {
    const d = detail();
    const onlyVoided = {
      ...d,
      items: [{ ...d.items[0]!, procurements: [proc({ ...VOIDED, supplierIsActive: false })] }],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={onlyVoided} suppliers={[]} suppliersFailed={false} />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(false);
  });

  it('同一家**有生效列**時仍留在選單(上一格不得把合法的那條路一起關掉)', () => {
    const d = detail();
    const stillActive = {
      ...d,
      items: [
        {
          ...d.items[0]!,
          procurements: [VOIDED, proc({ supplierId: SUP_B, supplierLabel: 'Webike JP', supplierIsActive: false })],
        },
      ],
    } as typeof d;
    const { container } = render(
      <ItemProcurementSection returnTo={RETURN_TO} detail={stillActive} suppliers={[]} suppliersFailed={false} />,
    );
    const options = [...container.querySelectorAll('option')].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Webike JP'))).toBe(true);
  });
});

describe('ItemProcurementSection — #352-b-2 衍生指標「還有 N 件沒有登記來源」', () => {
  /** 覆寫第一個品項的摘要(fixture 走 as-cast,型別擋不住,故逐欄給滿)。 */
  function withSummary(summary: unknown) {
    const d = detail();
    return { ...d, items: [{ ...d.items[0]!, quantitySummary: summary }] } as never;
  }

  it('還有件數沒著落 → 講出確切件數,並指去下面補來源', () => {
    const { getByRole } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary({
          quantity: 5,
          orderedQuantity: 2,
          instockQuantity: 0,
          cancelledQuantity: 1,
          cancellableQuantity: 5,
        })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    // 5 − 1 − 2 = 2
    expect(getByRole('status').textContent).toContain('2');
    expect(getByRole('status').textContent).toContain('沒有登記來源');
  });

  it('全部都有來源 → 不出現任何提示(不製造雜訊)', () => {
    const { queryByRole, queryByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary({
          quantity: 3,
          orderedQuantity: 3,
          instockQuantity: 0,
          cancelledQuantity: 0,
          cancellableQuantity: 3,
        })}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(queryByRole('status')).toBeNull();
    expect(queryByText(/沒有登記來源/)).toBeNull();
  });

  // 🔴 `null` = 不知道 ⇒ 說「算不出來」,**不得**說「還有 0 件」或「還有 N 件」——
  //    那是它證明不了的話(摘要列由 A4a 惰性建立,沒列只代表沒被碰過)。
  it('🔴 摘要讀不到 → 誠實說算不出來,不假裝知道', () => {
    const { getByText, queryByRole } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={withSummary(null)}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/數量資料還沒就緒/)).toBeTruthy();
    // 🔴 不變式是「**不得宣稱一個件數**」,不是「不得出現『沒有登記來源』這幾個字」——
    //    誠實的 fallback 本來就寫著「算不出『還有幾件沒有登記來源』」,那句合法。
    //    (第一版我把斷言寫成後者,當場被自己這格打回:**測的東西比要守的不變式更寬**。)
    //    ⇒ 改釘那顆 `role="status"` 的橘色提示不存在 —— 它才是「我知道是 N 件」的那個宣稱。
    expect(queryByRole('status')).toBeNull();
  });

  // 🔴 欄位整個不見(fixture as-cast 的世界)也不能白畫面 —— 降級成「算不出來」。
  it('🔴 摘要欄位缺席 → 降級,不炸整頁', () => {
    const d = detail();
    const noField = { ...d, items: [{ ...d.items[0]!, quantitySummary: undefined }] } as never;
    const { getByText } = render(
      <ItemProcurementSection
        returnTo={RETURN_TO}
        detail={noField}
        suppliers={[]}
        suppliersFailed={false}
      />,
    );
    expect(getByText(/數量資料還沒就緒/)).toBeTruthy();
  });
});
