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

import { authenticateLineUser } from './line-admin';

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
    expect(res).toEqual({ ok: true, hashedToken: 'htok-xyz' });
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
        user: { app_metadata: { pcm_provider: 'line', pcm_line_user_id: validSub } },
      },
      error: null,
    });
    const res = await authenticateLineUser(identity);
    expect(res).toEqual({ ok: true, hashedToken: 'htok-return' });
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
