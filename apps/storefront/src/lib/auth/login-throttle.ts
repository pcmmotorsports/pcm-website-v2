// lib/auth/login-throttle.ts — 登入限次:依 Email 記錄登入嘗試(資安修正片 3, 2026-09-26)
//
// 計畫:~/pcm-mailbox/計畫-片3-登入限次-migration-20260926.md 第 2 版;migration 20260926110000。
// 同一個 Email 15 分鐘內登入失敗 10 次 ⇒ 登入 action 先擋, 不再把密碼送去 Supabase。規則住在資料庫那三支函式。
//
// 🔴 為什麼用 service_role(Sean 2026-09-26 Q25 甲, ADR-0005 §8.4):三支函式只給 service_role。
//    開給 anon 的話, 外人不經人機驗證就能一直佔格, 讓任何客人登不進去。
//    本檔只包那三支函式, 不回傳 client 本身;登入用的 client 維持 lib/auth/composition.ts 那一個。
// 🔴 開關:LOGIN_THROTTLE_ENABLED 不是 'true' 時完全不呼叫資料庫(上線順序與退回見計畫第五、六節)。
// 🔴 資料庫呼叫失敗(含建 client 失敗, 例如某一站沒設 SUPABASE_SERVICE_ROLE_KEY)⇒ 放行。
//    理由:人機驗證和防火牆還在, 擋下的話資料庫一出問題全站就登不進去。
//    每次放行都印 `[login-throttle] fail-open`, 查 log 才找得到它是不是一直在放行。

import 'server-only';
// eslint-disable-next-line no-restricted-imports -- 受控例外(Sean 2026-09-26 Q25 甲、ADR-0005 §8.4):登入限次三支函式(20260926110000)只 GRANT 給 service_role;本檔 server-only、只包那三支、不回傳 client、只被 login / reset 兩支 action 引用、不入 client bundle。
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/** 同一個 Email 登入失敗太多次時, 登入頁顯示的那一句。 */
export const LOGIN_THROTTLED_COPY = '登入嘗試次數太多，請 15 分鐘後再試，或改用「忘記密碼」。';

export type LoginAttemptOutcome = 'failed' | 'success' | 'release';
/** blocked = 這個 Email 目前要擋;id = 這次佔的那一格(放行但沒佔到格時是 null)。 */
export type LoginReservation = { blocked: true } | { blocked: false; id: string | null };

export function loginThrottleEnabled(): boolean {
  return process.env.LOGIN_THROTTLE_ENABLED === 'true';
}

/** 登入前佔一格。開關關著或資料庫出錯 ⇒ 放行且不佔格。 */
export async function reserveLoginAttempt(email: string): Promise<LoginReservation> {
  if (!loginThrottleEnabled()) return { blocked: false, id: null };
  try {
    const { data, error } = await createSupabaseServiceClient().rpc('auth_login_attempt_reserve', { p_email: email });
    if (error) throw error;
    const r = data as { allowed?: unknown; id?: unknown } | null;
    if (r?.allowed === false) return { blocked: true };
    if (r?.allowed === true && typeof r.id === 'string') return { blocked: false, id: r.id };
    throw new Error(`回傳形狀不對:${JSON.stringify(data)}`);
  } catch (err) {
    console.error('[login-throttle] fail-open 佔格失敗, 放行:', err);
    return { blocked: false, id: null };
  }
}

/** 登入結算。沒佔到格就不做事;失敗只記紀錄, 不影響回給客人的結果。 */
export async function settleLoginAttempt(id: string | null, outcome: LoginAttemptOutcome): Promise<void> {
  if (!id) return;
  try {
    const { error } = await createSupabaseServiceClient().rpc('auth_login_attempt_settle', { p_id: id, p_outcome: outcome });
    if (error) throw error;
  } catch (err) {
    console.error('[login-throttle] 結算失敗(failed / release 那一格 2 分鐘後自動不算):', outcome, err);
  }
}

/** 設定新密碼成功後解除限制。回 true = 已解除(或開關關著不用解);false = 呼叫失敗。 */
export async function clearLoginAttempts(email: string): Promise<boolean> {
  if (!loginThrottleEnabled()) return true;
  try {
    const { error } = await createSupabaseServiceClient().rpc('auth_login_attempt_clear', { p_email: email });
    if (error) throw error;
    return true;
  } catch (err) {
    console.error('[login-throttle] 解除限制失敗:', err);
    return false;
  }
}
