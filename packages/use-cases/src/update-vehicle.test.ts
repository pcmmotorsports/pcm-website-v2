import { describe, it, expect, vi } from 'vitest';
import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle } from '@pcm/domain';
import { NotOwnedError } from '@pcm/domain';
import { updateVehicle } from './update-vehicle';

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

describe('updateVehicle', () => {
  it('非主車 patch(#199):先驗本人(listByCustomer ownership backstop)→ update(id, patch)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1' })]);
    const update = vi.fn().mockResolvedValue(veh({ name: '改' }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    const res = await updateVehicle(repo, 'session-uid', 'v1', { name: '改' });

    expect(listByCustomer).toHaveBeenCalledWith('session-uid'); // #199 app 層 defense-in-depth(非只靠 RLS)
    expect(update).toHaveBeenCalledWith('v1', { name: '改' });
    expect(res).toEqual(veh({ name: '改' }));
  });

  it('非主車 patch 但 vehicleId 非本人(#199 backstop):先驗 → 拋、完全不 update', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1' })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await expect(updateVehicle(repo, 'session-uid', 'not-mine', { name: '改' })).rejects.toThrow(
      NotOwnedError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('清空保養日 patch { service: null }:原樣直送(pass-through;#199 先驗本人)', async () => {
    const update = vi.fn().mockResolvedValue(veh({ service: null }));
    const repo = {
      listByCustomer: vi.fn().mockResolvedValue([veh({ id: 'v1' })]),
      create: vi.fn(),
      update,
      delete: vi.fn(),
    } as unknown as IVehicleRepository;

    await updateVehicle(repo, 'session-uid', 'v1', { service: null });

    expect(update).toHaveBeenCalledWith('v1', { service: null });
  });

  it('patch.isPrimary=true:先驗 ownership + unset 其他主車(except 本筆)→ 再 update(順序固定)', async () => {
    const listByCustomer = vi
      .fn()
      .mockResolvedValue([veh({ id: 'old', isPrimary: true }), veh({ id: 'v1', isPrimary: false })]);
    const update = vi.fn().mockResolvedValue(veh({ id: 'v1', isPrimary: true }));
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await updateVehicle(repo, 'session-uid', 'v1', { isPrimary: true });

    expect(update).toHaveBeenNthCalledWith(1, 'old', { isPrimary: false });
    expect(update).toHaveBeenNthCalledWith(2, 'v1', { isPrimary: true });
  });

  it('patch.isPrimary=true 但 vehicleId 非本人:先驗 ownership → 拋、且完全不 update(不留零主車)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'v1', isPrimary: true })]);
    const update = vi.fn();
    const repo = { listByCustomer, create: vi.fn(), update, delete: vi.fn() } as unknown as IVehicleRepository;

    await expect(updateVehicle(repo, 'session-uid', 'not-mine', { isPrimary: true })).rejects.toThrow(
      NotOwnedError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('update 失敗向上拋', async () => {
    const update = vi.fn().mockRejectedValue(new Error('db'));
    const repo = {
      listByCustomer: vi.fn().mockResolvedValue([veh({ id: 'v1' })]), // #199:plain-update 先查清單驗本人
      create: vi.fn(),
      update,
      delete: vi.fn(),
    } as unknown as IVehicleRepository;
    await expect(updateVehicle(repo, 'session-uid', 'v1', { name: 'x' })).rejects.toThrow('db');
  });
});
