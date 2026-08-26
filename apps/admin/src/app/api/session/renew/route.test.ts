import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// 🔴 mock DB 邊界(慣例抄 sso/callback/route.test.ts):`staff` 走 select/eq/abortSignal/maybeSingle。
//    ⚠️ `abortSignal` 一定要長出來 —— 少了它 `q.abortSignal` 是 undefined ⇒ TypeError
//       ⇒ 被 catch 吞成 null ⇒ **每一發都變 not-active**, 而紅的原因與被測的東西無關。
const { staffRow, staffEqArgs } = vi.hoisted(() => ({
  staffRow: vi.fn(async (_id: unknown): Promise<{ data: unknown; error: unknown }> => ({
    data: { id: 'sean', label: 'Sean', is_manager: true, is_active: true },
    error: null,
  })),
  staffEqArgs: vi.fn((_c: string, _v: unknown) => {}),
}));
vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          staffEqArgs(col, val);
          const leaf = { maybeSingle: () => staffRow(val) };
          return { ...leaf, abortSignal: () => leaf };
        },
      }),
    }),
  }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-request-id': 'req_renew-fixed' }),
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
}));

import {
  ADMIN_SESS_COOKIE,
  SSO_CHAIN_MAX_AGE_SEC,
  buildAdminSession,
  signSession,
  verifySession,
} from '@/lib/session/session';
import { __resetStaffLogThrottleForTests } from '@/lib/staff';
import { POST } from './route';

const SECRET = 'test-admin-session-secret-0123456789abcdef';
const now = () => Math.floor(Date.now() / 1000);

async function reqWith(payloadOverrides: Record<string, unknown> = {}): Promise<NextRequest> {
  const base = buildAdminSession(['pwd'], now() - 60, { kind: 'user', staff_id: 'sean' });
  const token = await signSession({ ...base, ...payloadOverrides } as typeof base);
  expect(token, '簽不出票 ⇒ 下面每一格都沒有意義').toBeTruthy();
  return new NextRequest('http://localhost:3001/api/session/renew', {
    method: 'POST',
    headers: { cookie: `${ADMIN_SESS_COOKIE}=${token}` },
  });
}

describe('片二 · /api/session/renew 的三種結果必須分得開', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = SECRET;
    staffRow.mockReset().mockImplementation(async (id: unknown) => ({
      data:
        id === 'sean'
          ? { id: 'sean', label: 'Sean', is_manager: true, is_active: true }
          : id === 'amy'
            ? { id: 'amy', label: '艾咪', is_manager: false, is_active: false }
            : null,
      error: null,
    }));
    staffEqArgs.mockReset();
    __resetStaffLogThrottleForTests();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = prev;
    vi.restoreAllMocks();
  });

  it('[R1] ✅ 正對照:在職 + 鏈沒過期 ⇒ renewed,而且【真的種了一張新 cookie】', async () => {
    const res = await POST(await reqWith());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'renewed' });
    const set = res.cookies.get(ADMIN_SESS_COOKIE);
    expect(set?.value, '回了 renewed 而沒有種票 ⇒ 前端會以為續到了').toBeTruthy();
    // 🔴 新票要驗得過, 而且【exp 往後推了】—— 否則「續期」只是換了一張一樣快過期的票
    const fresh = await verifySession(set?.value);
    expect(fresh).not.toBeNull();
    expect(fresh!.exp).toBeGreaterThan(now());
  });

  it('[R1b] 🔴🔴 續出來的新票, sso_at 必須【原封等於原本那條鏈的起點】', async () => {
    // 🔴 **這一格是補的, 而它守的是本片唯一的天花板。**
    //    2026-08-26 實測:把 `{ ssoAt: … }` 拿掉(讓每次續期都重新開始)⇒ **12 格全綠**。
    //    ⇒ 那個「12 小時上限」會【永遠不會到】, 而一張被偷的票可以無限續下去。
    //    📌 又一次同款:**我加了一道防護, 而沒有東西在看那道防護還在不在。**
    const chainStart = now() - 3600; // 一小時前開始的鏈, 還沒到上限
    const res = await POST(await reqWith({ sso_at: chainStart }));
    expect(res.status).toBe(200);
    const fresh = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(fresh).not.toBeNull();
    expect(fresh!.sso_at, '續期把 sso_at 重設了 ⇒ 上限永遠不會到').toBe(chainStart);
    // ✅ 正對照:iat 【必須】是新的 —— 否則本格在「整張票原封不動」時也是綠的
    expect(fresh!.iat).toBeGreaterThan(chainStart);
  });

  it('[R2] 🔴 鏈已經超過 12 小時 ⇒ chain-expired,而且【不得】種新票', async () => {
    const res = await POST(await reqWith({ sso_at: now() - SSO_CHAIN_MAX_AGE_SEC - 10 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ outcome: 'chain-expired' });
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value ?? '').toBe('');
  });

  it('[R3] 🔴 人被停用 ⇒ not-active(403),而且問的是【票上那個人】', async () => {
    const res = await POST(await reqWith({ sub: { kind: 'user', staff_id: 'amy' } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ outcome: 'not-active' });
    expect(staffEqArgs).toHaveBeenCalledWith('id', 'amy');
    expect(staffEqArgs).not.toHaveBeenCalledWith('id', 'sean');
  });

  it('[R4] 🔴 chain-expired 與 not-active 【不是同一個回答】—— 前端要分得開', async () => {
    // 兩者都是 401/403 家族, 而處置完全不同:
    //   chain-expired ⇒ 走一次完整登入      not-active ⇒ 找管理員
    // 壓成同一個 outcome ⇒ 前端只能二選一猜, 而猜錯的那一半很難查。
    const a = await (await POST(await reqWith({ sso_at: now() - SSO_CHAIN_MAX_AGE_SEC - 10 }))).json();
    const b = await (await POST(await reqWith({ sub: { kind: 'user', staff_id: 'amy' } }))).json();
    expect(a).not.toEqual(b);
  });

  it('[R5] 🔴 fallback 票 ⇒ 照續,而且【一次名單都沒查】(規格 §7.1 壞世界①)', async () => {
    const res = await POST(await reqWith({ sub: { kind: 'fallback' } }));
    expect(res.status).toBe(200);
    expect(staffEqArgs).not.toHaveBeenCalled();
  });

  it('[R6] 沒有票 ⇒ not-active(401),不得 500 也不得導向', async () => {
    const res = await POST(new NextRequest('http://localhost:3001/api/session/renew', { method: 'POST' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });
});
