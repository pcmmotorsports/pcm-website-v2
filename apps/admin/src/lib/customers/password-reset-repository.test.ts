import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const getUserById = vi.fn();
const resetPasswordForEmail = vi.fn();
let customerRow: unknown = { data: { email: 'owner@shop.tw' }, error: null };
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { getUserById }, resetPasswordForEmail },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => customerRow }) }) }),
  }),
  SupabaseDealerApplicationAdapter: class {},
}));

import {
  PASSWORD_RESET_REDIRECT_TO,
  PASSWORD_RESET_SEND_TIMEOUT_MS,
  RECHECK_TIMEOUT_MS,
  readAuthEmail,
  readPasswordResetTarget,
  sendPasswordResetEmail,
} from './password-reset-repository';

const user = (email: string, providers: unknown) => ({ data: { user: { email, app_metadata: { providers } } }, error: null });

beforeEach(() => {
  getUserById.mockReset();
  resetPasswordForEmail.mockReset();
  customerRow = { data: { email: 'owner@shop.tw' }, error: null };
});

describe('重設密碼信的收件人(片 D4b)', () => {
  it('Email + 密碼登入的真信箱 ⇒ ok', async () => {
    getUserById.mockResolvedValue(user('owner@shop.tw', ['email']));
    expect(await readPasswordResetTarget('u1')).toEqual({ kind: 'ok', email: 'owner@shop.tw' });
  });

  it.each([
    ['LINE 帳號的編造信箱', user('U123@line.pcmmotorsports.local', ['email'])],
    ['Google 登入', user('a@gmail.com', ['google'])],
    ['Google + 密碼混用', user('a@gmail.com', ['google', 'email'])],
    ['讀不到登入方式', user('a@x.tw', undefined)],
  ])('🔴 %s ⇒ not_eligible', async (_n, r) => {
    getUserById.mockResolvedValue(r);
    expect((await readPasswordResetTarget('u1')).kind).toBe('not_eligible');
  });

  it('🔴 登入 Email 與客戶資料(確認視窗上那個)不一致 ⇒ mismatch, 不寄', async () => {
    getUserById.mockResolvedValue(user('new@shop.tw', ['email']));
    expect((await readPasswordResetTarget('u1')).kind).toBe('mismatch');
  });

  it('找不到帳號 ⇒ not_found;其他錯誤 ⇒ failed', async () => {
    getUserById.mockResolvedValue({ data: { user: null }, error: { status: 404 } });
    expect((await readPasswordResetTarget('u1')).kind).toBe('not_found');
    getUserById.mockResolvedValue({ data: { user: null }, error: { status: 500 } });
    expect((await readPasswordResetTarget('u1')).kind).toBe('failed');
  });
});

describe('寄重設密碼信的結果分類', () => {
  it('成功 ⇒ accepted;連結落在固定的 /auth/confirm', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(await sendPasswordResetEmail('a@x.tw')).toBe('accepted');
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@x.tw', { redirectTo: PASSWORD_RESET_REDIRECT_TO });
    expect(PASSWORD_RESET_REDIRECT_TO).toBe('https://www.pcmmotorsports.com/auth/confirm');
  });

  it('明確的 4xx ⇒ failed;5xx / 斷線 / 拋出 ⇒ unknown', async () => {
    resetPasswordForEmail.mockResolvedValue({ error: { status: 429, code: 'over_email_send_rate_limit' } });
    expect(await sendPasswordResetEmail('a@x.tw')).toBe('failed');
    resetPasswordForEmail.mockResolvedValue({ error: { status: 504, name: 'AuthRetryableFetchError' } });
    expect(await sendPasswordResetEmail('a@x.tw')).toBe('unknown');
    resetPasswordForEmail.mockResolvedValue({ error: { status: 0 } });
    expect(await sendPasswordResetEmail('a@x.tw')).toBe('unknown');
    resetPasswordForEmail.mockImplementation(() => {
      throw new Error('socket');
    });
    expect(await sendPasswordResetEmail('a@x.tw')).toBe('unknown');
  });

  it('🔴 一直不回應 ⇒ 時限到了回 unknown(不等到平台把整個請求砍掉)', async () => {
    vi.useFakeTimers();
    resetPasswordForEmail.mockReturnValue(new Promise(() => {}));
    const p = sendPasswordResetEmail('a@x.tw');
    await vi.advanceTimersByTimeAsync(PASSWORD_RESET_SEND_TIMEOUT_MS);
    expect(await p).toBe('unknown');
    vi.useRealTimers();
    expect(PASSWORD_RESET_SEND_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it('🔴 寄完重讀一直不回應 ⇒ 時限到回 null(呼叫端記成不明)', async () => {
    vi.useFakeTimers();
    getUserById.mockReturnValue(new Promise(() => {}));
    const p = readAuthEmail('u1');
    await vi.advanceTimersByTimeAsync(RECHECK_TIMEOUT_MS);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});
