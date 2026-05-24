import { describe, it, expect, vi } from 'vitest';
import type { IAddressRepository } from '@pcm/ports';
import type { CustomerAddress } from '@pcm/domain';
import { setDefaultAddress } from './set-default-address';

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

describe('setDefaultAddress', () => {
  it('兩步:先 unset 舊預設 → 再 set 本筆(順序固定 unset→set)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([addr({ id: 'old', isDefault: true }), addr({ id: 'target', isDefault: false })]);
    const update = vi
      .fn()
      .mockResolvedValueOnce(addr({ id: 'old', isDefault: false }))
      .mockResolvedValueOnce(addr({ id: 'target', isDefault: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    const res = await setDefaultAddress(repo, 'session-uid', 'target');

    expect(update).toHaveBeenNthCalledWith(1, 'old', { isDefault: false });
    expect(update).toHaveBeenNthCalledWith(2, 'target', { isDefault: true });
    expect(res).toEqual(addr({ id: 'target', isDefault: true }));
  });

  it('addressId 不屬本 customer:拋、且不呼叫任何 update', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'a1', isDefault: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await expect(setDefaultAddress(repo, 'session-uid', 'not-mine')).rejects.toThrow('不屬於目前 customer');
    expect(update).not.toHaveBeenCalled();
  });

  it('set 新失敗:向上拋讓 UI 重試(舊已 unset、零預設可接受、不補償 re-set)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([addr({ id: 'old', isDefault: true }), addr({ id: 'target', isDefault: false })]);
    const update = vi
      .fn()
      .mockResolvedValueOnce(addr({ id: 'old', isDefault: false })) // unset 舊成功
      .mockRejectedValueOnce(new Error('db')); // set 新失敗
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await expect(setDefaultAddress(repo, 'session-uid', 'target')).rejects.toThrow('db');
    // 不補償:只有 2 次 update(unset 舊 + 嘗試 set 新),沒有第 3 次 re-set
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('target 本來就是唯一預設:except 排除自己、不誤 unset、仍 set(冪等)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([addr({ id: 'target', isDefault: true })]);
    const update = vi.fn().mockResolvedValue(addr({ id: 'target', isDefault: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IAddressRepository;

    await setDefaultAddress(repo, 'session-uid', 'target');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('target', { isDefault: true });
  });
});
