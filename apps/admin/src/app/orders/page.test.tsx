// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SupplierOrderNoSearchTooManyError, SupplierOrderNoSearchShapeError } from '@pcm/domain';

// M-4b E10 A10c2:本頁的核心交付 = **Sean Q1=A 的「明示、不默默降級」**
// (三種 invalid 各自的訊息 + 命中過多 vs 程式壞掉的分流)。
// 🔴 這一整層原本零測試(階段 C must-fix 4):把 `instanceof` 換成別的判斷、
//    或 adapter 改成不再擲 `TooManyError`,分流會**靜默退化成通用錯誤態**而三綠全綠。
//
// repository getter 會拉 server-only 模組 ⇒ 整支 mock(同 refund-exceptions/page.test.tsx 紀律)。
// 🔴 本片同時把 `page.tsx` 的 `@/…` import 改成相對路徑:根 `vitest.config.ts:27` 的 `@` alias
//    指向 **storefront** 的 src,admin 檔案用 `@/` 在 vitest 裡 resolve 不到。姊妹頁
//    `refund-exceptions/page.tsx` 本來就用相對路徑 —— 這頁用 `@/` 只是因為它從來沒有測試。
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ listOrderSummariesForAdmin: mocks.list }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));
// #347-2b:本頁自此會讀 `cookies()` —— 關鍵字搜尋詞的載體(它是 PII、刻意不進 URL)。
// 🔴 沒有這個替身,vitest 會擲「`cookies` was called outside a request scope」⇒ 本檔**每一格**都紅,
//    而紅的原因與各格自己要驗的東西完全無關。回空 store = 「沒有在搜尋」,正是本檔既有各格的前提。
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
}));

import OrdersPage from './page';

// 🔴 `server-only` 在**本檔**換成空替身 —— **不是放寬護欄,而且刻意不做成全域 alias。**
//    真的 `server-only` 被 client 模組載入時會丟錯,那正是我們要的
//    (`shipment-candidates.ts` 帶著它,誰把訂單明細拉進 client bundle 就建置失敗)。
//    但 vitest 沒有 server/client 之分、會天真地走完整個 import 圖:
//      client 元件 → `shipment-actions.ts`('use server')→ `shipment-candidates.ts`('server-only')→ 丟錯。
//    真實 Next 下這條路**不存在**('use server' 模組在 client 側是引用樁)。
//    ⚠️ **為什麼不做全域 alias**:`apps/storefront/src/lib/brand-products.test.ts:223` 有一條測試
//    **刻意依賴 server-only 真的丟錯**來證明 mock 清乾淨了(斷言字面就是那句錯誤訊息)。
//    全域替身會把那條的驗證機制整個拆掉 —— 實測會讓它從綠變紅。所以只在需要的檔各自 mock。
vi.mock('server-only', () => ({}));


const EMPTY = { items: [], total: 0 };
const ONE_ORDER = {
  items: [
    {
      id: 'o-1',
      displayId: 'YWP3PC',
      createdAt: '2026-08-07T00:00:00+00:00',
      customerName: '王小明',
      paymentStatus: 'paid' as const,
      fulfillmentStatus: 'pending' as const,
      total: { amount: 1000, currency: 'TWD' as const },
      orderSource: 'storefront' as const,
      paymentChannel: 'tappay' as const,
      tierAtCheckout: null,
      invoiceStatus: null,
      cancelledAt: null,
      displayPosition: null,
      lines: [],
    },
  ],
  total: 1,
};

async function renderPage(params: Record<string, string | string[] | undefined>) {
  const ui = await OrdersPage({ searchParams: Promise.resolve(params) });
  return render(ui);
}

describe('OrdersPage — A10c2 供應商單號搜尋的明示態', () => {
  const OLD_ENV = process.env.ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH;
  beforeEach(() => {
    process.env.ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH = '1';
    mocks.list.mockReset().mockResolvedValue(EMPTY);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env.ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH = OLD_ENV;
    cleanup();
    vi.restoreAllMocks();
  });

  it('🔴 非 ASCII → 明示是「中文或特殊符號」,不是靜默零筆', async () => {
    const { container } = await renderPage({ supplier_no: '單號123' });
    expect(container.textContent).toContain('中文或特殊符號');
  });

  it('🔴 保留字元 → 明示是哪些符號(訊息要能告訴人怎麼改)', async () => {
    const { container } = await renderPage({ supplier_no: 'SO(1)' });
    expect(container.textContent).toContain('逗號');
  });

  it('🔴 太長 → 明示長度上限', async () => {
    const { container } = await renderPage({ supplier_no: 'x'.repeat(40) });
    expect(container.textContent).toContain('32');
  });

  it('🔴 三種 reason 的訊息互不相同 —— 合成同一句就是 Q1=A 要禁的默默降級', async () => {
    const texts: string[] = [];
    for (const v of ['單號123', 'SO(1)', 'x'.repeat(40)]) {
      const { container } = await renderPage({ supplier_no: v });
      texts.push(container.querySelector('.text-amber-900')?.textContent ?? '');
      cleanup();
    }
    expect(new Set(texts).size).toBe(3);
    expect(texts.every((t) => t.length > 0)).toBe(true);
  });

  it('🔴 命中過多 → 明示訊息,且**不渲染**「共 0 筆」與空表', async () => {
    mocks.list.mockRejectedValue(new SupplierOrderNoSearchTooManyError(100));
    const { container } = await renderPage({ supplier_no: 'SO-MANY' });
    const text = container.textContent ?? '';
    expect(text).toContain('資料太多');
    // 🔴 這兩句是階段 C must-fix 2:同一畫面吐三句互相打臉的字面時,員工先看到表格那句
    //    就會判定「這個單號不存在」—— 正是拍板要禁的結論。
    expect(text).not.toContain('共 0 筆');
    expect(text).not.toContain('沒有符合條件的訂單');
    // 也不該退化成通用錯誤態(那會讓人以為系統壞了)
    expect(text).not.toContain('訂單列表載入失敗');
  });

  it('🔴 形狀錯誤(程式壞了)→ 走通用錯誤態 + console.error,**不**偽裝成使用者可處理', async () => {
    mocks.list.mockRejectedValue(new SupplierOrderNoSearchShapeError(3));
    const { container } = await renderPage({ supplier_no: 'SO-1' });
    const text = container.textContent ?? '';
    expect(text).toContain('訂單列表載入失敗');
    expect(text).not.toContain('資料太多');
    expect(console.error).toHaveBeenCalled();
  });

  it('一般錯誤 → 通用錯誤態(既有行為零改動)', async () => {
    mocks.list.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage({});
    expect(container.textContent).toContain('訂單列表載入失敗');
  });

  it('🔴 flag 未開 → supplier_no 完全惰性(不查、不顯示任何搜尋訊息)', async () => {
    process.env.ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH = '0';
    const { container } = await renderPage({ supplier_no: '單號123' });
    expect(container.textContent).not.toContain('中文或特殊符號');
    expect(mocks.list.mock.calls[0]?.[0]).toMatchObject({ supplierOrderNo: undefined });
  });

  // 🔴 用**只有橫幅才有**的句子當觀察面:輸入框的 sr-only 提示裡也有「此搜尋不區分供應商」,
  //    拿那半句去斷言會抓到輸入框、量到的不是橫幅(第一版就是這樣紅的)。
  const BANNER_ONLY = '登錄到貨前請先點進訂單核對供應商';

  /** #338:adapter 回的「命中了哪幾家」。舊 fixture 沒有這個欄位 ⇒ 等同 `null` = 不顯示任何提示。 */
  const withSuppliers = (suppliers: { id: string; label: string | null }[] | null) => ({
    ...ONE_ORDER,
    supplierOrderNoMatchedSuppliers: suppliers,
  });

  it('🔴 #338 命中一家 ⇒ 直接具名(這才是員工要的答案),不再只叫他自己去核對', async () => {
    mocks.list.mockResolvedValue(withSuppliers([{ id: 's1', label: 'A 商行' }]));
    const { container } = await renderPage({ supplier_no: 'SO-1' });
    expect(container.textContent).toContain('這組單號屬於供應商');
    expect(container.textContent).toContain('A 商行');
    // 一家的時候不該再叫他點進去核對 —— 問題已經回答完了。
    expect(container.textContent).not.toContain(BANNER_ONLY);
  });

  it('🔴 #338 命中兩家 ⇒ 示警 + 列名 + 仍要求點進去核對(這才是真的會出事的情況)', async () => {
    mocks.list.mockResolvedValue(
      withSuppliers([
        { id: 's1', label: 'A 商行' },
        { id: 's2', label: 'B 貿易' },
      ]),
    );
    const { container } = await renderPage({ supplier_no: 'SO-1' });
    expect(container.textContent).toContain('A 商行');
    expect(container.textContent).toContain('B 貿易');
    expect(container.textContent).toContain('務必');
  });

  it('🔴 #338 認不出供應商 ⇒ 退回原本那句警語,不假裝知道', async () => {
    // 突變:把 unknown 也畫成具名 ⇒ 這格紅(而畫面會憑空指定一家供應商)。
    mocks.list.mockResolvedValue(withSuppliers([]));
    const { container } = await renderPage({ supplier_no: 'SO-1' });
    expect(container.textContent).toContain(BANNER_ONLY);
  });

  it('🔴 零命中 → 不顯示那句提醒(搜到 0 筆還講「兩家會一起列出」是純噪音)', async () => {
    mocks.list.mockResolvedValue(EMPTY);
    const { container } = await renderPage({ supplier_no: 'SO-NOPE' });
    expect(container.textContent).not.toContain(BANNER_ONLY);
  });
});
