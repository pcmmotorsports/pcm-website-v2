import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ rpc: mocks.rpc }),
}));

import { voidManualRefund } from './manual-refund-void-repository';
import type { VoidManualRefundOutcome } from './manual-refund-void-repository';

/**
 * 🔴 **先斷言「它真的失敗了」,再看內容**(codex R1 must-fix ⑤,2026-08-22)。
 *   原本寫 `if (!r.ok) expect(r.code)...` —— repository 若錯回成功,那個 `if` 不成立、
 *   **核心斷言整段被跳過而測試印綠**。與 must-fix ④ 同一個形狀,只是換了一個載體。
 */
function asFailure(r: VoidManualRefundOutcome): Extract<VoidManualRefundOutcome, { ok: false }> {
  expect(r.ok, '預期失敗,實得成功 ⇒ 下面的斷言一格都沒跑到').toBe(false);
  if (r.ok) throw new Error('unreachable(上面那格已經紅了)');
  return r;
}

// manual-refund-void-repository.test.ts — M-4b E10 片 D3-c:SQLSTATE 分類與回傳形狀。
//
// 🔴 本檔**沒有連任何資料庫**。它證的是「拿到某個 SQLSTATE / 某個 payload 時,這一層說什麼」。
//    ⇒ 全綠不代表 RPC 叫得動;那要 GRANT 被 apply(見 manual-refund-entry-gate.ts 條件③)。

const OK_ID = '11111111-2222-3333-4444-555555555555';
const ARGS = { refundId: OK_ID, reason: '金額打錯', actor: 'alice' };

beforeEach(() => {
  mocks.rpc.mockReset();
});

describe('voidManualRefund — 成功路徑', () => {
  it('合法 payload → ok,帶回 refundId 與 idempotent', async () => {
    mocks.rpc.mockResolvedValue({
      data: { voided: true, idempotent: false, refund_id: OK_ID },
      error: null,
    });
    const r = await voidManualRefund(ARGS);
    expect(r).toEqual({ ok: true, refundId: OK_ID, idempotent: false });
  });

  it('🔴 送出去的參數名要與 RPC 簽章逐字相符(打錯就是 PGRST202,而形狀測試看不出來)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { voided: true, idempotent: true, refund_id: OK_ID },
      error: null,
    });
    await voidManualRefund(ARGS);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_void_manual_refund', {
      p_refund_id: OK_ID,
      p_void_reason: '金額打錯',
      p_actor: 'alice',
    });
  });

  // 🔴 D3-b 刻意沒有 p_request_id ⇒ 多送一個參數會被 PostgREST 當成另一支不存在的函式。
  it('🔴 不得送 request_id(D3-b 的設計,不是漏傳)', async () => {
    mocks.rpc.mockResolvedValue({
      data: { voided: true, idempotent: false, refund_id: OK_ID },
      error: null,
    });
    await voidManualRefund(ARGS);
    const [, payload] = mocks.rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(Object.keys(payload).sort()).toEqual(['p_actor', 'p_refund_id', 'p_void_reason']);
  });
});

describe('voidManualRefund — refundId 形狀閘(Fable R2 nit F6)', () => {
  it.each([['不是 uuid', 'mr-1'], ['空字串', ''], ['像 uuid 但少一段', '1111-2222-3333']])(
    '%s → bug,而且【一次都沒有】送出 RPC',
    async (_label, bad) => {
      const r = asFailure(await voidManualRefund({ ...ARGS, refundId: bad }));
      expect(r.code).toBe('bug');
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  // 🔴 反向對照:少了這格,上面三格在「永遠不送 RPC」的壞實作下照樣綠。
  it('🔴 合法 uuid → RPC 真的被送出(證明上面的 0 次是條件造成的)', async () => {
    mocks.rpc.mockResolvedValue({ data: { voided: true, idempotent: false, refund_id: OK_ID }, error: null });
    await voidManualRefund(ARGS);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('voidManualRefund — SQLSTATE 分類', () => {
  it.each([
    ['P0001', 'rejected'],
    ['40001', 'conflict'],
    ['40P01', 'conflict'],
    ['42501', 'bug'],
    ['PGRST202', 'bug'],
    ['23514', 'bug'],
  ])('%s → %s', async (sqlstate, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: sqlstate, message: 'x' } });
    expect(asFailure(await voidManualRefund(ARGS)).code).toBe(code);
  });

  // 🔴 反向對照:沒登記的 SQLSTATE 要落 error,不能靜靜落成別的東西。
  it('🔴 沒登記的 SQLSTATE → error(而不是碰巧撞到某一格)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '99999', message: 'x' } });
    expect(asFailure(await voidManualRefund(ARGS)).code).toBe('error');
  });

  it('🔴 只有 rejected 把 RPC 原文帶給員工(其餘一律 null)', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: '已於 X 作廢' } });
    expect(asFailure(await voidManualRefund(ARGS)).staffMessage).toBe('已於 X 作廢');
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: '不該外流' } });
    expect(asFailure(await voidManualRefund(ARGS)).staffMessage).toBeNull();
  });

  it('丟出來的錯(傳輸層)→ error、永不 throw', async () => {
    mocks.rpc.mockRejectedValue(new Error('socket hang up'));
    expect(asFailure(await voidManualRefund(ARGS)).code).toBe('error');
  });
});

describe('voidManualRefund — 回傳形狀漂移', () => {
  // 🔴 每一格都是「RPC 換了合約而 app 沒跟上」的一種形狀。落成 bug 而不是靜靜當成功。
  it.each([
    ['少一個鍵', { voided: true, refund_id: OK_ID }],
    ['多一個鍵', { voided: true, idempotent: false, refund_id: OK_ID, extra: 1 }],
    ['voided 不是 true', { voided: false, idempotent: false, refund_id: OK_ID }],
    ['refund_id 不是 uuid', { voided: true, idempotent: false, refund_id: 'not-a-uuid' }],
    ['idempotent 不是 boolean', { voided: true, idempotent: 'yes', refund_id: OK_ID }],
    ['是陣列', [{ voided: true }]],
    ['是 null', null],
  ])('%s → bug', async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    const r = asFailure(await voidManualRefund(ARGS));
    expect(r.code).toBe('bug');
    expect(r.logMessage).toContain('形狀漂移');
  });
});
