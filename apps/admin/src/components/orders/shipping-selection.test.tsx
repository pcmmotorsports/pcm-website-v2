// @vitest-environment jsdom
// shipping-selection.test.tsx — 勾單 island 的守門(片 2b-1)。
//
// 🔴 **三條驗收字面**(主視窗 D-353-A / D-355-A 明列,不是我自己加的):
//   ① 勾選欄**兩處都要有**(桌機 rowSpan 格 + 手機卡片)——只改桌機的話手機沒得勾、而桌機測試全綠。
//   ② island **只收 `orderId` / `customerUserId` 兩個純量**;`AdminOrderSummary` 整包不得進 client props。
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
  ShippingSelectionBar,
  OrderShipCheckbox,
  nextSelection,
} from './shipping-selection';

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
const SECTION = strip(readFileSync(resolve(HERE, 'shipment-section.tsx'), 'utf8'));

// 🔴 跨測試殘留的 DOM 會讓 getAllByRole 撈到上一個測試的框(數量對不上、或斷言打到別人的節點)。
afterEach(cleanup);

function renderTwo() {
  return render(
    <ShippingSelectionProvider>
      <ShippingSelectionBar />
      <OrderShipCheckbox orderId='o1' customerUserId='cuA' />
      <OrderShipCheckbox orderId='o2' customerUserId='cuA' />
      <OrderShipCheckbox orderId='o3' customerUserId='cuB' />
    </ShippingSelectionProvider>,
  );
}

describe('驗收字面① — 勾選欄桌機與手機**兩處**都要有', () => {
  it('🔴 `<OrderShipCheckbox>` 在 orders-table.tsx 出現恰好 2 次(桌機 rowSpan 格 + 手機卡片)', () => {
    const hits = [...TABLE.matchAll(/<OrderShipCheckbox\b/g)].length;
    expect(
      hits,
      `orders-table.tsx 裡的 <OrderShipCheckbox> 出現 ${hits} 次,期望 2(桌機表格 + 手機卡片各一)。` +
        '🔴 只有 1 次 = 有一個版面沒得勾;桌機那份好好的、手機那份不見了,而所有桌機測試照樣全綠。' +
        'Sean 常用手機看後台,漏掉手機那份等於這片對他沒用。',
    ).toBe(2);
  });

  it('🔴 兩處分別落在桌機 `<td rowSpan>` 與手機卡片裡(不是同一個版面塞了兩次)', () => {
    const at = [...TABLE.matchAll(/<OrderShipCheckbox\b/g)].map((m) => m.index ?? -1);
    expect(at.length).toBe(2);
    const desktopEnd = TABLE.indexOf('function OrderCard');
    expect(desktopEnd, 'orders-table.tsx 找不到 OrderCard(手機卡片)⇒ 版面結構變了,本條要重寫').toBeGreaterThan(-1);
    expect(
      at[0]! < desktopEnd && at[1]! > desktopEnd,
      `兩個 checkbox 的位置 ${JSON.stringify(at)} 沒有分別落在 OrderCard 前後 ⇒ ` +
        '可能同一個版面塞了兩次、另一個版面仍然沒有。',
    ).toBe(true);
  });

  it('桌機那顆放在訂單層的 rowSpan 合併格(不是品項列 —— 否則三品項的訂單會冒出三個框)', () => {
    const at = TABLE.indexOf('<OrderShipCheckbox');
    const before = TABLE.slice(Math.max(0, at - 260), at);
    expect(
      before,
      '桌機的 checkbox 前面找不到 `rowSpan={rowSpan}` ⇒ 它可能被放進品項層的 <td>,' +
        '那會讓一張多品項訂單出現多個勾選框。',
    ).toMatch(/rowSpan=\{rowSpan\}/);
  });
});

describe('🔴🔴 驗收字面② — 鐵則 12:整包 summary 不得進 client props', () => {
  it('island 的 props 只有 orderId / customerUserId 兩個純量', () => {
    const forbidden = ['AdminOrderSummary', 'AdminOrderLine', 'order:', 'summary:', 'total', 'tierAtCheckout'];
    const bad = forbidden.filter((t) => ISLAND.includes(t));
    expect(
      bad,
      `shipping-selection.tsx(client 元件)出現了這些字面:${bad.join(', ')}。` +
        '🔴 `AdminOrderSummary` 帶 `total`(金額)與 `tierAtCheckout`(會員等級)= 經銷價脈絡,' +
        '進 client props 會被序列化進 RSC payload。**使用者看不到 ≠ 沒送出去**(payload 在 network 面板是純文字)。',
    ).toEqual([]);
  });

  it('🔴 呼叫端不得把整包 order 傳進去(只能傳 order.id 與 order.customerUserId 兩個欄位)', () => {
    const calls = [...TABLE.matchAll(/<OrderShipCheckbox([^/>]*)\/>/g)].map((m) => m[1] ?? '');
    expect(calls.length, '掃不到 <OrderShipCheckbox … /> 的呼叫 ⇒ 掛法變了,本條要重寫').toBe(2);
    for (const props of calls) {
      expect(
        props,
        `呼叫端把整包物件傳進 client 元件了:${props.trim()}。只能傳 orderId={order.id} 與 customerUserId={order.customerUserId}。`,
      ).not.toMatch(/\border=\{order\}|\{\.\.\.order\}|summary=\{/);
      expect(props, `呼叫端少了 orderId / customerUserId:${props.trim()}`).toMatch(/orderId=\{order\.id\}/);
      expect(props, `呼叫端少了 customerUserId:${props.trim()}`).toMatch(/customerUserId=\{order\.customerUserId\}/);
    }
  });

  it('前提 — `orders-table.tsx` 本體仍是 server component(沒有整支轉 client)', () => {
    expect(
      TABLE_RAW.slice(0, 400),
      "orders-table.tsx 檔首出現了 'use client' ⇒ 整支被轉成 client,金額與會員等級會整批進 bundle。" +
        'island 的意義就是只有那顆 checkbox 是 client。',
    ).not.toMatch(/'use client'/);
  });
});

describe('驗收字面③ — 「零 client 邊界」那句註解必須同 commit 更正', () => {
  it('🔴 檔頭不得只留舊斷言而沒有更正段(那句話現在是假的)', () => {
    // 舊句仍在是可以的(它是歷史敘述),但**必須**有更正段跟在後面。
    const hasOld = TABLE_RAW.includes('零 client 邊界');
    const hasFix = /2b-1 更正|已經不是「零 client 邊界」/.test(TABLE_RAW);
    expect(
      !hasOld || hasFix,
      'orders-table.tsx 檔頭仍宣稱「零 client 邊界」但沒有任何更正段 ⇒ 註解在說謊。' +
        '下一個讀這支檔的人會據此判斷「這裡不能加互動」或「這裡沒有 client bundle 風險」,兩個都錯。',
    ).toBe(true);
  });
});

describe('同客人閘 — 行為', () => {
  it('沒勾任何單時三個框都可勾、動作列不渲染', () => {
    renderTwo();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.every((b) => !b.disabled)).toBe(true);
    expect(screen.queryByText(/已勾/)).toBeNull();
  });

  it('🔴 勾了 cuA 的單之後,cuB 的框變灰(同一箱只能裝同一位客人)', () => {
    renderTwo();
    const [a1, , b1] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(a1!);
    const after = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(after[0]!.checked).toBe(true);
    expect(after[1]!.disabled, '同一位客人的另一張單被鎖住了 ⇒ 跨單裝同一箱做不到').toBe(false);
    expect(b1).toBeDefined();
    expect(after[2]!.disabled, '別的客人的框沒有變灰 ⇒ 員工會勾下去、然後被 DB 退件').toBe(true);
  });

  // 🔴 **本組直接打純函式 `nextSelection`,不透過畫面。**
  //    第一版是透過畫面 `fireEvent.change` 一個 disabled 的框來模擬「繞過 disabled」——
  //    但對 disabled 的 input 發事件**根本進不到 handler**,所以那條測試綠得毫無意義:
  //    把狀態層的客人比對整段刪掉,它照樣全綠(突變 M5 當場證明,commit 前抓到)。
  //    ⇒ 教訓:**「模擬繞過」的測試,要先確認自己真的繞過去了。**
  describe('狀態轉移(純函式,不經畫面)', () => {
    const empty = { customerUserId: null, orderIds: [] as readonly string[] };

    it('🔴 第二道閘:不同客人不入選(disabled 只擋滑鼠,鍵盤/輔助技術/程式化路徑繞得過去)', () => {
      const afterA = nextSelection(empty, 'o1', 'cuA');
      const afterB = nextSelection(afterA, 'o3', 'cuB');
      expect(afterB.orderIds, '不同客人的單被收進選取了 ⇒ 會送出一箱裝兩位客人、被 DB 退件').toEqual(['o1']);
      expect(afterB.customerUserId).toBe('cuA');
    });

    it('同一位客人的第二張單收得進來(跨單裝同一箱是允許的:箱子掛客人不掛訂單)', () => {
      const s2 = nextSelection(nextSelection(empty, 'o1', 'cuA'), 'o2', 'cuA');
      expect(s2.orderIds).toEqual(['o1', 'o2']);
    });

    it('🔴 取消最後一張 → 客人歸零(否則勾光又取消光會讓全站永久變灰)', () => {
      const s1 = nextSelection(empty, 'o1', 'cuA');
      const s0 = nextSelection(s1, 'o1', 'cuA');
      expect(s0).toEqual({ customerUserId: null, orderIds: [] });
    });

    it('取消其中一張、還有剩 → 客人維持不變', () => {
      const s2 = nextSelection(nextSelection(empty, 'o1', 'cuA'), 'o2', 'cuA');
      const s1 = nextSelection(s2, 'o1', 'cuA');
      expect(s1).toEqual({ customerUserId: 'cuA', orderIds: ['o2'] });
    });
  });

  it('🔴 取消最後一張之後客人歸零(否則勾光又取消光會讓全站永久變灰)', () => {
    renderTwo();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[])[2]!.disabled).toBe(true);
    fireEvent.click((screen.getAllByRole('checkbox') as HTMLInputElement[])[0]!);
    expect(
      (screen.getAllByRole('checkbox') as HTMLInputElement[])[2]!.disabled,
      '取消勾選之後,別的客人仍然被鎖 ⇒ 員工得重新整理頁面才能繼續工作',
    ).toBe(false);
  });

  it('動作列顯示張數、「取消勾選」清空', () => {
    renderTwo();
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(boxes[0]!);
    fireEvent.click((screen.getAllByRole('checkbox') as HTMLInputElement[])[1]!);
    expect(screen.getByText(/已勾/).textContent).toContain('2');
    fireEvent.click(screen.getByText('取消勾選'));
    expect(screen.queryByText(/已勾/)).toBeNull();
  });

  it('🔴 沒有「全選」框(全選必然跨客人 = 按了一定被退件)', () => {
    renderTwo();
    const labels = (screen.getAllByRole('checkbox') as HTMLInputElement[]).map(
      (b) => b.getAttribute('aria-label') ?? '',
    );
    expect(labels.some((l) => /全選|全部/.test(l)), '出現了全選框').toBe(false);
    expect(TABLE, 'orders-table.tsx 出現了全選框').not.toMatch(/全選/);
  });

  it('少掛 provider 時明確炸掉(不靜默降級 —— 勾不動與不能勾長得一模一樣)', () => {
    expect(() => render(<OrderShipCheckbox orderId='o1' customerUserId='cuA' />)).toThrow(
      /ShippingSelectionProvider/,
    );
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
  it('列本身是定位基準(`relative`)—— 桌機與手機卡片都要', () => {
    const rows = [...TABLE.matchAll(/className=\{`([^`]*)`\}\s*\n\s*>/g)].map((m) => m[1] ?? '');
    expect(
      rows.some((c) => c.includes('relative')),
      '桌機 <tr> 沒有 relative ⇒ stretched link 的 inset-0 會定位到更外層,命中區不是這一列',
    ).toBe(true);
    expect(
      TABLE,
      '手機卡片 <li> 沒有 relative ⇒ 手機上整卡不可點(而桌機測試全綠)',
    ).toMatch(/<li className='[^']*relative[^']*p-3'/);
  });

  it('🔴 兩個版面**各有一條** stretched link(`after:inset-0`)', () => {
    const hits = [...TABLE.matchAll(/after:absolute after:inset-0/g)].length;
    expect(
      hits,
      `after:inset-0 出現 ${hits} 次,期望 2(桌機列 + 手機卡各一)。` +
        '只有 1 次 = 有一個版面整列不可點,而另一個版面的測試照樣綠。',
    ).toBe(2);
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

  it('🔴 勾選格必須浮在覆蓋層上(`z-10`)—— 否則點勾選會變成進詳情', () => {
    const hits = zSlots().filter((s) => /<OrderShipCheckbox/.test(s)).length;
    expect(
      hits,
      `勾選格的 relative z-10 出現 ${hits} 次,期望 2(桌機格 + 手機卡各一)。` +
        '少了它,整列的 stretched link 會蓋在勾選框上面 ⇒ **點哪裡都進詳情、根本勾不了單**。',
    ).toBe(2);
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
    expect(overlays.length, '前提:兩個版面各一條覆蓋層(數量變了代表結構換了,規則要重想)').toBe(2);
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

  it('🔴 A13 操作欄的取消連結也必須浮起來(桌機格 + 手機卡各一)', () => {
    const hits = zSlots().filter((s) => /#cancel/.test(s)).length;
    expect(
      hits,
      `取消連結的 relative z-10 出現 ${hits} 次,期望 2。少了它,點「取消」會被整列/整卡的` +
        'stretched link 接走 ⇒ 員工被帶到面板頂端,看起來像功能好了(肉眼驗抓不到)。',
    ).toBe(2);
  });

  it('前提 — 每個 z-10 容器都真的裝著那兩種東西之一(不是各自為政)', () => {
    const slots = zSlots();
    expect(slots.length, 'z-10 一個都沒有 ⇒ 上面兩格會各自恆綠').toBe(4);
    // 🔴 兩種用途不得互相冒充:同一個視窗兩個特徵都命中 ⇒ 分類失效,上面兩格會互相補位而全綠。
    expect(
      slots.filter((s) => /<OrderShipCheckbox/.test(s) && /#cancel/.test(s)).length,
      '有視窗同時看到勾選框與取消連結 ⇒ 視窗開太大、分類已經沒有判別力',
    ).toBe(0);
    for (const s of slots) {
      expect(
        s,
        'z-10 容器後面既沒有 <OrderShipCheckbox 也沒有 #cancel 連結 ⇒ 浮起來的是別的東西,' +
          '而該浮的那個仍被蓋住',
      ).toMatch(/<OrderShipCheckbox|#cancel/);
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
    const forbidden = ['AdminOrderSummary', 'AdminOrderDetail', 'order:', 'summary:', 'total', 'tierAtCheckout'];
    const bad = forbidden.filter((t) => LAUNCHER.includes(t));
    expect(
      bad,
      `shipment-launcher.tsx(client 元件)出現了這些字面:${bad.join(', ')}。` +
        '它和 shipping-selection.tsx 同一條紅線:整包讀模型進 client props = 序列化進 RSC payload。',
    ).toEqual([]);
  });

  it('🔴 出貨卡只傳訂單 id 進 client 元件(不是整包 detail)', () => {
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

describe('動作鈕移到最左(D-365-A)', () => {
  it('🔴 鈕在計數之前(來源順序 = 畫面順序)', () => {
    const src = readFileSync(resolve(HERE, 'shipping-selection.tsx'), 'utf8').replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      (m) => m.replace(/[^\n]/g, ' '),
    );
    const btn = src.indexOf('出貨(');
    const count = src.indexOf('已勾 ');
    expect(btn).toBeGreaterThan(-1);
    expect(count).toBeGreaterThan(-1);
    expect(
      btn < count,
      '計數又跑到按鈕前面了 ⇒ Sean 要的是「動作先到」,讀完計數再把視線甩到最右是多餘的橫向移動',
    ).toBe(true);
  });
});
