import { describe, it, expect, vi } from 'vitest';
import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle } from '@pcm/domain';
import { deleteVehicle } from './delete-vehicle';

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

describe('deleteVehicle', () => {
  it('刪非主車(仍有主車):驗 ownership → delete、不遞補', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([veh({ id: 'v1', isPrimary: false }), veh({ id: 'pri', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IVehicleRepository;

    await deleteVehicle(repo, 'session-uid', 'v1');

    expect(del).toHaveBeenCalledWith('v1');
    expect(update).not.toHaveBeenCalled();
  });

  it('刪主車、剩餘非空且無主車:第一筆(最舊)遞補 is_primary=true(design L401-406)', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([
        veh({ id: 'v1', isPrimary: true }),
        veh({ id: 'b', isPrimary: false }),
        veh({ id: 'c', isPrimary: false }),
      ]);
    const update = vi.fn().mockResolvedValue(veh({ id: 'b', isPrimary: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IVehicleRepository;

    await deleteVehicle(repo, 'session-uid', 'v1');

    expect(del).toHaveBeenCalledWith('v1');
    expect(update).toHaveBeenCalledWith('b', { isPrimary: true });
    expect(Number(del.mock.invocationCallOrder[0])).toBeLessThan(Number(update.mock.invocationCallOrder[0]));
  });

  it('刪掉最後一台(剩餘空):delete、不遞補', async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IVehicleRepository;

    await deleteVehicle(repo, 'session-uid', 'v1');

    expect(del).toHaveBeenCalledWith('v1');
    expect(update).not.toHaveBeenCalled();
  });

  it('vehicleId 非本人:先驗 ownership → 拋、且不 delete / 不遞補', async () => {
    const del = vi.fn();
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IVehicleRepository;

    await expect(deleteVehicle(repo, 'session-uid', 'not-mine')).rejects.toThrow('不屬於目前 customer');
    expect(del).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('delete 失敗向上拋(ownership 已過、不進遞補)', async () => {
    const del = vi.fn().mockRejectedValue(new Error('db'));
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: del } as unknown as IVehicleRepository;

    await expect(deleteVehicle(repo, 'session-uid', 'v1')).rejects.toThrow('db');
    expect(update).not.toHaveBeenCalled();
  });
});
