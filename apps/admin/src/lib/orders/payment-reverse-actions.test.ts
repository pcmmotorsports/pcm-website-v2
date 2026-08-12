import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  reverseManualPayment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

// 🔴 只換掉會打 DB 的那一支;`PaymentWroteButUnreadableError` / `PaymentWriteError` 用**真的**那兩個
//    —— 自己造假 class 的話,「已沖掉與沒沖掉分得開」就變成自我實現的斷言(姊妹片同款紀律)。
vi.mock('./payment-repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./payment-repository')>();
  return { ...actual, reverseManualPayment: mocks.reverseManualPayment };
});

import { reversePaymentAction } from './payment-reverse-actions';
import { PaymentWriteError, PaymentWroteButUnreadableError } from './payment-repository';
import { reverseMessageFor } from './payment-reverse-state';

// payment-reverse-actions.test.ts — #372-A12 沖銷 action。
//
// 🔴 **本檔是關卡2 R1 MF2 補的**:原本這支 action **全 repo 零測試** ——
//    拿掉成功後的 `revalidateOrderViews`、或把 catch 全部映成 `bug`,整套照樣綠。
//    元件那層的測試 mock 掉了 action,所以它證明不了 action 自己做對了什麼。
//
// 🔴 本檔守的三條:
//    ① catch 一律走 `reverseFailureCodeForThrown`(已 commit ⇒ `'wrote'`,不得講成「沒有沖成」)
//    ② 成功與失敗**兩條路都要 revalidate**(失敗那條可能已經 commit,畫面不更新的話
//       核可句叫他「看那一筆」會沒東西可看)
//    ③ 送給 RPC 的 `reason` 是 **trim 過**的,而且全空白在 app 層就被擋掉

const OK_AUTH = { sid: 'sid-1', actorId: 'staff-1' };

/**
 * 🔴 **`returnTo` 刻意不等於 `/orders/${orderId}`**(關卡2 R2 唯一的 must-fix)。
 *
 * `revalidateOrderViews` 用 `new Set([\`/orders/${orderId}\`, returnToPathname(returnTo)])`
 * (`order-revalidate.ts:35`)—— 第一版 fixture 寫 `returnTo:'/orders/ord-1'`,兩條路徑**字面相同**
 * ⇒ **Set 塌成一格**(實測 `new Set(['/orders/ord-1','/orders/ord-1']).size === 1`)
 * ⇒ 下面兩條 `toContain('/orders/ord-1')` 由 orderId 那條**獨力滿足**
 * ⇒ **把 action 的 `returnTo` 接錯成 `orderId`,186 格全綠**。
 *
 * 這正是「fixture 值讓守門恆真」那一族:R1 MF4 在**島層**折掉了同款問題,
 * **action 層我漏折**。面板版的 `return_to` 本來就帶 query,用它才是真實形狀。
 */
const ORDER_ID = 'ord-1';
const RETURN_TO = '/orders?panel=ord-1';
const ARGS = {
  paymentId: 'pay-1',
  orderId: ORDER_ID,
  returnTo: RETURN_TO,
  reason: '登錯金額',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue(OK_AUTH);
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.reverseManualPayment.mockResolvedValue({ reversalId: 'rev-1' });
});

describe('授權閘排在最前面', () => {
  it('未授權 ⇒ denied,而且**沒有**打 RPC', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const r = await reversePaymentAction(ARGS);
    expect(r).toEqual({ ok: false, code: 'denied', message: reverseMessageFor('denied') });
    expect(mocks.reverseManualPayment).not.toHaveBeenCalled();
  });

  it('🔴 未授權時連 revalidate 都不該跑(沒發生的事不必重取)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    await reversePaymentAction(ARGS);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe('🔴 原因必填在 app 層就擋(DB 的 G3 是 btrim 後判空)', () => {
  it.each(['', '   ', '　', '\t\n'])('空白原因「%s」⇒ invalid 且不打 RPC', async (reason) => {
    const r = await reversePaymentAction({ ...ARGS, reason });
    expect(r).toEqual({ ok: false, code: 'invalid', message: reverseMessageFor('invalid') });
    expect(mocks.reverseManualPayment).not.toHaveBeenCalled();
  });

  it('paymentId 空字串 ⇒ invalid', async () => {
    const r = await reversePaymentAction({ ...ARGS, paymentId: '' });
    // 🔴 只驗 `ok === false` 的話,回 `denied` 或 `bug` 也會綠(R2 nit3)——
    //    而那三者給員工的話完全不同。要驗到碼。
    expect(r).toEqual({ ok: false, code: 'invalid', message: reverseMessageFor('invalid') });
    expect(mocks.reverseManualPayment).not.toHaveBeenCalled();
  });
});

describe('🔴 送給 RPC 的參數逐欄對(接錯欄位 = 沖錯列,而且畫面完全看不出來)', () => {
  it('paymentId / actor / trim 過的 reason 三者各就各位', async () => {
    await reversePaymentAction({ ...ARGS, reason: '  登錯金額  ' });
    expect(mocks.reverseManualPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reverseManualPayment).toHaveBeenCalledWith({
      paymentId: 'pay-1',
      // 🔴 actor 來自**授權閘**,不是呼叫端傳進來的 —— client 送得出任何字串。
      actor: 'staff-1',
      reason: '登錯金額',
    });
  });

  // ⚠️ 下面這格**目前近乎恆真**(R2 nit2 明點):型別上 `reversePaymentAction` 的參數
  //    根本沒有 `actor` 欄,所以「client 送不進來」現在是型別保證的、不是這格擋住的。
  //    留著是因為它守的是**未來**:哪天有人加上 `args.actor ?? authorization.actorId`
  //    這種「方便測試」的後門,這格會是唯一會叫的東西。
  it('🔴 actor 不吃 client 的值(參數裡根本沒有 actor 這個入口)', async () => {
    await reversePaymentAction({ ...ARGS, ...({ actor: 'someone-else' } as object) });
    expect(mocks.reverseManualPayment).toHaveBeenCalledWith(
      expect.objectContaining({ actor: 'staff-1' }),
    );
  });
});

describe('成功路徑', () => {
  it('回 ok', async () => {
    expect(await reversePaymentAction(ARGS)).toEqual({ ok: true });
  });

  it('🔴 成功要 revalidate **兩條**:明細頁 + return_to 指的那條(接錯任一條都要紅)', async () => {
    await reversePaymentAction(ARGS);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0] as string);
    // 兩條分開斷言:`/orders/ord-1` 由 orderId 來、`/orders` 由 returnTo 過 returnToPathname 來。
    // 只驗其中一條的話,把 returnTo 接成 orderId 仍會綠(見 RETURN_TO 上面的說明)。
    expect(paths).toContain('/orders/ord-1');
    expect(paths).toContain('/orders');
  });
});

describe('🔴 失敗分類:已 commit 與沒 commit 不可互相講錯', () => {
  it('丟 PaymentWroteButUnreadableError ⇒ wrote(逐字「沖銷已經完成了」)', async () => {
    mocks.reverseManualPayment.mockRejectedValue(
      new PaymentWroteButUnreadableError('形狀讀不懂'),
    );
    const r = await reversePaymentAction(ARGS);
    expect(r).toEqual({ ok: false, code: 'wrote', message: reverseMessageFor('wrote') });
    // 反面:絕不可落到任何說「沒有沖成」的句子。
    if (r.ok) throw new Error('unreachable');
    expect(r.message).not.toContain('沒有沖成');
  });

  it('丟 PaymentWriteError(P2B44)⇒ not_reversible', async () => {
    mocks.reverseManualPayment.mockRejectedValue(new PaymentWriteError('P2B44', '已被沖銷'));
    const r = await reversePaymentAction(ARGS);
    expect(r).toEqual({
      ok: false,
      code: 'not_reversible',
      message: reverseMessageFor('not_reversible'),
    });
  });

  it('丟連線類(空碼)⇒ unknown(雙分支那句)', async () => {
    mocks.reverseManualPayment.mockRejectedValue(new PaymentWriteError('', '連線斷了'));
    const r = await reversePaymentAction(ARGS);
    expect(r).toEqual({ ok: false, code: 'unknown', message: reverseMessageFor('unknown') });
  });

  it('丟沒預期到的例外 ⇒ bug', async () => {
    mocks.reverseManualPayment.mockRejectedValue(new Error('boom'));
    const r = await reversePaymentAction(ARGS);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.code).toBe('bug');
  });

  it('🔴 失敗路徑**也要** revalidate 兩條 —— unknown/wrote 兩類可能已經寫進去了', async () => {
    mocks.reverseManualPayment.mockRejectedValue(new PaymentWriteError('', '連線斷了'));
    await reversePaymentAction(ARGS);
    const paths = mocks.revalidatePath.mock.calls.map((c) => c[0] as string);
    expect(paths).toContain('/orders/ord-1');
    expect(paths).toContain('/orders');
  });
});
