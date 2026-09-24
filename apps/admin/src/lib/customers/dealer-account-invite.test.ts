import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const inviteUserByEmail = vi.fn();
const getUserById = vi.fn();
const ilike = vi.fn();
let rows: unknown = { data: [], error: null };
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({
    auth: { admin: { inviteUserByEmail, getUserById } },
    from: () => ({ select: () => ({ ilike: (...a: unknown[]) => (ilike(...a), { limit: async () => rows }) }) }),
  }),
  SupabaseDealerApplicationAdapter: class {},
}));

import { DEALER_INVITE_REDIRECT_TO, findCustomerIdByEmail, inviteDealerUser } from './dealer-application-repository';

beforeEach(() => {
  inviteUserByEmail.mockReset();
  getUserById.mockReset();
  ilike.mockReset();
  getUserById.mockResolvedValue({ data: { user: { email: 'owner@shop.tw' } }, error: null });
});

describe('寄經銷帳號邀請信的結果分類(片 D4a)', () => {
  it('成功 ⇒ 回 user ID;redirectTo 是固定的顧客站 /auth/confirm', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(await inviteDealerUser('a@x.tw', '王')).toEqual({ kind: 'ok', userId: 'u1' });
    expect(inviteUserByEmail).toHaveBeenCalledWith('a@x.tw', { redirectTo: DEALER_INVITE_REDIRECT_TO, data: { name: '王' } });
    expect(DEALER_INVITE_REDIRECT_TO).toBe('https://www.pcmmotorsports.com/auth/confirm');
  });

  it('Email 已有帳號 ⇒ exists', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', status: 422, message: 'x' } });
    expect((await inviteDealerUser('a@x.tw', '王')).kind).toBe('exists');
  });

  it('明確的 4xx ⇒ failed(確定沒有建立)', async () => {
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { code: 'validation_failed', status: 400, message: 'x' } });
    expect((await inviteDealerUser('a@x.tw', '王')).kind).toBe('failed');
  });

  it.each([
    ['閘道逾時 504', { status: 504, name: 'AuthRetryableFetchError', message: '' }],
    ['網路斷線(沒有狀態碼)', { status: 0, name: 'AuthRetryableFetchError', message: 'fetch failed' }],
    ['狀態碼不明', { message: 'x' }],
  ])('🔴 %s ⇒ unknown(帳號可能已建立, 不能說失敗)', async (_n, error) => {
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error });
    expect((await inviteDealerUser('a@x.tw', '王')).kind).toBe('unknown');
  });

  it('🔴 錯誤訊息(可能含 Email)不寫進 log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { status: 400, code: 'email_address_invalid', message: 'Email address "secret@x.tw" is invalid' } });
    await inviteDealerUser('secret@x.tw', '王');
    expect(JSON.stringify(spy.mock.calls)).not.toContain('secret@x.tw');
    spy.mockRestore();
  });

  it('呼叫整段拋出 ⇒ unknown', async () => {
    inviteUserByEmail.mockImplementation(() => {
      throw new Error('socket hang up');
    });
    expect(await inviteDealerUser('a@x.tw', '王')).toEqual({ kind: 'unknown' });
  });
});

describe('用 Email 找帳號(片 D4a「用這個帳號完成經銷設定」)', () => {
  it('不分大小寫完整比對, 登入系統的 Email 也一致 ⇒ found', async () => {
    rows = { data: [{ user_id: 'u1', email: 'owner@shop.tw' }], error: null };
    expect(await findCustomerIdByEmail('Owner@Shop.tw')).toEqual({ kind: 'found', userId: 'u1' });
    expect(getUserById).toHaveBeenCalledWith('u1');
  });

  it('🔴 Email 裡的 _ 會被 ilike 當萬用字元 ⇒ 候選要逐字比, 不能把 ownerX 當成 owner_', async () => {
    rows = { data: [{ user_id: 'u9', email: 'ownerx@shop.tw' }], error: null };
    expect(await findCustomerIdByEmail('owner_@shop.tw')).toEqual({ kind: 'none' });
  });

  it('🔴 大小寫不同的兩筆 ⇒ ambiguous, 不自動挑', async () => {
    rows = { data: [{ user_id: 'u1', email: 'Owner@shop.tw' }, { user_id: 'u2', email: 'owner@shop.tw' }], error: null };
    expect(await findCustomerIdByEmail('OWNER@shop.tw')).toEqual({ kind: 'ambiguous' });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('🔴 客戶資料的 Email 跟登入系統不一致(改信箱半套)⇒ mismatch', async () => {
    rows = { data: [{ user_id: 'u1', email: 'owner@shop.tw' }], error: null };
    getUserById.mockResolvedValue({ data: { user: { email: 'new@shop.tw' } }, error: null });
    expect(await findCustomerIdByEmail('owner@shop.tw')).toEqual({ kind: 'mismatch' });
  });

  it('查詢出錯 ⇒ failed', async () => {
    rows = { data: null, error: { code: 'XX' } };
    expect(await findCustomerIdByEmail('owner@shop.tw')).toEqual({ kind: 'failed' });
  });
});
