import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
// 🔴 #606:本檔刻意用 `@/` import **原檔**(不是複本)——
//    plan 1-bis 的探針證的是「複本上會過」;這裡才是「原檔上會過」。
//    proxy.ts 內部的 `@/lib/request-id`、`@/lib/session/session` import 由
//    vitest.config.ts admin project 的 alias 解析;本檔自己的 `@/` import 同理。
import { REQUEST_ID_HEADER } from '@/lib/request-id';
import { ADMIN_SESS_COOKIE, buildAdminSession, signSession } from '@/lib/session/session';
import { isDevAuthBypassEnabled } from '@/lib/dev-auth-bypass';
import { DB_KEY_PATTERN } from '@/lib/dev-db-guard';
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
    // DEV_AUTH_BYPASS 是三條件 AND(non-prod ∧ flag=1 ∧ DB 本機;判定住 @/lib/dev-auth-bypass)。
    // module 層的 NODE_ENV 在單測構造不出來(載入時已定)⇒ production 語意由檔尾
    // isDevAuthBypassEnabled 純函式 describe 蓋到,這裡只斷言測試環境是 non-prod。
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

// 🔴 MAIN-127 ⑤(Fable R2 nit-6):dev bypass 的第三個條件 —— DB 非本機 ⇒ bypass 不生效。
//    proxy 跑在 app 層、任何啟動路徑都經過 ⇒ 這一道補掉 next.config 閘接不到的 custom-server 洞
//    (auth 那一半)。DEV_AUTH_BYPASS 是 module 載入時定案的 const ⇒ 這組用【動態 import】
//    讓 proxy 在指定 env 下重新載入;獨立字面同 must-fix-5 慣例。
const PROD_URL_LITERAL = 'https://bmpnplmnldofgaohnaok.supabase.co';

describe('dev bypass 的 DB 本機條件(MAIN-127 ⑤)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    vi.resetModules();
  });

  async function loadProxyWith(env: Record<string, string>): Promise<typeof import('./proxy')> {
    vi.resetModules();
    // 逃生門也要清(codex R1 nit):shell 若全域 export =1,「該紅」案會靜默變放行。
    // key 清單直接用 guard 的 DB_KEY_PATTERN(R2 N-3:兩份復刻會各自漂)。
    delete process.env.PCM_ALLOW_PROD_DB_DEV;
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined && (DB_KEY_PATTERN.test(k) || v.includes('bmpnplmnldofgaohnaok'))) {
        delete process.env[k];
      }
    }
    process.env.ADMIN_SESSION_SECRET = SECRET;
    Object.assign(process.env, env);
    return import('./proxy');
  }

  it('該紅:dev + ADMIN_DEV_BYPASS=1 + 正式庫 ref ⇒ bypass 失效,未登入仍導 /api/sso/start', async () => {
    const mod = await loadProxyWith({
      ADMIN_DEV_BYPASS: '1',
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL_LITERAL,
    });
    const res = await mod.proxy(new NextRequest('http://localhost:3001/orders'));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/start');
  });

  it('該綠:dev + bypass + 本機 DB ⇒ bypass 照舊(證明不是恆關)', async () => {
    const mod = await loadProxyWith({
      ADMIN_DEV_BYPASS: '1',
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    });
    const res = await mod.proxy(new NextRequest('http://localhost:3001/orders'));
    expect(res.status).toBe(200);
  });

  // 🔴 codex R2 must-fix:逃生門只授權【連線】,不授權【免登入】——
  //    兩個 flag 一起設仍放行,就重建了本片要消滅的「免登入正式站後台」。
  it('該紅:dev + bypass + 正式庫 ref + 指令列逃生門 ⇒ bypass 仍失效(逃生門不延伸到 auth)', async () => {
    const mod = await loadProxyWith({
      ADMIN_DEV_BYPASS: '1',
      NEXT_PUBLIC_SUPABASE_URL: PROD_URL_LITERAL,
      PCM_ALLOW_PROD_DB_DEV: '1',
    });
    const res = await mod.proxy(new NextRequest('http://localhost:3001/orders'));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/api/sso/start');
  });
});

// production 那半(MAIN-127 ⑤ 驗收):module 層 NODE_ENV 在單測構造不出來(上面前置斷言明寫),
// 但判斷已抽成純函式 ⇒ production 語意在這裡測得到:DB 判斷在 production 下【不改變任何結果】。
describe('isDevAuthBypassEnabled(純函式)', () => {
  it('production ⇒ 恆 false;DB 本機或正式庫、逃生門開或關,結果都一樣(判斷不生效)', () => {
    for (const dbUrl of ['http://127.0.0.1:54321', PROD_URL_LITERAL]) {
      for (const escape of [{}, { PCM_ALLOW_PROD_DB_DEV: '1' }]) {
        expect(
          isDevAuthBypassEnabled({
            NODE_ENV: 'production',
            ADMIN_DEV_BYPASS: '1',
            NEXT_PUBLIC_SUPABASE_URL: dbUrl,
            ...escape,
          }),
          `db=${dbUrl}`,
        ).toBe(false);
      }
    }
  });

  it('dev:無 flag ⇒ false / flag+本機 ⇒ true / flag+正式庫 ⇒ false / flag+正式庫+逃生門 ⇒ 仍 false', () => {
    const dev = { NODE_ENV: 'development' };
    expect(isDevAuthBypassEnabled({ ...dev, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' })).toBe(false);
    expect(
      isDevAuthBypassEnabled({
        ...dev,
        ADMIN_DEV_BYPASS: '1',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      }),
    ).toBe(true);
    expect(
      isDevAuthBypassEnabled({
        ...dev,
        ADMIN_DEV_BYPASS: '1',
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL_LITERAL,
      }),
    ).toBe(false);
    expect(
      isDevAuthBypassEnabled({
        ...dev,
        ADMIN_DEV_BYPASS: '1',
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL_LITERAL,
        PCM_ALLOW_PROD_DB_DEV: '1',
      }),
    ).toBe(false);
  });
});
