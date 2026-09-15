import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { listRecentIncidents } from './incident-repository';

const ROW = {
  id: 7,
  kind: 'auto_cancel_failed',
  subject_id: '11111111-1111-1111-1111-111111111111',
  detail: '自動標取消失敗 P0001 xxx',
  created_at: '2026-09-15T08:00:00+00:00',
  resolved_at: null,
};

describe('P2-7 listRecentIncidents', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it('🔴 呼叫的是 DB 那一支窄門,函式名與參數名逐字(`as never` 把打錯字從 typecheck 移到這裡)', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await listRecentIncidents(50, true);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_list_pcm_incidents', { p_limit: 50, p_open_only: true });
  });

  it('列轉成畫面用的形狀(bigint id 轉字串、NULL 原樣)', async () => {
    mocks.rpc.mockResolvedValue({ data: [ROW, { ...ROW, id: '8', kind: 'line_forward_failed', subject_id: null }], error: null });
    const rows = await listRecentIncidents(50, false);
    expect(rows).toEqual([
      {
        id: '7',
        kind: 'auto_cancel_failed',
        subjectId: ROW.subject_id,
        detail: ROW.detail,
        createdAt: ROW.created_at,
        resolvedAt: null,
      },
      {
        id: '8',
        kind: 'line_forward_failed',
        subjectId: null,
        detail: ROW.detail,
        createdAt: ROW.created_at,
        resolvedAt: null,
      },
    ]);
  });

  it('🔴 RPC 回錯 ⇒ throw,不回 [](回 [] 會被頁面印成「沒有事故」)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(listRecentIncidents(50, true)).rejects.toEqual({ code: '42501', message: 'permission denied' });
  });

  it('🔴 回傳不是陣列 ⇒ throw', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(listRecentIncidents(50, true)).rejects.toThrow('不是陣列');
  });

  it('🔴 列形狀不對(缺 detail / id 不是整數)⇒ throw,不靜靜略過那一列', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, detail: undefined }], error: null });
    await expect(listRecentIncidents(50, true)).rejects.toThrow('形狀不對');
    mocks.rpc.mockResolvedValue({ data: [{ ...ROW, id: 1.5 }], error: null });
    await expect(listRecentIncidents(50, true)).rejects.toThrow('形狀不對');
  });
});
