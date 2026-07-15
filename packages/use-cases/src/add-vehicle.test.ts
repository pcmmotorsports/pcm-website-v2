import { describe, it, expect, vi } from 'vitest';
import type { IVehicleRepository } from '@pcm/ports';
import type { CustomerVehicle } from '@pcm/domain';
import { addVehicle, type VehicleCreateInput } from './add-vehicle';

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
    dictBrandName: null,
    dictModelName: null,
    createdAt: 't',
    updatedAt: 't',
    ...over,
  };
}
const INPUT: VehicleCreateInput = {
  isPrimary: false,
  name: 'YZF-R6',
  year: '2022',
  engine: 'RJ27',
  km: '12,000 km',
  mods: '',
  service: null,
  dictBrandName: null,
  dictModelName: null,
};

describe('addVehicle', () => {
  it('非主車:用 currentUserId 填 customerUserId 後 create、不查清單/不 unset(不強制首台;service:null 直送)', async () => {
    const listByCustomer = vi.fn();
    const create = vi.fn().mockResolvedValue(veh());
    const update = vi.fn();
    const repo = { listByCustomer, create, update, delete: vi.fn() } as unknown as IVehicleRepository;

    const res = await addVehicle(repo, 'session-uid', INPUT);

    expect(create).toHaveBeenCalledWith({ ...INPUT, customerUserId: 'session-uid' });
    expect(listByCustomer).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(res).toEqual(veh());
  });

  it('isPrimary=true:先 unset 既有主車 → 再 create(順序固定 unset→create)', async () => {
    const listByCustomer = vi.fn().mockResolvedValue([veh({ id: 'old', isPrimary: true })]);
    const update = vi.fn().mockResolvedValue(veh({ id: 'old', isPrimary: false }));
    const create = vi.fn().mockResolvedValue(veh({ id: 'new', isPrimary: true }));
    const repo = { listByCustomer, create, update, delete: vi.fn() } as unknown as IVehicleRepository;

    await addVehicle(repo, 'session-uid', { ...INPUT, isPrimary: true });

    expect(update).toHaveBeenCalledWith('old', { isPrimary: false });
    expect(create).toHaveBeenCalledWith({ ...INPUT, isPrimary: true, customerUserId: 'session-uid' });
    expect(Number(update.mock.invocationCallOrder[0])).toBeLessThan(Number(create.mock.invocationCallOrder[0]));
  });

  it('service 為日期字串時原樣直送(pass-through、不正規化)', async () => {
    const create = vi.fn().mockResolvedValue(veh({ service: '2026-03-01' }));
    const repo = {
      listByCustomer: vi.fn(),
      create,
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IVehicleRepository;

    await addVehicle(repo, 'session-uid', { ...INPUT, service: '2026-03-01' });

    expect(create).toHaveBeenCalledWith({ ...INPUT, service: '2026-03-01', customerUserId: 'session-uid' });
  });

  it('create 失敗向上拋', async () => {
    const create = vi.fn().mockRejectedValue(new Error('db'));
    const repo = {
      listByCustomer: vi.fn(),
      create,
      update: vi.fn(),
      delete: vi.fn(),
    } as unknown as IVehicleRepository;
    await expect(addVehicle(repo, 'session-uid', INPUT)).rejects.toThrow('db');
  });
});
