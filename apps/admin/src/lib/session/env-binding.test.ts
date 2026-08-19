// 「票綁環境」(M-4b E8-B 片 1;Sean 2026-08-19 `q3=甲`)的驗收。
//
// 🔴 **六格是一組,缺任一格另外五格就失去意義**:
//   · 「同 env 簽兩次 ⇒ 逐字相同」是【正向對照】—— 沒有它,「翻 env 之後不同」
//     可以來自 sid/iat 的隨機,而那正是審查抓到過的恆綠格
//   · 「同 env 簽同 env 驗 ⇒ 過」是【地基】—— 沒有它,前面的「全拒」與
//     「這把尺對什麼都拒」印出同一個畫面
//   · 兩個方向都要驗(preview→prod、prod→preview)—— 只驗一個方向只證明了一半
//
// 🔴 **fail-closed 的方向是【不簽】不是【給預設值】**:給預設值 ⇒ 兩環境推出同一把金鑰
//    ⇒ 這道閘等於沒裝,而且不會有任何東西紅。
//
// ⚠️ 誠實界線:這裡驗的是【純函式層】。它不證 Vercel 上真的讀得到 VERCEL_ENV ——
//    那一格由片 0 的探針在 production 上量掉了(2026-08-19,值 = `production`,Sean 開頁截圖)。
import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import {
  __resetAlarmThrottleForTests,
  consumeAlarmSlot,
  signSession,
  verifySession,
  verifySessionDetailed,
  type AdminSessionPayload,
} from './session';

const P: AdminSessionPayload = {
  v: 1, sid: 'a'.repeat(32), iat: 1, exp: 2_000_000_000, amr: ['pwd'], auth_time: 1,
};
const SEC = 'x'.repeat(48);

describe('票綁環境(片 1)', () => {
  const s0 = process.env.ADMIN_SESSION_SECRET;
  const v0 = process.env.VERCEL_ENV;
  const n0 = process.env.NODE_ENV;
  afterEach(() => {
    if (s0 === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = s0;
    if (v0 === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = v0;
    (process.env as Record<string, string | undefined>).NODE_ENV = n0;
  });

  it('同 env 簽兩次 ⇒ 逐字相同(正向對照:證明差異不是來自隨機)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'production';
    const a = await signSession(P);
    const b = await signSession(P);
    expect(typeof a).toBe('string');
    expect(a).toBe(b);
  });

  it('🔴 preview 簽的票 → production 驗 ⇒ 拒', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'preview';
    const t = await signSession(P);
    expect(typeof t).toBe('string');
    process.env.VERCEL_ENV = 'production';
    expect(await verifySession(t)).toBeNull();
  });

  it('🔴 反向:production 簽的票 → preview 驗 ⇒ 拒', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'production';
    const t = await signSession(P);
    // 🔴 先斷言【真的簽出來了】(codex 關卡2 nit):若簽發意外回 null,
    //    verifySession(null) 也會回 null ⇒ 這一格【恆綠】而什麼都沒證明。
    expect(typeof t, '簽不出票 ⇒ 這一格什麼都沒證明').toBe('string');
    process.env.VERCEL_ENV = 'preview';
    expect(await verifySession(t)).toBeNull();
  });

  it('✅ 對照組:同 env 簽同 env 驗 ⇒ 過(否則前兩格的「全拒」沒有意義)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'production';
    const t = await signSession(P);
    expect(await verifySession(t)).not.toBeNull();
  });

  it('🔴🔴 production 而讀不到 VERCEL_ENV ⇒ 簽不出來(不是用預設值簽)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(await signSession(P)).toBeNull();
  });

  // ── 🔴 codex 關卡2 nit3 折入:白名單的【邊界組合】原本一格都沒有 ──
  //    而那正是 M1/M2 兩條 fail-open 路徑會走的地方 ⇒ 沒有這些格,那兩條改動【不會有東西紅】。
  it.each([
    ['NODE_ENV 是 undefined', undefined],
    ['NODE_ENV 是 staging(不在白名單)', 'staging'],
    ['NODE_ENV 拼錯', 'prodction'],
  ])('🔴 VERCEL_ENV 缺 + %s ⇒ 簽不出來(不得退回 local)', async (_label, nodeEnv) => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnv;
    expect(await signSession(P)).toBeNull();
  });

  it.each([
    ['空字串', ''],
    ['只有空白', '   '],
    ['未知值', 'staging'],
    ['大小寫不符', 'Production'],
  ])('🔴 VERCEL_ENV 是%s ⇒ 不得採信,而 NODE_ENV=production ⇒ 簽不出來', async (_label, v) => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = v;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(await signSession(P)).toBeNull();
  });

  it('✅ 對照組:VERCEL_ENV 是白名單裡的 development ⇒ 簽得出來(證上面不是「對什麼都拒」)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'development';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(typeof (await signSession(P))).toBe('string');
  });

  it('✅ 白名單另一個值:NODE_ENV=test + VERCEL_ENV 缺 ⇒ 也算 local(否則刪掉 test 支援不會紅)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    const t = await signSession(P);
    expect(typeof t).toBe('string');
  });

  it('🔴 非 production 讀不到 ⇒ 用 local 簽得出來,而 local 的票 production 驗不過', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    delete process.env.VERCEL_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
    const t = await signSession(P);
    expect(typeof t).toBe('string');
    process.env.VERCEL_ENV = 'production';
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    expect(await verifySession(t)).toBeNull();
  });
});

// ── 🔴 codex 關卡2 M3 折入:**分類與告警本身沒有任何一格在釘它** ──
//    把 `no_env` 誤回成 `absent`,上面每一格都照樣綠,而【唯一的早期警報永久消失】。
//    ⇒ 這一組釘的不是「會不會拒」,是「拒的時候【說得出是哪一種】」。
describe('拒絕分類與告警(唯一的早期警報)', () => {
  const s0 = process.env.ADMIN_SESSION_SECRET;
  const v0 = process.env.VERCEL_ENV;
  const n0 = process.env.NODE_ENV;
  beforeEach(() => {
    __resetAlarmThrottleForTests();
  });
  afterEach(() => {
    if (s0 === undefined) delete process.env.ADMIN_SESSION_SECRET;
    else process.env.ADMIN_SESSION_SECRET = s0;
    if (v0 === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = v0;
    (process.env as Record<string, string | undefined>).NODE_ENV = n0;
    __resetAlarmThrottleForTests();
  });

  it('🔴 secret 缺 ⇒ no_secret(不是 no_env,也不是 absent)', async () => {
    delete process.env.ADMIN_SESSION_SECRET;
    process.env.VERCEL_ENV = 'production';
    const r = await verifySessionDetailed('a.b');
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toBe('no_secret');
  });

  it('🔴 環境解析不出來 ⇒ no_env(而 secret 是好的 ⇒ 兩者分得開)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'staging'; // 不在白名單
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    const r = await verifySessionDetailed('a.b');
    expect((r as { reason: string }).reason).toBe('no_env');
  });

  it('🔴 沒有 token ⇒ absent(而它【不得】被歸成 no_*,否則會誤觸告警)', async () => {
    process.env.ADMIN_SESSION_SECRET = SEC;
    process.env.VERCEL_ENV = 'production';
    const r = await verifySessionDetailed(undefined);
    expect((r as { reason: string }).reason).toBe('absent');
  });

  it.each([
    ['no_secret', true],
    ['no_env', true],
    ['absent', false],
    ['sig_invalid', false],
    ['shape', false],
    ['expired', false],
  ])('🔴 只有 no_* 會告警:%s ⇒ %s', (reason, expected) => {
    expect(consumeAlarmSlot(reason as never, 1_000_000)).toBe(expected);
  });

  it('🔴 有界去重:同一個 reason 在視窗內只叫一次,而視窗過了會再叫', () => {
    expect(consumeAlarmSlot('no_env', 1_000_000)).toBe(true);
    expect(consumeAlarmSlot('no_env', 1_000_000 + 59_999), '視窗內第二次不該叫').toBe(false);
    expect(consumeAlarmSlot('no_env', 1_000_000 + 60_001), '視窗過了要再叫 —— 否則它只叫一次就永遠啞了').toBe(true);
  });

  it('🔴 而去重是【每個 reason 各自】的:no_secret 被節流時 no_env 仍叫得出來', () => {
    expect(consumeAlarmSlot('no_secret', 2_000_000)).toBe(true);
    expect(consumeAlarmSlot('no_secret', 2_000_001)).toBe(false);
    expect(consumeAlarmSlot('no_env', 2_000_001), '兩種原因共用一個計時器 ⇒ 一種會蓋掉另一種').toBe(true);
  });
});
