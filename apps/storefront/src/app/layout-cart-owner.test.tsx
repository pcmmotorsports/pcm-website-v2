// app/layout.tsx · 購物車歸屬(cartOwnerId)與「同一個 request 只驗一次登入」。
// Codex 優化盤點第 2 項(2026-09-28,Sean 批准):layout 改用 request 內共用的 getVerifiedUser(),
// 不再自己 getUser();三態判斷(有人 / 確定沒人 / 不知道)要與改動前逐格相同。
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  cookieNames: [] as string[],
  memo: null as null | Promise<{ supabase: unknown; user: { id: string } | null; error: unknown }>,
}));

vi.mock('next/headers', () => ({
  headers: async () => new Map([['user-agent', 'test']]),
  cookies: async () => ({ getAll: () => h.cookieNames.map((name) => ({ name, value: 'x' })) }),
}));
vi.mock('next/font/google', () => {
  const font = () => ({ className: '', variable: '', style: { fontFamily: '' } });
  return { Inter: font, JetBrains_Mono: font, Antonio: font, Cormorant_Garamond: font, Noto_Sans_TC: font };
});
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: h.getUser } }),
}));
// request 內共用:一個 request(= 一個測試案例)只真的問一次,模擬 React cache() 在 RSC 裡的行為。
// ⚠️ 內文逐字抄 lib/auth/verified-user.ts 的 getVerifiedUser;在 vitest 裡 React 的 cache() 不記憶,
//    所以「只呼叫一次」那格證明的是【layout 改經由 getVerifiedUser】,不是 cache() 本身的去重。
vi.mock('@/lib/auth/verified-user', async () => {
  const server = await import('@/lib/supabase/server');
  return {
    isNoSessionError: (e: { name?: string } | null | undefined) => e?.name === 'AuthSessionMissingError',
    getVerifiedUser: () =>
      (h.memo ??= (async () => {
        const supabase = await server.createServerSupabaseClient();
        const { data, error } = await supabase.auth.getUser();
        return { supabase, user: data?.user ?? null, error: error ?? null };
      })()),
  };
});

import RootLayout from './layout';
import { CartProvider } from '@/contexts/CartContext';
import { getVerifiedUser } from '@/lib/auth/verified-user';

const COOKIE = 'sb-abc-auth-token';
const noSession = Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' });
const expired = Object.assign(new Error('invalid JWT: token is expired'), { name: 'AuthApiError' });

/** 在 layout 回傳的元素樹裡找 CartProvider,讀它拿到的 serverOwnerId。 */
function ownerOf(tree: ReactNode): unknown {
  const stack: ReactNode[] = [tree];
  while (stack.length) {
    const n = stack.pop();
    if (Array.isArray(n)) stack.push(...n);
    else if (n && typeof n === 'object' && 'props' in n) {
      const el = n as ReactElement<{ children?: ReactNode; serverOwnerId?: unknown }>;
      if (el.type === CartProvider) return el.props.serverOwnerId;
      stack.push(el.props.children);
    }
  }
  throw new Error('layout 裡找不到 CartProvider');
}

async function render(): Promise<unknown> {
  return ownerOf(await RootLayout({ children: null }));
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
  h.getUser.mockReset();
  h.cookieNames = [];
  h.memo = null;
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('RootLayout · 購物車歸屬三態(與改動前相同)', () => {
  it('有登入 ⇒ 使用者 id', async () => {
    h.cookieNames = [COOKIE];
    h.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    expect(await render()).toBe('u-1');
  });

  it('未登入(沒有登入 cookie,Auth 回 session missing)⇒ null(確定沒人)', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: noSession });
    expect(await render()).toBeNull();
  });

  it('token 過期(登入 cookie 還在,Auth 回錯)⇒ undefined(不知道,不清車)', async () => {
    h.cookieNames = [`${COOKIE}.0`];
    h.getUser.mockResolvedValue({ data: { user: null }, error: expired });
    expect(await render()).toBeUndefined();
  });

  it('getUser 丟例外、沒有登入 cookie ⇒ null', async () => {
    h.getUser.mockRejectedValue(new Error('network'));
    expect(await render()).toBeNull();
  });

  it('getUser 丟例外、登入 cookie 還在 ⇒ undefined', async () => {
    h.cookieNames = [COOKIE];
    h.getUser.mockRejectedValue(new Error('network'));
    expect(await render()).toBeUndefined();
  });

  it('有使用者但同時有錯誤(tier.ts 註解提過的形狀)⇒ 仍回使用者 id', async () => {
    h.cookieNames = [COOKIE];
    h.getUser.mockResolvedValue({ data: { user: { id: 'u-2' } }, error: expired });
    expect(await render()).toBe('u-2');
  });

  it('沒有使用者也沒有錯誤 ⇒ null', async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await render()).toBeNull();
  });
});

describe('RootLayout · 同一個 request 只驗一次登入', () => {
  it('頁面已經用 getVerifiedUser() 驗過 ⇒ layout 不再呼叫 getUser()', async () => {
    h.cookieNames = [COOKIE];
    h.getUser.mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null });
    await getVerifiedUser(); // 頁面(例如解會員等級)先問一次
    expect(await render()).toBe('u-1');
    expect(h.getUser).toHaveBeenCalledTimes(1);
  });
});
