// actions.test.ts — registerAction 信任邊界 unit test(M-1-14e-f1-b、#181 Q2=B、架構決策 A delivery 層)
//
// 驗:① server 端 validateRegister strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case;agree 不進 use-case)
//     ② agree≠true → zod literal(true) 擋 → fieldErrors.agree、不呼叫 use-case、不 redirect
//     ③ 空 phone → presence 專屬「請填寫手機」(D-g=A 必填 server 權威防線)、不呼叫 use-case
//     ④ 非空但格式錯 phone → zod「手機格式不正確」(逐欄、Q2=B server 也逐欄)、不呼叫 use-case
//     ⑤ 合法輸入 → signUp 收乾淨 AuthSignUpParams + redirect('/')(直登、needsEmailConfirmation=false)
//     ⑥ AuthError(email_already_registered)→ formError 頂部帳號層級通道(釘死 2)、不 redirect
//     ⑦ needsEmailConfirmation=true(Confirm email 重開)→ formError 提示、不 redirect
// node env;mock '@/lib/auth/composition'(避免載 server-only / @pcm/adapters/server)+ next/navigation redirect。
// registerCustomer 用真實 use-case(只委派 authService.signUp、不 mock)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { signUpSpy, redirectSpy } = vi.hoisted(() => ({
  signUpSpy: vi.fn(),
  redirectSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
}));
vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: signUpSpy,
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    }),
}));

import { registerAction } from './actions';

const VALID = {
  name: '王小明',
  email: 'rider@pcm.com',
  phone: '0912345678',
  password: 'hunter2hunter',
  agree: true,
};

beforeEach(() => {
  signUpSpy.mockReset();
  signUpSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: false });
  redirectSpy.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('registerAction(信任邊界 + #181 雙通道)', () => {
  it('strip 未知欄:client 夾帶 tier/wallet 不透傳 use-case;agree 不進 use-case', async () => {
    await registerAction({ ...VALID, tier: 'store', wallet_balance: 999999 });
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    // 只收 email + password + metadata{name,phone}、無 tier / wallet_balance / agree
    expect(signUpSpy).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
      metadata: { name: VALID.name, phone: VALID.phone },
    });
  });

  it('合法輸入 → 直登 redirect(POST_AUTH_REDIRECT=/)', async () => {
    await registerAction(VALID);
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('#190:合法 next → 直登導回 next(/account、同源白名單放行;codex 關卡2 regression)', async () => {
    await registerAction(VALID, '/account');
    expect(redirectSpy).toHaveBeenCalledWith('/account');
  });

  it('#190:惡意 next(絕對 URL)→ server 白名單擋成 /(open-redirect 防護;codex 關卡2 regression)', async () => {
    await registerAction(VALID, 'https://evil.com');
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('agree≠true → zod literal(true) 擋 → fieldErrors.agree、不呼叫 use-case、不 redirect', async () => {
    const result = await registerAction({ ...VALID, agree: false });
    expect(result?.fieldErrors?.agree).toBeDefined();
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('空 phone → presence 專屬「請填寫手機」(D-g=A server 權威)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, phone: '' });
    expect(result?.fieldErrors?.phone).toBe('請填寫手機');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('非空但格式錯 phone → zod「手機格式不正確」(Q2=B server 逐欄)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, phone: 'abc' });
    expect(result?.fieldErrors?.phone).toBe('手機格式不正確');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('全空白密碼 → presence「請填寫密碼」(codex 關卡2 修補:不得過 zod min(8) 註冊純空白密碼)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, password: '        ' });
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('AuthError(email_already_registered)→ formError「此 Email 已註冊」(頂部帳號層級)、不 redirect', async () => {
    signUpSpy.mockRejectedValue(new AuthError('email_already_registered', 'dup'));
    const result = await registerAction(VALID);
    expect(result?.formError).toBe('此 Email 已註冊');
    expect(result?.fieldErrors).toBeUndefined();
    // 🔵 2026-08-31 `-15` 加:真的錯【不得】走 notice 通道 —— 這是新通道的反向對照,
    //    沒有它的話「把所有東西都改成 formNotice」也會讓下面那一格綠。
    expect(result?.formNotice).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  // ══ 🔴 ⟦性別 B-2b⟧ 收工判準不是「表單上有那個下拉」,是【真的送得出去】 ══════════
  //    這兩格斷言的是 signUp 收到的 **metadata**(= 會進 auth.users.raw_user_meta_data
  //    ⇒ 由 trigger 搬進 customers.gender 的那一份)。
  //    ⚠️ 射程:它們證的是【我方送出去的東西】。**它們證不到 trigger 真的搬了** ——
  //       那一半的證據在拋棄式 PG（migration 20260831150000 那幾發),不在這裡。兩個宣稱。
  it('⟦B-2b⟧ 選了性別 → signUp 收到的 metadata.gender = 送出去的【代碼】', async () => {
    const result = await registerAction({ ...VALID, gender: 'female' });
    expect(signUpSpy).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ gender: 'female' }) }),
    );
    expect(result?.fieldErrors).toBeUndefined();
  });

  it('⟦B-2b⟧ 【不選】性別 → 照樣送得出去,而 metadata.gender 是 undefined(選填就是這樣成立的)', async () => {
    const result = await registerAction(VALID); // VALID 不含 gender
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    // 🔵 用 objectContaining 而不是 mock.calls[0][0].… —— 後者 TS 判它可能 undefined(TS2532),
    //    而 typecheck 抓到了它, 測試沒有。**測試綠與 typecheck 綠是兩件事。**
    expect(signUpSpy).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.not.objectContaining({ gender: expect.anything() }) }),
    );
    // 🔴 而它【不得】變成一個逐欄錯 —— 選填欄位擋住註冊是本片最該防的失敗。
    expect(result?.fieldErrors).toBeUndefined();
    expect(result?.formError).toBeUndefined();
  });

  it('⟦B-2b·對照⟧ 送一個【值域外】的性別 → 逐欄錯,而且 signUp 一次都沒被呼叫', async () => {
    const result = await registerAction({ ...VALID, gender: '女' }); // 中文顯示字面不是代碼
    expect(result?.fieldErrors?.gender).toBeDefined();
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  // 🔵 2026-08-31 `-15`:這一格從 formError 改判 formNotice。
  //    ⚠️ 舊斷言 `result?.formError).toContain('Email 驗證')` 會【繼續通過】如果我只加新通道
  //    而沒改舊斷言 —— 所以這裡把「它【不】在錯誤通道」也釘死,否則這一片等於沒做。
  it('needsEmailConfirmation=true(Confirm email 重開)→ formNotice(非錯誤通道)、不 redirect', async () => {
    signUpSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: true });
    const result = await registerAction(VALID);
    expect(result?.formNotice).toContain('Email 驗證');
    // 🔴 這一行才是本片的重點:成功訊息**不得**走錯誤通道(它會被 .auth-err 紅底呈現 +
    //    被 clearErr 一按鍵清掉 ⇒ 客人重送 ⇒ 「此 Email 已註冊」⇒ 以為註冊失敗)。
    expect(result?.formError).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

});

// ── 🔴 `#858` 片0-a(codex R1 MF4):合成信箱網域**不得走到 signUp** ──────────────
//
// 為什麼加在這裡而不是 `field-validation.test.ts`:那支測的是**驗證函式**;
// 這一格要證的是**這條路真的接起來了** —— `registerAction` → `validateRegister` → denylist
// ⇒ 斷言的重點不只是「回了 fieldErrors」,而是 **`signUp` 一次都沒被呼叫**。
//
// ⚠️ **這一格擋不住的**:攻擊者直呼 GoTrue `signUp`(公開端點、anon key)⇒ **繞過本檔整條路**。
//    那道缺口在平台面板設定、不在 repo 裡、**未量測** —— 見
//    `apps/admin/src/lib/customers/manual-customer.ts` 的威脅模型段。
//    **本格證明的是「我方表單這條路是關的」,不是「這個信箱註冊不到」。**
describe('registerAction — 合成信箱網域 denylist(server action 這一道)', () => {
  it('🔴 LINE 合成網域 ⇒ 逐欄錯 + **signUp 一次都沒被呼叫**', async () => {
    const result = await registerAction({ ...VALID, email: 'line_u1@line.pcmmotorsports.local' });
    expect(result?.fieldErrors?.email).toBeTruthy();
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('🔴🔴 `#858` 的 manual 網域 ⇒ 同樣擋下(片0-a 把判斷式擴到基底網域之後才成立)', async () => {
    const result = await registerAction({ ...VALID, email: 'manual_r4nd0m@manual.pcmmotorsports.local' });
    expect(result?.fieldErrors?.email).toBeTruthy();
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('🔴 負對照:真客人的信箱**照樣走得到** signUp(證明上面兩格不是恆真)', async () => {
    await registerAction({ ...VALID, email: 'rider@example.com' });
    expect(signUpSpy).toHaveBeenCalledTimes(1);
  });
});
