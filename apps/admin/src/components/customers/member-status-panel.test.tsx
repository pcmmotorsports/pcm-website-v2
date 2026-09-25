// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ disable: vi.fn(), enable: vi.fn(), del: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('../../lib/customers/member-status-actions', () => ({
  disableCustomerAction: h.disable,
  enableCustomerAction: h.enable,
  deleteCustomerAction: h.del,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: h.refresh }) }));
import { MemberStatusPanel } from './member-status-panel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const base = {
  customerId: 'c0000000-0000-4000-8000-000000000001',
  disabledAt: null,
  disabledBy: null,
  disabledReason: null,
  version: 3,
  deletable: true,
  blockers: [],
  permission: 'yes' as const,
};

// 後台停用 / 恢復 / 刪除會員(20260926100000;計畫第六、九節)
describe('會員狀態面板', () => {
  it('🔴 不是老闆 ⇒ 看不到任何按鈕', () => {
    render(<MemberStatusPanel {...base} permission='no' />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  // Fable 第 4 片 R1 必修 2:查不到權限 ⇒ 不給按鈕, 但要說明原因
  it('🔴 查不到權限 ⇒ 沒有按鈕, 顯示說明', () => {
    render(<MemberStatusPanel {...base} permission='unknown' />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(/暫時無法確認你的權限/)).toBeTruthy();
  });

  it('讀不到可否刪除 ⇒ 沒有刪除鈕, 請他重新整理', () => {
    render(<MemberStatusPanel {...base} deletable={null} />);
    expect(screen.queryByRole('button', { name: '刪除會員' })).toBeNull();
    expect(screen.getByText(/暫時無法確認這位會員能不能刪除/)).toBeTruthy();
  });

  it('🔴 送出中確認鈕不能再按;刪除成功帶結果碼回列表', async () => {
    let resolve!: (v: unknown) => void;
    h.del.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<MemberStatusPanel {...base} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除會員' }));
    fireEvent.change(screen.getByLabelText('刪除會員原因'), { target: { value: '重複註冊' } });
    const confirm = screen.getByRole('button', { name: '確定刪除會員' }) as HTMLButtonElement;
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    expect(h.del).toHaveBeenCalledTimes(1);
    resolve({ ok: true, code: 'DELETED', message: '已刪除會員。' });
    await waitFor(() => expect(h.push).toHaveBeenCalledWith('/customers?r=customer_deleted'));
  });

  it('狀態被改過(STALE)⇒ 顯示說明、面板留著、不重整', async () => {
    h.enable.mockResolvedValue({ ok: false, code: 'STALE', message: '這位會員的狀態在你打開頁面之後已經改過' });
    render(<MemberStatusPanel {...base} disabledAt='2026-09-26T02:00:00+00:00' />);
    fireEvent.click(screen.getByRole('button', { name: '恢復會員' }));
    fireEvent.change(screen.getByLabelText('恢復會員原因'), { target: { value: '誤停' } });
    fireEvent.click(screen.getByRole('button', { name: '確定恢復會員' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已經改過'));
    expect(screen.getByRole('button', { name: '確定恢復會員' })).toBeTruthy();
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it('有紀錄 ⇒ 沒有刪除鈕, 列出原因', () => {
    render(<MemberStatusPanel {...base} deletable={false} blockers={['orders']} />);
    expect(screen.queryByRole('button', { name: '刪除會員' })).toBeNull();
    expect(screen.getByText('這位會員有下列紀錄，只能停用：訂單。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '停用會員' })).toBeTruthy();
  });

  it('🔴 原因沒填不能送出;送出時帶畫面上的版本號', async () => {
    h.disable.mockResolvedValue({ ok: true, code: 'OK', message: '已停用會員。' });
    render(<MemberStatusPanel {...base} />);
    fireEvent.click(screen.getByRole('button', { name: '停用會員' }));
    const confirm = screen.getByRole('button', { name: '確定停用會員' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('停用會員原因'), { target: { value: ' 客人要求 ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('已停用會員。'));
    expect(h.disable).toHaveBeenCalledWith({ customerId: base.customerId, reason: '客人要求', expectedVersion: 3 });
    expect(h.refresh).toHaveBeenCalled();
  });

  it('🔴 呼叫本身失敗(沒收到回應)⇒ 顯示「無法確認」', async () => {
    h.del.mockRejectedValue(new Error('network'));
    render(<MemberStatusPanel {...base} />);
    fireEvent.click(screen.getByRole('button', { name: '刪除會員' }));
    fireEvent.change(screen.getByLabelText('刪除會員原因'), { target: { value: '重複註冊' } });
    fireEvent.click(screen.getByRole('button', { name: '確定刪除會員' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('無法確認這次刪除是否完成'));
    expect(h.push).not.toHaveBeenCalled();
  });

  it('已停用 ⇒ 顯示停用時間、停用者、原因, 按鈕是恢復會員', () => {
    render(<MemberStatusPanel {...base} disabledAt='2026-09-26T02:00:00+00:00' disabledBy='sean' disabledReason='客人要求' />);
    expect(screen.getByText('已停用（2026-09-26，由 sean 停用）')).toBeTruthy();
    expect(screen.getByText('原因：客人要求')).toBeTruthy();
    expect(screen.getByRole('button', { name: '恢復會員' })).toBeTruthy();
  });
});
