// @vitest-environment node
//
// updateProfileAction server action test(g-4a、Q1=B 拆後端;對應 codex k1 round1 修法)。
//
// 信任邊界 5 層覆蓋:
// 1. server session unauthorized → formError「請重新登入」
// 2. ProfileInput zod validation 失敗 → fieldErrors 逐欄
// 3. ProfileInput strip 未知欄(id/user_id/tier/wallet_balance 全不透傳 use-case;codex k1 Consider 3 多欄補強)
// 4. birthday '' → null normalize(codex k1 Critical 1:DB date 欄拒空字串、domain string|null 接受 null)
// 5. malformed input(非 object、zod issue path 為空)→ formError fallback 不無聲失敗(codex k1 Consider 3)
// 6. updateProfile DB error → formError「儲存失敗,請稍後再試」(不洩 Supabase 原始 error)
// 7. 成功 → { ok: true }(g-4b client 收 ok 後 setSaved)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockUpdateProfile = vi.fn();
const mockGetCustomerRepo = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getCustomerRepo: () => mockGetCustomerRepo(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
}));

// Import 動態,確保 mock 生效後再載入 SUT(server action)。
async function getSUT() {
  return (await import('./actions')).updateProfileAction;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerSupabaseClient.mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  });
  mockGetCustomerRepo.mockResolvedValue({ update: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateProfileAction(g-4a server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 updateProfile', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0911', birthday: '1990-01-01' });
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('name 空 → fieldErrors.name「請填寫姓名」(zod min(1))', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    const res = await action({ name: '', phone: '', birthday: '' });
    expect(res.fieldErrors?.name).toBe('請填寫姓名');
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('malformed input(非 object)→ formError 不無聲失敗(codex k1 Consider 3)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const action = await getSUT();
    const res = await action('not-an-object' as unknown);
    // zod fail、但 issue path 可能在 root 或為空;不應回空 fieldErrors、應走 formError fallback
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      // 若 zod 仍對 name 報 required、亦合理
      expect(res.fieldErrors.name).toBeTruthy();
    } else {
      expect(res.formError).toBe('請填寫必要欄位');
    }
    expect(mockUpdateProfile).not.toHaveBeenCalled();
  });

  it('strip 未知欄:tier/id/user_id/wallet_balance 全不透傳 use-case(codex k1 Consider 3)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const updateMock = vi.fn().mockResolvedValue({});
    mockGetCustomerRepo.mockResolvedValue({ update: updateMock });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1' });
    const action = await getSUT();
    await action({
      name: '王',
      phone: '0911',
      birthday: '1990-01-01',
      // 攻擊面:client 偽造這些欄、ProfileInput zod 必 strip
      tier: 'premiumStore',
      id: 'attacker-id',
      user_id: 'attacker-uid',
      wallet_balance: 999999,
      totalDeposit: 999999,
    } as unknown);
    expect(mockUpdateProfile).toHaveBeenCalledOnce();
    const [, currentUserId, patch] = mockUpdateProfile.mock.calls[0]!;
    expect(currentUserId).toBe('user-1'); // server session、非 input 的 id/user_id
    // patch 只有三欄、其他全被 strip
    expect(Object.keys(patch).sort()).toEqual(['birthday', 'name', 'phone']);
    expect(patch).not.toHaveProperty('tier');
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('user_id');
    expect(patch).not.toHaveProperty('wallet_balance');
  });

  it('birthday 空字串 → null normalize(codex k1 Critical 1:DB date 欄拒 ""、domain string|null 接受 null)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '0911', birthday: '' });
    expect(mockUpdateProfile).toHaveBeenCalledOnce();
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.birthday).toBeNull();
  });

  it('birthday 非空 → 原樣傳遞(YYYY-MM-DD 字串)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '0911', birthday: '1990-12-31' });
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.birthday).toBe('1990-12-31');
  });

  it('updateProfile 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩 Supabase 原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockRejectedValue(new Error('PostgresError: RLS policy violated'));
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0911', birthday: '1990-01-01' });
    expect(res.formError).toBe('儲存失敗,請稍後再試');
    expect(res.formError).not.toContain('RLS');
    expect(res.formError).not.toContain('Postgres');
  });

  it('成功 → { ok: true }(g-4b client 收 ok 後 setSaved)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({ id: 'user-1', name: '王' });
    const action = await getSUT();
    const res = await action({ name: '王', phone: '0911', birthday: '1990-01-01' });
    expect(res).toEqual({ ok: true });
  });

  it('phone 空 → 原樣傳遞 ""(domain string、DB text 接受、不必 normalize null)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateProfile.mockResolvedValue({});
    const action = await getSUT();
    await action({ name: '王', phone: '', birthday: '1990-01-01' });
    const [, , patch] = mockUpdateProfile.mock.calls[0]!;
    expect(patch.phone).toBe('');
  });
});
