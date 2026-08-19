// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// 受測檔的相依鏈上有 `import 'server-only'`(它是 server component)⇒ 測試裡要 stub 掉,
// 否則整支載入即炸。同 `order-detail-items-table.test.ts:9` 的既有做法。
vi.mock('server-only', () => ({}));
import { stripComments } from '../../lib/test-support/strip-comments';
import type { AdminOrderItemQuantitySummary } from '@pcm/domain';
import {
  ItemAxisMissingNote,
  ItemAxisValue,
  ItemCancelledNote,
} from './order-detail-items-table';

// order-detail-items-table-shape.test.tsx — 片5(三軸拆三欄)的守門。
//
// 🔴 **本檔守的是三件會【安靜壞掉】的事**,不是「有沒有畫出來」:
//   ① `<tfoot>` 的欄跨度跟不跟得上欄數 —— 跟不上時**版面靜默畫歪**,零紅
//   ② 三軸缺值時印「—」而不是 `0/0` —— 印 `0/0` 等於系統宣稱「確定是零」
//   ③ 「已取消」只在 >0 時出現,而且**沒有被拆欄弄丟**
//
// 📌 為什麼另開一支檔而不是併進 `order-detail-items-table.test.ts`:
//    那支是 `.ts`(純函式、測 `resolveAmountEditBlock` 那道錢閘),渲染要 `.tsx` + jsdom。
//    **不去改它** —— 那 5 格全在守錢,混進版面斷言只會讓兩件事互相稀釋。

afterEach(cleanup);

const RAW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'order-detail-items-table.tsx'),
  'utf8',
);

/**
 * 🔴🔴 **所有原始碼層的斷言都對【剝掉註解之後】的碼跑,而這一行是被自己踩出來的。**
 *
 * 我第一版直接對 `RAW` 跑 `/<tfoot[\s\S]*?<\/tfoot>/` —— 而**第一個 `<tfoot>` 出現在
 * `ITEMS_FOOTER_LABEL_COLSPAN` 的【文件註解】裡** ⇒ 比對範圍從註解一路吃到真的 `</tfoot>`,
 * 把註解裡提到的 `<td />` 當成真的殘骸 ⇒ **假紅**。
 *
 * ⇒ 這與 `item-amount-row.test.tsx` 那把尺的病**是同一個**:
 *   **尺量的是字元,而宣稱量的是結構** —— 註解裡的字看起來跟 code 一模一樣。
 *   那邊是**多報一欄**(假紅),更危險的方向是**一句註解補回一個被刪掉的結構**(假綠)。
 * ⇒ 用 repo 既有的 `stripComments`(`lib/test-support/strip-comments.ts`),不自己再寫一個。
 *   ⚠️ 它剝 `/* *​/` 與 `//`;JSX 的 `{\/* … *\/}` 剝掉內容後會留下一對空的 `{}`,
 *   對這裡的結構比對無害(我們比對的是 `<th>` / `<td>` / `colSpan`)。
 */
const SRC = stripComments(RAW);

const summary = (over: Partial<AdminOrderItemQuantitySummary> = {}): AdminOrderItemQuantitySummary =>
  ({
    quantity: 2,
    orderedQuantity: 2,
    instockQuantity: 1,
    shippedQuantity: 0,
    cancelledQuantity: 0,
    ...over,
  }) as AdminOrderItemQuantitySummary;

describe('🔴🔴 `<tfoot>` 的欄跨度必須跟著欄數走(片5 之前是四個寫死的 4)', () => {
  it('footer 標籤一律用 `ITEMS_FOOTER_LABEL_COLSPAN`,檔內零寫死數字 colSpan', () => {
    // 🔴 這一格的價值:欄數 6→8 時,寫死的 `colSpan={4}` **不會有任何東西紅**,
    //    金額只是默默對不到「小計」那一欄底下。片5 就是會踩爆它的那種改動。
    expect(SRC).toContain('const ITEMS_FOOTER_LABEL_COLSPAN = ITEMS_TABLE_COLSPAN - 1;');
    // 正向對照:真的抓到了 footer 那幾列(不是掃到空字串然後恆綠)
    expect(SRC.split('ITEMS_FOOTER_LABEL_COLSPAN').length - 1).toBeGreaterThanOrEqual(5);
    // 🔴 負向:任何 `colSpan={<純數字>}` 都不該再出現(含 tfoot 與展開列)
    expect(SRC.match(/colSpan=\{\d+\}/g)).toBeNull();
  });

  it('🔴🔴 footer 每一列**恰好兩個 `<td>`**(標籤 + 金額)—— 這才是真正的不變量', () => {
    // ⚠️ 我第一版寫的是 `not.toContain('<td />')` —— 那量的是**一種拼法**,不是不變量(R1 nit A):
    //    有人補一格寫成 `<td></td>` 或 `<td className='' />`,該列變 3 個 td、版面歪掉,
    //    而那一格與其他所有格**全綠**。⇒ 直接數。
    const tfoot = /<tfoot[\s\S]*?<\/tfoot>/.exec(SRC)?.[0] ?? '';
    expect(tfoot.length).toBeGreaterThan(0); // 正向對照:真的抓到 tfoot
    const rows = [...tfoot.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1] ?? '');
    expect(rows.length).toBeGreaterThan(0); // 正向對照:真的抓到列
    for (const row of rows) {
      expect((row.match(/<td\b/g) ?? []).length).toBe(2);
    }
  });
});

describe('🔴🔴 body 一列的欄數也要釘 —— 它跨兩支檔,而原本沒有任何東西看著它', () => {
  it('本檔 `<tbody>` 內的 `<td>` 數 = 總欄數 − 1(少的那一格是 `item-amount-row.tsx` 的單價格)', () => {
    // R1 nit H:thead 有兩道釘子、tfoot 有算式,而 **body 只有 nine-code-retire 的位置比對
    // 間接覆蓋到「數量」欄為止** ⇒ 在「單價 / 小計」之後增刪一個 `<td>`,三支測試檔全綠。
    // 🔴 一列的八格【跨兩支檔】:本檔 before 6 格 + after 1 格 = 7,
    //    另一格是 `item-amount-row.tsx` 自己畫的單價格 ⇒ 7 + 1 = ITEMS_TABLE_COLSPAN。
    const declared = Number(/ITEMS_TABLE_COLSPAN = (\d+);/.exec(SRC)?.[1]);
    expect(declared).toBeGreaterThan(0); // 正向對照:真的抓到常數
    const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(SRC)?.[1] ?? '';
    expect(tbody.length).toBeGreaterThan(0); // 正向對照:真的抓到 tbody
    expect((tbody.match(/<td\b/g) ?? []).length).toBe(declared - 1);
    // 🔴 而那「1」不是猜的 —— 釘住它真的在對面那支檔裡。
    const rowSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), 'item-amount-row.tsx'),
      'utf8',
    );
    expect((stripComments(rowSrc).match(/<td\b/g) ?? []).length).toBe(2); // 單價格 + 展開列那一格
  });
});

describe('🔴 表頭欄名與順序 = 設計稿那一行(MAIN-057 §1 區塊②)', () => {
  it('八欄逐字、依序', () => {
    // `SRC` 已經剝過註解(見上方 `SRC` 的檔頭)⇒ 這裡直接數。
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(SRC)?.[1] ?? '';
    expect(thead.length).toBeGreaterThan(0); // 正向對照:真的抓到 thead
    const headers = [...thead.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => (m[1] ?? '').trim());
    expect(headers).toEqual(['商品名稱', '料號', '訂', '到', '出', '數量', '單價', '小計']);
  });

  it('🔴 「訂貨 · 到貨 · 出貨 · 取消」那個舊欄名不得再存在於表頭', () => {
    // 片5 把那三個字從【值】搬到【欄頭】;舊的四合一欄名留著代表沒搬乾淨。
    const thead = /<thead>([\s\S]*?)<\/thead>/.exec(SRC)?.[1] ?? '';
    expect(thead.length).toBeGreaterThan(0); // 正向對照:真的抓到 thead
    expect(thead).not.toContain('訂貨 · 到貨 · 出貨');
  });
});

describe('🔴 `ItemAxisValue`:缺值印「—」,不是 `0/0`', () => {
  it('有 summary ⇒ 印「本軸/總數」', () => {
    const { container } = render(
      <ItemAxisValue summary={summary()} pick={(q) => q.instockQuantity} />,
    );
    expect(container.textContent).toBe('1/2');
  });

  it('🔴🔴 summary 為 null ⇒ 印「—」——「不知道」與「確定是零」必須分得開', () => {
    const { container } = render(<ItemAxisValue summary={null} pick={(q) => q.instockQuantity} />);
    expect(container.textContent).toBe('—');
    // 負向對照:絕不能長成 0/0(那會讓員工以為系統說「確定沒有」)
    expect(container.textContent).not.toContain('0/0');
  });

  it('✅ 真的是 0 的時候才印 0 —— 正向對照,證明上一格不是把 0 也吃掉了', () => {
    const { container } = render(
      <ItemAxisValue summary={summary({ shippedQuantity: 0 })} pick={(q) => q.shippedQuantity} />,
    );
    expect(container.textContent).toBe('0/2');
  });

  it('🔴 三軸共用同一個分母 —— 分母永遠是 `summary.quantity`,不會各自漂', () => {
    const s = summary({ quantity: 7, orderedQuantity: 5, instockQuantity: 3, shippedQuantity: 1 });
    for (const [pick, expected] of [
      [(q: AdminOrderItemQuantitySummary) => q.orderedQuantity, '5/7'],
      [(q: AdminOrderItemQuantitySummary) => q.instockQuantity, '3/7'],
      [(q: AdminOrderItemQuantitySummary) => q.shippedQuantity, '1/7'],
    ] as const) {
      const { container } = render(<ItemAxisValue summary={s} pick={pick} />);
      expect(container.textContent).toBe(expected);
      cleanup();
    }
  });
});

describe('🔴 缺值那句話只講一次,而且沒有消失', () => {
  it('summary 為 null ⇒ 商品名稱格底下出現「數量資料尚未就緒」', () => {
    const { container } = render(<ItemAxisMissingNote summary={null} />);
    expect(container.textContent).toContain('數量資料尚未就緒');
  });

  it('✅ 負向對照:有 summary ⇒ 什麼都不畫(不是印一個空框)', () => {
    const { container } = render(<ItemAxisMissingNote summary={summary()} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('🔴 「已取消」是例外不是第四軸 —— 拆欄時最容易掉的就是它', () => {
  it('cancelledQuantity > 0 ⇒ 出現,且帶得走數字', () => {
    const { container } = render(<ItemCancelledNote summary={summary({ cancelledQuantity: 3 })} />);
    expect(container.textContent).toContain('已取消');
    expect(container.textContent).toContain('3');
  });

  it('✅ 負向對照:0 件取消 ⇒ 不畫(0 是常態,每列印一個 0 是噪音)', () => {
    const { container } = render(<ItemCancelledNote summary={summary({ cancelledQuantity: 0 })} />);
    expect(container.innerHTML).toBe('');
  });

  it('✅ 負向對照:summary 缺值 ⇒ 不畫(不知道有沒有取消,不得編一個 0)', () => {
    const { container } = render(<ItemCancelledNote summary={null} />);
    expect(container.innerHTML).toBe('');
  });
});
