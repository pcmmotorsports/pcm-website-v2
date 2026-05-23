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
        data: { name: params.metadata.name, phone: params.metadata.phone },
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
}
