// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const submit = vi.fn();
const refresh = vi.fn();
vi.mock('@/app/dealer-apply/actions', () => ({ submitDealerApplicationAction: (v: unknown) => submit(v) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import { DealerApplyForm } from './DealerApplyForm';
import { EMPTY_DEALER_APPLY } from '@/lib/dealer-apply/form';

afterEach(() => {
  cleanup();
  submit.mockReset();
  refresh.mockReset();
});

const filled = {
  ...EMPTY_DEALER_APPLY,
  companyName: '〇〇車業', taxId: '12345678', region: '臺北市',
  contactName: '王小明', contactPhone: '0912345678', contactEmail: 'a@x.tw',
};

describe('經銷商申請表單', () => {
  it('🔴 送出失敗後, 表單欄位的值還在', async () => {
    submit.mockResolvedValue({ ok: false, kind: 'failed', message: '申請送出失敗，請稍後再試一次。若仍無法送出，請直接聯絡 PCM 業務。' });
    render(<DealerApplyForm initial={filled} submitLabel="送出經銷商申請" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出經銷商申請' }));
    });
    expect(screen.getByText(/申請送出失敗/)).toBeTruthy();
    expect((screen.getByLabelText(/公司或商號名稱/) as HTMLInputElement).value).toBe('〇〇車業');
    expect((screen.getByLabelText(/統一編號/) as HTMLInputElement).value).toBe('12345678');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('前台先擋 7 碼統編:錯誤寫在那一格下方, 不送出', async () => {
    render(<DealerApplyForm initial={{ ...filled, taxId: '1234567' }} submitLabel="送出經銷商申請" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出經銷商申請' }));
    });
    expect(screen.getByText('統一編號是 8 位數字，請再確認一次。')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('登入已過期 ⇒ 顯示重新登入的連結(帶 next=/dealer-apply)', async () => {
    submit.mockResolvedValue({ ok: false, kind: 'session_expired', message: '登入已過期，請重新登入後再送出。您填的資料不會保存。' });
    render(<DealerApplyForm initial={filled} submitLabel="送出經銷商申請" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出經銷商申請' }));
    });
    expect(screen.getByRole('link', { name: '重新登入' }).getAttribute('href')).toBe('/login?next=%2Fdealer-apply');
  });

  it('成功 ⇒ 重新整理頁面顯示申請狀態', async () => {
    submit.mockResolvedValue({ ok: true });
    render(<DealerApplyForm initial={filled} submitLabel="送出經銷商申請" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出經銷商申請' }));
    });
    expect(refresh).toHaveBeenCalled();
  });
});
