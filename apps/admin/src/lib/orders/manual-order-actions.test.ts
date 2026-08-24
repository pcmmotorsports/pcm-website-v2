import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  createManualOrder: vi.fn(),
  parseManualOrderForm: vi.fn(),
  // 🔴 真實作要從 mock factory 的 `importOriginal` 拿, **不能** 從被 mock 的模組 import ——
  //    那樣拿到的是 mock 自己(我第一版就是這樣,結果 parse 回 undefined、10 格連鎖紅)。
  realParse: { fn: null as null | typeof import('./manual-order-form').parseManualOrderForm },
  revalidateOrderViews: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('./order-revalidate', () => ({ revalidateOrderViews: mocks.revalidateOrderViews }));

// 🔴 **redirect mock 必須像 Next 真實行為一樣拋**(體例沿用 `cancel-actions.test.ts`):
//    純 `vi.fn()` 不拋 ⇒ 把 `redirect()` 搬到 revalidate / log **之前**整份測試照樣全綠,
//    而正式環境會當場跳出、那兩件事都不會發生。
class NextRedirectError extends Error {
  constructor() {
    super('NEXT_REDIRECT');
    this.name = 'NEXT_REDIRECT';
  }
}
// 🔴 `RedirectType` **也要 mock**:source 用 `redirect(url, RedirectType.replace)`,
//    只 mock `redirect` 會讓它是 undefined、當場 TypeError —— 而那個錯會被讀成「有拋 = 有導頁」而假綠。
vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  RedirectType: { push: 'push', replace: 'replace' },
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('./manual-order-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-order-repository')>();
  return { ...actual, createManualOrder: mocks.createManualOrder };
});

// 🔴 **解析器【包一層 spy 但仍走真實作】**,不是換掉它:
//    · 不換掉 ⇒ 「爛表單擋得住」不會變成恆真斷言(前例 `cancel-actions.test.ts:41`)
//    · 包 spy ⇒ **「授權閘有沒有排在讀欄位之前」才量得到**
//    🔴 這一層是補上來的:第一版沒有它,而突變「把授權閘移到解析之後」⇒ **20 格全綠**
//       —— 兩個世界印同一句話,那格斷言對這條性質零判別力。
vi.mock('./manual-order-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-order-form')>();
  mocks.realParse.fn = actual.parseManualOrderForm;
  return { ...actual, parseManualOrderForm: mocks.parseManualOrderForm };
});
import { MANUAL_ORDER_PATH } from './manual-order-action-state';
import { createManualOrderAction } from './manual-order-actions';
import {
  MANUAL_ORDER_CUSTOMER_FIELD,
  MANUAL_ORDER_LINE_FIELD,
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_REQUEST_ID_FIELD,
  MANUAL_ORDER_SHIPPING_FEE_FIELD,
  MANUAL_ORDER_SHIPPING_METHOD_FIELD,
  MANUAL_ORDER_SHIP_TO_LINE_FIELD,
  MANUAL_ORDER_SHIP_TO_NAME_FIELD,
  MANUAL_ORDER_SHIP_TO_PHONE_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
  MANUAL_ORDER_INVOICE_TYPE_FIELD,
} from './manual-order-form';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = '22222222-2222-4222-8222-222222222222';
const VARIANT = '33333333-3333-4333-8333-333333333333';
const ORDER_ID = '44444444-4444-4444-4444-444444444444';
const ACTOR = 'alice';

const LINE = JSON.stringify({
  sku: 'PCM-001',
  title: '排氣管',
  qty: 2,
  unit_price: 12000,
  variant_id: VARIANT,
  spec: { color: '黑' },
});

function base(over: Array<[string, string]> = []): FormData {
  const fd = new FormData();
  const rows: Array<[string, string]> = [
    [MANUAL_ORDER_REQUEST_ID_FIELD, REQUEST_ID],
    [MANUAL_ORDER_CUSTOMER_FIELD, CUSTOMER],
    [MANUAL_ORDER_SOURCE_FIELD, 'manual_phone'],
    [MANUAL_ORDER_PAYMENT_CHANNEL_FIELD, 'bank_transfer'],
    [MANUAL_ORDER_SHIPPING_METHOD_FIELD, 'home'],
    [MANUAL_ORDER_SHIPPING_FEE_FIELD, '150'],
    [MANUAL_ORDER_SHIP_TO_NAME_FIELD, '王小明'],
    [MANUAL_ORDER_SHIP_TO_PHONE_FIELD, '0912345678'],
    [MANUAL_ORDER_SHIP_TO_LINE_FIELD, '台北市中正區某路 1 號'],
    [MANUAL_ORDER_INVOICE_TYPE_FIELD, 'personal'],
    [MANUAL_ORDER_LINE_FIELD, LINE],
  ];
  for (const [k, v] of [...rows, ...over]) fd.append(k, v);
  return fd;
}

/** 跑 action 並吃掉 `NEXT_REDIRECT`;其他拋出物一律原樣往外(不准被吞)。 */
async function run(fd: FormData): Promise<void> {
  try {
    await createManualOrderAction(fd);
  } catch (e) {
    if ((e as Error)?.name !== 'NEXT_REDIRECT') throw e;
  }
}

function lastRedirect(): [string, string] {
  const call = mocks.redirect.mock.calls.at(-1);
  return [call?.[0] as string, call?.[1] as string];
}

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: ACTOR });
  mocks.getRequestId.mockResolvedValue('req-abc');
  // 走真實作 ⇒ 解析行為不被假造;只是讓「它何時被呼叫」變得量得到。
  mocks.parseManualOrderForm.mockImplementation((fd) => mocks.realParse.fn!(fd));
  mocks.createManualOrder.mockResolvedValue({
    ok: true,
    orderId: ORDER_ID,
    displayId: 'PCM-20260824-0001',
    idempotent: false,
  });
  mocks.redirect.mockImplementation(() => {
    throw new NextRedirectError();
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('🔴 授權閘絕對第一', () => {
  it('未授權 ⇒ denied,而且**一個欄位都沒讀、RPC 沒被呼叫**', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await run(base());
    expect(mocks.createManualOrder).not.toHaveBeenCalled();
    expect(lastRedirect()[0]).toContain('r=manual_order_denied');
  });

  it('🔴🔴 授權**之前**一個欄位都不准讀 —— 量的是呼叫順序,不是結果碼', async () => {
    // 🔴 只看結果碼的話,把授權閘移到解析之後**兩個世界印同一句話**(實測:20 格全綠)。
    //    ⇒ 這一格量的是 `authorizeAdminMutation` 與 `parseManualOrderForm` 的呼叫先後。
    await run(base());
    expect(mocks.parseManualOrderForm).toHaveBeenCalledTimes(1);
    const authAt = mocks.authorizeAdminMutation.mock.invocationCallOrder[0]!;
    const parseAt = mocks.parseManualOrderForm.mock.invocationCallOrder[0]!;
    expect(authAt).toBeLessThan(parseAt);
  });

  it('🔴 未授權 ⇒ 解析器**一次都沒被呼叫**(不是「呼叫了但結果沒用」)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await run(base());
    expect(mocks.parseManualOrderForm).not.toHaveBeenCalled();
  });

  it('🔴 未授權 + 爛表單 ⇒ 仍是 denied 不是 invalid(否則對未授權者洩漏表單規則)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const fd = new FormData(); // 什麼都沒有
    await run(fd);
    expect(lastRedirect()[0]).toContain('r=manual_order_denied');
    expect(lastRedirect()[0]).not.toContain('invalid');
  });
});

describe('🔴🔴 actor 只有一個來源 —— 這是本片的承重格', () => {
  it('actor = authorizeAdminMutation().actorId', async () => {
    await run(base());
    expect(mocks.createManualOrder).toHaveBeenCalledWith({
      values: expect.objectContaining({ manualRequestId: REQUEST_ID, customerUserId: CUSTOMER }),
      actor: ACTOR,
    });
  });

  it('🔴 表單自己塞 actor 欄位 ⇒ **送出去的仍是授權那個**', async () => {
    // 這一格是 plan §8 條 3 的靶:把 action 改成讀 FormData 的 actor ⇒ 它必須紅。
    await run(
      base([
        ['actor', 'mallory'],
        ['p_actor', 'mallory'],
        ['actor_id', 'mallory'],
      ]),
    );
    const arg = mocks.createManualOrder.mock.calls[0]![0] as { actor: string; values: unknown };
    expect(arg.actor).toBe(ACTOR);
    // 負對照:那個字串**不得**出現在整包送出去的東西裡的任何角落
    expect(JSON.stringify(arg)).not.toContain('mallory');
  });
});

describe('表單形狀不合 ⇒ invalid,而理由只進 log', () => {
  it('缺客人 ⇒ invalid、RPC 沒被呼叫', async () => {
    const fd = base();
    fd.delete(MANUAL_ORDER_CUSTOMER_FIELD);
    await run(fd);
    expect(mocks.createManualOrder).not.toHaveBeenCalled();
    expect(lastRedirect()[0]).toContain('r=manual_order_invalid');
  });

  it('🔴 員工打的值**不得**進 URL(URL 是任何人都能自己打的字)', async () => {
    const fd = base([[MANUAL_ORDER_SHIP_TO_NAME_FIELD, '王小明']]);
    fd.delete(MANUAL_ORDER_CUSTOMER_FIELD);
    await run(fd);
    expect(lastRedirect()[0]).not.toContain('王小明');
    expect(lastRedirect()[0]).not.toContain('0912345678');
  });

  it('🔴 負對照:合法表單**不得**被判成 invalid(少了這格,「永遠 invalid」會全綠)', async () => {
    await run(base());
    expect(mocks.createManualOrder).toHaveBeenCalledTimes(1);
  });
});

describe('🔴 六個失敗碼各自導頁,而前綴讓它們不與取消片撞號', () => {
  it.each([
    ['concurrent'],
    ['mismatch'],
    ['exhausted'],
    ['rejected'],
    ['bug'],
    ['error'],
  ])('%s ⇒ r=manual_order_%s', async (code) => {
    mocks.createManualOrder.mockResolvedValue({
      ok: false,
      code,
      sqlstate: 'P858A',
      constraint: null,
      logMessage: 'boom',
    });
    await run(base());
    expect(lastRedirect()[0]).toContain(`r=manual_order_${code}`);
    expect(lastRedirect()[1]).toBe('replace');
  });

  it('🔴 失敗一定寫 log,而 log 要含 sqlstate 與冪等鍵(災難當天靠它們對回同一顆鍵)', async () => {
    mocks.createManualOrder.mockResolvedValue({
      ok: false,
      code: 'concurrent',
      sqlstate: 'P858A',
      constraint: 'pcm_858_manual_order_concurrent_request',
      logMessage: 'boom',
    });
    await run(base());
    const line = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0];
    const parsed = JSON.parse(line as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      evt: 'admin.manual_order.failed',
      code: 'concurrent',
      sqlstate: 'P858A',
      constraint: 'pcm_858_manual_order_concurrent_request',
      manualRequestId: REQUEST_ID,
    });
  });

  it('🔴 失敗**不得** revalidate 之後才導頁 —— 失敗路徑根本不 revalidate', async () => {
    mocks.createManualOrder.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      constraint: null,
      logMessage: 'x',
    });
    await run(base());
    expect(mocks.revalidateOrderViews).not.toHaveBeenCalled();
  });
});

describe('🔴🔴 冪等鍵要跟著失敗導頁回去 —— 否則「再按一次送出」會建出第二張單', () => {
  it.each(['concurrent', 'mismatch', 'exhausted', 'rejected', 'bug', 'error'])(
    '%s ⇒ URL 帶 mrid = 這次用的那顆鍵',
    async (code) => {
      mocks.createManualOrder.mockResolvedValue({
        ok: false, code, sqlstate: null, constraint: null, logMessage: 'x',
      });
      await run(base());
      expect(lastRedirect()[0]).toContain(`mrid=${REQUEST_ID}`);
    },
  );

  it('🔴 denied ⇒ **不帶** mrid(那時一個欄位都還沒讀, 手上沒有鍵)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await run(base());
    expect(lastRedirect()[0]).not.toContain('mrid');
  });

  it('🔴🔴 invalid 但鍵是合法 uuid ⇒ **要帶回去**(codex R1 must-fix)', async () => {
    // 只缺一個必填欄就換一顆新鍵的話, 另一個分頁若已用舊鍵送成功,
    // 他補完欄位再送就會建出**第二張真訂單**。
    const fd = base();
    fd.delete(MANUAL_ORDER_CUSTOMER_FIELD);
    await run(fd);
    expect(lastRedirect()[0]).toContain(`mrid=${REQUEST_ID}`);
  });

  it('🔴 負對照:鍵不是 uuid ⇒ **不帶**(RPC 對非 uuid 一律拒, 帶回去只是製造下一次失敗)', async () => {
    const fd = base();
    fd.delete(MANUAL_ORDER_CUSTOMER_FIELD);
    fd.set(MANUAL_ORDER_REQUEST_ID_FIELD, 'not-a-uuid');
    await run(fd);
    expect(lastRedirect()[0]).not.toContain('mrid');
  });

  it('🔴 負對照:成功路徑導去訂單頁, **不帶** r 也不帶 mrid', async () => {
    await run(base());
    expect(lastRedirect()[0]).not.toContain('mrid');
    expect(lastRedirect()[0]).not.toContain('r=manual_order');
  });
});

describe('🔴🔴 rejected 的訊息本文不進 log —— 它會逐字引用員工填的那一列(codex R1 must-fix)', () => {
  it('rejected ⇒ log 裡沒有 RPC 的訊息本文', async () => {
    // 手動單的自由品名可能是「王小明 0912345678」⇒ RPC 把它放進 exception message
    // ⇒ 照記就是把客人資料送進 Vercel log。**不讀 details/hint 擋不到這一格。**
    mocks.createManualOrder.mockResolvedValue({
      ok: false, code: 'rejected', sqlstate: 'P0001',
      constraint: null, logMessage: '品項 [王小明 0912345678] 的單價不正確',
    });
    await run(base());
    const line = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0];
    expect(String(line)).not.toContain('王小明');
    expect(String(line)).not.toContain('0912345678');
  });

  it.each([
    ['22P02', 'error'],
    ['22003', 'bug'],
    ['P0001', 'rejected'],
    [null, 'error'],
  ])('🔴🔴 sqlstate %s ⇒ **不記訊息本文**(codex R2:只遮 rejected 不夠)', async (sqlstate, code) => {
    // R2 抓到:RPC 的型別轉換會讓 22P02 / 22003 的訊息也引用原始輸入,
    // 而 repository 把它們歸到 error / bug ⇒ 只遮 rejected 擋不到。
    mocks.createManualOrder.mockResolvedValue({
      ok: false, code, sqlstate, constraint: null, logMessage: '品項 [王小明 0912345678] 有問題',
    });
    await run(base());
    const line = String((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0]);
    expect(line).not.toContain('王小明');
    // 🔴 而 sqlstate 仍要在 —— 遮訊息不等於什麼都不記
    expect(line).toContain(sqlstate === null ? '"sqlstate":null' : String(sqlstate));
  });

  it('🔴 負對照:白名單那兩支【照記】—— 它們是我們自己 RAISE 的固定句, 逐字讀過', async () => {
    for (const sqlstate of ['P858A', 'P858B']) {
      mocks.createManualOrder.mockResolvedValue({
        ok: false, code: 'concurrent', sqlstate,
        constraint: null, logMessage: '這個系統訊息不含員工輸入',
      });
      await run(base());
      const line = (console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls.at(-1)![0];
      expect(String(line)).toContain('這個系統訊息不含員工輸入');
    }
  });
});

describe('成功', () => {
  it('導去那張單、replace、而且先 revalidate 再導頁', async () => {
    await run(base());
    expect(mocks.revalidateOrderViews).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: ORDER_ID, scope: 'manual-order', requestId: 'req-abc' }),
    );
    expect(lastRedirect()).toEqual([`/orders/${ORDER_ID}`, 'replace']);
  });

  it('🔴 `redirect` 排在 `revalidate` **之後**(mock 會拋 ⇒ 順序寫反的話 revalidate 收不到呼叫)', async () => {
    await run(base());
    const revalidateAt = mocks.revalidateOrderViews.mock.invocationCallOrder[0]!;
    const redirectAt = mocks.redirect.mock.invocationCallOrder.at(-1)!;
    expect(revalidateAt).toBeLessThan(redirectAt);
  });

  it('🔴 idempotent:true 走**同一條路**(它不是第二張單,不要給他不同的畫面)', async () => {
    mocks.createManualOrder.mockResolvedValue({
      ok: true,
      orderId: ORDER_ID,
      displayId: 'PCM-20260824-0001',
      idempotent: true,
    });
    await run(base());
    expect(lastRedirect()).toEqual([`/orders/${ORDER_ID}`, 'replace']);
  });
});

describe('🔴 主流程一行 try 都沒有 —— repository 拋的話要原樣往外', () => {
  it('repository 拋 ⇒ action 不吞(它的契約是永不 throw;真的拋了代表契約破了,要 fail-loud)', async () => {
    mocks.createManualOrder.mockRejectedValue(new Error('契約破了'));
    await expect(createManualOrderAction(base())).rejects.toThrow('契約破了');
  });
});

describe('導頁目標', () => {
  it('失敗一律導回表單頁,不是 /orders', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await run(base());
    expect(lastRedirect()[0].startsWith(MANUAL_ORDER_PATH)).toBe(true);
  });
});
