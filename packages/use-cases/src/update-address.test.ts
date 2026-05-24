import { describe, it, expect, vi } from 'vitest';
import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress } from '@pcm/domain';
import { updateAddress } from './update-address';

function addr(over: Partial<CustomerAddress> = {}): CustomerAddress {
  return {
    id: 'a1',
    customerUserId: 'me',
    isDefault: false,
    name: 'n',
    phone: '0911',
    line: 'line',
    invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
    createdAt: 't',
    updatedAt: 't',
    ...over,
  };
}

describe('updateAddress', () => {
  it('非預設 patch:直接 update(id, patch)、不查清單/不 unset', async () => {
    const listByCustomer = vi.fn();
    const update = vi.fn().mockResolvedValue(addr({ name: '改' }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    const res = await updateAddress(repo, 'session-uid', 'a1', { name: '改' });

    expect(update).toHaveBeenCalledWith('a1', { name: '改' });
    expect(listByCustomer).not.toHaveBeenCalled();
    expect(res).toEqual(addr({ name: '改' }));
  });

  it('patch.isDefault=true:先 unset 其他預設(except 本筆)→ 再 update(順序固定)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([addr({ id: 'old', isDefault: true }), addr({ id: 'a1', isDefault: false })]);
    const update = vi.fn().mockResolvedValue(addr({ id: 'a1', isDefault: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await updateAddress(repo, 'session-uid', 'a1', { isDefault: true });

    // 第一次 update = unset 舊 old;第二次 = set 本筆
    expect(update).toHaveBeenNthCalledWith(1, 'old', { isDefault: false });
    expect(update).toHaveBeenNthCalledWith(2, 'a1', { isDefault: true });
  });

  it('patch.isDefault=true 但自己本來就是唯一預設:except 排除自己、不誤 unset、仍 update', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn().mockResolvedValue(addr({ id: 'a1', isDefault: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await updateAddress(repo, 'session-uid', 'a1', { isDefault: true });

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('a1', { isDefault: true });
  });

  it('patch.isDefault=true 但 addressId 非本人:先驗 ownership → 拋、且完全不 update(不留零預設)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await expect(updateAddress(repo, 'session-uid', 'not-mine', { isDefault: true })).rejects.toThrow(
      '不屬於目前 customer',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('update 失敗向上拋', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db'));
    const repo = {
      listByCustomer: vi.fn(),
      create: vi.fn(),
      update,
      delete: vi.fn(),
    } as unknown as IAddressRepository;
    await expect(updateAddress(repo, 'session-uid', 'a1', { name: 'x' })).rejects.toThrow('db');
  });
});
