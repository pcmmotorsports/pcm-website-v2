import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ authorizeAdminMutation: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));

import { lookupInvoiceTitleAction } from './invoice-title-lookup-action';

// ⟦b4-INVOICE5PCT⟧三 片二的守門。
// 🛑 **一發真的對外請求都不打** —— 來源今天是 `null`(還沒接), 而那是刻意的狀態。

describe('統編查抬頭 action', () => {
  beforeEach(() => {
    mocks.authorizeAdminMutation.mockResolvedValue({ actor: 'probe' });
  });

  it('🔴🔴 **沒登入 ⇒ `denied`, 而【一發都不打】** —— 來源接上去之後,'
    + '任何人叫得動這一支就等於把我們當成一台免費的代理', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(await lookupInvoiceTitleAction({ taxId: '22099131' })).toEqual({
      ok: false,
      reason: 'denied',
    });
  });

  it('🔵 授權在【統編格式】之前 —— 沒登入的人連「你統編打錯了」都不該問得出來', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    // 🔴 承重:順序反了的話, 未授權的呼叫端可以拿這一支當統編格式驗證器。
    expect(await lookupInvoiceTitleAction({ taxId: 'x' })).toEqual({ ok: false, reason: 'denied' });
  });

  it('🔴🔴 **「還沒接來源」與「查不到」要分得開** —— 它們給員工的指示不一樣', async () => {
    // 🔴 承重:兩者印同一句話 ⇒ 員工會去檢查自己的統編, 而問題不在他那裡。
    expect(await lookupInvoiceTitleAction({ taxId: '22099131' })).toEqual({
      ok: false,
      reason: 'not_wired',
    });
  });

  it('🔴 統編明顯不對 ⇒ `invalid`, 而它與 `not_wired` 是兩種', async () => {
    for (const bad of ['', '1234567', '123456789', 'abcdefgh', '2209913a', '  ']) {
      expect(await lookupInvoiceTitleAction({ taxId: bad }), bad).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
  });

  it('🔵 前後空白修掉之後合法 ⇒ 走到 `not_wired`(而不是被判成 invalid)', async () => {
    expect(await lookupInvoiceTitleAction({ taxId: '  22099131  ' })).toEqual({
      ok: false,
      reason: 'not_wired',
    });
  });

  it('🛑 **無論哪一條路都不 throw** —— 建單流程不准被查抬頭卡住', async () => {
    // 🔴 這一格是這一片的靈魂:fail-open。它 throw 的話上面那三格會先紅,
    //    而這一格是**顯式**地把那個要求寫下來, 讓刪掉它的人看得到自己在刪什麼。
    for (const v of ['22099131', '', 'x'.repeat(200)]) {
      await expect(lookupInvoiceTitleAction({ taxId: v })).resolves.toBeDefined();
    }
  });
});
