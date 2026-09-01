import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('server-only', () => ({}));

// 🔴 **factory 本身也要可配置成會拋**(體例沿用 `cancel-repository.test.ts`):
//    寫死成 `() => ({rpc})` 的話,把 `createSupabaseServiceClient()` 移到 try **外面**
//    整份測試照樣全綠 —— 而正式環境缺 env 時它就是在那裡拋。
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  /** 「乙」規格權威化那一發查詢。回 `{ data, error }`。 */
  variantSelect: vi.fn(),
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

/**
 * ⟦跨檔守門⟧ `pcm_display_id_exhausted` 這個 token 是**兩側同源**的:
 * SQL 那側 `RAISE … ' (pcm_display_id_exhausted)' USING ERRCODE = 'P0001'`,
 * TS 這側 `DISPLAY_ID_EXHAUSTED_TOKEN` 拿它分辨 `exhausted` 與 `rejected`。
 *
 * 🔴 **為什麼要讀【最後一代】而不是某一支寫死的檔名**:
 *    `scripts/latest-definition-of.sh admin_create_manual_order` 2026-09-01 實跑 ⇒
 *    **3 代**(`20260824020000` create / `20260829140000` cor / `20260831180000` cor),
 *    而**跑的是最後一代**。寫死檔名 ⇒ 下一次 `CREATE OR REPLACE` 之後這道守門就量錯對象了。
 *
 * 🛑 **而【最後一代】刻意取 repo 的 `newest`, 不取帳本的 `live`** ——
 *    那支工具同一發印著 `newest = 20260831180000` 而 `live = 20260824020000`(**兩者不同**),
 *    而它自己標:`live` 答的是**帳本 `supabase/APPLIED.tsv`**, 不是正式庫 —— 那是兩個宣稱。
 *    ⇒ **本測試驗的是【repo 內兩側一致】, 不是【正式庫現在跑哪一版】** ⇒ 取 `newest`。
 *    ⚠️ ⇒ 所以它**證不到**「正式庫那支 RPC 現在真的 RAISE 這個 token」。那要連正式庫讀 `pg_proc`。
 */
const MIGRATIONS_DIR = resolve(__dirname, '../../../../../supabase/migrations');

/** 🔴 只認【行首】的 `CREATE [OR REPLACE] FUNCTION public.admin_create_manual_order(` —— 不是 substring。 */
const DEFINES_MANUAL_ORDER_RPC =
  /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.admin_create_manual_order\s*\(/m;

/**
 * 活的那一支 = 檔名序(= 時間序)最後一支。
 * 🔴 **取不到就丟** —— `undefined` 在這裡代表【尺沒接上】, 而它與「值不對」是兩件事。
 *    體例沿用同目錄 `create-order-tier-pin.test.ts`。
 */
function liveDefinerOfManualOrderRpc(): string {
  const all = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => DEFINES_MANUAL_ORDER_RPC.test(readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8')));
  const live = all.at(-1);
  if (live === undefined) {
    throw new Error('跨檔守門的尺沒接上:找不到任何一支定義 admin_create_manual_order 的 migration');
  }
  return live;
}

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
  mocks.createClient.mockReturnValue({
    rpc: mocks.rpc,
    // 🔴 鏈式:`.from(...).select(...).in(...)` ⇒ 只有最後那一段回結果。
    from: (table: string) => ({ select: () => ({ in: (_c: string, ids: string[]) => mocks.variantSelect(table, ids) }) }),
  });
  mocks.variantSelect.mockResolvedValue({ data: [], error: null });
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

  // ⛔ ~~原本這一格是 `expect(DISPLAY_ID_EXHAUSTED_TOKEN).toBe('pcm_display_id_exhausted')`~~
  //    **它的標題說「RPC 那句訊息被改掉時, 這一格要紅」, 而它做不到** ——
  //    那是拿 TS 常數去比對【它自己的一份硬抄】, 一個字都沒讀那支 migration。
  //    數法(2026-09-01 實跑):`grep -c "supabase/migrations\|readFileSync"` 於本檔 ⇒ **0**。
  //    🔴 ⇒ RPC 那句訊息被改掉時, 它**不會紅**。而標題說它會。
  //    📌 **⇒ 一支檔對它自己說謊, 而說謊的那句讀起來最像已經做到了。**
  //    ⚠️ 舊字面留在這裡不刪 —— 讓搜舊句的人同一發撞到這段更正。
  //
  // ✅ 修法是**既有慣例**, 不是新設計:同目錄 `create-order-tier-pin.test.ts:40` 起
  //    用的就是這個形狀(全 repo 43 支測試在讀 migration)。
  //
  // 🔴 **爆炸半徑**:`git grep -c pcm_display_id_exhausted -- supabase/migrations` ⇒ **8 支**
  //    (最新兩支是 2026-09-01 當天的)⇒ 那支 RPC 重定義過至少 3 代、而那個字面散在 8 支檔裡
  //    ⇒ **每一次重貼都是一次掉字面的機會, 而 TS 這側從頭到尾都是綠的。**
  it('🔴 釘住那個字串 —— 而它讀的是【最後一代 migration】, 不是自己的硬抄', () => {
    const live = liveDefinerOfManualOrderRpc();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, live), 'utf8');
    // 🟢 先證這把尺接上了:撈得到那支檔、而且它真的是定義那支 RPC 的那一支
    expect(sql.length).toBeGreaterThan(1000);
    expect(DEFINES_MANUAL_ORDER_RPC.test(sql)).toBe(true);
    // 🎯 主斷言:最後一代裡仍然 RAISE 那個 token
    // 🔴🔴 **必須連【定界字元】一起釘** —— 我第一版寫 `expect(sql).toContain(TOKEN)`,
    //    而突變(把 SQL 那側改成 `pcm_display_id_exhaustedX`)⇒ **47 格照樣全過**。
    //    成因:`toContain` 對字串是**子字串比對** ⇒ 加一個字元的那個世界仍然「包含」原 token。
    //    📌 **⇒ 我用來修一支說謊測試的那一版, 自己犯了同一個病。抓到它的是那一發突變, 不是我。**
    //    ⇒ 改成連 SQL 裡的 `' (…)'` 定界一起比:加字元 ⇒ 定界對不上 ⇒ 紅。
    expect(sql).toContain(`' (${DISPLAY_ID_EXHAUSTED_TOKEN})'`);
    // 而 TS 常數本身也釘住(舊那一格的用途, 留著 —— 它擋的是「有人改 TS 這側」)
    expect(DISPLAY_ID_EXHAUSTED_TOKEN).toBe('pcm_display_id_exhausted');
  });

  it('🔵 負對照 —— 同一把尺對一個現造 token 撈不到', () => {
    const sql = readFileSync(resolve(MIGRATIONS_DIR, liveDefinerOfManualOrderRpc()), 'utf8');
    expect(sql).not.toContain('zzq9_never_a_token');
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


// ── 🔴🔴 「乙」:規格由 server 依 variant_id 取權威值 ────────────────────────────
//  它擋的東西:A3-c 的品項列沒有規格輸入欄 ⇒ 一律送空 ⇒ 有顏色/尺寸的既有 variant
//  建出來的 `product_snapshot.spec` 永遠是 `{}` 而且**補不回來**(RPC 直接寫進不可變快照)。
//  形狀照顧客站那條路(`create_order` 逐字從 `v_variant.spec` 讀)。
describe('🔴 規格權威化(乙)', () => {
  const VARIANT = 'dddddddd-1111-2222-3333-444444444444';
  const withVariant = (spec: Record<string, string> = {}): CreateManualOrderArgs => ({
    actor: 'sean',
    values: {
      ...VALUES,
      lines: [{ sku: 'RPM-001', title: '護蓋', qty: 1, unit_price: 100, variant_id: VARIANT, spec }],
    },
  });
  const sentLines = () => (mocks.rpc.mock.calls[0]?.[1] as { p_lines: ManualOrderValues['lines'] }).p_lines;

  it('🔴 有 variant 的品項:送出去的 spec 是【DB 那份】, 不是畫面送的空的', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [{ id: VARIANT, spec: { color: '黑', size: 'M' } }], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder(withVariant());
    expect(sentLines()[0]?.spec).toEqual({ color: '黑', size: 'M' });
  });

  it('🔴🔴 畫面送了一份 spec ⇒ 【被覆蓋掉】(client 說了不算)', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [{ id: VARIANT, spec: { color: '黑' } }], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder(withVariant({ color: '我自己打的', price_store: '1' } as Record<string, string>));
    expect(sentLines()[0]?.spec).toEqual({ color: '黑' });
  });

  it('代購品項(variant_id 為 null)⇒ 維持空的, 而且【根本不打那發查詢】', async () => {
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder(ARGS);
    expect(mocks.variantSelect).not.toHaveBeenCalled();
    expect(sentLines()[0]?.spec).toEqual({});
  });

  it('🔴 查詢失敗 ⇒ 整發放棄, 【不得】就用空的先建起來', async () => {
    mocks.variantSelect.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const out = await createManualOrder(withVariant());
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('error');
    // 🔴 最承重的一格:RPC **一次都不能被呼叫** —— 不然就是「基礎設施失敗 ⇒ 一張永久缺規格的真訂單」。
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('查不到那個 variant ⇒ 不動那一列, 交給 RPC 的 FK 去拒(兩層各判一次會漂移)', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder(withVariant());
    expect(sentLines()[0]?.spec).toEqual({});
  });

  it('🔴 只查那些【真的有 variant_id】的 id, 而且去重', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [{ id: VARIANT, spec: {} }], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder({
      actor: 'sean',
      values: {
        ...VALUES,
        lines: [
          { sku: 'A', title: 'A', qty: 1, unit_price: 1, variant_id: VARIANT, spec: {} },
          { sku: 'B', title: 'B', qty: 1, unit_price: 1, variant_id: VARIANT, spec: {} },
          { sku: 'C', title: 'C', qty: 1, unit_price: 1, variant_id: null, spec: {} },
        ],
      },
    });
    expect(mocks.variantSelect).toHaveBeenCalledWith('product_variants', [VARIANT]);
  });

  // 🔴🔴 codex R1:**一發沒覆蓋而且會活著的突變** —— 把覆蓋限制成「只處理第一列」。
  //    所有單列測試照樣綠;唯一那個多列測試只驗了查詢 ID 去重, 第二列保留 client spec 也不會紅。
  it('🔴 多列各自拿到【自己那一列】的權威值(不是只有第一列被覆蓋)', async () => {
    const V2 = 'dddddddd-5555-6666-7777-888888888888';
    mocks.variantSelect.mockResolvedValue({
      data: [{ id: VARIANT, spec: { color: '黑' } }, { id: V2, spec: { color: '紅' } }],
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder({
      actor: 'sean',
      values: {
        ...VALUES,
        lines: [
          { sku: 'A', title: 'A', qty: 1, unit_price: 1, variant_id: VARIANT, spec: { color: '假的1' } },
          { sku: 'B', title: 'B', qty: 1, unit_price: 1, variant_id: V2, spec: { color: '假的2' } },
        ],
      },
    });
    expect(sentLines().map((l) => l.spec)).toEqual([{ color: '黑' }, { color: '紅' }]);
  });

  // 🔴🔴 codex R1 must-fix:表單的 `UUID_RE` 帶 `/i` ⇒ **大寫 uuid 過得了解析器**,
  //    而 PostgREST 回來的 id 一律小寫 ⇒ Map 用原字面當鍵就會 miss
  //    ⇒ `?? l.spec` 讓 client 送的**假規格原樣進 RPC**, 而 RPC 對大寫 uuid cast 成功
  //    ⇒ 一份假規格被永久寫進不可變快照, 而每一格都合法。
  it('🔴🔴 variant_id 是【大寫】uuid ⇒ 照樣拿到權威值(不得讓 client 那份活下來)', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [{ id: VARIANT, spec: { color: '黑' } }], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    await createManualOrder({
      actor: 'sean',
      values: {
        ...VALUES,
        lines: [{
          sku: 'A', title: 'A', qty: 1, unit_price: 1,
          variant_id: VARIANT.toUpperCase(), spec: { color: '我自己打的' },
        }],
      },
    });
    expect(sentLines()[0]?.spec).toEqual({ color: '黑' });
  });

  // 🔴 codex R1 must-fix:權威查詢原本在 try 外面 ⇒ 拋出型失敗直接擊破「永不 throw」合約。
  it('🔴 權威查詢【拋出】(網路斷 / 缺 env)⇒ 收斂成 error, 不得往外拋', async () => {
    mocks.variantSelect.mockImplementation(() => { throw new Error('fetch failed'); });
    const out = await createManualOrder(withVariant());
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('🔴 建 client 時就拋(缺 env)⇒ 同樣收斂, 不得往外拋', async () => {
    mocks.createClient.mockImplementation(() => { throw new Error('missing env'); });
    const out = await createManualOrder(withVariant());
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.code).toBe('error');
  });

  it('🔴 不原地改呼叫端手上那份 lines(送出去的與解析器驗過的要分得開)', async () => {
    mocks.variantSelect.mockResolvedValue({ data: [{ id: VARIANT, spec: { color: '黑' } }], error: null });
    mocks.rpc.mockResolvedValue({ data: payload(), error: null });
    const args = withVariant();
    await createManualOrder(args);
    expect(args.values.lines[0]?.spec, '呼叫端那份不該被動到').toEqual({});
  });
});
