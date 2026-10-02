import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorize }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: () => ({ rpc: mocks.rpc }) }));

import { saveEmailCopyAction } from './save-email-copy-action';

// 信件文字第 2 片(2c):後台存檔動作。

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ actorId: 'staff-a' });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe('saveEmailCopyAction', () => {
  it('沒登入後台 ⇒ denied, 不寫資料庫', async () => {
    mocks.authorize.mockResolvedValue(null);
    expect(await saveEmailCopyAction('greeting', '嗨，')).toEqual({ ok: false, reason: 'denied' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('合格 ⇒ 叫存檔函式, 帶員工與 request id', async () => {
    expect(await saveEmailCopyAction('cancelledHeadlineWithId', '訂單 {訂單編號} 已為您取消。')).toEqual({ ok: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_email_copy', {
      p_key: 'cancelledHeadlineWithId',
      p_text: '訂單 {訂單編號} 已為您取消。',
      p_actor: 'staff-a',
      p_request_id: 'req-1',
    });
  });

  it('還原成預設(null)⇒ 不做文字檢查, 直接存', async () => {
    expect(await saveEmailCopyAction('cancelledHeadlineWithId', null)).toEqual({ ok: true });
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({ p_text: null });
  });

  it('不合格 ⇒ 回問題清單, 不寫資料庫', async () => {
    const r = await saveEmailCopyAction('cancelledHeadlineWithId', '已取消。');
    expect(r).toEqual({ ok: false, reason: 'invalid', problems: ['缺少 {訂單編號}，請加回去'] });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('不認得的句子、鎖住的句子(連還原也不行)⇒ invalid', async () => {
    expect(await saveEmailCopyAction('noSuchKey', 'x')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await saveEmailCopyAction('contactLead', null)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('資料庫回錯或丟例外 ⇒ error(畫面要說存檔失敗, 不是已存)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({ error: { code: '23514' } });
    expect(await saveEmailCopyAction('greeting', '嗨，')).toEqual({ ok: false, reason: 'error' });
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await saveEmailCopyAction('greeting', '嗨，')).toEqual({ ok: false, reason: 'error' });
    err.mockRestore();
  });
});
