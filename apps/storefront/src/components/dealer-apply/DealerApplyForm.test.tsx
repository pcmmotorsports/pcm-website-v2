// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const submit = vi.fn();
const update = vi.fn();
const refresh = vi.fn();
const push = vi.fn();
vi.mock('@/app/dealer-apply/actions', () => ({
  submitDealerApplicationAction: (v: unknown) => submit(v),
  updateDealerApplicationAction: (id: string, v: unknown) => update(id, v),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push }) }));

import { DealerApplyForm } from './DealerApplyForm';
import { EMPTY_DEALER_APPLY } from '@/lib/dealer-apply/form';

afterEach(() => {
  cleanup();
  submit.mockReset();
  update.mockReset();
  refresh.mockReset();
  push.mockReset();
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

describe('修改申請資料(片 B2)', () => {
  it('成功 ⇒ 回到狀態頁並顯示已更新(帶 updated=1), 不呼叫新增', async () => {
    update.mockResolvedValue({ ok: true });
    render(<DealerApplyForm initial={filled} submitLabel="儲存修改" editId="app-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
    });
    expect(update).toHaveBeenCalledWith('app-1', expect.objectContaining({ companyName: '〇〇車業' }));
    expect(submit).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith('/dealer-apply?updated=1');
  });

  it('🔴 員工剛審完(資料庫更新 0 筆)⇒ 顯示已經審核完成, 不跳走', async () => {
    update.mockResolvedValue({ ok: false, kind: 'already_decided', message: '這筆申請已經審核完成，無法再修改。請重新整理查看結果。' });
    render(<DealerApplyForm initial={filled} submitLabel="儲存修改" editId="app-1" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '儲存修改' }));
    });
    expect(screen.getByText(/這筆申請已經審核完成/)).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText(/已更新/)).toBeNull();
  });
});

describe('送出時網路中斷', () => {
  it('🔴 不說成功也不說失敗, 請他重新整理確認; 表單內容還在', async () => {
    submit.mockRejectedValue(new Error('network'));
    render(<DealerApplyForm initial={filled} submitLabel="送出經銷商申請" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '送出經銷商申請' }));
    });
    expect(screen.getByText('無法確認資料是否已送出，請重新整理頁面查看目前狀態。')).toBeTruthy();
    expect((screen.getByLabelText(/公司或商號名稱/) as HTMLInputElement).value).toBe('〇〇車業');
    expect(refresh).not.toHaveBeenCalled();
  });
});
