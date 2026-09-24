// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../lib/customers/dealer-application-actions', () => ({ decideDealerApplicationAction: vi.fn() }));
import { DealerDecisionForms } from './dealer-decision-forms';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const props = { applicationId: 'a1', companyName: '阿明車行', updatedAt: '2026-09-25T01:02:03.123456+00:00' };

describe('經銷商申請審核按鈕(片 D2)', () => {
  it('🔴 帳號已是經銷 ⇒ 核准按鈕不能按, 並寫出原因', () => {
    render(<DealerDecisionForms {...props} currentTier='premiumStore' />);
    expect((screen.getByRole('button', { name: '核准申請' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/不能核准/)).toBeTruthy();
  });

  it('🔴 確認框按取消 ⇒ 不送出', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DealerDecisionForms {...props} currentTier='general' />);
    const form = screen.getByRole('button', { name: '核准申請' }).closest('form')!;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    fireEvent(form, ev);
    expect(window.confirm).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
  });

  it('員工看到的那一版原樣放進表單(等級與更新時間)', () => {
    render(<DealerDecisionForms {...props} currentTier='store' />);
    const form = screen.getByRole('button', { name: '核准申請' }).closest('form')!;
    const fd = new FormData(form);
    expect(fd.get('expectedTier')).toBe('store');
    expect(fd.get('expectedUpdatedAt')).toBe(props.updatedAt);
    expect(screen.getByText(/等級不變/)).toBeTruthy();
  });
});
