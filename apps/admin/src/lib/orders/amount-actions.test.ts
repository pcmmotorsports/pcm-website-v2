// amount-actions.test.ts — 改品項金額 server action(M-4b E10 #13 片1c-1)。
//
// 🔴 **本檔第一格是這一片的第一個驗收條款**(plan §10-4 陷阱①):`'OK'` ⇒ `saved`。
//    相鄰 `order-actions.ts` 的成功碼是 `'UPDATED'`,照抄會讓本 RPC 的 `'OK'` 掉進
//    `: 'noop'` ⇒ 金額真的改了而員工看到「無變更」,**且不會有任何東西紅**。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  updateAdminOrderItemAmount: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
// 🔴 `redirect` 在 Next 是用 throw 實作的 —— 假的也要 throw,否則 action 會**繼續往下跑**,
//    而「redirect 之後不該執行的東西」那族斷言就變成恆真。
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('./order-repository', () => ({
  getAdminOrderRepository: () => ({ updateAdminOrderItemAmount: mocks.updateAdminOrderItemAmount }),
}));

// 🔴 解析器**刻意不 mock** —— 餵真 FormData 走真解析器,否則「爛表單擋得住」是恆真斷言。
import { updateOrderItemAmountAction } from './amount-actions';
import {
  AMOUNT_ORDER_ID_FIELD,
  AMOUNT_ORDER_ITEM_ID_FIELD,
  AMOUNT_VERSION_FIELD,
  AMOUNT_UNIT_PRICE_FIELD,
  AMOUNT_RETURN_TO_FIELD,
} from './amount-form';

const ORDER = '11111111-2222-3333-4444-555555555555';
const ITEM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DETAIL = `/orders/${ORDER}`;

function amountForm(over: Record<string, string> = {}): FormData {
  const data = new FormData();
  const fields: Record<string, string> = {
    [AMOUNT_ORDER_ID_FIELD]: ORDER,
    [AMOUNT_ORDER_ITEM_ID_FIELD]: ITEM,
    [AMOUNT_VERSION_FIELD]: '3',
    [AMOUNT_UNIT_PRICE_FIELD]: '1200',
    [AMOUNT_RETURN_TO_FIELD]: DETAIL,
    ...over,
  };
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

/** action 一定以 redirect(throw)收尾;把它接住,回被導去的網址。 */
async function runAndCatchRedirect(data: FormData): Promise<string> {
  await expect(updateOrderItemAmountAction(data)).rejects.toThrow(/NEXT_REDIRECT/);
  const last = mocks.redirect.mock.calls.at(-1);
  return String(last?.[0] ?? '');
}

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'actor-1' });
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.updateAdminOrderItemAmount.mockResolvedValue('OK');
});
afterEach(() => vi.clearAllMocks());

describe('🔴🔴 驗收條款:RPC 的三個回傳碼各自對到哪一個結果碼', () => {
  it("'OK' ⇒ saved(**不是 noop**;照抄 order-actions 的三元式就會變成 noop)", async () => {
    mocks.updateAdminOrderItemAmount.mockResolvedValue('OK');
    expect(await runAndCatchRedirect(amountForm())).toBe(`${DETAIL}?r=saved`);
  });

  it("'CONFLICT' ⇒ conflict", async () => {
    mocks.updateAdminOrderItemAmount.mockResolvedValue('CONFLICT');
    expect(await runAndCatchRedirect(amountForm())).toBe(`${DETAIL}?r=conflict`);
  });

  it("'NOOP' ⇒ noop", async () => {
    mocks.updateAdminOrderItemAmount.mockResolvedValue('NOOP');
    expect(await runAndCatchRedirect(amountForm())).toBe(`${DETAIL}?r=noop`);
  });

  it("🔴 回了預期外的碼 ⇒ error(fail-closed;**不當成成功也不當成無變更**)", async () => {
    // 型別上到不了這裡(adapter 已收斂一次),所以只能繞過型別餵 —— 這一格守的是
    // 「第二層兜底真的存在」,而它的代價是:猜錯方向會讓報告說謊。
    mocks.updateAdminOrderItemAmount.mockResolvedValue('UPDATED' as unknown as 'OK');
    expect(await runAndCatchRedirect(amountForm())).toBe(`${DETAIL}?r=error`);
  });
});

describe('授權與形狀閘', () => {
  it('未授權 ⇒ denied,且**不呼叫 RPC**', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(await runAndCatchRedirect(amountForm())).toBe('/orders?r=denied');
    expect(mocks.updateAdminOrderItemAmount).not.toHaveBeenCalled();
  });

  it('表單形狀錯(單價非整數)⇒ invalid,且**不呼叫 RPC**', async () => {
    expect(await runAndCatchRedirect(amountForm({ [AMOUNT_UNIT_PRICE_FIELD]: '12.5' }))).toBe(
      '/orders?r=invalid',
    );
    expect(mocks.updateAdminOrderItemAmount).not.toHaveBeenCalled();
  });

  it('🔴 error log 不得含 RPC 訊息(codex R1 MF2:截短不是脫敏)', async () => {
    // RPC `:372` 會把**收到的原因字串**內插進訊息,而那是員工打的字、可能含客人資訊。
    const secret = '客人 0912-345-678 說要送贈品';
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.updateAdminOrderItemAmount.mockRejectedValue(
      Object.assign(new Error(`單價不是 0 時不得帶「零元原因」(收到:${secret})`), { code: 'P2C13' }),
    );
    await runAndCatchRedirect(amountForm());

    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('零元原因'); // 連訊息開頭都不留 —— 截短救不了
    expect(logged).toContain('P2C13'); // 但 code 要留,不然出事查不到
    expect(logged).toContain('req-1');
    spy.mockRestore();
  });

  it('RPC throw(16 種 RAISE 全走這條)⇒ error,且導回 return_to 不是列表', async () => {
    mocks.updateAdminOrderItemAmount.mockRejectedValue(
      Object.assign(new Error('這張單已經有收款紀錄(2 筆)'), { code: 'P2C13' }),
    );
    expect(await runAndCatchRedirect(amountForm())).toBe(`${DETAIL}?r=error`);
  });
});

describe('送進 RPC 的參數', () => {
  it('五個位置參數逐一對上,且 zeroPriceReason 是顯式 null', async () => {
    await runAndCatchRedirect(amountForm());
    expect(mocks.updateAdminOrderItemAmount).toHaveBeenCalledTimes(1);
    expect(mocks.updateAdminOrderItemAmount).toHaveBeenCalledWith(
      ORDER,
      3,
      { orderItemId: ITEM, unitPrice: 1200, zeroPriceReason: null },
      'actor-1',
      'req-1',
    );
  });

  it('🔴 actor / requestId 來自 server,不是表單 —— 表單塞同名欄位不影響送出值', async () => {
    await runAndCatchRedirect(amountForm({ actor: 'evil', request_id: 'evil' }));
    const args = mocks.updateAdminOrderItemAmount.mock.calls[0];
    // 🔴 先斷言真的被呼叫過 —— 少了這一行,`args` 是 undefined 時下面兩格會以另一種方式紅,
    //    而那種紅指向的是「測試寫錯」不是「行為錯」。
    expect(args).toBeDefined();
    expect(args?.[3]).toBe('actor-1');
    expect(args?.[4]).toBe('req-1');
  });
});

describe('成功路徑的副作用', () => {
  it('成功才 revalidate 列表與明細;失敗路徑不 revalidate', async () => {
    await runAndCatchRedirect(amountForm());
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/orders');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(DETAIL);

    vi.clearAllMocks();
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'actor-1' });
    mocks.getRequestId.mockResolvedValue('req-1');
    mocks.updateAdminOrderItemAmount.mockRejectedValue(new Error('boom'));
    await runAndCatchRedirect(amountForm());
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
