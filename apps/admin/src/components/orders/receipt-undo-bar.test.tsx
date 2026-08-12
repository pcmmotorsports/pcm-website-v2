// @vitest-environment jsdom
// receipt-undo-bar.test.tsx — 「撤銷剛剛登錄的那筆」的畫面守門(「改軟」線片 1)。
//
// 🔴 本檔量的是**畫面**:action 本體被 mock 掉,這裡不驗 RPC 行為。
//    最重要的一格是 P4A03 原文 —— 那條是原作者交辦、主視窗照抄的硬條款。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReceiptUndoState } from '../../lib/orders/receipt-action-state';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock('../../lib/orders/receipt-actions', () => ({ undoItemReceiptAction: mocks.action }));
const action = mocks.action as unknown as ReturnType<
  typeof vi.fn<(prev: ReceiptUndoState, form: FormData) => Promise<ReceiptUndoState>>
>;

import { ReceiptUndoBar } from './receipt-undo-bar';

afterEach(cleanup);

function renderBar() {
  return render(
    <ReceiptUndoBar consumedKey='k-abc' orderId='o-1' orderItemId='i-1' returnTo='/orders/o-1' />,
  );
}

function click() {
  fireEvent.click(screen.getByText('撤銷剛剛那筆'));
}

/**
 * DB 原文的形狀。**手抄副本** —— 來源 =
 * `supabase/migrations/20260810233000_m4b_e10_352a2_receipt_write_rpcs.sql:428-433`
 * (那段 RAISE 的註解指回本檔與 `receipt-repository.test.ts`)。改 SQL 訊息時回來對一次。
 */
const P4A03_MESSAGE =
  '刪不掉這筆到貨紀錄:刪掉之後這個品項的可出數量會不夠。\n' +
  '已出貨 1 件、已裝進尚未出貨的包裹 2 件,而刪除後只剩 2 件。\n' +
  '尚未出貨的包裹:\n' +
  '  K7X2MP:1 件\n' +
  '  M3QQ8Z:1 件\n' +
  '要先把那些包裹作廢、或從包裹裡移除這個品項,才能刪掉這筆到貨紀錄。';

describe('ReceiptUndoBar', () => {
  it('🔴🔴 P4A03 的 DB 訊息**原文照畫**,不准壓成一句「刪不掉」', async () => {
    // 🔴 這一格是本片的硬條款(`receipt-repository.ts:8-13` 原作者交辦):訊息裡的**包裹編號與件數**
    //    是員工唯一能照做的資訊 —— 他要照著去把那些箱子作廢或移除品項。壓成籠統一句就等於把它丟掉。
    action.mockResolvedValue({ status: 'blocked', message: P4A03_MESSAGE });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text, '包裹編號不見了 ⇒ 員工不知道要去作廢哪一箱').toContain('K7X2MP');
    expect(text, '第二箱不見了 ⇒ 只處理一箱仍然撤不掉,他會以為系統壞了').toContain('M3QQ8Z');
    expect(text, '件數不見了').toContain('已出貨 1 件');
    expect(text, '出路那句不見了 ⇒ 只知道失敗、不知道下一步').toContain('要先把那些包裹作廢');
  });

  it('🔴 多行訊息要保留換行(擠成一團等於沒列出來)', async () => {
    action.mockResolvedValue({ status: 'blocked', message: P4A03_MESSAGE });
    const { container } = renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    // 🔴 斷言 class 而不是視覺:jsdom 量不到實際換行,但拿掉 `whitespace-pre-line` 這格會紅
    //    —— 那正是「逐箱列出」在畫面上失效的唯一機制。
    expect(container.querySelector('.whitespace-pre-line')).not.toBeNull();
  });

  it('撤銷成功講「已撤銷」', async () => {
    action.mockResolvedValue({ status: 'undone' });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByText(/已撤銷剛剛那筆到貨/)).not.toBeNull());
  });

  it('🔴 `already_gone` 不得講成「撤銷成功」(可能是連點的第二下、也可能是別人先撤的)', async () => {
    action.mockResolvedValue({ status: 'already_gone' });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByText(/已經不在了/)).not.toBeNull());
    expect(document.body.textContent, '講成自己撤成功的 ⇒ 他會以為這一下有生效').not.toMatch(
      /已撤銷剛剛那筆/,
    );
  });

  it('🔴 界線寫在畫面上:員工要看得到「只能撤剛剛這筆」', () => {
    // 🔴 沒有這句,他會以為到貨隨時都撤得掉,等真要撤三天前那筆時才發現沒入口
    //    (Sean 另一句「其實要先給另外一個訂單」= 事後才發現,本片不覆蓋)。
    renderBar();
    expect(document.body.textContent).toMatch(/只能撤掉剛剛這一筆/);
  });

  it('🔴 `blocked` 之後鈕也要留著(R2 must-fix 2:DB 原文叫他處理完包裹再回來刪)', async () => {
    // 🔴 與 failed 同一個形狀,我上一輪只認了 failed。`blocked` 是**永久終態** ——
    //    員工照 DB 訊息去把包裹作廢,回來卻沒有入口可按,那句「才能刪掉這筆」就是空頭支票。
    action.mockResolvedValue({ status: 'blocked', message: P4A03_MESSAGE });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(
      screen.queryByText('撤銷剛剛那筆'),
      'blocked 後鈕消失 ⇒ 處理完包裹回來沒有入口(而重整會讓整條撤銷列一起消失)',
    ).not.toBeNull();
  });

  it('🔴 `already_gone` **不給**鈕(終態,重按不可能改變結果)', async () => {
    action.mockResolvedValue({ status: 'already_gone' });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByText(/已經不在了/)).not.toBeNull());
    expect(screen.queryByText('撤銷剛剛那筆'), '那筆已經不在了,還留一顆按了必然無效的鈕').toBeNull();
  });

  it('🔴 失敗時要**畫出訊息**、而且鈕要留著(R1 must-fix 2/3:這條原本零覆蓋)', async () => {
    // 🔴 拿掉 failed 那段畫面,原本 6 格全綠,而 denied/bug/error 時員工看到的是一個
    //    空的虛線框:沒訊息、沒鈕、按了像沒反應。這是本檔最貴的靜默格。
    action.mockResolvedValue({
      status: 'failed',
      code: 'error',
      message: '撤銷沒有完成(系統忙線或連線中斷)。請重新整理這一頁,確認那筆到貨還在不在,再決定要不要重按。',
    });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('撤銷沒有完成');
    // 🔴 文案承諾「再決定要不要重按」⇒ 鈕必須還在。只在 idle 渲染表單的話這句話是空頭支票。
    expect(
      screen.queryByText('撤銷剛剛那筆'),
      '失敗後鈕消失了,而文案叫他「再決定要不要重按」⇒ 承諾一個按不到的動作',
    ).not.toBeNull();
  });

  it('送出中鈕要 disabled(連點會送出第二次撤銷)', async () => {
    action.mockImplementation(() => new Promise(() => {}));
    renderBar();
    click();
    await waitFor(() =>
      expect((screen.getByText('撤銷中…') as HTMLButtonElement).disabled).toBe(true),
    );
  });
});
