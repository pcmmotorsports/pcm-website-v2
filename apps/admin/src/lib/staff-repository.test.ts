import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createSupabaseServiceClient } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient }));

import {
  createStaffViaRpc,
  insertStaffRow,
  listStaffRows,
  setStaffActiveRow,
  setStaffActiveViaRpc,
  updateStaffProfileRow,
  updateStaffProfileViaRpc,
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


// ══════════════════════════════════════════════════════════════════════════════
// ⟦b4-MGR0-RPC⟧ 三支 RPC 包裝 —— **守的是「型別沒有在守的那幾件事」**
//
// 🔴 回來的 `row` 是 `jsonb` ⇒ 過線之後是 `unknown`。少一欄、型別跑掉、或函式被換成舊版,
//    **都不會有任何型別紅**。⇒ 下面每一格都在問同一句:**分不清楚的時候它會不會假裝成功?**
// ══════════════════════════════════════════════════════════════════════════════

function makeRpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc }, rpc };
}

const OK_ROW = { id: 'staff_9', label: '員工 9', is_manager: false, is_active: true };

describe('⟦b4-MGR0-RPC⟧ createStaffViaRpc', () => {
  it('🔴 函式名與五個參數名逐字正確(打錯一個字 ⇒ 線上 42883, 而型別抓不到)', async () => {
    const q = makeRpcClient({ data: { result: 'ok', row: OK_ROW }, error: null });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('sean', { id: 'staff_9', label: '員工 9', is_manager: false }, 'req-9'),
    ).resolves.toEqual({ kind: 'ok', row: OK_ROW });

    expect(q.rpc).toHaveBeenCalledWith('admin_staff_create', {
      p_actor: 'sean',
      p_id: 'staff_9',
      p_label: '員工 9',
      p_is_manager: false,
      p_request_id: 'req-9',
    });
  });

  it('🔴 RPC 的管理者閘(P0001 + 那句話)⇒ denied, **不是 throw**', async () => {
    const q = makeRpcClient({
      data: null,
      error: { code: 'P0001', message: '無權執行此操作' },
    });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('nobody', { id: 'x', label: 'x', is_manager: false }, 'req-9'),
    ).resolves.toEqual({ kind: 'denied' });
  });

  it('🔴 其他 P0001(空 request_id 那一類)⇒ **照樣 throw**(負對照:辨識不是只看 code)', async () => {
    const err = { code: 'P0001', message: 'admin_staff_create: p_request_id 不可為空' };
    const q = makeRpcClient({ data: null, error: err });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('sean', { id: 'x', label: 'x', is_manager: false }, '  '),
    ).rejects.toBe(err);
  });

  it('🔴 非 P0001 而訊息剛好含那句話 ⇒ **照樣 throw**(負對照:也不是只看訊息)', async () => {
    const err = { code: '42883', message: '無權執行此操作' };
    const q = makeRpcClient({ data: null, error: err });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('sean', { id: 'x', label: 'x', is_manager: false }, 'req-9'),
    ).rejects.toBe(err);
  });

  it('🔴 duplicate / not_found 是可預期結果, 不是例外', async () => {
    for (const [data, expected] of [
      [{ result: 'duplicate' }, { kind: 'duplicate' }],
      [{ result: 'not_found' }, { kind: 'not_found' }],
    ] as const) {
      const q = makeRpcClient({ data, error: null });
      createSupabaseServiceClient.mockReturnValue(q.client);
      await expect(
        createStaffViaRpc('sean', { id: 'x', label: 'x', is_manager: false }, 'req-9'),
      ).resolves.toEqual(expected);
    }
  });

  // 🔴🔴 **本組是這支包裝存在的理由** —— `ok` 而 row 壞掉時, 絕不可以回成功。
  //    DB 那一側已經寫進去了(含稽核), 而我們讀不回來 ⇒ 誠實報錯, 不宣稱已儲存。
  it.each([
    ['row 整個不見', { result: 'ok' }],
    ['row 是 null', { result: 'ok', row: null }],
    ['id 空字串', { result: 'ok', row: { ...OK_ROW, id: '' }}],
    ['is_manager 是字串', { result: 'ok', row: { ...OK_ROW, is_manager: 'true' }}],
    ['is_active 不見', { result: 'ok', row: { id: 'a', label: 'b', is_manager: false }}],
    ['label 是數字', { result: 'ok', row: { ...OK_ROW, label: 7 }}],
  ])('🔴 result=ok 而 %s ⇒ throw(不得回 ok)', async (_why, data) => {
    const q = makeRpcClient({ data, error: null });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('sean', { id: 'x', label: 'x', is_manager: false }, 'req-9'),
    ).rejects.toThrow('row 形狀不對');
  });

  it.each([
    ['result 沒見過', { result: 'maybe' }],
    ['整包是 null', null],
    ['整包是字串', 'ok'],
    ['沒有 result 欄', { row: OK_ROW }],
  ])('🔴 %s ⇒ throw(fail-closed, 不猜)', async (_why, data) => {
    const q = makeRpcClient({ data, error: null });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await expect(
      createStaffViaRpc('sean', { id: 'x', label: 'x', is_manager: false }, 'req-9'),
    ).rejects.toThrow('預期外的 result');
  });
});

describe('⟦b4-MGR0-RPC⟧ 另外兩支的函式名與參數名', () => {
  it('🔴 update_profile:四個參數名逐字', async () => {
    const q = makeRpcClient({ data: { result: 'ok', row: OK_ROW }, error: null });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await updateStaffProfileViaRpc('sean', 'staff_9', { label: '新名', is_manager: true }, 'req-9');

    expect(q.rpc).toHaveBeenCalledWith('admin_staff_update_profile', {
      p_actor: 'sean',
      p_id: 'staff_9',
      p_label: '新名',
      p_is_manager: true,
      p_request_id: 'req-9',
    });
  });

  it('🔴 set_active:參數是 p_is_active, **而且沒有 label / is_manager**', async () => {
    const q = makeRpcClient({ data: { result: 'ok', row: OK_ROW }, error: null });
    createSupabaseServiceClient.mockReturnValue(q.client);

    await setStaffActiveViaRpc('sean', 'staff_9', false, 'req-9');

    expect(q.rpc).toHaveBeenCalledWith('admin_staff_set_active', {
      p_actor: 'sean',
      p_id: 'staff_9',
      p_is_active: false,
      p_request_id: 'req-9',
    });
    // 🔴 承重:夾帶 label / is_manager 進去 ⇒ 那支 RPC 的「只碰 is_active」就白寫了。
    const args = q.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual([
      'p_actor',
      'p_id',
      'p_is_active',
      'p_request_id',
    ]);
  });
});
