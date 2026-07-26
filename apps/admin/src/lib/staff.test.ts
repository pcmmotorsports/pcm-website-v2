import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listStaffRows } = vi.hoisted(() => ({ listStaffRows: vi.fn() }));

vi.mock('./staff-repository', () => ({ listStaffRows }));

import {
  listActiveStaff,
  pickStaff,
  resolveStaff,
  type StaffActor,
} from './staff';

const FIXED_STAFF: readonly StaffActor[] = [
  { id: 'sean', label: 'Sean(老闆)' },
  { id: 'staff_1', label: '員工 1(占位)' },
  { id: 'staff_2', label: '員工 2(占位)' },
];

beforeEach(() => {
  listStaffRows.mockReset().mockResolvedValue([
    { id: 'sean', label: 'Sean(老闆)', is_active: true },
    { id: 'staff_1', label: '員工 1(占位)', is_active: true },
    { id: 'staff_2', label: '員工 2(占位)', is_active: true },
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe('staff', () => {
  it('should have at least one staff with unique ids', () => {
    expect(FIXED_STAFF.length).toBeGreaterThan(0);
    const ids = FIXED_STAFF.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should resolve a known id to its StaffActor', () => {
    expect(pickStaff(FIXED_STAFF, 'sean')).toEqual({ id: 'sean', label: 'Sean(老闆)' });
  });

  it('should return null for unknown / empty / nullish id (fail-closed)', () => {
    expect(pickStaff(FIXED_STAFF, 'nope')).toBeNull();
    expect(pickStaff(FIXED_STAFF, '')).toBeNull();
    expect(pickStaff(FIXED_STAFF, null)).toBeNull();
    expect(pickStaff(FIXED_STAFF, undefined)).toBeNull();
  });

  it('should return null when the matching database row is inactive', async () => {
    listStaffRows.mockResolvedValue([
      { id: 'former_staff', label: '已停用員工', is_active: false },
    ]);

    await expect(resolveStaff('former_staff')).resolves.toBeNull();
  });

  it('should return null without throwing when the database query fails', async () => {
    const dbError = new Error('database unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listStaffRows.mockRejectedValue(dbError);

    await expect(resolveStaff('sean')).resolves.toBeNull();
    expect(errorSpy).toHaveBeenCalledWith('[admin/staff] 員工名單載入失敗', dbError);
  });

  it('should return an empty list without throwing when the database query fails', async () => {
    const dbError = new Error('database unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    listStaffRows.mockRejectedValue(dbError);

    await expect(listActiveStaff()).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith('[admin/staff] 員工名單載入失敗', dbError);
  });
});
