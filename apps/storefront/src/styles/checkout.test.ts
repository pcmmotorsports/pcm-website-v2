import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CHECKOUT_CSS = readFileSync(new URL('./checkout.css', import.meta.url), 'utf8');

describe('checkout mobile CSS guard', () => {
  it('通知 Email input 在 mobile breakpoint 至少 16px，避免 iOS Safari 聚焦自動放大', () => {
    const mobileStart = CHECKOUT_CSS.indexOf('@media (max-width: 900px)');
    const nextBreakpoint = CHECKOUT_CSS.indexOf('@media (max-width: 720px)', mobileStart);
    const mobileCss = CHECKOUT_CSS.slice(mobileStart, nextBreakpoint);

    expect(mobileStart).toBeGreaterThanOrEqual(0);
    expect(nextBreakpoint).toBeGreaterThan(mobileStart);
    expect(mobileCss).toMatch(/\.co-notification-email input\s*\{[^}]*font-size:\s*16px\s*;/);
  });
});
