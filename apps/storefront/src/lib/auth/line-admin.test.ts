// line-admin.test.ts — LINE Admin API 封裝測試(M-1-14e-f2-a2、防冒登入守衛為審查重點)
//
// node env;mock 'server-only' + '@pcm/adapters/server'(createSupabaseServiceClient 回假 admin client)。
// 驗:① 新用戶 createUser 成功 → generateLink 拿 token ② 回頭 LINE 用戶(撞號 + metadata 相符)→ 放行
//     ③ 撞號但 provider≠line / line_user_id≠sub → 拒(collision_not_line、防冒登入)④ 非法 sub → 拒
//     ⑤ 非 email_exists 的 createUser 錯 → throw(不誤判成不存在)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createUserSpy, generateLinkSpy, factorySpy } = vi.hoisted(() => {
  const createUserSpy = vi.fn();
  const generateLinkSpy = vi.fn();
  const factorySpy = vi.fn(() => ({
    auth: { admin: { createUser: createUserSpy, generateLink: generateLinkSpy } },
  }));
  return { createUserSpy, generateLinkSpy, factorySpy };
});

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: factorySpy }));

import { authenticateLineUser, recordLineLinkage } from './line-admin';

const validSub = 'U' + 'c'.repeat(32);
const identity = { sub: validSub, name: 'LINE Taro', email: 'taro@line.test' };

beforeEach(() => {
  createUserSpy.mockReset();
  generateLinkSpy.mockReset();
  generateLinkSpy.mockResolvedValue({
    data: { properties: { hashed_token: 'htok-xyz' }, user: { user_metadata: {} } },
    error: null,
  });
});

afterEach(() => vi.clearAllMocks());

describe('authenticateLineUser', () => {
  it('新用戶:createUser 成功 → generateLink 拿 hashedToken', async () => {
    createUserSpy.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: true, hashedToken: 'htok-xyz', userId: 'u1' });
    // createUser:身分鍵在 app_metadata(service_role-only)、name/line_email 在 user_metadata
    const args = createUserSpy.mock.calls[0]?.[0] as {
      email: string;
      email_confirm: boolean;
      app_metadata: Record<string, unknown>;
      user_metadata: Record<string, unknown>;
    };
    expect(args.email).toBe(`line_${validSub}@line.pcmmotorsports.local`);
    expect(args.email_confirm).toBe(true);
    expect(args.app_metadata).toEqual({ pcm_provider: 'line', pcm_line_user_id: validSub });
    expect(args.user_metadata).toEqual({ name: 'LINE Taro', line_email: 'taro@line.test' });
  });

  it('回頭 LINE 用戶:撞 email_exists + app_metadata 相符 → 放行', async () => {
    createUserSpy.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists' } });
    generateLinkSpy.mockResolvedValue({
      data: {
        properties: { hashed_token: 'htok-return' },
        user: { id: 'u-return', app_metadata: { pcm_provider: 'line', pcm_line_user_id: validSub } },
      },
      error: null,
    });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: true, hashedToken: 'htok-return', userId: 'u-return' });
  });

  it('撞號但 user_metadata 偽造相符、app_metadata 缺失 → 拒(must-fix-1:user_metadata 不可信)', async () => {
    // 模擬攻擊者用公開 signUp 佔合成 email + 偽造 user_metadata.provider/line_user_id;app_metadata 無法偽造故缺失。
    createUserSpy.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists' } });
    generateLinkSpy.mockResolvedValue({
      data: {
        properties: { hashed_token: 'htok-attacker' },
        user: {
          user_metadata: { provider: 'line', line_user_id: validSub }, // 偽造
          app_metadata: {}, // service_role-only、攻擊者無法寫 → 缺身分鍵
        },
      },
      error: null,
    });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: false, reason: 'collision_not_line' });
  });

  it('撞號 + app_metadata.pcm_provider≠line → 拒', async () => {
    createUserSpy.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists' } });
    generateLinkSpy.mockResolvedValue({
      data: {
        properties: { hashed_token: 'htok-attacker' },
        user: { app_metadata: { pcm_provider: 'email' } },
      },
      error: null,
    });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: false, reason: 'collision_not_line' });
  });

  it('撞號 + pcm_provider=line 但 pcm_line_user_id≠sub → 拒(防跨 LINE 帳號冒登入)', async () => {
    createUserSpy.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists' } });
    generateLinkSpy.mockResolvedValue({
      data: {
        properties: { hashed_token: 'htok-other' },
        user: { app_metadata: { pcm_provider: 'line', pcm_line_user_id: 'U' + 'd'.repeat(32) } },
      },
      error: null,
    });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: false, reason: 'collision_not_line' });
  });

  it('非法 sub → 拒、不呼叫 Admin API', async () => {
    const res = await authenticateLineUser({ sub: 'not-a-line-id', name: 'x', email: null });
    expect(res).toEqual({ ok: false, reason: 'invalid_sub' });
    expect(createUserSpy).not.toHaveBeenCalled();
  });

  it('非 email_exists 的 createUser 錯 → throw(不誤判成不存在而誤建)', async () => {
    createUserSpy.mockResolvedValue({
      data: { user: null },
      error: { code: 'unexpected_failure', message: 'boom' },
    });
    await expect(authenticateLineUser(identity)).rejects.toMatchObject({ code: 'unexpected_failure' });
    expect(generateLinkSpy).not.toHaveBeenCalled();
  });
});

// ── 🆕 S2:customers.line_user_id / line_friend_at 的寫法(五種世界 + 條件式 UPDATE + 絕不 throw + 零識別值)──────────
describe('recordLineLinkage', () => {
  type Row = { line_user_id: string | null; line_friend_at: string | null };
  /** 假 client:記下每次 UPDATE 的 patch 與 WHERE 形狀;`affected` 決定條件式 UPDATE 命中幾列(0 = 前提在讀後變了)。 */
  function fakeClient(row: Row | null, opts: { selectError?: boolean; updateError?: boolean; updateCode?: string; affected?: number } = {}) {
    const updates: Array<{ patch: Record<string, unknown>; where: string[] }> = [];
    const affected = opts.affected ?? 1;
    const finish = (where: string[], patch: Record<string, unknown>) => ({
      select: async () => {
        updates.push({ patch, where });
        return opts.updateError ? { data: null, error: { code: opts.updateCode, message: 'boom' } } : { data: Array.from({ length: affected }, () => ({ user_id: 'u1' })), error: null };
      },
    });
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              opts.selectError ? { data: null, error: { message: 'column line_user_id does not exist' } } : { data: row, error: null },
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_c: string, id: string) => ({
            is: (c: string, v: null) => finish([`user_id=${id}`, `${c} IS ${v}`], patch),
            eq: (c: string, v: string) => ({ is: (c2: string, v2: null) => finish([`user_id=${id}`, `${c}=${v}`, `${c2} IS ${v2}`], patch) }),
          }),
        }),
      }),
    };
    return { client: client as unknown as NonNullable<Parameters<typeof recordLineLinkage>[0]['client']>, updates };
  }
  const call = (f: ReturnType<typeof fakeClient>, friend: boolean | null) =>
    recordLineLinkage({ userId: 'u1', sub: validSub, friend, client: f.client });

  it('欄位空 + 好友 ⇒ 一發 UPDATE 寫 sub 與 line_friend_at, WHERE 帶 line_user_id IS NULL(原子前提)', async () => {
    const f = fakeClient({ line_user_id: null, line_friend_at: null });
    await expect(call(f, true)).resolves.toBe('written');
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]!.patch.line_user_id).toBe(validSub);
    expect(typeof f.updates[0]!.patch.line_friend_at).toBe('string');
    expect(f.updates[0]!.where).toEqual(['user_id=u1', 'line_user_id IS null']);
  });

  it('欄位空 + 好友狀態不明(null)/ 不是好友(false)⇒ 只寫 sub, 不動 line_friend_at', async () => {
    for (const friend of [null, false] as const) {
      const f = fakeClient({ line_user_id: null, line_friend_at: null });
      await call(f, friend);
      expect(f.updates[0]!.patch).toEqual({ line_user_id: validSub });
    }
  });

  it('已有同一個 sub:好友且 line_friend_at 空 ⇒ 只補那一欄(WHERE 帶 = sub 且 IS NULL);都有了 ⇒ unchanged 零寫入(冪等)', async () => {
    const a = fakeClient({ line_user_id: validSub, line_friend_at: null });
    await expect(call(a, true)).resolves.toBe('written');
    expect(Object.keys(a.updates[0]!.patch)).toEqual(['line_friend_at']);
    expect(a.updates[0]!.where).toEqual(['user_id=u1', `line_user_id=${validSub}`, 'line_friend_at IS null']);
    const b = fakeClient({ line_user_id: validSub, line_friend_at: '2026-09-14T00:00:00Z' });
    await expect(call(b, true)).resolves.toBe('unchanged');
    expect(b.updates).toHaveLength(0);
  });

  it('🔴 已有【不同】的 sub ⇒ mismatch, 零寫入(連 line_friend_at 也不動)', async () => {
    const f = fakeClient({ line_user_id: 'U' + 'f'.repeat(32), line_friend_at: null });
    await expect(call(f, true)).resolves.toBe('mismatch');
    expect(f.updates).toHaveLength(0);
  });

  it('🔴 競態(codex R1 MF2):讀到空、寫的時候前提已經變了 ⇒ 條件式 UPDATE 命中 0 列 ⇒ conflict, 不重試不覆蓋', async () => {
    const a = fakeClient({ line_user_id: null, line_friend_at: null }, { affected: 0 });
    await expect(call(a, true)).resolves.toBe('conflict');
    const b = fakeClient({ line_user_id: validSub, line_friend_at: null }, { affected: 0 });
    await expect(call(b, true)).resolves.toBe('conflict');
  });

  it('🔴 查詢 / 寫入炸(例如 S1 還沒貼, 欄不存在)/ 建 client 就炸(MF4)⇒ failed, 絕不 throw、不 log 任何東西', async () => {
    const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const e = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = fakeClient(null, { selectError: true });
    await expect(call(a, true)).resolves.toBe('failed');
    const b = fakeClient({ line_user_id: null, line_friend_at: null }, { updateError: true });
    await expect(call(b, true)).resolves.toBe('failed');
    const boom = { from: () => { throw new Error('factory secret ' + validSub); } } as unknown as NonNullable<Parameters<typeof recordLineLinkage>[0]['client']>;
    await expect(recordLineLinkage({ userId: 'u1', sub: validSub, friend: true, client: boom })).resolves.toBe('failed');
    // 🔴 MF3:本支不 log(識別值 / 上游 message 一個都不准出去);固定碼由 route 印。
    expect(w).not.toHaveBeenCalled();
    expect(e).not.toHaveBeenCalled();
    w.mockRestore();
    e.mockRestore();
  });

  it('🔴 同一個 LINE 帳號已綁在另一位客人身上(partial UNIQUE 23505)⇒ taken, 不 throw', async () => {
    const f = fakeClient({ line_user_id: null, line_friend_at: null }, { updateError: true, updateCode: '23505' });
    await expect(call(f, true)).resolves.toBe('taken');
  });

  it('查無 customers 列 ⇒ no_row, 零寫入', async () => {
    const f = fakeClient(null);
    await expect(call(f, true)).resolves.toBe('no_row');
    expect(f.updates).toHaveLength(0);
  });
});
