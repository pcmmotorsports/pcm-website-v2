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

  /**
   * 寄出忘記密碼重設信(忘記密碼片新)。
   *
   * `redirectTo` 由**呼叫端**用 `resolveSiteUrl()` 組好絕對網址傳進來;本 port 與其實作
   * 皆不碰站台設定(對齊本檔既有邊界:認證動作以外的關注點不進本層)。
   * 失敗照樣 throw AuthError(不吞錯)——「不洩漏帳號是否存在」是呼叫端(server action)
   * 的責任、不在本層做:本層如實回報 Supabase 結果,避免安全決策同時藏在兩層。
   */
  sendPasswordResetEmail(params: { email: string; redirectTo: string }): Promise<void>;

  /**
   * 更新目前 session 使用者的密碼(忘記密碼片新、reset-password 頁使用)。
   * 依賴注入 client 已帶有效 recovery session(由 Supabase reset link 建立);
   * 本層不驗證 / 不建立 session,只轉呼 Supabase。失敗 throw AuthError。
   */
  updatePassword(newPassword: string): Promise<void>;
}
