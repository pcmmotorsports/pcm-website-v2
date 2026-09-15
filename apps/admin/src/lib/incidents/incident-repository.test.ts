import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { listRecentIncidents, reopenIncident, resolveIncident } from './incident-repository';

const ROW = {
  id: 7,
  kind: 'auto_cancel_failed',
  subject_id: '11111111-1111-1111-1111-111111111111',
  detail: '自動標取消失敗 P0001 xxx',
  created_at: '2026-09-15T08:00:00+00:00',
  resolved_at: null,
  resolved_by: null,
  resolution_note: null,
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

  it('列轉成畫面用的形狀(bigint id 轉字串、NULL 原樣、處理人與說明帶出來)', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        ROW,
        {
          ...ROW,
          id: '8',
          kind: 'line_forward_failed',
          subject_id: null,
          resolved_at: '2026-09-15T09:00:00+00:00',
          resolved_by: 'amy',
          resolution_note: '重送了',
        },
      ],
      error: null,
    });
    const rows = await listRecentIncidents(50, false);
    expect(rows).toEqual([
      {
        id: '7',
        kind: 'auto_cancel_failed',
        subjectId: ROW.subject_id,
        detail: ROW.detail,
        createdAt: ROW.created_at,
        resolvedAt: null,
        resolvedBy: null,
        resolutionNote: null,
      },
      {
        id: '8',
        kind: 'line_forward_failed',
        subjectId: null,
        detail: ROW.detail,
        createdAt: ROW.created_at,
        resolvedAt: '2026-09-15T09:00:00+00:00',
        resolvedBy: 'amy',
        resolutionNote: '重送了',
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

  it('🔴 舊一代函式(20260916040000,沒有 resolved_by / resolution_note)⇒ throw —— 板沒貼而程式先合的世界要叫', async () => {
    const { resolved_by: _by, resolution_note: _note, ...oldRow } = ROW;
    mocks.rpc.mockResolvedValue({ data: [oldRow], error: null });
    await expect(listRecentIncidents(50, true)).rejects.toThrow('形狀不對');
  });
});

describe('resolveIncident / reopenIncident', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  it('🔴 標記已處理:函式名與參數名逐字', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'resolved' }, error: null });
    await expect(resolveIncident({ id: 7, actor: 'amy', requestId: 'req-1', note: null })).resolves.toBe('resolved');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_resolve_pcm_incident', {
      p_id: 7,
      p_actor: 'amy',
      p_request_id: 'req-1',
      p_note: null,
    });
  });

  it('🔴 取消已處理:函式名與參數名逐字', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'superseded' }, error: null });
    await expect(reopenIncident({ id: 7, actor: 'amy', requestId: 'req-1', reason: '按錯了' })).resolves.toBe('superseded');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_reopen_pcm_incident', {
      p_id: 7,
      p_actor: 'amy',
      p_request_id: 'req-1',
      p_reason: '按錯了',
    });
  });

  it.each(['already', 'not_found'])('標記已處理回 %s 原樣傳回', async (result) => {
    mocks.rpc.mockResolvedValue({ data: { result }, error: null });
    await expect(resolveIncident({ id: 1, actor: 'amy', requestId: 'r', note: null })).resolves.toBe(result);
  });

  it.each(['reopened', 'already_open', 'not_found'])('取消已處理回 %s 原樣傳回', async (result) => {
    mocks.rpc.mockResolvedValue({ data: { result }, error: null });
    await expect(reopenIncident({ id: 1, actor: 'amy', requestId: 'r', reason: 'x' })).resolves.toBe(result);
  });

  it('🔴 不認得的結果 / 沒有 result ⇒ throw(不當成功)', async () => {
    mocks.rpc.mockResolvedValue({ data: { result: 'reopened' }, error: null });
    await expect(resolveIncident({ id: 1, actor: 'amy', requestId: 'r', note: null })).rejects.toThrow('不認得');
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(reopenIncident({ id: 1, actor: 'amy', requestId: 'r', reason: 'x' })).rejects.toThrow('不認得');
  });

  it('🔴 DB 錯(含「無權執行此操作」)原樣 throw,由 action 分流', async () => {
    const err = { code: 'P0001', message: '無權執行此操作' };
    mocks.rpc.mockResolvedValue({ data: null, error: err });
    await expect(resolveIncident({ id: 1, actor: 'amy', requestId: 'r', note: null })).rejects.toEqual(err);
    await expect(reopenIncident({ id: 1, actor: 'amy', requestId: 'r', reason: 'x' })).rejects.toEqual(err);
  });
});
