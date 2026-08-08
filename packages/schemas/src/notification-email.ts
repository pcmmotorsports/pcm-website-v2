import { z } from 'zod';

export const NOTIFICATION_EMAIL_MAX_OCTETS = 254;

const LINE_SYNTHETIC_EMAIL_DOMAIN = 'line.pcmmotorsports.local';

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
 * 是否為 LINE 合成信箱網域(`line.pcmmotorsports.local` 或其子網域)。
 *
 * 🔴 export 的理由:`buildCardholder` 的出口不變量閘要用**同一份**判斷式
 * (plan §2.3)—— 合成網域字串目前已在兩處 hardcode(本檔 + `lib/auth/line.ts`),
 * 不得再抄第三份;抄了就會在改網域時分岔成「產生規則」與「排斥規則」互不認識。
 */
export function isSyntheticEmailDomain(value: string): boolean {
  const domain = value.slice(value.indexOf('@') + 1).replace(/\.+$/g, '').toLowerCase();
  return domain === LINE_SYNTHETIC_EMAIL_DOMAIN || domain.endsWith(`.${LINE_SYNTHETIC_EMAIL_DOMAIN}`);
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
