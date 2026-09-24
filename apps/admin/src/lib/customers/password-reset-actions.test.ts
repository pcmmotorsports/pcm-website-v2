import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const authorize = vi.fn();
const target = vi.fn();
const claim = vi.fn();
const send = vi.fn();
const reread = vi.fn();
const audit = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: () => authorize() }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('../orders/order-repository', () => ({ getAdminAuditLogRepository: () => ({ record: audit }) }));
vi.mock('./password-reset-repository', async (importOriginal) => ({
  withTimeout: (await importOriginal<typeof import('./password-reset-repository')>()).withTimeout,
  AUDIT_TIMEOUT_MS: 5_000,
  readPasswordResetTarget: (id: string) => target(id),
  claimPasswordReset: (a: unknown) => claim(a),
  sendPasswordResetEmail: (e: string) => send(e),
  readAuthEmail: (id: string) => reread(id),
}));

import { sendPasswordResetAction } from './password-reset-actions';

const ID = '44444444-4444-4444-8444-444444444444';
async function run(fields: Record<string, string>): Promise<string> {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  try {
    await sendPasswordResetAction(f);
  } catch (e) {
    return String((e as Error).message).replace('REDIRECT:', '');
  }
  throw new Error('沒有 redirect');
}
const code = (c: string) => `/customers/${ID}?r=customer_pwreset_${c}`;

beforeEach(() => {
  for (const m of [authorize, target, claim, send, audit, reread]) m.mockReset();
  reread.mockResolvedValue('owner@shop.tw');
  authorize.mockResolvedValue({ actorId: 'ming', sid: 's1' });
  target.mockResolvedValue({ kind: 'ok', email: 'owner@shop.tw' });
  claim.mockResolvedValue('OK');
  send.mockResolvedValue('accepted');
  audit.mockResolvedValue(undefined);
});

describe('替客人寄重設密碼信(片 D4b)', () => {
  it('🔴 未登入 / 顧客 / Origin 不對(authorizeAdminMutation 回 null)⇒ denied, 不查不寄', async () => {
    authorize.mockResolvedValue(null);
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('denied'));
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('客人編號不是 uuid ⇒ 回客戶列表 invalid', async () => {
    expect(await run({ customer_id: 'x' })).toBe('/customers?r=customer_pwreset_invalid');
  });

  it('🔴 收件人由 customer ID 查出, 不收表單傳來的 Email', async () => {
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw', email: 'attacker@evil.tw' })).toBe(code('sent'));
    expect(target).toHaveBeenCalledWith(ID);
    expect(send).toHaveBeenCalledWith('owner@shop.tw');
  });

  it('成功:先搶那一格(actor 取登入身分)再寄;稽核記 accepted', async () => {
    await run({ customer_id: ID, shown_email: 'owner@shop.tw' });
    expect(claim).toHaveBeenCalledWith({ customerId: ID, actor: 'ming', requestId: 'req-1' });
    expect(claim.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'customer.password_reset.sent', target: `customer:${ID}`, after: { outcome: 'accepted' } }),
      expect.objectContaining({ actor: 'ming' }),
    );
  });

  it('🔴 60 秒內 / 兩人同時按(資料庫回 TOO_SOON)⇒ 不寄', async () => {
    claim.mockResolvedValue('TOO_SOON');
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('too_soon'));
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['not_eligible', 'not_eligible'],
    ['not_found', 'not_found'],
    ['mismatch', 'mismatch'],
    ['failed', 'error'],
  ])('帳號查詢 %s ⇒ %s, 不搶不寄', async (k, c) => {
    target.mockResolvedValue({ kind: k });
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code(c));
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('搶格子時出錯 ⇒ error, 不寄', async () => {
    claim.mockRejectedValue(new Error('db'));
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('error'));
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['failed', 'failed'],
    ['unknown', 'unknown'],
  ])('🔴 寄信結果 %s ⇒ %s, 稽核照記(結果不明不能寫成失敗)', async (outcome, c) => {
    send.mockResolvedValue(outcome);
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code(c));
    expect(audit.mock.calls[0]![0].after).toEqual({ outcome });
  });

  it('🔴 稽核寫入失敗 ⇒ 仍說已寄出, 但明講操作紀錄沒寫入(不叫他重按)', async () => {
    audit.mockRejectedValue(new Error('down'));
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('sent_audit_failed'));
    send.mockResolvedValue('unknown');
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('unknown_audit_failed'));
  });

  it('🔴 寄送期間登入 Email 被改掉 ⇒ 結果不明(不能確定寄到的是這位客人), 稽核照實記', async () => {
    reread.mockResolvedValue('someone-else@shop.tw');
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('unknown'));
    expect(audit.mock.calls[0]![0].after).toEqual({ outcome: 'unknown' });
  });

  it('🔴 寄完讀不到 / 逾時(null)⇒ 結果不明(只有重讀到同一個 Email 才算已寄出)', async () => {
    reread.mockResolvedValue(null);
    expect(await run({ customer_id: ID, shown_email: 'owner@shop.tw' })).toBe(code('unknown'));
  });

  it('🔴 確認視窗上的 Email 跟現在的不一樣(開頁後被改過)⇒ stale, 不搶不寄', async () => {
    expect(await run({ customer_id: ID, shown_email: 'old@shop.tw' })).toBe(code('stale'));
    expect(claim).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('🔴 寫結果稽核一直不回應 ⇒ 時限到仍回應員工(已寄出、操作紀錄沒有確認寫入), 不重寄', async () => {
    vi.useFakeTimers();
    audit.mockReturnValue(new Promise(() => {}));
    const p = run({ customer_id: ID, shown_email: 'owner@shop.tw' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await p).toBe(code('sent_audit_failed'));
    expect(send).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
