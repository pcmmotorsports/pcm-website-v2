import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// manual-refund-actions.test.ts — `recordManualRefundAction` 的授權 / 解析 / repository 正向線。
//
// 🔴 **為什麼補這一支**(`#866` 驗收第 7 條):2026-08-24 `#806` 把
//    `manual-refund-787-server-gate.test.ts` 退場之後,量到:
//      grep -rn "recordManualRefundAction" apps packages --include='*.test.ts*' | wc -l ⇒ **0**
//    ⇒ 這支動錢的 server action **一格測試都沒有**。而它退場是對的(它釘的那道閘當時要被刪),
//      **但它順手帶走了唯一在看這支 action 的東西** —— 那一格沒有人補。
//    📌 形狀:**退場一個守門的時候,要問它【順便】在守什麼。**(與 `#806` 那條「解除封印前
//       問它現在還擋著什麼」同族,只是換成守門那一側。)
//    ⚠️ 後來封印復位、那支測試也救回來了,而**它守的仍然只有 #787 那道閘**
//       (該檔檔頭逐字:「本檔把整個 manual-refund-entry-gate.ts 模組 mock 掉,證的是
//        【action 有讀那顆旗標、且旗標值真的決定了分岔】」)⇒ 授權 / 解析 / repository 三條
//       **仍然零覆蓋**,本檔補的是那三條。
//
// 🔴 **本檔把 `#787` 旗標 mock 成 `false`,而那是【對照組】不是【偽造現場】** ——
//    判別:那個狀態在真實世界裡**會出現**(`#866` 落地之後封印就會解除,見該條目),
//    而本檔測的是「封印解除之後這支 action 自己對不對」。
//    ⚠️ 若哪天 `#787` 被判定為永久封印(而不是暫時),本檔的前提就不成立 ⇒ 那時要回來重讀這段。
//
// ⚠️ **本檔【不】測 #787 那道閘本身** —— 那是同目錄 `manual-refund-787-server-gate.test.ts`
//    的職責,兩支各守一半,不重複。

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  recordManualRefund: vi.fn(),
  revalidateOrderViews: vi.fn(),
  redirect: vi.fn(),
  entryGateBlocked: false,
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('../orders/order-revalidate', () => ({ revalidateOrderViews: mocks.revalidateOrderViews }));
// 🔴 `redirect()` 在真實 Next 會 **throw** 來中斷渲染 ⇒ 不 mock 的話成功路徑會被讀成「這支拋了例外」。
//    這裡讓它記錄呼叫並照樣 throw,**因為「成功 = 會拋 redirect」正是要斷言的行為**。
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    mocks.redirect(url);
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('./manual-refund-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./manual-refund-repository')>();
  return { ...actual, recordManualRefund: mocks.recordManualRefund };
});
vi.mock('../../components/orders/manual-refund-entry-gate', () => ({
  get MANUAL_REFUND_ENTRY_BLOCKED_BY_787() {
    return mocks.entryGateBlocked;
  },
}));

import { recordManualRefundAction } from './manual-refund-actions';
import {
  MANUAL_REFUND_AMOUNT_FIELD,
  MANUAL_REFUND_OCCURRED_AT_FIELD,
  MANUAL_REFUND_ORDER_ID_FIELD,
  MANUAL_REFUND_RAIL_FIELD,
  MANUAL_REFUND_REASON_FIELD,
  MANUAL_REFUND_REQUEST_TOKEN_FIELD,
  type ManualRefundActionState,
} from './manual-refund-action-state';

const IDLE: ManualRefundActionState = { status: 'idle', requestToken: 'tok-idle' };
const ORDER_ID = '11111111-2222-3333-4444-555555555555';
const REQUEST_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function validForm(over: Record<string, string> = {}): FormData {
  const base: Record<string, string> = {
    [MANUAL_REFUND_ORDER_ID_FIELD]: ORDER_ID,
    [MANUAL_REFUND_REQUEST_TOKEN_FIELD]: REQUEST_TOKEN,
    [MANUAL_REFUND_RAIL_FIELD]: 'cash',
    [MANUAL_REFUND_AMOUNT_FIELD]: '500',
    [MANUAL_REFUND_REASON_FIELD]: '測試用表單,不對應真實退款',
    [MANUAL_REFUND_OCCURRED_AT_FIELD]: '2026-08-20T10:00',
    ...over,
  };
  const data = new FormData();
  for (const [k, v] of Object.entries(base)) data.set(k, v);
  return data;
}

/** 成功路徑會 `redirect()` 而它 throw ⇒ 包起來,把 throw 當成「有沒有走到 redirect」的訊號。 */
async function run(form: FormData): Promise<{ state?: ManualRefundActionState; redirected: boolean }> {
  try {
    return { state: await recordManualRefundAction(IDLE, form), redirected: false };
  } catch (e) {
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') return { redirected: true };
    throw e;
  }
}

beforeEach(() => {
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
  mocks.getRequestId.mockResolvedValue('req-test');
  mocks.recordManualRefund.mockResolvedValue({ ok: true, refundId: 'ref-1', idempotent: false });
  mocks.entryGateBlocked = false;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('recordManualRefundAction — ① 授權閘(絕對第一)', () => {
  it('🔴 沒有授權 ⇒ denied,而且 repository **一次都沒被呼叫**', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const { state } = await run(validForm());
    expect(state).toMatchObject({ status: 'failed', code: 'denied' });
    // 🔴 這一格才是重點:只斷言 denied 的話,「授權後才擋」與「授權前就擋」印同一句話,
    //    而前者代表未授權的請求已經碰到資料庫了。
    expect(mocks.recordManualRefund).not.toHaveBeenCalled();
  });

  it('🔴 沒有授權 ⇒ 連 requestId 都不去拿(授權真的在最前面,不是「第一個 if」而已)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await run(validForm());
    expect(mocks.getRequestId).not.toHaveBeenCalled();
  });

  it('🔴🔴 actor 取自 session,**表單塞不進去**(權限邊界)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'sean' });
    await run(validForm({ actor: 'attacker', actorId: 'attacker' }));
    expect(mocks.recordManualRefund).toHaveBeenCalledTimes(1);
    const arg = mocks.recordManualRefund.mock.calls[0]?.[0] as { actor: string };
    expect(arg.actor).toBe('sean');
    // 負對照:整包參數裡不得出現表單塞的那個值。
    expect(JSON.stringify(mocks.recordManualRefund.mock.calls[0]?.[0])).not.toContain('attacker');
  });
});

describe('recordManualRefundAction — ② 解析(純形狀;業務判定在 RPC)', () => {
  const badCases: Array<[string, Record<string, string>]> = [
    ['金額不是數字', { [MANUAL_REFUND_AMOUNT_FIELD]: 'abc' }],
    ['金額為 0', { [MANUAL_REFUND_AMOUNT_FIELD]: '0' }],
    ['rail 不在白名單(card 不走這支)', { [MANUAL_REFUND_RAIL_FIELD]: 'card' }],
    ['orderId 不是 uuid', { [MANUAL_REFUND_ORDER_ID_FIELD]: 'not-a-uuid' }],
    ['理由是空的', { [MANUAL_REFUND_REASON_FIELD]: '' }],
  ];

  for (const [name, over] of badCases) {
    it(`🔴 ${name} ⇒ invalid,而且 repository **沒被呼叫**`, async () => {
      const { state } = await run(validForm(over));
      expect(state).toMatchObject({ status: 'failed', code: 'invalid' });
      expect(mocks.recordManualRefund).not.toHaveBeenCalled();
    });
  }

  it('🟢 正對照:上面那些欄都合法時 ⇒ **不是** invalid(否則上面五格恆綠、證不了任何東西)', async () => {
    const { redirected } = await run(validForm());
    expect(redirected).toBe(true);
    expect(mocks.recordManualRefund).toHaveBeenCalledTimes(1);
  });

  it('失敗時把員工打過的字帶回去(reason 是打字成本最高的一欄)', async () => {
    const { state } = await run(
      validForm({ [MANUAL_REFUND_AMOUNT_FIELD]: 'abc', [MANUAL_REFUND_REASON_FIELD]: '客人要求退現金' }),
    );
    expect(state).toMatchObject({ input: { reason: '客人要求退現金' } });
  });
});

describe('recordManualRefundAction — ③ repository 正向線', () => {
  it('🔴 參數逐欄交給 repository(不是「有呼叫到」就算)', async () => {
    await run(validForm());
    expect(mocks.recordManualRefund).toHaveBeenCalledTimes(1);
    expect(mocks.recordManualRefund.mock.calls[0]?.[0]).toMatchObject({
      orderId: ORDER_ID,
      rail: 'cash',
      refundAmount: 500,
      reason: '測試用表單,不對應真實退款',
      actor: 'sean',
      requestId: REQUEST_TOKEN,
    });
  });

  it('🔴 成功 ⇒ 走 redirect(PRG),而且 revalidate 有跑', async () => {
    const { redirected } = await run(validForm());
    expect(redirected).toBe(true);
    expect(mocks.revalidateOrderViews).toHaveBeenCalledTimes(1);
    expect(mocks.revalidateOrderViews.mock.calls[0]?.[0]).toMatchObject({
      orderId: ORDER_ID,
      scope: 'manual-refund',
    });
  });

  it('🔴🔴 idempotent:true **也是成功**(顯示成錯誤會誘導員工換 token 重送 ⇒ 第二筆退款登記)', async () => {
    mocks.recordManualRefund.mockResolvedValue({ ok: true, refundId: 'ref-1', idempotent: true });
    const { redirected } = await run(validForm());
    expect(redirected).toBe(true);
  });

  it('🔴 repository 拒絕 ⇒ 回它的 code、**不 redirect**,而 revalidate 仍要跑', async () => {
    mocks.recordManualRefund.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      logMessage: '額度不足',
      staffMessage: '退款金額超過可退餘額',
    });
    const { state, redirected } = await run(validForm());
    expect(redirected).toBe(false);
    expect(state).toMatchObject({ status: 'failed', code: 'rejected' });
    // 🔴 失敗也要 revalidate:那一筆可能已經寫進去了(RPC 的失敗與「什麼都沒發生」不等價)。
    expect(mocks.revalidateOrderViews).toHaveBeenCalledTimes(1);
  });

  it('repository 給了 staffMessage ⇒ 帶給員工看(不是吞掉換成通用句)', async () => {
    mocks.recordManualRefund.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      logMessage: 'internal',
      staffMessage: '這張單在現金/匯款軌上沒有收到那麼多錢',
    });
    const { state } = await run(validForm());
    expect(JSON.stringify(state)).toContain('現金/匯款軌上沒有收到那麼多錢');
  });
});
