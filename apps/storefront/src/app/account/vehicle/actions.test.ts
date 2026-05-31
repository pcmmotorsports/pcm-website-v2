// @vitest-environment node
//
// addVehicleAction server action test(g-6b、session-write add)。鏡像 address/actions.test.ts 信任邊界覆蓋:
// 1. 未登入 → formError「請重新登入」+ 不呼叫 addVehicle
// 2. 驗證錯(車型 name 空)→ fieldErrors.name + 不呼叫 addVehicle
// 3. malformed input(非 object)→ formError fallback、不無聲失敗
// 4. ownership / 白名單:addVehicle 收 (repo, session user.id, parsed.data);currentUserId 非 input、strip 未知欄
// 5. addVehicle 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩原始 error
// 6. 成功 → { ok: true }
//
// 用真 VehicleInput schema(不 mock @pcm/schemas)驗 validation / strip / default 真實行為(僅 name 必填、無巢狀)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddVehicle = vi.fn();
const mockUpdateVehicle = vi.fn();
const mockDeleteVehicle = vi.fn();
const mockGetVehicleRepo = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  addVehicle: (...args: unknown[]) => mockAddVehicle(...args),
  updateVehicle: (...args: unknown[]) => mockUpdateVehicle(...args),
  deleteVehicle: (...args: unknown[]) => mockDeleteVehicle(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getVehicleRepo: () => mockGetVehicleRepo(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
}));

async function getActions() {
  const m = await import('./actions');
  return {
    addVehicleAction: m.addVehicleAction,
    updateVehicleAction: m.updateVehicleAction,
    deleteVehicleAction: m.deleteVehicleAction,
  };
}

// 合法 VehicleInput payload(僅 name 必填;其餘 string 欄由 schema default 補 '')。
function validInput(over: Record<string, unknown> = {}) {
  return { name: 'YAMAHA YZF-R6', ...over };
}

const fakeRepo = { create: vi.fn(), listByCustomer: vi.fn(), update: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerSupabaseClient.mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  });
  mockGetVehicleRepo.mockResolvedValue(fakeRepo);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('addVehicleAction(g-6b server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 addVehicle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { addVehicleAction } = await getActions();
    const result = await addVehicleAction(validInput());
    expect(result).toEqual({ formError: '請重新登入' });
    expect(mockAddVehicle).not.toHaveBeenCalled();
  });

  it('車型 name 空 → fieldErrors.name + 不呼叫 addVehicle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const { addVehicleAction } = await getActions();
    const result = await addVehicleAction(validInput({ name: '' }));
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(mockAddVehicle).not.toHaveBeenCalled();
  });

  it('malformed input(非 object)→ formError fallback、不無聲失敗', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const { addVehicleAction } = await getActions();
    const result = await addVehicleAction(42);
    // zod safeParse 非 object → 無逐欄 path、走 formError fallback
    expect(result.formError).toBeTruthy();
    expect(mockAddVehicle).not.toHaveBeenCalled();
  });

  it('ownership / 白名單:addVehicle 收 (repo, session user.id, strip 後 input)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-session' } } });
    mockAddVehicle.mockResolvedValue({ id: 'v-new' });
    const { addVehicleAction } = await getActions();
    // input 夾帶偽造 customerUserId / id → 應被 schema strip、use-case 用 session user.id
    await addVehicleAction(validInput({ id: 'evil', customerUserId: 'u-attacker', isPrimary: true }));
    expect(mockAddVehicle).toHaveBeenCalledTimes(1);
    const [repoArg, userIdArg, inputArg] = mockAddVehicle.mock.calls[0]!;
    expect(repoArg).toBe(fakeRepo);
    expect(userIdArg).toBe('u-session');
    expect(inputArg).not.toHaveProperty('id');
    expect(inputArg).not.toHaveProperty('customerUserId');
    expect(inputArg.name).toBe('YAMAHA YZF-R6');
    expect(inputArg.isPrimary).toBe(true);
  });

  it('addVehicle 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockAddVehicle.mockRejectedValue(new Error('supabase raw error 23505'));
    const { addVehicleAction } = await getActions();
    const result = await addVehicleAction(validInput());
    expect(result).toEqual({ formError: '儲存失敗,請稍後再試' });
  });

  it('成功 → { ok: true }', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockAddVehicle.mockResolvedValue({ id: 'v-new' });
    const { addVehicleAction } = await getActions();
    const result = await addVehicleAction(validInput());
    expect(result).toEqual({ ok: true });
  });
});

describe('updateVehicleAction(g-6c server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 updateVehicle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { updateVehicleAction } = await getActions();
    const result = await updateVehicleAction('v-1', validInput());
    expect(result).toEqual({ formError: '請重新登入' });
    expect(mockUpdateVehicle).not.toHaveBeenCalled();
  });

  it('車型 name 空 → fieldErrors.name + 不呼叫 updateVehicle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    const { updateVehicleAction } = await getActions();
    const result = await updateVehicleAction('v-1', validInput({ name: '' }));
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(mockUpdateVehicle).not.toHaveBeenCalled();
  });

  it('ownership / 白名單:updateVehicle 收 (repo, session user.id, 參數 vehicleId, strip 後 patch)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-session' } } });
    mockUpdateVehicle.mockResolvedValue({ id: 'v-1' });
    const { updateVehicleAction } = await getActions();
    await updateVehicleAction('v-1', validInput({ id: 'evil', customerUserId: 'u-attacker', isPrimary: true }));
    expect(mockUpdateVehicle).toHaveBeenCalledTimes(1);
    const [repoArg, userIdArg, vehicleIdArg, patch] = mockUpdateVehicle.mock.calls[0]!;
    expect(repoArg).toBe(fakeRepo);
    expect(userIdArg).toBe('u-session'); // server session、非 input 偽造的 customerUserId
    expect(vehicleIdArg).toBe('v-1'); // 來自 action 參數(parent closure)
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('customerUserId');
    expect(patch.name).toBe('YAMAHA YZF-R6');
    expect(patch.isPrimary).toBe(true);
  });

  it('updateVehicle 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpdateVehicle.mockRejectedValue(new Error('supabase raw error'));
    const { updateVehicleAction } = await getActions();
    const result = await updateVehicleAction('v-1', validInput());
    expect(result).toEqual({ formError: '儲存失敗,請稍後再試' });
  });

  it('成功 → { ok: true }', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockUpdateVehicle.mockResolvedValue({ id: 'v-1' });
    const { updateVehicleAction } = await getActions();
    const result = await updateVehicleAction('v-1', validInput());
    expect(result).toEqual({ ok: true });
  });
});

describe('deleteVehicleAction(g-6c server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 deleteVehicle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { deleteVehicleAction } = await getActions();
    const result = await deleteVehicleAction('v-1');
    expect(result).toEqual({ formError: '請重新登入' });
    expect(mockDeleteVehicle).not.toHaveBeenCalled();
  });

  it('ownership 不符(use-case 拋)→ formError「刪除失敗,請稍後再試」+ 不洩原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mockDeleteVehicle.mockRejectedValue(new Error('vehicle 不屬於目前 customer'));
    const { deleteVehicleAction } = await getActions();
    const result = await deleteVehicleAction('v-1');
    expect(result).toEqual({ formError: '刪除失敗,請稍後再試' });
  });

  it('成功 → { ok: true } + deleteVehicle 收 (repo, session user.id, 參數 vehicleId)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u-session' } } });
    mockDeleteVehicle.mockResolvedValue(undefined);
    const { deleteVehicleAction } = await getActions();
    const result = await deleteVehicleAction('v-1');
    expect(result).toEqual({ ok: true });
    expect(mockDeleteVehicle).toHaveBeenCalledWith(fakeRepo, 'u-session', 'v-1');
  });
});
