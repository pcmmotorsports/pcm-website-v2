import { z } from 'zod';

export const NOTIFICATION_EMAIL_MAX_OCTETS = 254;

/**
 * PCM 保留的合成信箱**基底網域**(`#858` 片0-a)。
 *
 * 🔴 我們真正依賴的性質是:**`.local` 底下的位址不是 Resend 投遞得到的公開信箱**
 * ⇒ 寄過去只會變成退信,而退信會傷 `pcmmotorsports.com` 的寄件信譽。
 * ⚠️ **不要寫成「沒有人註冊得到、永遠不會撞」** —— `.local` 是 mDNS special-use(RFC 6762),
 * **私人內網仍可自行配置**;而「誰能在【我們的 GoTrue】註冊走這個位址」是另一件事,
 * 它的防線不在網域選擇上(見 `apps/admin/src/lib/customers/manual-customer.ts` 的威脅模型段)。
 *
 * 🔴 **判斷式綁在這個基底上,不綁在任何單一用途的子網域上**。
 * 原本綁的是 LINE 那個子網域(`line.pcmmotorsports.local`)⇒ 第二種用途的合成信箱
 * (`#858` 手動建單的散客佔位信箱)**兩把閘都放行**
 * —— 2026-08-23 修閘前實測,證據 `~/pcm-mailbox/線C-858-片0a-修閘前量測-20260823.md`。
 */
export const SYNTHETIC_EMAIL_BASE_DOMAIN = 'pcmmotorsports.local';

/**
 * LINE 登入用的合成信箱網域 —— **產生規則的唯一字面來源**。
 *
 * 🔴 由基底 derive、不再各處 hardcode:`#858` 片0-a 之前這個字串在 3 支檔各宣告一次
 * (本檔 / `apps/storefront/src/lib/auth/line.ts` / `apps/storefront/src/lib/auth/field-validation.ts`),
 * 而本檔舊 docstring 逐字寫著「**不得再抄第三份**」—— 那件事當時**已經發生了**。
 */
export const LINE_SYNTHETIC_EMAIL_DOMAIN = `line.${SYNTHETIC_EMAIL_BASE_DOMAIN}`;

/**
 * TapPay `cardholder.email` 的總長上限(2026-08-09 sandbox 對照實測:40 字元過、41 字元回
 * status 521 `Out of range : cardholder > email`;同網域短信箱可過 => 限制在長度不在網域)。
 *
 * 🔴 這個常數**只給 cardholder 這條路用**(收件地址 email → TapPay)。訂單通知 Email
 * 不經 TapPay、不受此限,故 `NotificationEmailInput` 本體維持 254 octets 上限、不套這條。
 */
export const TAPPAY_CARDHOLDER_EMAIL_MAX_LENGTH = 40;
const PRINTABLE_ASCII_PATTERN = /^[!-~]+$/;
const BASIC_EMAIL_SHAPE_PATTERN = /^[^@]+@[^@]+\.[^@]+$/;

/**
 * 只移除頭尾半形空白(U+0020)，保留 local-part 原字面，僅將網域轉小寫。
 */
export function canonicalizeNotificationEmail(value: string): string {
  const asciiSpaceTrimmed = value.replace(/^ +| +$/g, '');
  const atIndex = asciiSpaceTrimmed.indexOf('@');

  if (atIndex < 0) return asciiSpaceTrimmed;

  return `${asciiSpaceTrimmed.slice(0, atIndex)}@${asciiSpaceTrimmed.slice(atIndex + 1).toLowerCase()}`;
}

/**
 * 是否為 PCM 自己編出來的合成信箱(基底網域 `pcmmotorsports.local` 或其**任一**子網域)。
 *
 * 🔴 export 的理由:多處要用**同一份**判斷式。今天的呼叫端(可重跑,別抄數字):
 * `grep -rn "isSyntheticEmailDomain" packages apps --include="*.ts" --include="*.tsx" | grep -v '\.test\.'`
 * ⚠️ **原本這裡寫「三處」而沒有量法** —— 那是個會過期又沒有機械訊號的數字。
 * **三處要用同一份判斷式**。抄第二份就會分岔成「產生規則」與「排斥規則」互不認識
 * —— 而那件事在 `#858` 片0-a 之前**已經發生了**(outbox 只認完全相等、註冊擋只認完全相等、本檔認子網域)。
 *
 * 🔴 **`.trim()` 不可拿掉**:outbox 閘原本自己做 trim(`normalizeForGate`),它改成委派本函式之後,
 * 這裡少一個 trim = **那一端變寬鬆** —— 而片0-a 的方向只准 fail-closed(擋的只能變多)。
 *
 * ⚠️ **比對用 `.` 前綴,不是裸後綴**:`evil-pcmmotorsports.local` 以 `pcmmotorsports.local` 結尾
 * 但**不是**我們的子網域,必須放行(既有測試釘住這一格)。
 */
export function isSyntheticEmailDomain(value: string): boolean {
  const trimmed = value.trim();
  const domain = trimmed.slice(trimmed.indexOf('@') + 1).replace(/\.+$/g, '').toLowerCase();
  return domain === SYNTHETIC_EMAIL_BASE_DOMAIN || domain.endsWith(`.${SYNTHETIC_EMAIL_BASE_DOMAIN}`);
}

export const NotificationEmailInput = z
  .string({ error: '請填寫 Email' })
  .transform(canonicalizeNotificationEmail)
  .superRefine((value, ctx) => {
    if (value === '') {
      ctx.addIssue({ code: 'custom', message: '請填寫 Email' });
      return;
    }

    const valid =
      PRINTABLE_ASCII_PATTERN.test(value) &&
      new TextEncoder().encode(value).byteLength <= NOTIFICATION_EMAIL_MAX_OCTETS &&
      BASIC_EMAIL_SHAPE_PATTERN.test(value) &&
      !isSyntheticEmailDomain(value);

    if (!valid) {
      ctx.addIssue({ code: 'custom', message: 'Email 格式不正確' });
    }
  });
export type NotificationEmailInput = z.infer<typeof NotificationEmailInput>;
