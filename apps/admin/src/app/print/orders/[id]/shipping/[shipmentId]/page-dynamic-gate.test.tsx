// @vitest-environment node
//
// 出貨單列印頁的**快取守門**。這一支只問一件事:**這一頁會不會被快取住。**
//
// 🔴🔴 **為什麼要有它**:片 `Q-⑨` 在紙上印了「列印時間」,而那個時間是
//    `page.tsx` 在**渲染當下**呼叫 `new Date()` 取的。
//    ⇒ 這一頁若被靜態化或 ISR 快取住,**那一行會安靜地印出一個舊時間**,
//      而**紙看起來完全正常** —— 沒有例外、沒有紅、沒有任何症狀。
//    ⇒ 那個缺口原本**只有一句註解在守**(片 `Q-⑨` 交件檔 §6 缺口②,由本片關掉)。
//
// ── 🔴 **守的是【匯出的值】,不是原始碼字面** ────────────────────────────────
//    第一直覺是 `grep 'force-dynamic'`,而那把尺會被下面這些繞過去:
//      · 換引號 / 換排版 / 中間插註解
//      · 那五個字**出現在註解裡**(本檔上面就有好幾個)⇒ 檔案刪光了它也還是綠的
//    ⇒ 改成 `import * as route from './page'` 之後讀 `route.dynamic` ——
//      **那正是 Next 讀的那一個 binding**,不是一段長得像它的文字。
//
// ── ⚠️ **它守不到什麼(寫下來,不假裝守到了)** ──────────────────────────────
//    ① 有人在**別的路由**渲染同一個 `ShippingDoc` 而那條路沒有這個設定 ⇒ 本檔看不到。
//       (本檔綁死 `./page`;它問的是「這一頁」不是「所有會印這張紙的路」。)
//    ② Next 自己改變 `force-dynamic` 的語意 ⇒ 值沒變、行為變了 ⇒ 本檔仍然綠。
//    ③ `new Date()` 那一行**本身**被改成常數 ⇒ 那是另一件事,本檔不管
//       (它由 `print-doc-cascade-browser.test.tsx` 那條線的字面比對接住)。
//    🔴 ①②③ 都是**真的守不到**,不是「應該還好」。
import { describe, expect, it, vi } from 'vitest';

// 這一頁的 import 鏈會拉到 server-only 與資料層 ⇒ 逐個 mock 掉。
// 🔴 只是為了**讓模組載入得起來**;本檔一格都不呼叫它們。
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound');
  },
}));
vi.mock('../../../../../../lib/orders/order-repository', () => ({
  getAdminOrderRepository: () => ({
    findAdminOrderDetail: vi.fn(),
    listOrderItemsForDetail: vi.fn(),
  }),
}));
vi.mock('../../../../../../lib/shipping/order-shipments', () => ({
  loadOrderShipments: vi.fn(),
}));

import * as route from './page';

describe('出貨單列印頁的快取設定', () => {
  it('🔴 `dynamic` 必須是 `force-dynamic` —— 否則紙上的「列印時間」會印出舊時間而不會紅', () => {
    // 期望值寫**具體字面**而不是 `toBeTruthy()`:
    // 具體期望值讓它【會叫】,而 `toBeTruthy()` 對 `'force-static'` 也是綠的。
    expect(route.dynamic).toBe('force-dynamic');
  });

  it('🔴 不得匯出 `revalidate` —— 它會把這一頁變成 ISR,而 ISR 一樣會快取住那個時間', () => {
    // 🔴 **這一格不是湊數的**:`force-dynamic` 還在、而有人另外加一行
    //    `export const revalidate = 60` ⇒ 上面那格照樣綠,而紙上的時間開始變舊。
    //    ⇒ 一道只檢查「該有的有沒有」的守門,對「多了一個會抵銷它的東西」零判別力。
    expect((route as Record<string, unknown>).revalidate).toBeUndefined();
  });

  it('這一頁必須真的匯出一個 default component(分母守門)', () => {
    // 🔴 **沒有這一格,上面兩格在「整支檔被換掉/清空」時會【無聲通過】** ——
    //    `route.dynamic` 是 `undefined`、`revalidate` 也是 `undefined`,
    //    第二格照樣綠,而第一格的紅會被讀成「有人改了設定」而不是「這一頁不見了」。
    expect(typeof route.default).toBe('function');
  });
});
