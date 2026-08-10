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
}));
// M-3 RW3:page 直接 import refund-read(→ server-only)⇒ 必 mock;
// 本檔另有帳本顯示鏈的接線格,mock 給 hoisted 的可控版本。
vi.mock('../../../lib/payment/refund-read', () => ({
  listOrderRefunds: mocks.listOrderRefunds,
  getLedgerUnregisteredAmount: mocks.getLedgerUnregisteredAmount,
}));
vi.mock('../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({ findAdminOrderDetail: mocks.findAdminOrderDetail }),
}));
vi.mock('../../../lib/supplier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/supplier')>();
  return { ...actual, listSuppliers: mocks.listSuppliers };
});
vi.mock('../../../lib/supplier-repository', () => ({ listSupplierRows: vi.fn() }));

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
    expect(container.textContent).toContain('退款紀錄');
    // 'NT$ 777' 全字面:fixture displayId='ABC123' 會讓裸 '123' 恆真(opus R1 nit、撞號教訓)。
    expect(container.textContent).toContain('NT$ 777');
    expect(container.textContent).toContain('帳本未登記額');
    expect(container.textContent).toContain('877');
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
    expect(container.textContent).toContain('退款帳本載入失敗');
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
    expect(container.textContent).toContain('對帳異常');
    expect(hasRefundEntry(container)).toBe(false);
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
    expect(container.textContent).toContain('讀取失敗');
    expect(container.textContent).not.toContain('查無');
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
