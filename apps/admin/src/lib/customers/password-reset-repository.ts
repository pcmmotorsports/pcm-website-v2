// 替客人寄重設密碼信(B2B 計畫 §9.9 片 D4b)。寄的是客人自己在「忘記密碼」也能寄出的同一封信;員工看不到連結與密碼。
import 'server-only';
import { isSyntheticEmailDomain } from '@pcm/schemas';
import { createSupabaseServiceClient, SupabaseDealerApplicationAdapter } from '@pcm/adapters/server';

/** 信裡的連結落到顧客站 /auth/confirm(與邀請信同一條路, 見 dealer-application-repository.ts)。固定網址, 不收參數。 */
export const PASSWORD_RESET_REDIRECT_TO = 'https://www.pcmmotorsports.com/auth/confirm';

export type ResetTarget = { kind: 'ok'; email: string } | { kind: 'not_found' | 'not_eligible' | 'mismatch' | 'failed' };

/**
 * 收件人由 customer ID 查登入系統(Auth)裡的 Email, 不收表單傳來的 Email。
 * 只有「Email + 密碼」登入、而且信箱是真的(不是我們替 LINE 帳號編的 *.pcmmotorsports.local)才能寄;
 * 判準與後台改信箱同一套(email-change-state.ts emailChangeEligibility 的兩個軸)。
 * 🔴 登入系統的 Email 要與客戶資料(customers.email, 員工確認視窗上看到的那個)一致才寄(Codex D4b R1):
 *    改信箱有「登入系統改了、客戶資料沒跟上」那條半套的路(email-change-action.ts)⇒ 不一致就不寄。
 */
export async function readPasswordResetTarget(customerId: string): Promise<ResetTarget> {
  try {
    const client = createSupabaseServiceClient();
    const { data, error } = await client.auth.admin.getUserById(customerId);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) return { kind: 'not_found' };
      throw error;
    }
    const user = data.user;
    if (!user) return { kind: 'not_found' };
    const email = user.email ?? '';
    const providers = (user.app_metadata?.providers as unknown) ?? [];
    const emailOnly = Array.isArray(providers) && providers.length > 0 && providers.every((p) => p === 'email');
    if (email === '' || isSyntheticEmailDomain(email) || !emailOnly) return { kind: 'not_eligible' };
    const row = await client.from('customers').select('email').eq('user_id', customerId).maybeSingle();
    if (row.error) throw row.error;
    if (!row.data) return { kind: 'not_found' };
    if ((row.data.email ?? '').toLowerCase() !== email.toLowerCase()) return { kind: 'mismatch' };
    return { kind: 'ok', email };
  } catch (err) {
    console.error('[password-reset] 讀取帳號失敗', { code: (err as { code?: unknown })?.code, status: (err as { status?: unknown })?.status });
    return { kind: 'failed' };
  }
}

export async function claimPasswordReset(p: { customerId: string; actor: string; requestId: string }): Promise<string> {
  return new SupabaseDealerApplicationAdapter(createSupabaseServiceClient()).claimPasswordReset(p);
}

/**
 * 寄信。accepted = Supabase 收下了;failed = 明確的 4xx(確定沒寄);unknown = 5xx / 逾時 / 斷線(可能已寄出)。
 * 🔴 log 只記錯誤碼與狀態碼, 不記 message(可能帶收件 Email)。
 */
/**
 * 等一件事最多 ms 毫秒;逾時回 fallback(原本那個請求不取消, 只是不再等它)。
 * 寄信、寄後重讀、寫結果稽核三個地方共用:任何一個卡住, 後面的稽核與回應員工都走不到(Codex D4b R1–R3)。
 */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** 寄信最多等這麼久(客戶頁 maxDuration 60 秒, 要留時間寫稽核與回應員工;Codex D4b R1)。 */
export const PASSWORD_RESET_SEND_TIMEOUT_MS = 15_000;

export async function sendPasswordResetEmail(email: string): Promise<'accepted' | 'failed' | 'unknown'> {
  try {
    const call = createSupabaseServiceClient().auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT_TO });
    const raced = await withTimeout<Awaited<typeof call> | 'timeout'>(call, PASSWORD_RESET_SEND_TIMEOUT_MS, 'timeout');
    if (raced === 'timeout') {
      console.error('[password-reset] 寄信逾時(結果不明)');
      return 'unknown';
    }
    const { error } = raced;
    if (!error) return 'accepted';
    const e = error as { code?: string; status?: number; name?: string };
    console.error('[password-reset] 寄信沒有成功', { code: e.code, status: e.status, name: e.name });
    const status = typeof e.status === 'number' ? e.status : 0;
    return status >= 400 && status < 500 ? 'failed' : 'unknown';
  } catch (err) {
    console.error('[password-reset] 寄信整段拋出(結果不明)', { name: (err as Error)?.name });
    return 'unknown';
  }
}

/** 寄完那次重讀最多等這麼久(Codex D4b R2:它卡住的話, 稽核與回應也走不到)。 */
export const RECHECK_TIMEOUT_MS = 5_000;

/**
 * 寄完再讀一次登入系統的 Email:寄送期間被改過 ⇒ 不能確定寄到的是這位客人(Codex D4b R1)。
 * 讀不到、逾時都回 null ⇒ 呼叫端當成結果不明(R2)。
 */
export async function readAuthEmail(customerId: string): Promise<string | null> {
  try {
    const call = createSupabaseServiceClient()
      .auth.admin.getUserById(customerId)
      .then(({ data, error }) => (error ? null : (data.user?.email ?? null)));
    return await withTimeout(call, RECHECK_TIMEOUT_MS, null);
  } catch {
    return null;
  }
}

/** 寫結果稽核最多等這麼久(Codex D4b R3)。 */
export const AUDIT_TIMEOUT_MS = 5_000;
