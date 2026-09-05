import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAuthService } from '@pcm/ports';
import {
  AuthError,
  type AuthCredentials,
  type AuthResult,
  type AuthSignUpParams,
} from '@pcm/domain';
import { mapSupabaseAuthError } from './mappers/auth-error';

/**
 * SupabaseAuthAdapter:Supabase 真實 IAuthService 實作(M-1-14e-1)。
 *
 * 對齊:
 * - `packages/ports/src/IAuthService.ts`(signUp / signInWithPassword / signOut 合約)
 * - PRD `docs/specs/m-1-14-customer-schema.md` §8.1
 * - `SupabaseCustomerAdapter` / `SupabaseWalletAdapter` pattern(constructor DI、薄包、error 映射)
 *
 * **注入 client 的前提(本 adapter 不負責建 client):**
 * - 須注入「已依執行環境正確綁定 auth storage / cookies 的 SupabaseClient」:server action / route handler
 *   端應為 request-scoped、能讀寫 session cookie 的 client。注入裸 `createSupabaseAnonClient()`(無 session
 *   持久化)會令 `signInWithPassword` 後 session 不落地、後續 RLS authenticated 查詢拿不到 `auth.uid()`。
 * - client factory(`@supabase/ssr` createBrowserClient / createServerClient 或等價)屬 f 段 wire-up 前置決策
 *   (見 PRD §8.4 偏離 + backlog),非本 adapter 範圍。
 *
 * **server-only**:從 `@pcm/adapters/server` export(register / login 走 server action、對齊「會員驗證在 server」
 * 鐵則 + wallet adapter 前例);不從 root public `@pcm/adapters` export。
 *
 * register 後 customers row 由 DB handle_new_auth_user trigger 自動建、本 adapter **不顯式 insert**(PRD Q2=A)。
 * 失敗一律映射成 domain AuthError throw(mappers/auth-error.ts),不上洩 Supabase error。
 */
export class SupabaseAuthAdapter implements IAuthService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * 註冊。metadata 只送 { name, phone } 進 options.data(→ raw_user_meta_data、供 trigger 建 row);
   * needsEmailConfirmation = signUp 後無 session(Phase 1 Q1=A Confirm email OFF 時應恆 false)。
   */
  async signUp(params: AuthSignUpParams): Promise<AuthResult> {
    const { data, error } = await this.supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        // 🔵 gender 選填:`undefined` 時**不放這個 key** —— 而那不是潔癖,是契約:
        //    trigger 那側用 `raw_user_meta_data->>'gender'` 取值,
        //    key 不在 ⇒ 取到 SQL NULL ⇒ 收成 NULL。放一個 `undefined` 進去
        //    會被 JSON 序列化吃掉,結果一樣,而【看得出意圖】的寫法是不放。
        data: {
          name: params.metadata.name,
          phone: params.metadata.phone,
          ...(params.metadata.gender ? { gender: params.metadata.gender } : {}),
        },
      },
    });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
    if (!data.user) {
      throw new AuthError('unknown', 'signUp 未回傳 user');
    }
    return {
      userId: data.user.id,
      email: data.user.email ?? params.email,
      needsEmailConfirmation: data.session === null,
    };
  }

  /** 密碼登入。正常成功有 session → needsEmailConfirmation = false(若 provider 回 session=null 則 true、對齊 signUp);登入失敗(憑證錯 / email 未驗證等)由 mapSupabaseAuthError 映射成 domain AuthError。 */
  async signInWithPassword(creds: AuthCredentials): Promise<AuthResult> {
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
    if (!data.user) {
      throw new AuthError('unknown', 'signInWithPassword 未回傳 user');
    }
    return {
      userId: data.user.id,
      email: data.user.email ?? creds.email,
      needsEmailConfirmation: data.session === null,
    };
  }

  /** 登出(清注入 client 綁定的 session)。 */
  async signOut(): Promise<void> {
    const { error } = await this.supabase.auth.signOut();
    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }

  /** 寄出忘記密碼重設信。redirectTo 由呼叫端組好、本 adapter 不碰站台設定。 */
  async sendPasswordResetEmail(params: { email: string; redirectTo: string }): Promise<void> {
    const { error } = await this.supabase.auth.resetPasswordForEmail(params.email, {
      redirectTo: params.redirectTo,
    });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }

  /**
   * 重寄註冊驗證信。`type: 'signup'` 是**承重字面**:
   * 🔴 Supabase 的 `auth.resend` 用 `type` 決定重寄哪一種信 —— `'signup'` / `'email_change'` /
   *    `'sms'` … 打錯型別**不會報錯**,它會去寄【另一種】信或什麼都不做,
   *    而回傳形狀相同 ⇒ 📌 **那個錯在這一層沒有任何東西會叫** ⇒ 測試對它下了一發突變。
   * 🔵 `emailRedirectTo` 是 Supabase 的欄位名(不是 `redirectTo`)—— 與
   *    `resetPasswordForEmail` 的 `redirectTo` **不同名**,兩支放在一起時特別容易抄錯。
   */
  async resendSignupConfirmation(params: { email: string; redirectTo: string }): Promise<void> {
    const { error } = await this.supabase.auth.resend({
      type: 'signup',
      email: params.email,
      options: { emailRedirectTo: params.redirectTo },
    });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }

  /** 更新目前(recovery session)使用者密碼。 */
  async updatePassword(newPassword: string): Promise<void> {
    const { error } = await this.supabase.auth.updateUser({ password: newPassword });
    if (error) {
      throw mapSupabaseAuthError(error);
    }
  }
}
