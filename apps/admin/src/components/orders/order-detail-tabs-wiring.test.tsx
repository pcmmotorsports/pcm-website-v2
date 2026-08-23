// @vitest-environment jsdom
// order-detail-tabs-wiring.test.tsx — `OrderDetail` 把哪些東西接進 `OrderDetailTabs`(must-fix 1/2)。
//
// 🔴🔴 **這支檔守的兩件事,是審查 2026-08-23 抓到的兩條 must-fix,而它們【都在本檔存在之前活著】。**
//    `order-detail-tabs.test.tsx` 守的是**元件自己的行為**(給它 `initialKey` 它會不會照做);
//    **本檔守的是【呼叫端有沒有把對的東西餵給它】** —— 那是另一件事,而 must-fix 1/2 死在這一格。
//    📌 判別句:**元件測綠 ≠ 接線對**。一個永遠收到 `'items'` 的元件,它自己的測試會全綠。
//
// ⚠️ 子元件全部 mock 成 null(照 `order-detail-header.test.tsx` 的既有做法與理由)——
//    本檔的斷言一個字都沒讀那些子樹,而不 mock 它們會去拉 server action / `server-only`。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrderDetail } from '@pcm/domain';

import { stripComments } from '../../lib/test-support/strip-comments';

import { OrderDetail } from './order-detail';

vi.mock('server-only', () => ({}));
vi.mock('./order-detail-summary-cards', () => ({
  OrderFocalRow: () => null,
  OrderInfoCards: () => null,
}));
vi.mock('./notes-timeline', () => ({ NotesTimeline: () => null }));
vi.mock('./note-compose-form', () => ({ NoteComposeForm: () => null }));
vi.mock('./order-edit-form', () => ({ OrderEditForm: () => null }));
vi.mock('./order-detail-items-table', () => ({ ItemsTable: () => null }));
vi.mock('./payment-section', () => ({ PaymentSection: () => null }));
vi.mock('./shipment-section', () => ({ ShipmentSection: () => null }));
// 🔴🔴 **R3 MF-1:這一支【不能】mock 成 `() => null`,而理由是量出來的。**
//    `OrderCancelBlock`(`order-detail-money-tab.tsx` 搜 `<OrderCancelBlock`;2026-08-24 拆檔片
//    隨 money content 搬檔)是 `id='cancel'` 的**唯一來源**。
//    mock 成 null ⇒ 下面那格守的其實是「**money 這一頁露出來了**」,**不是「連過去看得到取消區」**。
//    🔴 失敗情境(R3 給的):把 `OrderCancelBlock` 搬到別的分頁
//       ⇒ `#cancel` 仍然開 money、而 money 裡沒有取消區 ⇒ **R1 那條 must-fix 原封回來,而 25 格全綠。**
//    ⇒ 換成一個**帶 `id='cancel'` 的替身**,斷言就能問「那個 id 落在【未 hidden 的那一頁】裡嗎」。
//    📌 這是「元件測綠 ≠ 接線對」的第三種形狀:**替身把被測的那條線本身抹掉了。**
vi.mock('./order-cancel-block', () => ({ OrderCancelBlock: () => <div id='cancel' /> }));
vi.mock('./refund-ledger-section', () => ({ RefundLedgerSection: () => null }));
vi.mock('./refund-section', () => ({ RefundSection: () => null }));

// 🔴 用 `fileURLToPath` 不用 `new URL(..., import.meta.url)` 直接餵 `readFileSync`:
//    在 jsdom 環境下 `import.meta.url` 不是 file: scheme ⇒ `The URL must be of scheme file`。
//    (`order-detail-print-entry.test.ts` 那支可以那樣寫,是因為它跑在 node 環境。)
const DIR = dirname(fileURLToPath(import.meta.url));
/**
 * 🔴🔴 **`stripComments` 是【承重的】,而我是被自己的突變測試打回來才知道。**
 *
 * 第一版沒有剝註解 ⇒ 我把 `key={detail.id}` 拿掉,**這一格照樣綠** —— 因為它量到的是
 * 上方那段註解裡引用的 `` `key={detail.id}` ``(那段在解釋 `DangerZoneDetails` 也有一顆),
 * **不是真的那一行碼**。⇒ **一個恆真的守門,而它長得跟一個很嚴謹的守門一模一樣。**
 * 📌 判別句:**原始碼字面守門若不剝註解,它守的是「有沒有人提過這件事」,不是「有沒有人做這件事」。**
 * ⇒ 下面 `describe` 底下那兩發突變(拿掉 `key` / 拿掉 `refundLedgerAbnormal` 那一支)是驗收條件,
 *   **改動這一段之後要重跑它們**,不要只看綠。
 */
const SRC = stripComments(readFileSync(resolve(DIR, 'order-detail.tsx'), 'utf8'));

const DETAIL = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'ABC123',
  createdAt: '2026-08-10T02:00:00+00:00',
  paymentStatus: 'partiallyPaid',
  invoiceStatus: 'not_issued',
  cancelledAt: null,
  customer: { name: '沈佑霖', phone: null, email: null },
  customerUserId: null,
  total: { amount: 23800, currency: 'TWD' },
  items: [],
  notes: [],
} as unknown as AdminOrderDetail;

const OK = { status: 'ok', rows: [] } as never;

function visible(container: HTMLElement): string[] {
  return [...container.querySelectorAll('section[data-od-panel]')]
    .filter((el) => !(el as HTMLElement).hidden)
    .map((el) => el.getAttribute('data-od-panel') ?? '');
}

afterEach(cleanup);

describe('🔴 must-fix 2:對帳異常時,開單就要落在「收款 · 退款」那一頁', () => {
  // 本檔自己的判準來源:`order-detail.tsx` 搜 `退化成沉默` ——
  // 「那類警告存在的唯一理由就是要員工看到它」。分頁把它藏起來 = 同一個病換了載體。
  it('🔴 帳本讀不到(`refundsFailed`)⇒ 停在 money', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} refundsFailed />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  it('🔴 未登記額為負 ⇒ 同樣停在 money', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={OK}
        refundUnregisteredAmount={-100}
      />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  // 🔴🔴 **負對照:沒有它,一個「永遠停在 money」的壞版本照樣綠。**
  it('🔴 正常單 ⇒ 停在 items,不是 money', () => {
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    expect(visible(container)).toEqual(['items']);
  });

  // 🔴 順序守門:`?correct=` 是員工點連結表達的明確意圖 ⇒ 它贏過對帳異常。
  //    這一格釘的是【那個取捨本身】,不是「哪個比較重要」—— 改順序就要有人重新想一次。
  it('🔴 `?correct=` 與對帳異常同時成立 ⇒ 停在 notes(明確意圖優先),而這是已知殘餘', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={OK}
        refundsFailed
        correctNoteId='22222222-2222-4222-8222-222222222222'
      />,
    );
    expect(visible(container)).toEqual(['notes']);
  });
});

describe('🔴 R2 MF-A:`hashes: [\'cancel\']` —— 列表那兩條 `#cancel` 深連結的目的地', () => {
  /* 🔴🔴 **這一格補的不只是「少一條測試」,是【一條既有的跨檔守門變成假綠】。**
     `orders-table.test.tsx:1793` 那條契約守的是「`#cancel` 的 href ↔ `order-cancel-block` 的 `id='cancel'`」。
     **分頁化之後,「id 存在」不再等於「連得到」** —— 那個 id 現在住在一個 `hidden` 的 tabpanel 裡。
     ⇒ **那一格在兩個世界印同一句話。** 而它是**綠的**,所以沒有人會去看它。
     📌 判別句:**守門還在,而它守的那件事已經換了意思** —— 這比「守門被刪掉」危險,因為綠的。
     ⚠️ **本格不取代那一格**:那條守 href 與 id 對得上,本格守「連過去之後看得到」。兩件事。 */
  afterEach(() => {
    window.location.hash = '';
  });

  it('🔴 網址帶 `#cancel` ⇒ 開單就停在 money(取消區住在那一頁)', () => {
    window.location.hash = '#cancel';
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    expect(visible(container)).toEqual(['money']);
  });

  it('🔴🔴 R3 MF-1:`#cancel` 那個 id **真的落在露出來的那一頁裡**(不是只有分頁對)', () => {
    window.location.hash = '#cancel';
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    const shown = [...container.querySelectorAll('section[data-od-panel]')].filter(
      (el) => !(el as HTMLElement).hidden,
    );
    expect(shown).toHaveLength(1); // 正向對照:真的只有一頁露出來
    expect(shown[0]!.querySelector('#cancel'), '#cancel 不在露出來的那一頁裡').not.toBeNull();
  });

  it('🔴 負對照:`#cancel` 在【收起來的】那幾頁裡找不到 —— 否則上一格恆綠', () => {
    window.location.hash = '#cancel';
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    const hiddenPanels = [...container.querySelectorAll('section[data-od-panel]')].filter(
      (el) => (el as HTMLElement).hidden,
    );
    expect(hiddenPanels).toHaveLength(3); // 正向對照:真的有三頁收著
    for (const el of hiddenPanels) expect(el.querySelector('#cancel')).toBeNull();
  });

  it('🔴 負對照:沒有 hash 的同一張單 ⇒ 停在 items(不是「永遠 money」)', () => {
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    expect(visible(container)).toEqual(['items']);
  });

  it('🔴 `hashes` 那一格真的被宣告了 —— 刪掉它,上面那條就會紅', () => {
    // ⚠️ 這是原始碼字面守門(已剝註解,理由見 SRC 那段);它擋「有人把宣告刪掉」,
    //    而**行為層那條在同一個 describe 裡** ⇒ 兩層都在,不靠其中一層單獨背書。
    expect(SRC).toContain("hashes: ['cancel']");
  });
});

describe('🔴🔴 R3 MF-2:四個 `data-od-panel` 是【跨三個檔的 CSS 契約】', () => {
  /* 🔴 **這條契約的三端(我自己各查一次,2026-08-23 22:4x)**:
     ```
     order-detail.tsx:807   key: 'customer'            ← 值的來源
     tabs.tsx:294           data-od-panel={tab.key}     ← 值變成 DOM 屬性
     globals.css:2268-2271  [data-od-panel] 四條(FIX-18 窄面板表格橫捲)
     globals.css:2278-2284  [data-od-panel="customer"] 四條
                            其中 .grid>*{grid-column:auto/span 1!important} = FIX-46① 客戶頁爆版的修法
     ```
     🔴 **把 `'customer'` 改成 `'info'` ⇒ 那幾條 CSS 全部落空、客戶頁重新爆版,而【零紅】。**
     🔴🔴 **而兩端的測試都測不到**:`order-detail-tabs.test.tsx` 用它**自己的 `TABS` fixture**
        ⇒ **測試扮演了呼叫端** ⇒ 它永遠不會發現生產端的 key 被改了。
        📌 這是「元件測綠 ≠ 接線對」的第二種形狀:**測試自己扮演呼叫端。**
     ⚠️ **本格擋不到的那一半,明講**:它守「我方四個值沒被改」,
        **守不到「`globals.css` 那邊的選擇器被改了」** —— 那支檔不歸本條線,而契約是雙向的。
        ⇒ CSS 那一端的守門要由 L1 樣式線立。**已寫進給線A 的需求清單。** */
  it('🔴 生產端渲染出來的四個 `data-od-panel` 逐字且依序', () => {
    const { container } = render(<OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} />);
    const keys = [...container.querySelectorAll('section[data-od-panel]')].map((el) =>
      el.getAttribute('data-od-panel'),
    );
    expect(keys).toEqual(['items', 'money', 'customer', 'notes']);
  });
});

describe('🔴 codex 關卡2(2026-08-24)MF-1/MF-2:money 頁的必看警示,一條都不准漏接 initialKey', () => {
  /* 🔴 這一族的來歷:codex 對抗審查抓到「`*Failed` 有接、`*Truncated` 沒接」——
     那不是漏兩個變數,是「哪些情況要自動開哪一頁」那張表是【想出來的】不是【數出來的】。
     ⇒ 分母(逐 prop 過 `OrderDetail` 的介面、逐個開消費元件看渲染)寫在
       `order-detail-tab-routing.ts` 的 `moneyTabMustSee` 那段(2026-08-24 拆檔片抽檔),本族一格一列。
     ⚠️ codex 的 runner 被唯讀 sandbox 擋下 ⇒ 四條全是靜態推理;本族就是「真 runner 覆一次」本身:
       加入當下(未改 production code)四格全紅 = 兩條 must-fix 屬實,不撤回。 */
  // 🔴 codex R2(拆檔片,2026-08-24)must-fix:分母表的每一個旗標要【各自】有一格 ——
  //    「整體改恆定值」的突變只證明有人在用那顆函式,證明不了每一格都接上了。
  //    下面兩格補上分母表裡原本沒有獨立格的那兩個 `*Failed`;逐分支刪除突變的紀錄在交件檔。
  it('🔴 未登記額讀取失敗(`refundUnregisteredFailed`)⇒ 停在 money', () => {
    const { container } = render(
      <OrderDetail
        refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={OK}
        refundUnregisteredFailed
      />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  it('🔴 非卡退款登記讀取失敗(`manualRefundsFailed`)⇒ 停在 money', () => {
    const { container } = render(
      <OrderDetail
        refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={OK}
        manualRefundsFailed
      />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  it('🔴 MF-1:收款讀取失敗(`unreadable`)⇒ 開單停在 money(「勿再登錄」紅字在那一頁)', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={{ status: 'unreadable' } as never}
      />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  it('🔴 MF-1:查不到訂單(`order_not_found`)⇒ 同樣停在 money(收款狀況不明,同「不知道有沒有」)', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false}
        detail={DETAIL}
        returnTo='/orders'
        payments={{ status: 'order_not_found' } as never}
      />,
    );
    expect(visible(container)).toEqual(['money']);
  });

  // 🔴 MF-2 的斷言是【兩層】:截斷紅區住在「退款」那顆收合塊【裡面】——
  //    只開對分頁、塊還收著,紅字一樣看不到 ⇒ 分頁 + defaultOpen 都要驗。
  it('🔴 MF-2:退款帳本截斷 ⇒ 停在 money 且「退款」那塊自己打開', () => {
    const { container } = render(
      <OrderDetail detail={DETAIL} returnTo='/orders' payments={OK} refundsTruncated />,
    );
    expect(visible(container)).toEqual(['money']);
    const refundBlock = [...container.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.includes('退款'),
    );
    expect(refundBlock, '找不到「退款」收合塊').toBeDefined();
    expect(refundBlock!.open).toBe(true);
  });

  it('🔴 MF-2:非卡退款登記截斷 ⇒ 同上兩層', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} manualRefundsTruncated />,
    );
    expect(visible(container)).toEqual(['money']);
    const refundBlock = [...container.querySelectorAll('details')].find((d) =>
      d.querySelector('summary')?.textContent?.includes('退款'),
    );
    expect(refundBlock!.open).toBe(true);
  });

  // 🔴 負對照:分母裡【刻意不接】的那格 —— suppliersFailed 的警示住在 items(預設頁),
  //    接了反而把人送離警示。它同時擋「乾脆全部 flag 都開 money」那種假修法。
  it('🔴 負對照:`suppliersFailed` ⇒ 仍停在 items(那面警示就在 items 頁)', () => {
    const { container } = render(
      <OrderDetail refundsTruncated={false} detail={DETAIL} returnTo='/orders' payments={OK} suppliersFailed />,
    );
    expect(visible(container)).toEqual(['items']);
  });
});

describe('🔴 must-fix 1:`OrderDetailTabs` 必須帶 `key={detail.id}`', () => {
  // ⚠️ **這一格是【原始碼層】守門,而那是刻意的**:React 的 `key` 不進 DOM、也不進 props
  //    ⇒ 渲染出來的東西看不到它。要行為層驗它,得在同一棵樹上換單重繪並觀察 effect 有沒有重跑,
  //    而那需要 client-side 導航的替身 —— 成本遠高於它擋的東西。
  //    🔴 **射程講白**:它擋「有人把這行刪掉」,**擋不到**「key 綁錯欄位」。
  it('🔴 那一行在,而且綁的是 `detail.id`', () => {
    const i = SRC.indexOf('<OrderDetailTabs');
    expect(i).toBeGreaterThan(-1); // 正向對照:真的抓到那個元素
    const head = SRC.slice(i, SRC.indexOf('tabs={[', i));
    expect(head).toContain('key={detail.id}');
  });

  it('🔴 負對照:這把尺讀得到本檔內容(否則上面那條在空字串上也會綠)', () => {
    expect(SRC.length).toBeGreaterThan(1000);
    expect(SRC).not.toContain('zzz-not-a-real-token');
  });
});
