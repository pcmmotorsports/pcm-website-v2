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

const { listStaffRows, getSessionActorIdWithSource } = vi.hoisted(() => ({
  listStaffRows: vi.fn(),
  getSessionActorIdWithSource: vi.fn(),
}));

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
// ⟦b4-MGR0-UI⟧ 2026-08-31:三態要在【這一層】被驗 —— 元件層驗不到它。
vi.mock('@/lib/session/actor', () => ({ getSessionActorIdWithSource }));

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

// ── ⟦b4-MGR0-UI⟧ 頁面層三態 ────────────────────────────────────────────
//
// 🔴 **為什麼這一組非在這一層不可**(codex R1 must-fix):
//    元件層驗的是「**收到 canManage='no' 就要停用**」——
//    它證不到「這一頁算得出正確的那一態」。codex 的擊破:刪掉頁面裡算 canManage 那幾行、
//    讓它永遠傳 `unknown` ⇒ 元件層照樣全綠。
//
// 🔴 **而 codex R2 的根因修法讓這一層【變得可測】**:
//    舊的 `getSessionActor()` 出口, `null` 同時代表「沒有具名身分」與「查身分失敗」
//    ⇒ 那兩個世界在頁面收到值之前就是同一個值, **測不出來**。
//    改用 `getSessionActorIdWithSource()`(**一次 DB 都不打**)之後,
//    「DB 出問題」只剩 `listStaffRows()` 一個入口 ⇒ 由 `loadFailed` 承接 ⇒ 落 `unknown`。
describe('⟦b4-MGR0-UI⟧ 這一頁要算得出正確的那一態', () => {
  const MANAGER = { id: 'sean', label: 'Sean', is_manager: true, is_active: true };
  const CLERK = { id: 'staff_2', label: '小明', is_manager: false, is_active: true };
  const RETIRED = { id: 'staff_9', label: '離職', is_manager: true, is_active: false };
  const NO_PERM = '你沒有權限';
  const UNKNOWN_PERM = '暫時無法確認';
  const createButton = (root: HTMLElement) =>
    [...root.querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) =>
      b.textContent?.includes('新增員工'),
    );

  it('啟用中的管理者 ⇒ 可編輯, 而且不顯示那兩句話', async () => {
    listStaffRows.mockResolvedValue([MANAGER, CLERK]);
    getSessionActorIdWithSource.mockResolvedValue({ id: 'sean', source: 'ticket' });
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    expect(createButton(container), '找不到新增鈕 ⇒ 這把尺沒接上').toBeTruthy();
    expect(createButton(container)?.disabled).toBe(false);
    expect(container.textContent).not.toContain(NO_PERM);
    expect(container.textContent).not.toContain(UNKNOWN_PERM);
  });

  it.each([
    ['非管理者', { id: 'staff_2', source: 'ticket' }, [MANAGER, CLERK]],
    // 🔴 codex R1:停用者的 session 還沒過期 ⇒ 他仍會進到這一頁
    ['已停用（即使 is_manager）', { id: 'staff_9', source: 'ticket' }, [MANAGER, RETIRED]],
    // 沒有具名身分的三種來源:共用密碼備援 / 舊票 / 還沒選
    ['共用密碼備援', { id: null, source: 'none' }, [MANAGER, CLERK]],
    ['舊票（旗標已開）', { id: null, source: 'stale-ticket' }, [MANAGER, CLERK]],
    ['自選但還沒選', { id: null, source: 'self-selected' }, [MANAGER, CLERK]],
    // id 有值而不在名單上(帳號被刪掉)
    ['id 不在名單上', { id: 'ghost', source: 'ticket' }, [MANAGER, CLERK]],
  ])('%s ⇒ no ⇒ 停用 +「你沒有權限」', async (_label, actor, rows) => {
    listStaffRows.mockResolvedValue(rows);
    getSessionActorIdWithSource.mockResolvedValue(actor);
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    expect(createButton(container)?.disabled).toBe(true);
    expect(container.textContent).toContain(NO_PERM);
    expect(container.textContent).not.toContain(UNKNOWN_PERM);
  });

  it.each([
    ['名單載入失敗', () => listStaffRows.mockRejectedValue(new Error('db down'))],
    ['讀身分本身炸了', () => {
      listStaffRows.mockResolvedValue([MANAGER, CLERK]);
      getSessionActorIdWithSource.mockRejectedValue(new Error('cookie jar exploded'));
    }],
  ])('🔴 %s ⇒ unknown ⇒ 停用 +「暫時無法確認」(不是「你沒有權限」)', async (_label, setup) => {
    listStaffRows.mockResolvedValue([MANAGER, CLERK]);
    getSessionActorIdWithSource.mockResolvedValue({ id: 'sean', source: 'ticket' });
    setup();
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    expect(createButton(container), '新增表單不見了 ⇒ 這把尺沒接上').toBeTruthy();
    expect(createButton(container)?.disabled).toBe(true);
    expect(
      container.textContent,
      '把「查不出來」講成「你沒有權限」⇒ 真管理者會以為自己被降權',
    ).toContain(UNKNOWN_PERM);
    expect(container.textContent).not.toContain(NO_PERM);
  });
});

// ── ⟦b4-MGR0-UI⟧ 那句話只能出現【一次】(codex R3 must-fix)──────────────────
//
// 🔴 我第一版把文案放進 `StaffProfileForm` ⇒ **N 位員工就 N 段紅字**,
//    而 `StaffTable` 桌機 + 手機雙渲染 ⇒ DOM 裡是 **2N+1 個 `role='status'`**。
//    50 位員工 = 51 段。而當時的測試只驗「至少存在一次」⇒ **完全抓不到**。
// ⇒ 這一格用【多筆】員工去量, 而斷言是【恰好一次】。
describe('⟦b4-MGR0-UI⟧ 權限那句話只印一次', () => {
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `staff_${i}`,
    label: `員工${i}`,
    is_manager: false,
    is_active: true,
  }));

  it.each([
    ['no' as const, '你沒有權限修改員工資料。', { id: 'staff_0', source: 'ticket' }],
    ['unknown' as const, '暫時無法確認你的權限', null],
  ])('canManage=%s ⇒ 6 位員工之下那句話仍然只出現 1 次', async (_mode, text, actor) => {
    if (actor) {
      listStaffRows.mockResolvedValue(many);
      getSessionActorIdWithSource.mockResolvedValue(actor);
    } else {
      listStaffRows.mockRejectedValue(new Error('db down'));
      getSessionActorIdWithSource.mockResolvedValue({ id: 'staff_0', source: 'ticket' });
    }
    const { container } = render(await StaffSettingsPage({ searchParams: noParams }));
    // ⚠️ codex R4 nit:第一版用 `textContent.split(text)` 算 —— 那算的是【子字串】,
    //    另一段合法文案若剛好含這句就會被算成第二份 ⇒ 假紅。
    // ⇒ 改成查【承載它的那個元素】:role='status' 是 live region, 多一個就多念一次。
    const liveRegions = [...container.querySelectorAll('[role="status"]')];
    expect(
      liveRegions.length,
      `role=status 有 ${liveRegions.length} 個 ⇒ 應該只有 1 個（N 位員工 N 段紅字那個病）`,
    ).toBe(1);
    expect(liveRegions[0]?.textContent).toContain(text);
  });
});
