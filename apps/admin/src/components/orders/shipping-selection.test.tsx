// @vitest-environment jsdom
// shipping-selection.test.tsx — 勾品項 island + 批次列的守門(片 2b-1 → B9 2026-09-14 改品項層)。
//
// 🔴 **三條驗收字面**(主視窗 D-353-A / D-355-A 明列,不是我自己加的;B9 只把「訂單層」換成「品項層」):
//   ① 勾選欄只有一份 markup、掛在品項列(每一列一個框)。
//   ② island **只收 `orderId` / `itemId` 兩個純量**;`AdminOrderSummary` / `AdminOrderLine` 整包不得進 client props。
//   ③ `orders-table.tsx` 那句「零 client 邊界」註解必須同 commit 更正,不留謊話。
//
// ⚠️ **它擋不住什麼**:jsdom 不是真瀏覽器,量不到「disabled 的框在手機上長什麼樣」;
//    也證不了 RSC payload 裡真的沒有金額 —— ② 守的是**原始碼層的形狀**(props 只有兩個純量),
//    真 payload 要看瀏覽器 network 面板。這個缺口是明說的。

import { afterEach, describe, expect, it, vi} from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ShippingSelectionProvider,
  BatchActionBar,
  OrderItemCheckbox,
  distinctOrderIds,
  nextSelection,
} from './shipping-selection';
import { NEXT_MULTI_MAX } from '../../lib/orders/order-return-to';

// 🔴 `server-only` 在**本檔**換成空替身 —— **不是放寬護欄,而且刻意不做成全域 alias。**
//    真的 `server-only` 被 client 模組載入時會丟錯,那正是我們要的
//    (`shipment-candidates.ts` 帶著它,誰把訂單明細拉進 client bundle 就建置失敗)。
//    但 vitest 沒有 server/client 之分、會天真地走完整個 import 圖:
//      client 元件 → `shipment-actions.ts`('use server')→ `shipment-candidates.ts`('server-only')→ 丟錯。
//    真實 Next 下這條路**不存在**('use server' 模組在 client 側是引用樁)。
//    ⚠️ **為什麼不做全域 alias**:`apps/storefront/src/lib/brand-products.test.ts:223` 有一條測試
//    **刻意依賴 server-only 真的丟錯**來證明 mock 清乾淨了(斷言字面就是那句錯誤訊息)。
//    全域替身會把那條的驗證機制整個拆掉 —— 實測會讓它從綠變紅。所以只在需要的檔各自 mock。
vi.mock('server-only', () => ({}));

// 🔴 2026-08-12(#351③ 收尾片):`useShipmentLauncher` 現在會呼叫 `useRouter()`
//    (半成品箱關窗後要重取頁面,見該檔 `onClose`)。jsdom 下沒有掛載中的 App Router
//    ⇒ 真的 `useRouter` 丟 `invariant expected app router to be mounted`,本檔五格全紅(實測)。
//    ⚠️ 這是**測試環境**的缺口、不是正式環境的:`ShippingSelectionBar` 只出現在 App Router
//    的 `/orders` 頁上,那裡 router 恆掛載。替身只還原那個前提,不放寬本檔任何斷言。
// 🔴 **2026-08-12(換版分流片)改成保留真模組、只換 `useRouter`**:本檔經 `shipping-selection.tsx`
//    載入 `shipment-launcher.tsx`,而它的 catch 現在會呼叫 `unstable_isUnrecognizedActionError`。
//    整包替換的話那支是 `undefined` ⇒ 任何人日後在本檔補一格「讀候選失敗」就吃 TypeError
//    (今天不紅只因本檔沒有 reject 路徑)。⇒ 不留這顆地雷。
vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useRouter: () => ({ refresh: () => {} }),
}));


const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
/** 🔴 一律剝註解再掃:註解裡大量引用 `AdminOrderSummary` / `order={order}` 等字面。 */
const TABLE = strip(readFileSync(resolve(HERE, 'orders-table.tsx'), 'utf8'));
const TABLE_RAW = readFileSync(resolve(HERE, 'orders-table.tsx'), 'utf8');
const ISLAND = strip(readFileSync(resolve(HERE, 'shipping-selection.tsx'), 'utf8'));
const LAUNCHER = strip(readFileSync(resolve(HERE, 'shipment-launcher.tsx'), 'utf8'));

/**
 * 🔴 **分母守門(2026-08-28 量到本檔五格是恆綠的)**:本檔一整族守門的形狀是
 * 「讀進來的原始碼裡**不得**出現某個字面」——`not.toMatch` / `filter(...).toEqual([])`
 * 對**空字串**恆真 ⇒ **檔改名 / 讀空 / 剝過頭時,整族安靜地全部通過**,
 * 而它們守的是「經銷價與會員等級不得進 client bundle」這條紅線。
 * 釘的是**結構**(那支檔一定有 `import`),不是任何一個欄名 —— 欄名改了不該讓這裡紅。
 */
function expectRead(src: string, name: string) {
  expect(src, `${name} 讀起來是空的(或剝過頭)⇒ 下面的原始碼掃描什麼都沒證明`).toContain('import');
}

/**
 * 檔首切片版:**不能用 `toContain('import')`** —— 有些檔的前 400 字整段是檔頭註解,
 * 那樣會變成一條**假紅**(2026-08-28 當場撞到:`shipment-section.tsx` 的檔首 400 字沒有 import)。
 * 這裡只證「真的讀到東西了」,分母就夠了。
 */
function expectReadHead(src: string, name: string) {
  expect(src.length, `${name} 讀起來是空的 ⇒ 下面的原始碼掃描什麼都沒證明`).toBeGreaterThan(100);
}

const SECTION = strip(readFileSync(resolve(HERE, 'shipment-section.tsx'), 'utf8'));

// 🔴 跨測試殘留的 DOM 會讓 getAllByRole 撈到上一個測試的框(數量對不上、或斷言打到別人的節點)。
afterEach(cleanup);

/** 兩張單三樣:o1 有 i1 / i2,o2 有 i3。 */
function renderTwo() {
  return render(
    <ShippingSelectionProvider>
      <BatchActionBar nextBase='/orders?status=open' />
      <OrderItemCheckbox orderId='o1' itemId='i1' />
      <OrderItemCheckbox orderId='o1' itemId='i2' />
      <OrderItemCheckbox orderId='o2' itemId='i3' />
    </ShippingSelectionProvider>,
  );
}

/**
 * 🔴🔴 **2026-08-13 L2(#447 單一 markup 收斂):本組三格的期望值從 2 改成 1,這不是放寬守門。**
 *
 * 收斂前 `orders-table.tsx` 有兩份 markup(桌機表格 + 手機卡片 `OrderCard`),同一顆勾選框
 * 要各掛一次 ⇒ 本組守的病是「只改桌機那份、手機那份沒得勾,而桌機測試全綠」。
 * 收斂後**只有一份 markup**,那個病**結構上不存在** —— 掛 1 次就是兩個版面都有。
 * ⇒ 期望值若還寫 2,反而是在要求把已經刪掉的第二份 markup 加回來。
 *
 * ⚠️ **原本被它守住的東西沒有變成無人守**,只是換了守法:
 *    「一訂單一個框(不是逐品項冒出三個)」現在由 `orders-table.test.tsx` 的
 *    `ORDER_LEVEL_COLUMNS` 那組(數 `col-pick` 有值的格數 = 1)承重,而且是**行為面**的量測,
 *    比這裡的原始碼字串比對更準。
 */
describe('驗收字面① — 勾選欄(B9:品項層,每一列一個框)', () => {
  it('🔴 `<OrderItemCheckbox>` 在 orders-table.tsx 出現恰好 1 次(一份 markup、一個呼叫點)', () => {
    const hits = [...TABLE.matchAll(/<OrderItemCheckbox\b/g)].length;
    expect(
      hits,
      `orders-table.tsx 裡的 <OrderItemCheckbox> 出現 ${hits} 次,期望 1。` +
        '🔴 出現 2 次 = 有人把第二份 markup 加回來了(#447 的病復發);出現 0 次 = 整個版面沒得勾。',
    ).toBe(1);
  });

  it('🔴 第二份 markup 不得復活:`OrderCard` 已刪除、且沒有第二個列表容器', () => {
    expectRead(TABLE, 'orders-table.tsx');
    expect(TABLE, 'OrderCard(收斂前的手機卡片)復活了 ⇒ #447 白做').not.toMatch(/function OrderCard\b/);
    expect(TABLE).not.toMatch(/<ul className='[^']*md:hidden/);
  });

  it('🔴 B9:勾選格是**品項層**,掛在 `line ?` 分支(每一列一個框;稿「已勾 N 樣 · 來自 M 張單」)', () => {
    // ~~2b-1「掛在 `first ?` 分支」~~ —— 稿 v22 `td.ck` 每一列一個框,主視窗 2026-09-14 派工逐字「列上勾選框已在…稿是勾了浮出底部黑條『已勾 N 樣 · 來自 M 張單』」。
    const at = TABLE.indexOf('<OrderItemCheckbox');
    const before = TABLE.slice(Math.max(0, at - 300), at);
    expect(before, 'checkbox 前面找不到 `line ?` 分支 ⇒ 它可能又被放回訂單層(只有第一列有框)').toMatch(/line \?/);
    expect(before, 'checkbox 掛回 `first ?` 分支 ⇒ 一張三品項的單只剩一個框,勾不到第二、三樣').not.toMatch(/first \?/);
  });
});

describe('🔴🔴 驗收字面② — 鐵則 12:整包 summary 不得進 client props', () => {
  it('island 的 props 只有 orderId / itemId 兩個純量', () => {
    expectRead(ISLAND, 'shipping-selection.tsx');
    const forbidden = ['AdminOrderSummary', 'AdminOrderLine', 'order:', 'summary:', 'total', 'tierAtCheckout', 'lineTotal', 'unitPrice'];
    const bad = forbidden.filter((t) => ISLAND.includes(t));
    expect(
      bad,
      `shipping-selection.tsx(client 元件)出現了這些字面:${bad.join(', ')}。` +
        '🔴 `AdminOrderSummary` 帶 `total`(金額)與 `tierAtCheckout`(會員等級)= 經銷價脈絡,' +
        '進 client props 會被序列化進 RSC payload。**使用者看不到 ≠ 沒送出去**(payload 在 network 面板是純文字)。',
    ).toEqual([]);
  });

  it('🔴 呼叫端不得把整包 order / line 傳進去(只能傳 order.id 與 line.id 兩個欄位)', () => {
    const calls = [...TABLE.matchAll(/<OrderItemCheckbox([^/>]*)\/>/g)].map((m) => m[1] ?? '');
    expect(calls.length, '掃不到 <OrderItemCheckbox … /> 的呼叫 ⇒ 掛法變了,本條要重寫').toBe(1);
    for (const props of calls) {
      expect(
        props,
        `呼叫端把整包物件傳進 client 元件了:${props.trim()}。只能傳 orderId={order.id} 與 itemId={line.id}。`,
      ).not.toMatch(/\border=\{order\}|\{\.\.\.order\}|summary=\{|\bline=\{line\}|\{\.\.\.line\}/);
      expect(props, `呼叫端少了 orderId:${props.trim()}`).toMatch(/orderId=\{order\.id\}/);
      expect(props, `呼叫端少了 itemId:${props.trim()}`).toMatch(/itemId=\{line\.id\}/);
    }
  });

  it('前提 — `orders-table.tsx` 本體仍是 server component(沒有整支轉 client)', () => {
    expectReadHead(TABLE_RAW.slice(0, 400), 'orders-table.tsx 的檔首 400 字');
    expect(
      TABLE_RAW.slice(0, 400),
      "orders-table.tsx 檔首出現了 'use client' ⇒ 整支被轉成 client,金額與會員等級會整批進 bundle。" +
        'island 的意義就是只有那顆 checkbox 是 client。',
    ).not.toMatch(/'use client'/);
  });
});

describe('驗收字面③ — 「零 client 邊界」那句註解必須同 commit 更正', () => {
  it('🔴 檔頭不得只留舊斷言而沒有更正段(那句話現在是假的)', () => {
    const hasOld = TABLE_RAW.includes('零 client 邊界');
    const hasFix = /2b-1 更正|已經不是「零 client 邊界」/.test(TABLE_RAW);
    expect(
      !hasOld || hasFix,
      'orders-table.tsx 檔頭仍宣稱「零 client 邊界」但沒有任何更正段 ⇒ 註解在說謊。',
    ).toBe(true);
  });
});

// B9(2026-09-14,稿 v22 `#batch`):勾品項 → 底部批次列。三顆動作只組 `?next=&do=&items=` 網址,零寫入。
describe('批次列 — 行為', () => {
  it('沒勾任何東西時批次列不渲染', () => {
    renderTwo();
    expect(screen.queryByTestId('batch-bar')).toBeNull();
  });

  it('勾同一張單兩樣:「已勾 2 樣 · 同一張單」,三顆都是連結,next 只帶那一張、items 帶兩樣', () => {
    renderTwo();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    fireEvent.click((screen.getAllByRole('checkbox') as HTMLInputElement[])[1]!);
    const bar = screen.getByTestId('batch-bar');
    expect(bar.textContent).toContain('已勾 2 樣');
    expect(bar.textContent).toContain('同一張單');
    const links = [...bar.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')] as const);
    expect(links.map(([t]) => t)).toEqual(['一起跟供應商下訂', '一起到貨登記', '一起出貨']);
    expect(links[0]![1]).toBe('/orders?status=open&next=o1&do=order&items=i1,i2');
    expect(links[1]![1]).toBe('/orders?status=open&next=o1&do=receipt&items=i1,i2');
    expect(links[2]![1]).toBe('/orders?status=open&next=o1&do=ship&items=i1,i2');
  });

  it('🔴 跨單:「來自 2 張單」,下訂 / 到貨帶兩張單,出貨 disabled 且滑到有說明(稿:跨單不能一起裝箱)', () => {
    renderTwo();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    fireEvent.click((screen.getAllByRole('checkbox') as HTMLInputElement[])[2]!);
    const bar = screen.getByTestId('batch-bar');
    expect(bar.textContent).toContain('已勾 2 樣');
    expect(bar.textContent).toContain('來自 2 張單');
    const links = [...bar.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      '/orders?status=open&next=o1,o2&do=order&items=i1,i3',
      '/orders?status=open&next=o1,o2&do=receipt&items=i1,i3',
    ]);
    const ship = screen.getByRole('button', { name: /一起出貨/ }) as HTMLButtonElement;
    expect(ship.disabled).toBe(true);
    expect(ship.title).toBe('出貨要同一張單;跨單不能一起裝箱');
  });

  it('「改成本(勾選的列)」只在給了 costItemsParam 時出現(老闆模式接線是 A1/A2 的事)', () => {
    render(
      <ShippingSelectionProvider>
        <BatchActionBar nextBase='/orders' costItemsParam='cost' />
        <OrderItemCheckbox orderId='o1' itemId='i1' />
      </ShippingSelectionProvider>,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    const cost = screen.getByText('改成本(勾選的列)');
    expect(cost.getAttribute('href')).toBe('/orders?cost=i1');
  });

  it('nextBase 沒有 ? 時用 ?;再按同一顆 = 取消;「取消勾選」清空', () => {
    render(
      <ShippingSelectionProvider>
        <BatchActionBar nextBase='/orders' />
        <OrderItemCheckbox orderId='o1' itemId='i1' />
      </ShippingSelectionProvider>,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('一起跟供應商下訂').getAttribute('href')).toBe('/orders?next=o1&do=order&items=i1');
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.queryByTestId('batch-bar')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('取消勾選'));
    expect(screen.queryByTestId('batch-bar')).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('超過 NEXT_MULTI_MAX 張單 ⇒ 三顆鈕收起、印一句', () => {
    render(
      <ShippingSelectionProvider>
        <BatchActionBar nextBase='/orders' />
        {Array.from({ length: NEXT_MULTI_MAX + 1 }, (_, i) => (
          <OrderItemCheckbox key={i} orderId={`o${i}`} itemId={`i${i}`} />
        ))}
      </ShippingSelectionProvider>,
    );
    for (const b of screen.getAllByRole('checkbox')) fireEvent.click(b);
    const bar = screen.getByTestId('batch-bar');
    expect(bar.querySelectorAll('a').length).toBe(0);
    expect(bar.textContent).toContain(`一次最多 ${NEXT_MULTI_MAX} 張單`);
  });

  describe('狀態轉移(純函式,不經畫面)', () => {
    it('勾 / 取消 / 保序;distinctOrderIds 去重保序', () => {
      const s1 = nextSelection([], 'o1', 'i1');
      const s2 = nextSelection(s1, 'o2', 'i3');
      const s3 = nextSelection(s2, 'o1', 'i2');
      expect(s3).toEqual([
        { orderId: 'o1', itemId: 'i1' },
        { orderId: 'o2', itemId: 'i3' },
        { orderId: 'o1', itemId: 'i2' },
      ]);
      expect(distinctOrderIds(s3)).toEqual(['o1', 'o2']);
      expect(nextSelection(s3, 'o2', 'i3')).toEqual([
        { orderId: 'o1', itemId: 'i1' },
        { orderId: 'o1', itemId: 'i2' },
      ]);
      expect(nextSelection(s1, 'o1', 'i1')).toEqual([]);
    });
  });

  it('🔴 沒有「全選」框(稿上沒有;全選一頁 = 開一個幾十份表單的彈窗)', () => {
    renderTwo();
    const labels = (screen.getAllByRole('checkbox') as HTMLInputElement[]).map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => /全選|全部/.test(l)), '出現了全選框').toBe(false);
    expect(TABLE, 'orders-table.tsx 出現了全選框').not.toMatch(/全選/);
  });

  it('少掛 provider 時明確炸掉(不靜默降級 —— 勾不動與不能勾長得一模一樣)', () => {
    expect(() => render(<OrderItemCheckbox orderId='o1' itemId='i1' />)).toThrow(/ShippingSelectionProvider/);
  });
});

// ─────────────────────────────────────────────────────────────
// UX 次片(D-365-A):整列可點進詳情 + 動作鈕移最左。
// ─────────────────────────────────────────────────────────────
describe('🔴 整列可點 — 點列進詳情、點勾選不誤觸(兩者不得互相吃掉)', () => {
  // 做法是 **stretched link**(零 JS、表格維持 server component、真的連結 ⇒
  // 鍵盤/中鍵/右鍵複製網址都正常)。三個部件缺一就壞:
  //   ① 列 `relative`(覆蓋層的定位基準)② 連結 `after:absolute after:inset-0`(撐滿整列)
  //   ③ 勾選格 `relative z-10`(浮在覆蓋層上,否則點勾選會變成進詳情)
  // 🔴 **L2(#447)之後「桌機與手機卡片都要」這句話沒有對象了** —— 只有一份 markup、
  //    一個 `<tr>` 同時服務兩個版面(手機由 CSS 把它攤成卡片的一段)。
  //    ⇒ 本格從「兩個版面各驗一次」收斂成「那一個 `<tr>` 一定有 relative」。
  it('列本身是定位基準(`relative`)', () => {
    const rows = [...TABLE.matchAll(/className=\{`([^`]*)`\}\s*\n\s*>/g)].map((m) => m[1] ?? '');
    expect(
      rows.some((c) => c.includes('relative')),
      '<tr> 沒有 relative ⇒ stretched link 的 inset-0 會定位到更外層,命中區不是這一列',
    ).toBe(true);
  });

  it('🔴 整列可點的那條 stretched link 恰一條(`after:inset-0`)', () => {
    const hits = [...TABLE.matchAll(/after:absolute after:inset-0/g)].length;
    expect(
      hits,
      `after:inset-0 出現 ${hits} 次,期望 1。` +
        '⛔ ~~期望 2:同一格裡的桌機槽連結 + 手機槽連結(#350c 兩槽去處不同)~~ ' +
        '🏁 **⟦admin-ORDERNOLINKTODETAIL⟧ 2026-09-23 起是 1**:單號那兩顆合成一顆、永遠指明細頁(不再鋪整列),' +
        '整列可點的那條搬到展開 / 收合那顆箭頭上 ⇒ Sean 在用的「點那一列就收合」沒有變,而點單號現在會進明細頁。' +
        '0 次 = 整列不可點(收合入口沒了);2 次以上 = 有人把第二條覆蓋層加回來,兩條會互相蓋。',
    ).toBe(1);
  });

  // 🔴 2026-08-12(A13 操作欄):`relative z-10` 的用途從**一種變兩種** ——
  //    ①勾選格(2b-1)②操作欄的取消連結(A13)。兩者的失效症狀相同(被 stretched link 蓋住、
  //    點下去變成進面板/詳情,而畫面**確實有反應**),所以下面**分開數**:
  //    只數總數會讓「刪掉勾選格的 z-10、同時有人多加一個別的」互相抵銷而全綠。
  //    ⚠️ 視窗要從**這個標籤自己的 `<`** 起算,不是從 `relative z-10` 那個字往後 ——
  //    手機那顆取消連結把 `href={…#cancel}` 寫在 `className` **前面**,只往後看就會漏掉它
  //    (實測:漏掉 ⇒ 取消那格數到 1、前提格說它「兩種都不是」)。
  const zSlots = () =>
    [...TABLE.matchAll(/relative z-10[^>]*>/g)].map((m) => {
      const i = m.index ?? 0;
      const tagStart = TABLE.lastIndexOf('<', i);
      return TABLE.slice(tagStart === -1 ? i : tagStart, i + 400);
    });

  // 🔴 名字寫「**容器數**」不是「勾選框數」—— 這兩個在 L2 之後是不同的數字,
  //    而**測試名字比斷言更容易被後人當成規格**(memory「測試名>斷言」那條)。
  it('🔴 裝勾選框的 `relative z-10` **容器**恰 1 個 —— 少了它點勾選會變成進詳情', () => {
    const hits = zSlots().filter((s) => /<OrderItemCheckbox/.test(s)).length;
    expect(
      hits,
      `勾選格的 relative z-10 出現 ${hits} 次,期望 1(L2 收斂:一份 markup、一個勾選格)。` +
        '少了它,整列的 stretched link 會蓋在勾選框上面 ⇒ **點哪裡都進詳情、根本勾不了單**。',
    ).toBe(1);
  });

  // 🔴🔴 codex R1 must-fix(2026-08-12):上面兩格只證「該浮的東西有 z-10」,**沒有證覆蓋層比它低**。
  //    覆蓋層加一個 `after:z-20` ⇒ 勾選框與取消連結**全部被蓋回去**、點哪裡都進面板,
  //    而所有 class 斷言照樣全綠(它們各量各的,沒有人比較過兩者的層級)。
  //    ⇒ 這一格量的是**相對關係**:stretched overlay 一律不得自帶 z-index。
  //    ⚠️ 誠實邊界:這是**原始碼層**的規則,不是真的層疊計算 —— 真的命中要瀏覽器才證得了。
  //    🔴 而且它只擋得住「**覆蓋層自己**加 z」這一條路:**祖先**元素抬 z(或 `isolate` 開新的
  //    stacking context)一樣能把兩者的相對關係翻過來,而本格照樣綠 —— 那條**繞得過去**,
  //    只有真瀏覽器的命中測試證得了。寫在這裡免得有人把這格當成完整保證。
  //    哪天真的需要給覆蓋層一個 z,就要回來連同上面兩格一起重訂(那時 z-10 也要跟著抬)。
  it('🔴🔴 stretched overlay 不得自帶 z-index(否則會蓋回勾選框與取消連結,而上面兩格全綠)', () => {
    const overlays = [...TABLE.matchAll(/after:absolute after:inset-0/g)];
    expect(overlays.length, '前提:整列一條覆蓋層(數量變了代表結構換了,規則要重想)').toBe(1);
    for (const m of overlays) {
      const i = m.index ?? 0;
      const tagStart = TABLE.lastIndexOf('<', i);
      const tag = TABLE.slice(tagStart === -1 ? i : tagStart, i + 200);
      expect(
        tag,
        '覆蓋層自帶 z-index ⇒ 它可能高於勾選框/取消連結的 z-10,兩者被蓋回去而所有 class 斷言仍綠',
        // 🔴 `/after:z-/` 不寫 `\d`(R2 F1,node 實跑證):Tailwind 任意值語法 `after:z-[20]`
        //    第一個字元是 `[` 不是數字 ⇒ `/after:z-\d/` 對它 **false**、守門靜默漏掉。
      ).not.toMatch(/after:z-/);
    }
  });

  // ⛔ 「裝取消連結的 z-10 容器恰 1 個」那一格 2026-09-13 移除:操作欄 DOM 退場,列上沒有 `#cancel` 連結了。

  it('前提 — 每個 z-10 容器都真的裝著那四種東西之一(不是各自為政)', () => {
    const slots = zSlots();
    // L2 收斂:2 個容器(勾選格 + 操作格),收斂前是 4(兩份 markup × 兩種用途)
    // 🏁 **P-e-1(2026-09-13):2 → 3。第三種 = 「下一步」那顆連結**(`data-next-do`)。
    //    它要浮在整列 stretched link 上面的理由與另外兩種**逐字相同**:沒有 z-10 它點不到,
    //    而點下去畫面確實有反應(整列把人帶進展開)⇒ 看起來像功能好了,肉眼驗抓不到。
    //    ⚠️ 這一格從「兩種」變「三種」是登記,不是放寬:第四種出現時仍要人來歸類。
    // 🏁 **入口二(2026-09-13):3 → 4。第四種 = 發票 tag 那顆連結**(`data-invoice-open`)。
    //    理由與前三種逐字相同:沒有 z-10 它點不到, 而點下去整列把人帶進展開 ⇒ 看起來像功能好了。
    //    🔴 z-10 掛在 Link 上, 不在 td 上 —— 掛 td 會把整個客戶格挖成點不進明細的洞。
    // 🏁 **收款欄可點(2026-09-13,Sean 答甲):4 → 5。第五種 = 收款格「還差 N / 還沒收」那顆連結**(`data-pay-open`)。
    //    理由與前四種逐字相同:沒有 z-10 它點不到,而點下去畫面確實有反應(整列帶進展開)。
    // ⛔ 操作欄(`#cancel` 那種)2026-09-13 退場 ⇒ 5 → 4(勾選 / 下一步 / 發票 tag / 收款)。
    // 🏁 **⟦admin-ORDERNOLINKTODETAIL⟧ 2026-09-23:4 → 5。第五種 = 單號那顆連結**(`data-detail-link`)。
    //    理由與前四種逐字相同:整列的覆蓋層現在掛在展開 / 收合那顆箭頭上, 單號若沒有 z-10 就會被它蓋住
    //    ⇒ 點單號變成展開那一列, 而畫面確實有反應 ⇒ **那正是這次 Sean 回報的那個病**。
    expect(slots.length, 'z-10 一個都沒有 ⇒ 上面兩格會各自恆綠').toBe(5);
    // 🔴 五種用途不得互相冒充:同一個視窗兩個特徵都命中 ⇒ 分類失效,上面兩格會互相補位而全綠。
    const kinds = (s: string) =>
      [/<OrderItemCheckbox/.test(s), /data-next-do/.test(s), /data-invoice-open/.test(s), /data-pay-open/.test(s), /data-detail-link/.test(s)].filter(Boolean).length;
    expect(
      slots.filter((s) => kinds(s) > 1).length,
      '有視窗同時看到兩種以上 ⇒ 視窗開太大、分類已經沒有判別力',
    ).toBe(0);
    for (const s of slots) {
      expect(
        s,
        'z-10 容器後面沒有 <OrderItemCheckbox / data-next-do / data-invoice-open / data-pay-open / data-detail-link 任一 ⇒ 浮起來的是別的東西,' +
          '而該浮的那個仍被蓋住',
      ).toMatch(/<OrderItemCheckbox|data-next-do|data-invoice-open|data-pay-open|data-detail-link/);
    }
  });
});

// ─────────────────────────────────────────────────────────────
// D-373-A 任務 1-2:詳情頁出貨卡的「建立包裹」入口 + 開窗邏輯單一實作。
// ─────────────────────────────────────────────────────────────
describe('🔴 建箱動線只有一份實作(兩個入口、同一個彈窗)', () => {
  /** 這個資料夾裡所有非測試的元件檔。用掃目錄而不是寫死清單 —— 有人加第三個入口時本條仍然生效。 */
  const COMPONENTS = readdirSync(HERE)
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => ({ f, src: strip(readFileSync(resolve(HERE, f), 'utf8')) }));

  it('🔴 `<ShipmentDialog` 全資料夾只被**一個**檔渲染(複製第二份 = 冪等紀律也被複製)', () => {
    const users = COMPONENTS.filter(
      ({ f, src }) => f !== 'shipment-dialog.tsx' && src.includes('<ShipmentDialog'),
    ).map(({ f }) => f);
    expect(
      users,
      `渲染 <ShipmentDialog> 的檔:${users.join(', ')}。期望只有 shipment-launcher.tsx。` +
        '🔴 複製第二份的代價不是多幾行 —— 是開窗時生冪等鍵那條紀律變成兩份,' +
        '而其中一份被改成「送出時生鍵」**不會有任何症狀**(連按兩次真的建出兩箱、兩次都回報成功)。',
    ).toEqual(['shipment-launcher.tsx']);
  });

  it('🔴 建箱的冪等鍵只在 launcher 生成(勾單列與出貨卡都不得自己產鍵)', () => {
    expect(
      [...LAUNCHER.matchAll(/crypto\.randomUUID\(/g)].length,
      'launcher 裡的 randomUUID 不是恰好 1 次 ⇒ 可能有第二個生成點(例如送出時又生一把)',
    ).toBe(1);
    for (const [name, src] of [
      ['shipping-selection.tsx', ISLAND],
      ['shipment-section.tsx', SECTION],
    ] as const) {
      expect(
        src,
        `${name} 自己產了冪等鍵 ⇒ 它繞過了 launcher 那條「開窗生一次、重試沿用」的紀律。`,
      ).not.toMatch(/crypto\.randomUUID\(/);
    }
  });

  it('取候選也只有一個呼叫點(`fetchShipmentCandidates`)', () => {
    const callers = COMPONENTS.filter(({ src }) => src.includes('fetchShipmentCandidates')).map(
      ({ f }) => f,
    );
    expect(callers, `呼叫 fetchShipmentCandidates 的檔:${callers.join(', ')}`).toEqual([
      'shipment-launcher.tsx',
    ]);
  });
});

describe('🔴🔴 鐵則 12 — launcher 同樣不得收整包訂單', () => {
  it('launcher 的原始碼不得出現金額/等級欄名或讀模型型別', () => {
    expectRead(LAUNCHER, 'shipment-launcher.tsx');
    const forbidden = ['AdminOrderSummary', 'AdminOrderDetail', 'order:', 'summary:', 'total', 'tierAtCheckout'];
    const bad = forbidden.filter((t) => LAUNCHER.includes(t));
    expect(
      bad,
      `shipment-launcher.tsx(client 元件)出現了這些字面:${bad.join(', ')}。` +
        '它和 shipping-selection.tsx 同一條紅線:整包讀模型進 client props = 序列化進 RSC payload。',
    ).toEqual([]);
  });

  // 🔴 **2026-09-04 標題訂正(codex nit10)**:⛔ ~~「**只**傳訂單 id」~~ —— 那句話今天不成立:
  //    出貨卡現在合法地多傳一個 `balanceWarning`(一句**已經排版好的字串**, 見 `shipmentBalanceWarning`)。
  //    而**本格從頭到尾禁的就只有「整包 detail」** —— 它從來沒有真的檢查「有幾個 prop」
  //    ⇒ 📌 **標題比斷言寬, 而寬的那一半會被下一個人當成規矩去遵守(或去違反而不知道)。**
  it('🔴 出貨卡不得把整包 detail 傳進 client 元件(多傳已排版好的字串是允許的)', () => {
    const call = SECTION.match(/<OrderShipButton([^/>]*)\/>/)?.[1] ?? '';
    expect(call, 'shipment-section.tsx 掃不到 <OrderShipButton … /> ⇒ 入口不見了或掛法變了').not.toBe('');
    expect(
      call,
      `出貨卡把整包 detail 傳進 client 元件了:${call.trim()}。只能傳 orderId={detail.id}。` +
        'AdminOrderDetail 帶成交價與客人 PII。',
    ).not.toMatch(/detail=\{detail\}|\{\.\.\.detail\}/);
    expect(call, `少了 orderId:${call.trim()}`).toMatch(/orderId=\{detail\.id\}/);
  });

  it('前提 — 出貨卡本體仍是 server component(沒有整支轉 client)', () => {
    const raw = readFileSync(resolve(HERE, 'shipment-section.tsx'), 'utf8');
    expectReadHead(raw.slice(0, 400), 'shipment-section.tsx 的檔首 400 字');
    expect(
      raw.slice(0, 400),
      "shipment-section.tsx 檔首出現了 'use client' ⇒ 整支被轉成 client," +
        '它拿的是 AdminOrderDetail(成交價 + PII)⇒ 整包進 bundle。',
    ).not.toMatch(/'use client'/);
  });

  it('🔴 空狀態那句話不得再說「只能到列表建箱」(現在卡上就有入口,舊句是假的)', () => {
    const hasEntry = SECTION.includes('<OrderShipButton');
    const stale = /建箱請到<b>訂單列表<\/b>/.test(SECTION);
    expect(
      hasEntry && !stale,
      '卡上已經有「建立包裹」入口,空狀態卻還在叫員工回列表 ⇒ 畫面自己和自己矛盾,' +
        '而員工會照著那句話多繞一趟。',
    ).toBe(true);
  });
});

// ⛔ 「動作鈕移到最左(D-365-A)」那一組 2026-09-14 移除:稿 v22 `#batch` 是「已勾 N 樣」在前、鈕在後,
//    Sean 的稿蓋過 2026-08-09 那句口頭要求(稿是 09-13 拍的唯一稿)。
