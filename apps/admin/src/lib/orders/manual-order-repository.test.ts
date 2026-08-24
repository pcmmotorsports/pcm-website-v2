import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// 🔴 **factory 本身也要可配置成會拋**(體例沿用 `cancel-repository.test.ts`):
//    寫死成 `() => ({rpc})` 的話,把 `createSupabaseServiceClient()` 移到 try **外面**
//    整份測試照樣全綠 —— 而正式環境缺 env 時它就是在那裡拋。
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: mocks.createClient,
}));

import {
  createManualOrder,
  DISPLAY_ID_EXHAUSTED_TOKEN,
  type CreateManualOrderArgs,
} from './manual-order-repository';
import type { ManualOrderValues } from './manual-order-form';

// M12-A1:`admin_create_manual_order`(#858)唯一呼叫端。
// 🔴 誠實邊界:本檔全是 mock ⇒ 證的是「呼叫端把契約接對了」,**不是** RPC 在正式站的行為。
//    RPC 那一側由 `docs/probes/2026-08-24-858-*.sql` 的手動負測驗(而那些**沒有自動化在跑**)。

const CUSTOMER = '11111111-2222-3333-4444-555555555555';
const REQUEST_ID = '99999999-8888-7777-6666-555555555555';
const ORDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

const VALUES: ManualOrderValues = {
  customerUserId: CUSTOMER,
  manualRequestId: REQUEST_ID,
  orderSource: 'manual_phone',
  paymentChannel: 'bank_transfer',
  shippingMethod: 'home',
  shipTo: { name: '王小明', phone: '0912345678', line: '台北市中山區某路 1 號' },
  invoice: { type: 'personal', carrier: '/ABC1234' },
  shippingFee: 100,
  lines: [
    { sku: 'RPM-001', title: '碳纖維車台護蓋', qty: 2, unit_price: 14600, variant_id: null, spec: {} },
  ],
};

const ARGS: CreateManualOrderArgs = { values: VALUES, actor: 'sean' };

/** 合法的成功 payload。逐格覆寫用來造負測。 */
function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { order_id: ORDER_ID, display_id: 'PCM-20260824-0001', idempotent: false, ...over };
}

/** PostgrestError 形狀(**普通物件,不是 Error 實例**)。 */
function pgError(over: Record<string, unknown>): Record<string, unknown> {
  return { message: 'boom', details: '不該被讀到的 DETAIL', hint: '不該被讀到的 HINT', ...over };
}

beforeEach(() => {
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('createManualOrder — wire(逐欄具名送、不 spread)', () => {
  it('十個參數逐欄具名、深度相等,函式名逐字 admin_create_manual_order', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder(ARGS);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_create_manual_order', {
      p_customer_user_id: CUSTOMER,
      p_manual_request_id: REQUEST_ID,
      p_actor: 'sean',
      p_order_source: 'manual_phone',
      p_payment_channel: 'bank_transfer',
      p_shipping_method: 'home',
      p_ship_to: { name: '王小明', phone: '0912345678', line: '台北市中山區某路 1 號' },
      p_invoice: { type: 'personal', carrier: '/ABC1234' },
      p_shipping_fee: 100,
      p_lines: VALUES.lines,
    });
  });

  it('🔴 actor 走 args.actor,**不是**從 values 裡撈(values 上根本沒有那一格)', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder({ values: VALUES, actor: 'someone-else' });
    expect(mocks.rpc.mock.calls[0]![1]).toMatchObject({ p_actor: 'someone-else' });
    // 負對照:actor 不得洩進任何一個 payload 欄位(否則它會進內容指紋)
    const sent = JSON.stringify(mocks.rpc.mock.calls[0]![1]);
    expect(sent.split('someone-else').length - 1).toBe(1);
  });
});

describe('createManualOrder — 成功', () => {
  it('回 order_id / display_id / idempotent 三格', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await expect(createManualOrder(ARGS)).resolves.toEqual({
      ok: true,
      orderId: ORDER_ID,
      displayId: 'PCM-20260824-0001',
      idempotent: false,
    });
  });

  it('idempotent:true 原樣遞出(**這不是建了第二張**)', async () => {
    mocks.rpc.mockResolvedValue({ data: payload({ idempotent: true }), error: null });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: true, idempotent: true });
  });
});

describe('🔴 三個合約碼 —— 它們的下一步互不相同,所以必須分得出來', () => {
  it('P858A ⇒ concurrent(保留同一顆 id 原樣重送)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: pgError({ code: 'P858A', constraint: 'pcm_858_manual_order_concurrent_request' }),
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({
      ok: false,
      code: 'concurrent',
      sqlstate: 'P858A',
      constraint: 'pcm_858_manual_order_concurrent_request',
    });
  });

  it('P858B ⇒ mismatch(**不要重送**)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: pgError({ code: 'P858B', constraint: 'pcm_858_manual_order_payload_mismatch' }),
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({
      ok: false,
      code: 'mismatch',
      sqlstate: 'P858B',
      constraint: 'pcm_858_manual_order_payload_mismatch',
    });
  });

  it('🔴 分類【不依賴 constraint】—— 拿掉那個欄位,碼仍然要對', async () => {
    // 理由:PostgREST 有沒有把 constraint 放進錯誤物件, **沒有人量過**。
    // 它是 null 時若分類就跟著壞掉, 那是把合約押在一個未確認的欄位上。
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code: 'P858A' }) });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'concurrent', constraint: null });
  });
});

describe('🔴 P0001 是兩義的 —— 只看碼會把「產號用盡」講成「你的輸入有問題」', () => {
  it('訊息含 pcm_display_id_exhausted ⇒ exhausted', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: pgError({
        code: 'P0001',
        message: 'admin_create_manual_order: 產不出單號 (pcm_display_id_exhausted)',
      }),
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'exhausted', sqlstate: 'P0001' });
  });

  it('其餘 P0001 ⇒ rejected(RPC 的訊息本來就是寫給員工看的)', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: pgError({ code: 'P0001', message: 'admin_create_manual_order: 找不到這位客人' }),
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'rejected', sqlstate: 'P0001' });
  });

  it('🔴 釘住那個字串 —— RPC 那句訊息被改掉時,這一格要紅', async () => {
    // 少了這一格, RPC 改訊息 ⇒ 上面那格【靜靜地】改走 rejected,
    // 而 rejected 的畫面會叫員工「看訊息自己改」—— 他改不動, 那不是他輸入的問題。
    expect(DISPLAY_ID_EXHAUSTED_TOKEN).toBe('pcm_display_id_exhausted');
  });
});

describe('createManualOrder — 其餘失敗路徑', () => {
  it.each([
    ['23514', 'bug'],
    ['23505', 'bug'],
    ['22003', 'bug'],
    ['42501', 'bug'],
    ['PGRST202', 'bug'],
    ['55P03', 'error'],
    ['40P01', 'error'],
  ])('SQLSTATE %s ⇒ %s', async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code }) });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: expected, sqlstate: code });
  });

  it('未知碼 ⇒ error(**不是** rejected:我們不知道它是什麼,最保守的畫面才對)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code: 'XX999' }) });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'error', sqlstate: 'XX999' });
  });

  it('🔴 code 是 `constructor` 也不會取到原型鏈上的函式(Map 不是物件字面)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code: 'constructor' }) });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'error' });
  });

  it('code 不是字串 ⇒ sqlstate null、code error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code: 42 }) });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'error', sqlstate: null });
  });
});

describe('🔴 永不 throw', () => {
  it('rpc 拋 ⇒ 回 error,不往外拋', async () => {
    mocks.rpc.mockRejectedValue(new Error('socket hang up'));
    const out = await createManualOrder(ARGS);
    expect(out).toEqual({
      ok: false,
      code: 'error',
      sqlstate: null,
      constraint: null,
      logMessage: 'socket hang up',
    });
  });

  it('🔴 建 client 就拋(缺 env)⇒ 也要回 error —— 這格釘住 client 建在 try 【裡面】', async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error('SUPABASE_SERVICE_ROLE_KEY 未設定');
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'error' });
  });

  it('🔴 拋出物件即使帶 code 也不查表(那是「回應遺失」,不是「你的輸入有問題」)', async () => {
    mocks.rpc.mockRejectedValue({ code: 'P0001', message: 'x' });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'error', sqlstate: null });
  });
});

describe('🔴 只遞出 message,不遞 details / hint(它們會帶整列客人資料)', () => {
  it('logMessage 不含 DETAIL / HINT', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: pgError({ code: 'P0001', message: '客人不存在' }),
    });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, logMessage: '客人不存在' });
    expect((out as { logMessage: string }).logMessage).not.toContain('DETAIL');
    expect((out as { logMessage: string }).logMessage).not.toContain('HINT');
  });

  it('message 超長 ⇒ 截到 200 字', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: pgError({ code: 'P0001', message: 'あ'.repeat(500) }) });
    const out = await createManualOrder(ARGS);
    expect((out as { logMessage: string }).logMessage).toHaveLength(200);
  });
});

describe('🔴 成功 payload 形狀漂移 ⇒ bug,而 log 只記鍵名與型別、不記值', () => {
  it.each([
    ['多一個鍵', payload({ extra: 1 })],
    ['少一個鍵', { order_id: ORDER_ID, display_id: 'X' }],
    ['order_id 不是 uuid', payload({ order_id: 'not-a-uuid' })],
    ['display_id 空字串', payload({ display_id: '' })],
    ['idempotent 不是 boolean', payload({ idempotent: 'false' })],
    ['是陣列', [payload()]],
    ['是 null', null],
    ['是字串', 'ok'],
  ])('%s ⇒ bug', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const out = await createManualOrder(ARGS);
    expect(out).toMatchObject({ ok: false, code: 'bug' });
  });

  it('🔴 負對照:合法 payload **不得**被判成漂移(少了這格,「永遠 bug」會全綠)', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await expect(createManualOrder(ARGS)).resolves.toMatchObject({ ok: true });
  });

  it('漂移的 log 含鍵名與型別、**不含客人的值**', async () => {
    mocks.rpc.mockResolvedValue({
      data: { order_id: ORDER_ID, display_id: 'X', idempotent: false, ship_to_name: '王小明' },
      error: null,
    });
    const out = await createManualOrder(ARGS);
    const log = (out as { logMessage: string }).logMessage;
    expect(log).toContain('ship_to_name:string');
    expect(log).not.toContain('王小明');
  });
});
