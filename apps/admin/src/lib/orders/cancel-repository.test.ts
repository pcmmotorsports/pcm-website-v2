import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// 🔴 **factory 本身也要可配置成會拋**(關卡2 codex must-fix):寫死成 `() => ({rpc})` 的話,
//    把 `createSupabaseServiceClient()` 移到 try **外面**整份測試照樣全綠 ——
//    而正式環境缺 env 時它就是在那裡拋,repository 的「永不 throw」契約當場破功。
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: mocks.createClient,
}));

import { cancelOrder, type CancelOrderArgs } from './cancel-repository';

// M-4b E10 A9d2-2b:`admin_cancel_order` 唯一呼叫端。
// 🔴 誠實邊界:本檔全是 mock ⇒ 證的是「呼叫端把契約接對了」,不是「RPC 在正式站的行為」。

const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const TOKEN = '99999999-8888-7777-6666-555555555555';
const CANCELLATION_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const ARGS: CancelOrderArgs = {
  orderId: ORDER_ID,
  reasonCode: 'out_of_stock',
  reasonDetail: null,
  items: null,
  actor: 'sean',
  requestToken: TOKEN,
};

/** 合法的成功 payload。逐格覆寫用來造負測。 */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cancelled: true,
    cancellation_id: CANCELLATION_ID,
    idempotent: false,
    closed: true,
    ...over,
  };
}

beforeEach(() => {
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('cancelOrder — wire(plan §2 慣例 4:逐欄具名送、不 spread)', () => {
  it('整單取消:六參數深度相等,`p_items` 送 null', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await cancelOrder(ARGS);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_cancel_order', {
      p_order_id: ORDER_ID,
      p_reason_code: 'out_of_stock',
      p_reason_detail: null,
      p_items: null,
      p_actor: 'sean',
      p_idempotency_key: TOKEN,
    });
  });

  it('部分取消 + other 說明:品項陣列與說明原樣送達(改寫內容會讓重送撞 payload_hash)', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    const items = [
      { order_item_id: 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff', quantity: 2 },
      { order_item_id: 'cccccccc-dddd-eeee-ffff-000000000000', quantity: 1 },
    ];
    await cancelOrder({
      ...ARGS,
      reasonCode: 'other',
      reasonDetail: '  客人改買別款  ',
      items,
    });
    // 🔴 **恰呼一次**(關卡2 codex must-fix):只斷言「曾有正確的那一次呼叫」的話,
    //    多打一次(換新 uuid)整份測試照樣全綠,而帳本會真的多一筆。
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_cancel_order', {
      p_order_id: ORDER_ID,
      p_reason_code: 'other',
      // 🔴 **未 btrim** —— RPC 的 payload_hash 量的是它自己 btrim 後的原文;
      //    這層先改寫,員工原封不動重送反而會被判「內容不符」。
      p_reason_detail: '  客人改買別款  ',
      p_items: items,
      p_actor: 'sean',
      p_idempotency_key: TOKEN,
    });
  });

  it('成功 payload → 逐欄翻成 outcome', async () => {
    mocks.rpc.mockResolvedValue({
      data: payload({ idempotent: true, closed: false }),
      error: null,
    });
    await expect(cancelOrder(ARGS)).resolves.toEqual({
      ok: true,
      cancellationId: CANCELLATION_ID,
      idempotent: true,
      closed: false,
    });
  });
});

describe('cancelOrder — 成功 payload 形狀全集(plan §4.1 五條逐條)', () => {
  // 🔴 這一族全部歸 `bug`,而 `bug` 的員工訊息是「可能已經寫進去了」—— 那不是保守措辭:
  //    形狀驗證發生在 RPC 成功 RETURN **之後**,這一支真的已經 commit 了
  //    (逐支歸類見 `cancel-action-state.ts:64-70`)。
  const badShapes: Array<[string, unknown]> = [
    ['① 非 object:字串', 'CANCELLED'],
    ['① 非 object:數字', 1],
    ['① null', null],
    ['① 陣列(typeof 也是 object,所以要單獨擋)', [payload()]],
    ['② 多一鍵(RPC 日後加欄要轉紅、不是靜默忽略)', payload({ refunded: false })],
    ['② 少一鍵:缺 closed', { cancelled: true, cancellation_id: CANCELLATION_ID, idempotent: false }],
    ['③ cancelled === false(不是 RPC 的產物)', payload({ cancelled: false })],
    ['③ cancelled 是 truthy 但非 true', payload({ cancelled: 1 })],
    ['④ cancellation_id 非字串', payload({ cancellation_id: 123 })],
    ['④ cancellation_id 非 uuid 形狀', payload({ cancellation_id: 'not-a-uuid' })],
    ['⑤ idempotent 非 boolean', payload({ idempotent: 'false' })],
    ['⑤ closed 非 boolean', payload({ closed: null })],
  ];

  for (const [label, data] of badShapes) {
    it(`${label} → bug`, async () => {
      mocks.rpc.mockResolvedValue({ data, error: null });
      const outcome = await cancelOrder(ARGS);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('bug');
      expect(outcome.logMessage).toContain('形狀漂移');
    });
  }

  // 🔴 code-reviewer nit:`.sort()` 拿掉後整份測試照樣全綠 —— 因為每個 fixture 都是同一個
  //    字面序。真的 jsonb **不會**照這個序回來(PG 的 jsonb 鍵序 = 先長度再位元組,
  //    這四個鍵的真實序是 `closed, cancelled, idempotent, cancellation_id`)。
  //    本格用那個真實序建一份合法 payload:拿掉 `.sort()` 它就紅。
  it('🔴 鍵序與字面序不同的合法 payload(= 真 jsonb 的樣子)照樣通過', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        closed: true,
        cancelled: true,
        idempotent: false,
        cancellation_id: CANCELLATION_ID,
      },
      error: null,
    });
    await expect(cancelOrder(ARGS)).resolves.toMatchObject({ ok: true });
  });

  it('🔴 鍵集合是**恰等**不是包含:少一鍵與多一鍵都不得放行', async () => {
    // 這條與上面兩格重複是刻意的:它釘的是「用 sort().join() 比對」這個實作選擇本身。
    // 若日後有人改成 `keys.includes(...)` 的寫法,上面那兩格仍會紅,但**理由**會消失。
    mocks.rpc.mockResolvedValue({ data: payload({ extra: 1 }), error: null });
    await expect(cancelOrder(ARGS)).resolves.toMatchObject({ ok: false, code: 'bug' });
  });
});

describe('cancelOrder — 錯誤分流(plan §4.3 表逐格)', () => {
  // 🔴 mock **必須帶真實 PostgrestError 形狀的 `code`** —— 只丟裸 Error 的話整族恆綠
  //    (前例 `note-repository.test.ts:94-114` 記錄過同一個坑)。
  const classifications: Array<[string, string]> = [
    ['P8C01', 'bug'],
    ['P0001', 'rejected'],
    ['55P03', 'retry'],
    ['40P01', 'retry'],
    ['23514', 'bug'],
    ['22003', 'bug'],
    ['42501', 'bug'],
    ['PGRST202', 'bug'],
    // 🔴 plan §4.3 的表沒有這格,是依建表檔逐字「任何 23505=真異常 fail-loud」
    //    (`20260804180000...:20-21`)補的;落進未知碼 fallback 會變成 error(語意不同)。
    ['23505', 'bug'],
  ];

  for (const [sqlstate, expected] of classifications) {
    it(`${sqlstate} → ${expected}`, async () => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: sqlstate, message: `boom ${sqlstate}`, details: null, hint: null },
      });
      await expect(cancelOrder(ARGS)).resolves.toEqual({
        ok: false,
        code: expected,
        sqlstate,
        logMessage: `boom ${sqlstate}`,
      });
    });
  }

  // 🔴 關卡2 R2 更正:標題原本寫「可能已 commit」是錯的 —— PostgREST 回得出 SQLSTATE
  //    就代表那筆交易**已中止**。歸 error 的理由是「未知分類、保守要求員工去確認」。
  it('未知 SQLSTATE → error(未知分類、保守要求確認;不是因為它可能已 commit)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '57014', message: '逾時' } });
    await expect(cancelOrder(ARGS)).resolves.toMatchObject({ code: 'error', sqlstate: '57014' });
  });

  it('error 物件沒有 code 欄 → error 且 sqlstate=null', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: '沒有 code' } });
    await expect(cancelOrder(ARGS)).resolves.toMatchObject({ code: 'error', sqlstate: null });
  });

  // 🔴 memory `reference_js-index-lookup-hits-prototype-chain`:分類表若寫成物件字面 +
  //    `TABLE[code] ?? 'error'`,這三個字串會取到原型鏈上的**函式**(truthy ⇒ `??` 接不住)
  //    ⇒ 分類結果變成一個函式、而不是四支碼之一。用 `Map` 才沒有這條路。
  //    這格拿掉 Map 換成物件字面就會紅。
  for (const hostile of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    it(`🔴 原型鏈毒字串 SQLSTATE \`${hostile}\` → error(不得取到原型上的函式)`, async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: hostile, message: 'x' } });
      const outcome = await cancelOrder(ARGS);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.code).toBe('error');
    });
  }
});

describe('cancelOrder — 拋出型失敗與 log 衛生', () => {
  it('rpc 拋出 → error(即使拋出物帶 code:P0001 也不查表)', async () => {
    // 🔴 supabase-js 對 PostgREST 的錯誤是**回傳**的;會拋的是傳輸層/環境層失敗
    //    ⇒「請求可能已到 PG 並 commit、回應斷在路上」= error 的語意。
    //    查表會把「回應遺失」講成「這張單不能取消」。
    mocks.rpc.mockRejectedValue({ code: 'P0001', message: 'fetch failed' });
    await expect(cancelOrder(ARGS)).resolves.toEqual({
      ok: false,
      code: 'error',
      sqlstate: null,
      logMessage: 'fetch failed',
    });
  });

  it('🔴 **建 client** 就炸(env 缺)也收斂成 error、不外拋', async () => {
    // 🔴 讓 **factory** 拋,不是讓 rpc 拋 —— 兩者踩的是不同行:
    //    把 `createSupabaseServiceClient()` 移出 try 只有這一格會紅。
    mocks.createClient.mockImplementation(() => {
      throw new Error('SUPABASE_SECRET_KEY 未設定');
    });
    await expect(cancelOrder(ARGS)).resolves.toMatchObject({ ok: false, code: 'error' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('🔴 logMessage 只取 message 前 200 字,**不含** details / hint', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'M'.repeat(500),
        // PG 的 DETAIL 會帶整列內容 —— 含員工打的取消說明。一個字都不能進 log。
        details: '整列內容:客人說他老婆不准他買 🏍️',
        hint: '不該出現',
      },
    });
    const outcome = await cancelOrder(ARGS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.logMessage).toHaveLength(200);
    expect(outcome.logMessage).not.toContain('老婆');
    expect(outcome.logMessage).not.toContain('不該出現');
  });

  it('形狀漂移的 logMessage 帶得出實際長相(看不到就查不下去)', async () => {
    mocks.rpc.mockResolvedValue({ data: { cancelled: true }, error: null });
    const outcome = await cancelOrder(ARGS);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // 🔴 只帶鍵名與型別、**不帶值**(值可能是 RPC 塞回來的整列內容)。
    expect(outcome.logMessage).toContain('cancelled:boolean');
    expect(outcome.logMessage).not.toContain('true');
  });
});
