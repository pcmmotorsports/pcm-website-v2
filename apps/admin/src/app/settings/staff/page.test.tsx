// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// ⟦b4-MGR0-COPY2⟧ 2026-08-28 —— 本檔【只補守門,不改任何文案】。
//
// 🔴 **為什麼開這一支**:⟦b4-MGR0⟧ 把 `is_manager` 從「一顆沒有效力的標記」變成「權限」,
//    連帶改了五處文案。其中四處有測試釘著(`components/settings/staff-table.test.tsx`)——
//    改回去會紅。**而這一頁沒有** ⇒ 這一句改回舊講法,**不會有任何東西叫**。
//    📌 一句被改對了的文案, 與一句從來沒有人在守的文案, 在檔案上長得一樣。
//
// ⚠️ 而**本檔不驗這一頁的其他行為**(載入失敗、結果橫幅、名單渲染)——
//    那些是另一片的範圍。**寫下來, 免得有人把這支檔的存在讀成「這頁有覆蓋了」。**

const { listStaffRows } = vi.hoisted(() => ({ listStaffRows: vi.fn() }));

// `staff-repository.ts:1` 有 `import 'server-only'` ⇒ jsdom 直接炸, 必須換掉。
// 形狀同 `app/settings/audit/page.test.tsx:27`。
vi.mock('../../../lib/staff-repository', () => ({ listStaffRows }));
// 🔴 而**光換那一支不夠**:`staff-create-form.tsx:1` import 了 `staff-actions`,
//    而那支是 `'use server'` ⇒ 又一條通往 server-only 的路。
//    症狀是「This module cannot be imported from a Client Component module」+ **零測試被收集**,
//    ⇒ 📌 而「零收集」在總計行上印的是 `Tests no tests`, **不是紅的格子** —— 差點被讀成沒事。
//    形狀同 `components/settings/staff-table.test.tsx:5`。
vi.mock('../../../lib/staff-actions', () => ({
  createStaffAction: vi.fn(),
  updateStaffProfileAction: vi.fn(),
  setStaffActiveAction: vi.fn(),
}));

import StaffSettingsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const noParams = Promise.resolve({});

describe('⟦b4-MGR0-COPY2⟧ 這一頁的說明必須說出「這是授權」', () => {
  // 🔴🔴 **認人的錨為什麼挑這一半**(這一格今早踩過一次, 所以寫下來):
  //
  //   整句是「新增員工、改顯示名、授予或收回管理者權限,或停用不再使用的員工。
  //          代碼建立後不可修改。」
  //
  //   · 挑「代碼建立後不可修改」⇒ 它很穩、幾乎不會變 —— **而它守不到任何我在意的事**。
  //     那一句在「文案被改軟成標記」的世界裡【原封不動】⇒ 那把尺看不到那個世界。
  //   · 挑「授予或收回管理者權限」⇒ 它正是**承重的那一半**:
  //     它是這句話裡唯一在說「這是授權, 不是分類標記」的部分。
  //     ⇒ 有人把它改回「管理者標記」「尚未生效」那一族 ⇒ **本格當場紅**, 而那正是本檔的職能。
  //
  //   📌 一個穩定的錨與一個有判別力的錨是兩件事 —— 而【穩定】會讓人以為它比較可靠。
  //   ⚠️ 這個錨的代價明寫:日後若有人【正當地】重寫這句(例如換成更白話的講法),
  //      本格會紅。那不是誤報 —— 那是它在要求「改文案的人回來看一眼這個錨還對不對」。
  const AUTHORIZATION_HALF = '授予或收回管理者權限';

  // 🔴🔴 **而【只比對整頁 textContent 是不夠的】—— 這一格是跑突變才發現的(2026-08-28)。**
  //   我第一版寫 `expect(container.textContent).toContain(AUTHORIZATION_HALF)`,
  //   然後把**這一頁自己那句**改軟成「改顯示名與管理者標記」⇒ **測試照樣全綠。**
  //   成因:`staff-create-form` 勾選框旁那句 hint **也含同一半句** ⇒ 整頁 textContent 仍然命中。
  //   📌 **我要守的是【這一頁自己那句】, 而我的尺量的是【整棵樹裡有沒有人講過這句話】。**
  //     那兩個在綠的時候長得一模一樣, 而只有突變分得開。
  //   ⇒ 改成先鎖定【這一頁自己那個 <p>】再比對。
  //     鎖定用的錨是「代碼建立後不可修改」—— 它只出現在頁面說明那一句裡, 而**它不承重**
  //     (承重的是 AUTHORIZATION_HALF)⇒ 兩個錨各司其職:一個認位置, 一個認意思。
  const PAGE_DESC_ANCHOR = '代碼建立後不可修改';

  const pageDescription = (root: HTMLElement): string => {
    const hit = Array.from(root.querySelectorAll('p')).filter((el) =>
      (el.textContent ?? '').includes(PAGE_DESC_ANCHOR),
    );
    expect(hit.length, '找不到頁面說明那一段(認位置的錨不見了)⇒ 本檔所有斷言作廢').toBe(1);
    return hit[0]?.textContent ?? '';
  };

  it('🔴 頁面說明含「授予或收回管理者權限」—— 它是在說授權,不是在說標記', async () => {
    listStaffRows.mockResolvedValue([]);
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    expect(
      pageDescription(container),
      '這一句被改軟回「標記」那一族了 —— 而 is_manager 現在是真的權限(⟦b4-MGR0⟧)',
    ).toContain(AUTHORIZATION_HALF);
  });

  it('🔴 而它是【可見文字】,不是 title / aria-label(屬性裡的字截圖與 DOM 都當它不存在)', async () => {
    // 上面那格用 `textContent` ⇒ 它讀不到屬性, 所以把說明搬進 `title=` 那格本來就會紅。
    // 本格多守的是**位置**:那句話要活在一個 `<p>` 裡(有人為了版面把它塞進
    // `aria-label` 又留一份看不見的殘影時, 上面那格分不出來)。
    //
    // ⚠️ **這裡是 `≥ 1` 不是 `=== 1`, 而那是量出來的**(2026-08-28 實跑 ⇒ 2):
    //    這一頁的說明 + `staff-create-form` 勾選框旁那句, 兩處都含這半句 —— 兩處都該在。
    //    ⇒ 寫死 `=== 1` 會讓「有人正當地多加一處說明」變成紅的, 而那不是本檔要防的事。
    listStaffRows.mockResolvedValue([]);
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    const visible = Array.from(container.querySelectorAll('p'))
      .map((el) => el.textContent ?? '')
      .filter((t) => t.includes(AUTHORIZATION_HALF));
    expect(
      visible.length,
      '那句話不在任何一個 <p> 裡 ⇒ 它可能被搬進屬性了',
    ).toBeGreaterThanOrEqual(1);
  });

  it('🔴 名單載入失敗時那句說明【仍然要在】(它講的是這頁能做什麼,不是資料)', async () => {
    // 少了這一格,把說明搬進「載入成功」的分支裡也會全綠 ——
    // 而失敗那一刻正是操作者最需要知道「這頁是拿來授權的」的時候。
    listStaffRows.mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    spy.mockRestore();
    expect(pageDescription(container)).toContain(AUTHORIZATION_HALF);
  });
});
