// lib/site-access.ts —— 站別規則(B2B 計畫第四版 C 節 L1)。
// 一般會員(含申請中、premiumStore)只能登入一般站;經銷會員(tier = 'store')只能登入經銷站。
import { describe, expect, it } from 'vitest';
import { decideSiteAccess, resolveRawTier, tierReaderFrom, type RawTier } from './site-access';

describe('decideSiteAccess', () => {
  const member = (tier: string): RawTier => ({ kind: 'member', tier: tier as never });

  it('訪客兩站都是訪客', () => {
    expect(decideSiteAccess('retail', { kind: 'guest' })).toEqual({ kind: 'guest' });
    expect(decideSiteAccess('b2b', { kind: 'guest' })).toEqual({ kind: 'guest' });
  });

  it('經銷站只接受 store', () => {
    expect(decideSiteAccess('b2b', member('store'))).toEqual({ kind: 'allowed', tier: 'store' });
    for (const t of ['general', 'premiumStore']) {
      expect(decideSiteAccess('b2b', member(t))).toEqual({ kind: 'wrong-site', reason: 'member-on-b2b' });
    }
  });

  it('一般站拒絕 store,其他都接受(premiumStore 當一般會員,F 節 Q1 甲)', () => {
    expect(decideSiteAccess('retail', member('store'))).toEqual({ kind: 'wrong-site', reason: 'dealer-on-retail' });
    expect(decideSiteAccess('retail', member('general'))).toEqual({ kind: 'allowed', tier: 'general' });
    expect(decideSiteAccess('retail', member('premiumStore'))).toEqual({ kind: 'allowed', tier: 'premiumStore' });
  });

  // 🔴 Codex R3 必修 1:查不到等級時兩站都不可以當成「可以」—— 一般站若放行,經銷帳號就登得進一般站。
  it('查不到等級 ⇒ 兩站都回 unknown,不回 allowed', () => {
    for (const mode of ['retail', 'b2b'] as const) {
      expect(decideSiteAccess(mode, { kind: 'unknown', retryable: true })).toEqual({ kind: 'unknown', retryable: true });
      expect(decideSiteAccess(mode, { kind: 'unknown', retryable: false })).toEqual({ kind: 'unknown', retryable: false });
    }
  });
});

/** 假的 Supabase client:只實作 resolveRawTier 用到的呼叫,並記下查了哪張表、哪個使用者。 */
function fakeReader(
  auth: { user: { id: string } | null; error: { name: string; status?: number } | null } | 'throw',
  tierRow: { data: { tier: unknown } | null; error: { code?: string; message: string } | null; status?: number },
) {
  const seen: { table?: string; cols?: string; col?: string; value?: string } = {};
  // 走真正的轉接函式 tierReaderFrom,驗到「查的是 customers、條件是本人的 user_id」
  const reader = tierReaderFrom({
    auth: {
      getUser: async () => {
        if (auth === 'throw') throw new Error('network down');
        return { data: { user: auth.user }, error: auth.error };
      },
    },
    from: (table: string) => {
      seen.table = table;
      return {
        select: (cols: string) => {
          seen.cols = cols;
          return {
            eq: (col: string, value: string) => {
              seen.col = col;
              seen.value = value;
              return { maybeSingle: async () => tierRow };
            },
          };
        },
      };
    },
  });
  return { reader, seen };
}
const r = async (...args: Parameters<typeof fakeReader>) => resolveRawTier(fakeReader(...args).reader);

const U = { user: { id: 'u-1' }, error: null };
const ok = (tier: string) => ({ data: { tier }, error: null, status: 200 });

describe('resolveRawTier', () => {
  it('未登入(AuthSessionMissingError、user = null)⇒ guest', async () => {
    expect(await r({ user: null, error: { name: 'AuthSessionMissingError' } }, ok('store'))).toEqual({ kind: 'guest' });
  });
  it('沒有 user 也沒有錯誤 ⇒ guest', async () => {
    expect(await r({ user: null, error: null }, ok('store'))).toEqual({ kind: 'guest' });
  });
  it('user 有值卻帶 AuthSessionMissingError ⇒ 不當成訪客', async () => {
    expect((await r({ user: { id: 'u-1' }, error: { name: 'AuthSessionMissingError' } }, ok('store'))).kind).toBe('unknown');
  });
  it('三種合法等級都照原值回傳,而且查的是本人那一列', async () => {
    for (const tier of ['general', 'store', 'premiumStore']) {
      const { reader, seen } = fakeReader(U, ok(tier));
      expect(await resolveRawTier(reader)).toEqual({ kind: 'member', tier });
      // 欄位名打錯(例如 'teir')編譯期不會叫(client 沒帶資料庫型別),上線後每個登入者都會被登出 ⇒ 由這裡擋(Fable L1 R2 consider 1)
      expect(seen).toEqual({ table: 'customers', cols: 'tier', col: 'user_id', value: 'u-1' });
    }
  });
  // 🔴 可重試的判斷(Codex L1 R1 必修):判錯的代價是正常使用者被登出。
  it('登入系統暫時錯誤 ⇒ 可重試', async () => {
    for (const error of [
      { name: 'AuthRetryableFetchError', status: 0 },
      { name: 'AuthUnknownError', status: 500 },
      { name: 'AuthApiError', status: 429 },
      { name: 'AuthApiError', status: 500 },
    ]) {
      expect(await r({ user: null, error }, ok('store'))).toEqual({ kind: 'unknown', retryable: true });
    }
  });
  it('登入系統明確拒絕(401 過期、403)⇒ 不可重試;user 帶著錯誤也不當成已驗證', async () => {
    expect(await r({ user: null, error: { name: 'AuthApiError', status: 401 } }, ok('store'))).toEqual({ kind: 'unknown', retryable: false });
    expect(await r({ user: { id: 'u-1' }, error: { name: 'AuthApiError', status: 403 } }, ok('store'))).toEqual({
      kind: 'unknown',
      retryable: false,
    });
  });
  it('getUser 丟例外 ⇒ 可重試', async () => {
    expect(await r('throw', ok('store'))).toEqual({ kind: 'unknown', retryable: true });
  });
  it('查 customers 暫時錯誤(連線失敗、逾時、5xx)⇒ 可重試', async () => {
    for (const row of [
      { data: null, error: { message: 'fetch failed' }, status: 0 },
      { data: null, error: { code: 'PGRST003', message: 'pool timeout' }, status: 504 },
      { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 },
      { data: null, error: { code: '08006', message: 'connection failure' }, status: 503 },
      // 暫時錯誤碼本身就足以判可重試,不靠 5xx(Fable L1 R2 nit)
      { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 400 },
    ]) {
      expect(await r(U, row)).toEqual({ kind: 'unknown', retryable: true });
    }
  });
  it('查 customers 明確拒絕、查無此列、或等級不認得 ⇒ 不可重試', async () => {
    expect(await r(U, { data: null, error: { code: '42501', message: 'denied' }, status: 403 })).toEqual({ kind: 'unknown', retryable: false });
    expect(await r(U, { data: null, error: { message: 'Forbidden' }, status: 403 })).toEqual({ kind: 'unknown', retryable: false });
    expect(await r(U, { data: null, error: null, status: 200 })).toEqual({ kind: 'unknown', retryable: false });
    expect(await r(U, { data: { tier: 'vip' }, error: null, status: 200 })).toEqual({ kind: 'unknown', retryable: false });
  });
});
