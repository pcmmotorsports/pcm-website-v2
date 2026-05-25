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

import { LoginInput, RegisterInput } from '@pcm/schemas';
import type { LoginInput as LoginData, RegisterInput as RegisterData } from '@pcm/schemas';

export type RegisterField = 'name' | 'email' | 'phone' | 'password' | 'agree';
export type LoginField = 'email' | 'password';
export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

// 可顯示欄位 allowlist:zod issue 只在這些欄才塞 fieldErrors(防契約外 key、如 login.remember 型別錯)。
const REGISTER_FIELDS: ReadonlySet<RegisterField> = new Set(['name', 'email', 'phone', 'password', 'agree']);
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
 * - 非空但格式錯(Email/手機格式) → 沿用 zod 訊息。
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
