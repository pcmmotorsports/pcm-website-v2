import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
// 🔴 #606:本檔刻意用 `@/` import **原檔**(不是複本)——
//    plan 1-bis 的探針證的是「複本上會過」;這裡才是「原檔上會過」。
//    proxy.ts 內部的 `@/lib/request-id`、`@/lib/session/session` import 由
//    vitest.config.ts admin project 的 alias 解析;本檔自己的 `@/` import 同理。
import { REQUEST_ID_HEADER } from '@/lib/request-id';
import { ADMIN_SESS_COOKIE, buildAdminSession, signSession } from '@/lib/session/session';
import { proxy } from './proxy';

const SECRET = 'test-admin-session-secret-0123456789abcdef';

describe('proxy 登入閘', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = prev;
  });

  // 前置斷言:DEV_AUTH_BYPASS 是 proxy.ts module 載入時就定案的 const;
  // 測試環境若外洩 ADMIN_DEV_BYPASS=1,下面「該紅的世界」會整族靜默放行 ⇒ 先擋。
  it('前置:測試環境沒有 dev bypass(否則整個閘不在測)', () => {
    expect(process.env.ADMIN_DEV_BYPASS).not.toBe('1');
    // DEV_AUTH_BYPASS 是兩條件 AND(proxy.ts:17-18);測試跑在 non-prod ⇒
    // 本檔測到的只有 non-prod 那半。「prod 永遠擋、bypass 無效」那半在單測裡
    // 構造不出來(NODE_ENV 在 module 載入時已定)⇒ 明寫前提,不假裝蓋到。
    expect(process.env.NODE_ENV).not.toBe('production');
  });

  it('未登入 ⇒ 303 導向 /api/sso/start,且 next=原路徑', async () => {
    const res = await proxy(new NextRequest('http://localhost:3001/orders'));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get('location') ?? '');
    expect(loc.pathname).toBe('/api/sso/start');
    expect(loc.searchParams.get('next')).toBe('/orders');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
  });

  it('SSO 入口本身未登入也放行(否則無限迴圈)', async () => {
    for (const path of ['/api/sso/start', '/api/sso/callback']) {
      const res = await proxy(new NextRequest(`http://localhost:3001${path}`));
      expect(res.status, path).toBe(200);
      expect(res.headers.get(REQUEST_ID_HEADER), path).toBeTruthy();
    }
  });

  it('白名單是精確比對:/api/sso/evil 未登入仍被擋(codex MF2 負例)', async () => {
    // 殺的突變:SSO_OPEN_PATHS.has(path) 改寬成 path.startsWith('/api/sso/')
    // ⇒ 任意 /api/sso/* 未登入可達;上面白名單正例對這個變形恆綠,只有本格會紅。
    const res = await proxy(new NextRequest('http://localhost:3001/api/sso/evil'));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/start');
  });

  it('有效 session ⇒ 放行,且 request id 是 server 新產(不沿用 inbound)', async () => {
    const token = await signSession(buildAdminSession(['pwd', 'totp'], Math.floor(Date.now() / 1000)));
    expect(token).toBeTruthy();
    const res = await proxy(
      new NextRequest('http://localhost:3001/orders', {
        headers: {
          cookie: `${ADMIN_SESS_COOKIE}=${token}`,
          [REQUEST_ID_HEADER]: 'attacker-chosen-id',
        },
      }),
    );
    expect(res.status).toBe(200);
    const id = res.headers.get(REQUEST_ID_HEADER);
    expect(id).toBeTruthy();
    expect(id).not.toBe('attacker-chosen-id');
  });

  it('無效 cookie 值 ⇒ 仍導登入(閘不只看 cookie 存在)', async () => {
    const res = await proxy(
      new NextRequest('http://localhost:3001/orders', {
        headers: { cookie: `${ADMIN_SESS_COOKIE}=garbage-not-a-token` },
      }),
    );
    expect(res.status).toBe(303);
  });
});
