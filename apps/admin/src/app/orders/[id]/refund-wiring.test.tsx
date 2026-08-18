// @vitest-environment jsdom
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// M-3 A7c RW2d:**頁層接線**測試(procurement-wiring.test.tsx 同型)。
//
// 🔴 為什麼需要它:元件層測試把 `refundEnabled` 當 prop 餵 ⇒ 把 page.tsx 裡的
//    `isRefundUiEnabled()` 傳遞拔掉(或旗標字面改認 'true'),元件測試照樣全綠,
//    而 dev 開了 `REFUND_UI_ENABLED=1` 也看不到入口(或反過來:旗標關著入口卻渲染)。
//    ⇒ 這裡量「env → page → order-detail → RefundSection」整條顯示鏈。
//    server 閘(action 步 ②)在 refund-actions.test.ts 另測 —— 顯示面與 server 閘讀同一個
//    `isRefundUiEnabled()`(refund-ui-flag.ts 檔頭),本檔只需釘顯示鏈。

vi.mock('server-only', () => ({}));
vi.mock('../../../lib/session/actor', () => ({ getSessionActor: async () => null }));
vi.mock('../../../lib/orders/cancel-actions', () => ({ cancelOrderAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound');
  },
}));
// 🔴 每一支 server action 模組都要 mock(vite import 分析先於 vi.mock('server-only') 生效;
//    procurement-wiring.test.tsx:20-22 同註)。
vi.mock('../../../lib/orders/procurement-actions', () => ({
  upsertItemProcurementAction: vi.fn(),
}));
vi.mock('../../../lib/orders/note-actions', () => ({ appendOrderNoteAction: vi.fn() }));
vi.mock('../../../lib/orders/order-actions', () => ({
  updateOrderWorkflowAction: vi.fn(), // A9w4a:`updateOrderItemWorkflowAction` 已從該模組具名移除
}));
vi.mock('../../../lib/payment/refund-actions', () => ({ initiateRefundAction: vi.fn() }));

const mocks = vi.hoisted(() => ({
  findAdminOrderDetail: vi.fn(),
  listSuppliers: vi.fn(),
  listOrderRefunds: vi.fn(),
  getLedgerUnregisteredAmount: vi.fn(),
  // 🔴 BMW M 片4b:從 inline `vi.fn(async () => [])` **提升到 hoisted**,因為頭條「已收」那族
  //    要構造出 `unreadable` 那一態(讓它 reject)。⚠️ **預設值在 `beforeEach` 維持回 `[]`**
  //    ⇒ 本檔其他每一格的行為一個字都沒變(提升本身零行為改變)。
  listOrderPayments: vi.fn(),
}));
// M-3 RW3:page 直接 import refund-read(→ server-only)⇒ 必 mock;
// 本檔另有帳本顯示鏈的接線格,mock 給 hoisted 的可控版本。
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: mocks.findAdminOrderDetail,
    // 🔴 `D2` C 條(2026-08-18):明細頁改走頂層分頁撈到盡 ⇒ route 會多呼叫這一支。
    //    這裡從【上一次 `findAdminOrderDetail` 回的那份】導出,讓本檔既有各格
    //    繼續量它們本來在量的東西(收款 / 取消 / 採購 / 排序…)。
    //    🔴🔴 **代價要講白:這樣導出之後,本檔【對「品項撈不撈得全」零判別力】** ——
    //    兩份永遠一樣。那一面由 `lib/orders/merge-detail-items.test.ts` 守(它真的餵 201 項)。
    //    ⚠️ 用 `mock.results` 而不是再呼叫一次:再呼叫會**消耗 `mockResolvedValueOnce` 鏈**。
    listOrderItemsForDetail: async () => {
      const d = await mocks.findAdminOrderDetail.mock.results.at(-1)?.value;
      const items = d?.items ?? [];
      // 🔴 **把 fixture 的意圖翻譯到新機制上**:
      //    `D2` C 條之後,「這張單的品項沒列完」不再由 detail 的 `itemsTruncated` 表達
      //    (那一份是內嵌撈的、而明細頁已經改走撈到盡)——
      //    改由【撈到的筆數與伺服器說的對不上】表達。
      //    ⇒ fixture 說 truncated ⇒ 這裡回一個對不上的 count,讓 merge 判它不完整。
      //    ⚠️ 不這樣翻的話,本檔那幾格「截斷時要印未知」的守門會【無法構造那個狀態】而被誤刪。
      return {
        items,
        reportedTotal: d?.itemsTruncated === true ? items.length + 1 : items.length,
      };
    },
  }),
}));
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));
// 🔴 #15-B2-c 片1a:`order-detail-route` 起會讀 `listOrderPayments`(→ `createSupabaseServiceClient`
//    = server-only)。⚠️ **不 mock 也不會紅** —— 它在呼叫時 throw、被 `allSettled` 接住折成
//    `unreadable` ⇒ 本檔每次 renderPage 都靜默多畫一塊紅框 + 噴 `console.error`,
//    而本檔要驗的東西照樣全綠 ⇒ 那塊紅框會被下一個人當成既有雜訊。回空陣列 = 「這單沒收過款」,
//    與本檔要驗的東西無關,也不會多畫任何東西。
vi.mock('../../../lib/orders/payment-repository', () => ({
  listOrderPayments: mocks.listOrderPayments,
}));

import OrderDetailPage from './page';

// 🔴 2c:`<ShipmentSection>` 是 **async server component**,而本檔用 RTL **同步**渲染
//    ⇒ 不 mock 的話整個 OrderDetail 渲染不出來(症狀是 container 變空字串、本檔全紅)。
//    真實 Next 下 async server component 是支援的,**這是測試工具的限制、不是產品缺陷**。
//    本檔測的是採購/退款/九碼,出貨卡有自己的測試(`shipment-section.test.tsx` +
//    `order-shipments.test.ts`)⇒ 這裡換成佔位、不影響本檔要驗的東西。
vi.mock('../../../components/orders/shipment-section', () => ({
  ShipmentSection: () => null,
}));


const ORDER = '11111111-1111-4111-8111-111111111111';

function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  // `as unknown as` 同 procurement-wiring.test.tsx:58 慣例(MoneyAmount branded type)。
  return {
    id: ORDER,
    displayId: 'ABC123',
    createdAt: '2026-08-04T02:00:00+00:00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'notOrdered',
    orderSource: 'web',
    paymentChannel: 'tappay',
    paymentMethod: null,
    paidAt: null,
    subtotal: { amount: 100, currency: 'TWD' },
    shippingFee: { amount: 0, currency: 'TWD' },
    discountTotal: { amount: 0, currency: 'TWD' },
    total: { amount: 100, currency: 'TWD' },
    shippingMethod: 'home',
    shippingAddress: { name: null, phone: null, line: null },
    customer: { name: null, email: null, phone: null },
    invoiceRequest: { type: null, taxId: null, title: null, carrier: null, donateCode: null },
    invoiceNumber: null,
    invoiceAmount: null,
    invoiceStatus: 'not_issued',
    cancelledAt: null,
    cancelledReason: null,
    version: 1,
    items: [],
    notes: [],
    customerNotified: false,
    notesTruncated: false,
    itemsTruncated: false,
    ...over,
  } as unknown as AdminOrderDetail;
}

let savedFlag: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.findAdminOrderDetail.mockResolvedValue(detail());
  mocks.listSuppliers.mockResolvedValue([]);
  mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
  mocks.getLedgerUnregisteredAmount.mockResolvedValue(null);
  // 提升前的 inline 預設,逐字保留:`[]` = 「這單沒收過款」,不是「讀不到」。
  mocks.listOrderPayments.mockResolvedValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  savedFlag = process.env.REFUND_UI_ENABLED;
});
afterEach(() => {
  cleanup();
  if (savedFlag === undefined) {
    delete process.env.REFUND_UI_ENABLED;
  } else {
    process.env.REFUND_UI_ENABLED = savedFlag;
  }
});

async function renderPage() {
  const ui = await OrderDetailPage({
    params: Promise.resolve({ id: ORDER }),
    searchParams: Promise.resolve({}),
  });
  return render(ui);
}

/** 入口存在判準 = 退款表單的 kind radio(比標題文字穩;字面待 Sean 定稿會動)。 */
function hasRefundEntry(container: HTMLElement): boolean {
  return container.querySelector('input[name="kind"][value="full"]') !== null;
}

/**
 * 🔴 取「退款表單」本體(R1 MF1):`order_id` / `request_token` 是備註表單也用的欄位名,
 * 且備註表單在 DOM 順序上排前面 —— 直接 `container.querySelector` 撈到的是**別人的**欄位,
 * 斷言恆真。錨 = kind radio(grep 全頁唯一)所在的 form。
 */
function refundForm(container: HTMLElement): HTMLFormElement {
  const kindInput = container.querySelector('input[name="kind"][value="full"]');
  const form = kindInput?.closest('form');
  if (!form) throw new Error('退款表單不在(kind radio 或其 form 缺)');
  return form;
}

/**
 * 🔴 取「退款帳本」區塊本體(`#428`)。
 *
 * 病:本檔原本用 `container.textContent` 驗帳本區塊專屬的宣稱,而
 * 「讀取失敗」這四個字在**同一頁的多個元件**都印得出來
 * (`cancel-review-section` / `cancel-result-panel` / `refund-ledger-section` …)
 * ⇒ 斷言吃得到**第三方餵的字串**,與帳本區塊有沒有正確顯示無關。
 * 2026-08-12 reviewer 的突變證據:把帳本文案改壞 + 拿掉 `<PaymentList>`,該檔 13 格照樣全綠。
 *
 * 錨 = `<h2>退款紀錄</h2>`(全樹唯一,`refund-ledger-section.tsx` 四條渲染路徑都掛它;
 * 數法 `/usr/bin/grep -rn "退款紀錄" apps/admin/src --include="*.tsx"` ⇒ 非測試命中只有它與一個 placeholder)。
 * 🔴 找不到就 **throw、不回 null** —— 回 null 會讓「區塊根本沒渲染」與「渲染了但沒那句話」
 * 在斷言上長得一樣,那正是本條在修的病。寫法抄 `payment-list-wiring.test.tsx` 的 `paymentSection()`。
 */
function ledgerSection(container: HTMLElement): HTMLElement {
  const heading = Array.from(container.querySelectorAll('h2')).find(
    (h) => h.textContent === '退款紀錄',
  );
  const section = heading?.closest('section');
  if (!section) throw new Error('找不到退款帳本區塊(<h2>退款紀錄</h2> 的 section)');
  return section as HTMLElement;
}

/** 帳本區塊裡的文字(所有帳本專屬斷言都走這支,不要再用 container.textContent)。 */
function ledgerText(container: HTMLElement): string {
  return ledgerSection(container).textContent ?? '';
}

describe('/orders/[id] — RW2d 退款入口顯示鏈', () => {
  it('🔴 旗標未設(預設)→ 入口不渲染', async () => {
    delete process.env.REFUND_UI_ENABLED;
    const { container } = await renderPage();
    expect(hasRefundEntry(container)).toBe(false);
  });

  it('🔴 旗標非恰 \'1\'(true/1 加空白/0)→ 入口不渲染(恰 \'1\' 才開,不寬收)', async () => {
    for (const value of ['true', '1 ', '0', 'yes']) {
      process.env.REFUND_UI_ENABLED = value;
      const { container } = await renderPage();
      expect(hasRefundEntry(container), `REFUND_UI_ENABLED='${value}' 不得開`).toBe(false);
      cleanup();
    }
  });

  it('旗標=1 且 paid → 入口渲染,退款表單內 hidden order_id/token 齊(token 為 v4 小寫)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    const { container } = await renderPage();
    const form = refundForm(container);
    expect(
      form.querySelector<HTMLInputElement>('input[name="order_id"][type="hidden"]')?.value,
    ).toBe(ORDER);
    const token = form.querySelector<HTMLInputElement>('input[name="request_token"]')?.value;
    expect(token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('🔴 token 每次 render 換一把(R1 MF1 缺格:抓「產生點被搬進快取層/模組常數/空字串」整族)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    const first = await renderPage();
    const tokenA = refundForm(first.container).querySelector<HTMLInputElement>(
      'input[name="request_token"]',
    )?.value;
    cleanup();
    const second = await renderPage();
    const tokenB = refundForm(second.container).querySelector<HTMLInputElement>(
      'input[name="request_token"]',
    )?.value;
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
    expect(tokenA).not.toBe(tokenB);
  });

  it('旗標=1 但 paymentChannel 非 tappay → 入口不渲染(R1 N5 顯示層 channel 閘)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    for (const paymentChannel of ['bank_transfer', 'cash', 'none']) {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ paymentChannel } as Partial<AdminOrderDetail>),
      );
      const { container } = await renderPage();
      expect(hasRefundEntry(container), `paymentChannel='${paymentChannel}' 不得渲染入口`).toBe(
        false,
      );
      cleanup();
    }
  });

  it('旗標=1 且 partiallyRefunded → 入口渲染(第二次部分退是合法場景)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    mocks.findAdminOrderDetail.mockResolvedValue(detail({ paymentStatus: 'partiallyRefunded' }));
    const { container } = await renderPage();
    expect(hasRefundEntry(container)).toBe(true);
  });

  it('旗標=1 但狀態不可退(unpaid/refunded/partiallyPaid)→ 入口不渲染(顯示層閘;權威在 RPC)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    for (const paymentStatus of ['unpaid', 'refunded', 'partiallyPaid']) {
      mocks.findAdminOrderDetail.mockResolvedValue(
        detail({ paymentStatus } as Partial<AdminOrderDetail>),
      );
      const { container } = await renderPage();
      expect(hasRefundEntry(container), `paymentStatus='${paymentStatus}' 不得渲染入口`).toBe(
        false,
      );
      cleanup();
    }
  });

  it('🔴 RW3 帳本顯示鏈:listOrderRefunds 的列真的傳到帳本區塊(旗標關著也要顯示——既成事實不吃旗標)', async () => {
    delete process.env.REFUND_UI_ENABLED;
    mocks.listOrderRefunds.mockResolvedValue({
      rows: [{
        id: 'r-1',
        kind: 'partial',
        status: 'confirmed',
        refundAmount: 777,
        reason: '缺貨退款',
        actor: 'sean',
        createdAt: '2026-08-04T03:00:00+00:00',
        failedReason: null,
        failedDetail: null,
        providerEvidence: null,
      }],
      truncated: false,
    });
    mocks.getLedgerUnregisteredAmount.mockResolvedValue(877);
    const { container } = await renderPage();
    // 🔴 `#428`:帳本專屬的宣稱一律鎖進帳本區塊,不用整頁 textContent。
    expect(ledgerText(container)).toContain('退款紀錄');
    // 'NT$ 777' 全字面:fixture displayId='ABC123' 會讓裸 '123' 恆真(opus R1 nit、撞號教訓)。
    expect(ledgerText(container)).toContain('NT$ 777');
    expect(ledgerText(container)).toContain('帳本未登記額');
    expect(ledgerText(container)).toContain('877');
    // 🔴 codex MF5:mock 不看參數,A 單顯 B 單帳本這類錯接只有參數斷言抓得到。
    expect(mocks.listOrderRefunds.mock.calls[0]).toEqual([ORDER]);
    expect(mocks.getLedgerUnregisteredAmount.mock.calls[0]).toEqual([ORDER]);
    // 旗標關 ⇒ 發起入口不得因帳本列存在而出現(兩件事各自的閘)。
    expect(hasRefundEntry(container)).toBe(false);
  });

  it('🔴 RW3 帳本讀取失敗 → 顯警告 + 發起入口 fail-closed(codex MF2:看不見帳本現況=盲飛,旗標開著也不准按)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    mocks.listOrderRefunds.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    expect(ledgerText(container)).toContain('退款帳本載入失敗');
    expect(hasRefundEntry(container)).toBe(false);
  });

  it('🔴 RW3 未登記額為負 → 對帳異常態 + 發起入口 fail-closed(codex R2/opus R2b 同抓:文字寫勿再發起、按鈕不得亮著)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    mocks.listOrderRefunds.mockResolvedValue({
      rows: [{
        id: 'r-1', kind: 'partial', status: 'confirmed', refundAmount: 777,
        reason: 'x', actor: 'sean', createdAt: '2026-08-04T03:00:00+00:00',
        failedReason: null, failedDetail: null, providerEvidence: null,
      }],
      truncated: false,
    });
    mocks.getLedgerUnregisteredAmount.mockResolvedValue(-1000);
    const { container } = await renderPage();
    expect(ledgerText(container)).toContain('對帳異常');
    expect(hasRefundEntry(container)).toBe(false);
  });

  // 🔴 #445a-3 的**核心行為改動就是這一格**(關卡2 codex MF3 抓到我沒有 oracle):
  //    445a-3 之前 `order-detail-route.tsx` 只在 `refunds.length > 0` 才呼叫
  //    `getLedgerUnregisteredAmount` ⇒ **每一張訂單的第一筆退款拿不到任何金額參考**。
  //    ⚠️ 我原本只寫了純 helper 的條件級測試(`refund-entry-gate` 那支)——
  //    **那些格在短路復活時一格都不會紅**,因為它們根本不執行 route。
  //    ⇒ 這格紅的時候是誰讓它紅的:把 `if (refunds.length > 0)` 那道短路加回去。
  it('🔴 RW3 #445a-3:**零帳本列也要查未登記額**(短路復活時本格必紅)', async () => {
    delete process.env.REFUND_UI_ENABLED;
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.getLedgerUnregisteredAmount.mockResolvedValue(1000);
    await renderPage();
    expect(mocks.getLedgerUnregisteredAmount).toHaveBeenCalledTimes(1);
    expect(mocks.getLedgerUnregisteredAmount.mock.calls[0]).toEqual([ORDER]);
  });

  // §6-33:零列 + 查成功 ⇒ 帳本區塊行為與現況一致(不因刪短路多冒一個空區塊出來)。
  // ⚠️ 與上一格**刻意分開**:上一格證「有呼叫」,本格證「有呼叫但畫面不變」。
  //    併成一格的話,把區塊改成零列也渲染時上一格照樣綠。
  it('🔴 RW3 #445a-3:零帳本列 + 查成功 ⇒ 帳本區塊仍不渲染(不多冒空區塊)', async () => {
    delete process.env.REFUND_UI_ENABLED;
    mocks.listOrderRefunds.mockResolvedValue({ rows: [], truncated: false });
    mocks.getLedgerUnregisteredAmount.mockResolvedValue(1000);
    const { container } = await renderPage();
    expect(container.textContent).not.toContain('退款紀錄');
    expect(container.textContent).not.toContain('帳本未登記額');
  });

  it('🔴 RW3 未登記額讀取失敗 → 錯誤態(非查無)+ 發起入口 fail-closed(codex MF2)', async () => {
    process.env.REFUND_UI_ENABLED = '1';
    mocks.listOrderRefunds.mockResolvedValue({
      rows: [{
        id: 'r-1', kind: 'partial', status: 'confirmed', refundAmount: 777,
        reason: 'x', actor: 'sean', createdAt: '2026-08-04T03:00:00+00:00',
        failedReason: null, failedDetail: null, providerEvidence: null,
      }],
      truncated: false,
    });
    mocks.getLedgerUnregisteredAmount.mockRejectedValue(new Error('boom'));
    const { container } = await renderPage();
    // 🔴 `#428` 的正主:「讀取失敗」全頁有 4+ 個來源,整頁比對驗不到帳本這一格。
    expect(ledgerText(container)).toContain('讀取失敗');
    expect(ledgerText(container)).not.toContain('查無');
    expect(hasRefundEntry(container)).toBe(false);
  });

  /** admin src 全樹走訪:回傳「內容命中 predicate」的非測試 .ts/.tsx 相對路徑。 */
  function scanSources(predicate: (content: string) => boolean): string[] {
    const root = join(__dirname, '../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (
          /\.(ts|tsx)$/.test(name) &&
          !/\.test\.(ts|tsx)$/.test(name) &&
          predicate(readFileSync(full, 'utf8'))
        ) {
          hits.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);
    return hits.sort();
  }

  // ⚠️ 兩個 oracle 的誠實邊界(codex R1 nit;RW2b「攔回歸,不攔對手」同款):文字掃描擋不住
  //    刻意規避(字串拼接 '剩餘'+'可退'、computed env key、字串搬到 apps/admin/src 外再 import、
  //    藏進 *.test.* 命名)。它們的工作是讓「無意的回歸」轉紅,不是對抗惡意提交。
  it('🔴 RW3 措辭 oracle(F25 全域面):「還能退/剩餘可退」剝註解後只准出現在 refund-section(TapPay 端語意的 UI 字串);帳本數字被任何檔標成可退額,這格就紅', () => {
    // 先剝註解(app-sidebar.test.ts stripComments 同款理由):規則註解本身會引用禁語,
    // oracle 管的是**會渲染/會入庫的字串面**,不是講規則的字。
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');
    const hits = scanSources((content) => /還能退|剩餘可退/.test(strip(content)));
    expect(hits).toEqual([
      // 唯一合法命中:退款表單的 TapPay 端字面(「全額退款以 TapPay 端剩餘可退額為準」等,
      // 語意=TapPay 剩餘額,正確用法;opus R1 對抗面清空紀錄)。
      'components/orders/refund-section.tsx',
    ]);
  });

  it('🔴 結構性 oracle(codex R1 nit):REFUND_UI_ENABLED 字面在 admin 非測試源碼恰兩處(flag 模組+refund-section 純註解),env 讀取恰 flag 模組一處(任一消費端改回自己比字面這格就紅)', () => {
    const root = join(__dirname, '../../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (
          /\.(ts|tsx)$/.test(name) &&
          !/\.test\.(ts|tsx)$/.test(name) &&
          readFileSync(full, 'utf8').includes('REFUND_UI_ENABLED')
        ) {
          hits.push(full.slice(root.length + 1));
        }
      }
    };
    walk(root);
    // 命中=flag 模組本體 + refund-section 的說明註解(零 env 讀取,下一條斷言釘死)。
    expect(hits.sort()).toEqual([
      'components/orders/refund-section.tsx',
      'lib/payment/refund-ui-flag.ts',
    ]);
    // env 讀取(process.env 字面鄰接)只准在 flag 模組;refund-section 那筆必須只是註解。
    const section = readFileSync(join(root, 'components/orders/refund-section.tsx'), 'utf8');
    expect(section.includes('process.env.REFUND_UI_ENABLED')).toBe(false);
    const actions = readFileSync(join(root, 'lib/payment/refund-actions.ts'), 'utf8');
    expect(actions.includes('process.env.REFUND_UI_ENABLED')).toBe(false);
    expect(actions.includes('isRefundUiEnabled')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `#514` — 明細頁「出貨狀態」那一格改讀貨品軸真相(**頁級**證據)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **為什麼掛在這個檔而不是自己開一個**:整頁渲染要 10 個帶理由的 mock(本檔上方 ~50 行,
//    每一條都寫著「不 mock 會怎樣」)。**複製一份必漂**,而漂掉的那份會靜默量到別的東西。
//    ⇒ 沿用同一組 harness,用獨立 `describe` 隔開職責。
//
// 🔴🔴 **函式級測試補不到這一格**:`order-status-axes.test.ts` 證明 `orderDetailGoodsAxis()` 算得對,
//    但**不證明畫面真的改讀了它** —— 有人把 `order-detail.tsx` 那行改回
//    `FULFILLMENT_STATUS_LABEL[detail.fulfillmentStatus]`,函式那族**一格都不會紅**。
//    這一格釘的就是「頁面用的是哪一個來源」。
describe('`#514` 出貨狀態改讀貨品軸(頁級)', () => {
  /** 明細側品項:`quantitySummary` 是 `| null`(A4a trigger 惰性建列)。 */
  const item = (quantity: number, ordered: number) => ({
    id: `it-${quantity}-${ordered}`,
    title: '測試品項',
    spec: null,
    variantSku: 'SKU-514',
    procurements: [],
    quantity,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 100 * quantity, currency: 'TWD' },
    quantitySummary: {
      orderedQuantity: ordered,
      instockQuantity: 0,
      shippedQuantity: 0,
      cancelledQuantity: 0,
      cancellableQuantity: 0,
    },
  });

  /**
   * 🔴 **核心證據**:stale 欄位說「未訂貨」(它在正式庫 13/13 唯一會說的話),
   * 而該單**確實已向廠商訂貨** ⇒ 畫面必須顯示「已向廠商訂貨」。
   * ⚠️ **若畫面顯示「未訂貨」,代表那一格還在讀 `fulfillment_status`** —— 這一格就是為此存在。
   */
  it('🔴 有採購紀錄的單:畫面顯示「已向廠商訂貨」,不是 stale 欄位的「未訂貨」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({
        fulfillmentStatus: 'notOrdered',
        items: [item(2, 2), item(1, 1)],
      } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    expect(container.textContent).toContain('已向廠商訂貨');
    expect(container.textContent).not.toContain('未訂貨');
  });

  /**
   * ⚠️ **多數單修完仍顯示「未訂貨」,而那是對的** —— 正式庫多數單還沒採購。
   * 這一格把「對的未訂貨」釘下來,免得有人看到它就以為改動被回退了。
   */
  it('沒有採購紀錄的單:仍顯示「未訂貨」——那是正確的,不是沒生效', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items: [item(1, 0)] } as unknown as Partial<AdminOrderDetail>),
    );
    const { container } = await renderPage();
    expect(container.textContent).toContain('未訂貨');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 出貨狀態的**解釋小字**(Sean 2026-08-15 拍板乙;需求檔 `2026-08-12-admin-order-ui-design-brief.md:114`)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **為什麼是頁級不是函式級**:`goodsAxisProgressNote()` 算得對,**不代表那格畫面有印出來**。
//    有人把 `<GoodsAxisValue>` 換回純標籤,函式那族一格都不會紅 —— 同 `#514` 本身的教訓。
//    ⇒ 這一族全部斷言在 `container.textContent`(渲染輸出),**不讀常數、不讀檔案文字**。
describe('出貨狀態的解釋小字', () => {
  /** 四個量都給得出來的品項(上面那支 `item` 把 instock/shipped 釘死成 0,不夠用)。 */
  const line = (quantity: number, ordered: number, instock = 0, shipped = 0, cancelled = 0) => ({
    id: `ln-${quantity}-${ordered}-${instock}-${shipped}-${cancelled}`,
    title: '測試品項',
    spec: null,
    variantSku: 'SKU-NOTE',
    procurements: [],
    quantity,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 100 * quantity, currency: 'TWD' },
    quantitySummary: {
      orderedQuantity: ordered,
      instockQuantity: instock,
      shippedQuantity: shipped,
      cancelledQuantity: cancelled,
      cancellableQuantity: 0,
    },
  });

  const render = async (items: unknown[]) => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({ items } as unknown as Partial<AdminOrderDetail>),
    );
    return (await renderPage()).container.textContent ?? '';
  };

  /**
   * 🔴 **這一格是整片的理由**,而且用的是 Sean 拍板時給的那組數字(6 件訂 3 件)。
   * 「未訂貨」與「已訂 3 件」**必須同時出現** —— 那正是他要的「讓人看得懂」:
   * 不是把「未訂貨」改掉,是把它為什麼是「未訂貨」講出來。
   */
  it('🔴 未訂貨 + 部分已訂:兩句同時出現(Sean 拍板的 6 件訂 3 件)', async () => {
    const text = await render([line(6, 3)]);
    expect(text).toContain('未訂貨');
    expect(text).toContain('（本單 6 件中已訂 3 件）');
  });

  /**
   * 🔴🔴 **`#522` 續章:分母扣掉已取消,而在本片之前【這一族沒有任何一格碰得到那條路】** ——
   * 上面那個 `line()` helper 原本把 `cancelledQuantity` 寫死成 0(codex 對抗審查 2026-08-16 抓的)。
   * ⇒ 六格全綠,而它們**結構上構造不出**有取消的單 ⇒ 對取消零判別力。
   *
   * 🔴 **為什麼頁級要再做一次**(函式級已經有兩格):`#514` 自己的教訓 ——
   *    **算得對不代表那格畫面有印出來**。這一格斷言的是員工眼睛真的會看到的字。
   */
  it('🔴 6 件取消 3 件:畫面上的分母是 3 不是 6(軸與小字用同一個分母)', async () => {
    const text = await render([line(6, 3, 0, 0, 3)]);
    // need = 6−3 = 3、ordered 3 >= 3 ⇒ 軸升到「已向廠商訂貨」,小字改講到貨進度。
    expect(text).toContain('已向廠商訂貨');
    expect(text).toContain('（本單 3 件中已到貨 0 件）');
    // 🔴 反向釘死:舊分母那句話一個字都不准出現在畫面上。
    expect(text).not.toContain('本單 6 件');
  });

  it('已向廠商訂貨:小字改講【到貨】進度,不重複講已訂', async () => {
    const text = await render([line(4, 4, 1)]);
    expect(text).toContain('已向廠商訂貨');
    expect(text).toContain('（本單 4 件中已到貨 1 件）');
    // 軸=已訂滿 ⇒「已訂 4 件」恆等於分母、是廢話,不該印。
    expect(text).not.toContain('已訂 4 件');
  });

  it('已到貨:小字改講【出貨】進度', async () => {
    const text = await render([line(4, 4, 4, 2)]);
    expect(text).toContain('已到貨');
    expect(text).toContain('（本單 4 件中已出貨 2 件）');
  });

  /**
   * 🔴🔴 **本族唯一「斷言某個東西不存在」的格,也是最容易寫成恆綠的那格。**
   * 已出貨沒有下一階 ⇒ 沒有人會問「為什麼是已出貨」⇒ 整行不該出現。
   * ⚠️ 斷言用 `本單`(小字的共同前綴)而不是某一句完整文案:
   *    釘完整文案的話,改文案就會讓這格**靜默失去判別力**(它只是不再命中而已)。
   */
  it('🔴 已出貨:一行小字都不該出現', async () => {
    const text = await render([line(2, 2, 2, 2)]);
    expect(text).toContain('已出貨');
    expect(text).not.toContain('本單');
  });

  /**
   * 🔴🔴 **`quantitySummary === null` ⇒ 一個數字都不准印。**
   * 軸把 null 當 0 是它判階段用的裁定;**那個 `?? 0` 不能搬到「印件數給人看」這個用途**。
   * 印「已訂 0 件」會把「摘要列不存在」與「真的一件都沒訂」講成同一句話。
   */
  it('🔴 摘要列不存在:印「尚未就緒」,絕不印「已訂 0 件」', async () => {
    const text = await render([{ ...line(3, 0), quantitySummary: null }]);
    expect(text).toContain('部分品項數量資料尚未就緒');
    expect(text).not.toContain('已訂 0 件');
    expect(text).not.toContain('本單 3 件');
  });

  /**
   * 分母是**該單所有品項加總**,不是逐品項列。
   * ⚠️ 這一格順便釘住「單品項單看不出來」的那個歧義 —— Sean 給的例子剛好是單品項。
   */
  it('多品項:分母 = 全單件數加總(6+4=10)', async () => {
    const text = await render([line(6, 3), line(4, 0)]);
    expect(text).toContain('（本單 10 件中已訂 3 件）');
  });

  /**
   * 🔴🔴 **`itemsTruncated` ⇒ 連【軸的標籤】都不印,不只小字。**
   *
   * backlog 登記的是「小字沒有截斷閘」,而實查之後**標籤那半也沒有,且嚴重得多**:
   * `goodsAxisOfLines` 三條判定都是 `.every(...)`
   * ⇒ **看得見的 200 件全出貨就答「已出貨」,而沒載進來的那些可能一件都沒出。**
   * ⚠️ 字面是 `已出貨`(`GOODS_AXIS_LABEL.shipped`);`出貨完成` 是**列表**八值、不是這一格。
   * ⇒ 少算一個數字員工還會去查;**講錯狀態他會停止動作。**
   *
   * 🔴🔴 **fixture 必須用 `line(4, 4, 1)`(軸 = 已向廠商訂貨),不能用 `line(2,2,2,2)`。**
   *    我第一版用了後者,而**它分不開兩種實作** —— `2,2,2,2` 的軸是 `shipped`,
   *    而 `goodsAxisProgressNote` 對 `shipped` **本來就回 `null`**
   *    ⇒ `not.toContain('本單')` 在那個 fixture 上**恆真**
   *    ⇒ 「只擋標籤、小字照印」那發突變**照樣全綠 37/37**。
   *    📎 **這與 R3 一小時前抓到我的那條是同一個病**(fixture 的形狀讓兩種寫法收斂到同一輸出),
   *       而我在讀完那條之後**立刻又犯了一次** ⇒ 判別句要在**選 fixture 的那一刻**問,
   *       不是在寫完斷言之後問:**我這組 fixture,分得開我宣稱的那兩件事嗎?**
   *
   * 🔴 **兩條反向斷言各擋一半**,兩發突變分別證過(見下方那格的 `已出貨`):
   *   `not('已向廠商訂貨')` 擋「標籤照印」/ `not('本單')` 擋「小字照印」
   */
  it('🔴 itemsTruncated:軸的標籤與小字【都】不印,改印未知', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({
        // 軸 = 已向廠商訂貨(4 件訂滿、到貨 1)⇒ **標籤與小字【兩者都會出現】**,兩半才都測得到。
        items: [line(4, 4, 1)],
        itemsTruncated: true,
      } as unknown as Partial<AdminOrderDetail>),
    );
    const text = (await renderPage()).container.textContent ?? '';
    // 🔴🔴 **錨要含「出貨狀態未知」這個【相鄰串】,不能只釘說明句**(code-reviewer 抓到,第三發突變):
    //    第三種錯誤實作 = **閘只回說明 span、不印「未知」** ⇒ 那一列變成沒有值、只剩一行灰字,
    //    而上面三條斷言【全過】。
    //    ⚠️ 而直覺的補法 `toContain('未知')` **恆真** —— 同一頁的 `HeadlineNumbers` 在
    //    `itemsTruncated` 時也印「未知」(同檔搜 `qty === null ? '未知'`)⇒ 那個字全頁不只一處。
    //    ⇒ 釘 label + 值 + 說明的**相鄰串**:`textContent` 會把它們接起來,而那串全樹唯一。
    expect(text).toContain('出貨狀態未知這張單的品項清單這次沒有完整載入');
    expect(text).not.toContain('已向廠商訂貨');
    expect(text).not.toContain('本單');
  });

  /**
   * 🔴 **最危險的那個答案單獨釘一格**:`.every()` 在被截斷的子集上會答「已出貨」——
   * 看得見的 2 件全出貨了,而沒載進來的那些可能一件都沒出。
   * **員工看到「已出貨」會停止動作**,這是本閘存在的真正理由。
   */
  it('🔴 itemsTruncated + 看得見的全出貨:不得答「已出貨」', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      detail({
        items: [line(2, 2, 2, 2)],
        itemsTruncated: true,
      } as unknown as Partial<AdminOrderDetail>),
    );
    const text = (await renderPage()).container.textContent ?? '';
    expect(text).not.toContain('已出貨');
  });

  /**
   * 🔴 **正向對照** —— 同一組品項、只把 `itemsTruncated` 關掉,標籤與小字都該回來。
   * 沒有這一格,上面兩格的反向斷言可能只是因為那些字本來就不會出現。
   */
  it('正向對照:同一組品項沒有截斷時,標籤與小字照常印出來', async () => {
    const text = await render([line(4, 4, 1)]);
    expect(text).toContain('已向廠商訂貨');
    expect(text).toContain('（本單 4 件中已到貨 1 件）');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 頭條數字(BMW M 片4b;規格 `docs/specs/2026-08-16-bmw-m-headline-numbers-spec.md`)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **全部斷言在 `container.textContent`(整頁渲染輸出),不斷言函式回傳值。**
//    理由逐字取自 `order-status-axes.ts`(搜 `算得對不等於`):「**算得對不等於那個畫面有印出來**」。
//    ⚠️ **頭條更該如此**:它是員工一眼就看的那個,量回傳值等於沒量。
//
// 🔴🔴 **本族守的那句話**:「不知道」與「是 0」不是同一件事,
//    而【頭條數字】是最不能把這兩者講成同一句的位置 ——
//    後端把「不知道」當 0,下游還有機會發現;**畫在畫面上,那就是最終答案。**
describe('訂單明細頭條數字', () => {
  /** 與上面那族同型的 line helper(四個量都給得出來)。 */
  const line = (quantity: number, ordered: number, instock = 0, shipped = 0, cancelled = 0) => ({
    id: `hl-${quantity}-${ordered}-${instock}-${shipped}-${cancelled}`,
    title: '測試品項',
    spec: null,
    variantSku: 'SKU-HL',
    procurements: [],
    quantity,
    unitPrice: { amount: 100, currency: 'TWD' },
    lineTotal: { amount: 100 * quantity, currency: 'TWD' },
    quantitySummary: {
      // 🔴 **`quantity` 也在 summary 裡**(`AdminOrderItemQuantitySummary` 搜 `quantity: number;`)——
      //    上面那個 `line()` 家族原本沒給它。發現方式:寫「災難當天」那格時把整頁 textContent
      //    印出來看,撞到 `還有 NaN 件沒有登記來源` 與取消表的 `NaN`。
      //    病根:`unsourcedQuantity` 算 `summary.quantity - cancelled - ordered`
      //    ⇒ `undefined - 0 - 4 = NaN`。**是 fixture 缺欄位,不是產品缺陷**
      //    (真型別保證這個欄位在;`procurement-view.ts` 搜 `型別擋不住的東西` 那段記著同款事故)。
      //    ⚠️ **但它值得留一句**:少一個欄位不會紅、不會噴錯,**只會在畫面上長出一個 `NaN`** ——
      //    而本檔的斷言全在 `container.textContent` 裡撈子字串,**撈不到的地方就看不到它**。
      quantity,
      orderedQuantity: ordered,
      instockQuantity: instock,
      shippedQuantity: shipped,
      cancelledQuantity: cancelled,
      cancellableQuantity: 0,
    },
  });

  const render = async (over: Partial<AdminOrderDetail>) => {
    mocks.findAdminOrderDetail.mockResolvedValue(detail(over as Partial<AdminOrderDetail>));
    return (await renderPage()).container.textContent ?? '';
  };

  it('🔴 正常單:四個數字都印得出來,兩個小標都在', async () => {
    // total = 1200 元;收款兩筆共 500。品項:6 件訂 4 件、到貨 2 件。
    // 🔴 **欄位照 `OrderPaymentRow` 的真形狀給全,不給簡化版**(code-reviewer 2026-08-16 nit):
    //    第一版只給 `{id, method, amount, receivedAt, note}` —— 那不是這個型別的欄位名,
    //    靠 `labelOrRaw` 的 `Object.hasOwn` 吃掉 undefined 才沒炸 ⇒ **真契約改欄位時這族不會紅。**
    const row = (id: string, amount: number, receivedAt: string) => ({
      id, rail: 'atm', amount, receivedAt, createdAt: receivedAt, actor: 'tester',
      bankReference: null, recTradeId: null, payerNote: null,
      reversesPaymentId: null, reversalReason: null, isReversal: false,
    });
    mocks.listOrderPayments.mockResolvedValue([
      row('p1', 300, '2026-08-10T02:00:00+00:00'),
      row('p2', 200, '2026-08-11T02:00:00+00:00'),
    ]);
    const text = await render({
      total: { amount: 1200, currency: 'TWD' },
      items: [line(6, 4, 2)],
    } as unknown as Partial<AdminOrderDetail>);

    expect(text).toContain('1,200 / 500總額 / 已收');
    expect(text).toContain('4 / 2件數 已訂 / 到貨');
    // 🔴 **小標存廢是 Sean 逐字更正過的那一件**(「寫數字就好」講的是數值呈現、不是拿掉標籤)
    //    ⇒ 這兩條不是裝飾,是把那次更正釘成機械載體。
    expect(text).toContain('1,200 / 500總額 / 已收');
    expect(text).toContain('件數 已訂 / 到貨');
  });

  /**
   * 🔴 **大金額:千分位要在,而且兩格並排時仍撈得到**(Sean 的真實單據級距)。
   *
   * 他 2026-08-16 給的三張截圖金額是 **6 / 1,180 / 48,600** —— 三個級距。
   * 而本檔原本的測資是 `100` 與 `1,200` ⇒ **五位數那一段從來沒被餵過**。
   *
   * ⚠️ **這一格【不能】驗折行** —— jsdom 沒有排版引擎,`textContent` 拿不到換行資訊。
   *    它驗的只有「格式化正確 + 錨仍撈得到」。**折不折行只有真瀏覽器 + 真寬度才驗得了**,
   *    那件已交給 Sean 肉眼(而主視窗從他那張 `1,180` 的圖判「還有很多空間」⇒ 風險低)。
   *    🔴 **寫出來是因為**:一格叫「大金額」的測試很容易被下一個人當成「版面已驗」。**它不是。**
   */
  it('大金額:千分位正確,兩格並排時錨仍撈得到(48,600 / 20,000)', async () => {
    mocks.listOrderPayments.mockResolvedValue([
      {
        id: 'p9', rail: 'atm', amount: 20000, receivedAt: '2026-08-10T02:00:00+00:00',
        createdAt: '2026-08-10T02:00:00+00:00', actor: 'tester', bankReference: null,
        recTradeId: null, payerNote: null, reversesPaymentId: null, reversalReason: null,
        isReversal: false,
      },
    ]);
    const text = await render({
      total: { amount: 48600, currency: 'TWD' },
      items: [line(6, 4, 2)],
    } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('48,600 / 20,000總額 / 已收');
    expect(text).toContain('4 / 2件數 已訂 / 到貨');
  });

  /**
   * 🔴🔴 **`Q-A7`:頭條扣已取消件數 —— 判準是「與軸一致」,而軸自 `#522` 續章起就扣了。**
   * 6 件取消 3 件、已訂 4 件:`lineNeed` = 3 ⇒ 分子夾在 3 之內 ⇒ **印 3 不是 4**。
   * ⚠️ 沒有那個 `Math.min`,這裡會印出「3 件裡訂了 4 件」——**分子大於分母**。
   */
  it('🔴 有取消件數:已訂數夾在 lineNeed 之內(6 件取消 3 件、已訂 4 ⇒ 印 3)', async () => {
    const text = await render({ items: [line(6, 4, 0, 0, 3)] } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('3 / 0件數');
    expect(text).not.toContain('4 / 0件數');
  });

  /**
   * 🔴 **正向對照** —— 沒有這一格,上面那格的「3」可能只是碰巧。
   * 同一組數字**把取消拿掉**,頭條就該印回 4:證明變的是取消、不是別的東西。
   */
  /**
   * 🔴🔴 **多品項 —— 而這一格存在的理由是:在它之前【七格 fixture 全是單一 line】。**
   *
   * R3 對抗審查(2026-08-16,換角度)抓到:單 line 之下,兩個實作級突變**七格全綠** ——
   * 因為 `Math.min` 夾在**逐列**還是夾在**加總之後**,單 line 時輸出完全相同。
   * ⇒ **「共用 `lineNeed`」這個機制的判別力,在此之前沒有任何一格量過。**
   *
   * 反例逐字取自 `goodsAxisOfLines` 的 docstring(搜 `列A`),那是 `#522` 續章折出來的:
   * ```
   * 列A quantity 6 / ordered 6 / cancelled 6  ⇒ lineNeed 0，而 orderedQuantity 仍是歷史值 6
   * 列B quantity 4 / ordered 0 / cancelled 0  ⇒ lineNeed 4
   * ```
   * 逐列夾:min(6,0) + min(0,4) = **0**;先加總再夾:min(6+0, 0+4) = **4**。
   * ⇒ **這一格是那兩種寫法唯一分得開的地方。**
   */
  it('🔴 多品項:整筆取消的列不把歷史量帶進分子(逐列夾,不是加總後才夾)', async () => {
    const text = await render({
      items: [line(6, 6, 0, 0, 6), line(4, 0)],
    } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('0 / 0件數 已訂 / 到貨');
    // 🔴 `4 / 0` = 「先加總再夾」會印出來的值 —— 它讀起來完全合理,這正是它危險的地方。
    // ⚠️ **必須帶 `件數` 錨**:拿掉 `NT$` 之後金額也是裸數字對,
    //    總額末位是 4 的單(如 `104`)會印 `104 / 0` ⇒ 裸寫 `not.toContain('4 / 0')` 被金額撞紅。
    //    🔴 **這一處是我用「成對取代」漏掉的**:同一句話在檔裡有兩處,我只改了相鄰那一組。
    //       突變 M(把預設總額 100 改成 104)當場把它照出來。**改字面要先建完整清單,不要就地成對取代。**
    expect(text).not.toContain('4 / 0件數');
  });

  /**
   * 🔴🔴 **部分 null —— ①閘的真正形狀是「任一列不知道就整格不知道」,不是「全部都不知道才」。**
   *
   * R3 抓到:`goodsQuantityHeadline` 的 `lines.some((l) => l.quantitySummary === null)`
   * 改成 `every`,**七格全綠** —— 因為沒有一格餵得出「一列有、一列沒有」。
   * 而 `every` 之下混合單會走進 `?? 0`,**印出一個少算的數而零訊號**,
   * 那正是本片引述那段警告(「同一個值,兩種用途,只有一種合法」)要擋的病。
   */
  it('🔴 多品項:只要一列的摘要不存在,整格就是未知(不是把那列當 0 加進去)', async () => {
    const text = await render({
      items: [line(2, 1), { ...line(3, 2), quantitySummary: null }],
    } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('未知件數 已訂 / 到貨');
    // 🔴 `1 / 0` = 把那列當 0 加進去會印出來的值。
    expect(text).not.toContain('1 / 0件數');
  });

  it('正向對照:同一組數字沒有取消時,已訂數印回 4', async () => {
    const text = await render({ items: [line(6, 4, 0, 0, 0)] } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('4 / 0件數');
  });

  it('🔴 摘要列不存在:件數那格印「未知」,一個數字都不印', async () => {
    const text = await render({
      items: [{ ...line(3, 2, 1), quantitySummary: null }],
    } as unknown as Partial<AdminOrderDetail>);
    // 🔴 錨含「未知」二字(R2 抓到):只釘小標的話,格名宣稱「印未知」而沒有任何一格斷言得到它。
    expect(text).toContain('未知件數 已訂 / 到貨');
    // 🔴 反向釘死:那格若退回 `?? 0`,畫面會出現 `0 / 0`;若沒接上 null 閘,會出現 `2 / 1`。
    // 🔴🔴 **反向錨必須帶小標** —— 拿掉 `NT$` 之後(Sean 2026-08-16「不用NT」),
    //    金額那格印的是 `100 / 0`,而 **`'100 / 0'` 字面上包含 `'0 / 0'`**
    //    ⇒ 裸寫 `not.toContain('0 / 0')` 會被【金額】撞紅,而它要驗的是【件數】。
    //    📎 這是「拿掉貨幣符號 ⇒ 兩格都變成裸數字對」的第一個實證後果:
    //       `2,480 / 0`(金額)與 `4 / 2`(件數)**在字串層再也分不開**,
    //       所有跨這兩格的斷言都必須帶小標當定位。**員工的眼睛也一樣。**
    expect(text).not.toContain('2 / 1件數');
    expect(text).not.toContain('0 / 0件數');
  });

  /**
   * 🔴🔴 **`itemsTruncated` ⇒ 加總會少算 ⇒ 不印。**
   * ⚠️ 這一格是**唯一**擋得到截斷的地方:`goodsQuantityHeadline` 的參數型別看不到這個旗標。
   * 風險已量(`ORDER_ITEMS_EMBED_LIMIT = 200`,機車零件單到不了),**但代價不對稱** ——
   * 讀它 = 截斷時改印「未知」;不讀它 = 印出一個少算的數而**零訊號**。
   */
  it('🔴 itemsTruncated:件數那格印「未知」,不印一個少算的數', async () => {
    const text = await render({
      items: [line(6, 4, 2)],
      itemsTruncated: true,
    } as unknown as Partial<AdminOrderDetail>);
    // 🔴 **正向錨必須在反向斷言【之前】** —— 只有 `not.toContain` 的話,
    //    `HeadlineNumbers` 整個不渲染(prop 沒傳 / 格子被刪 / 元件早退)這一格照樣綠。
    //    code-reviewer 2026-08-16 抓到:**這格原本測不出「那格還在」,只測得出「那個數不在」。**
    //    ⚠️ 錨選小標而不是「未知」二字:本 fixture 的 `payments.status === 'ok'`
    //    ⇒ 付款卡印「0 筆」不印「筆數未知」,但「未知」在別族文案裡出現過 ⇒ 拿它當錨會撞。
    //    📎 **這個修法本身量過**:讓 `HeadlineNumbers` 整塊不渲染 ——
    //       有正向錨 ⇒ 六格全紅;拿掉正向錨 ⇒ **只紅五格,這一格綠著**。
    // 🔴🔴 **錨要含「未知」二字**(R2 抓到,第二層):只釘小標的話,這格名字宣稱「印未知」
    //    而**全檔沒有一格斷言得到它** —— 把 `'未知'` 改成 `''` 兩格都還是綠。
    //    ⚠️ 上面那句「拿『未知』當錨會撞」對**裸兩字**成立,對**接合字串**不成立:
    //    `.v` 與 `.l` 兩個 `<p>` 相鄰 ⇒ `textContent` 直接相連成「未知件數 已訂 / 到貨」,
    //    而那串全樹唯一。**⇒ 錨要選得夠窄,不是選得夠短。**
    expect(text).toContain('未知件數 已訂 / 到貨');
    expect(text).not.toContain('4 / 2件數');
  });

  /**
   * 🔴 **`PaymentSummary.kind === 'unknown'` ⇒ 已收那半不畫任何金額。**
   * 出處錨點:`payment-list.tsx` 搜 `不畫任何金額` —— 讀不到明細時算出來的「已收」必然是假的,
   * 而它會被畫成一句員工無法分辨真假的催款訊息。
   * ⚠️ **總額仍然要印** —— 它來自 `detail.total`,不走收款那條路,沒有不知道的問題。
   */

  /**
   * 🔴🔴 **災難當天:兩格【同時】命中閘。** 前五格各驗一條閘,**沒有一格驗它們一起發生。**
   *
   * 這一格問的不是「算得對不對」,是**員工在資料半殘的那一天看到什麼**:
   * 畫面會不會看起來像**壞掉**(而不是像「我們知道我們不知道」)、會不會誘導他做錯的操作。
   *
   * 落筆當下的實際輸出(**先用拋棄式探針把字印出來看,再寫成斷言 —— 不是先猜期望值**):
   *   `1,200 / 未知` + `總額 / 已收` + `未知` + `件數 已訂 / 到貨`
   *   (2026-08-16 更新:Sean 拍「不用NT」+ `Q-A216-F2b` 小標改「件數」⇒ 舊字面已作廢)
   * ⇒ **總額仍是一個真數字**(它不走收款那條路)⇒ 畫面不是一片「未知」、不像故障。
   * ⇒ 兩個小標都還在 ⇒ 員工知道**這裡本來該有什麼**,只是現在讀不到。
   *
   * 🔴 **最重要的是最後兩條反向斷言**:半殘狀態下**一個誤導性的數字都不准漏出來**。
   *    `4 / 2`(截斷前的少算值)或 `NT$ 0`(把讀不到當成沒收到錢)任何一個跑出來,
   *    員工都可能據以**重複下單**或**重複催款**。
   */
  it('🔴 災難當天:收款讀不到 + 品項截斷同時發生,兩格各自誠實、不漏出任何假數字', async () => {
    mocks.listOrderPayments.mockRejectedValue(new Error('讀不到'));
    const text = await render({
      total: { amount: 1200, currency: 'TWD' },
      items: [line(6, 4, 2)],
      itemsTruncated: true,
    } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('1,200 / 未知總額 / 已收');
    expect(text).toContain('未知件數 已訂 / 到貨');
    expect(text).not.toContain('4 / 2件數');
    // 🔴 **「已收那半永遠不是一個金額」要釘得【夠窄】** ——
    //    我第一版寫 `not.toContain('NT$ 0')`,結果**假紅**:那串命中的是頁面別處的「運費 NT$ 0」。
    //    ⇒ 反向斷言選太寬會撞到無關內容,而**它的症狀是紅、看起來像抓到 bug**(同 §⑧ 那個病)。
    //    正解:釘「總額後面接的是不是另一個金額」這個**結構**,不是釘一個到處都有的字串。
    // 🔴 **釘的是【結構】不是一個字面值**(code-reviewer 2026-08-16 抓到我把守門改窄了):
    //    上一版 `not.toContain('1,200 / 0總額')` **只在已收恰為 `0` 時紅**;
    //    閘壞成 `settled / received=1200` 會印 `1,200 / 1,200總額`,那條斷言**綠**。
    //    ⇒ regex 釘「總額前面接的是不是【任何】數字」,對任何金額都紅。
    expect(text).not.toMatch(/1,200 \/ [\d,]+總額/);
    // 🔴🔴 **半殘那一天,整頁不准出現 `NaN`。** 這一條不是本片的職責範圍,而是
    //    **只有這一格會在「資料不完整」的狀態下把整頁渲染出來** ⇒ 它是唯一站得到這個位置的格。
    //    實錘:寫這一格時就撞到兩個 `NaN`(採購區與取消表),病根是本檔 fixture 少給
    //    `quantitySummary.quantity`。**少一個欄位不會紅、不會噴錯,只會長出一個 `NaN`。**
    expect(text).not.toContain('NaN');
  });

  it('🔴 收款讀不到:總額照印,已收不畫金額', async () => {
    mocks.listOrderPayments.mockRejectedValue(new Error('讀不到'));
    const text = await render({
      total: { amount: 1200, currency: 'TWD' },
      items: [line(1, 0)],
    } as unknown as Partial<AdminOrderDetail>);
    expect(text).toContain('1,200 / 未知總額 / 已收');
    // 🔴 反向釘死:退回「算不出來就當 0」的話,這裡會出現一個假的已收金額。
    // 🔴 **釘的是【結構】不是一個字面值**(code-reviewer 2026-08-16 抓到我把守門改窄了):
    //    上一版 `not.toContain('1,200 / 0總額')` **只在已收恰為 `0` 時紅**;
    //    閘壞成 `settled / received=1200` 會印 `1,200 / 1,200總額`,那條斷言**綠**。
    //    ⇒ regex 釘「總額前面接的是不是【任何】數字」,對任何金額都紅。
    expect(text).not.toMatch(/1,200 \/ [\d,]+總額/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 訂單明細的 Email 欄:LINE 合成位址不外顯(Sean 2026-08-16 拍板乙)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴 **這一處是盤點時多找到的第三個顯示點** —— 交辦只提客戶頁的列表與明細。
//    客服處理訂單時看到的就是那串內部識別碼 ⇒ 只修客戶頁 = 修一半。
describe('訂單明細 Email 欄:LINE 合成位址不外顯', () => {
  const withEmail = (email: string) =>
    detail({ customer: { name: '測試客戶', phone: null, email } } as unknown as Partial<AdminOrderDetail>);

  it('🔴 合成位址 → 顯示替代字面,原字串不出現', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(
      withEmail('line_u5877604cab5e67badac879d777bf702e@line.pcmmotorsports.local'),
    );
    const { container } = await renderPage();
    expect(container.textContent).toContain('LINE 帳號登入,無 Email');
    expect(container.textContent).not.toContain('line_u');
    expect(container.textContent).not.toContain('pcmmotorsports.local');
  });

  // 正向對照:真 Email 照樣顯示 ⇒ 上一格不是因為「這頁不顯示 Email」而過。
  it('真 Email 仍原樣顯示(正向對照)', async () => {
    mocks.findAdminOrderDetail.mockResolvedValue(withEmail('sean@example.com'));
    const { container } = await renderPage();
    expect(container.textContent).toContain('sean@example.com');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 危險操作沉底:取消 / 退貨 / 退款(2026-08-16)
// ─────────────────────────────────────────────────────────────────────────────
//
// 🔴🔴 **為什麼需要這一格**:在它之前,全 repo **零個順序守門**
//    (數法 `grep -rn 'DOM 順序\|indexOf' apps/admin/src --include='*.test.tsx'`
//     ⇒ 命中的都是表格欄序或候選排序,沒有一個釘區塊順序)。
//    ⇒ **把取消搬回中間、或下一次重排時順手挪動它,不會有任何東西紅。**
//
// 🔴 **釘的是【語意順序】不是行號**:取消**必須排在出貨之後**。
//    兩個獨立來源都這樣說,而在本片之前現況兩邊都不符:
//      · Sean 逐字(design-brief 搜 `回去採購等於說跟國外下單` 同段):
//        「最難的大概就是取消,**所以放最下面沒問題**」
//      · OD 定案主稿 `overview-desktop.html` 搜 `危險操作沉底`
describe('危險操作沉底:取消排在出貨之後', () => {
  /**
   * 🔴 **用 `textContent.indexOf` 比位置,不用行號、不用 DOM 樹結構。**
   *    行號會漂;DOM 結構改成別的包法(例如加一層 wrapper)不該讓這格紅 ——
   *    **我要釘的是「員工由上往下讀的時候,先看到出貨還是先看到取消」。**
   * ⚠️ **錨要選【一定會渲染】的字**:
   *    · 出貨側用出貨卡的標題(該卡在本檔被 mock 成 `() => null` ⇒ **不能用它**)
   *      ⇒ 改用**採購區**當上游錨:採購在出貨之前,而取消若排在採購之後就必然在出貨之後。
   *    · 取消側用取消區塊的標題文字。
   *    🔴 這個替代**弱一點**,而我明寫出來:它證的是「取消在採購之後」,
   *       **由「採購 → 出貨 → 取消」這個既定順序推出「取消在出貨之後」**。
   *       出貨卡本身在本檔測不到(async server component 的工具限制,見檔頭 mock 的理由)。
   */
  it('🔴 取消區塊排在採購之後(⇒ 由既定順序推得在出貨之後)', async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    const procurement = text.indexOf('採購(向供應商訂貨)');
    const cancel = text.indexOf('取消訂單');
    expect(procurement, '採購區塊沒渲染 ⇒ 這格的上游錨不見了,不是順序對了').toBeGreaterThan(-1);
    expect(cancel, '取消區塊沒渲染 ⇒ 錨不見了').toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(procurement);
  });

  /**
   * 🔴 **正向對照:取消也必須排在【收款】之後** —— 它原本就夾在收款與品項之間,
   * 只釘「在採購之後」擋不住「搬回收款正下方」以外的所有位置,但**擋得住原本那個位置**。
   */
  it('取消區塊排在收款之後(擋住搬回原位)', async () => {
    const { container } = await renderPage();
    const text = container.textContent ?? '';
    const payment = text.indexOf('尚未登錄任何收款');
    const cancel = text.indexOf('取消訂單');
    expect(payment, '收款區塊沒渲染 ⇒ 錨不見了').toBeGreaterThan(-1);
    expect(cancel).toBeGreaterThan(payment);
  });
});
