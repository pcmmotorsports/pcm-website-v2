// actions.test.ts — loginAction 信任邊界 unit test(M-1-14e-f1-a、#181 Q2=B、架構決策 A delivery 層)
//
// 驗:① server 端 validateLogin strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case)
//     ② 空欄 → presence 專屬「請填寫…」逐欄(Q2=B)、不呼叫 use-case、不 redirect
//     ③ 非空但格式錯(bad email / 短密碼)→ zod 逐欄訊息、不呼叫 use-case、不 redirect
//     ④ AuthError(credentials_invalid)→ formError 頂部帳號層級通道(釘死 2)、不 redirect
//     ⑤ 合法輸入 → signInWithPassword 收乾淨 creds + redirect('/')
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only / @pcm/adapters/server)+ next/navigation redirect。
// loginCustomer 用真實 use-case(只委派 authService.signInWithPassword、不 mock)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { signInSpy, redirectSpy, siteCheckSpy, reserveSpy, settleSpy } = vi.hoisted(() => ({
  signInSpy: vi.fn(),
  redirectSpy: vi.fn(),
  siteCheckSpy: vi.fn(),
  reserveSpy: vi.fn(),
  settleSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
}));
// B2B L2:站別檢查本身在 lib/auth/site-login-gate.test.ts 測;這裡只測「有沒有接上、接在導頁之前」。
vi.mock('@/lib/auth/site-login-gate', () => ({
  checkSiteAfterLogin: siteCheckSpy,
}));
// 資安修正片 3:登入限次本身在 lib/auth/login-throttle.test.ts 測;這裡只測接線。
vi.mock('@/lib/auth/login-throttle', () => ({
  LOGIN_THROTTLED_COPY: '登入嘗試次數太多，請 15 分鐘後再試，或改用「忘記密碼」。',
  reserveLoginAttempt: reserveSpy,
  settleLoginAttempt: settleSpy,
}));
// 2026-09-26:登入改用 getSignInAuthService(先清快過期的舊登入);getAuthService 在這裡被叫到就丟錯。
vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () => {
    throw new Error('loginAction 要用 getSignInAuthService');
  },
  getSignInAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: signInSpy,
      signOut: vi.fn(),
    }),
}));

import { loginAction } from './actions';

const VALID = { email: 'rider@pcm.com', password: 'hunter2hunter', remember: true };

beforeEach(() => {
  signInSpy.mockReset();
  signInSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: false });
  redirectSpy.mockReset();
  siteCheckSpy.mockReset().mockResolvedValue(null);
  reserveSpy.mockReset().mockResolvedValue({ blocked: false, id: 'r1' });
  settleSpy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('loginAction(信任邊界 + #181 雙通道)', () => {
  it('strip 未知欄:client 夾帶 tier/wallet_balance 不透傳 use-case', async () => {
    await loginAction({ ...VALID, tier: 'store', wallet_balance: 999999 });
    expect(signInSpy).toHaveBeenCalledTimes(1);
    // 只收 email + password、無 tier / wallet_balance / remember
    expect(signInSpy).toHaveBeenCalledWith({ email: VALID.email, password: VALID.password });
  });

  it('合法輸入(無 next)→ 登入成功 redirect(POST_AUTH_REDIRECT=/)', async () => {
    await loginAction(VALID);
    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('#190:合法 next → 登入成功導回 next(/account、同源白名單放行)', async () => {
    await loginAction(VALID, '/account');
    expect(redirectSpy).toHaveBeenCalledWith('/account');
  });

  it('#190:惡意 next(絕對 URL)→ 白名單擋成 /(open-redirect 防護)', async () => {
    await loginAction(VALID, 'https://evil.com');
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('空欄 → presence 專屬「請填寫…」逐欄(Q2=B)、不呼叫 use-case、不 redirect', async () => {
    const result = await loginAction({ email: '', password: '', remember: true });
    expect(result?.fieldErrors?.email).toBe('請填寫 Email');
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('非法 email(非空格式錯)→ zod「Email 格式不正確」逐欄、不呼叫 use-case、不 redirect', async () => {
    const result = await loginAction({ email: 'not-an-email', password: 'hunter2hunter' });
    expect(result?.fieldErrors?.email).toBe('Email 格式不正確');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('短密碼(<8、非空)→ zod「密碼至少 8 碼」逐欄、不呼叫 use-case', async () => {
    const result = await loginAction({ email: VALID.email, password: 'short' });
    expect(result?.fieldErrors?.password).toBe('密碼至少 8 碼');
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('全空白密碼 → presence「請填寫密碼」(codex 關卡2 修補)、不呼叫 use-case', async () => {
    const result = await loginAction({ ...VALID, password: '        ' });
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('remember 非 boolean(異常 client)→ 不洩漏契約外 fieldErrors.remember、回 formError fallback、不呼叫 use-case(codex 關卡2)', async () => {
    const result = await loginAction({ email: VALID.email, password: VALID.password, remember: 'on' });
    expect(result?.fieldErrors).toBeUndefined();
    expect(result?.formError).toBe('請輸入有效的 Email 與密碼');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('AuthError(credentials_invalid)→ formError「Email 或密碼錯誤」(頂部帳號層級)、不 redirect', async () => {
    signInSpy.mockRejectedValue(new AuthError('credentials_invalid', 'invalid'));
    const result = await loginAction(VALID);
    expect(result?.formError).toBe('Email 或密碼錯誤');
    // 🔴🔴 **[codex 關卡2 must-fix ①] 這一格是【白名單】的負對照**:
    //    `credentials_invalid` **不在** `UI_BRANCHABLE_CODES` 裡 ⇒ **不得**跨邊界回到 client。
    //    ⛔ ~~expect(...).toBe('credentials_invalid')~~ —— 那是「原封回七態」那一版的期望值。
    //    ⇒ 📌 client 只需要「是不是未驗證」一個 bit;其餘六個碼送過去都是【白給的】。
    expect(result?.formErrorCode).toBeUndefined();
    expect(result?.fieldErrors).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  // ── 🔴 ⟦b4-SIGNUPOPEN1⟧ 片2(2026-08-31 `-15`)────────────────────────────────
  // **這是 Confirm email 打開那一天,【現有未驗證使用者】唯一會看到的那句話 —— 而它一格測試都沒有。**
  // 量到的(2026-08-31 12:4x,`command grep -rn <字面> apps packages --include='*.test.ts*' | wc -l`):
  //   '請先收信完成'（本句)                  ⇒ **0**
  //   🔵 正對照 'Email 或密碼錯誤'（隔壁那句)⇒ **5**  ⇒ 尺會動,不是掃不到
  //   🔵 負對照 現造字面                      ⇒ **0**
  // 📌 ⇒ 隔壁那句錯誤文案被釘了 5 次,而這一句 0 次。差的不是難度,是**沒有人走到那條路**。
  // ⚠️ 射程:這一格證的是【我方 action 的映射與文案】。它**證不出**
  //    「Supabase 對未驗證帳號真的回 email_not_confirmed」—— 那要真的打開開關才知道,
  //    而那是 Sean 的 dashboard 動作。⇒ 兩個宣稱,不要合併。
  it('⟦b4-SIGNUPOPEN1⟧ AuthError(email_confirmation_required)→ formError「請先收信完成 Email 驗證後再登入」、不 redirect', async () => {
    signInSpy.mockRejectedValue(new AuthError('email_confirmation_required', 'unconfirmed'));
    const result = await loginAction(VALID);
    expect(result?.formError).toBe('請先收信完成 Email 驗證後再登入');
    // 不得掉進 default 的「登入失敗，請稍後再試」—— 那句對這個情境是【錯的指引】:
    // 客人會重試而不是去收信。
    expect(result?.formError).not.toContain('請稍後再試');
    // 🔴 「丙」:這一格是重寄按鈕的判準本身。
    expect(result?.formErrorCode).toBe('email_confirmation_required');
    expect(result?.fieldErrors).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  // 🔴 B2B L2:登入成功後、導頁前要做站別檢查;不放行 ⇒ 第一個導頁就是登入頁錯誤,不是原本的目的地。
  // 🔴 回傳而不是導頁(Codex L2a R1 必修):導回同一頁只換查詢參數時,登入頁不會顯示訊息、按鈕卡在送出中。
  it('B2B L2:站別不放行 ⇒ 回傳錯誤碼、完全不導頁', async () => {
    siteCheckSpy.mockResolvedValue('site-member-on-b2b');
    expect(await loginAction(VALID, '/checkout')).toEqual({ siteError: 'site-member-on-b2b' });
    expect(siteCheckSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).not.toHaveBeenCalled();
  });
  it('B2B L2:站別放行 ⇒ 照原本導回 next', async () => {
    await loginAction(VALID, '/checkout');
    expect(siteCheckSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy.mock.calls).toEqual([['/checkout']]);
  });
});

// 資安修正片 1(2026-09-26):人機驗證碼當獨立參數傳(同 `next` 的理由:validateLogin 會剝掉未知欄)。
describe('loginAction — 人機驗證碼', () => {
  it('帶驗證碼 ⇒ 交給 signInWithPassword', async () => {
    await loginAction(VALID, null, 'turnstile-token-1');
    expect(signInSpy).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
      captchaToken: 'turnstile-token-1',
    });
  });

  it('🔴 沒帶驗證碼 ⇒ 網站本身不擋, 照常呼叫(由 Supabase 決定)', async () => {
    await loginAction(VALID, null);
    expect(signInSpy).toHaveBeenCalledWith({ email: VALID.email, password: VALID.password });
  });

  it('驗證碼不是字串或太長 ⇒ 當成沒帶', async () => {
    await loginAction(VALID, null, 123 as unknown as string);
    await loginAction(VALID, null, 'x'.repeat(5000));
    expect(signInSpy.mock.calls).toEqual([
      [{ email: VALID.email, password: VALID.password }],
      [{ email: VALID.email, password: VALID.password }],
    ]);
  });

  it('Supabase 回 captcha_failed ⇒ 頂部顯示人機驗證失敗的說明、不導頁', async () => {
    signInSpy.mockRejectedValue(new AuthError('captcha_failed', 'captcha'));
    const r = await loginAction(VALID, null, 'bad');
    expect(r).toEqual({ formError: '無法確認不是機器人，請重新整理頁面後再試一次。' });
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});

// 資安修正片 3(2026-09-26):依 Email 登入限次的接線。
describe('loginAction · 登入限次', () => {
  it('🔴 被擋 ⇒ 回那一句、不呼叫 Supabase、不結算', async () => {
    reserveSpy.mockResolvedValue({ blocked: true });
    const result = await loginAction(VALID);
    expect(result).toEqual({ formError: '登入嘗試次數太多，請 15 分鐘後再試，或改用「忘記密碼」。' });
    expect(signInSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('佔格用的是驗證過的 Email', async () => {
    await loginAction(VALID);
    expect(reserveSpy).toHaveBeenCalledWith(VALID.email);
  });

  it('🔴 登入成功 ⇒ 結算 success, 而且在站別檢查與導頁之前', async () => {
    const order: string[] = [];
    settleSpy.mockImplementation(async () => void order.push('settle'));
    siteCheckSpy.mockImplementation(async () => (order.push('site'), null));
    redirectSpy.mockImplementation(() => order.push('redirect'));
    await loginAction(VALID);
    expect(settleSpy).toHaveBeenCalledWith('r1', 'success');
    expect(order).toEqual(['settle', 'site', 'redirect']);
  });

  // Sean 2026-09-26 Q30 甲:停用的帳號用正確密碼登入 ⇒ 看到停用說明, 而且【不算】登入失敗次數
  it('🔴 密碼正確但帳號已停用 ⇒ 回 site-disabled, 結算 success(不是 failed)、不導頁', async () => {
    siteCheckSpy.mockResolvedValue('site-disabled');
    expect(await loginAction(VALID)).toEqual({ siteError: 'site-disabled' });
    expect(settleSpy).toHaveBeenCalledWith('r1', 'success');
    expect(settleSpy).not.toHaveBeenCalledWith('r1', 'failed');
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('🔴 導頁丟出 NEXT_REDIRECT 也不會把成功改算成 release', async () => {
    redirectSpy.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(loginAction(VALID)).rejects.toThrow('NEXT_REDIRECT');
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledWith('r1', 'success');
  });

  it('🔴 密碼錯(credentials_invalid)⇒ 結算 failed', async () => {
    signInSpy.mockRejectedValue(new AuthError('credentials_invalid', 'x'));
    await loginAction(VALID);
    expect(settleSpy).toHaveBeenCalledWith('r1', 'failed');
  });

  it.each(['captcha_failed', 'email_confirmation_required', 'rate_limited', 'unknown'] as const)(
    '%s ⇒ 結算 release(不算失敗)',
    async (code) => {
      signInSpy.mockRejectedValue(new AuthError(code, 'x'));
      await loginAction(VALID);
      expect(settleSpy).toHaveBeenCalledWith('r1', 'release');
    },
  );

  it('非 AuthError 的例外 ⇒ 結算 release, 例外照樣往外丟', async () => {
    signInSpy.mockRejectedValue(new Error('network'));
    await expect(loginAction(VALID)).rejects.toThrow('network');
    expect(settleSpy).toHaveBeenCalledWith('r1', 'release');
  });

  it('欄位驗證沒過 ⇒ 不佔格', async () => {
    await loginAction({ email: '', password: '', remember: true });
    expect(reserveSpy).not.toHaveBeenCalled();
  });
});
