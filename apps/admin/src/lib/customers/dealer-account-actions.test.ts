import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const authorize = vi.fn();
const invite = vi.fn();
const setup = vi.fn();
const lookup = vi.fn();
const audit = vi.fn();
const revalidatePath = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeManagerMutation: () => authorize() }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('../orders/order-repository', () => ({ getAdminAuditLogRepository: () => ({ record: audit }) }));
vi.mock('./dealer-application-repository', () => ({
  inviteDealerUser: (...a: unknown[]) => invite(...a),
  createStaffDealer: (a: unknown) => setup(a),
  findCustomerIdByEmail: (e: string) => lookup(e),
}));

import { createDealerAccountAction } from './dealer-account-actions';

const UID = '22222222-2222-4222-8222-222222222222';
const base = {
  email: ' owner@shop.tw ',
  companyName: '阿明車業', taxId: '12345678', storeName: '', region: '臺北市',
  contactName: '王小明', contactPhone: '0912345678', contactEmail: 'owner@shop.tw', note: '',
};
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const run = (f: Record<string, string>) => createDealerAccountAction({ kind: 'idle' }, form(f));

beforeEach(() => {
  for (const m of [authorize, invite, setup, audit, revalidatePath, lookup]) m.mockReset();
  lookup.mockResolvedValue({ kind: 'found', userId: UID });
  authorize.mockResolvedValue({ actorId: 'boss', sid: 's1' });
  invite.mockResolvedValue({ kind: 'ok', userId: UID });
  setup.mockResolvedValue('CREATED');
  audit.mockResolvedValue(undefined);
});

describe('後台新增經銷帳號(片 D4a)', () => {
  it('🔴 不是管理者(未登入 / 顧客 / Origin 不對都會讓 authorizeManagerMutation 回 null)⇒ 拒絕, 不寄信不建帳號', async () => {
    authorize.mockResolvedValue(null);
    expect((await run(base)).kind).toBe('denied');
    expect(invite).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it('🔴 表單帶了密碼欄 ⇒ 拒絕(員工不能替客人設密碼)', async () => {
    expect((await run({ ...base, password: 'secret123' })).kind).toBe('invalid');
    expect(invite).not.toHaveBeenCalled();
  });

  it('公司資料格式錯 ⇒ 逐格錯誤, 資料留在畫面上, 不寄信', async () => {
    const r = await run({ ...base, taxId: '1234' });
    expect(r.kind).toBe('invalid');
    expect(r.kind === 'invalid' && r.fieldErrors.taxId).toBeTruthy();
    expect(r.kind === 'invalid' && r.form.values.companyName).toBe('阿明車業');
    expect(invite).not.toHaveBeenCalled();
  });

  it('成功:寄邀請 ⇒ 用回傳的 user ID 設定經銷, actor 取登入身分;稽核記成功', async () => {
    const r = await run(base);
    expect(r).toMatchObject({ kind: 'done', userId: UID, email: 'owner@shop.tw' });
    expect(invite).toHaveBeenCalledWith('owner@shop.tw', '王小明');
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ userId: UID, actor: 'boss', requestId: 'req-1', companyName: '阿明車業' }));
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dealer.account.invite', after: expect.objectContaining({ outcome: 'accepted' }) }),
      expect.objectContaining({ actor: 'boss' }),
    );
  });

  it('🔴 Email 已經有帳號 ⇒ 不建第二個帳號、不設定經銷;稽核記 exists', async () => {
    invite.mockResolvedValue({ kind: 'exists' });
    expect((await run(base)).kind).toBe('email_exists');
    expect(setup).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]![0].after.outcome).toBe('exists');
  });

  it.each([
    ['failed', 'invite_failed'],
    ['unknown', 'invite_unknown'],
  ])('邀請 %s ⇒ %s, 不設定經銷', async (k, kind) => {
    invite.mockResolvedValue({ kind: k });
    expect((await run(base)).kind).toBe(kind);
    expect(setup).not.toHaveBeenCalled();
    expect(audit.mock.calls[0]![0].after.outcome).toBe(k);
  });

  it('🔴 第 3 步結果不明 ⇒ 不說失敗;按「用這個帳號完成經銷設定」⇒ 不重寄邀請, server 用 Email 查帳號、綁同一個帳號', async () => {
    setup.mockRejectedValueOnce(new Error('boom'));
    expect((await run(base)).kind).toBe('setup_unknown');
    invite.mockClear();
    setup.mockResolvedValue('ALREADY_DONE');
    const again = await run({ ...base, resume: '1' });
    expect(invite).not.toHaveBeenCalled();
    expect(lookup).toHaveBeenCalledWith('owner@shop.tw');
    expect(setup).toHaveBeenLastCalledWith(expect.objectContaining({ userId: UID }));
    expect(again).toMatchObject({ kind: 'done', userId: UID, invited: false, already: true });
  });

  it('🔴 Email 已有帳號 ⇒ 可以用那個帳號完成設定(記下公司資料並改成車行), 不寄信、不建第二個帳號', async () => {
    const r = await run({ ...base, resume: '1' });
    expect(r).toMatchObject({ kind: 'done', invited: false, already: false });
    expect(invite).not.toHaveBeenCalled();
  });

  it('resume 查不到帳號 ⇒ no_account;查詢失敗 ⇒ lookup_failed;兩種都不設定', async () => {
    lookup.mockResolvedValueOnce({ kind: 'none' });
    expect((await run({ ...base, resume: '1' })).kind).toBe('no_account');
    lookup.mockResolvedValueOnce({ kind: 'failed' });
    expect((await run({ ...base, resume: '1' })).kind).toBe('lookup_failed');
    lookup.mockResolvedValueOnce({ kind: 'ambiguous' });
    expect((await run({ ...base, resume: '1' })).kind).toBe('ambiguous');
    lookup.mockResolvedValueOnce({ kind: 'mismatch' });
    expect((await run({ ...base, resume: '1' })).kind).toBe('mismatch');
    // 20260926100000 Q26 甲:已停用的會員 ⇒ 不設定成經銷
    lookup.mockResolvedValueOnce({ kind: 'disabled' });
    expect((await run({ ...base, resume: '1' })).kind).toBe('disabled');
    expect(setup).not.toHaveBeenCalled();
    expect(invite).not.toHaveBeenCalled();
  });

  it('🔴 補做途中查詢失敗或欄位要修 ⇒ 回傳的畫面仍是補做模式(下一次不會改走寄邀請)', async () => {
    lookup.mockResolvedValueOnce({ kind: 'failed' });
    const r1 = await run({ ...base, resume: '1' });
    expect('form' in r1 && r1.form.resume).toBe(true);
    const r2 = await run({ ...base, resume: '1', taxId: '12' });
    expect(r2.kind).toBe('invalid');
    expect('form' in r2 && r2.form.resume).toBe(true);
  });

  it('🔴 表單帶 setupUserId 也不會被拿來指定帳號(已經不收這一欄)', async () => {
    await run({ ...base, resume: '1', setupUserId: '33333333-3333-4333-8333-333333333333' });
    expect(setup).toHaveBeenCalledWith(expect.objectContaining({ userId: UID }));
  });

  it.each([
    ['NOT_FOUND', 'setup_unknown'],
    ['WOULD_DOWNGRADE', 'would_downgrade'],
    ['SOMETHING', 'setup_unknown'],
  ])('第 3 步回 %s ⇒ %s', async (db, kind) => {
    setup.mockResolvedValue(db);
    expect((await run(base)).kind).toBe(kind);
  });

  it('稽核寫入失敗不影響結果(帳號已建立)', async () => {
    audit.mockRejectedValue(new Error('audit down'));
    expect((await run(base)).kind).toBe('done');
  });
});
