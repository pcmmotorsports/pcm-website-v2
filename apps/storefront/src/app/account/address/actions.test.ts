// @vitest-environment node
//
// updateAddressAction / deleteAddressAction server action test(g-5c、session-write update+delete)。
// 鏡像 profile/actions.test.ts 信任邊界覆蓋(addAddressAction 無獨立 test 檔、共用同 pattern):
//
// updateAddressAction:
// 1. 未登入 → formError「請重新登入」+ 不呼叫 updateAddress
// 2. 驗證錯(name 空)→ fieldErrors.name + 不呼叫 updateAddress
// 3. 巢狀 invoice 錯(company taxId 非 8 碼)→ fieldErrors.invoice.taxId(#181 雙通道含巢狀)
// 4. malformed input(非 object)→ formError fallback、不無聲失敗
// 5. ownership / 白名單:updateAddress 收 (repo, session user.id, 參數 addressId, patch);patch strip 未知欄、currentUserId 非 input
// 6. updateAddress 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩原始 error
// 7. 成功 → { ok: true }
//
// deleteAddressAction:
// 8. 未登入 → formError「請重新登入」+ 不呼叫 deleteAddress
// 9. ownership 不符(use-case 拋)→ formError「刪除失敗,請稍後再試」+ 不洩原始 error
// 10. 成功 → { ok: true } + deleteAddress 收 (repo, session user.id, 參數 addressId)
//
// 用真 AddressInput schema(不 mock @pcm/schemas)驗 validation / strip / superRefine 真實行為。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockAddAddress = vi.fn();
const mockUpdateAddress = vi.fn();
const mockDeleteAddress = vi.fn();
const mockGetAddressRepo = vi.fn();
const mockGetUser = vi.fn();
const mockCreateServerSupabaseClient = vi.fn();

vi.mock('@pcm/use-cases', () => ({
  addAddress: (...args: unknown[]) => mockAddAddress(...args),
  updateAddress: (...args: unknown[]) => mockUpdateAddress(...args),
  deleteAddress: (...args: unknown[]) => mockDeleteAddress(...args),
}));
vi.mock('@/lib/auth/composition', () => ({
  getAddressRepo: () => mockGetAddressRepo(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => mockCreateServerSupabaseClient(),
}));

// Import 動態,確保 mock 生效後再載入 SUT(server action)。
async function getActions() {
  const m = await import('./actions');
  return { updateAddressAction: m.updateAddressAction, deleteAddressAction: m.deleteAddressAction };
}

// 合法 AddressInput payload(personal、必填齊);invoice 全欄由 schema default 補齊。
function validInput(over: Record<string, unknown> = {}) {
  return {
    name: '王小明',
    phone: '0912345678',
    line: '台北市信義區市府路 1 號',
    invoice: { type: 'personal' },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateServerSupabaseClient.mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  });
  mockGetAddressRepo.mockResolvedValue({ update: vi.fn(), delete: vi.fn(), listByCustomer: vi.fn() });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('updateAddressAction(g-5c server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 updateAddress', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction('addr-1', validInput());
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockUpdateAddress).not.toHaveBeenCalled();
  });

  it('name 空 → fieldErrors.name + 不呼叫 updateAddress', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction('addr-1', validInput({ name: '' }));
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(mockUpdateAddress).not.toHaveBeenCalled();
  });

  it('巢狀 invoice 錯(company taxId 非 8 碼)→ fieldErrors.invoice.taxId(#181 雙通道含巢狀)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction(
      'addr-1',
      validInput({ invoice: { type: 'company', title: '賓士機車', taxId: '123' } }),
    );
    expect(res.fieldErrors?.invoice?.taxId).toBeTruthy();
    expect(mockUpdateAddress).not.toHaveBeenCalled();
  });

  it('malformed input(非 object)→ formError fallback、不無聲失敗', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction('addr-1', 'not-an-object' as unknown);
    if (res.fieldErrors && Object.keys(res.fieldErrors).length > 0) {
      expect(res.fieldErrors.name).toBeTruthy();
    } else {
      expect(res.formError).toBe('請填寫必要欄位');
    }
    expect(mockUpdateAddress).not.toHaveBeenCalled();
  });

  it('ownership / 白名單:updateAddress 收 (repo, session user.id, 參數 addressId, strip 後 patch)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateAddress.mockResolvedValue({ id: 'addr-1' });
    const { updateAddressAction } = await getActions();
    await updateAddressAction(
      'addr-1',
      validInput({
        // 攻擊面:client 偽造 id/customerUserId/時間欄、AddressInput zod 必 strip
        id: 'attacker-id',
        customerUserId: 'attacker-uid',
        createdAt: '2000-01-01',
        updatedAt: '2000-01-01',
      }),
    );
    expect(mockUpdateAddress).toHaveBeenCalledOnce();
    const [, currentUserId, addressId, patch] = mockUpdateAddress.mock.calls[0]!;
    expect(currentUserId).toBe('user-1'); // server session、非 input 偽造的 customerUserId
    expect(addressId).toBe('addr-1'); // 來自 action 參數(parent closure)
    // patch 只有白名單欄;id/customerUserId/時間欄全被 strip
    expect(Object.keys(patch).sort()).toEqual(['invoice', 'isDefault', 'line', 'name', 'phone']);
    expect(patch).not.toHaveProperty('id');
    expect(patch).not.toHaveProperty('customerUserId');
    expect(patch).not.toHaveProperty('createdAt');
  });

  it('updateAddress 拋 DB error → formError「儲存失敗,請稍後再試」+ 不洩原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateAddress.mockRejectedValue(new Error('PostgresError: RLS policy violated'));
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction('addr-1', validInput());
    expect(res.formError).toBe('儲存失敗,請稍後再試');
    expect(res.formError).not.toContain('RLS');
    expect(res.formError).not.toContain('Postgres');
  });

  it('成功 → { ok: true }', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockUpdateAddress.mockResolvedValue({ id: 'addr-1', name: '王小明' });
    const { updateAddressAction } = await getActions();
    const res = await updateAddressAction('addr-1', validInput());
    expect(res).toEqual({ ok: true });
  });
});

describe('deleteAddressAction(g-5c server action)', () => {
  it('未登入 → formError「請重新登入」+ 不呼叫 deleteAddress', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { deleteAddressAction } = await getActions();
    const res = await deleteAddressAction('addr-1');
    expect(res).toEqual({ formError: '請重新登入' });
    expect(mockDeleteAddress).not.toHaveBeenCalled();
  });

  it('ownership 不符(use-case 拋)→ formError「刪除失敗,請稍後再試」+ 不洩原始 error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDeleteAddress.mockRejectedValue(
      new Error('deleteAddress: address addr-x 不屬於目前 customer'),
    );
    const { deleteAddressAction } = await getActions();
    const res = await deleteAddressAction('addr-x');
    expect(res.formError).toBe('刪除失敗,請稍後再試');
    expect(res.formError).not.toContain('不屬於');
  });

  it('成功 → { ok: true } + deleteAddress 收 (repo, session user.id, 參數 addressId)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockDeleteAddress.mockResolvedValue(undefined);
    const { deleteAddressAction } = await getActions();
    const res = await deleteAddressAction('addr-1');
    expect(res).toEqual({ ok: true });
    expect(mockDeleteAddress).toHaveBeenCalledOnce();
    const [, currentUserId, addressId] = mockDeleteAddress.mock.calls[0]!;
    expect(currentUserId).toBe('user-1'); // server session、非 client 傳入
    expect(addressId).toBe('addr-1');
  });
});
