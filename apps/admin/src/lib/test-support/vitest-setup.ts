// vitest-setup.ts — admin project 的全域 setupFiles(2026-09-14 主視窗裁:提成一處)。
//
// 🔴 只做一件事:jsdom 沒有 `Element.prototype.scrollIntoView` ⇒ 任何在 effect 裡呼叫它的元件
//    (`danger-zone-details.tsx:77` 那類「展開後捲進視野」)在 jsdom 會 throw ⇒ vitest 記成 Unhandled Error,
//    而**測試格全綠、只有 Errors 那一行紅** —— 那正是 grep `×` 抓不到的形狀(2026-09-13 A 窗真的漏了兩顆 commit)。
//    之前的處置是「就地補 stub」, 到第三支(`procurement-wiring.test.tsx:180` 逐字「第三支再踩就提成 setupFiles」)⇒ 提上來。
// ⚠️ 只在 `typeof Element !== 'undefined'`(jsdom 檔)才補;node 環境的檔沒有 Element, 不碰。
// ⚠️ 要**斷言有沒有被叫**的測試(`danger-zone-details.test.tsx`)自己用 `vi.fn()` 蓋過去 —— 這裡的預設不擋它。
import { vi } from 'vitest';

if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = vi.fn();
}
