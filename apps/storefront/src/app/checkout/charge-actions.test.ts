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
import { CURRENT_TERMS_VERSION } from '@/lib/legal/terms-version';

const mockPlaceOrder = vi.fn();
const mockHeadersGet = vi.fn(); // 🔴 #241:next/headers headers().get(name) mock(IP/UA 抓)
const mockConfirmPayment = vi.fn();
const mockInitiatePayment = vi.fn();
const mockSettleCharge = vi.fn(); // 3DS-7 7c-2:settlement_required needs_settle 即時裁決
const mockPreflightReleaseSibling = vi.fn(); // 🔴 R3:立即重刷 preflight(§2.3、placeOrder 前)
const mockFindTotal = vi.fn();
const mockGetOrderRepo = vi.fn();
const mockGetCustomerRepo = vi.fn();
const mockGetAddressRepo = vi.fn();
const mockGetTapPayAdapter = vi.fn();
const mockGetPaymentConfirmer = vi.fn();
const mockGetChargeAttemptStore = vi.fn();
const mockGetSettleChargeDeps = vi.fn(); // 3DS-7 7c-2:cookieless settleCharge deps
const mockGetPreflightReleaseSiblingDeps = vi.fn(); // 🔴 R3:preflight deps 工廠
const mockClaimPollSettle = vi.fn(); // 🔴 L4b:撞窗即時對帳的 per-order 節流
// 🔴 factory 本身也要可控:寫死成永遠成功的 inline mock,會讓「把 factory 移出 try」這個突變無人擋
//    (codex 關卡2 R1)——正式環境缺設定時 factory 會 throw,那條路徑必須也是 fail-closed。
const mockGetPollSettleThrottle = vi.fn();
const mockBuildCardholder = vi.fn();
const mockGetUser = vi.fn();
// 3DS-6a:flag 分岔 + result_url 組裝(three-ds-flag / three-ds-urls 各有獨立單元測;此處 mock 驗分岔接線)。
const mockIsThreeDSEnabled = vi.fn();
const mockIsCheckoutNotificationEmailEnabled = vi.fn();
const mockResolveThreeDSConfig = vi.fn();
const mockBuildResultUrls = vi.fn();
const mockIsHttpsUrl = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  placeOrder: (...args: unknown[]) => mockPlaceOrder(...args),
  confirmPayment: (...args: unknown[]) => mockConfirmPayment(...args),
  initiatePayment: (...args: unknown[]) => mockInitiatePayment(...args),
  settleCharge: (...args: unknown[]) => mockSettleCharge(...args),
  preflightReleaseSibling: (...args: unknown[]) => mockPreflightReleaseSibling(...args),
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
  getSettleChargeDeps: () => mockGetSettleChargeDeps(),
  getPreflightReleaseSiblingDeps: () => mockGetPreflightReleaseSiblingDeps(),
  getPollSettleThrottle: () => mockGetPollSettleThrottle(),
}));
vi.mock('@/lib/payment/three-ds-flag', () => ({
  isThreeDSEnabled: () => mockIsThreeDSEnabled(),
}));
vi.mock('@/lib/email/notification-email-gate', () => ({
  isCheckoutNotificationEmailEnabled: () => mockIsCheckoutNotificationEmailEnabled(),
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
// 🔴 #241:headers() 取 best-effort IP/UA(Next 16 async);預設 get→null(無 IP/UA),正向測顯式 override。
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => mockHeadersGet(n) }),
}));
// 🔴 3DS-7:cart_session_id 改由 client CartContext 穩定 key 送來(server 驗 uuid/非空、信任),不再 server
//   randomUUID 產 → 移除舊 node:crypto randomUUID mock(charge-actions 已不 import randomUUID)。

async function getAction() {
  const m = await import('./charge-actions');
  return m.chargePaymentAction;
}

const ADDR = '00000000-0000-4000-8000-000000000001';
const VARIANT = '00000000-0000-4000-8000-000000000002';
const CART_SESSION = '00000000-0000-4000-8000-0000000000c0'; // 3DS-7:預設合法 client cart key(7b 信任 + 驗 uuid)
const CARDHOLDER = { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' };
const TOTAL = { amount: 1100, currency: 'TWD' };
// 🔴 3DS-7 7c-2:settlement_required.dedup(begin D2/D4 上帶;existing_* 全 server 權威)。
const DEDUP_DUPLICATE = {
  reason: 'duplicate',
  existingDisplayId: 'PCM-2026-DUP',
  existingPaid: true,
} as const;
const DEDUP_NEEDS_SETTLE = {
  reason: 'needs_settle',
  existingOrderId: 'order-existing-1',
  existingDisplayId: 'PCM-2026-NS',
  existingRecTradeId: 'D-REC-EXIST',
} as const;

function validInput(over: Record<string, unknown> = {}) {
  return {
    addressId: ADDR,
    shippingMethod: 'home',
    invoice: { type: 'personal' },
    lines: [{ variantId: VARIANT, quantity: 2 }],
    prime: 'prime_abc',
    cartSessionId: CART_SESSION, // 3DS-7:client 送穩定 key(7b 後 server 必驗、缺/非法 fail-closed)
    agreed: true, // 🔴 #241:同意條款(②e server 驗、缺/false → formError 零副作用);負測顯式 override
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
  mockGetSettleChargeDeps.mockReturnValue({ tag: 'settle-deps' });
  mockGetPreflightReleaseSiblingDeps.mockResolvedValue({ tag: 'preflight-deps' });
  // 🔴 R3 預設 proceed(既有 3DS flag-on 測沿用 → fall-through 到 placeOrder + initiatePayment)。
  mockPreflightReleaseSibling.mockResolvedValue({ kind: 'proceed' });
  mockClaimPollSettle.mockResolvedValue(true); // 🔴 L4b 預設節流放行;不放行的那格顯式 override
  mockGetPollSettleThrottle.mockReturnValue({ claimPollSettle: (...a: unknown[]) => mockClaimPollSettle(...a) });
  mockSettleCharge.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-2026-NS' });
  mockBuildCardholder.mockResolvedValue({ ok: true, cardholder: CARDHOLDER });
  mockPlaceOrder.mockResolvedValue({ orderId: 'order-server-1', displayId: 'PCM-2026-0001' });
  mockFindTotal.mockResolvedValue(TOTAL);
  mockConfirmPayment.mockResolvedValue({ kind: 'paid', idempotent: false });
  // 3DS-6a 預設 flag off(既有同步測沿用、3DS mock 不被呼);各 3DS 測顯式 mockReturnValue(true)。
  mockIsThreeDSEnabled.mockReturnValue(false);
  mockIsCheckoutNotificationEmailEnabled.mockReturnValue(false);
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
  mockHeadersGet.mockReturnValue(null); // 🔴 #241 預設無 IP/UA(best-effort);正向測顯式 override
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

  it('B-3 flag off：不要求 Email，client 偷塞也不進 PlaceOrderInput，維持 8-param marker absent', async () => {
    const action = await getAction();
    await action(validInput({ notificationEmail: 'attacker@example.com' }));

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput).not.toHaveProperty('notificationEmail');
  });

  it.each([
    ['缺值', undefined, '請填寫 Email'],
    ['格式錯誤', 'invalid-email', 'Email 格式不正確'],
    ['LINE 合成域', 'line_test@line.pcmmotorsports.local', 'Email 格式不正確'],
  ])('B-3 flag on：%s → 欄位錯誤且零建單', async (_label, notificationEmail, message) => {
    mockIsCheckoutNotificationEmailEnabled.mockReturnValue(true);
    const action = await getAction();
    const res = await action(validInput({ notificationEmail }));

    expect(res).toEqual({ fieldErrors: { notificationEmail: message } });
    expect(mockBuildCardholder).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('B-3 flag on：合法 padded Email 通過 server canonical 驗證，但只送 9th null，真值留 B-4', async () => {
    mockIsCheckoutNotificationEmailEnabled.mockReturnValue(true);
    const action = await getAction();
    await action(validInput({ notificationEmail: ' Member@EXAMPLE.COM ' }));

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.notificationEmail).toBeNull();
    expect(JSON.stringify(placeOrderInput)).not.toContain('Member@example.com');
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
    // M-4b:引導去補**地址的 Email**,不是「重新登入」——會走到這裡的是 LINE 登入 + 舊地址,
    // 他的登入完全正常。
    // ⚠️ 顯示位置(codex 關卡2 糾正、已實查 useChargePayment.tsx:231-241):client 會把
    // fieldErrors **壓成單一訊息**顯示在付款區錯誤條,**不會**變成地址欄旁的紅字 ⇒
    // 文案本身必須把「要去哪改」講完整,不能靠它出現在地址欄旁邊。
    [
      'email_unusable',
      {
        fieldErrors: {
          addressId: '收件地址的 Email 無法用於付款驗證(需 40 字元內的一般信箱),請編輯地址修改後再試',
        },
      },
    ],
    ['profile_not_found', { formError: '會員資料異常,請重新登入後再試' }],
  ])('cardholder fail(%s)→ 對應文案', async (reason, expected) => {
    mockBuildCardholder.mockResolvedValue({ ok: false, reason });
    const action = await getAction();
    expect(await action(validInput())).toEqual(expected);
  });

  // 🔴 M-4b:plan 宣稱「擋下時零垃圾單、零 TapPay 呼叫」——那是選在 cardholder 這一層擋的**唯一理由**,
  //    但上面那組 it.each 只驗回傳文案,對「擋下了但已經先建了單」全盲(codex 關卡2 round2 must-fix)。
  //    這條把三條下游路徑各釘一次;拿掉 buildCardholder 之前的早退,只有它會紅。
  it('🔴 email_unusable → 零 placeOrder、零 initiatePayment、零 confirmPayment(零垃圾單零扣款)', async () => {
    mockBuildCardholder.mockResolvedValue({ ok: false, reason: 'email_unusable' });
    const action = await getAction();
    await action(validInput());
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
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

  it('🔴 object-level 防竄(k2d):amount/cardholder/orderId/unitPrice 全被忽略、server 值不變;cartSessionId(合法 uuid)被採用(3DS-7)', async () => {
    const CLIENT_CART = '11111111-1111-4111-8111-111111111111'; // 合法 uuid 的 client cart key(≠ 預設、證採用)
    const action = await getAction();
    await action(
      validInput({
        amount: { amount: 1, currency: 'TWD' }, // 竄改金額 → 不讀
        cardholder: { name: '駭', email: 'x@x', phoneNumber: '000' }, // 竄改持卡人 → 不讀
        orderId: 'order-fake-999', // 竄改單號 → 不讀
        cartSessionId: CLIENT_CART, // 🔴 3DS-7:合法 client cart key → **採用**(信任、非價/tier/身分去重子)
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
    // 🔴 3DS-7(取代 3DS-0b option A server 產):合法 client cart_session_id 被**採用**(非 server 覆蓋)。
    expect(placeOrderInput.cartSessionId).toBe(CLIENT_CART);
  });

  it('V-3a:line 合法 vehicle → 原樣進 placeOrder input;非法 vehicle → 丟欄不擋單(schema catch=RPC 同構)', async () => {
    const action = await getAction();
    await action(
      validInput({
        lines: [
          { variantId: VARIANT, quantity: 2, vehicle: { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' } },
        ],
      }),
    );
    const [, withVeh] = mockPlaceOrder.mock.calls[0]!;
    expect(withVeh.lines).toEqual([
      { variantId: VARIANT, quantity: 2, vehicle: { kind: 'dict', brand: 'YAMAHA', model: 'MT-09', year: 2021, source: 'search' } },
    ]);

    mockPlaceOrder.mockClear();
    await action(
      validInput({
        lines: [{ variantId: VARIANT, quantity: 2, vehicle: { kind: 'weird', hack: 1 } }], // 非法 → 丟欄
      }),
    );
    const [, dropped] = mockPlaceOrder.mock.calls[0]!;
    expect(dropped.lines).toEqual([{ variantId: VARIANT, quantity: 2 }]); // 單照建、vehicle 不進
  });

  it('🔴 3DS-7:缺 cart_session_id → formError、零 placeOrder/charge(fail-closed)', async () => {
    const action = await getAction();
    const res = await action(validInput({ cartSessionId: undefined }));
    expect(res).toHaveProperty('formError');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('🔴 3DS-7:非法 cart_session_id(非 uuid)→ formError、零 placeOrder/charge(fail-closed)', async () => {
    const action = await getAction();
    const res = await action(validInput({ cartSessionId: 'CLIENT-FORGED-cart-uuid' }));
    expect(res).toHaveProperty('formError');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
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

  // ══ 🔴 M-4b L4b:撞窗即時對帳(母 plan §2、plan v3 §4/§5)══
  //
  // 客人跨裝置/換購物車回來重刷會撞 per-user 閘。撞窗當下先對那張在途單對帳一次,
  // **只有裁出明確 failed 才放行重試恰一次**;其餘一切照舊擋(fail-closed)。

  const IN_FLIGHT = { kind: 'locked', reason: 'user_in_flight', inFlight: { orderId: 'order-in-flight-9' } };
  const IN_FLIGHT_MSG = { ok: false, payment: 'in_flight', message: '您有一筆付款正在處理中,請稍候再試' };

  it.each([
    ['failed', { kind: 'failed' }, true],
    ['paid', { kind: 'paid', idempotent: false, displayId: 'PCM-2026-OTHER' }, false],
    ['no_attempt', { kind: 'no_attempt' }, false],
    ['pending/auth_or_pending', { kind: 'pending', reason: 'auth_or_pending' }, false],
    ['pending/record_unverified', { kind: 'pending', reason: 'record_unverified' }, false],
    ['pending/record_not_found', { kind: 'pending', reason: 'record_not_found' }, false],
    ['pending/record_unreachable', { kind: 'pending', reason: 'record_unreachable' }, false],
    ['pending/released_failure_observed', { kind: 'pending', reason: 'released_failure_observed' }, false],
  ])(
    '🔴 settle=%s → 只有 failed 放行重試(其餘照舊擋)',
    async (_label, settled, shouldRetry) => {
      // 🔴 八格窮舉 kind × pending 的**全部 5 個 reason**:只測一個 pending reason 的話,
      //    「讓另一個 reason 也放行」這個突變會全綠(codex 關卡1 R1 點名)。
      mockSettleCharge.mockResolvedValue(settled);
      // 🔴 先 reset 再排佇列:mockResolvedValueOnce 的佇列**不會**被 vi.clearAllMocks() 清掉,
      //    而不放行的格子只消費 1 顆 ⇒ 剩下那顆會漏進下一個測試(實測連既有兩格一起打紅)。
      mockConfirmPayment.mockReset();
      mockConfirmPayment.mockResolvedValueOnce(IN_FLIGHT).mockResolvedValueOnce({ kind: 'paid', idempotent: false });
      const action = await getAction();
      const res = await action(validInput());
      expect(mockConfirmPayment).toHaveBeenCalledTimes(shouldRetry ? 2 : 1);
      expect(res).toEqual(shouldRetry ? { ok: true, displayId: 'PCM-2026-0001' } : IN_FLIGHT_MSG);
    },
  );

  it('🔴 settle 打的是**那張在途單**、且不帶 recTradeIdHint', async () => {
    // 打錯單 = 對別人的單做裁決。這一格釘的是「識別碼真的被用上」,不是「有呼叫」。
    mockSettleCharge.mockResolvedValue({ kind: 'failed' });
    mockConfirmPayment.mockReset();
    mockConfirmPayment.mockResolvedValueOnce(IN_FLIGHT).mockResolvedValueOnce({ kind: 'paid', idempotent: false });
    const action = await getAction();
    await action(validInput());
    expect(mockSettleCharge).toHaveBeenCalledTimes(1);
    expect(mockSettleCharge).toHaveBeenCalledWith({ tag: 'settle-deps' }, { orderId: 'order-in-flight-9' });
    expect(mockClaimPollSettle).toHaveBeenCalledWith('order-in-flight-9', 10);
  });

  it('🔴 節流不放行 → **零** settleCharge 呼叫、照舊擋', async () => {
    // 斷言數的是 settleCharge 的**呼叫次數**,不是回傳值 —— 兩者回傳一樣時,數回傳值等於量錯東西。
    mockClaimPollSettle.mockResolvedValue(false);
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    const res = await action(validInput());
    expect(mockSettleCharge).not.toHaveBeenCalled();
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
    expect(res).toEqual(IN_FLIGHT_MSG);
  });

  it('🔴 3a 重試後仍撞窗 → begin 恰 2 次、settle 恰 1 次、**不得有第三次**', async () => {
    // 🔴 用 === 不用 <=:`<=2` 會被「完全沒重試」滿足 ⇒ 那組斷言證不了「有重試」(codex 關卡1 R2)。
    mockSettleCharge.mockResolvedValue({ kind: 'failed' });
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT); // 兩次都撞窗
    const action = await getAction();
    const res = await action(validInput());
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1); // 🔴 重試不得重跑建單(否則多一張孤兒單)
    expect(mockConfirmPayment).toHaveBeenCalledTimes(2);
    expect(mockSettleCharge).toHaveBeenCalledTimes(1);
    expect(res).toEqual(IN_FLIGHT_MSG);
  });

  it('🔴 3b 重試取得鎖 → 第二次參數與第一次**逐字相同**(同 prime / orderId / total / cardholder)', async () => {
    mockSettleCharge.mockResolvedValue({ kind: 'failed' });
    mockConfirmPayment.mockReset();
    mockConfirmPayment.mockResolvedValueOnce(IN_FLIGHT).mockResolvedValueOnce({ kind: 'paid', idempotent: false });
    const action = await getAction();
    const res = await action(validInput());
    expect(mockConfirmPayment).toHaveBeenCalledTimes(2);
    const [firstDeps, firstInput] = mockConfirmPayment.mock.calls[0]!;
    const [secondDeps, secondInput] = mockConfirmPayment.mock.calls[1]!;
    expect(secondInput).toEqual(firstInput); // prime 未消耗(begin 沒過 ⇒ charge 從未跑)
    expect(secondDeps).toEqual(firstDeps);
    expect(secondInput).toMatchObject({ orderId: 'order-server-1', amount: TOTAL });
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true, displayId: 'PCM-2026-0001' });
  });

  it('🔴 settleCharge throw → 照舊擋(in_flight),**不得**落外層 generic catch 變 formError', async () => {
    // 落到 formError 的話 client 會釋放按鈕允許重試 = 潛在雙扣。
    mockSettleCharge.mockRejectedValue(new Error('settle boom'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG);
    expect(res).not.toHaveProperty('formError');
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  });

  it('🔴 節流 RPC throw → 同樣照舊擋、零 settleCharge', async () => {
    mockClaimPollSettle.mockRejectedValue(new Error('throttle boom'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    expect(await action(validInput())).toEqual(IN_FLIGHT_MSG);
    expect(mockSettleCharge).not.toHaveBeenCalled();
  });

  it('🔴 節流 factory throw(正式環境缺設定)→ 照舊擋、零 settle、run 恰一次', async () => {
    // factory 若被移出 try,這裡會落外層 generic catch → formError → client 釋鎖 → 潛在雙扣。
    mockGetPollSettleThrottle.mockImplementation(() => {
      throw new Error('throttle factory boom');
    });
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG);
    expect(res).not.toHaveProperty('formError');
    expect(mockSettleCharge).not.toHaveBeenCalled();
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  });

  it('🔴 settle deps factory throw → 照舊擋、run 恰一次', async () => {
    mockGetSettleChargeDeps.mockImplementation(() => {
      throw new Error('settle deps factory boom');
    });
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG);
    expect(res).not.toHaveProperty('formError');
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  });

  it('🔴 6b 版本錯位(migration 未 apply):locked 無 inFlight → 零節流、零 settle、回今天逐字相同的結果', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'locked', reason: 'user_in_flight' });
    const action = await getAction();
    const res = await action(validInput());
    expect(mockClaimPollSettle).not.toHaveBeenCalled();
    expect(mockSettleCharge).not.toHaveBeenCalled();
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
    expect(res).toEqual(IN_FLIGHT_MSG);
  });

  it('🔴 零洩漏三發:exact keys + message 恆等常數 + sentinel 深掃', async () => {
    // (a) keys 集合固定 (b) message **恆等於**常數本身 (c) 整個回傳物件遞迴查無在途單 id。
    // 🔴 (b) 是關鍵:只有 (a)+(c) 時,`message: \`${MSG.inFlight} ${orderId.slice(0,8)}\`` 這個突變
    //    keys 沒變、完整值也找不到 —— 但單號前 8 碼已經到瀏覽器了(codex 關卡1 R2 給的破口)。
    mockSettleCharge.mockResolvedValue({ kind: 'pending', reason: 'auth_or_pending' });
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    const action = await getAction();
    const res = await action(validInput());
    expect(Object.keys(res as object).sort()).toEqual(['message', 'ok', 'payment']);
    expect((res as { message: string }).message).toBe('您有一筆付款正在處理中,請稍候再試');
    const dumped = JSON.stringify(res);
    expect(dumped).not.toContain('order-in-flight-9');
    expect(dumped).not.toContain('order-in-flight');
    expect(dumped).not.toContain('order-server-1');
    expect(dumped).not.toContain('PCM-2026-0001');
  });

  it('🔴 3DS 路徑同款:initiate 撞窗 → settle failed → 重試恰一次', async () => {
    // 兩條路徑共用同一段程式碼,但「共用」要有自己的證據,否則哪天有人只改一邊不會有人喊。
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockSettleCharge.mockResolvedValue({ kind: 'failed' });
    mockInitiatePayment.mockReset();
    mockInitiatePayment
      .mockResolvedValueOnce(IN_FLIGHT)
      .mockResolvedValueOnce({ kind: 'redirect', redirectUrl: 'https://sandbox.tappaysdk.com/pay?token=abc' });
    const action = await getAction();
    const res = await action(validInput());
    expect(mockInitiatePayment).toHaveBeenCalledTimes(2);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ redirect: true, redirectUrl: 'https://sandbox.tappaysdk.com/pay?token=abc' });
  });

  it('paid(idempotent:true 重放)→ 同樣 ok:true(成功真相 = confirm 成功)', async () => {
    mockConfirmPayment.mockResolvedValue({ kind: 'paid', idempotent: true });
    const action = await getAction();
    expect(await action(validInput())).toEqual({ ok: true, displayId: 'PCM-2026-0001' });
  });
});

describe('chargePaymentAction — settlement_required 即時裁決(3DS-7 7c-2、🔴 鐵則 12)', () => {
  const MSG_SETTLE = '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認';
  const MSG_CHARGE_FAILED = '付款未成功,請確認卡片資訊後重試';

  describe('同步路徑(flag off、confirmPayment → settlement_required)', () => {
    it('🔴 duplicate(existingPaid)→ paid-equivalent { ok:true, displayId:既有單 }、零 settleCharge(hook clear+regenerate)', async () => {
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_DUPLICATE });
      const action = await getAction();
      const res = await action(validInput());
      // 既有單號(非本次新建的孤兒單 PCM-2026-0001)
      expect(res).toEqual({ ok: true, displayId: 'PCM-2026-DUP' });
      expect(mockSettleCharge).not.toHaveBeenCalled(); // duplicate=DB 已確定 paid、不打 settleCharge
    });

    it('🔴 needs_settle + settleCharge=paid → paid-equivalent { ok:true, displayId:settle 回既有單 };settleCharge 收 server 權威 existingOrderId + recTradeIdHint', async () => {
      mockSettleCharge.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-2026-NS' });
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      expect(await action(validInput())).toEqual({ ok: true, displayId: 'PCM-2026-NS' });
      expect(mockGetSettleChargeDeps).toHaveBeenCalledTimes(1);
      expect(mockSettleCharge).toHaveBeenCalledWith(
        { tag: 'settle-deps' },
        { orderId: 'order-existing-1', recTradeIdHint: 'D-REC-EXIST' }, // existingOrderId + rec hint(server 權威)
      );
    });

    it('🔴 needs_settle(existingRecTradeId=null)→ settleCharge recTradeIdHint=undefined(?? 轉換、走 order_number 弱識別)', async () => {
      mockSettleCharge.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-2026-NS' });
      mockConfirmPayment.mockResolvedValue({
        kind: 'settlement_required',
        dedup: { ...DEDUP_NEEDS_SETTLE, existingRecTradeId: null },
      });
      const action = await getAction();
      await action(validInput());
      expect(mockSettleCharge).toHaveBeenCalledWith(
        { tag: 'settle-deps' },
        { orderId: 'order-existing-1', recTradeIdHint: undefined },
      );
    });

    it.each([
      ['failed', { kind: 'failed' }],
      ['no_attempt', { kind: 'no_attempt' }],
    ])('🔴 needs_settle + settleCharge=%s → 放行重刷(charge_failed、釋鎖、顯既有單號、保留 key)', async (_label, settled) => {
      mockSettleCharge.mockResolvedValue(settled);
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      expect(await action(validInput())).toEqual({
        ok: false,
        payment: 'charge_failed',
        displayId: 'PCM-2026-NS',
        message: MSG_CHARGE_FAILED,
      });
    });

    it('🔴 needs_settle + settleCharge=pending → 短 hold(processing、保留 key、不放行、勿重複付款)', async () => {
      mockSettleCharge.mockResolvedValue({ kind: 'pending', reason: 'auth_or_pending' });
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      expect(await action(validInput())).toEqual({
        ok: false,
        payment: 'processing',
        displayId: 'PCM-2026-NS',
        message: MSG_SETTLE,
      });
    });

    it('🔴 needs_settle + settleCharge throw → 局部 try/catch 映 processing(保留 key)、**非 generic formError**(不誤釋鎖=防雙扣)', async () => {
      mockSettleCharge.mockRejectedValue(new Error('Record API 連線爆炸'));
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      const res = await action(validInput());
      expect(res).toEqual({
        ok: false,
        payment: 'processing',
        displayId: 'PCM-2026-NS',
        message: MSG_SETTLE,
      });
      expect(res).not.toHaveProperty('formError'); // 🔴 絕不落外層 generic catch
      expect(JSON.stringify(res)).not.toContain('爆炸'); // 不洩原文
    });

    it('🔴 needs_settle + getSettleChargeDeps throw → 同樣局部 try/catch 映 processing(deps 建構也在 try 內)', async () => {
      mockGetSettleChargeDeps.mockImplementation(() => {
        throw new Error('PAYMENT_CONFIRMER_DB_URL 缺');
      });
      mockConfirmPayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      const res = await action(validInput());
      expect(res).toMatchObject({ ok: false, payment: 'processing', message: MSG_SETTLE });
      expect(res).not.toHaveProperty('formError');
    });
  });

  describe('3DS 路徑(flag on、initiatePayment → settlement_required;同款 adjudicateSettlement)', () => {
    it('🔴 duplicate → paid-equivalent { ok:true, displayId:既有單 }、零 settleCharge', async () => {
      mockIsThreeDSEnabled.mockReturnValue(true);
      mockInitiatePayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_DUPLICATE });
      const action = await getAction();
      expect(await action(validInput())).toEqual({ ok: true, displayId: 'PCM-2026-DUP' });
      expect(mockSettleCharge).not.toHaveBeenCalled();
    });

    it('🔴 needs_settle + settleCharge=paid → paid-equivalent;settleCharge 收 existingOrderId + rec hint', async () => {
      mockIsThreeDSEnabled.mockReturnValue(true);
      mockSettleCharge.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-2026-NS' });
      mockInitiatePayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      expect(await action(validInput())).toEqual({ ok: true, displayId: 'PCM-2026-NS' });
      expect(mockSettleCharge).toHaveBeenCalledWith(
        { tag: 'settle-deps' },
        { orderId: 'order-existing-1', recTradeIdHint: 'D-REC-EXIST' },
      );
    });

    it('🔴 needs_settle + settleCharge throw → processing(保留 key、非 generic formError;3DS 路徑同款防雙扣)', async () => {
      mockIsThreeDSEnabled.mockReturnValue(true);
      mockSettleCharge.mockRejectedValue(new Error('boom'));
      mockInitiatePayment.mockResolvedValue({ kind: 'settlement_required', dedup: DEDUP_NEEDS_SETTLE });
      const action = await getAction();
      const res = await action(validInput());
      expect(res).toMatchObject({ ok: false, payment: 'processing', message: MSG_SETTLE });
      expect(res).not.toHaveProperty('formError');
    });
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

describe('chargePaymentAction — 🔴 R3 立即重刷 preflight(canonical §2.3、placeOrder 前)', () => {
  const MSG_SETTLE = '訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認';

  it('🔴 Q1=A gating:flag off(同步路徑)→ preflight 零呼叫、走 confirmPayment(零回歸)', async () => {
    // 預設 flag off。preflight 只在 3DS 路徑跑;同步路徑逐字不動。
    const action = await getAction();
    await action(validInput());
    expect(mockPreflightReleaseSibling).not.toHaveBeenCalled();
    expect(mockGetPreflightReleaseSiblingDeps).not.toHaveBeenCalled();
    expect(mockConfirmPayment).toHaveBeenCalledTimes(1);
  });

  it('flag on + proceed → 續建單 + charge(placeOrder/initiatePayment 被呼)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockPreflightReleaseSibling.mockResolvedValue({ kind: 'proceed' });
  mockClaimPollSettle.mockResolvedValue(true); // 🔴 L4b 預設節流放行;不放行的那格顯式 override
  mockGetPollSettleThrottle.mockReturnValue({ claimPollSettle: (...a: unknown[]) => mockClaimPollSettle(...a) });
    const action = await getAction();
    const res = await action(validInput());
    expect(mockPreflightReleaseSibling).toHaveBeenCalledTimes(1);
    expect(mockPlaceOrder).toHaveBeenCalledTimes(1); // proceed → 建新單
    expect(mockInitiatePayment).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ redirect: true, redirectUrl: 'https://sandbox.tappaysdk.com/pay?token=abc' });
  });

  it('🔴 flag on + existing_paid → { ok:true, displayId 既有單 }、placeOrder 零呼叫(不建新單、零雙扣)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockPreflightReleaseSibling.mockResolvedValue({
      kind: 'existing_paid',
      existingOrderId: 'order-existing-9',
      displayId: 'PCM-2026-EXIST',
    });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({ ok: true, displayId: 'PCM-2026-EXIST' }); // hook 當 paid:clear + regenerate
    expect(mockPlaceOrder).not.toHaveBeenCalled(); // 🔴 preflight 在 placeOrder 前短路
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('🔴 flag on + hold → processing 無 displayId(§2.3 保留 cart、Q2=B 鎖按鈕)、placeOrder 零呼叫', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockPreflightReleaseSibling.mockResolvedValue({ kind: 'hold', reason: 'lookup_unreachable' });
    const action = await getAction();
    const res = await action(validInput());
    expect(res).toEqual({ ok: false, payment: 'processing', message: MSG_SETTLE });
    expect(res).not.toHaveProperty('displayId'); // 🔴 無單號 → hook 不清車 + 按鈕鎖死
    expect(mockPlaceOrder).not.toHaveBeenCalled(); // 不建新單
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('🔴 userId 餵 server 驗過登入態 user.id(不信 client 竄改)+ deps 工廠值', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    const action = await getAction();
    // client 竄改 userId/cartSessionId(cartSessionId 仍須過 uuid 驗 → 用合法值;userId client 塞假值)。
    await action(validInput({ userId: 'attacker-999' }));
    expect(mockPreflightReleaseSibling).toHaveBeenCalledWith(
      { tag: 'preflight-deps' }, // = await getPreflightReleaseSiblingDeps()
      { userId: 'user-1', cartSessionId: CART_SESSION }, // 🔴 userId = getUser().user.id、非 client 'attacker-999'
    );
  });

  it('🔴 preflight 在 placeOrder「前」:existing_paid 短路時 placeOrder/findTotal 全零呼叫(無孤兒單)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true);
    mockPreflightReleaseSibling.mockResolvedValue({
      kind: 'existing_paid',
      existingOrderId: 'order-existing-9',
      displayId: 'PCM-2026-EXIST',
    });
    const action = await getAction();
    await action(validInput());
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockFindTotal).not.toHaveBeenCalled();
  });
});

describe('chargePaymentAction — #241 同意條款 server 驗(codex 關卡1 B3:守門在付款/建單/settle 副作用前)', () => {
  // 🔴 agreed 缺/false/非布林 → formError「請先閱讀並同意」+ **任何副作用函式全未被呼**(防未來把守門移到 preflight 後)。
  it.each([
    ['agreed=undefined(缺、未送)', { agreed: undefined } as Record<string, unknown>],
    ['agreed=false', { agreed: false }],
    ['agreed=字串 "true"(非布林、不放行)', { agreed: 'true' }],
    ['agreed=1(非布林、不放行)', { agreed: 1 }],
  ])('%s → formError + 零任何副作用(flag-off 同步路徑)', async (_label, over) => {
    mockIsThreeDSEnabled.mockReturnValue(false);
    const action = await getAction();
    const res = await action(validInput(over));
    expect(res).toEqual({ formError: '請先閱讀並同意服務條款與隱私政策' });
    expect(mockBuildCardholder).not.toHaveBeenCalled();
    expect(mockPreflightReleaseSibling).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockFindTotal).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockSettleCharge).not.toHaveBeenCalled();
  });

  it('🔴 缺 agreed → flag-on(3DS)路徑亦零副作用(守門在 preflightReleaseSibling 前、不動 sibling/settle)', async () => {
    mockIsThreeDSEnabled.mockReturnValue(true); // 3DS 路徑(preflight 啟用)
    const action = await getAction();
    const res = await action(validInput({ agreed: false }));
    expect(res).toEqual({ formError: '請先閱讀並同意服務條款與隱私政策' });
    expect(mockBuildCardholder).not.toHaveBeenCalled();
    expect(mockPreflightReleaseSibling).not.toHaveBeenCalled();
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockSettleCharge).not.toHaveBeenCalled();
  });

  it('🔴 agreed=true → 注入 termsVersion(常數)+ best-effort IP/UA(首段 trim、截斷)進 placeOrderInput', async () => {
    mockIsThreeDSEnabled.mockReturnValue(false);
    mockHeadersGet.mockImplementation((n: string) =>
      n === 'x-vercel-forwarded-for'
        ? '203.0.113.7, 10.0.0.1'
        : n === 'user-agent'
          ? 'Mozilla/Test'
          : null,
    );
    const action = await getAction();
    await action(validInput());
    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.termsVersion).toBe(CURRENT_TERMS_VERSION);
    expect(placeOrderInput.clientIp).toBe('203.0.113.7'); // x-vercel-forwarded-for 首段 trim
    expect(placeOrderInput.clientUserAgent).toBe('Mozilla/Test');
  });

  it('🔴 IP header 優先序 x-vercel-forwarded-for > x-forwarded-for > x-real-ip;UA 缺 → null', async () => {
    mockIsThreeDSEnabled.mockReturnValue(false);
    mockHeadersGet.mockImplementation((n: string) =>
      n === 'x-forwarded-for' ? '198.51.100.9' : n === 'x-real-ip' ? '192.0.2.1' : null,
    );
    const action = await getAction();
    await action(validInput());
    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.clientIp).toBe('198.51.100.9'); // vercel 無 → 取 x-forwarded-for(優先於 x-real-ip)
    expect(placeOrderInput.clientUserAgent).toBeNull(); // user-agent 缺 → null
  });
});
