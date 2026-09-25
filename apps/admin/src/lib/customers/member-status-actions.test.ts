import { beforeEach, describe, expect, it, vi } from 'vitest';

// 後台停用 / 恢復 / 刪除會員的伺服器動作(20260926100000;Fable 第 4 片 R1 應修 6)。
vi.mock('server-only', () => ({}));
const m = vi.hoisted(() => ({
  authorize: vi.fn(),
  requestId: vi.fn(async () => 'req_test'),
  revalidatePath: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: m.authorize }));
vi.mock('../audit/context', () => ({ getRequestId: m.requestId }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidatePath }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: () => ({ rpc: m.rpc }) }));
import { deleteCustomerAction, disableCustomerAction } from './member-status-actions';

const ID = 'c0000000-0000-4000-8000-000000000001';
beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue({ sid: 's1', actorId: 'sean' });
});

describe('會員停用 / 刪除的伺服器動作', () => {
  it('🔴 不是老闆(或沒登入)⇒ denied, 不呼叫資料庫', async () => {
    m.authorize.mockResolvedValue(null);
    const r = await disableCustomerAction({ customerId: ID, reason: '客人要求', expectedVersion: 0 });
    expect(r).toMatchObject({ ok: false, code: 'denied' });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('🔴 原因空白或版本號缺 ⇒ invalid, 不呼叫資料庫', async () => {
    expect((await disableCustomerAction({ customerId: ID, reason: '  ', expectedVersion: 0 })).code).toBe('invalid');
    expect((await disableCustomerAction({ customerId: ID, reason: '客人要求' })).code).toBe('invalid');
    expect((await disableCustomerAction({ customerId: 'x', reason: '客人要求', expectedVersion: 0 })).code).toBe('invalid');
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it('送給資料庫的是老闆身分、request id、畫面上的版本號與去空白的原因', async () => {
    m.rpc.mockResolvedValue({ data: 'OK', error: null });
    const r = await disableCustomerAction({ customerId: ID, reason: ' 客人要求 ', expectedVersion: 3 });
    expect(r).toMatchObject({ ok: true, code: 'OK' });
    expect(m.rpc).toHaveBeenCalledWith('admin_disable_customer', {
      p_actor: 'sean', p_customer_user_id: ID, p_expected_version: 3, p_reason: '客人要求', p_request_id: 'req_test',
    });
  });

  it('🔴 沒收到回應 ⇒ unknown, 仍重取畫面(資料庫可能已經改了)', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: '', message: 'TypeError: fetch failed' } });
    const r = await disableCustomerAction({ customerId: ID, reason: '客人要求', expectedVersion: 0 });
    expect(r).toMatchObject({ ok: false, code: 'unknown' });
    expect(m.revalidatePath).toHaveBeenCalledWith('/customers');
    expect(m.revalidatePath).toHaveBeenCalledWith(`/customers/${ID}`);
  });

  it('刪除:DELETED ⇒ ok;外鍵擋下 ⇒ HAS_RECORDS;呼叫本身丟例外 ⇒ unknown', async () => {
    m.rpc.mockResolvedValueOnce({ data: 'DELETED', error: null });
    expect(await deleteCustomerAction({ customerId: ID, reason: '重複註冊' })).toMatchObject({ ok: true, code: 'DELETED' });
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: '23503', message: 'fk' } });
    expect((await deleteCustomerAction({ customerId: ID, reason: '重複註冊' })).code).toBe('HAS_RECORDS');
    m.rpc.mockRejectedValueOnce(new Error('socket hang up'));
    expect((await deleteCustomerAction({ customerId: ID, reason: '重複註冊' })).code).toBe('unknown');
    expect(m.rpc.mock.calls[0]?.[0]).toBe('admin_delete_customer');
  });
});
