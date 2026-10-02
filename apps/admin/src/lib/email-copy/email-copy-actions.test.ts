import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), list: vi.fn(), record: vi.fn() }));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: mocks.authorize }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./email-copy-repository', () => ({ listEmailCopyVersions: mocks.list }));
vi.mock('../orders/order-repository', () => ({ getAdminAuditLogRepository: () => ({ record: mocks.record }) }));

import { previewEmailCopyAction } from './preview-email-copy-action';
import { sendTestEmailCopyAction, isTestEmailConfigured } from './send-test-email-copy-action';
import { resetTestEmailSlotsForTest } from './test-email-rate-limit';

// 信件文字第 3 片:預覽與寄測試信的伺服器動作。

const fetchMock = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({ actorId: 'staff-a' });
  mocks.list.mockResolvedValue([]);
  mocks.record.mockResolvedValue(undefined);
  vi.stubEnv('RESEND_API_KEY', 're_test');
  vi.stubEnv('ORDER_EMAIL_FROM', 'PCM <orders@pcmmotorsports.com>');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200 });
  resetTestEmailSlotsForTest();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('previewEmailCopyAction', () => {
  it('沒登入後台 ⇒ denied, 不讀資料庫', async () => {
    mocks.authorize.mockResolvedValue(null);
    expect(await previewEmailCopyAction('greeting', '嗨，', 'unpaid_cancelled')).toEqual({ ok: false, reason: 'denied' });
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it('草稿不合格 ⇒ 回問題清單', async () => {
    const r = await previewEmailCopyAction('cancelledHeadlineWithId', '已取消。', 'unpaid_cancelled');
    expect(r).toEqual({ ok: false, reason: 'invalid', problems: ['缺少 {訂單編號}，請加回去'] });
  });
  it('草稿套上, 其他句子用現在生效的版本', async () => {
    mocks.list.mockResolvedValue([{ id: 'v', copyKey: 'greeting', text: '早安，', savedAt: '2026-10-01T00:00:00Z', savedBy: 'x' }]);
    const r = await previewEmailCopyAction('unpaidCancelledNoCharge', '還沒付款，不收費。', 'unpaid_cancelled');
    if (!r.ok) throw new Error('應該成功');
    expect(r.preview.text).toContain('早安，');
    expect(r.preview.text).toContain('還沒付款，不收費。');
    expect(r.sentenceInSample).toBe(true);
  });
  it('還原成預設(null)⇒ 那一句不用表裡的字', async () => {
    mocks.list.mockResolvedValue([{ id: 'v', copyKey: 'greeting', text: '早安，', savedAt: '2026-10-01T00:00:00Z', savedBy: 'x' }]);
    const r = await previewEmailCopyAction('greeting', null, 'unpaid_cancelled');
    if (!r.ok) throw new Error('應該成功');
    expect(r.preview.text).toContain('您好，');
  });
  it('範例沒用到這一句 ⇒ sentenceInSample = false', async () => {
    const r = await previewEmailCopyAction('shippedHeadline', '{訂單編號} 出貨了。', 'unpaid_cancelled');
    if (!r.ok) throw new Error('應該成功');
    expect(r.sentenceInSample).toBe(false);
  });
  it('讀不到版本表 ⇒ error', async () => {
    mocks.list.mockRejectedValue(new Error('down'));
    expect(await previewEmailCopyAction('greeting', '嗨，', 'unpaid_cancelled')).toEqual({ ok: false, reason: 'error' });
  });
});

describe('sendTestEmailCopyAction', () => {
  const input = { key: 'unpaidCancelledNoCharge', draft: '還沒付款，不收費。', sampleId: 'unpaid_cancelled', to: 'me@example.com' };

  it('沒設金鑰 ⇒ not_configured, 不寄;isTestEmailConfigured = false', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: false, reason: 'not_configured' });
    expect(await isTestEmailConfigured()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('沒登入後台 ⇒ denied', async () => {
    mocks.authorize.mockResolvedValue(null);
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: false, reason: 'denied' });
  });
  it('信箱格式不對、合成信箱 ⇒ bad_address, 不寄', async () => {
    expect(await sendTestEmailCopyAction({ ...input, to: 'not-an-email' })).toEqual({ ok: false, reason: 'bad_address' });
    expect(await sendTestEmailCopyAction({ ...input, to: 'u1@line.pcmmotorsports.local' })).toEqual({ ok: false, reason: 'bad_address' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('寄出:主旨加〔測試〕, 純文字與 HTML 最上面標明是測試信, 用草稿字;記操作紀錄', async () => {
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: true });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, string>;
    expect(body.to).toBe('me@example.com');
    expect(body.from).toBe('PCM <orders@pcmmotorsports.com>');
    expect(body.subject?.startsWith('〔測試〕')).toBe(true);
    expect(body.text?.startsWith('〔測試信〕')).toBe(true);
    expect(body.text).toContain('還沒付款，不收費。');
    expect(body.html).toContain('〔測試信〕');
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email_copy.test_send',
        target: 'email_copy:unpaidCancelledNoCharge',
        after: expect.objectContaining({ to: 'me@example.com', sample: '未付款取消信', text: '還沒付款，不收費。', outcome: 'accepted' }),
      }),
      expect.objectContaining({ actor: 'staff-a', requestId: 'req-1' }),
    );
  });
  it('每位員工一分鐘最多 3 封;別的員工不受影響', async () => {
    for (let i = 0; i < 3; i++) expect(await sendTestEmailCopyAction(input)).toEqual({ ok: true });
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: false, reason: 'too_many' });
    mocks.authorize.mockResolvedValue({ actorId: 'staff-b' });
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: true });
  });
  it('Resend 回 4xx ⇒ error;5xx 或斷線 ⇒ unknown(尚未確認), 都記操作紀錄', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 422 });
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: false, reason: 'error' });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    expect(await sendTestEmailCopyAction(input)).toEqual({ ok: false, reason: 'unknown' });
    expect(mocks.record).toHaveBeenCalledTimes(2);
  });
  it('鎖住的句子、不合格的草稿 ⇒ 不寄', async () => {
    expect(await sendTestEmailCopyAction({ ...input, key: 'contactLead' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await sendTestEmailCopyAction({ ...input, draft: '含 <b> 標籤' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
