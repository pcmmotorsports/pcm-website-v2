import { z } from 'zod';

export const NOTIFICATION_EMAIL_MAX_OCTETS = 254;

const LINE_SYNTHETIC_EMAIL_DOMAIN = 'line.pcmmotorsports.local';
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

function isSyntheticEmailDomain(value: string): boolean {
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
