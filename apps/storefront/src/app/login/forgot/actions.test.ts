// actions.test.ts — requestPasswordResetAction 安全通道 unit test(忘記密碼接線片)
//
// 驗 plan §3-1(本片最高風險守門):驗證通過時,不論 Supabase 回成功 / 帳號不存在 / AuthError
// (含 rate_limited)/ 未知 AuthError,回傳值必須完全相同(空物件)—— 這條收斂若被拆開,
// 這頁就會變成帳號探測器。另驗:①驗證失敗才回 fieldErrors ②resolveSiteUrl() undefined → throw
// (不得靜默成功)③redirectTo 字面正確、不含任何來自 request 的值。
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only)+ '@/lib/site-url'。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { sendResetSpy, resolveSiteUrlSpy } = vi.hoisted(() => ({
  sendResetSpy: vi.fn(),
  resolveSiteUrlSpy: vi.fn(),
}));

vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      sendPasswordResetEmail: sendResetSpy,
      updatePassword: vi.fn(),
    }),
}));
vi.mock('@/lib/site-url', () => ({
  resolveSiteUrl: resolveSiteUrlSpy,
}));

import { requestPasswordResetAction } from './actions';

beforeEach(() => {
  sendResetSpy.mockReset();
  resolveSiteUrlSpy.mockReset();
  resolveSiteUrlSpy.mockReturnValue('https://shop.pcmmotorsports.com');
});
afterEach(() => vi.clearAllMocks());

describe('requestPasswordResetAction(plan §3-1 帳號列舉守門)', () => {
  it('驗證失敗(空 Email)→ fieldErrors、不呼叫 sendPasswordResetEmail', async () => {
    const result = await requestPasswordResetAction({ email: '' });
    expect(result.fieldErrors?.email).toBe('請填寫 Email');
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('驗證失敗(格式錯)→ fieldErrors、不呼叫 sendPasswordResetEmail', async () => {
    const result = await requestPasswordResetAction({ email: 'not-an-email' });
    expect(result.fieldErrors?.email).toBe('Email 格式不正確');
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('🔴 驗證通過:寄信成功 → 回空物件', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:帳號不存在(Supabase 對此靜默不報錯,同成功路徑)→ 回空物件(與成功案例 byte-identical)', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    const result = await requestPasswordResetAction({ email: 'nobody@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:AuthError(rate_limited)→ 仍回空物件(與成功案例 byte-identical、不得透出節流訊號)', async () => {
    sendResetSpy.mockRejectedValue(new AuthError('rate_limited', '429'));
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:未知 AuthError → 仍回空物件(不上洩任何錯誤細節)', async () => {
    sendResetSpy.mockRejectedValue(new AuthError('unknown', 'boom'));
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('resolveSiteUrl() 回 undefined → throw(不得靜默成功、不得呼叫 sendPasswordResetEmail)', async () => {
    resolveSiteUrlSpy.mockReturnValue(undefined);
    await expect(requestPasswordResetAction({ email: 'rider@pcm.com' })).rejects.toThrow();
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('redirectTo 字面正確且不含任何來自 request 的值(只用 resolveSiteUrl() 組)', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(sendResetSpy).toHaveBeenCalledWith({
      email: 'rider@pcm.com',
      redirectTo: 'https://shop.pcmmotorsports.com/auth/callback?next=/login/reset',
    });
  });
});
  // ══ 🔴🔴 板 `:443` ⟦b4-AUTHMAIL1⟧ 半A(2026-09-01)═══════════════════════════
  //   那一列的病:「**『還沒寄』與『寄不出去』在我們這一側沒有任何欄位分得開**」。
  //   而在這一片之前,那個 `catch {}` 把錯誤整個丟掉 ⇒ 客人打電話來,我們查不到任何東西。
  //
  //   🛑 **而上面那幾格【一個字都不能動】** —— 它們守的是「回應形狀 byte-identical」,
  //      那是帳號列舉防護。本段守的是**另一件事**:伺服器端有沒有留下紀錄。
  //   📌 **⇒ 「回應不得有差異」與「伺服器不得留紀錄」是兩件事,而它們曾經被寫成同一句。**
  describe('半A:server 端要留下分得開的紀錄(而回應形狀一個字不動)', () => {
    it('🔴 成功路徑 ⇒ 記 outcome=requested(⇒「還沒寄」不成立)', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      sendResetSpy.mockResolvedValue(undefined);
      const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
      expect(result).toEqual({}); // 🔵 回應形狀仍然是空物件
      expect(info).toHaveBeenCalledTimes(1);
      const payload = info.mock.calls[0]![1] as Record<string, unknown>;
      expect(payload.outcome).toBe('requested');
      expect('errorCode' in payload).toBe(false); // 成功時不得憑空長出 errorCode
      info.mockRestore();
    });

    it('🔴 provider 回錯 ⇒ 記 outcome=provider_error + errorCode(⇒ 知道是哪一類)', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      sendResetSpy.mockRejectedValue(new AuthError('rate_limited', '429'));
      const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
      expect(result).toEqual({}); // 🔵 回應與成功案例仍然 byte-identical
      const payload = info.mock.calls[0]![1] as Record<string, unknown>;
      expect(payload.outcome).toBe('provider_error');
      expect(payload.errorCode).toBe('rate_limited');
      info.mockRestore();
    });

    // 🔴 這一格守的是 PII —— 那行紀錄會流到 access log / 監控。
    it('🔴 紀錄裡【不得出現 email 本身】,只有長度', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      sendResetSpy.mockResolvedValue(undefined);
      await requestPasswordResetAction({ email: 'rider@pcm.com' });
      const [msg, payload] = info.mock.calls[0] as [string, Record<string, unknown>];
      const dump = msg + JSON.stringify(payload);
      expect(dump).not.toContain('rider@pcm.com');
      expect(dump).not.toContain('rider');
      // 🔵 而網域本身也不得出現 —— 公司網域會把範圍縮到一間公司
      expect(dump).not.toContain('pcm.com');
      // 🟢 正對照:長度那兩格要在,不然這一格在「什麼都沒記」時也會綠
      expect(payload.emailLength).toBe('rider@pcm.com'.length);
      expect(payload.emailDomainLength).toBe('pcm.com'.length);
      info.mockRestore();
    });

    // 🔵 負對照 —— 驗證失敗時不該記,不然 log 會被表單亂打灌爆
    it('🔵 驗證失敗 ⇒ 不記(那一發根本沒請 Auth 寄)', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      await requestPasswordResetAction({ email: 'not-an-email' });
      expect(info).not.toHaveBeenCalled();
      info.mockRestore();
    });
  });

