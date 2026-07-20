import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  getCheckoutNotificationEmailPrefill,
  isCheckoutNotificationEmailEnabled,
} from './notification-email-gate';

const ORIGINAL = process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;
  } else {
    process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = ORIGINAL;
  }
});

describe('isCheckoutNotificationEmailEnabled', () => {
  it("只有字面 'true' 才開啟", () => {
    process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = 'true';
    expect(isCheckoutNotificationEmailEnabled()).toBe(true);
  });

  it.each([undefined, '', 'false', 'TRUE', '1', ' true '])('未設或非指定真值 %j 一律關閉', (value) => {
    if (value === undefined) delete process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED;
    else process.env.CHECKOUT_NOTIFICATION_EMAIL_ENABLED = value;

    expect(isCheckoutNotificationEmailEnabled()).toBe(false);
  });
});

describe('getCheckoutNotificationEmailPrefill', () => {
  it('開啟時只預填通過共用 canonical schema 的真 Email', () => {
    expect(getCheckoutNotificationEmailPrefill(' User.Name@EXAMPLE.COM ', true)).toBe(
      'User.Name@example.com',
    );
  });

  it.each([
    [false, 'member@example.com'],
    [true, null],
    [true, 'line_user@line.pcmmotorsports.local'],
    [true, 'invalid-email'],
  ])('關閉或 session Email 不合格時不預填', (enabled, rawEmail) => {
    expect(getCheckoutNotificationEmailPrefill(rawEmail, enabled)).toBe('');
  });
});
