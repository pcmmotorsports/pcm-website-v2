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

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ShippingSelectionProvider,
  ShippingSelectionBar,
  OrderShipCheckbox,
  nextSelection,
} from './shipping-selection';

const HERE = dirname(fileURLToPath(import.meta.url));
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
/** 🔴 一律剝註解再掃:註解裡大量引用 `AdminOrderSummary` / `order={order}` 等字面。 */
const TABLE = strip(readFileSync(resolve(HERE, 'orders-table.tsx'), 'utf8'));
const TABLE_RAW = readFileSync(resolve(HERE, 'orders-table.tsx'), 'utf8');
const ISLAND = strip(readFileSync(resolve(HERE, 'shipping-selection.tsx'), 'utf8'));

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
