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
import {
  PCM_REMITTANCE_ACCOUNT_NAME,
  PCM_REMITTANCE_ACCOUNT_NO,
  PCM_REMITTANCE_EXPIRE_DAYS,
} from '@pcm/domain';
import { CURRENT_TERMS_VERSION } from '@/lib/legal/terms-version';

const mockPlaceOrder = vi.fn();
const mockHeadersGet = vi.fn(); // 🔴 #241:next/headers headers().get(name) mock(IP/UA 抓)
const mockConfirmPayment = vi.fn();
const mockInitiatePayment = vi.fn();
const mockSettleCharge = vi.fn(); // 3DS-7 7c-2:settlement_required needs_settle 即時裁決
const mockFindPaymentChannel = vi.fn(); // 段 1-B:建單後回查 payment_channel
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
// 段 1(M-4b):匯款總開關。預設 false = 今天線上的世界(flag 未設)。
const mockIsBankTransferEnabled = vi.fn();
const mockIsCheckoutNotificationEmailEnabled = vi.fn();
const mockResolveThreeDSConfig = vi.fn();
const mockBuildResultUrls = vi.fn();
const mockIsHttpsUrl = vi.fn();

// 🔴 B-4:charge-actions 現在 import `lib/email/resolve-notification-recipient`(真模組、不 mock —— 
//    收件人解析是本片的被測行為),而那支檔頭有 `import 'server-only'` ⇒ node env 下要先中和它。
vi.mock('server-only', () => ({}));
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
vi.mock('@/lib/payment/bank-transfer-flag', () => ({
  isBankTransferCheckoutEnabled: () => mockIsBankTransferEnabled(),
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
    // 🔵 段 1-B:付款方式(必填、無預設)。這裡放 tappay = **今天線上唯一的那個世界**
    //   🛑 而它是【一個世界不是中性預設】—— 匯款那個世界要有自己的測項, 不靠這個預設代表它。
    //   🔴 而「缺這個鍵」也要有自己的負測(client 少送 ⇒ zod fail-closed), 顯式 override。
    paymentChannel: 'tappay',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } } });
  mockGetOrderRepo.mockResolvedValue({ findTotal: mockFindTotal, findPaymentChannel: mockFindPaymentChannel });
  // 🔵 預設 = 回查與送出相符(= 正常世界)。不符那個世界由它自己那一格顯式 override。
  mockFindPaymentChannel.mockResolvedValue('tappay');
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
  // 🔴 B-4:預設補 addressEmail(舊地址 = null),否則既有格會靜默跑在 undefined 上而 typecheck 不會紅。
  //    要驗「落到地址 email」的格各自 override。
  mockBuildCardholder.mockResolvedValue({ ok: true, cardholder: CARDHOLDER, addressEmail: null });
  mockPlaceOrder.mockResolvedValue({ orderId: 'order-server-1', displayId: 'PCM-2026-0001' });
  mockFindTotal.mockResolvedValue(TOTAL);
  mockConfirmPayment.mockResolvedValue({ kind: 'paid', idempotent: false });
  // 3DS-6a 預設 flag off(既有同步測沿用、3DS mock 不被呼);各 3DS 測顯式 mockReturnValue(true)。
  mockIsThreeDSEnabled.mockReturnValue(false);
  // 段 1 預設 flag off = 今天線上的世界;要驗「開了會怎樣」的格顯式 mockReturnValue(true)。
  mockIsBankTransferEnabled.mockReturnValue(false);
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

  // ⟦acct-INVOICEFIELDERR⟧ Sean 2026-09-03 拍「要」(Q15b)。**本片只補守門, 不動那條路的行為。**
  //
  // 🔴 **這一格在守什麼**:`charge-actions.ts:149-152` 把發票四個子欄各自的錯誤
  //    搬進 `fieldErrors.invoice.<那一欄>` —— **客人才看得到是哪一欄填錯**。
  //    而在此之前**本檔對 `fieldErrors.invoice` 的斷言格數 = 0**(開列的人當場量的)
  //    ⇒ 🛑 那段搬運碼**沒有任何東西在守**。
  //
  // 🛑 **而開列的人明寫:證明的是【沒有東西在守它】, 不是【它壞了】** —— 引用時不要合併。
  //    本片跑完證實:它今天是好的, 而它從今天起有尺。
  //
  // 🔵 **`packages/schemas` 那 30 格不涵蓋這一格** —— 它們證明「填錯會被擋下來」,
  //    而**擋下來之後客人看到什麼**是另一段碼(就是這一段)。
  //    ⇒ 📌 兩者都綠, 而中間那一步先前沒有人量。
  //
  // 🛑 **它若壞掉的形狀**:那段沒搬成功 ⇒ `fieldErrors` 是空的
  //    ⇒ 掉進 `formError` 的「結帳資料有誤,請返回確認」
  //    ⇒ **客人被叫去「確認」一個沒有標出是哪一欄的東西** —— 與 `題 15` 同一族的病。
  it('🔴 公司發票兩欄都錯 ⇒ 各自進 fieldErrors.invoice.<那一欄>, 而【不是】掉進通用 formError', async () => {
    const action = await getAction();
    // company + 空抬頭 + 非 8 碼統編 ⇒ schema superRefine 產出兩個 issue,
    // path 分別是 ['invoice','title'] 與 ['invoice','taxId']。
    const res = await action(validInput({ invoice: { type: 'company', title: '', taxId: '123' } }));

    // 🎯 判別點一:**兩欄各自有話**(而不是壓成一句)。
    expect(res).toMatchObject({
      fieldErrors: { invoice: { title: expect.any(String), taxId: expect.any(String) } },
    });
    // 🎯 判別點二:**不得掉進通用 formError** —— 那正是搬運碼壞掉時的長相。
    expect(res).not.toHaveProperty('formError');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  // 🔴🔴 **codex must-fix:上面那格【同時】製造 title 與 taxId 兩個錯 ⇒ 它證不到【逐欄】搬運。**
  //    一個「遇到任何 invoice issue 就硬塞這兩欄」的實作照樣全綠, 而單欄錯的世界會錯位。
  //    ⇒ ✅ 補兩格**只錯一欄**的:少了它們, 那個「硬塞兩欄」的突變殺不掉。
  it('🔴 只有抬頭錯(統編合法)⇒ 只有 title 有訊息, taxId 不得被順手塞一個', async () => {
    const action = await getAction();
    const res = await action(
      validInput({ invoice: { type: 'company', title: '', taxId: '12345678' } }),
    );
    expect(res).toMatchObject({ fieldErrors: { invoice: { title: expect.any(String) } } });
    // 🎯 判別點:**沒錯的那一欄不得有話** —— 客人會去改一個本來就對的欄位。
    const invoiceErrors = (res as { fieldErrors?: { invoice?: Record<string, unknown> } })
      .fieldErrors?.invoice;
    expect(invoiceErrors).not.toHaveProperty('taxId');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔴 捐贈發票缺愛心碼 ⇒ donateCode 那一欄有話(第四個子欄, 先前零覆蓋)', async () => {
    const action = await getAction();
    const res = await action(validInput({ invoice: { type: 'donate', donateCode: '' } }));
    expect(res).toMatchObject({ fieldErrors: { invoice: { donateCode: expect.any(String) } } });
    // 🔵 而它不得掉進通用 formError —— 那是搬運沒接到這一欄時的長相。
    expect(res).not.toHaveProperty('formError');
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔵 負對照:發票以外的欄位【不得】被搬進 invoice 那一格(擋過寬的搬運)', async () => {
    const action = await getAction();
    const res = await action(validInput({ addressId: 'not-uuid' }));
    // 🔴 少了這一格, 一個「把所有 issue 都塞進 fieldErrors.invoice」的實作也會讓上面那格全綠。
    expect(res).not.toHaveProperty('fieldErrors.invoice');
    expect(res).toMatchObject({ fieldErrors: { addressId: expect.any(String) } });
  });

  it('addressId 非 uuid → fieldErrors.addressId、零後續', async () => {
    const action = await getAction();
    const res = await action(validInput({ addressId: 'not-uuid' }));
    expect(res).toMatchObject({ fieldErrors: { addressId: expect.any(String) } });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔴 B-4 flag off：第 9 參【無條件】送，值 = server 解出的 session email(不是 client 偷塞的、也不是 null)', async () => {
    // ~~B-3:flag off ⇒ 不進 PlaceOrderInput、維持 8-param marker absent~~(plan §4.1 申報偏離)。
    // 🔴 這格同時守三件:①值是那個具體 email(不是「非 null」)②flag off 也要有值
    //    ③client 偷塞的值到不了建單 —— 第三件是這格改寫前唯一的守門,不可順手刪(plan §6 #7)。
    const action = await getAction();
    await action(validInput({ notificationEmail: 'attacker@example.com' }));

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.notificationEmail).toBe('a@b.com'); // = mockGetUser 的 session email
    expect(JSON.stringify(placeOrderInput)).not.toContain('attacker@example.com');
  });

  it('🔴 B-4 LINE 客人：session 是合成域 ⇒ 落到收件地址那個【具體】email', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: `line_U${'a'.repeat(32)}@line.pcmmotorsports.local` } },
    });
    mockBuildCardholder.mockResolvedValue({
      ok: true,
      cardholder: { ...CARDHOLDER, email: 'line-user@mail.tw' },
      addressEmail: 'line-user@mail.tw',
    });
    const action = await getAction();
    await action(validInput());

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.notificationEmail).toBe('line-user@mail.tw');
  });

  it('🔴 B-4 plan §3.2：同一張單的 cardholder.email 與 notification_email【可以不同】,那是預期行為', async () => {
    // 順位刻意相反:cardholder = 地址優先(TapPay)、notification = 註冊信箱優先(Sean 拍板)。
    // 這格擋的是「下一個人順手把兩者統一」。突變 = 把 resolver 順位改成地址優先 ⇒ 兩者相等 ⇒ 紅。
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'member@example.com' } } });
    mockBuildCardholder.mockResolvedValue({
      ok: true,
      cardholder: { ...CARDHOLDER, email: 'ship-to@mail.tw' },
      addressEmail: 'ship-to@mail.tw',
    });
    const action = await getAction();
    await action(validInput());

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.notificationEmail).toBe('member@example.com');
    const [, confirmInput] = mockConfirmPayment.mock.calls[0]!;
    expect(confirmInput.cardholder.email).toBe('ship-to@mail.tw');
    expect(placeOrderInput.notificationEmail).not.toBe(confirmInput.cardholder.email);
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

  it('🔴 B-4 flag on：客人自己填的那個值【被採用】(第一候選),canonical 後送出', async () => {
    // ~~B-3:只送 9th null,真值留 B-4~~ —— 舊格的 `not.toContain('Member@example.com')`
    // 那個字面**正好是新行為的正確值**(plan §4)。
    // 🔴 這格釘的是 R3-F1:flag 將來被翻成 on 時,:129-131 會強制客人填 Email;
    //    resolver 少了第一候選 ⇒ 客人親手填的信箱被靜默丟掉、畫面全正常、零測試會紅。
    //    突變 = 把第一候選從 :272 的呼叫拿掉 ⇒ 這格必紅(會落回 session 的 a@b.com)。
    mockIsCheckoutNotificationEmailEnabled.mockReturnValue(true);
    const action = await getAction();
    await action(validInput({ notificationEmail: ' Member@EXAMPLE.COM ' }));

    const [, placeOrderInput] = mockPlaceOrder.mock.calls[0]!;
    expect(placeOrderInput.notificationEmail).toBe('Member@example.com');
  });

  // 🔴 兩個 code 各釘一格(codex 關卡2 nit 4):只測 PGRST202 的話,刪掉 `|| rpcErrorCode === '42883'`
  //    整套仍綠 —— 而正式站若回的是 PG 那一側的 42883,指名修法的 log 就消失了。
  it.each(['PGRST202', '42883'])(
    '🔴 B-4 硬閘的回聲:create_order 簽章不符(%s)→ 通用字面照舊,而 log 指名修法',
    async (code) => {
      // 這條路 = prod 沒 apply 到 9 參版本的世界。客人看到的字面不變(Q2=A、零 error 透傳),
      // 但收到通報的人要在 log 裡直接拿到「跑哪支腳本」。突變 = 刪掉那個 if ⇒ 這格必紅。
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockPlaceOrder.mockRejectedValue(Object.assign(new Error('boom'), { code }));
      const action = await getAction();
      const res = await action(validInput());

      expect(res).toEqual({ formError: '付款失敗,請稍後再試或聯繫客服 LINE' });
      expect(spy).toHaveBeenCalledWith(
        '[checkout] create_order 簽章不符',
        expect.objectContaining({
          code,
          // 🔴 2026-09-04:斷言改成釘住**不會每一代都變的那半**。
          //    ⛔ ~~原本斷言 `verify-create-order-9param.sh`~~ —— 那句話寫死了參數個數(9),
          //    而它已經錯過一次(正式庫是 10 參), A 貼下去是 11 參, C 之後又會變。
          //    📌 **寫死數字的訊息, 每一代都要有人回來改 —— 而沒有人會。**
          fix: expect.stringContaining('supabase/migrations/'),
        }),
      );
      spy.mockRestore();
    },
  );

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

  // ══════════════════════════════════════════════════════════════════════════
  // 段 1-B · payment_channel 的兩個世界 —— 🔴 **它們守的不是同一件事, 所以分開命名**
  //
  //   ① 【客人端少送】     ⇒ zod 在【進 DB 之前】擋掉      ⇒ 零建單
  //   ② 【送了而 DB 存成別的】⇒ zod 看不到(它只看 input)⇒ 只有 read-back 擋得到
  //
  // 🛑 而**合成一格會製造假保護**:①過了會讓人以為②也有人守, 而②是那個
  //    「兩端都印成功」的世界 —— 它才是這一族真正危險的那一半。
  // ══════════════════════════════════════════════════════════════════════════

  it('【世界①·zod】client 少送 paymentChannel → formError、零 placeOrder(連單都不建)', async () => {
    const action = await getAction();
    // 🔴 走**真的那條路**:整個鍵拿掉, 讓它經過真的 safeParse ——
    //    不是直接呼叫函式、也不是塞 undefined 值。因為要守的正是
    //    「TS 把 undefined 序列化掉之後, 那個鍵根本不存在」那個世界。
    const input = validInput();
    delete (input as Record<string, unknown>).paymentChannel;
    const res = await action(input);

    // 🔵 實測回的是 **fieldErrors 那一句具體的**, 不是通用 formError ——
    //    比我原本斷言的更好(客人看得到是哪一欄), 所以斷言跟著事實走、不是把事實改成斷言。
    expect(res).toMatchObject({ fieldErrors: { paymentChannel: '請選擇付款方式' } });
    // 🔴 最重要的那一格:**零建單** —— 它擋在 placeOrder 之前, 不是之後補救。
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('【世界②·read-back】送 bank_transfer 而 DB 存成 tappay → formError、零 confirmPayment', async () => {
    // 🎯 這就是「兩端都印成功」那個世界:placeOrder **成功回了 order id**,
    //    DB 也**真的有一張合法的單** —— 而那張單上的付款方式是錯的。
    //    (真實成因:舊 10 參簽名還在 ⇒ 解析到舊版 ⇒ 該欄吃 DEFAULT 'tappay'。)
    // 🔴 段 1 的總開關預設 off ⇒ 這一格必須顯式開它:
    //   read-back 守的是**建單之後**那一格, 而總開關擋在**建單之前** ——
    //   不開它, 這個測試會在到達被測對象之前就被擋下, 而它印的紅在講另一件事。
    mockIsBankTransferEnabled.mockReturnValue(true);
    mockFindPaymentChannel.mockResolvedValue('tappay');
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));

    expect(res).toMatchObject({ formError: expect.stringContaining('付款失敗') });
    // 🔴 建了單(所以這不是 zod 那一格能守的)⇒ 而**錢一毛沒動**。
    expect(mockPlaceOrder).toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('【世界②·read-back】回查回 null(RLS 讀不到自己剛建的單)→ 拒, 不當成 tappay', async () => {
    // 🛑 負對照:讀不到 ≠ 讀到 tappay。若哪天有人把 adapter 改成
    //    「讀不到就回 'tappay'」, 這一格會紅 —— 而那正是這道守門會被弄壞的方式。
    // 🔵 這一格送的是 tappay ⇒ 總開關那一行短路求值(第一個條件就假)⇒ **flag 根本不會被讀**。
    //   ⛔ ~~我一度在這裡加了 mockIsBankTransferEnabled(true)~~ ⇒ 拿掉:它沒有作用, 而它會讓
    //      下一個人以為這一格與那道閘有關(codex 關卡2 nit ③, 它先判我弱化了這格、回看後自己撤回)。
    mockFindPaymentChannel.mockResolvedValue(null);
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'tappay' }));

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

  // ── 🔴🔴 `#900`(2026-08-24):訊號 ────────────────────────────────────────
  // 上面那幾格證的是【行為對】(照舊擋、零 settle)。而在此之前**兩個世界的行為是一樣的**:
  //   世界①「throttle 好好地擋下來」(預期,每天都會發生)
  //   世界②「settle 這條路壞了」    (不預期)
  // 兩者都回 false、都不留痕 ⇒ **在我們這端是同一個畫面(什麼都沒有)**
  // ⇒ 「它從來沒出過問題」與「它一直在失敗」分不出來。
  // 🔴 所以這一格要的**不是「有 log」,是「兩個世界印【不同】的東西」** ——
  //    印同一句話的兩個訊號,判別力等於零。
  it('🔴 `#900`:被 throttle 擋下 vs settle 拋錯 ⇒ 必須印【不同】的東西(不是「有印就好」)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 世界①:throttle 擋下(allowed = false)⇒ 只有 info,零 error
    mockClaimPollSettle.mockResolvedValue(false);
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    expect(await (await getAction())(validInput())).toEqual(IN_FLIGHT_MSG);
    const world1Info = info.mock.calls.map((c) => String(c[0]));
    expect(world1Info.some((m) => m.includes('throttle 擋下'))).toBe(true);
    expect(error).not.toHaveBeenCalled();

    info.mockClear();
    error.mockClear();

    // 世界②:settle 拋錯 ⇒ 只有 error,而且訊息不同
    mockClaimPollSettle.mockResolvedValue(true);
    mockSettleCharge.mockRejectedValue(new Error('settle boom'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);
    expect(await (await getAction())(validInput())).toEqual(IN_FLIGHT_MSG);
    const world2Error = error.mock.calls.map((c) => String(c[0]));
    expect(world2Error.some((m) => m.includes('settle 拋錯'))).toBe(true);

    // 🔴 **這一行才是本格的重點**:兩個世界的訊息集合不得相交。
    //    少了它,兩邊各印一句「[checkout] 在途單處理」也會全綠 —— 而那等於沒有訊號。
    expect(world1Info.filter((m) => world2Error.includes(m))).toEqual([]);

    info.mockRestore();
    error.mockRestore();
  });

  // ── 🔴 R1 findings 2/4/5/7 的守門(codex 關卡2, must-fix)────────────────────────
  // 📌 上面那格只驗了 `c[0]`(第一參數的文字)。而**刻意餵進去的祕密在 `c[1]`** ——
  //    「想到了那個字, 而沒有斷言它不出現」⇒ 那個字當時的作用是【看起來驗過了】。
  // 🔴 而本檔這幾格裡最重的是 finding 2 那一格:它守的是**雙扣**, 不是 log 好不好看。

  it('🔴 finding 2:`console.error` 自己拋錯時, 仍須回 IN_FLIGHT_MSG —— 不得掉出 formError(那會釋鎖 ⇒ 雙扣)', async () => {
    // 🔴 這一格是整輪 R1 最重的一條。`isInFlightSettledFailed` 的 docstring 逐字寫著
    //    「任何 throw 都回 false(照舊擋), **絕不落到 chargePaymentAction 的外層 generic catch**
    //      —— 那會回 formError, 而 client 收到 formError 會釋放按鈕允許重試 = 潛在雙扣」。
    //    而我原本在那個 catch 裡放了一個裸 `console.error` ⇒ **catch 區塊裡的語句在那個 catch
    //    的保護範圍外面** ⇒ 它拋就逃出去 ⇒ 那條不變式被我自己在同一支檔裡打破。
    //    ⚠️ 突變靶:把 `safeLog` 改回裸 `console.error` ⇒ 本格必紅(而且紅在 formError 上)。
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is broken');
    });
    mockClaimPollSettle.mockResolvedValue(true);
    mockSettleCharge.mockRejectedValue(new Error('settle boom'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);

    const res = await (await getAction())(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG);
    expect(res).not.toHaveProperty('formError'); // ← 承重:formError 就是釋鎖那條路
    error.mockRestore();
  });

  it('負對照:`console.info` 自己拋錯(throttle 擋下那條路)也不得掉出 formError', async () => {
    // 少了這一格, `safeLog` 只被證明在 error 那條路上有接。
    const info = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console is broken');
    });
    mockClaimPollSettle.mockResolvedValue(false);
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);

    const res = await (await getAction())(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG);
    expect(res).not.toHaveProperty('formError');
    info.mockRestore();
  });

  it('🔴 finding 4/7:第三方 error 的內容【不得】出現在 log 的任何一個參數裡', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockClaimPollSettle.mockResolvedValue(true);
    mockSettleCharge.mockRejectedValue(new Error('settle boom secret-detail'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);

    expect(await (await getAction())(validInput())).toEqual(IN_FLIGHT_MSG);

    // 🔴 掃**全部參數**, 不只 `c[0]` —— 這是本格與上面那格 `#900` 的唯一差別。
    const everything = JSON.stringify(error.mock.calls);
    expect(everything).not.toContain('secret-detail');
    expect(everything).not.toContain('settle boom');
    // 正向:仍要印得出「哪一段」與「哪一類例外」, 否則「什麼都不印」也能讓本格綠。
    expect(everything).toContain('settle');
    expect(everything).toContain('Error');
    error.mockRestore();
  });

  it('🔴 finding 5:throttle RPC 自己拋錯時, 不得印成「settle 拋錯」(歸因)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 世界③:throttle RPC 自己拋 ⇒ settleCharge **根本沒被呼叫**
    mockClaimPollSettle.mockRejectedValue(new Error('throttle rpc down'));
    mockConfirmPayment.mockResolvedValue(IN_FLIGHT);

    const res = await (await getAction())(validInput());
    expect(res).toEqual(IN_FLIGHT_MSG); // 行為不變:照舊擋
    expect(res).not.toHaveProperty('formError');
    expect(mockSettleCharge).not.toHaveBeenCalled();

    const msgs = error.mock.calls.map((c) => String(c[0]));
    // 🔴 承重的是這一條**否定**:值班的人 grep「settle 拋錯」不該撈到這一發。
    expect(msgs.some((m) => m.includes('settle 拋錯'))).toBe(false);
    expect(msgs.some((m) => m.includes('throttle RPC 拋錯'))).toBe(true);
    error.mockRestore();
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

// ─────────────────────────────────────────────────────────────
// 🔴 **無條件守門:祕密不得從【任何一條】log 路徑出去(2026-08-29 線D)**
//
// **為什麼是「無條件」,而那三個字是這道守門的全部價值**:
//   它**不需要有人記得把新的呼叫點加進某張清單** —— 它攔的是 `console` 本身。
//   ⇒ 下一個人加第七個 `safeLog` 呼叫點、把整包 row 丟進去 ⇒ **這裡會紅**,
//     而不需要任何人先想到要去更新一張白名單。
//   📌 **對照**:`safeErrorName` 是「只允許」形狀(白名單),它守的是**錯誤名**那一格;
//      而**沒有任何東西守 `fields`** —— `safeLog` 的本體逐字就三行:
//      `try { console[level](message, fields); } catch {}` ⇒ **它原樣交給 console,不清洗。**
//      ⇒ `safeLog` 這個名字保證的是「**印不出來時不改變控制流**」,不是「印出來的東西是安全的」。
//      🔴 **而那個名字出現在每一個呼叫點,而呼叫它的人不會去讀它的本體。**
//
// 🔴 **這道守門的天花板,明寫**(它比它聽起來窄):
//   ① 它只攔得住**本測試真的走過的那幾條路** —— 沒被執行到的分支,它看不到。
//   ② 它只找得到**本測試親手種進去的那幾個哨兵值** —— 一個從別處冒出來的祕密,它不認得。
//   ⇒ **「這一格綠」= 「這幾條路上、這幾個值沒有外洩」,不等於「沒有外洩」。**
//   📌 而這正是它要防的那個誤讀:**一道無條件的守門,仍然有一個有條件的分母。**
describe('🔴 祕密不得出現在任何 console 輸出裡(無條件:攔 console,不是列白名單)', () => {
  /** 攔下所有 console 管道,回傳「全部輸出攤平成一個字串」的取值函式。 */
  function captureConsole() {
    const seen: string[] = [];
    const push = (...args: unknown[]) => {
      for (const a of args) {
        try {
          seen.push(typeof a === 'string' ? a : JSON.stringify(a));
        } catch {
          seen.push(String(a)); // 循環參照之類:退回 String,寧可多收不要漏收
        }
      }
    };
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation(push),
    );
    return { all: () => seen.join('\n'), restore: () => spies.forEach((s) => s.mockRestore()) };
  }

  it('[L1] 正對照:這把尺【真的攔得到】—— 故意把 prime 印出去 ⇒ 必須看得見', () => {
    const cap = captureConsole();
    // 🔴 這一格排在下一格【之前】,而它是活性對照:
    //    沒有它,一個「什麼都沒攔到」的 captureConsole 也會讓 L2 全綠。
    //    📌 一把沒接上的尺,與一個沒有外洩的世界,印同一個空字串。
    console.error('[test] 故意洩漏', { prime: 'prime_abc' });
    const out = cap.all();
    cap.restore();
    expect(out).toContain('prime_abc');
  });

  it('[L2] 走【真的會 log 的那幾條路】⇒ 所有 console 輸出不含任何哨兵值', async () => {
    // 🔴🔴 **這一格的第一版是【恆真】的,而我的 L1 沒有抓到它。**
    //    第一版跑的是「addressId 壞掉」與「happy path」⇒ **那兩條路一行 log 都沒有**
    //    ⇒ 捕捉到的字串長度實測 = **0** ⇒ 它斷言的是「空字串不含祕密」= 恆真。
    //    📌 **而 L1 當時是綠的** —— 因為 L1 用自己的 `console.error` 證明「攔截器會動」,
    //       **而攔截器有沒有【對準被測的東西】是另一件事。**
    //    🔴 **「量具會動」與「量具對準了」是兩個宣稱,而一個綠的活性對照只證明前者。**
    //    ⇒ 修法兩件:①下面先斷言**捕捉到的東西非空**(對準檢查)
    //              ②驅動**真的會 log 的路**(照本檔 `#900` 那格的做法:throttle 擋下 / settle 拋錯)
    // `IN_FLIGHT` 那個 fixture 住在別的 describe 的區域裡 ⇒ 這裡自己造一份同形狀的。
    const inFlight = {
      kind: 'locked',
      reason: 'user_in_flight',
      inFlight: { orderId: 'order-in-flight-9' },
    };
    const cap = captureConsole();
    const action = await getAction();

    // 世界①:throttle 擋下 ⇒ 走 info 那條 log
    mockClaimPollSettle.mockResolvedValue(false);
    mockConfirmPayment.mockResolvedValue(inFlight);
    await action(validInput());
    // 世界②:settle 拋錯 ⇒ 走 error 那條 log
    mockClaimPollSettle.mockResolvedValue(true);
    mockSettleCharge.mockRejectedValue(new Error('boom'));
    await action(validInput());

    const out = cap.all();
    cap.restore();

    // 🔴 **對準檢查,排在斷言【之前】** —— 沒有它,上面那兩條路哪天不再 log,
    //    這一格會安靜地退化成恆真,而**顏色不會變**。
    expect(out.length, '一行 log 都沒捕捉到 ⇒ 這把尺沒有對準被測的東西,不是「沒有外洩」').toBeGreaterThan(0);

    // 🔴 怎麼會紅:任何一個【這幾條路上的】log 呼叫點把整包 input / row / error 丟進去 ⇒ 這裡紅。
    //    而它不需要那個呼叫點被列在任何白名單裡。
    for (const secret of ['prime_abc', 'D-REC-EXIST', CART_SESSION]) {
      expect(out, `祕密 ${secret} 出現在 console 輸出裡 —— 有人把它餵進了某個 log`).not.toContain(
        secret,
      );
    }
  });
});

describe('chargePaymentAction — 匯款總開關 BANK_TRANSFER_CHECKOUT_ENABLED(M-4b 段 1)', () => {
  // 🔴 這道閘擋的不是「還沒做完的功能」, 是一個**會兩邊都付錢**的洞:
  //   begin_charge_attempt 的 cart dedup 述詞看不見「unpaid + 零 attempt」的匯款單
  //   ⇒ 先建匯款單再回頭刷卡 ⇒ dedup 放行 ⇒ 一張刷卡付掉、一張等匯款。
  //   ⛔ ~~原句:「關閉條件(主視窗逐字):那個述詞看得見匯款單」~~ **那句沒錯而它不完整**
  //      ⇒ 正本改在板列 ⟦b4-BANKORDERINVISIBLE⟧:【flag 可翻 true】是三條, 不是一條。
  //      (本檔不再抄一份 —— 兩份會各說各話, 而抄的那份不會知道自己過期了。)

  it('🔴 flag off + 送 bank_transfer → fieldErrors、零 placeOrder/charge', async () => {
    mockIsBankTransferEnabled.mockReturnValue(false);
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));
    expect(res).toEqual({ fieldErrors: { paymentChannel: '請選擇付款方式' } });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
    expect(mockConfirmPayment).not.toHaveBeenCalled();
  });

  it('🟢 正對照:flag off + 送 tappay → 不被這道閘擋(照常建單)', async () => {
    // 🛑 少了這一格, 一個「無條件擋掉所有人」的閘也會讓上一格通過。
    mockIsBankTransferEnabled.mockReturnValue(false);
    const action = await getAction();
    const res = await action(validInput());
    expect(res).not.toEqual({ fieldErrors: { paymentChannel: '請選擇付款方式' } });
    expect(mockPlaceOrder).toHaveBeenCalled();
  });

  it('🔴 flag on + 送 bank_transfer → 閘讓它過去, 而它【真的建了單】', async () => {
    // ⛔ ~~原註解:「今天它仍會被 ②c prime 擋(段 1 的分岔還沒做)」~~ **那句是假的。**
    //    🔬 `validInput()` 逐字帶著 `prime: 'prime_abc'` ⇒ prime 那一格**過得去**。
    //    🔴🔴 **2026-09-05 片 1:這一格的 fixture 改成 `prime: null`, 而【斷言一個字都沒改】。**
    //      原因:片 1 之後「匯款卻帶 prime」是**明確拒絕**的(呼叫端搞錯)⇒ 舊 fixture 送的是
    //      **真實客人不會送的形狀** ⇒ 📌 **改的是 fixture 對不對, 不是把斷言放寬。**
    //      🛑 而那道 read-back 守門**仍然到得了** —— 送 `bank_transfer` + `prime:null` 而 DB 存 `tappay`
    //      的世界照樣走到它(本檔「世界②」那一格就是)。
    //    ⇒ 這一格原本通過的真正理由是 read-back 不符(預設 mock 回 'tappay')——
    //      **一個為了另一件事而紅的綠**(codex 關卡2 must-fix ②, 我核過, 它對)。
    //
    // 🛑🛑 **而拆穿它之後看到的東西比那格測試重要**:
    //    真的 DB 會把 `bank_transfer` **正確存下來** ⇒ read-back 相符 ⇒ 現行碼**繼續往下走**
    //    ⇒ 進 `confirmPayment` ⇒ 🔴 **拿客人的卡去扣一張【匯款單】的錢。**
    //    ⇒ 📌 **⇒ 所以這顆 flag 在【分岔做出來之前】不得翻 true, 而理由不只是「功能沒做完」。**
    //      板列 ⟦b4-BANKORDERINVISIBLE⟧ 的「flag 可啟用條件」逐字記著這一條。
    //
    // ✅ 本格只斷言【閘沒有擋它】+【它走到了建單】—— 那兩件是這道閘的射程, 不多不少。
    mockIsBankTransferEnabled.mockReturnValue(true);
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));
    expect(res).not.toEqual({ fieldErrors: { paymentChannel: '請選擇付款方式' } });
    expect(mockPlaceOrder).toHaveBeenCalled();
  });

  it('🔴🔴 送出與回讀【皆為 bank_transfer】⇒ 建了單, 而 TapPay 入口全部 0 次', async () => {
    // 🎯 **這一格才是那條會扣錯錢的路的守門**(codex 關卡2 R2 must-fix ②)。
    //    上一格的 fixture 回讀 `tappay` ⇒ 它停在 read-back 不符 ⇒ **走不到危險的那一段**。
    //    這一格把回讀也設成 `bank_transfer` = **真的 DB 會給的答案** ⇒ read-back 相符
    //    ⇒ 而現行碼若沒有 ⑤c 那道 fail-closed, 它會繼續走進 confirmPayment ⇒ 扣卡。
    //
    // 🛑 **突變判別**:把 charge-actions.ts 的 ⑤c 整段拿掉 ⇒ 這一格必須紅。
    //    (它是這片唯一擋得住「拿卡扣匯款單」的東西, 而它不依賴 flag / A 貼了沒 / RPC 有沒有被繞。)
    mockIsBankTransferEnabled.mockReturnValue(true);
    mockFindPaymentChannel.mockResolvedValue('bank_transfer');
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));

    expect(mockPlaceOrder).toHaveBeenCalled();
    // 🔴 三個 TapPay 入口, 一個都不准被碰。
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockSettleCharge).not.toHaveBeenCalled();
    // 🔴🔴 ⟦b4-BANKCHARGESCARD⟧ 片 1:⛔ ~~`expect(res).toMatchObject({ formError: expect.any(String) })`~~
    //    那一版只證「回了一句話」—— 而**一句「付款失敗」也會通過它**, 而那正是這一片要修的東西。
    //    ✅ 現在釘住三件:①`ok` 是 **false**(掛在 `ok:true` 上會讓 hook 顯示「付款成功」)
    //    ②判別式在 `payment` 這個與 `ok` 不同軸的欄位 ③**帶得出單號**(客人要回得到那張單)。
    // 🔴 **`displayId` 要釘【那個值】不是「是個字串」**(codex 關卡2 must-fix):
    //    `expect.any(String)` 對一個寫死 `displayId:'x'` 的實作照樣綠
    //    ⇒ 📌 證不到單號真的來自 `placed.displayId`。
    expect(res).toMatchObject({
      ok: false,
      payment: 'awaiting_remittance',
      displayId: 'PCM-2026-0001', // = mockPlaceOrder 回的那一個
      message: expect.any(String),
    });
    // 🔵 而那句話**不得**含帳號/戶名/期限 —— 那些住在 @pcm/domain 的 PCM_REMITTANCE_* 常數,
    //    由 front 片 2 的匯款資訊頁印;在這裡寫第二份 ⇒ 兩份會各自漂, 而漂掉時客人拿到錯的帳號。
    // 🔴 **釘【那三個常數本身】, 不是釘一個數字 regex**(codex 關卡2 must-fix):
    //    ⛔ ~~`not.toMatch(/\d{6,}/)`~~ ⇒ 「派達有限公司」「5 天」「2005-4027-8354」**全部通得過**。
    const msg = (res as { message: string }).message;
    expect(msg).not.toContain(PCM_REMITTANCE_ACCOUNT_NAME);
    expect(msg).not.toContain(PCM_REMITTANCE_ACCOUNT_NO);
    expect(msg).not.toContain(String(PCM_REMITTANCE_EXPIRE_DAYS));
    // 🔵 自檢:這把尺對一段【真的含有它們】的字串要抓得到(否則上面三行可能恆真)
    expect(`x${PCM_REMITTANCE_ACCOUNT_NAME}y`).toContain(PCM_REMITTANCE_ACCOUNT_NAME);
  });

  /**
   * 🔴🔴 **prime 那一關原本【無條件】跑, 而它排在 channel 分岔之前。**
   * 失敗情境:client 送 `paymentChannel:'bank_transfer'` + `prime: null`
   * ⇒ 客人讀到「**付款資訊缺失,請重新進行刷卡**」⇒ 📌 **他選的是匯款, 而畫面叫他去修卡片。**
   * (front 那條線量到、兩片都沒認領;主視窗 2026-09-05 裁歸片 1。)
   */
  it('🔴 匯款 + prime 為 null ⇒ 走得過 prime 那一關(不再拿刷卡的錯誤訊息擋他)', async () => {
    mockIsBankTransferEnabled.mockReturnValue(true);
    mockFindPaymentChannel.mockResolvedValue('bank_transfer');
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));
    expect(res).toMatchObject({ ok: false, payment: 'awaiting_remittance' });
    // 🛑 而那句刷卡文案一個字都不准出現
    expect(JSON.stringify(res)).not.toContain('重新進行刷卡');
  });

  it('🔴🔴 匯款【帶了】prime(= 今天真實呼叫端的樣子)⇒ 照樣建單、照樣零扣款', async () => {
    // ⛔ ~~第一版斷言「帶了就拒」~~ 🛑 **那會把這整片變成死的**:唯一呼叫端
    //    `CheckoutView.tsx:278` **不分 channel 一律取 prime** 並送出(該檔自己寫著那是暫時的)
    //    ⇒ 拒它 ⇒ **匯款單一張都建不出來** ⇒ Sean 已拍板接受的形狀(單建好、零扣款)當場消失。
    //    (code-reviewer 2026-09-05 must-fix。)
    // ✅ **對存在寬容、對使用嚴格**:prime 在也不用它 ⇒ 兩半誰先上線都不會壞。
    mockIsBankTransferEnabled.mockReturnValue(true);
    mockFindPaymentChannel.mockResolvedValue('bank_transfer');
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: 'prime_abc' }));
    expect(mockPlaceOrder).toHaveBeenCalled();
    expect(res).toMatchObject({ ok: false, payment: 'awaiting_remittance' });
    // 🔴 而那張卡**一次都不准被碰** —— 這才是「對使用嚴格」那一半。
    expect(mockConfirmPayment).not.toHaveBeenCalled();
    expect(mockInitiatePayment).not.toHaveBeenCalled();
    expect(mockSettleCharge).not.toHaveBeenCalled();
  });

  it('🟢 正對照:刷卡而缺 prime ⇒ 仍然拒(那道保護不得因為本次改動而鬆掉)', async () => {
    // 🛑 少了這格, 一個「把 prime 那一關整個拿掉」的實作也會讓上面兩格全綠。
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'tappay', prime: null }));
    expect(res).toMatchObject({ formError: '付款資訊缺失,請重新進行刷卡' });
    expect(mockPlaceOrder).not.toHaveBeenCalled();
  });

  it('🔵 負對照:同一發把回讀設回 tappay ⇒ 【不是】那個終態(證明上面那格不是恆真)', async () => {
    mockIsBankTransferEnabled.mockReturnValue(true);
    mockFindPaymentChannel.mockResolvedValue('tappay');
    const action = await getAction();
    const res = await action(validInput({ paymentChannel: 'bank_transfer', prime: null }));
    expect(res).not.toMatchObject({ payment: 'awaiting_remittance' });
  });
});
