// @vitest-environment node
//
// chargePaymentAction server action test(M-3 ②-③e、🔴 鐵則 12 成交 path)。
// 鏡像 actions.test.ts 信任邊界 + 付款層:
// - 登入 gate / 三段 safeParse / cardholder 先於建單(fail → placeOrder 零呼叫、②-③d 移交驗收)
// - 🔴 object-level 防竄(codex k2d consider):client 塞 amount/cardholder/orderId/unitPrice →
//   confirmPayment 仍只收 server 值(orderId=placeOrder 回傳、amount=findTotal 回傳、cardholder=helper 回傳)
// - findTotal null → 拒(零 charge);outcome 六態映射(含 in_flight 無 displayId、charge_failed_wait)
// - throw 全吞通用字面。
// 用真 @pcm/schemas(不 mock)驗 strip/uuid/prime 真實行為;mock use-cases/composition/cardholder。

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPlaceOrder = vi.fn();
const mockConfirmPayment = vi.fn();
const mockInitiatePayment = vi.fn();
const mockFindTotal = vi.fn();
const mockGetOrderRepo = vi.fn();
const mockGetCustomerRepo = vi.fn();
const mockGetAddressRepo = vi.fn();
const mockGetTapPayAdapter = vi.fn();
const mockGetPaymentConfirmer = vi.fn();
const mockGetChargeAttemptStore = vi.fn();
const mockBuildCardholder = vi.fn();
const mockGetUser = vi.fn();
// 3DS-6a:flag 分岔 + result_url 組裝(three-ds-flag / three-ds-urls 各有獨立單元測;此處 mock 驗分岔接線)。
const mockIsThreeDSEnabled = vi.fn();
const mockResolveThreeDSConfig = vi.fn();
const mockBuildResultUrls = vi.fn();
const mockIsHttpsUrl = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  placeOrder: (...args: unknown[]) => mockPlaceOrder(...args),
  confirmPayment: (...args: unknown[]) => mockConfirmPayment(...args),
  initiatePayment: (...args: unknown[]) => mockInitiatePayment(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getOrderRepo: () => mockGetOrderRepo(),
  getCustomerRepo: () => mockGetCustomerRepo(),
  getAddressRepo: () => mockGetAddressRepo(),
}));
vi.mock('@/lib/payment/composition', () => ({
  getTapPayAdapter: () => mockGetTapPayAdapter(),
  getPaymentConfirmer: () => mockGetPaymentConfirmer(),
  getChargeAttemptStore: () => mockGetChargeAttemptStore(),
}));
vi.mock('@/lib/payment/three-ds-flag', () => ({
  isThreeDSEnabled: () => mockIsThreeDSEnabled(),
}));
vi.mock('@/lib/payment/three-ds-urls', () => ({
  resolveThreeDSConfig: () => mockResolveThreeDSConfig(),
  buildResultUrls: (...args: unknown[]) => mockBuildResultUrls(...args),
  isHttpsUrl: (...args: unknown[]) => mockIsHttpsUrl(...args),
}));
vi.mock('@/lib/payment/cardholder', () => ({
  buildCardholder: (...args: unknown[]) => mockBuildCardholder(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: () => mockGetUser() } }),
}));
// 3DS-0b:固定 randomUUID 以斷言 cart_session_id 由 server 產(非 client 偽造);保留其餘 crypto 匯出。
vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUID: () => 'aaaaaaaa-0000-4000-8000-00000000cafe',
}));

async function getAction() {
  const m = await import('./charge-actions');
  return m.chargePaymentAction;
}

const ADDR = '00000000-0000-4000-8000-000000000001';
const VARIANT = '00000000-0000-4000-8000-000000000002';
const CARDHOLDER = { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' };
const TOTAL = { amount: 1100, currency: 'TWD' };

function validInput(over: Record<string, unknown> = {}) {
  return {
    addressId: ADDR,
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    lines: [{ variantId: VARIANT, quantity: 2 }],
    prime: 'prime_abc',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } } });
  mockGetOrderRepo.mockResolvedValue({ findTotal: mockFindTotal });
  mockGetCustomerRepo.mockResolvedValue({});
  mockGetAddressRepo.mockResolvedValue({});
  mockGetTapPayAdapter.mockReturnValue({ tag: 'tappay' });
  mockGetPaymentConfirmer.mockReturnValue({ tag: 'confirmer' });
  mockGetChargeAttemptStore.mockResolvedValue({ tag: 'attempts' });
  mockBuildCardholder.mockResolvedValue({ ok: true, cardholder: CARDHOLDER });
  mockPlaceOrder.mockResolvedValue({ orderId: 'order-server-1', displayId: 'PCM-2026-0001' });
  mockFindTotal.mockResolvedValue(TOTAL);
  mockConfirmPayment.mockResolvedValue({ kind: 'paid', idempotent: false });
  // 3DS-6a 預設 flag off(既有同步測沿用、3DS mock 不被呼);各 3DS 測顯式 mockReturnValue(true)。
  mockIsThreeDSEnabled.mockReturnValue(false);
  mockResolveThreeDSConfig.mockReturnValue({ base: 'https://pcm.example', secret: 's'.repeat(48) });
  mockBuildResultUrls.mockReturnValue({
    frontendRedirectUrl: 'https://pcm.example/checkout/callback?order=order-server-1',
    backendNotifyUrl: `https://pcm.example/api/checkout/tappay-notify/${'s'.repeat(48)}`,
  });
  mockInitiatePayment.mockResolvedValue({
    kind: 'redirect',
    redirectUrl: 'https://sandbox.tappaysdk.com/pay?token=abc',
  });
  mockIsHttpsUrl.mockReturnValue(true);
});

describe('chargePaymentAction — 信任邊界(零扣款層)', () => {
  it('未登入 → formError、零 cardholder/placeOrder/confirmPayment', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockBuildCardholder).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('addressId 非 uuid → fieldErrors.addressId、零後續', async () => {
    const action = await getAction();
    const res = await action(validInput({ addressId: 'not-uuid' }));
    expect(res).toMatchObject({ fieldErrors: { addressId: expect.any(String) } });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('lines 非法(缺 variantId)→ formError REJECT 整單', async () => {
    const action = await getAction();
    const res = await action(validInput({ lines: [{ quantity: 2 }] }));
    expect(res).toMatchObject({ formError: expect.stringContaining('購物車') });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it.each([
    ['缺 prime', undefined],
    ['空 prime', '   '],
    ['超長 prime', 'x'.repeat(513)],
  ])('%s → formError、零 cardholder/placeOrder', async (_label, prime) => {
    const action = await getAction();
    const res = await action(validInput({ prime }));
    expect(res).toMatchObject({ formError: expect.stringContaining('付款資訊') });
    expect(mockBuildCardholder).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔴 cardholder fail → placeOrder 零呼叫(組裝先於建單、②-③d 移交驗收)+ 引導文案', async () => {
    mockBuildCardholder.mockResolvedValue({ ok: false, reason: 'phone_missing' });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({ fieldErrors: { addressId: '收件地址缺少手機號碼,請補齊後再試' } });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['address_not_found', { fieldErrors: { addressId: '請重新選擇收件地址' } }],
    ['name_missing', { formError: '會員資料缺少姓名,請至會員中心補齊後再試' }],
    ['email_missing', { formError: '會員資料異常,請重新登入後再試' }],
    ['profile_not_found', { formError: '會員資料異常,請重新登入後再試' }],
  ])('cardholder fail(%s)→ 對應文案', async (reason, expected) => {
    mockBuildCardholder.mockResolvedValue({ ok: false, reason });
    const action = await getAction();
    expect(await action(validInput())).toEqual(expected);
  });

  it('findTotal null(查無/防腐)→ formError 通用、零 confirmPayment(零扣款)', async () => {
    mockFindTotal.mockResolvedValue(null);
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toMatchObject({ formError: expect.stringContaining('付款失敗') });
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it.each([
    ['placeOrder throw', () => mockPlaceOrder.mockRejectedValue(new Error('RPC RAISE 下架'))],
    ['confirmPayment(begin)throw', () => mockConfirmPayment.mockRejectedValue(new Error('簿記主軌失敗'))],
  ])('%s → formError 通用、零原文透傳', async (_label, arm) => {
    arm();
    const action = await getAction();
    const res = (await action(validInput())) as { formError?: string };
    expect(res.formError).toBe('付款失敗,請稍後再試或聯繫客服 LINE');
    expect(JSON.stringify(res)).not.toContain('RAISE');
  });
});

describe('chargePaymentAction — 🔴 server 值單一來源(零信任/防竄)', () => {
  it('happy:confirmPayment 收 server 值(orderId=建單回傳、amount=findTotal、cardholder=helper、prime=zod 後)', async () => {
    const action = await getAction();
    const res = await action(validInput({ prime: '  prime_abc  ' }));
    expect(res).toEqual({ ok: true, displayId: 'PCM-2026-0001' });
    expect(mockFindTotal).toHaveBeenCalledWith('order-server-1');
    expect(mockConfirmPayment).toHaveBeenCalledWith(
      { tappay: { tag: 'tappay' }, confirmer: { tag: 'confirmer' }, attempts: { tag: 'attempts' } },
      { prime: 'prime_abc', orderId: 'order-server-1', amount: TOTAL, cardholder: CARDHOLDER },
    );
  });

  it('🔴 object-level 防竄(k2d):client 塞 amount/cardholder/orderId/unitPrice → 全被忽略、server 值不變', async () => {
    const action = await getAction();
    await action(
      validInput({
        amount: { amount: 1, currency: 'TWD' }, // 竄改金額 → 不讀
        cardholder: { name: '駭', email: 'x@x', phoneNumber: '000' }, // 竄改持卡人 → 不讀
        orderId: 'order-fake-999', // 竄改單號 → 不讀
        cartSessionId: 'CLIENT-FORGED-cart-uuid', // 竄改 cart key → server 覆蓋、不讀
        lines: [{ variantId: VARIANT, quantity: 2, unitPrice: 1, tier: 'store' }], // zod strip
      }),
    );
    const [, useCaseInput] = mockConfirmPayment.mock.calls[0]!;
    expect(useCaseInput).toEqual({
      prime: 'prime_abc',
      orderId: 'order-server-1', // = placeOrder 回傳、非 client
      amount: TOTAL, // = findTotal、非 client
      cardholder: CARDHOLDER, // = helper、非 client
    });
    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.lines).toEqual([{ variantId: VARIANT, quantity: 2 }]); // strip 竄改鍵
    // 🔴 3DS-0b:cart_session_id 由 server 產(randomUUID mock 值)、client 偽造不採用。
    expect(placeOrderInput.cartSessionId).toBe('aaaaaaaa-0000-4000-8000-00000000cafe');
    expect(placeOrderInput.cartSessionId).not.toBe('CLIENT-FORGED-cart-uuid');
  });
});

describe('chargePaymentAction — outcome 六態映射(plan v6 §7)', () => {
  it('charge_failed(recordPersisted:true)→ payment=charge_failed + 可重試文案 + displayId', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'charge_failed', recordPersisted: true });
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'charge_failed',
      displayId: 'PCM-2026-0001',
      message: '付款未成功,請確認卡片資訊後重試',
    });
  });

  it('🔴 charge_failed(recordPersisted:false)→ charge_failed_wait(誠實未扣款、不誘導立即重試)', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'charge_failed', recordPersisted: false });
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'charge_failed_wait',
      displayId: 'PCM-2026-0001',
      message: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
    });
  });

  it.each([
    ['charge_unknown', { kind: 'charge_unknown', orderId: 'order-server-1' }],
    ['orphan/amount_mismatch', { kind: 'orphan', reason: 'amount_mismatch', transactionId: 'D1', orderId: 'o' }],
    ['orphan/confirm_unreachable', { kind: 'orphan', reason: 'confirm_unreachable', transactionId: 'D1', orderId: 'o' }],
    ['locked/order_locked', { kind: 'locked', reason: 'order_locked' }],
    ['locked/not_unpaid', { kind: 'locked', reason: 'not_unpaid' }],
  ])('%s → processing(勿重複付款 + displayId)', async (_label, outcome) => {
    mockConfirmPayment.mockResolvedValue(outcome);
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0001',
      message: '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認',
    });
  });

  it('🔴 settlement_required(3DS-0b dedup duplicate/needs_settle)→ processing UI + 獨立「狀態確認中」文案(非「付款失敗」)+ displayId', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required' });
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0001',
      message: '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認',
    });
  });

  it('🔴 locked/user_in_flight → in_flight、**無 displayId 屬性**(round3 C:新單零扣款不給單號)', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'locked', reason: 'user_in_flight' });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({
      ok: false,
      payment: 'in_flight',
      message: '您有一筆付款正在處理中,請稍候再試',
    });
    expect(res).not.toHaveProperty('displayId');
  });

  it('paid(idempotent:true 重放)→ 同樣 ok:true(成功真相 = confirm 成功)', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'paid', idempotent: true });
    const action = await getAction();
    expect(await action(validInput())).toEqual({ ok: true, displayId: 'PCM-2026-0001' });
  });
});

describe('chargePaymentAction — 3DS-6a flag on(initiatePayment 分岔、plan §2.3)', () => {
  const SECRET = 's'.repeat(48);
  const FRONTEND = 'https://pcm.example/checkout/callback?order=order-server-1';
  const BACKEND = `https://pcm.example/api/checkout/tappay-notify/${SECRET}`;
  const MSG_SETTLE = '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認';
  const MSG_PROCESSING = '付款已收或處理中,請勿重複付款,客服 LINE 將協助確認';

  it('flag off(預設)→ 走 confirmPayment、initiatePayment/resolveThreeDSConfig 零呼叫(回歸)', async () => {
    const action = await getAction();
    await action(validInput());
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockResolveThreeDSConfig).not.toHaveBeenCalled();
  });

  it('🔴 flag on + redirect(合法 https)→ { redirect:true, redirectUrl };initiatePayment 收 server 值、deps 無 confirmer、零 confirmPayment', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    const action = await getAction();
    // client 竄改 orderId/amount → 不採;prime zod trim。
    const res = await action(
      validInput({ prime: '  prime_abc  ', orderId: 'order-fake-999', amount: { amount: 1, currency: 'TWD' } }),
    );
    expect(res).toEqual({ redirect: true, redirectUrl: 'https://sandbox.tappaysdk.com/pay?token=abc' });
    // preflight 在建單前、URL 用 server orderId 組(非 client)。
    expect(mockResolveThreeDSConfig).toHaveBeenCalledTimes(1);
    expect(mockBuildResultUrls).toHaveBeenCalledWith({ base: 'https://pcm.example', secret: SECRET }, 'order-server-1');
    expect(mockInitiatePayment).toHaveBeenCalledWith(
      { tappay: { tag: 'tappay' }, attempts: { tag: 'attempts' } }, // 🔴 無 confirmer
      {
        prime: 'prime_abc',
        orderId: 'order-server-1', // = placeOrder 回傳、非 client
        amount: TOTAL, // = findTotal、非 client
        cardholder: CARDHOLDER, // = helper、非 client
        frontendRedirectUrl: FRONTEND,
        backendNotifyUrl: BACKEND,
      },
    );
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('🔴 flag on + redirect 但 payment_url 非 https(壞值)→ processing 終態(非 generic、防誤導重刷;codex k1 #2)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockInitiatePayment.mockResolvedValue({ kind: 'redirect', redirectUrl: 'http://evil.example/pay' });
    mockIsHttpsUrl.mockReturnValue(false);
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0001',
      message: MSG_SETTLE,
    });
  });

  it.each([
    ['charge_unknown', { kind: 'charge_unknown', orderId: 'order-server-1' }, MSG_SETTLE],
    ['settlement_required', { kind: 'settlement_required' }, MSG_SETTLE],
    ['locked/order_locked', { kind: 'locked', reason: 'order_locked' }, MSG_PROCESSING],
    ['locked/not_unpaid', { kind: 'locked', reason: 'not_unpaid' }, MSG_PROCESSING],
  ])('flag on + %s → processing + displayId', async (_label, outcome, message) => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockInitiatePayment.mockResolvedValue(outcome);
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'processing',
      displayId: 'PCM-2026-0001',
      message,
    });
  });

  it('🔴 flag on + init_failed(bank_txn 未 durable)→ charge_failed_wait(誠實未扣款、留車稍候)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockInitiatePayment.mockResolvedValue({ kind: 'init_failed' });
    const action = await getAction();
    expect(await action(validInput())).toEqual({
      ok: false,
      payment: 'charge_failed_wait',
      displayId: 'PCM-2026-0001',
      message: '付款未成功、未扣款;系統忙碌中,請約 10 分鐘後再試',
    });
  });

  it('🔴 flag on + locked/user_in_flight → in_flight、無 displayId(此請求零扣款)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockInitiatePayment.mockResolvedValue({ kind: 'locked', reason: 'user_in_flight' });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({ ok: false, payment: 'in_flight', message: '您有一筆付款正在處理中,請稍候再試' });
    expect(res).not.toHaveProperty('displayId');
  });

  it('🔴 flag on + resolveThreeDSConfig throw(base/secret 缺)→ generic + placeOrder/initiatePayment 零呼叫(零扣款 + 零垃圾單;codex k1 #3)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockResolveThreeDSConfig.mockImplementation(() => {
      throw new Error('NEXT_PUBLIC_SITE_URL 未設或非合法 https origin');
    });
    const action = await getAction();
    const res = (await action(validInput())) as { formError?: string };
    expect(res.formError).toBe('付款失敗,請稍後再試或聯繫客服 LINE');
    expect(mockPlaceOrder).not.toHaveBeenCalled(); // preflight 在建單前
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(JSON.stringify(res)).not.toContain('NEXT_PUBLIC_SITE_URL'); // 不洩 env 名
  });
});
