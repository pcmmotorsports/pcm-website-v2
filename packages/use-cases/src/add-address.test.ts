import { describe, it, expect, vi } from 'vitest';
import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress } from '@pcm/domain';
import { addAddress, type AddressCreateInput } from './add-address';

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
const INPUT: AddressCreateInput = {
  isDefault: false,
  name: 'n',
  phone: '0911',
  line: 'line',
  invoice: { type: 'personal', carrier: '', title: '', taxId: '', donateCode: '' },
};

describe('addAddress', () => {
  it('非預設:用 currentUserId 填 customerUserId 後 create,不查清單/不 unset(design 不強制首筆預設)', async () => {
    const listByCustomer = vi.fn();
    const create = vi.fn().mockResolvedValue(addr());
    const update = vi.fn();
    const repo = { listByCustomer, create, update, delete: vi.fn() } as unknown as IAddressRepository;

    const res = await addAddress(repo, 'session-uid', INPUT);

    expect(create).toHaveBeenCalledWith({ ...INPUT, customerUserId: 'session-uid' });
    expect(listByCustomer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res).toEqual(addr());
  });

  it('isDefault=true:先 unset 既有預設 → 再 create(順序固定 unset→create)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'old', isDefault: true })]);
    const update = vi.fn().mockResolvedValue(addr({ id: 'old', isDefault: false }));
    const create = vi.fn().mockResolvedValue(addr({ id: 'new', isDefault: true }));
    const repo = { listByCustomer, create, update, delete: vi.fn() } as unknown as IAddressRepository;

    await addAddress(repo, 'session-uid', { ...INPUT, isDefault: true });

    expect(update).toHaveBeenCalledWith('old', { isDefault: false });
    expect(create).toHaveBeenCalledWith({ ...INPUT, isDefault: true, customerUserId: 'session-uid' });
    expect(Number(update.mock.invocationCallOrder[0])).toBeLessThan(Number(create.mock.invocationCallOrder[0]));
  });

  it('create 失敗向上拋', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db'));
    const repo = {
      listByCustomer: vi.fn(),
      create,
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IAddressRepository;
    await expect(addAddress(repo, 'session-uid', INPUT)).rejects.toThrow('db');
  });
});
