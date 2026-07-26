import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import { listStaffRows } from './staff-repository';

function makeClient(result: { data: unknown; error: unknown }) {
  const order = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ order });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from }, from, select, order };
}

beforeEach(() => createSupabaseServiceClient.mockReset());

describe('listStaffRows', () => {
  it('should execute the complete staff query chain and return rows', async () => {
    const rows = [{ id: 'sean', label: 'Sean(老闆)', is_active: true }];
    const query = makeClient({ data: rows, error: null });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listStaffRows()).resolves.toEqual(rows);
    expect(query.from).toHaveBeenCalledWith('staff');
    expect(query.select).toHaveBeenCalledWith('id, label, is_active');
    expect(query.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('should throw when Supabase returns an error', async () => {
    const dbError = { message: 'permission denied' };
    const query = makeClient({ data: null, error: dbError });
    createSupabaseServiceClient.mockReturnValue(query.client);

    await expect(listStaffRows()).rejects.toBe(dbError);
  });
});
