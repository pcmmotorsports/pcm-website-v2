// @vitest-environment jsdom
// 首頁「Email 已確認」提示(2026-09-26 資安修正片 2):Email 取自已驗證的登入狀態, 不信網址參數。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { userRef } = vi.hoisted(() => ({ userRef: { value: null as null | { email?: string } } }));
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({ supabase: {}, user: userRef.value }),
}));

import { EmailConfirmedNotice } from './EmailConfirmedNotice';

afterEach(cleanup);

describe('EmailConfirmedNotice', () => {
  it('有登入 ⇒ 顯示確認成功, 並寫出【登入狀態裡】的 Email', async () => {
    userRef.value = { email: 'b@example.com' };
    render(await EmailConfirmedNotice());
    expect(screen.getByRole('status').textContent).toBe('Email 已確認，歡迎加入。目前登入的帳號是 b@example.com。');
  });

  it('🔴 沒有登入狀態 ⇒ 什麼都不顯示(不能只因為網址有 confirmed=1 就說成功)', async () => {
    userRef.value = null;
    const el = await EmailConfirmedNotice();
    expect(el).toBeNull();
  });
});

// Codex 片 2 R1 建議:首頁接線與參數比對也要有會紅的測試。
describe('首頁什麼時候掛這個提示', () => {
  it('只有 confirmed=1 才掛;沒帶、其他值、重複參數都不掛', async () => {
    const { shouldShowConfirmedNotice } = await import('./EmailConfirmedNotice');
    expect(shouldShowConfirmedNotice({ confirmed: '1' })).toBe(true);
    expect(shouldShowConfirmedNotice({})).toBe(false);
    expect(shouldShowConfirmedNotice({ confirmed: 'true' })).toBe(false);
    expect(shouldShowConfirmedNotice({ confirmed: '0' })).toBe(false);
    expect(shouldShowConfirmedNotice({ confirmed: ['1', '1'] })).toBe(false);
  });

  it('🔴 首頁真的接上了(刪掉接線這一格會紅)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../../app/page.tsx'), 'utf8');
    expect(src).toContain('{shouldShowConfirmedNotice(params) && <EmailConfirmedNotice />}');
  });
});
