// @vitest-environment jsdom
// order-detail-tabs.test.tsx — `OrderDetailTabs` 的四個行為守門(must-fix 3,審查 2026-08-23 抓)。
//
// 🔴🔴 **這支檔為什麼在審查之後才出現,是本片最該記的一格。**
//    交件時我寫「我一格測試都沒改」—— **那句是真的,而它把另一件事蓋掉了**:
//    新檔 313 行、**零測試**。
//    ```
//    grep -rl 'OrderDetailTabs|order-detail-tabs' --include='*.test.tsx' ⇒ 0
//    對照組 同尺量 OrderSummaryCards                                     ⇒ 4
//    ```
//    ⇒ 判別句:**「我沒有動既有的驗證」與「我為新東西留了驗證」是兩件事,而只有前者會被我主動講。**
//    📌 而 must-fix 1(缺 `key`)與 must-fix 2(對帳異常警告被藏)**就是這樣活下來的** ——
//       四個行為零守門,所以它們錯了也沒有東西會紅。
//
// ⚠️ **本檔守的是【這支元件自己的四個行為】,不是「訂單面板對不對」**:
//    分頁內容是呼叫端傳進來的 `ReactNode`,本檔一律餵可辨認的假節點。
//    真畫面(400px 破不破版 / 展開後 Cmd+F 找不找得到)**要真瀏覽器**,本檔答不了 —— 見交件檔 §9。

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { OrderDetailTabs, type OrderDetailTabSpec } from './order-detail-tabs';

const TABS: OrderDetailTabSpec[] = [
  { key: 'items', label: '商品 · 出貨', content: <p>ITEMS_BODY</p> },
  { key: 'money', label: '收款 · 退款', hashes: ['cancel'], content: <p>MONEY_BODY</p> },
  { key: 'customer', label: '客戶 · 發票', content: <p>CUSTOMER_BODY</p> },
  { key: 'notes', label: '備註', badge: 5, content: <p>NOTES_BODY</p> },
];

/**
 * 🔴 **量的是 `hidden`,不是 `textContent`。**
 * 四頁**永遠都在 DOM 裡**(那是刻意的,見元件檔頭)⇒ `textContent` 在四種狀態下**印一樣的東西**
 * ⇒ 拿它當量具會恆綠。**這一格若改用文字比對,整支檔會失去判別力。**
 */
function visiblePanels(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section[data-od-panel]')]
    .filter((el) => !(el as HTMLElement).hidden)
    .map((el) => el.getAttribute('data-od-panel') ?? '');
}

function renderTabs(props: Partial<Parameters<typeof OrderDetailTabs>[0]> = {}) {
  return render(<OrderDetailTabs header={<h1>HEADER</h1>} tabs={TABS} {...props} />);
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('OrderDetailTabs — 分頁(FIX-07)', () => {
  it('🔴 一次只有一頁不是 hidden;四頁【全部】都在 DOM 裡', () => {
    const { container } = renderTabs();
    expect(visiblePanels(container)).toEqual(['items']);
    // 正向對照:四頁真的都渲染了 —— 少了它,上面那條在「只渲染一頁」時也會綠。
    expect(container.querySelectorAll('section[data-od-panel]')).toHaveLength(4);
  });

  it('🔴 點分頁 ⇒ 換那一頁露出來(負對照:原本那頁要收回去)', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.click(getByRole('tab', { name: /收款/ }));
    expect(visiblePanels(container)).toEqual(['money']);
    // 🔴 負對照:沒有它,一個「點了就全部露出來」的壞版本照樣綠。
    expect(visiblePanels(container)).not.toContain('items');
  });

  it('🔴 `initialKey` 決定開場停在哪一頁(must-fix 2 靠這條)', () => {
    const { container } = renderTabs({ initialKey: 'money' });
    expect(visiblePanels(container)).toEqual(['money']);
  });

  it('🔴 `initialKey` 給一個不存在的 key ⇒ 退回第一頁,不是空白', () => {
    const { container } = renderTabs({ initialKey: 'zzz-not-a-tab' });
    expect(visiblePanels(container)).toEqual(['items']);
  });
});

describe('OrderDetailTabs — 全部展開逃生口(FIX-17)', () => {
  it('🔴🔴 按「全部展開」⇒ 四頁【全部】不再 hidden —— 這是分頁方案成立的前提', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.click(getByRole('button', { name: '全部展開' }));
    expect(visiblePanels(container)).toEqual(['items', 'money', 'customer', 'notes']);
  });

  it('🔴 再按一次 ⇒ 收回,只剩剛才那一頁(負對照:展開不是單向)', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.click(getByRole('button', { name: '全部展開' }));
    fireEvent.click(getByRole('button', { name: '收回分頁' }));
    expect(visiblePanels(container)).toEqual(['items']);
  });

  it('🔴 展開中點任一分頁 ⇒ 退出展開模式並停在那一頁(OD FIX-17 逐字)', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.click(getByRole('button', { name: '全部展開' }));
    fireEvent.click(getByRole('tab', { name: /客戶/ }));
    expect(visiblePanels(container)).toEqual(['customer']);
  });
});

describe('OrderDetailTabs — hash 深連結(承重:列表那兩條 `#cancel`)', () => {
  it('🔴🔴 掛載時 `#cancel` ⇒ 停在認領它的那一頁,不是第一頁', () => {
    window.location.hash = '#cancel';
    const { container } = renderTabs();
    expect(visiblePanels(container)).toEqual(['money']);
  });

  it('🔴 `hashchange` ⇒ 切過去(同一張單內按下另一條 #cancel)', () => {
    const { container } = renderTabs();
    expect(visiblePanels(container)).toEqual(['items']);
    window.location.hash = '#cancel';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(visiblePanels(container)).toEqual(['money']);
  });

  it('🔴 沒有人認領的 hash ⇒ 不動(負對照:不是「有 hash 就跳」)', () => {
    window.location.hash = '#somewhere-else';
    const { container } = renderTabs();
    expect(visiblePanels(container)).toEqual(['items']);
  });
});

describe('OrderDetailTabs — 徽章(FIX-44②)', () => {
  it('🔴 `badge` > 0 ⇒ 畫出數字 + 給讀螢幕的人的那一句', () => {
    const { getByRole } = renderTabs();
    expect(getByRole('tab', { name: /備註/ }).textContent).toContain('5');
    expect(getByRole('tab', { name: /備註/ }).textContent).toContain('有 5 筆備註');
  });

  /* 🔴 **R2 N3(審查抓):我這一格原本的【標題比判別句寬】。**
     舊標題寫「元素**根本不存在**」,而斷言只驗 `textContent` 不含「筆備註」
     ⇒ **一個「數字 span 還畫著、只掉了 sr-only」的壞版本照樣綠**;
       而標題裡的「/ 未給」那一半**根本沒有任何一格在跑**。
     📌 判別句:**標題描述的集合,要與斷言掃的集合一樣大** —— 標題寬出去的那部分,
        會被下一個人讀成「這件事有人守著」。⇒ 現在兩件事各一格、各自驗 DOM 節點數。 */
  it('🔴🔴 `badge` 為 0 ⇒ 徽章與 sr-only **兩個節點都不存在**(OD 逐字「不是隱藏」)', () => {
    cleanup();
    const zero = TABS.map((t) => (t.key === 'notes' ? { ...t, badge: 0 } : t));
    const { getByRole } = render(<OrderDetailTabs header={<h1>H</h1>} tabs={zero} />);
    const tab = getByRole('tab', { name: /備註/ });
    // 正向對照:那顆分頁鈕真的渲染了(否則下面兩條在「整個鈕不見」時也會綠)。
    expect(tab.textContent).toContain('備註');
    expect(tab.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    expect(tab.querySelectorAll('span.sr-only')).toHaveLength(0);
  });

  it('🔴 `badge` **未給**(undefined)⇒ 同樣兩個節點都不存在(舊標題寫了而沒有人在跑的那一半)', () => {
    cleanup();
    const none = TABS.map((t) => (t.key === 'notes' ? { key: t.key, label: t.label, content: t.content } : t));
    const { getByRole } = render(<OrderDetailTabs header={<h1>H</h1>} tabs={none} />);
    const tab = getByRole('tab', { name: /備註/ });
    expect(tab.textContent).toContain('備註');
    expect(tab.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    expect(tab.querySelectorAll('span.sr-only')).toHaveLength(0);
  });

  it('🔴 負對照:`badge` > 0 時那兩個節點【真的都在】—— 否則上面兩格恆綠', () => {
    const { getByRole } = renderTabs();
    const tab = getByRole('tab', { name: /備註/ });
    expect(tab.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1);
    expect(tab.querySelectorAll('span.sr-only')).toHaveLength(1);
  });
});

describe('OrderDetailTabs — 鍵盤(codex 關卡2 2026-08-24 nit:role=tab 要配鍵盤)', () => {
  it('🔴 ArrowRight ⇒ 切到下一頁,且焦點跟著到那顆 tab', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' });
    expect(visiblePanels(container)).toEqual(['money']);
    expect(document.activeElement).toBe(getByRole('tab', { name: /收款/ }));
  });

  it('🔴 ArrowLeft 在第一頁 ⇒ 繞到最後一頁(不是卡住)', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowLeft' });
    expect(visiblePanels(container)).toEqual(['notes']);
  });

  it('🔴 Home / End ⇒ 兩端', () => {
    const { container, getByRole } = renderTabs({ initialKey: 'customer' });
    fireEvent.keyDown(getByRole('tablist'), { key: 'End' });
    expect(visiblePanels(container)).toEqual(['notes']);
    fireEvent.keyDown(getByRole('tablist'), { key: 'Home' });
    expect(visiblePanels(container)).toEqual(['items']);
  });

  it('🔴 roving tabindex:恰有一顆 tab 的 tabIndex=0,而且是現用那顆;切頁後跟著走', () => {
    const { container, getByRole } = renderTabs();
    const zeros = () =>
      [...container.querySelectorAll('[role="tab"]')].filter(
        (t) => t.getAttribute('tabindex') === '0',
      );
    expect(zeros()).toHaveLength(1);
    expect(zeros()[0]).toBe(getByRole('tab', { name: /商品/ }));
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' });
    expect(zeros()).toHaveLength(1); // 負對照:不是「切了之後兩顆都 0」
    expect(zeros()[0]).toBe(getByRole('tab', { name: /收款/ }));
  });

  it('🔴 展開模式中按方向鍵 ⇒ 退出展開、停在目標頁(與點擊同款,FIX-17 不分輸入裝置)', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.click(getByRole('button', { name: '全部展開' }));
    fireEvent.keyDown(getByRole('tablist'), { key: 'ArrowRight' });
    expect(visiblePanels(container)).toEqual(['money']);
  });

  it('🔴 負對照:不相干的鍵(a / Enter)不切頁 —— 否則上面那幾格量不出「是方向鍵在管」', () => {
    const { container, getByRole } = renderTabs();
    fireEvent.keyDown(getByRole('tablist'), { key: 'a' });
    fireEvent.keyDown(getByRole('tablist'), { key: 'Enter' });
    expect(visiblePanels(container)).toEqual(['items']);
  });
});

describe('OrderDetailTabs — a11y 的最低限', () => {
  it('🔴 每顆 tab 的 `aria-controls` 指得到一個真的存在的 tabpanel', () => {
    const { container } = renderTabs();
    const tabs = [...container.querySelectorAll('[role="tab"]')];
    expect(tabs).toHaveLength(4); // 正向對照
    // 🔴 用 `getElementById` 不用 `querySelector('#id')`:`useId()` 產生的 id 帶 `:`
    //    ⇒ 當成 CSS 選擇器要跳脫,而**這個 jsdom 沒有 `CSS.escape`**(第一版就是這樣紅的,
    //    而紅的原因是量具壞了、不是元件壞了)。`getElementById` 不解析選擇器,沒有這個問題。
    for (const t of tabs) {
      const id = t.getAttribute('aria-controls') ?? '';
      const panel = container.ownerDocument.getElementById(id);
      expect(panel, `aria-controls="${id}" 指不到任何節點`).not.toBeNull();
      expect(panel!.getAttribute('role')).toBe('tabpanel');
    }
  });

  it('🔴 sticky 掛鉤 `data-od-id="panel-header"` 在,且【包住分頁列】', () => {
    // 🔴 這一格守的是「線A 的 globals.css 選得到、而且選到的範圍對」——
    //    只包抬頭 ⇒ 捲下去看得到單號卻沒有分頁可按(理由見元件檔頭)。
    const { container } = renderTabs();
    const head = container.querySelector('[data-od-id="panel-header"]');
    expect(head).not.toBeNull();
    expect(head!.querySelector('[role="tablist"]')).not.toBeNull();
  });
});
