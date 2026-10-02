// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const actions = vi.hoisted(() => ({ preview: vi.fn(), whole: vi.fn(), save: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/email-copy/preview-email-copy-action', () => ({
  previewEmailCopyAction: actions.preview,
  previewWholeEmailAction: actions.whole,
}));
vi.mock('@/lib/email-copy/save-email-copy-action', () => ({ saveEmailCopyAction: actions.save }));
vi.mock('@/lib/email-copy/send-test-email-copy-action', () => ({ sendTestEmailCopyAction: actions.send }));

import { EmailCopyEditor } from './email-copy-editor';
import { buildEmailCopyRows } from '@/lib/email-copy/email-copy-view';
import type { EmailCopyKey } from '@pcm/domain';
import type { EmailPreviewSample } from '@pcm/use-cases';

// Sean 10-03 試用回饋:先選信件、再選句子;右欄看整封信。

const SAMPLES: EmailPreviewSample[] = [
  { id: 'paid', label: '付款成功信', group: 'paid' },
  { id: 'unpaid_cancelled', label: '未付款取消信', group: 'unpaid_cancelled' },
];
const SAMPLE_KEYS: Record<string, EmailCopyKey[]> = {
  paid: ['greeting', 'paidNextStep', 'companyLine'],
  unpaid_cancelled: ['greeting', 'unpaidCancelledNoCharge', 'companyLine'],
};
const rows = buildEmailCopyRows([], new Map(Object.entries(SAMPLE_KEYS)));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const list = () => within(screen.getByRole('navigation'));

describe('EmailCopyEditor', () => {
  it('一開始選付款成功信:清單只有這封信的句子(含它用到的共用句), 右邊載入整封信', async () => {
    actions.whole.mockResolvedValue({ ok: true, subject: '付款成功', html: '<html><body>x</body></html>', highlighted: true });
    render(<EmailCopyEditor rows={rows} samples={SAMPLES} sampleKeys={SAMPLE_KEYS} testConfigured />);
    expect(screen.getByRole('tab', { name: '付款成功信' }).getAttribute('aria-selected')).toBe('true');
    expect(list().getByText('付款成功信:下一步說明')).toBeTruthy();
    expect(list().getByText('結尾公司名稱與統編')).toBeTruthy();
    expect(list().queryByText('未付款取消信:沒有扣款')).toBeNull();
    expect(list().queryByText('品項沒有品名時顯示')).toBeNull();
    await waitFor(() => expect(actions.whole).toHaveBeenCalledWith('paid'));
    expect(await screen.findByTitle('整封信預覽')).toBeTruthy();
  });

  it('換一封信 ⇒ 清單換成那封信的句子, 整封信換範例', async () => {
    actions.whole.mockResolvedValue({ ok: true, subject: 's', html: '<html><body>x</body></html>', highlighted: true });
    render(<EmailCopyEditor rows={rows} samples={SAMPLES} sampleKeys={SAMPLE_KEYS} testConfigured />);
    fireEvent.click(screen.getByRole('tab', { name: '未付款取消信' }));
    expect(list().getByText('未付款取消信:沒有扣款')).toBeTruthy();
    expect(list().queryByText('付款成功信:下一步說明')).toBeNull();
    await waitFor(() => expect(actions.whole).toHaveBeenCalledWith('unpaid_cancelled'));
  });

  it('「多封共用」⇒ 只列共用句子', () => {
    actions.whole.mockResolvedValue({ ok: true, subject: 's', html: '<html><body>x</body></html>', highlighted: true });
    render(<EmailCopyEditor rows={rows} samples={SAMPLES} sampleKeys={SAMPLE_KEYS} testConfigured />);
    fireEvent.click(screen.getByRole('tab', { name: '多封信共用' }));
    expect(list().getByText('品項沒有品名時顯示')).toBeTruthy();
    expect(list().queryByText('付款成功信:下一步說明')).toBeNull();
  });

  it('點清單裡的句子 ⇒ 右邊換成編輯那一句;「回到整封信」回來', () => {
    actions.whole.mockResolvedValue({ ok: true, subject: 's', html: '<html><body>x</body></html>', highlighted: true });
    render(<EmailCopyEditor rows={rows} samples={SAMPLES} sampleKeys={SAMPLE_KEYS} testConfigured />);
    fireEvent.click(list().getByText('付款成功信:下一步說明'));
    expect(screen.getByRole('heading', { name: '付款成功信:下一步說明' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '← 回到整封信' }));
    expect(screen.getByRole('heading', { name: '整封信預覽' })).toBeTruthy();
  });

  it('整封信裡點了某一句(iframe 傳訊息)⇒ 打開那一句;別的視窗傳來的訊息不理', async () => {
    actions.whole.mockResolvedValue({ ok: true, subject: 's', html: '<html><body>x</body></html>', highlighted: true });
    render(<EmailCopyEditor rows={rows} samples={SAMPLES} sampleKeys={SAMPLE_KEYS} testConfigured />);
    const frame = (await screen.findByTitle('整封信預覽')) as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'pcm-email-copy-pick', key: 'paidNextStep' }, source: window }));
    expect(screen.queryByRole('heading', { name: '付款成功信:下一步說明' })).toBeNull();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'pcm-email-copy-pick', key: 'paidNextStep' }, source: frame.contentWindow }));
    expect(await screen.findByRole('heading', { name: '付款成功信:下一步說明' })).toBeTruthy();
  });
});
