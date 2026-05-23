import { describe, it, expect, vi } from 'vitest';
import type { ICustomerRepository } from '@pcm/ports';
import type { Customer } from '@pcm/domain';
import { updateProfile } from './update-profile';

// 守 boundary(A 決策):currentUserId 由 caller(server session)傳、patch 型別窄 → tier/id 型別上不可能進。
// 「表單夾帶 tier/id 被 strip」的 runtime trust-boundary 測試屬 delivery 層(f1 server action)。

const CUSTOMER: Customer = {
  id: 'me',
  email: 'a@b.com',
  name: '新名',
  phone: '0911',
  birthday: '1990-01-01',
  tier: 'general',
  walletBalance: 0,
  totalDeposit: 0,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const PATCH: Pick<Customer, 'name' | 'phone' | 'birthday'> = {
  name: '新名',
  phone: '0911',
  birthday: '1990-01-01',
};

describe('updateProfile', () => {
  it('用 currentUserId(由 caller 傳)+ patch 呼叫 ICustomerRepository.update、回傳其結果', async () => {
    const update = vi.fn().mockResolvedValue(CUSTOMER);
    const repo = { findById: vi.fn(), findByEmail: vi.fn(), update } as unknown as ICustomerRepository;
    const res = await updateProfile(repo, 'session-uid', PATCH);
    expect(res).toEqual(CUSTOMER);
    expect(update).toHaveBeenCalledWith('session-uid', PATCH);
  });

  it('update 失敗向上拋', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db'));
    const repo = { findById: vi.fn(), findByEmail: vi.fn(), update } as unknown as ICustomerRepository;
    await expect(updateProfile(repo, 'session-uid', PATCH)).rejects.toThrow('db');
  });
});
