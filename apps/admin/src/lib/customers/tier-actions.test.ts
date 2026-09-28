import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  setCustomerTier: vi.fn(),
  isCustomerDisabled: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./customer-repository', () => ({ setCustomerTier: mocks.setCustomerTier }));
vi.mock('./member-status', () => ({ isCustomerDisabled: mocks.isCustomerDisabled }));

// 解析器不 mock:餵真 FormData 走真解析器。
import { setTierAction } from './tier-actions';
import {
  TIER_CUSTOMER_ID_FIELD,
  TIER_FROM_FIELD,
  TIER_NOTE_FIELD,
  TIER_RETURN_TO_FIELD,
  TIER_VALUE_FIELD,
} from './tier-form';

// Sean 2026-09-29 Q2 甲:帳號停用後不能變更會員等級, 要先恢復。畫面鎖按鈕之外, server 也要擋。

const CUS = '11111111-2222-3333-4444-555555555555';

function form(): FormData {
  const f = new FormData();
  f.set(TIER_CUSTOMER_ID_FIELD, CUS);
  f.set(TIER_VALUE_FIELD, 'store');
  f.set(TIER_FROM_FIELD, 'general');
  f.set(TIER_NOTE_FIELD, '經銷申請審核通過');
  f.set(TIER_RETURN_TO_FIELD, `/customers/${CUS}`);
  return f;
}

async function redirectedTo(): Promise<string> {
  await expect(setTierAction(form())).rejects.toThrow('REDIRECTED');
  return String(mocks.redirect.mock.calls[0]?.[0]);
}

describe('setTierAction — 停用帳號', () => {
  beforeEach(() => {
    mocks.authorizeAdminMutation.mockResolvedValue({ sid: 's1', actorId: 'staff_1' });
    mocks.getRequestId.mockResolvedValue('req-1');
    mocks.setCustomerTier.mockResolvedValue('UPDATED');
    mocks.isCustomerDisabled.mockResolvedValue(false);
    mocks.redirect.mockImplementation(() => {
      throw new Error('REDIRECTED');
    });
  });
  afterEach(() => vi.clearAllMocks());

  it('🔴 帳號已停用 ⇒ r=customer_member_disabled, 而且【沒有打到 RPC】', async () => {
    mocks.isCustomerDisabled.mockResolvedValue(true);
    expect(await redirectedTo()).toBe(`/customers/${CUS}?r=customer_member_disabled`);
    expect(mocks.isCustomerDisabled).toHaveBeenCalledWith(CUS);
    expect(mocks.setCustomerTier).not.toHaveBeenCalled();
  });

  it('🔴 讀不到帳號狀態 ⇒ r=customer_member_check_failed, 不送出', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.isCustomerDisabled.mockRejectedValue(new Error('timeout'));
    expect(await redirectedTo()).toBe(`/customers/${CUS}?r=customer_member_check_failed`);
    expect(mocks.setCustomerTier).not.toHaveBeenCalled();
  });

  it('🔵 正對照:帳號正常 ⇒ 照舊送出, r=saved', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(await redirectedTo()).toBe(`/customers/${CUS}?r=saved`);
    expect(mocks.setCustomerTier).toHaveBeenCalledTimes(1);
  });
});
