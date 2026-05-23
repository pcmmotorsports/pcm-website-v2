/**
 * @module @pcm/domain/identity/auth — 帳號認證 contract 值型別 + domain 錯誤
 *
 * M-1-14e-1 新增。register / login / logout 經 IAuthService port + SupabaseAuthAdapter 落地;
 * 本檔放「認證契約」的 domain 值型別與錯誤型別(非 entity、非 zod 表單 schema)。
 *
 * 邊界:
 * - 與 @pcm/schemas 表單 schema 區分:RegisterInput / LoginInput 是「表單輸入形狀」(client + server 驗證);
 *   本檔 AuthSignUpParams / AuthCredentials 是「port 方法輸入契約」(use-case 把表單 input 映射成此形狀)。
 * - AuthError 型別定義在 domain(domain 命名 code union)、由 adapter 把 Supabase 原始 error 映射成此型別 throw;
 *   wire 細節(Supabase error code 字串)不上洩 use-case / UI(ADR-0003 §3.3)。
 *
 * @see packages/ports/src/IAuthService.ts
 * @see packages/adapters/src/supabase/SupabaseAuthAdapter.ts
 * @see docs/specs/m-1-14-customer-schema.md §8.1
 */

/** 登入憑證(email + password)。 */
export type AuthCredentials = {
  email: string;
  password: string;
};

/**
 * 註冊參數:憑證 + metadata。
 *
 * metadata 只含 name / phone、寫入 auth.users.raw_user_meta_data,供 DB handle_new_auth_user
 * function 取值自動建 customers row(migration 20260523034911 L278-294:L281-287 INSERT 取值、L292-294 掛 trigger)。
 * tier / wallet 等敏感欄不經此路徑。
 */
export type AuthSignUpParams = AuthCredentials & {
  metadata: {
    name: string;
    phone: string;
  };
};

/**
 * 認證成功結果(signUp / signInWithPassword 共用)。
 *
 * needsEmailConfirmation:Phase 1 = Q1=A「Confirm email OFF」(2026-05-23 Sean 拍板、對齊 design
 * AccountPages.jsx L263-266 註冊後直接登入)→ 預期恆 false(session 立即可用)。上線重開 email
 * 驗證後(backlog #173)signUp 回 session=null 時此值為 true、UI 分支顯示「請收信」,不需改 port 契約。
 */
export type AuthResult = {
  userId: string; // = auth.users.id(customers PK)
  email: string;
  needsEmailConfirmation: boolean;
};

/**
 * 認證錯誤 domain code。
 *
 * **刻意不重用基礎設施 auth provider 的 wire error code 字面**:domain code 用獨立命名,由 adapter
 * mapper 做真正的 wire → domain 轉譯;具體 provider code ↔ domain code 對照表只在 adapter mapper
 * (packages/adapters/src/supabase/mappers/auth-error.ts、ADR-0003 §3.3、不上洩 use-case / UI)。
 */
export type AuthErrorCode =
  | 'credentials_invalid'
  | 'email_already_registered'
  | 'password_too_weak'
  | 'email_confirmation_required'
  | 'unknown';

/**
 * AuthError:認證失敗 domain 錯誤。
 *
 * adapter 把 Supabase 原始 error 映射成本型別 throw(packages/adapters/src/supabase/mappers/auth-error.ts);
 * use-case / UI 只看 code(domain 命名)、不碰 Supabase error 細節(ADR-0003 §3.3)。
 */
export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}
