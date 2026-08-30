// route.test.ts — /api/auth/line/callback GET handler 測試(M-1-14e-f2-a2)
//
// node env;mock 'server-only' + next/headers cookies(get/delete)+ next/navigation redirect(throw)+
// @/lib/auth/line(exchange/verify)+ @/lib/auth/line-admin(authenticateLineUser)+ @/lib/supabase/server(verifyOtp)。
// 驗:state 不符 / 缺 code → error redirect;happy path → POST_AUTH_REDIRECT;collision_not_line → error;
//     verifyOtp 錯 → error;且每次都刪 state/nonce cookie(用後即刪)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  redirectSpy, getSpy, deleteSpy, exchangeSpy, verifyIdSpy, authLineSpy, verifyOtpSpy, recordSpy,
} =
  vi.hoisted(() => ({
    redirectSpy: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    getSpy: vi.fn(),
    deleteSpy: vi.fn(),
    exchangeSpy: vi.fn(),
    verifyIdSpy: vi.fn(),
    authLineSpy: vi.fn(),
    verifyOtpSpy: vi.fn(),
    recordSpy: vi.fn(),
  }));

vi.mock('next/navigation', () => ({ redirect: redirectSpy }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: getSpy, delete: deleteSpy }),
}));
vi.mock('@/lib/auth/line', async (orig) => {
  // 保留真常數(cookie 名 / path)、只 mock fetch 類函式。
  const actual = await orig<typeof import('@/lib/auth/line')>();
  return {
    ...actual,
    exchangeCodeForToken: exchangeSpy,
    verifyIdToken: verifyIdSpy,
  };
});
vi.mock('@/lib/auth/line-admin', () => ({ authenticateLineUser: authLineSpy }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { verifyOtp: verifyOtpSpy } }),
}));
// 板 :395 —— 記錄那一支被 mock 掉,測的是【route 送了什麼進去】,不是它寫不寫得成 DB。
vi.mock('@/lib/auth/callback-event', () => ({ recordLineCallbackEvent: recordSpy }));

import { GET } from './route';

// state cookie 值固定、query 帶相同值 → safeEqual 通過。
const STATE = 'state-value-1234';
const NONCE = 'nonce-value-5678';

function cookieStore(stateVal?: string, nonceVal?: string, nextVal?: string) {
  getSpy.mockImplementation((name: string) => {
    if (name === 'line_oauth_state' && stateVal !== undefined) return { value: stateVal };
    if (name === 'line_oauth_nonce' && nonceVal !== undefined) return { value: nonceVal };
    if (name === 'line_oauth_next' && nextVal !== undefined) return { value: nextVal };
    return undefined;
  });
}

function req(query: string) {
  return new Request(`http://localhost:3000/api/auth/line/callback${query}`);
}

beforeEach(() => {
  redirectSpy.mockClear();
  deleteSpy.mockClear();
  exchangeSpy.mockReset().mockResolvedValue({ idToken: 'idtok' });
  verifyIdSpy.mockReset().mockResolvedValue({ sub: 'U' + 'e'.repeat(32), name: 'T', email: null });
  authLineSpy.mockReset().mockResolvedValue({ ok: true, hashedToken: 'htok' });
  verifyOtpSpy.mockReset().mockResolvedValue({ error: null });
  recordSpy.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('/api/auth/line/callback GET', () => {
  it('happy path:state 相符 + 全鏈成功 → redirect POST_AUTH_REDIRECT(/)', async () => {
    cookieStore(STATE, NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
    expect(exchangeSpy).toHaveBeenCalledWith('abc');
    expect(verifyIdSpy).toHaveBeenCalledWith('idtok', NONCE);
    expect(verifyOtpSpy).toHaveBeenCalledWith({ token_hash: 'htok', type: 'email' });
    // 用後即刪三 cookie:state + nonce + next(#190)
    expect(deleteSpy).toHaveBeenCalledTimes(3);
  });

  it('state 不符 → error redirect、不換 token', async () => {
    cookieStore('DIFFERENT', NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledTimes(3); // 仍清三 cookie(含 next)
  });

  it('#190:happy path 帶合法 next cookie → 導回 next(/account)', async () => {
    cookieStore(STATE, NONCE, '/account');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/account');
  });

  it('#190:next cookie 為惡意值 → sink 白名單擋成 /(縱深)', async () => {
    cookieStore(STATE, NONCE, '//evil.com');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('🔴 #190 MF-2:失敗 + 有 next cookie → error redirect【帶著 next】', async () => {
    // 🔴 next cookie 在 :108-110 被刪掉(單次有效、那是對的)⇒ 不把值搬進 URL 的話,
    //    客人重試登入時已經沒有東西可以帶他回去,而那可能是【已經扣款完成的】結帳回呼頁。
    cookieStore('DIFFERENT', NONCE, '/checkout/callback?order=abc');
    const enc = encodeURIComponent('/checkout/callback?order=abc');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      `NEXT_REDIRECT:/login?error=line&next=${enc}`,
    );
    expect(deleteSpy).toHaveBeenCalledTimes(3); // cookie 仍然照刪,單次有效那道防線沒被拆
  });

  it('🔴 #190 MF-2:失敗 + 惡意 next cookie → 白名單擋成 /,不原樣回填', async () => {
    cookieStore('DIFFERENT', NONCE, '//evil.example.com');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      `NEXT_REDIRECT:/login?error=line&next=${encodeURIComponent('/')}`,
    );
  });

  it('缺 code(LINE 取消授權)→ error redirect', async () => {
    cookieStore(STATE, NONCE);
    await expect(GET(req(`?state=${STATE}&error=access_denied`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it('缺 state cookie(過期/無)→ error redirect', async () => {
    cookieStore(undefined, NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it('collision_not_line(防冒登入)→ error redirect、不發 session', async () => {
    cookieStore(STATE, NONCE);
    authLineSpy.mockResolvedValue({ ok: false, reason: 'collision_not_line' });
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(verifyOtpSpy).not.toHaveBeenCalled();
  });

  it('verifyOtp 失敗 → error redirect', async () => {
    cookieStore(STATE, NONCE);
    verifyOtpSpy.mockResolvedValue({ error: { message: 'otp invalid' } });
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
  });

  it('LINE token 交換 throw → catch 後 error redirect(不上洩)', async () => {
    cookieStore(STATE, NONCE);
    exchangeSpy.mockRejectedValue(new Error('LINE token exchange failed: 400'));
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
  });
  // ══ 板 :395 登入回呼可查性 ══════════════════════════════════════════════
  //
  // 🔴 **這一組測的是「兩個世界分得開」,不是「有呼叫」。**
  //    只驗「recordLineCallbackEvent 被叫了」的話,一個把每條路都送同一個 reason code 的實作
  //    **照樣全綠** —— 而那正是本片要修的病(原本 5 條失敗路徑在紀錄上是同一列)。
  //    ⇒ 所以每一格都釘**那一條路獨有的 reason code**。
  // 🔵 **codex R5:~~原本這個 describe 叫「每條路各自一個 reason code」~~ —— 寫大了。**
  //    `upstream_error` **本來就被好幾條路共用**(換 token / 驗 id_token / 任何 throw),
  //    那是 `route.ts` catch 那格明寫的取捨,不是漏掉。
  //    ⇒ 正確的宣稱是:**比對之前的五條路各自分得開**,而比對之後的失敗分四種。
  describe('板 :395 —— reason code 分得開(比對前五條各一;比對後四種)', () => {
    const cases: Array<[string, () => void, string, string]> = [
      ['缺 code', () => cookieStore(STATE, NONCE), `?state=${STATE}`, 'missing_code'],
      ['缺 state query', () => cookieStore(STATE, NONCE), '?code=abc', 'missing_state_param'],
      ['缺 state cookie', () => cookieStore(undefined, NONCE), `?code=abc&state=${STATE}`, 'missing_state_cookie'],
      ['缺 nonce cookie', () => cookieStore(STATE, undefined), `?code=abc&state=${STATE}`, 'missing_nonce_cookie'],
      ['state 對不起來', () => cookieStore('other-value-000', NONCE), `?code=abc&state=${STATE}`, 'state_mismatch'],
    ];
    it.each(cases)('%s → failure/%s', async (_label, setup, query, expected) => {
      setup();
      await expect(GET(req(query))).rejects.toThrow('NEXT_REDIRECT:');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy.mock.calls[0]?.[0]).toBe('failure');
      expect(recordSpy.mock.calls[0]?.[1]).toBe(expected);
      // 🔵 **fable R3 之後 state 整個不送了**(理由見 migration 檔頭)⇒ 釘住參數恰好兩個。
      //    ⚠️ 沒有這一行,有人把 state 加回來不會有任何東西紅 —— 而那條路是【無界】的:
      //       `api/auth/line/start` 無認證、每一發 GET 就鑄一組新的 state+cookie。
      expect(recordSpy.mock.calls[0]).toHaveLength(2);
    });

    it('負對照:五個 reason code 兩兩相異(這把尺分得出東西)', () => {
      const codes = cases.map((c) => c[3]);
      expect(new Set(codes).size).toBe(codes.length);
    });

    it('collision_not_line → 沿用 line-admin 的原因碼', async () => {
      cookieStore(STATE, NONCE);
      authLineSpy.mockResolvedValue({ ok: false, reason: 'collision_not_line' });
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:');
      // 🔵 codex nit:釘【恰好一次】—— 只用 toHaveBeenCalledWith 的話,實作重複記錄同一次
      //    callback 仍然全綠。
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith('failure', 'collision_not_line');
    });

    // 🔵 **codex R5:`invalid_sub` 這一條路【原本沒有任何測試】。**
    //    而它與 `collision_not_line` 走同一個 `if (!result.ok)` ⇒ 很容易以為「測過了」。
    //    ⚠️ 兩者共用一行程式,而**共用一行不代表兩個值都被傳對過** ——
    //       一個把 reason 寫死成 'collision_not_line' 的實作,在補這一格之前是全綠的。
    it('invalid_sub → 也照樣沿用 line-admin 的原因碼(不是寫死另一個)', async () => {
      cookieStore(STATE, NONCE);
      authLineSpy.mockResolvedValue({ ok: false, reason: 'invalid_sub' });
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith('failure', 'invalid_sub');
    });

    it('verifyOtp 錯 → session_verify_failed', async () => {
      cookieStore(STATE, NONCE);
      verifyOtpSpy.mockResolvedValue({ error: { message: 'otp invalid' } });
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith('failure', 'session_verify_failed');
    });

    it('上游 throw → upstream_error', async () => {
      cookieStore(STATE, NONCE);
      exchangeSpy.mockRejectedValue(new Error('LINE token exchange failed: 400'));
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith('failure', 'upstream_error');
    });

    it('成功 → success / reason=null', async () => {
      cookieStore(STATE, NONCE);
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
      expect(recordSpy).toHaveBeenCalledTimes(1);
      expect(recordSpy).toHaveBeenCalledWith('success', null);
    });

    it('safeEqual 通過之後的路徑也只送兩個參數(state 不會偷偷跑回來)', async () => {
      cookieStore(STATE, NONCE);
      verifyOtpSpy.mockResolvedValue({ error: { message: 'x' } });
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:');
      expect(recordSpy.mock.calls[0]).toHaveLength(2);
    });

    // 🔴 fail-open 的**行為**守門:記錄那一支 throw ⇒ 客人照樣登得進去。
    //    ⚠️ 沒有這一格的話,`route.ts` 那個 catch 裡的 `console.warn` 被刪掉**不會有任何東西紅**。
    //    🔵 codex R5:~~原句寫的是「那行 `.catch(() => {})`」~~ —— 那是前輪改動留下的殘句,
    //       那個形狀早就換成 try/catch 了(換的理由見 `route.ts` 同一段)。
    it('fail-open:記錄整支 throw ⇒ 登入照常完成(成功路徑仍導 /)', async () => {
      cookieStore(STATE, NONCE);
      recordSpy.mockRejectedValue(new Error('boom'));
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
    });

    it('fail-open 的正對照:記錄同步 throw 也不擋(不是只擋得住 rejected promise)', async () => {
      cookieStore(STATE, NONCE);
      recordSpy.mockImplementation(() => {
        throw new Error('sync boom');
      });
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
    });

    // 🔵 **codex R2 nit:那個 catch 裡的 `console.warn` 沒有回歸守門。**
    //    刪掉它,上面兩格 fail-open 照樣全綠 ⇒ 而那個世界會【一個字也沒有】,
    //    與「沒有人登入」完全相同。⇒ 這一格釘住「它會出聲」,並釘住【只送一個字串】(零 PII)。
    // 🔵 **codex R5:~~原本這格叫「整支模組 throw」~~ —— 寫大了。**
    //    它測的是**已經載入成功的那支函式**回了 rejected promise;
    //    **模組在 import 期就 throw 的那一種,本測試碰不到**(那時 `route.ts` 自己也載不起來,
    //    `GET` 根本不會被呼叫 —— 詳 `route.ts` 那段 try/catch 的註解)。
    it('記錄函式 reject ⇒ 必須出聲(固定前綴、只送一個字串、不夾帶敏感值)', async () => {
      cookieStore(STATE, NONCE);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      recordSpy.mockRejectedValue(new Error(`boom ${STATE}`));
      await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toHaveLength(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('[auth.callback]');
      expect(String(warn.mock.calls[0]?.[0])).not.toContain(STATE);
      warn.mockRestore();
    });
  });
});
