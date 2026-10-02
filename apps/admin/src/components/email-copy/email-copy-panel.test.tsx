// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ preview: vi.fn(), save: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/email-copy/preview-email-copy-action', () => ({ previewEmailCopyAction: actions.preview }));
vi.mock('@/lib/email-copy/save-email-copy-action', () => ({ saveEmailCopyAction: actions.save }));
vi.mock('@/lib/email-copy/send-test-email-copy-action', () => ({ sendTestEmailCopyAction: actions.send }));

import { EmailCopyPanel } from './email-copy-panel';
import type { EmailCopyRow } from '@/lib/email-copy/email-copy-view';

// 信件文字第 3 片:編輯面板。存檔前一定要先看預覽(Sean 10-02 Q5 甲)。

const SAMPLES = [{ id: 'unpaid_cancelled', label: '未付款取消信' }];
const row = (over: Partial<EmailCopyRow> = {}): EmailCopyRow => ({
  key: 'unpaidCancelledNoCharge',
  group: 'unpaid_cancelled',
  label: '未付款取消信:沒有扣款',
  defaultText: '這張訂單尚未付款，不會有任何款項產生。',
  currentText: '這張訂單尚未付款，不會有任何款項產生。',
  isDefault: true,
  placeholders: [],
  lockReason: null,
  note: null,
  defaultSampleId: 'unpaid_cancelled',
  history: [],
  ...over,
});
const PREVIEW = { subject: 'PCM 訂單 PCM-2026-0001 已取消', text: '您好，\n還沒付款', html: '<html><body>x</body></html>', lineText: '您好，\n還沒付款' };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const textarea = () => screen.getByLabelText('文字') as HTMLTextAreaElement;
const saveBtn = () => screen.getByRole('button', { name: '儲存這一句' }) as HTMLButtonElement;

describe('EmailCopyPanel', () => {
  it('改了字還沒預覽 ⇒ 不能儲存;預覽之後可以;再改一個字又不能', async () => {
    actions.preview.mockResolvedValue({ ok: true, preview: PREVIEW, sentenceInSample: true });
    render(<EmailCopyPanel row={row()} samples={SAMPLES} testConfigured />);
    fireEvent.change(textarea(), { target: { value: '還沒付款，不收費。' } });
    expect(saveBtn().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    expect(actions.preview).toHaveBeenCalledWith('unpaidCancelledNoCharge', '還沒付款，不收費。', 'unpaid_cancelled');
    fireEvent.change(textarea(), { target: { value: '還沒付款，不收費!' } });
    expect(saveBtn().disabled).toBe(true);
  });

  it('沒改任何字 ⇒ 預覽之後也不能儲存(和現在一樣)', async () => {
    actions.preview.mockResolvedValue({ ok: true, preview: PREVIEW, sentenceInSample: true });
    render(<EmailCopyPanel row={row()} samples={SAMPLES} testConfigured />);
    fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    await screen.findByText(/主旨：/);
    expect(saveBtn().disabled).toBe(true);
  });

  it('預覽回報文字不合格 ⇒ 顯示問題, 不能儲存', async () => {
    actions.preview.mockResolvedValue({ ok: false, reason: 'invalid', problems: ['不能有 < 或 >'] });
    render(<EmailCopyPanel row={row()} samples={SAMPLES} testConfigured />);
    fireEvent.change(textarea(), { target: { value: 'a<b' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    expect(await screen.findByText('這段文字還不能用：不能有 < 或 >。')).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
  });

  it('儲存成功 ⇒ 說明之後排進佇列的信才會用新字', async () => {
    actions.preview.mockResolvedValue({ ok: true, preview: PREVIEW, sentenceInSample: true });
    actions.save.mockResolvedValue({ ok: true });
    render(<EmailCopyPanel row={row()} samples={SAMPLES} testConfigured />);
    fireEvent.change(textarea(), { target: { value: '還沒付款，不收費。' } });
    fireEvent.click(screen.getByRole('button', { name: '預覽' }));
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/已儲存。之後排進寄送佇列的信會用新的文字/)).toBeTruthy();
    expect(actions.save).toHaveBeenCalledWith('unpaidCancelledNoCharge', '還沒付款，不收費。');
  });

  it('鎖住的句子 ⇒ 顯示原因, 沒有編輯框也沒有儲存鈕', () => {
    render(<EmailCopyPanel row={row({ key: 'contactLead', lockReason: 'LINE 通知會依這段文字找出要拿掉的那一行。' })} samples={SAMPLES} testConfigured />);
    expect(screen.getByText('這一句不開放修改')).toBeTruthy();
    expect(screen.getByText('LINE 通知會依這段文字找出要拿掉的那一行。')).toBeTruthy();
    expect(screen.queryByLabelText('文字')).toBeNull();
    expect(screen.queryByRole('button', { name: '儲存這一句' })).toBeNull();
  });

  it('沒設寄測試信的金鑰 ⇒ 顯示「尚未設定」, 沒有寄信鈕', () => {
    render(<EmailCopyPanel row={row()} samples={SAMPLES} testConfigured={false} />);
    expect(screen.getByText('寄測試信尚未設定，請聯絡系統管理員。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '寄測試信' })).toBeNull();
  });

  it('修改紀錄「還原成這一版」⇒ 放進編輯框並直接預覽', async () => {
    actions.preview.mockResolvedValue({ ok: true, preview: PREVIEW, sentenceInSample: true });
    render(
      <EmailCopyPanel
        row={row({
          currentText: '新的字。',
          isDefault: false,
          history: [
            { id: 'b', savedAt: '2026-10-02 09:00', savedBy: 'staff-a', text: '新的字。' },
            { id: 'a', savedAt: '2026-10-01 09:00', savedBy: 'staff-a', text: '舊的字。' },
          ],
        })}
        samples={SAMPLES}
        testConfigured
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '還原成這一版' }));
    await waitFor(() => expect(actions.preview).toHaveBeenCalledWith('unpaidCancelledNoCharge', '舊的字。', 'unpaid_cancelled'));
    expect(textarea().value).toBe('舊的字。');
  });

  it('帳號停用信的提醒、範例看不到的提醒會顯示', () => {
    render(<EmailCopyPanel row={row({ note: '帳號停用通知信不在這裡管理，那封信的公司名稱不會跟著改。', defaultSampleId: null })} samples={SAMPLES} testConfigured />);
    expect(screen.getByText('帳號停用通知信不在這裡管理，那封信的公司名稱不會跟著改。')).toBeTruthy();
    expect(screen.getByText(/範例信看不到/)).toBeTruthy();
  });
});
