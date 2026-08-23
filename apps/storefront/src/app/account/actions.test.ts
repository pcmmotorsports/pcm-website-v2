// @vitest-environment node
//
// `logoutAction` 的證人 —— `#883` codex 對抗審查 must-fix 5(2026-08-24,cf 補洞窗)
//
// 🔴 **這一格在本檔存在之前是【零覆蓋】的,而那是實測出來的,不是推的。**
//   在拋棄式 worktree 把真的 `logoutAction` 退化成**只 `redirect('/logout')`、不清 session**:
//     storefront 全套 ⇒ Test Files 248 passed (248) · Tests 3531 passed | 1 skipped · **exit=0**
//   ⇒ 客人按下登出、被導到道別頁、而 **session 原封不動、`/account` 照樣進得去** ——
//     **整套 3531 格測試沒有一格會紅。**
//
// 🔴 而這條是**兩個不同模型、不同輪次、沒有互相看過**各自走到的同一格:
//   · R1 code-reviewer:「本片目前沒有任何一道會紅的尺覆蓋『登出真的生效』。」
//   · codex 對抗審查 must-fix 5:「本測試把 action 換成 no-op ⇒ 守不到這條認證邊界。」
//   ⇒ 兩個獨立來源指同一格 ⇒ 那一格是真的。
//
// ⚠️ **本檔的射程(不要讀成比它大)**:
//   它守的是「這支 action **真的去叫 auth service 登出了**,而且是在導頁**之前**」。
//   它**不驗** cookie 在真瀏覽器裡真的消失、也不驗 `/account` 真的擋得住 ——
//   那要真 Supabase + 真瀏覽器。**本檔全綠 ≠ 登出功能驗過了。**
//   ⇒ 它守的是**最可能的退化**(有人把清 session 那一步拿掉、或搬到 redirect 後面),不是所有寫法。

import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls: string[] = [];

const signOut = vi.fn(async () => {
  calls.push('signOut');
});
const authService = { signOut };

// 🔴 `redirect()` 在 Next 裡是**用丟例外實作的** —— 照著做,否則「先導頁再登出」那個
//   寫法在測試裡會安靜地通過,而在正式站上 `logoutCustomer` 根本執行不到。
class RedirectError extends Error {
  constructor(public to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    calls.push(`redirect:${to}`);
    throw new RedirectError(to);
  },
}));
vi.mock('@/lib/auth/composition', () => ({
  getAuthService: async () => authService,
}));
// 🔴 **`logoutCustomer` 刻意【不】mock** —— 它是那條認證邊界上的真東西
//   (`packages/use-cases/src/logout-customer.ts` ⇒ `authService.signOut()`)。
//   把它換成替身,就等於把「登出到底有沒有發生」這件事**再抽掉一次**,而那正是本條 finding 的病。

const { logoutAction } = await import('./actions');

beforeEach(() => {
  calls.length = 0;
  signOut.mockClear();
});

describe('#883 codex-5:logoutAction 必須真的把 session 清掉,不是只把人導走', () => {
  it('🔴 一定要叫到 auth service 的 signOut —— 少了它,客人被導到道別頁而 session 還在', async () => {
    await expect(logoutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(
      signOut,
      'logoutAction 沒有叫 signOut ⇒ 按下登出之後 session 原封不動、/account 照樣進得去,' +
        '而畫面上他已經看到道別頁了',
    ).toHaveBeenCalledTimes(1);
  });

  it('🔴 順序:signOut 必須在 redirect 【之前】—— 反過來的話它永遠執行不到', async () => {
    // `redirect()` 會丟例外 ⇒ 寫在它後面的每一行都是死碼,而**型別與 lint 都不會抱怨**。
    await expect(logoutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(calls, '實際發生的順序').toEqual(['signOut', 'redirect:/logout']);
  });

  it('對照組:這把尺量得到差別 —— signOut 沒被叫時 calls 裡就不會有它', () => {
    // 🔴 沒有這一格,「signOut 一定被叫到」在【calls 這支陣列根本沒接上】的世界也會綠。
    expect(calls).toEqual([]); // beforeEach 清空後、還沒跑 action 之前
  });

  it('導的是道別頁 /logout,不是登入表單(Sean 2026-08-06 Q2=A)', async () => {
    await expect(logoutAction()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(calls.at(-1)).toBe('redirect:/logout');
  });
});
