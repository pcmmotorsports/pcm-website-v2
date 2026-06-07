// @vitest-environment node
//
// placeOrderAction server action test(M-3-S2-b2-e3b、🔴 鐵則 12 建單 path)。
// 鏡像 address/actions.test.ts 信任邊界覆蓋:
// 1. 未登入 → formError「請重新登入」+ 不呼叫 placeOrder(信任邊界①純登入 gate)
// 2. addressId 非 uuid → fieldErrors.addressId + 不呼叫 placeOrder(②a)
// 3. shippingMethod 非法 → fieldErrors.shippingMethod + 不呼叫 placeOrder(②a)
// 4. 巢狀 invoice 錯(company taxId 非 8 碼)→ fieldErrors.invoice.taxId(②a、含巢狀)
// 5. 🔴 lines 缺 variantId(有商品卻無規格)→ formError REJECT 整單 + 不呼叫 placeOrder(②b、MUST2 寫入路徑拒整單非略過)
// 6. lines 空 → formError + 不呼叫 placeOrder(②b)
// 7. malformed input(非 object)→ formError fallback、不無聲失敗
// 8. 🔴 零信任 + 零價:成功 → placeOrder 收 (repo, input) **兩參數**(無 user.id)、input 無 userId/tier/price、
//    lines 竄改的 unitPrice/tier 被 zod strip → 只剩 {variantId, quantity}(信任邊界③ + 鐵則12)
// 9. placeOrder 拋(RPC RAISE)→ formError 通用「下單失敗…」+ 不洩原始 error
// 10. 成功 → { ok: true, displayId }
//
// 用真 @pcm/schemas(不 mock)驗 CheckoutInput / PlaceOrderLinesInput 真實 strip / superRefine / uuid 行為。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlaceOrder = vi.fn();
const mockGetOrderRepo = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  placeOrder: (...args: unknown[]) => mockPlaceOrder(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getOrderRepo: () => mockGetOrderRepo(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
}));

async function getAction() {
  const m = await import('./actions');
  return m.placeOrderAction;
}

// 合法 RFC UUID(version 4 / variant 8;對齊 packages/schemas checkout.test、z.uuid() 接受)。
const ADDRESS_ID = '00000000-0000-4000-8000-000000000000';
const VARIANT_ID = '00000000-0000-4000-8000-000000000001';

// 合法 payload(personal 發票 + 單一變體線);invoice 全欄由 schema default 補齊。
function validInput(over: Record<string, unknown> = {}) {
  return {
    addressId: ADDRESS_ID,
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    lines: [{ variantId: VARIANT_ID, quantity: 2 }],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerSupabaseClient.mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  });
  mockGetOrderRepo.mockResolvedValue({ placeOrder: vi.fn() });
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('placeOrderAction(M-3-S2-b2-e3b server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 placeOrder', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput());
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('addressId 非 uuid → fieldErrors.addressId + 不呼叫 placeOrder', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput({ addressId: 'not-a-uuid' }));
    expect(res.fieldErrors?.addressId).toBeTruthy();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('shippingMethod 非法 → fieldErrors.shippingMethod + 不呼叫 placeOrder', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput({ shippingMethod: 'cvs' }));
    expect(res.fieldErrors?.shippingMethod).toBeTruthy();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('巢狀 invoice 錯(company taxId 非 8 碼)→ fieldErrors.invoice.taxId', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(
      validInput({ invoice: { type: 'company', title: '賓士機車', taxId: '123' } }),
    );
    expect(res.fieldErrors?.invoice?.taxId).toBeTruthy();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔴 lines 缺 variantId → formError REJECT 整單 + 不呼叫 placeOrder(MUST2 寫入路徑拒整單)', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput({ lines: [{ quantity: 1 }] }));
    expect(res.formError).toBe('購物車有商品缺少規格資訊,請返回購物車重新確認');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('lines 空 → formError + 不呼叫 placeOrder', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput({ lines: [] }));
    expect(res.formError).toBeTruthy();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  // 🔴 table-driven fail-closed 邊界(PlaceOrderLinesInput zod;codex 關卡2 round1 WARN 補測試證據)。
  // 任一非法 line → REJECT 整單回 formError、絕不呼叫 placeOrder(壞行不略過續建單)。
  it.each([
    ['非 string variantId(number)', [{ variantId: 123, quantity: 1 }]],
    ['非 string variantId(object)', [{ variantId: {}, quantity: 1 }]],
    ['非 uuid variantId 字串', [{ variantId: 'not-a-uuid', quantity: 1 }]],
    ['空字串 variantId', [{ variantId: '', quantity: 1 }]],
    ['qty 0', [{ variantId: VARIANT_ID, quantity: 0 }]],
    ['qty 負', [{ variantId: VARIANT_ID, quantity: -1 }]],
    ['qty 100(>99 MAX_QTY)', [{ variantId: VARIANT_ID, quantity: 100 }]],
    ['qty 1.5(非整數)', [{ variantId: VARIANT_ID, quantity: 1.5 }]],
    ['lines 201(>200 上限)', Array.from({ length: 201 }, () => ({ variantId: VARIANT_ID, quantity: 1 }))],
  ])('🔴 fail-closed:%s → REJECT 整單 formError + 不呼叫 placeOrder', async (_label, lines) => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput({ lines }));
    expect(res.formError).toBeTruthy();
    expect(res.ok).toBeUndefined();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('malformed input(非 object)→ fieldErrors / formError fallback、不無聲失敗 + 不呼叫 placeOrder', async () => {
    const placeOrderAction = await getAction();
    const res = await placeOrderAction('not-an-object' as unknown);
    // 非 object → raw={} → CheckoutInput 各欄缺值 → fieldErrors.addressId(或 path-less → formError fallback);
    // 任一都不無聲失敗、且不呼叫 placeOrder(對齊 address actions malformed 彈性斷言)。
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      expect(res.fieldErrors.addressId).toBeTruthy();
    } else {
      expect(res.formError).toBeTruthy();
    }
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔴 零信任 + 零價:成功時 placeOrder 收 (repo, input) 兩參數、input 無 userId/tier/price、線竄改 price/tier 被 strip', async () => {
    mockPlaceOrder.mockResolvedValue({ orderId: 'o-1', displayId: 'PCM-2026-0007' });
    const placeOrderAction = await getAction();
    await placeOrderAction(
      validInput({
        // 攻擊面:client 偽造 userId/tier + 線塞 price/tier → 必被收窄 / strip。
        userId: 'attacker-uid',
        tier: 'store',
        lines: [{ variantId: VARIANT_ID, quantity: 2, unitPrice: 1, tier: 'store' }],
      }),
    );
    expect(mockPlaceOrder).toHaveBeenCalledOnce();
    // 🔴 只收 (repo, input) 兩參數 —— getUser 是純登入 gate、user.id 不傳進 use-case(身分 RPC auth.uid() 重查)。
    expect(mockPlaceOrder.mock.calls[0]!.length).toBe(2);
    const input = mockPlaceOrder.mock.calls[0]![1] as {
      lines: Array<Record<string, unknown>>;
      addressId: string;
      shippingMethod: string;
    };
    expect(input).not.toHaveProperty('userId');
    expect(input).not.toHaveProperty('tier');
    expect(input.addressId).toBe(ADDRESS_ID);
    expect(input.shippingMethod).toBe('home');
    // 線只剩 {variantId, quantity} —— 竄改的 unitPrice/tier 被 PlaceOrderLinesInput zod strip。
    expect(input.lines).toEqual([{ variantId: VARIANT_ID, quantity: 2 }]);
    expect(input.lines[0]).not.toHaveProperty('unitPrice');
    expect(input.lines[0]).not.toHaveProperty('tier');
  });

  it('placeOrder 拋(RPC RAISE)→ formError 通用 + 不洩原始 error', async () => {
    mockPlaceOrder.mockRejectedValue(new Error('create_order: 商品已下架(variant_id=22222222...)'));
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput());
    expect(res.formError).toBe('下單失敗,請稍後再試或聯繫客服 LINE');
    expect(res.formError).not.toContain('下架');
    expect(res.formError).not.toContain('variant_id');
    expect(res.ok).toBeUndefined();
  });

  it('成功 → { ok: true, displayId }', async () => {
    mockPlaceOrder.mockResolvedValue({ orderId: 'o-1', displayId: 'PCM-2026-0007' });
    const placeOrderAction = await getAction();
    const res = await placeOrderAction(validInput());
    expect(res).toEqual({ ok: true, displayId: 'PCM-2026-0007' });
  });
});
