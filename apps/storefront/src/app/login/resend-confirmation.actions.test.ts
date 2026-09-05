// resendSignupConfirmationAction 守門(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05)
//
// 🔴 **本檔最高風險點與 `forgot/actions.test.ts` 同一條:帳號列舉防護。**
//    通過驗證之後,不論成功 / 帳號不存在 / 已驗證過 / 429,**回傳值必須逐字相同** ——
//    任何分支差異都會讓這支變成帳號探測器。
// 🛑 而「回應不得有差異」與「伺服器不得留紀錄」是兩件事:本檔驗前者,並驗留痕**不含 email**。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { resendSpy, resolveSiteUrlSpy } = vi.hoisted(() => ({
  resendSpy: vi.fn(),
  resolveSiteUrlSpy: vi.fn(),
}));

vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      updatePassword: vi.fn(),
      resendSignupConfirmation: resendSpy,
    }),
}));
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: resolveSiteUrlSpy }));

import { resendSignupConfirmationAction } from './actions';
import { KNOWN_AUTH_ERROR_CODES } from '@/lib/auth/auth-copy';

const EMAIL = 'someone@example.com';

beforeEach(() => {
  resendSpy.mockReset();
  resolveSiteUrlSpy.mockReset();
  resolveSiteUrlSpy.mockReturnValue('https://shop.pcmmotorsports.com');
});
afterEach(() => vi.clearAllMocks());

describe('resendSignupConfirmationAction — 帳號列舉防護', () => {
  // 🔴 三個世界【逐字】比同一個值:這一格若鬆掉, 這支就是帳號探測器。
  it('🔴 成功 / provider 丟 AuthError / provider 丟 429 ⇒ 回傳值逐字相同', async () => {
    resendSpy.mockResolvedValue(undefined);
    const ok = await resendSignupConfirmationAction({ email: EMAIL });

    // 🔴🔴 **[codex 關卡2 must-fix ④]** ⛔ ~~原本只餵 `unknown` 與 `rate_limited`~~
    //    ⇒ 而註解宣稱涵蓋「已驗證 / 帳號不存在」⇒ 📌 **宣稱比餵進去的東西寬。**
    //    若日後有人只對 `email_already_registered` 那一種回不同的資料, 這一格【仍然全綠】。
    //    ✅ 改成把 `AuthErrorCode` 那個封閉集【逐個餵一遍】—— 分母不再是我挑的兩個。
    const results = [ok];
    for (const code of KNOWN_AUTH_ERROR_CODES) {
      resendSpy.mockRejectedValue(new AuthError(code, `provider says ${code}`));
      results.push(await resendSignupConfirmationAction({ email: EMAIL }));
    }
    for (const r of results) {
      expect(r).toEqual({});
    }
    // 🟢 正對照:證明每一發真的各自走到了 provider(否則一堆 {} 是「根本沒呼叫」)
    expect(resendSpy).toHaveBeenCalledTimes(1 + KNOWN_AUTH_ERROR_CODES.length);
  });

  // 🔴 把白名單與 domain 那個封閉集【釘在一起】—— 我手打了一份, 而手打的會漂;
  //    漏一個成員的後果是那個 code 被記成 `unrecognized`(往安全的方向失效, 而資訊變少)。
  it('🔵 KNOWN_AUTH_ERROR_CODES 必須逐字等於 domain 的 AuthErrorCode 封閉集', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../../../packages/domain/src/identity/auth.ts', import.meta.url),
      'utf8',
    );
    const decl = src.slice(src.indexOf('AuthErrorCode ='), src.indexOf(';', src.indexOf('AuthErrorCode =')));
    // 🟢 正對照:抓不到宣告會拿到空陣列, 而空陣列與「兩邊剛好都空」印同一個綠。
    expect(decl.length, '找不到 AuthErrorCode 的宣告 ⇒ 這一格沒有判別力').toBeGreaterThan(30);
    const fromDomain = [...decl.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect([...KNOWN_AUTH_ERROR_CODES].sort()).toEqual(fromDomain);
  });

  it('🔵 驗證失敗(不是 email)⇒ 回 fieldErrors, 而【不呼叫】provider', async () => {
    const r = await resendSignupConfirmationAction({ email: 'not-an-email' });
    expect(r.fieldErrors).toBeTruthy();
    expect(resendSpy).not.toHaveBeenCalled();
  });

  it('🔴 resolveSiteUrl 回 undefined ⇒ throw(不得偽裝成「已寄出」)', async () => {
    resolveSiteUrlSpy.mockReturnValue(undefined);
    await expect(resendSignupConfirmationAction({ email: EMAIL })).rejects.toThrow();
    expect(resendSpy).not.toHaveBeenCalled();
  });

  it('🔴 redirectTo 從 resolveSiteUrl 組, 而 next 是 /login(不是忘記密碼的 /login/reset)', async () => {
    resendSpy.mockResolvedValue(undefined);
    await resendSignupConfirmationAction({ email: EMAIL });
    expect(resendSpy).toHaveBeenCalledWith({
      email: EMAIL,
      redirectTo: 'https://shop.pcmmotorsports.com/auth/callback?next=/login',
    });
  });

  it('🔴 留痕有 outcome 與長度, 而【不含 email 字面、不含網域字面】', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    resendSpy.mockResolvedValue(undefined);
    await resendSignupConfirmationAction({ email: EMAIL });

    const payload = JSON.stringify(info.mock.calls[0]);
    expect(payload).toContain('"outcome":"requested"');
    expect(payload).toContain('emailLength');
    // 🛑 兩個都要:email 全文與【網域】各自都是可以縮小範圍的東西。
    expect(payload).not.toContain(EMAIL);
    expect(payload).not.toContain('example.com');
    info.mockRestore();
  });

  // 🔴🔴 **我第一版漏了這一格** —— 白名單那個修法拿掉之後測試【全綠】,
  //    因為上面那格只比對常數與 domain 型別, **沒有一發真的餵一個帶 PII 的 code**。
  //    ⇒ 📌 釘住「兩份清單一致」與「不在清單上的會被換掉」是兩個宣稱。
  it('🔴 provider 丟出 code 是自由字串(甚至是 email)⇒ log 記 unrecognized, 不得原封寫入', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    resendSpy.mockRejectedValue({ code: EMAIL, message: 'weird transport error' });
    await resendSignupConfirmationAction({ email: EMAIL });

    const payload = JSON.stringify(info.mock.calls[0]);
    expect(payload).toContain('"errorCode":"unrecognized"');
    expect(payload).not.toContain(EMAIL);
    info.mockRestore();
  });

  it('🔵 provider 出錯時留痕要分得出來(outcome=provider_error), 而回應仍相同', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    resendSpy.mockRejectedValue(new AuthError('rate_limited', 'too many'));
    const r = await resendSignupConfirmationAction({ email: EMAIL });

    expect(JSON.stringify(info.mock.calls[0])).toContain('"outcome":"provider_error"');
    expect(r).toEqual({});
    info.mockRestore();
  });
});
