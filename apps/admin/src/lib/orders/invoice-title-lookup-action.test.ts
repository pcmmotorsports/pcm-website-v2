import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  gcisFetcher: vi.fn(),
}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
// 🛑 **來源那一支整個換掉 ⇒ 一發真的對外請求都不打。**
//    🔵 `pickGcisTitle` 用**真的那一支**(不 mock)—— 它是純函式, 而**假的解析驗不到真的形狀**。
vi.mock('./invoice-title-source-gcis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./invoice-title-source-gcis')>()),
  gcisFetcher: mocks.gcisFetcher,
}));

import { lookupInvoiceTitleAction } from './invoice-title-lookup-action';

// ⟦b4-INVOICE5PCT⟧三 片二的守門。
// 🔴🔴 **這一份的主格【不是「查得到」】, 是「查不到的時候他照樣建得出單」。**
//    ⇒ 📌 下面那一組「對外壞掉」的格子若從來沒紅過, 表示我們**沒有真的驗過 fail-open**。

/** 🔬 2026-09-10 唯讀實測 `90003020` 的回傳**逐字**(75 B)。 */
const REAL_BODY = [{ Business_Accounting_NO: '90003020', Company_Name: '派達有限公司' }];
const okRes = (body: unknown): Response =>
  ({ ok: true, json: async () => body }) as unknown as Response;

describe('統編查抬頭 action', () => {
  beforeEach(() => {
    mocks.authorizeAdminMutation.mockResolvedValue({ actor: 'probe' });
    // 🔴 `mockReset` 不能省 —— `mockResolvedValue` **只換回傳值, 不清呼叫紀錄**。
    //    ⇒ 📌 少了它, 「一發都不打」那一格會讀到**上一個測試的呼叫**而假紅(實測 6 次)。
    mocks.gcisFetcher.mockReset();
    mocks.gcisFetcher.mockResolvedValue(okRes(REAL_BODY));
  });

  it('🔴🔴 **沒登入 ⇒ `denied`, 而【一發都不打】** —— 來源接上去之後,'
    + '任何人叫得動這一支就等於把我們當成一台免費的代理', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(await lookupInvoiceTitleAction({ taxId: '22099131' })).toEqual({
      ok: false,
      reason: 'denied',
    });
    // 🔴 **[codex R1 nit④]** 少了這一行, 「先打一發再回 denied」的實作照樣綠 ——
    //    而那正是這一格要擋的:未授權的人**不准花掉我們的配額**。
    expect(mocks.gcisFetcher).not.toHaveBeenCalled();
  });

  it('🔵 授權在【統編格式】之前 —— 沒登入的人連「你統編打錯了」都不該問得出來', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    // 🔴 承重:順序反了的話, 未授權的呼叫端可以拿這一支當統編格式驗證器。
    expect(await lookupInvoiceTitleAction({ taxId: 'x' })).toEqual({ ok: false, reason: 'denied' });
  });

  it('🟢 來源接上了 ⇒ 回真的抬頭(用 2026-09-10 實測那一發的逐字形狀)', async () => {
    expect(await lookupInvoiceTitleAction({ taxId: '90003020' })).toEqual({
      ok: true,
      title: '派達有限公司',
    });
  });

  it('🔴🔴 **主格:對外那一發【一定失敗】⇒ 他照樣拿得到一個答案, 而不是一個例外**', async () => {
    // 🔴 承重:這一格是這一片存在的意義 —— 它是一個【方便】, 不是一個【依賴】。
    //    ⚪ 它若從來沒紅過, 表示我們沒有真的驗過 fail-open。
    for (const boom of [
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND')),
      () => Promise.reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })),
      () => Promise.resolve({ ok: false } as unknown as Response),
      () =>
        Promise.resolve({
          ok: true,
          json: () => Promise.reject(new Error('unexpected token <')),
        } as unknown as Response),
    ]) {
      mocks.gcisFetcher.mockImplementation(boom);
      expect(await lookupInvoiceTitleAction({ taxId: '90003020' })).toEqual({
        ok: false,
        reason: 'lookup_failed',
      });
    }
  });

  it('🔴 查不到**不是 404** ⇒ 兩種形狀都要接得住, 而它們最後都是 `lookup_failed`', async () => {
    // 🔴🔴 **[codex R2 nit⑦]** 我 R1 把「200 + 0 B」寫成「200 + 空陣列」—— **那是推的**。
    //    ⇒ 這裡把兩種**分開**餵, 而且第二種用**真的 `Response`**(不是手捏的 json reject):
    //      · `[]`  ⇒ json 成功 ⇒ pickTitle 回 null ⇒ 殼判 empty
    //      · 0 B   ⇒ json **throw** ⇒ 殼判 garbage      ← 2026-09-10 我實測到的那一種
    //    ⚠️ 而畫面對兩者一樣 —— 📌 **一樣不等於同一件事。**
    mocks.gcisFetcher.mockResolvedValue(okRes([]));
    expect(await lookupInvoiceTitleAction({ taxId: '00000000' })).toEqual({
      ok: false,
      reason: 'lookup_failed',
    });

    mocks.gcisFetcher.mockResolvedValue(new Response('', { status: 200 }));
    expect(await lookupInvoiceTitleAction({ taxId: '00000000' })).toEqual({
      ok: false,
      reason: 'lookup_failed',
    });
  });

  it('🔴 統編明顯不對 ⇒ `invalid`, 而【一發都不打】', async () => {
    for (const bad of ['', '1234567', '123456789', 'abcdefgh', '2209913a', '  ']) {
      expect(await lookupInvoiceTitleAction({ taxId: bad }), bad).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    // 🔴 承重:格式擋在對外那一發【之前】—— 否則每一個手滑都花對方一次配額。
    expect(mocks.gcisFetcher).not.toHaveBeenCalled();
  });

  it('🔵 前後空白修掉之後合法 ⇒ 真的去查(而不是被判成 invalid)', async () => {
    expect(await lookupInvoiceTitleAction({ taxId: '  90003020  ' })).toEqual({
      ok: true,
      title: '派達有限公司',
    });
    // 🔴 承重:送出去的是**修掉空白的那一個** —— 帶空白過去 OData 那串會對不上。
    expect(mocks.gcisFetcher).toHaveBeenCalledWith('90003020', expect.anything());
  });

  it('🔴🔴 **[codex R1 must-fix ②] 參數是【從網路來的】⇒ 型別註記在執行期什麼都不是**', async () => {
    // 🔴 承重:舊寫法直接 `args.taxId.trim()` ⇒ 傳 null / {} / 數字都 TypeError,
    //    而呼叫端沒有 catch ⇒ 📌 **fail-open 在這一格是破的**。
    for (const junk of [null, undefined, {}, { taxId: 123 }, { taxId: null }, { taxId: ['x'] }]) {
      await expect(
        lookupInvoiceTitleAction(junk as unknown as { taxId: string }),
        JSON.stringify(junk),
      ).resolves.toEqual({ ok: false, reason: 'invalid' });
    }
    expect(mocks.gcisFetcher).not.toHaveBeenCalled();
  });

  it('🔴🔴 **[codex R1 must-fix ②] 授權自己 reject ⇒ `denied`, 而不是穿出去**', async () => {
    mocks.authorizeAdminMutation.mockRejectedValue(new Error('db down'));
    expect(await lookupInvoiceTitleAction({ taxId: '90003020' })).toEqual({
      ok: false,
      reason: 'denied',
    });
    expect(mocks.gcisFetcher).not.toHaveBeenCalled();
  });

  it('🔴🔴 **[codex R1 must-fix ③] 授權一直不回 ⇒ 有上限, 而逾時之後【不再往下打】**', async () => {
    vi.useFakeTimers();
    try {
      mocks.authorizeAdminMutation.mockReturnValue(new Promise(() => {}));
      const p = lookupInvoiceTitleAction({ taxId: '90003020' });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(await p).toEqual({ ok: false, reason: 'denied' });
      // 🔴 承重:一個已經等了 1.5 秒的人, 不該再被押著等政府那 1.5 秒。
      expect(mocks.gcisFetcher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('🛑 **無論哪一條路都不 throw** —— 建單流程不准被查抬頭卡住', async () => {
    // 🔴 這一格是這一片的靈魂:fail-open。它 throw 的話上面那三格會先紅,
    //    而這一格是**顯式**地把那個要求寫下來, 讓刪掉它的人看得到自己在刪什麼。
    for (const v of ['22099131', '', 'x'.repeat(200)]) {
      await expect(lookupInvoiceTitleAction({ taxId: v })).resolves.toBeDefined();
    }
  });
});
