// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  listStaffRows: vi.fn(),
  findCandidates: vi.fn(),
  createClient: vi.fn(),
  newId: vi.fn(),
  formBody: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: mocks.createClient }));
vi.mock('@/lib/staff-repository', () => ({ listStaffRows: mocks.listStaffRows }));
vi.mock('@/lib/customers/manual-customer', () => ({
  findCustomerCandidatesByPhone: mocks.findCandidates,
}));
// 🔴 解析器與 `isUuid` **不 mock** —— 餵真值走真判斷,否則「只認合法 uuid」是恆真斷言。
vi.mock('@/lib/orders/manual-order-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/orders/manual-order-form')>();
  return { ...actual, newManualRequestId: mocks.newId };
});
// 🔴 表單本體換成探針:本檔要驗的是【頁面遞了什麼下去】,不是它長怎樣。
vi.mock('@/components/orders/manual-order-form-body', () => ({
  ManualOrderFormBody: (props: Record<string, unknown>) => {
    mocks.formBody(props);
    return <div data-testid='form-body-stub' />;
  },
}));

import ManualOrderNewPage from './page';
import { ManualOrderView } from '@/components/orders/manual-order-view';

// app/orders/new/page.test.tsx — codex R3(gpt-5.5,換角度換模型)抓到的兩條 must-fix:
//   ① 整頁沒有測試 ⇒ 拆掉「失敗導回沿用合法 mrid」,元件與 action 測試**仍可能全綠**
//   ② 把 selectedCustomer 改成直接信 URL 的 customer,元件測試**照樣綠**
//      —— 因為它們直接餵 props,不跑「候選名單驗 customer」這個 **page 層合約**。
// 🔴 母題:**測試餵 props 的那一層,量不到組出那些 props 的那一層。**

const MINTED = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CARRIED = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';

function candidate(userId = CUSTOMER) {
  return { userId, name: '王小明', email: 'a@example.test', phone: '0912345678', isManual: false };
}

// 🔴🔴 **2026-08-28 線A:內容搬進 `components/orders/manual-order-view.tsx`。**
//    那是因為同一份畫面現在要同時長在整頁與右側面板(`/orders?panel=new`)兩個地方,
//    而兩邊各自載一次資料 = 兩個真相源。
//    ⇒ 本檔那 13 格量的**合約沒有變**,只是它現在住在 View 裡 ⇒ 改成直接跑 View。
//    ⚠️ 而「整頁那一頁真的把事情交給 View」**變成一個新的、量得到的宣稱** ⇒ 下面那格。
async function renderPage(params: Record<string, string> = {}) {
  const ui = await ManualOrderView({ raw: params });
  return render(ui);
}

function lastProps(): Record<string, unknown> {
  return mocks.formBody.mock.calls.at(-1)![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.newId.mockReturnValue(MINTED);
  mocks.listStaffRows.mockResolvedValue([{ id: 'alice', label: '小愛', is_active: true }]);
  mocks.findCandidates.mockResolvedValue({
    candidates: [candidate()],
    truncated: false,
    samePhoneCount: 1,
    shouldWarnDuplicates: false,
  });
  mocks.createClient.mockReturnValue({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('🔴🔴 冪等鍵的 page 層合約(codex R3 must-fix:這一層原本零測試)', () => {
  it('網址帶合法 mrid ⇒ **沿用它**,不鑄新的', async () => {
    await renderPage({ mrid: CARRIED });
    expect(lastProps().manualRequestId).toBe(CARRIED);
    expect(mocks.newId).not.toHaveBeenCalled();
  });

  it('🔴 負對照:沒帶 ⇒ 鑄新的(少了這格,「永遠沿用」也會全綠)', async () => {
    await renderPage({});
    expect(lastProps().manualRequestId).toBe(MINTED);
  });

  it('🔴 帶的不是 uuid ⇒ 鑄新的(RPC 對非 uuid 一律拒,帶回去只是製造下一次失敗)', async () => {
    await renderPage({ mrid: 'not-a-uuid' });
    expect(lastProps().manualRequestId).toBe(MINTED);
  });

  it('🔴🔴 有結果碼而鍵不見了 ⇒ 出警告(靜默鑄新 + 文案叫他重送 = 建出第二張真訂單)', async () => {
    await renderPage({ r: 'manual_order_error', mrid: 'broken' });
    expect(screen.getByTestId('manual-order-key-lost')).toBeTruthy();
  });

  it('🔴 負對照①:有結果碼**而鍵還在** ⇒ 不出那個警告', async () => {
    await renderPage({ r: 'manual_order_error', mrid: CARRIED });
    expect(screen.queryByTestId('manual-order-key-lost')).toBeNull();
  });

  it('🔴 負對照②:**沒有結果碼**(第一次開表單)⇒ 不出那個警告', async () => {
    // 少了這格,「一進來就喊編號不見了」也會讓上面那格全綠 —— 而那會嚇到每一個員工。
    await renderPage({});
    expect(screen.queryByTestId('manual-order-key-lost')).toBeNull();
  });

  it('編號印在畫面上,而且就是遞下去的那一顆', async () => {
    await renderPage({ mrid: CARRIED });
    expect(screen.getByTestId('manual-order-request-id').textContent).toContain(CARRIED);
  });
});

describe('🔴🔴 選定客人必須來自【這次查回來的候選】(codex R3 must-fix)', () => {
  it('customer 在候選裡 ⇒ 選定', async () => {
    await renderPage({ phone: '0912345678', customer: CUSTOMER });
    expect((lastProps().selectedCustomer as { userId: string } | null)?.userId).toBe(CUSTOMER);
  });

  it('🔴 customer 不在候選裡 ⇒ **null**(不得直接信 URL 上那個 id)', async () => {
    await renderPage({ phone: '0912345678', customer: '33333333-3333-4333-8333-333333333333' });
    expect(lastProps().selectedCustomer).toBeNull();
  });

  it('🔴 沒搜過就帶 customer ⇒ null(候選是空的, 沒有東西可以核)', async () => {
    await renderPage({ customer: CUSTOMER });
    expect(lastProps().selectedCustomer).toBeNull();
    expect(mocks.findCandidates).not.toHaveBeenCalled();
  });
});

describe('🔴 兩種「沒有」不得印同一個畫面', () => {
  it('員工名單讀不到 ⇒ activeStaff 空 **且** staffLoadFailed=true', async () => {
    mocks.listStaffRows.mockRejectedValue(new Error('boom'));
    await renderPage({});
    expect(lastProps().activeStaff).toEqual([]);
    expect(lastProps().staffLoadFailed).toBe(true);
  });

  it('🔴 負對照:真的沒有啟用中員工 ⇒ activeStaff 空 **而** staffLoadFailed=false', async () => {
    mocks.listStaffRows.mockResolvedValue([{ id: 'bob', label: '小巴', is_active: false }]);
    await renderPage({});
    expect(lastProps().activeStaff).toEqual([]);
    expect(lastProps().staffLoadFailed).toBe(false);
  });

  it('客人查詢壞掉 ⇒ lookupFailed=true 而候選空', async () => {
    mocks.findCandidates.mockRejectedValue(new Error('boom'));
    await renderPage({ phone: '09' });
    expect(lastProps().lookupFailed).toBe(true);
    expect(lastProps().candidates).toEqual([]);
  });

  it('🔴 負對照:真的查無 ⇒ lookupFailed=false', async () => {
    mocks.findCandidates.mockResolvedValue({
      candidates: [], truncated: false, samePhoneCount: 0, shouldWarnDuplicates: false,
    });
    await renderPage({ phone: '09' });
    expect(lastProps().lookupFailed).toBe(false);
  });

  it('停用中的員工不得進下拉(過濾的是 is_active, 不是筆數)', async () => {
    mocks.listStaffRows.mockResolvedValue([
      { id: 'alice', label: '小愛', is_active: true },
      { id: 'bob', label: '小巴', is_active: false },
    ]);
    await renderPage({});
    expect(lastProps().activeStaff).toEqual([{ id: 'alice', label: '小愛' }]);
  });
});


// ── 🔴 整頁容器:它自己不做事, 只把 searchParams 交給 View ──────────────────────────
//  少了這一族,上面 13 格會在「頁面真的用了 View」與「頁面回一個空 div」印同一種綠 ——
//  因為它們現在**直接跑 View**,根本沒有經過那一頁。
describe('🔴 整頁容器 /orders/new 真的把事情交給 ManualOrderView', () => {
  it('render 出來的就是 ManualOrderView, 而且 raw 逐字遞下去', async () => {
    const el = (await ManualOrderNewPage({
      searchParams: Promise.resolve({ phone: '0912345678' }),
    })) as unknown as { type: unknown; props: Record<string, unknown> };
    expect(el.type).toBe(ManualOrderView);
    expect(el.props.raw).toEqual({ phone: '0912345678' });
  });

  it('🔴 負對照:它【不是】面板版(inPanel 不得為 true, 不然整頁會用面板的導頁基底)', async () => {
    const el = (await ManualOrderNewPage({ searchParams: Promise.resolve({}) })) as unknown as {
      props: Record<string, unknown>;
    };
    expect(el.props.inPanel).not.toBe(true);
  });
});
