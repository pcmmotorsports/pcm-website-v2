// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('server-only', () => ({}));
const action = vi.hoisted(() => vi.fn());
vi.mock('../../lib/customers/auth-mail-lookup-action', () => ({ lookupAuthMailAction: action }));

import { AuthMailLookupButton } from './auth-mail-lookup-button';

// 客戶頁「查最近寄信紀錄」每一種結果, 員工看到的字(本機後台環境讀不到會員登入資料, 截不到圖 ⇒ 用這裡證畫面文字)。

const ID = '11111111-1111-4111-8111-111111111111';

async function pressWith(result: unknown) {
  action.mockResolvedValueOnce(result);
  render(<AuthMailLookupButton customerId={ID} />);
  fireEvent.click(screen.getByRole('button', { name: '查最近寄信紀錄' }));
  await waitFor(() => expect(action).toHaveBeenCalledWith(ID));
}

afterEach(() => {
  cleanup();
  action.mockReset();
});

describe('AuthMailLookupButton', () => {
  it('按之前:說明只顯示寄出時間、主旨與狀態', () => {
    render(<AuthMailLookupButton customerId={ID} />);
    expect(screen.getByText('查驗證信、重設密碼信有沒有寄到。只顯示寄出時間、主旨與狀態。')).toBeTruthy();
  });

  it('找到:列出時間 / 主旨 / 狀態;被退回時提示確認信箱;印實際查到的範圍', async () => {
    await pressWith({
      kind: 'found',
      rows: [
        { sentAt: '10/02 15:40', subject: '確認您的 Email', status: '已送達' },
        { sentAt: '10/01 09:00', subject: '重設密碼', status: '被退回' },
      ],
      checkedSince: '09/30 08:00',
      allChecked: false,
    });
    expect(await screen.findByText('已送達')).toBeTruthy();
    expect(screen.getByText(/請和客人確認信箱是否打錯/)).toBeTruthy();
    expect(screen.getByText(/已查 09\/30 08:00 之後寄出的信。只查目前登入信箱與申請中的新信箱。/)).toBeTruthy();
  });

  it('沒有符合:說查了多少, 不說「沒有寄過」', async () => {
    await pressWith({ kind: 'none', checkedSince: '10/01 09:12', allChecked: false });
    const p = await screen.findByText(/沒有寄給這個信箱的驗證信或重設密碼信/);
    expect(p.textContent).toContain('已查 10/01 09:12 之後寄出的信。');
    expect(p.textContent).not.toMatch(/沒有寄過/);
  });

  it('沒有更多頁:說都查過了', async () => {
    await pressWith({ kind: 'none', checkedSince: '09/05 10:00', allChecked: true });
    expect(await screen.findByText(/Resend 目前保留的寄信紀錄都查過了。/)).toBeTruthy();
  });

  it.each([
    [{ kind: 'not_configured' }, '寄信紀錄查詢尚未設定，請聯絡系統管理員。'],
    [{ kind: 'key_rejected' }, '寄信紀錄查詢的金鑰無效或權限不足，請聯絡系統管理員。'],
    [{ kind: 'not_applicable' }, '這個帳號不是用 Email 和密碼註冊的，不會收到驗證信或重設密碼信。'],
    [{ kind: 'busy' }, '剛剛有人查過，請等幾秒再按一次。'],
    [{ kind: 'denied' }, '沒有權限查寄信紀錄，請重新登入。'],
    [{ kind: 'error' }, '寄信紀錄暫時查不到，請稍後再按一次。'],
    [{ kind: 'empty_account' }, '這把金鑰所屬的 Resend 帳號查不到任何寄信紀錄，請確認金鑰開在正確的帳號。'],
  ])('%o ⇒ 對應文字', async (result, text) => {
    await pressWith(result);
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('伺服器動作丟例外 ⇒ 暫時查不到(不是空白)', async () => {
    action.mockRejectedValueOnce(new Error('network'));
    render(<AuthMailLookupButton customerId={ID} />);
    fireEvent.click(screen.getByRole('button', { name: '查最近寄信紀錄' }));
    expect(await screen.findByText('寄信紀錄暫時查不到，請稍後再按一次。')).toBeTruthy();
  });
});
