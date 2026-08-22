import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  getRequestId: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  voidManualRefund: vi.fn(),
}));

vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorizeAdminMutation }));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('./manual-refund-void-repository', () => ({ voidManualRefund: mocks.voidManualRefund }));

import { voidManualRefundAction } from './manual-refund-void-actions';
import type { ManualRefundVoidActionState } from './manual-refund-void-action-state';

// manual-refund-void-actions.test.ts — M-4b E10 片 D3-c(codex R1 must-fix ①,2026-08-22)。
//
// 🔴 **為什麼補這支**:這支 server action 原本【零直接測試】——
//    唯一碰到它的 jsdom 測試把整支 mock 掉了(`manual-refund-ledger-section.test.tsx`),
//    ⇒ 授權順序、actor 來源、RPC 有沒有被呼叫、redirect/revalidate 全都可以壞而測試仍綠。
//
// ⚠️ **它證不到的**(誠實邊界):repository 是替身 ⇒ 不證明 RPC 叫得動
//    (那要 GRANT 被 apply,見 `manual-refund-entry-gate.ts` 解除條件③);
//    `redirect` 也是替身 ⇒ 不證明真站的 PRG 行為。

const AUTH = { sid: 'sid-1', actorId: 'alice' };
const OK_ID = '11111111-2222-3333-4444-555555555555';
const IDLE: ManualRefundVoidActionState = { status: 'idle' };

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  f.set('refund_id', OK_ID);
  f.set('void_reason', '金額打錯');
  f.set('order_id', 'ord-1');
  f.set('return_to', '/orders/ord-1');
  for (const [k, v] of Object.entries(over)) f.set(k, v);
  return f;
}

/** 先斷言真的失敗了再看內容(同族 must-fix ④/⑤:斷言包在 if 裡 ⇒ 條件不成立就靜靜跳過)。 */
function asFailed(s: ManualRefundVoidActionState) {
  expect(s.status, '預期 failed,實得 idle ⇒ 下面一格都沒跑到').toBe('failed');
  if (s.status !== 'failed') throw new Error('unreachable');
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorizeAdminMutation.mockResolvedValue(AUTH);
  mocks.getRequestId.mockResolvedValue('req-1');
  mocks.voidManualRefund.mockResolvedValue({ ok: true, refundId: OK_ID, idempotent: false });
  mocks.redirect.mockImplementation(() => {
    throw new Error('NEXT_REDIRECT');
  });
});

describe('voidManualRefundAction — 授權閘', () => {
  it('🔴 未授權 → denied,而且【一次都沒有】碰 RPC', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    const s = asFailed(await voidManualRefundAction(IDLE, form()));
    expect(s.code).toBe('denied');
    expect(mocks.voidManualRefund).not.toHaveBeenCalled();
  });

  // 🔴 反向對照:少了這格,上面那格在「永遠不呼叫 RPC」的壞實作下也綠。
  it('🔴 已授權 + 表單合法 → RPC 真的被呼叫(證明上一格的 0 次是條件造成的)', async () => {
    await expect(voidManualRefundAction(IDLE, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.voidManualRefund).toHaveBeenCalledTimes(1);
  });

  it('🔴 授權失敗帶回的 refundId 是空字串(而 UI 必須把它當「這一列」顯示)', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(asFailed(await voidManualRefundAction(IDLE, form())).refundId).toBe('');
  });
});

describe('voidManualRefundAction — actor 來源', () => {
  // 🔴 這一格是本檔最重要的一格:actor 決定 voided_by 寫誰,而它**絕不能來自表單**。
  it('🔴 actor 取自 session,表單塞 actor 也蓋不掉', async () => {
    await expect(
      voidManualRefundAction(IDLE, form({ actor: 'mallory', p_actor: 'mallory' })),
    ).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.voidManualRefund).toHaveBeenCalledWith({
      refundId: OK_ID,
      reason: '金額打錯',
      actor: 'alice',
    });
  });
});

describe('voidManualRefundAction — 表單形狀', () => {
  it.each([
    ['理由空白', { void_reason: '   ' }],
    ['理由是全形空格', { void_reason: '　　' }],
    ['缺 refund_id', { refund_id: '' }],
  ])('%s → invalid,且不碰 RPC', async (_label, over) => {
    const s = asFailed(await voidManualRefundAction(IDLE, form(over)));
    expect(s.code).toBe('invalid');
    expect(mocks.voidManualRefund).not.toHaveBeenCalled();
  });

  it('invalid 時把員工打的理由帶回去(不要叫他重打)', async () => {
    const s = asFailed(await voidManualRefundAction(IDLE, form({ refund_id: '' })));
    expect(s.reason).toBe('金額打錯');
  });
});

describe('voidManualRefundAction — RPC 失敗的處置', () => {
  it('rejected → 把 RPC 原文顯示給員工,而且【不 redirect】', async () => {
    mocks.voidManualRefund.mockResolvedValue({
      ok: false,
      code: 'rejected',
      sqlstate: 'P0001',
      logMessage: 'x',
      staffMessage: '這筆退款已於 X 由「bob」作廢',
    });
    const s = asFailed(await voidManualRefundAction(IDLE, form()));
    expect(s.message).toBe('這筆退款已於 X 由「bob」作廢');
    expect(s.refundId).toBe(OK_ID);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('🔴 失敗也要 revalidate(否則畫面停在舊狀態,員工會再按一次)', async () => {
    mocks.voidManualRefund.mockResolvedValue({
      ok: false, code: 'bug', sqlstate: null, logMessage: 'x', staffMessage: null,
    });
    await voidManualRefundAction(IDLE, form());
    expect(mocks.revalidatePath).toHaveBeenCalled();
  });
});

describe('voidManualRefundAction — 成功', () => {
  it('成功 → redirect 帶結果碼', async () => {
    await expect(voidManualRefundAction(IDLE, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(String(mocks.redirect.mock.calls[0]?.[0])).toContain('manual_refund_voided');
  });

  // 🔴 idempotent: true 也是成功 —— 顯示成錯誤會誘導員工換一句理由重送,
  //    而換了理由就會撞上 D3-b「不覆蓋既有作廢紀錄」那句 RAISE。
  it('🔴 idempotent 也走成功路徑(不是錯誤)', async () => {
    mocks.voidManualRefund.mockResolvedValue({ ok: true, refundId: OK_ID, idempotent: true });
    await expect(voidManualRefundAction(IDLE, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
  });
});
