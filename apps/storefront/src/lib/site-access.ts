// lib/site-access.ts —— 站別規則,集中一處(B2B 計畫第四版 C 節 L1)。
//
// Sean 2026-09-25:一般會員不能登入經銷站、經銷會員不能登入一般站;申請中的人算一般會員。
// 用在:登入的四個入口(L2)、每次請求的後備檢查 proxy(L3)、建單前的最後一道(L4)。
//
// 🔴 兩層要分開(Fable 第四版 R2 必修 2):
//   這裡是「原始等級」—— 查 customers.tier、**不看站別、不降級**,給站別判斷用。
//   「顯示價格用的等級」(一般站一律 general)在 lib/tier.ts,不在這裡。
//   若這裡也降級,一般站永遠看不到 store,經銷商照樣登得進一般站。
//
// 「經銷會員」= tier 'store'(後台名稱「車行」):create_order 只有這一級收經銷價。
// premiumStore(後台「經銷」)今天收一般價 ⇒ 當一般會員(計畫 F 節 Q1 甲)。
import { toMemberTier, type MemberTier } from '@pcm/domain';
import type { SiteMode } from '@/lib/site-mode';

export type RawTier =
  | { readonly kind: 'guest' }
  | { readonly kind: 'member'; readonly tier: MemberTier }
  /** 查不到。retryable = 登入系統或網路暫時出錯,稍後再試可能就好。 */
  | { readonly kind: 'unknown'; readonly retryable: boolean };

export type SiteAccess =
  | { readonly kind: 'guest' }
  | { readonly kind: 'allowed'; readonly tier: MemberTier }
  | { readonly kind: 'wrong-site'; readonly reason: 'member-on-b2b' | 'dealer-on-retail' }
  | { readonly kind: 'unknown'; readonly retryable: boolean };

export const isDealerTier = (tier: MemberTier): boolean => tier === 'store';

/** 純邏輯:站別 × 原始等級 ⇒ 能不能在這個站登入。查不到一律回 unknown,由呼叫端決定怎麼擋(兩站都不可以放行登入)。 */
export function decideSiteAccess(mode: SiteMode, raw: RawTier): SiteAccess {
  if (raw.kind !== 'member') return raw;
  const dealer = isDealerTier(raw.tier);
  if (mode === 'b2b') return dealer ? { kind: 'allowed', tier: raw.tier } : { kind: 'wrong-site', reason: 'member-on-b2b' };
  return dealer ? { kind: 'wrong-site', reason: 'dealer-on-retail' } : { kind: 'allowed', tier: raw.tier };
}

/**
 * resolveRawTier 需要的 Supabase client 形狀。刻意只要這兩個呼叫:
 * proxy 用的是讀 request cookie 的 client(不能用 lib/supabase/server.ts,見計畫 L3 細節 1),
 * 登入入口與建單用的是 server client,兩者都傳得進來。
 */
type AuthErrorLike = { name?: string; status?: number } | null;
type TierRow = {
  data: { tier: unknown } | null;
  error: { code?: string; message?: string } | null;
  /** PostgREST 回應的 HTTP 狀態;連線失敗時 supabase-js 給 0。 */
  status?: number;
};
/**
 * resolveRawTier 需要的兩個動作。刻意不直接收 Supabase client:
 * proxy 用 `@supabase/ssr` 另建的 client 與 `lib/supabase/server.ts` 的 client 型別不同,
 * 直接做結構比對會讓 TypeScript 推導過深(TS2589);用 `tierReaderFrom()` 轉接即可。
 * 回傳是 PromiseLike:PostgrestBuilder 不是完整 Promise(Codex L1 R1 nit)。
 */
export type TierReader = {
  getUser: () => PromiseLike<{ data: { user: { id: string } | null }; error: AuthErrorLike }>;
  readTier: (userId: string) => PromiseLike<TierRow>;
};

/** 把任何 Supabase client 轉成 TierReader(查 customers.tier、條件是本人的 user_id)。 */
export function tierReaderFrom(client: {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null }; error: AuthErrorLike }> };
  // any:兩種 client 的查詢建構器型別不同,這裡只用得到 from().select().eq().maybeSingle() 這一條
  from: (table: 'customers') => any;
}): TierReader {
  return {
    getUser: () => client.auth.getUser(),
    readTier: (userId) => client.from('customers').select('tier').eq('user_id', userId).maybeSingle() as PromiseLike<TierRow>,
  };
}

/**
 * 「稍後再試可能就好」的判斷(Codex L1 R1 必修):依 HTTP 狀態與錯誤種類,不依有沒有錯誤碼。
 *   可重試:連線失敗(狀態 0 / 沒有狀態)、429 限流、5xx、以及資料庫已知的暫時錯誤碼
 *   (PGRST003 連線池逾時、08xxx 連線中斷、57014 查詢逾時、53xxx 資源不足)。
 *   不可重試:401 / 403 等明確拒絕 —— 那種再試也不會好,應該登出。
 * 判錯的代價:暫時錯誤判成不可重試 ⇒ 正常使用者被登出;永久錯誤判成可重試 ⇒ 錯站帳號卡在 503(不會被放行)。
 */
const TRANSIENT_PG_CODE = /^(PGRST003|08...|57014|53...)$/;
function isRetryableStatus(status: number | undefined): boolean {
  return status === undefined || status === 0 || status === 429 || status >= 500;
}

/**
 * 原始等級:驗使用者、查 customers.tier。任何不確定都回 unknown,**不回 general**。
 * 判準對齊 lib/tier.ts 的 resolveAuthenticatedTierStrict(user 帶著錯誤時不當成已驗證),
 * 另外多保留「可不可重試」這個分類(計畫 L3 細節 5:可重試回 503、不刪登入 cookie)。
 */
export async function resolveRawTier(reader: TierReader): Promise<RawTier> {
  let user: { id: string } | null;
  let authError: AuthErrorLike;
  try {
    const { data, error } = await reader.getUser();
    user = data?.user ?? null;
    authError = error;
  } catch (err) {
    console.error('[site-access] getUser 丟例外,當成暫時錯誤:', err);
    return { kind: 'unknown', retryable: true };
  }
  if (authError) {
    // 未登入的正常形狀:user = null + AuthSessionMissingError(lib/auth/verified-user.ts 檔頭)。
    // user 有值卻帶著錯誤時不當成訪客(Codex L1 R1 nit)。
    if (authError.name === 'AuthSessionMissingError' && !user) return { kind: 'guest' };
    // AuthRetryableFetchError = 連線層失敗;AuthUnknownError = 非 JSON 的 5xx;AuthApiError 看狀態(429、5xx 可重試,401/403 不可)
    const retryable =
      authError.name === 'AuthRetryableFetchError' ||
      authError.name === 'AuthUnknownError' ||
      (authError.name === 'AuthApiError' && isRetryableStatus(authError.status));
    console.error('[site-access] getUser 回報錯誤:', authError.name, authError.status);
    return { kind: 'unknown', retryable };
  }
  if (!user) return { kind: 'guest' };

  let row: TierRow;
  try {
    row = await reader.readTier(user.id);
  } catch (err) {
    console.error('[site-access] 查 customers.tier 丟例外,當成暫時錯誤:', err);
    return { kind: 'unknown', retryable: true };
  }
  if (row.error) {
    const retryable = TRANSIENT_PG_CODE.test(row.error.code ?? '') || isRetryableStatus(row.status);
    console.error('[site-access] 查 customers.tier 失敗:', row.status, row.error.code ?? '(無錯誤碼)', row.error.message);
    return { kind: 'unknown', retryable };
  }
  const tier = toMemberTier(row.data?.tier);
  if (tier === null) {
    console.error('[site-access] customers.tier 查無此列或是不認得的值:', row.data?.tier);
    return { kind: 'unknown', retryable: false };
  }
  return { kind: 'member', tier };
}
