import type { AuthCredentials, AuthResult, AuthSignUpParams } from '@pcm/domain';

/**
 * IAuthService:帳號認證 port(M-1-14e-1 新)。
 *
 * 對齊 PRD docs/specs/m-1-14-customer-schema.md §8.1(register / login / logout 接 Supabase Auth)
 * + ADR-0003 §3.3(port 介面只出現 domain 命名、不洩漏基礎設施 wire 型別)。
 *
 * 邊界:
 * - 只負責「認證動作」(signUp / signInWithPassword / signOut);customers profile 讀寫走 ICustomerRepository。
 * - signUp 後 customers row 由 DB on_auth_user_created trigger 自動建(handle_new_auth_user、
 *   migration 20260523034911 L278-294);實作 / use-case **不顯式 insert customers**
 *   (PRD §10 Q2=A;B「顯式 insert」為否決備選、雙寫會 inconsistent)。
 * - session / cookie 寫入由「注入 adapter 的 SupabaseClient」依執行環境(browser / server)綁定處理;
 *   本 port 不管 client 建構(見 SupabaseAuthAdapter JSDoc;@supabase/ssr factory 屬 f 段前置決策、
 *   見 PRD §8.4 偏離 + backlog)。
 *
 * 失敗一律 throw AuthError(domain code、見 @pcm/domain identity/auth)。
 *
 * 實作:M-1-14e-1 SupabaseAuthAdapter(@pcm/adapters/server、server-only)。
 */
export interface IAuthService {
  signUp(params: AuthSignUpParams): Promise<AuthResult>;
  signInWithPassword(creds: AuthCredentials): Promise<AuthResult>;
  signOut(): Promise<void>;
}
