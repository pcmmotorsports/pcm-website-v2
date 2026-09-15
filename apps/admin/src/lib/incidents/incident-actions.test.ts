import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  authorizeAdminMutation: vi.fn(),
  authorizeManagerMutation: vi.fn(),
  getRequestId: vi.fn(),
  resolveIncident: vi.fn(),
  reopenIncident: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('../session/authorize', () => ({
  authorizeAdminMutation: mocks.authorizeAdminMutation,
  authorizeManagerMutation: mocks.authorizeManagerMutation,
}));
vi.mock('../audit/context', () => ({ getRequestId: mocks.getRequestId }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('./incident-repository', () => ({
  resolveIncident: mocks.resolveIncident,
  reopenIncident: mocks.reopenIncident,
}));

import { reopenIncidentAction, resolveIncidentAction } from './incident-actions';

function formOf(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** redirect 的完整 URL(整串比對,不用子字串)。 */
async function redirectUrlOf(action: Promise<void>): Promise<string> {
  await expect(action).rejects.toThrow('NEXT_REDIRECT');
  expect(mocks.redirect).toHaveBeenCalledTimes(1);
  return mocks.redirect.mock.calls[0]![0] as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  });
  mocks.authorizeAdminMutation.mockResolvedValue({ sid: 'sid-1', actorId: 'amy' });
  mocks.getRequestId.mockResolvedValue('req-1');
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('resolveIncidentAction(標記已處理)', () => {
  it('🔴 Sean Q1 乙:走 authorizeAdminMutation(所有在職員工),不走管理者閘', async () => {
    mocks.resolveIncident.mockResolvedValue('resolved');
    await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7' })));
    expect(mocks.authorizeAdminMutation).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeManagerMutation).not.toHaveBeenCalled();
  });

  it('授權閘回 null ⇒ denied,repository 零呼叫', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7' })))).toBe('/settings/incidents?r=denied');
    expect(mocks.resolveIncident).not.toHaveBeenCalled();
  });

  it('成功 ⇒ 帶 actor / requestId / 說明;說明前後空白剝掉;重取頁面', async () => {
    mocks.resolveIncident.mockResolvedValue('resolved');
    const url = await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7', note: '  打給客人了  ' })));
    expect(url).toBe('/settings/incidents?r=resolved');
    expect(mocks.resolveIncident).toHaveBeenCalledWith({ id: 7, actor: 'amy', requestId: 'req-1', note: '打給客人了' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/incidents');
  });

  it('🔴 Sean Q2 乙:說明可以不寫(沒欄位 / 全空白都送 null)', async () => {
    mocks.resolveIncident.mockResolvedValue('resolved');
    await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7', note: '   ' })));
    expect(mocks.resolveIncident).toHaveBeenLastCalledWith(expect.objectContaining({ note: null }));
  });

  it.each([
    ['id 不是正整數', { incident_id: 'abc' }],
    ['id 是 0', { incident_id: '0' }],
    ['id 超過安全整數', { incident_id: '99999999999999999' }],
    ['說明 501 字', { incident_id: '7', note: '字'.repeat(501) }],
    ['說明含換行', { incident_id: '7', note: 'a\nb' }],
  ])('%s ⇒ invalid,repository 零呼叫', async (_name, fields) => {
    expect(await redirectUrlOf(resolveIncidentAction(formOf(fields)))).toBe('/settings/incidents?r=invalid');
    expect(mocks.resolveIncident).not.toHaveBeenCalled();
  });

  it.each([
    ['already', 'already'],
    ['not_found', 'notfound'],
  ])('RPC 回 %s ⇒ r=%s', async (result, code) => {
    mocks.resolveIncident.mockResolvedValue(result);
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7' })))).toBe(`/settings/incidents?r=${code}`);
  });

  it('🔴 DB 身分閘「無權執行此操作」⇒ denied(不叫他再試)', async () => {
    mocks.resolveIncident.mockRejectedValue({ code: 'P0001', message: '無權執行此操作' });
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7' })))).toBe('/settings/incidents?r=denied');
  });

  it('其他 DB 錯 ⇒ error;仍重取頁面', async () => {
    mocks.resolveIncident.mockRejectedValue({ code: '57014', message: 'canceling statement' });
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7' })))).toBe('/settings/incidents?r=error');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/incidents');
  });

  it('🔴 view=all ⇒ 導回「全部」;其他任何值 ⇒ 導回「未處理」(只有兩個寫死的目標)', async () => {
    mocks.resolveIncident.mockResolvedValue('resolved');
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7', view: 'all' })))).toBe('/settings/incidents?all=1&r=resolved');
    mocks.redirect.mockClear();
    expect(await redirectUrlOf(resolveIncidentAction(formOf({ incident_id: '7', view: 'https://evil.example' })))).toBe('/settings/incidents?r=resolved');
  });
});

describe('reopenIncidentAction(取消已處理)', () => {
  it('🔴 Sean Q3「權限一樣」:同樣走 authorizeAdminMutation', async () => {
    mocks.reopenIncident.mockResolvedValue('reopened');
    await redirectUrlOf(reopenIncidentAction(formOf({ incident_id: '7', reason: '按錯了' })));
    expect(mocks.authorizeAdminMutation).toHaveBeenCalledTimes(1);
    expect(mocks.authorizeManagerMutation).not.toHaveBeenCalled();
    expect(mocks.reopenIncident).toHaveBeenCalledWith({ id: 7, actor: 'amy', requestId: 'req-1', reason: '按錯了' });
  });

  it.each([
    ['沒有原因欄位', { incident_id: '7' }],
    ['原因全空白', { incident_id: '7', reason: '   ' }],
  ])('🔴 Sean Q3「要寫原因」:%s ⇒ reason_required,repository 零呼叫', async (_name, fields) => {
    expect(await redirectUrlOf(reopenIncidentAction(formOf(fields)))).toBe('/settings/incidents?r=reason_required');
    expect(mocks.reopenIncident).not.toHaveBeenCalled();
  });

  it.each([
    ['reopened', 'reopened'],
    ['already_open', 'already_open'],
    ['superseded', 'superseded'],
    ['not_found', 'notfound'],
  ])('RPC 回 %s ⇒ r=%s', async (result, code) => {
    mocks.reopenIncident.mockResolvedValue(result);
    expect(await redirectUrlOf(reopenIncidentAction(formOf({ incident_id: '7', reason: 'x' })))).toBe(`/settings/incidents?r=${code}`);
  });

  it('DB 回「缺原因」/「原因非法」⇒ reason_required / invalid(DB 那層再擋一次的對映)', async () => {
    mocks.reopenIncident.mockRejectedValue({ code: 'P0001', message: 'admin_reopen_pcm_incident: 缺原因' });
    expect(await redirectUrlOf(reopenIncidentAction(formOf({ incident_id: '7', reason: 'x' })))).toBe('/settings/incidents?r=reason_required');
    mocks.redirect.mockClear();
    mocks.reopenIncident.mockRejectedValue({ code: 'P0001', message: 'admin_reopen_pcm_incident: 原因非法' });
    expect(await redirectUrlOf(reopenIncidentAction(formOf({ incident_id: '7', reason: 'x' })))).toBe('/settings/incidents?r=invalid');
  });

  it('授權閘回 null ⇒ denied,repository 零呼叫', async () => {
    mocks.authorizeAdminMutation.mockResolvedValue(null);
    expect(await redirectUrlOf(reopenIncidentAction(formOf({ incident_id: '7', reason: 'x', view: 'all' })))).toBe('/settings/incidents?all=1&r=denied');
    expect(mocks.reopenIncident).not.toHaveBeenCalled();
  });
});
