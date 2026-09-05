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

  it('🔴 界線寫在畫面上, 而它要指向【現在真的存在的那條路】', () => {
    // 🔴 沒有這句,他會以為到貨隨時都撤得掉,等真要撤三天前那筆時才發現沒入口。
    //
    // ⛔ ~~原本斷言 `/只能撤掉剛剛這一筆/`~~ ⇒ 2026-09-03 `#450` 蓋了逐筆清單之後,
    //    畫面那句舊話(「更早的到貨紀錄目前還沒有撤銷入口」)**變成假的**。
    // 🔴🔴 **而這一格【全綠】** —— 因為它只認前半句, 而前半句在兩個世界裡都是真的。
    //    ⇒ 📌 codex must-fix 逐字:「測試只斷言含『到貨紀錄』,所以這句反話照樣全綠」。
    //    ⇒ ⇒ **一句話在【做了】與【沒做】兩個世界裡是同一個字串, 它就不是宣稱, 是標籤。**
    // ✅ 修法:斷言那句話**指得出出路**, 而且**逐字擋掉舊的那句反話**。
    renderBar();
    expect(document.body.textContent).toMatch(/只撤得掉剛剛那一筆/);
    // 🎯 出路要在 —— 少了它, 這句話只剩「你不能」, 而他其實可以。
    expect(document.body.textContent).toMatch(/到貨紀錄」清單裡各自撤/);
    // 🛑 負對照:舊的那句反話回來 ⇒ 這一格要紅。
    expect(document.body.textContent).not.toMatch(/還沒有撤銷入口/);
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

  // ⛔ ~~`blocked` 要先告訴他「離開就沒了」~~
  // 🔴🔴 **2026-09-03 這一格翻面了 —— 而翻它的是【那句話的前提被做掉了】, 不是我改期望值。**
  //    `#450` 做完之後:**離開之後撤得掉了**(到貨紀錄列表, 每一筆各自可撤)
  //    ⇒ 「離開就沒了」變成一句假話, 而它會**主動關掉員工的下一個動作**。
  //    🛑 而**這一格原本守的東西沒有消失, 它換了受詞**:
  //       原本守「要先告訴他【入口會消失】」⇒ 現在守「要告訴他【去哪裡撤】」。
  //       兩者是同一條紀律:**DB 那句話把他送走, 而我們要負責他回得來。**
  it('🔴 `blocked` 要告訴他【離開之後去哪裡撤】—— DB 那句話把他送走, 我們要讓他回得來', async () => {
    action.mockResolvedValue({ status: 'blocked', message: P4A03_MESSAGE });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeNull());
    // 🔵 讀 `textContent` 而不是 `getByText` —— 那個 `<p>` 裡有 **多個文字節點**
    //    (DB 訊息 + 分隔 + 這一句),`getByText` 會找不到。這是本檔既有兩格的同一個做法。
    // 🔵 期望值**硬寫字面, 不從元件 import** —— 今天實測過:期望值與被測值同一個常數時,
    //    改文案不會有任何一格紅(那種格子測的是接線, 不是內容)。
    expect(
      screen.getByRole('alert').textContent ?? '',
      '拿掉那句話 ⇒ 員工照 DB 訊息離開這一頁, 而沒有人告訴他回來要去哪裡撤',
    ).toContain('到貨紀錄');
    // 🛑 而**舊的那句不得再出現** —— 它現在是假的(`#450` 之後離開也撤得掉)。
    expect(screen.getByRole('alert').textContent ?? '').not.toContain('只在這一頁有效');
  });

  it('🔵 對照組:`blocked` 以外不印那句話(它只在「他即將被送走」那一刻才成立)', async () => {
    action.mockResolvedValue({ status: 'undone' });
    renderBar();
    click();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeNull());
    expect(document.body.textContent ?? '').not.toContain('這個撤銷入口只在這一頁有效');
  });

  // 🔴🔴 **這一格必須留在本 describe 的【最後】—— 它是承重的順序, 不是排版。**
  //    它設的是一個**永遠不 resolve 的 promise**, 而那個 pending 狀態會活過 `cleanup`
  //    ⇒ **排在它後面的每一格都會停在 pending**、`role='alert'` / `role='status'` 永遠不出現。
  //    🔬 實測(不是推的):我把兩格新測寫在它後面 ⇒ `expected null not to be null` 兩紅;
  //       單獨跑那一格 ⇒ 綠 ⇒ **證明是前一格污染, 不是新測寫錯**。
  //    ⚠️ 而我第一次的修法是在新測裡加 `action.mockReset()` —— **拿掉它複跑, 11 格照樣全綠**
  //       ⇒ 📌 **那個修法從來沒有生效過, 而它「看起來」修好了(因為我同時也調了順序)。**
  //       ⇒ 🎯 兩件事一起改 ⇒ 我以為是 A, 其實是 B。**要知道是哪一個, 只能把 A 拿掉再跑一次。**
  it('送出中鈕要 disabled(連點會送出第二次撤銷)', async () => {
    action.mockImplementation(() => new Promise(() => {}));
    renderBar();
    click();
    await waitFor(() =>
      expect((screen.getByText('撤銷中…') as HTMLButtonElement).disabled).toBe(true),
    );
  });

  // 🔴🔴 `blocked` 那則 DB 原文逐字叫他「要先把那些包裹作廢…才能刪掉」⇒ **它把員工送離這一頁**,
  //    而撤銷入口的鑰匙是 `receipt-record-form.tsx` 的 React state ⇒ 導航/重整就沒了。
  //    ⇒ 📌 **那句話承諾了一個回程, 而系統沒有回程。** 這一格釘的是「畫面有沒有先講」。
  //    🎯 病名見元件那段註解引的 OD FIX-76:**過期/不完整的說明會主動關掉使用者的下一個動作。**
});

// ⟦#450⟧ 2026-09-03:逐筆到貨列表做掉之後, 這一列原本那句話變成【假的】。
//
// ⛔ 舊字面逐字:「這個撤銷入口只在這一頁有效 —— 離開或重新整理之後就沒有了,
//    **到時候要找工程師處理**。」
// 🛑 而它變假之後留著會**比沒有這句話更糟** —— 本檔上方引的 `FIX-76` 逐字:
//    **「過期的說明比沒有說明更糟, 它會主動關掉使用者的下一個動作,
//      而且『他按了沒反應』與『他讀完沒按』在我這邊長得一模一樣」**
// ⇒ 📌 員工讀到「要找工程師」就**不會去試**那件現在做得到的事。
describe('#450 之後:那句過期的話不得再出現', () => {
  it('🔴 畫面上不得再說「到時候要找工程師處理」', () => {
    const { container } = renderBar();
    expect(container.textContent).not.toContain('到時候要找工程師處理');
    expect(container.textContent).not.toContain('只在這一頁有效');
  });

  it('🔵 而要說出【現在真的做得到的那件事】—— 不是只把話刪掉', () => {
    // 🛑 只刪不換 ⇒ 員工仍然不知道離開之後撤得掉 ⇒ 那條路等於沒開。
    const { container } = renderBar();
    expect(container.textContent).toContain('到貨紀錄');
  });
});
