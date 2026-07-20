import 'server-only';

import { NotificationEmailInput } from '@pcm/schemas';

/** 預設關閉；只有明確字面 true 才同步打開結帳 Email 四層契約。 */
export function isCheckoutNotificationEmailEnabled(): boolean {
  return process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED === 'true';
}

/**
 * Session Email 只作便利預填，不是信任來源。任何不合格或 LINE 合成域一律回空字串。
 */
export function getCheckoutNotificationEmailPrefill(
  rawEmail: string | null | undefined,
  enabled: boolean,
): string {
  if (!enabled || rawEmail == null) return '';

  const result = NotificationEmailInput.safeParse(rawEmail);
  return result.success ? result.data : '';
}
