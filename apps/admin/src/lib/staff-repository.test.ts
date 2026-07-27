import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import {
  insertStaffRow,
  listStaffRows,
  setStaffActiveRow,
  updateStaffProfileRow,
} from './staff-repository';

function makeListClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, order };
}

function makeInsertClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ single });
  const insert = vi.fn().mockReturnValue({ select });
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from }, from, insert, select, single };
}

function makeUpdateClient(result: { data: unknown; error: unknown }) {
  const select = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { client: { from }, from, update, eq, select };
}

beforeEach(() => createSupabaseServiceClient.mockReset());

describe('listStaffRows', () => {
  it('should execute the complete staff query chain and return rows', async () => {
    const rows = [
      {
        id: 'sean',
        label: 'Sean(老闆)',
        is_manager: true,
        is_active: true,
      },
    ];
    const query = makeListClient({ data: rows, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listStaffRows()).resolves.toEqual(rows);
    expect(query.from).toHaveBeenCalledWith('staff');
    expect(query.select).toHaveBeenCalledWith(
      'id, label, is_manager, is_active',
    );
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('should throw when Supabase returns an error', async () => {
    const dbError = { message: 'permission denied' };
    const query = makeListClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listStaffRows()).rejects.toBe(dbError);
  });
});

describe('insertStaffRow', () => {
  it('should execute the complete insert/select/single chain and return the row', async () => {
    const row = {
      id: 'staff_3',
      label: '員工 3',
      is_manager: false,
      is_active: true,
    };
    const query = makeInsertClient({ data: row, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(
      insertStaffRow({ id: 'staff_3', label: '員工 3', is_manager: false }),
    ).resolves.toEqual(row);
    expect(query.from).toHaveBeenCalledWith('staff');
    expect(query.insert).toHaveBeenCalledWith({
      id: 'staff_3',
      label: '員工 3',
      is_manager: false,
    });
    expect(query.select).toHaveBeenCalledWith(
      'id, label, is_manager, is_active',
    );
    expect(query.single).toHaveBeenCalledOnce();
  });

  it('should map PostgreSQL unique violation to DUPLICATE', async () => {
    const query = makeInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(
      insertStaffRow({ id: 'sean', label: '另一個 Sean', is_manager: true }),
    ).resolves.toBe('DUPLICATE');
  });

  it('should throw a PostgreSQL error that is not a unique violation', async () => {
    const dbError = { code: '42501', message: 'permission denied' };
    const query = makeInsertClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(
      insertStaffRow({ id: 'staff_3', label: '員工 3', is_manager: false }),
    ).rejects.toBe(dbError);
  });
});

describe('updateStaffProfileRow', () => {
  it('should update label and manager marker without active state', async () => {
    const row = {
      id: 'staff_1',
      label: '王小明',
      is_manager: true,
      is_active: true,
    };
    const query = makeUpdateClient({ data: [row], error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(
      updateStaffProfileRow('staff_1', {
        label: '王小明',
        is_manager: true,
      }),
    ).resolves.toEqual(row);
    expect(query.update).toHaveBeenCalledWith({
      label: '王小明',
      is_manager: true,
    });
    expect(query.eq).toHaveBeenCalledWith('id', 'staff_1');
    expect(query.select).toHaveBeenCalledWith(
      'id, label, is_manager, is_active',
    );
  });

  it('should return null when select reports no affected row', async () => {
    const query = makeUpdateClient({ data: [], error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(
      updateStaffProfileRow('missing', {
        label: '不存在',
        is_manager: false,
      }),
    ).resolves.toBeNull();
  });
});

describe('setStaffActiveRow', () => {
  it('should update active state without label or manager marker', async () => {
    const row = {
      id: 'staff_1',
      label: '員工 1',
      is_manager: false,
      is_active: false,
    };
    const query = makeUpdateClient({ data: [row], error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(setStaffActiveRow('staff_1', false)).resolves.toEqual(row);
    expect(query.update).toHaveBeenCalledWith({ is_active: false });
    expect(query.eq).toHaveBeenCalledWith('id', 'staff_1');
    expect(query.select).toHaveBeenCalledWith(
      'id, label, is_manager, is_active',
    );
  });
});
