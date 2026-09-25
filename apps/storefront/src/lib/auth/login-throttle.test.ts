// 登入限次(資安修正片 3):開關、資料庫回傳形狀、出錯時放行並留下 [login-throttle] fail-open。
// 資料庫那三支函式本身的規則(10 次、15 分鐘、大小寫統一、並發)在 migration 20260926110000 的事後閘與拋棄式 PG 實測。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcSpy, createSpy } = vi.hoisted(() => {
  const rpcSpy = vi.fn();
  return { rpcSpy, createSpy: vi.fn(() => ({ rpc: rpcSpy })) };
});
vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: createSpy }));

import { clearLoginAttempts, reserveLoginAttempt, settleLoginAttempt } from './login-throttle';

let errSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.stubEnv('LOGIN_THROTTLE_ENABLED', 'true');
  rpcSpy.mockReset().mockResolvedValue({ data: null, error: null });
  createSpy.mockClear();
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  errSpy.mockRestore();
});

describe('reserveLoginAttempt', () => {
  it('開關不是 true ⇒ 完全不碰資料庫, 放行', async () => {
    for (const v of ['', 'false', 'TRUE', '1']) {
      vi.stubEnv('LOGIN_THROTTLE_ENABLED', v);
      expect(await reserveLoginAttempt('a@b.c')).toEqual({ blocked: false, id: null });
    }
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('資料庫說擋 ⇒ blocked;傳的是原始輸入(統一在資料庫做)', async () => {
    rpcSpy.mockResolvedValue({ data: { allowed: false }, error: null });
    expect(await reserveLoginAttempt(' A@B.c ')).toEqual({ blocked: true });
    expect(rpcSpy).toHaveBeenCalledWith('auth_login_attempt_reserve', { p_email: ' A@B.c ' });
  });

  it('資料庫說放 ⇒ 帶回那一格的 id', async () => {
    rpcSpy.mockResolvedValue({ data: { allowed: true, id: 'r1' }, error: null });
    expect(await reserveLoginAttempt('a@b.c')).toEqual({ blocked: false, id: 'r1' });
  });

  it.each([
    ['資料庫回錯', () => rpcSpy.mockResolvedValue({ data: null, error: { message: 'boom' } })],
    ['回傳形狀不對(NULL)', () => rpcSpy.mockResolvedValue({ data: null, error: null })],
    ['建 client 就丟例外(缺 SUPABASE_SERVICE_ROLE_KEY)', () => createSpy.mockImplementationOnce(() => { throw new Error('missing key'); })],
  ])('🔴 %s ⇒ 放行、不佔格, 並印 [login-throttle] fail-open', async (_name, arrange) => {
    arrange();
    expect(await reserveLoginAttempt('a@b.c')).toEqual({ blocked: false, id: null });
    expect(String(errSpy.mock.calls[0]?.[0])).toContain('[login-throttle] fail-open');
  });
});

describe('settleLoginAttempt', () => {
  it('沒佔到格(id 是 null)⇒ 不呼叫', async () => {
    await settleLoginAttempt(null, 'failed');
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('照結果呼叫;資料庫出錯只記紀錄, 不往外丟', async () => {
    await settleLoginAttempt('r1', 'failed');
    expect(rpcSpy).toHaveBeenCalledWith('auth_login_attempt_settle', { p_id: 'r1', p_outcome: 'failed' });
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(settleLoginAttempt('r1', 'success')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('clearLoginAttempts', () => {
  it('開關關著 ⇒ 當成已解除, 不碰資料庫', async () => {
    vi.stubEnv('LOGIN_THROTTLE_ENABLED', '');
    expect(await clearLoginAttempts('a@b.c')).toBe(true);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('成功 ⇒ true;資料庫出錯 ⇒ false(畫面要給重試)', async () => {
    expect(await clearLoginAttempts('a@b.c')).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('auth_login_attempt_clear', { p_email: 'a@b.c' });
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await clearLoginAttempts('a@b.c')).toBe(false);
  });
});
