import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const authorize = vi.fn();
const decide = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
const revalidatePath = vi.fn();
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: () => authorize() }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }));
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
vi.mock('./dealer-application-repository', () => ({ decideDealerApplication: (a: unknown) => decide(a) }));

import { decideDealerApplicationAction } from './dealer-application-actions';

const id = '11111111-1111-4111-8111-111111111111';
const ts = '2026-09-25T01:02:03.123456+00:00';
function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const approve = { applicationId: id, decision: 'approve', note: '', expectedTier: 'general', expectedUpdatedAt: ts };

async function run(fd: FormData): Promise<string> {
  try {
    await decideDealerApplicationAction(fd);
  } catch (e) {
    return String((e as Error).message).replace('REDIRECT:', '');
  }
  throw new Error('沒有 redirect');
}

beforeEach(() => {
  authorize.mockReset();
  decide.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
  authorize.mockResolvedValue({ actorId: 'ming', sid: 's1' });
});

describe('核准 / 婉拒經銷商申請(片 D2)', () => {
  it('🔴 不是登入的員工 ⇒ denied, 不送到資料庫', async () => {
    authorize.mockResolvedValue(null);
    expect(await run(form(approve))).toBe(`/customers/dealer-applications/${id}?r=denied`);
    expect(decide).not.toHaveBeenCalled();
  });

  it('申請編號不是 uuid ⇒ invalid, 回列表', async () => {
    expect(await run(form({ ...approve, applicationId: 'abc' }))).toBe('/customers/dealer-applications?r=invalid');
    expect(decide).not.toHaveBeenCalled();
  });

  it('更新時間不是時間格式 ⇒ invalid, 不送到資料庫', async () => {
    expect(await run(form({ ...approve, expectedUpdatedAt: 'not-a-timestamp' }))).toBe(`/customers/dealer-applications/${id}?r=invalid`);
    expect(decide).not.toHaveBeenCalled();
  });

  it('🔴 婉拒沒填原因(只有空白)⇒ invalid, 不送到資料庫', async () => {
    expect(await run(form({ ...approve, decision: 'reject', note: '　 ' }))).toBe(`/customers/dealer-applications/${id}?r=invalid`);
    expect(decide).not.toHaveBeenCalled();
  });

  it('🔴 核准:員工看到的 updated_at 原樣傳下去(不轉 Date, 否則微秒被砍 ⇒ 每次 STALE);actor 取登入身分', async () => {
    decide.mockResolvedValue('APPROVED');
    expect(await run(form(approve))).toBe(`/customers/dealer-applications/${id}?r=approved`);
    expect(decide).toHaveBeenCalledWith({
      applicationId: id,
      decision: 'approve',
      note: '',
      actor: 'ming',
      requestId: 'req-1',
      expectedTier: 'general',
      expectedUpdatedAt: ts,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/customers/dealer-applications');
  });

  it.each([
    ['REJECTED', 'rejected'],
    ['STALE', 'stale'],
    ['ALREADY_DECIDED', 'already_decided'],
    ['WOULD_DOWNGRADE', 'would_downgrade'],
    ['NOT_FOUND', 'not_found'],
    ['SOMETHING_NEW', 'unknown'],
  ])('資料庫回 %s ⇒ r=%s', async (db, code) => {
    decide.mockResolvedValue(db);
    expect(await run(form({ ...approve, decision: 'reject', note: '資料不足' }))).toBe(`/customers/dealer-applications/${id}?r=${code}`);
  });

  it('🔴 呼叫失敗 ⇒ unknown(結果無法確認, 請重新整理), 不寫成失敗', async () => {
    decide.mockRejectedValue(new Error('network'));
    expect(await run(form(approve))).toBe(`/customers/dealer-applications/${id}?r=unknown`);
  });
});
