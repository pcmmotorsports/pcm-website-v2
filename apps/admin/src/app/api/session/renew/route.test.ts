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
  ADMIN_SESSION_MAX_AGE_SEC,
  ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC,
  SSO_CHAIN_MAX_AGE_SEC,
  buildAdminSession,
  signSession,
  verifySession,
} from '@/lib/session/session';
import { __resetStaffLogThrottleForTests } from '@/lib/staff';
import { POST } from './route';

const SECRET = 'test-admin-session-secret-0123456789abcdef';
const PROD_ORIGIN = 'https://admin.pcmmotorsports.com';
const now = () => Math.floor(Date.now() / 1000);

// 🔴 **預設就把票做成【快過期】**(補審 M1 之後):route 多了一格「還早 ⇒ 回 fresh 且不碰 DB」,
//    而 `buildAdminSession` 出來的票剩 15 分鐘 ⇒ 不動的話下面每一格都會走進 fresh,
//    **而它們仍然全綠**(200 + 沒種票的斷言有些照樣過)⇒ 那是最壞的一種綠。
//    ⇒ 要測「續期」就要餵一張真的快過期的票;要測 fresh 請看 [R7]。
const NEAR_EXPIRY_SEC = 60; // < ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC(300)
async function reqWith(payloadOverrides: Record<string, unknown> = {}): Promise<NextRequest> {
  const base = buildAdminSession(['pwd'], now() - 60, { kind: 'user', staff_id: 'sean' });
  const token = await signSession({
    ...base,
    exp: now() + NEAR_EXPIRY_SEC,
    ...payloadOverrides,
  } as typeof base);
  expect(token, '簽不出票 ⇒ 下面每一格都沒有意義').toBeTruthy();
  return new NextRequest('http://localhost:3001/api/session/renew', {
    method: 'POST',
    // 🔴 `origin` 是**必要**的(codex 補審 MF3 之後):端點 Origin fail-closed。
    //    用正式站那個字面, 因為它與 env 無關 ⇒ 這些格子不會因為誰的 ADMIN_DEV_BYPASS 而變色。
    headers: { cookie: `${ADMIN_SESS_COOKIE}=${token}`, origin: PROD_ORIGIN },
  });
}

// ⛔ ~~「的三種結果必須分得開」~~ —— 契約實際上是六種
//    (renewed / fresh / chain-expired / not-active / bad-origin / error;codex 補審 nit)。
//    留痕:一個寫死數字的 suite 名會讓下一個人照它盤覆蓋率, 而漏掉的正是新加的那幾種。
describe('片二 · /api/session/renew 的每一種結果都必須分得開', () => {
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

  it('[R7] 🔴 票還早 ⇒ fresh(200),而且【一次 DB 都沒查、一張票都沒種】', async () => {
    // 🔴 **這一格守的是補審 M1**:原本 route 沒有這個早退, 前端每 60 秒敲一次
    //    ⇒ 每一次都查一發 staff 表(一個分頁一天約 480 次)。
    //    ⚠️ 而拿掉早退時, 這一格會拿到 `renewed` ⇒ 紅。**它是雙向的。**
    const res = await POST(await reqWith({ exp: now() + ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC + 60 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'fresh' });
    expect(staffEqArgs, '還早卻查了 DB ⇒ 早退沒生效').not.toHaveBeenCalled();
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value ?? '', '還早卻種了新票 ⇒ 白白旋轉 sid').toBe('');
  });

  it('[R7b] ✅ 負對照:同一張票【只差一秒】跨過門檻 ⇒ 就不是 fresh 了', async () => {
    // 🔴 沒有這一格的話, [R7] 在「route 恆回 fresh」時也是綠的。
    const res = await POST(await reqWith({ exp: now() + ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC - 1 }));
    expect(await res.json()).toEqual({ outcome: 'renewed' });
  });

  it('[R8] 🔴 鏈到頂的票, 就算【還早】也要回 chain-expired —— 早退不得蓋掉天花板', async () => {
    // 順序題:早退若排在鏈上限【之前】, 一張鏈到頂但還剩 10 分鐘的票會拿到 fresh
    // ⇒ 前端當作一切正常繼續巡邏, 而它其實已經不能再續了。
    const res = await POST(
      await reqWith({
        sso_at: now() - SSO_CHAIN_MAX_AGE_SEC - 10,
        exp: now() + ADMIN_SESSION_RENEW_WHEN_REMAINING_SEC + 60,
      }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ outcome: 'chain-expired' });
  });

  it('[R11] 🔴🔴 續票必須【原封搬運】amr / auth_time / sid —— 這三個都是提權面', async () => {
    // 🔴 **第三把審查 N2**:前兩把審查 + 十發突變都沒有碰到這一格。
    //    審查員實測:把 route 裡的 `payload.amr` 換成寫死的 `['pwd','totp']` ⇒ **六格全綠**,
    //    而 `isFull2faSession()`(session.ts:651)會因此對一張【只過密碼】的票回 true
    //    ⇒ 續期這條路可以把自己升級成二階段驗證過的 session。
    // 📌 這是本片 commit body 自己描述的那個病的**第三例**:
    //    「我加了一道防護, 而沒有東西在看那道防護還在不在」——
    //    這一次連防護都不是我加的, 是我【搬運】的, 而搬運壞掉與沒搬長得一樣。
    const base = buildAdminSession(['pwd'], now() - 60, { kind: 'user', staff_id: 'sean' });
    const before = { ...base, exp: now() + NEAR_EXPIRY_SEC };
    const token = await signSession(before as typeof base);
    const res = await POST(
      new NextRequest('http://localhost:3001/api/session/renew', {
        method: 'POST',
        headers: { cookie: `${ADMIN_SESS_COOKIE}=${token}`, origin: PROD_ORIGIN },
      }),
    );
    expect(res.status).toBe(200);
    const after = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(after).not.toBeNull();
    expect(after!.amr, 'amr 被改寫 ⇒ 續期可以自己升級成 2FA 過的 session').toEqual(before.amr);
    expect(after!.auth_time, 'auth_time 被改寫 ⇒ 上游那側的登入時刻失真').toBe(before.auth_time);
    // 🔴 sid 沿用而不旋轉(N1):稽核 log 靠它把同一次連線的動作串起來。
    expect(after!.sid, 'sid 每次續期都換 ⇒ 稽核 log 串不起同一次連線').toBe(before.sid);
    // ✅ 正對照:iat 【必須】是新的 —— 否則本格在「整張票原封不動」時也綠。
    expect(after!.iat).toBeGreaterThan(before.iat - 1);
    expect(after!.exp).toBeGreaterThan(before.exp);
  });

  it('[R9] 🔴🔴 續出來的新票【不得越過鏈尾】—— 這一格才是「絕對上限」四個字的碼', async () => {
    // 🔴 **codex 補審 MF1**:原本只擋「還能不能再簽」, 沒擋「簽出來的那張活到什麼時候」
    //    ⇒ 鏈齡 11:59:59 續一發 ⇒ 新票活到 12:14:59 ⇒ 比片二之前多近 15 分鐘,
    //      而 session.ts 逐字宣稱「最壞情況與片二之前完全一樣」。
    //    📌 **那個假宣稱通過了前一輪 code-reviewer 與四發突變測試** —— 因為每一格
    //      問的都是「sso_at 有沒有被重設」, 沒有一格問「exp 落在哪」。
    const chainStart = now() - SSO_CHAIN_MAX_AGE_SEC + 30; // 鏈只剩 30 秒
    const res = await POST(await reqWith({ sso_at: chainStart, exp: now() + 60 }));
    expect(res.status).toBe(200);
    const fresh = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(fresh).not.toBeNull();
    expect(fresh!.exp, '新票活過鏈尾 ⇒「絕對上限」不絕對').toBeLessThanOrEqual(
      chainStart + SSO_CHAIN_MAX_AGE_SEC,
    );
  });

  it('[R9b] ✅ 正對照:鏈還很長時, 新票拿的是【完整的 15 分鐘】, 不是被夾過頭', async () => {
    // 沒有這一格的話, 一個「永遠回 exp = now + 1 秒」的實作也會讓 [R9] 綠。
    const chainStart = now() - 60;
    const res = await POST(await reqWith({ sso_at: chainStart }));
    const fresh = await verifySession(res.cookies.get(ADMIN_SESS_COOKIE)?.value);
    expect(fresh!.exp - fresh!.iat).toBe(ADMIN_SESSION_MAX_AGE_SEC);
  });

  it('[R10] 🔴 Origin fail-closed:缺 Origin ⇒ 拒,而且【一次 DB 都沒查、一張票都沒種】', async () => {
    // 🔴 codex 補審 MF3:這是一支**會發新認證 cookie 的 POST**。
    //    `SameSite=Lax` 擋不住同站子網域, 而 `__Host-` 只管 cookie 不外送、不管誰送請求過來。
    const base = buildAdminSession(['pwd'], now() - 60, { kind: 'user', staff_id: 'sean' });
    const token = await signSession({ ...base, exp: now() + NEAR_EXPIRY_SEC } as typeof base);
    const res = await POST(
      new NextRequest('http://localhost:3001/api/session/renew', {
        method: 'POST',
        headers: { cookie: `${ADMIN_SESS_COOKIE}=${token}` }, // 刻意不帶 origin
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ outcome: 'bad-origin' });
    expect(staffEqArgs).not.toHaveBeenCalled();
    expect(res.cookies.get(ADMIN_SESS_COOKIE)?.value ?? '').toBe('');
  });

  it('[R10b] 🔴 別的來源(同站子網域也算別的來源)⇒ 拒', async () => {
    const base = buildAdminSession(['pwd'], now() - 60, { kind: 'user', staff_id: 'sean' });
    const token = await signSession({ ...base, exp: now() + NEAR_EXPIRY_SEC } as typeof base);
    const res = await POST(
      new NextRequest('http://localhost:3001/api/session/renew', {
        method: 'POST',
        headers: {
          cookie: `${ADMIN_SESS_COOKIE}=${token}`,
          origin: 'https://quote.pcmmotorsports.com',
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ outcome: 'bad-origin' });
  });

  it('[R6] 沒有票 ⇒ not-active(401),不得 500 也不得導向', async () => {
    const res = await POST(
      new NextRequest('http://localhost:3001/api/session/renew', {
        method: 'POST',
        headers: { origin: PROD_ORIGIN },
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('location')).toBeNull();
  });
});
