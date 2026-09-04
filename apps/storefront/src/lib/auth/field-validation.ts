// lib/auth/field-validation.ts — 登入/註冊逐欄驗證(M-1-14e #181 表單 UX 強化)
//
// client(即時逐欄提示)+ server action(不信任 client、重新逐欄驗)共用的同步純函式。
// boundary:apps → schemas 允許(eslint.config.js)、@pcm/schemas header 本就設計供 storefront client 即時驗證。
//
// #181 Sean 釘死(business override、鐵則 1 設計為基底):
//   1. 空欄顯示專屬「請填寫…」訊息,不沿用 zod 的「格式不正確」(客人易辨識「沒填」vs「填錯」)。
//   2. 帳號層級錯(帳密錯誤 / 此 Email 已註冊)走頂部 form-level、不被逐欄取代;頁面雙通道並存。
// 本檔只產逐欄「欄位驗證」錯誤(fieldErrors);帳號層級錯由 server action 以 formError 另路回。
//
// 驗證真相:非空但格式錯,沿用 @pcm/schemas(LoginInput/RegisterInput)的 zod 訊息 → 前後端一致。
// safeParse 成功時 data 已 strip 未知欄(zod object 預設剝除 schema 外 key)→ server action 直接拿來映射 use-case,
// 維持「client 夾帶 tier/wallet 不透傳」信任邊界(沿用 f1-a/f1-b 既有保護)。
//
// codex 關卡2(#181)修補:
//   - 密碼 presence 拒全空白(`!trim()`)、不沿用 `=== ''`(否則 8 個空白可過 zod min(8) 註冊純空白密碼);
//     但傳 use-case 的密碼值不 trim(允許密碼含空白字元、只擋「純空白=沒填」)。
//   - zod issue → fieldErrors 走 allowlist(只接受可顯示欄位):防 LoginInput.remember 等「schema 內但非顯示欄」
//     的型別錯塞出契約外 key(fieldErrors.remember)誤導 UI。
//   - ok invariant 明確依賴 `parsed.success`(非僅看 fieldErrors 空):非顯示欄 schema error 仍令 ok=false、
//     data=undefined;server action 對「ok=false 但無逐欄錯」回 formError fallback、不無聲失敗。

import { LoginInput, RegisterInput, isSyntheticEmailDomain } from '@pcm/schemas';
import type { LoginInput as LoginData, RegisterInput as RegisterData } from '@pcm/schemas';

export type RegisterField = 'name' | 'email' | 'phone' | 'password' | 'agree' | 'gender';
export type LoginField = 'email' | 'password';
export type ForgotField = 'email';
export type ResetPasswordField = 'password' | 'confirm';
export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;
export type ForgotFieldErrors = Partial<Record<ForgotField, string>>;
export type ResetPasswordFieldErrors = Partial<Record<ResetPasswordField, string>>;

// 可顯示欄位 allowlist:zod issue 只在這些欄才塞 fieldErrors(防契約外 key、如 login.remember 型別錯)。
const REGISTER_FIELDS: ReadonlySet<RegisterField> = new Set(['name', 'email', 'phone', 'password', 'agree', 'gender']);
const LOGIN_FIELDS: ReadonlySet<LoginField> = new Set(['email', 'password']);

/** unknown → string(安全取值;server action 收 unknown、client 傳 form state)。 */
function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** 空欄專屬訊息(釘死 1:不沿用 zod「格式不正確」)。Email/手機/密碼空 → 請填寫…。 */
const REGISTER_PRESENCE: Record<'name' | 'email' | 'phone', string> = {
  name: '請填寫姓名',
  email: '請填寫 Email',
  phone: '請填寫手機',
};
const LOGIN_PRESENCE: Record<'email', string> = {
  email: '請填寫 Email',
};

// 合成 email 網域 denylist(M-1-14e-f2-a2、codex 關卡1 finding-2 防冒登入第二道防線):
// 我們自己編出來的合成 email 不可被一般 email/password 註冊佔用
// (否則有人能先佔走那個信箱、冒領該帳號)。
//
// 🔴 `#858` 片0-a:本檔原本自己 hardcode 一份 `'line.pcmmotorsports.local'` + 自己做 `endsWith` 比對,
//    而那份**只認 LINE 那一個子網域** ⇒ 第二種用途的合成信箱(手動建單的散客佔位信箱)
//    **註冊擋不住** ⇒ 有人可以先去前台把散客的佔位信箱註冊走。
//    改成用 `@pcm/schemas` 的共用判斷式(它認整個 `pcmmotorsports.local` 家族)。
//    ⚠️ 舊註解說「此處不 import line.ts:該檔 server-only」—— 那句仍然成立,
//    但 `@pcm/schemas` **不是** server-only,client 驗證可以 import 它。
//
// 🔴 **這道 denylist 我方有兩道,不是一道**(Fable R2 2026-08-23 更正;寫低了會讓下一個人去補錯地方):
//    ① 本檔(client)② `app/register/actions.ts:46` 的 server action 也重驗同一份 `validateRegister`。
// 🔴🔴 **而真正缺的那一道不在這兩道之間,在 GoTrue**:註冊最終走 `supabase.auth.signUp` =
//    公開端點,拿 anon key 就能直呼、**繞過我方表單**;而 Confirm email 是 OFF
//    (`packages/adapters/src/supabase/SupabaseAuthAdapter.ts:37` 逐字)⇒ 直呼就拿得到可用帳號。
//    ⇒ 本檔這兩道**不在攻擊者的路徑上**,不得宣稱「合成信箱不會被搶註」。
//    ⚠️ GoTrue 那條路實際通不通(captcha / rate limit / allowed domains)= **平台面板設定、
//       不在 repo 裡、沒有人量過** ⇒ 標**未確認**;**不得為了確認它去實打正式站 signup**
//       (那會在正式庫建出一個真帳號)。緩解在 `apps/admin/src/lib/customers/manual-customer.ts`
//       (佔位信箱 local-part 不可枚舉 + `app_metadata` 身分鍵 fail-closed)。

/**
 * 把 zod issues 映射到 fieldErrors:只接受 allowlist 內的可顯示欄位(path[0]);presence 已佔的欄不覆蓋。
 * 非顯示欄(如 login.remember)的 issue 被忽略、不塞契約外 key —— ok invariant 另靠 parsed.success 兜。
 */
function applyZodIssues<F extends string>(
  fe: Partial<Record<F, string>>,
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
  allow: ReadonlySet<F>,
): void {
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && allow.has(key as F) && !(key in fe)) {
      (fe as Record<string, string>)[key] = issue.message;
    }
  }
}

/**
 * 註冊逐欄驗證。
 * - name/email/phone:trim 後空 → 專屬「請填寫…」(蓋過 zod 格式訊息)。
 * - password:trim 後空(含純空白) → 「請填寫密碼」;非空但 <8 → zod「密碼至少 8 碼」;傳 use-case 的值不 trim。
 * - agree:未勾 → zod literal(true) 訊息「請同意服務條款」(本就是專屬字面、直接沿用)。
 * - 非空但格式錯(Email) → 沿用 zod 訊息。
 * ⚠️ **手機那半 2026-09-04 起【沒有這條路】** —— Sean 拍甲:電話只擋空、不驗格式。
 *
 * @returns ok=true(⟺ parsed.success && 無逐欄錯)時 data 為 strip 過的 RegisterData(供 server action 映射 use-case)。
 */
export function validateRegister(input: unknown): {
  ok: boolean;
  fieldErrors: RegisterFieldErrors;
  data?: RegisterData;
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const fe: RegisterFieldErrors = {};

  // presence(專屬「請填寫…」優先;密碼拒純空白)
  if (!str(o.name).trim()) fe.name = REGISTER_PRESENCE.name;
  if (!str(o.email).trim()) fe.email = REGISTER_PRESENCE.email;
  if (!str(o.phone).trim()) fe.phone = REGISTER_PRESENCE.phone;
  if (!str(o.password).trim()) fe.password = '請填寫密碼';

  // 合成 email 網域 denylist(防冒登入第二道防線、見上常數註解):非空且屬合成網域 → 拒(presence 已佔則不覆蓋)。
  if (!fe.email && isSyntheticEmailDomain(str(o.email))) {
    fe.email = '此 Email 網域不可用於註冊';
  }

  // 非空欄的格式錯 / agree 未勾 → 沿用 zod 訊息(allowlist 過濾、presence 已佔的欄不覆蓋)
  const parsed = RegisterInput.safeParse(input);
  if (!parsed.success) applyZodIssues(fe, parsed.error.issues, REGISTER_FIELDS);

  const ok = parsed.success && Object.keys(fe).length === 0;
  return {
    ok,
    fieldErrors: fe,
    data: ok ? parsed.data : undefined,
  };
}

/**
 * 登入逐欄驗證。
 * - email:trim 後空 → 「請填寫 Email」;非空但格式錯 → zod「Email 格式不正確」。
 * - password:trim 後空(含純空白) → 「請填寫密碼」;非空但 <8 → zod「密碼至少 8 碼」;傳 use-case 的值不 trim。
 *
 * @returns ok=true(⟺ parsed.success && 無逐欄錯)時 data 為 strip 過的 LoginData(含 remember default true)。
 */
export function validateLogin(input: unknown): {
  ok: boolean;
  fieldErrors: LoginFieldErrors;
  data?: LoginData;
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const fe: LoginFieldErrors = {};

  if (!str(o.email).trim()) fe.email = LOGIN_PRESENCE.email;
  if (!str(o.password).trim()) fe.password = '請填寫密碼';

  const parsed = LoginInput.safeParse(input);
  if (!parsed.success) applyZodIssues(fe, parsed.error.issues, LOGIN_FIELDS);

  const ok = parsed.success && Object.keys(fe).length === 0;
  return {
    ok,
    fieldErrors: fe,
    data: ok ? parsed.data : undefined,
  };
}

/**
 * 忘記密碼逐欄驗證(email 單一欄、忘記密碼片新)。
 * - email:trim 後空 → 沿用 LOGIN_PRESENCE.email(「請填寫 Email」);非空但格式錯 → 沿用
 *   LoginInput.email 的 zod「Email 格式不正確」(重用 LoginInput.shape.email、不另寫一份 regex)。
 */
export function validateForgot(input: unknown): {
  ok: boolean;
  fieldErrors: ForgotFieldErrors;
  data?: { email: string };
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const fe: ForgotFieldErrors = {};

  if (!str(o.email).trim()) fe.email = LOGIN_PRESENCE.email;

  const parsed = LoginInput.shape.email.safeParse(o.email);
  if (!parsed.success && !fe.email) {
    fe.email = parsed.error.issues[0]?.message ?? 'Email 格式不正確';
  }

  const ok = parsed.success && Object.keys(fe).length === 0;
  return {
    ok,
    fieldErrors: fe,
    data: ok && parsed.success ? { email: parsed.data } : undefined,
  };
}

/**
 * 重設密碼逐欄驗證(password + confirm 兩欄、忘記密碼片新)。
 * Sean 2026-08-07 Q24-e 拍板「照稿用」逐字文案,confirm 兩句不可改寫。
 * - password:trim 後空(含純空白)→「請填寫密碼」;非空但 <8 → 沿用 LoginInput.password 的 zod
 *   「密碼至少 8 碼」(重用 LoginInput.shape.password、不另寫一份 min(8));傳出值不 trim
 *   (允許密碼含空白字元、只擋「純空白=沒填」,對齊既有規則)。
 * - confirm:trim 後空 →「請再輸入一次密碼」;非空但 !== password(🔴 用未 trim 的原值比對)
 *   →「兩次輸入的密碼不一樣」。
 */
export function validateResetPassword(input: unknown): {
  ok: boolean;
  fieldErrors: ResetPasswordFieldErrors;
  data?: { password: string };
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const fe: ResetPasswordFieldErrors = {};
  const password = str(o.password);
  const confirm = str(o.confirm);

  if (!password.trim()) {
    fe.password = '請填寫密碼';
  } else {
    const parsed = LoginInput.shape.password.safeParse(password);
    if (!parsed.success) fe.password = parsed.error.issues[0]?.message ?? '密碼至少 8 碼';
  }

  if (!confirm.trim()) {
    fe.confirm = '請再輸入一次密碼';
  } else if (confirm !== password) {
    fe.confirm = '兩次輸入的密碼不一樣';
  }

  const ok = Object.keys(fe).length === 0;
  return {
    ok,
    fieldErrors: fe,
    data: ok ? { password } : undefined,
  };
}
