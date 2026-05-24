import { describe, it, expect, vi } from 'vitest';
import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress } from '@pcm/domain';
import { deleteAddress } from './delete-address';

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

describe('deleteAddress', () => {
  it('刪非預設(仍有預設):驗 ownership → delete、不遞補', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([addr({ id: 'a1', isDefault: false }), addr({ id: 'def', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IAddressRepository;

    await deleteAddress(repo, 'session-uid', 'a1');

    expect(del).toHaveBeenCalledWith('a1');
    expect(update).not.toHaveBeenCalled();
  });

  it('刪預設、剩餘非空且無預設:第一筆(最舊)遞補 is_default=true(design L364-365)', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([
        addr({ id: 'a1', isDefault: true }),
        addr({ id: 'b', isDefault: false }),
        addr({ id: 'c', isDefault: false }),
      ]);
    const update = vi.fn().mockResolvedValue(addr({ id: 'b', isDefault: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IAddressRepository;

    await deleteAddress(repo, 'session-uid', 'a1');

    expect(del).toHaveBeenCalledWith('a1');
    expect(update).toHaveBeenCalledWith('b', { isDefault: true });
    expect(Number(del.mock.invocationCallOrder[0])).toBeLessThan(Number(update.mock.invocationCallOrder[0]));
  });

  it('刪掉最後一筆(剩餘空):delete、不遞補', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IAddressRepository;

    await deleteAddress(repo, 'session-uid', 'a1');

    expect(del).toHaveBeenCalledWith('a1');
    expect(update).not.toHaveBeenCalled();
  });

  it('addressId 非本人:先驗 ownership → 拋、且不 delete / 不遞補', async () => {
    const del = vi.fn();
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IAddressRepository;

    await expect(deleteAddress(repo, 'session-uid', 'not-mine')).rejects.toThrow('不屬於目前 customer');
    expect(del).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('delete 失敗向上拋(ownership 已過、不進遞補)', async () => {
    const del = vi.fn().mockRejectedValue(new Error('db'));
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IAddressRepository;

    await expect(deleteAddress(repo, 'session-uid', 'a1')).rejects.toThrow('db');
    expect(update).not.toHaveBeenCalled();
  });
});
