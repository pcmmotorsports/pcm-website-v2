import { describe, it, expect, vi } from 'vitest';
import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle } from '@pcm/domain';
import { NotOwnedError } from '@pcm/domain';
import { setPrimaryVehicle } from './set-primary-vehicle';

function veh(over: Partial<CustomerVehicle> = {}): CustomerVehicle {
  return {
    id: 'v1',
    customerUserId: 'me',
    isPrimary: false,
    name: 'YZF-R6',
    year: '2022',
    engine: 'RJ27',
    km: '12,000 km',
    mods: '',
    service: null,
    createdAt: 't',
    updatedAt: 't',
    ...over,
  };
}

describe('setPrimaryVehicle', () => {
  it('兩步:先 unset 舊主車 → 再 set 本筆(順序固定 unset→set)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([veh({ id: 'old', isPrimary: true }), veh({ id: 'target', isPrimary: false })]);
    const update = vi
      .fn()
      .mockResolvedValueOnce(veh({ id: 'old', isPrimary: false }))
      .mockResolvedValueOnce(veh({ id: 'target', isPrimary: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    const res = await setPrimaryVehicle(repo, 'session-uid', 'target');

    expect(update).toHaveBeenNthCalledWith(1, 'old', { isPrimary: false });
    expect(update).toHaveBeenNthCalledWith(2, 'target', { isPrimary: true });
    expect(res).toEqual(veh({ id: 'target', isPrimary: true }));
  });

  it('vehicleId 不屬本 customer:拋、且不呼叫任何 update', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await expect(setPrimaryVehicle(repo, 'session-uid', 'not-mine')).rejects.toThrow(NotOwnedError);
    expect(update).not.toHaveBeenCalled();
  });

  it('set 新失敗:向上拋讓 UI 重試(舊已 unset、零主車可接受、不補償 re-set)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([veh({ id: 'old', isPrimary: true }), veh({ id: 'target', isPrimary: false })]);
    const update = vi
      .fn()
      .mockResolvedValueOnce(veh({ id: 'old', isPrimary: false }))
      .mockRejectedValueOnce(new Error('db'));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await expect(setPrimaryVehicle(repo, 'session-uid', 'target')).rejects.toThrow('db');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('target 本來就是唯一主車:except 排除自己、不誤 unset、仍 set(冪等)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'target', isPrimary: true })]);
    const update = vi.fn().mockResolvedValue(veh({ id: 'target', isPrimary: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await setPrimaryVehicle(repo, 'session-uid', 'target');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('target', { isPrimary: true });
  });
});
