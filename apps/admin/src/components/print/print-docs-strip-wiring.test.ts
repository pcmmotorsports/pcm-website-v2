// print-docs-strip-wiring.test.ts — 兩張列印紙的 emoji 濾除【接線】原始碼層守門
// (`#240`/Q1-A1;code-reviewer R1 must-fix 4 之後補)
//
// 🔴 為什麼是原始碼層而不是 render:`ShippingDoc` 要 shipment / lines / items 三組 fixture,
//    而本片沒有動它的邏輯 —— **我要釘的只有「那個呼叫還在不在」。**
// ⚠️ **它擋的是「有人把呼叫拿掉」, 不是「畫面上真的濾掉了」。**
//    picking 那一面有 render 覆蓋(`picking-doc-emoji.test.tsx` 五格);
//    **shipping 那一面本片【沒有】render 覆蓋** —— 誠實記在這裡,
//    不要把兩張紙讀成同等級的證據。
// 📌 而它為什麼獨立一支檔:那支 render 測試是 `@vitest-environment jsdom`,
//    在 jsdom 下 `import.meta.url` 不是 file URL ⇒ `readFileSync(new URL(...))` 會炸。
//    (2026-08-23 實測 `TypeError: The URL must be of scheme file`。)

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 🔴 用【repo 根的相對路徑】而不是 `import.meta.url`:
//    admin 這個 vitest 專案跑在 jsdom 環境, 而 jsdom 下 `import.meta.url` 不是 file URL
//    ⇒ `readFileSync(new URL(...))` 會炸 `TypeError: The URL must be of scheme file`(2026-08-23 實測)。
//    vitest 的 cwd 是 repo 根 ⇒ 下面兩條路徑是可判定的。
const DIR = 'apps/admin/src/components/print';
const PICKING = readFileSync(`${DIR}/picking-doc.tsx`, 'utf8');
const SHIPPING = readFileSync(`${DIR}/shipping-doc.tsx`, 'utf8');

describe('兩張列印紙的 emoji 濾除接線', () => {
  it('🔴 兩張紙的【姓名欄】都要經過 stripPictographs', () => {
    expect(PICKING).toContain('stripPictographs(detail.customer.name)');
    expect(SHIPPING).toContain('stripPictographs(shipment.recipientSnapshot?.name)');
  });

  it('🔴 負對照:這把尺讀得到內容(否則上面那格在空字串上也會綠)', () => {
    expect(PICKING).toContain('PickingDoc');
    expect(SHIPPING).toContain('ShippingDoc');
    expect(PICKING.length).toBeGreaterThan(1000);
    expect(SHIPPING).not.toContain('zzz-not-a-real-token');
  });
});

// ══ 複驗(R1-confirm)must-fix 2:出貨單的缺值守門要判【濾過之後】的值 ═══════
//
// 🔴 失敗情境(reviewer 構造的):收件人名字整串都是 emoji(`'🏍'`)
//    ⇒ 原始值 `trim()` 非空 ⇒ 舊的 blocked 判斷**放行**
//    ⇒ 而渲染時 `stripPictographs` 回 null ⇒ **收件人欄整格空白的出貨標籤印出去了**
//    ⚠️ 而同檔 :187 的文案自己寫著「收件人有缺…**不能出貨**」
//       ⇒ **這條路徑繞過了那道守門。**
// 📌 而修法選「blocked 改判濾後的值」而不是「補 `?? '—'`」,理由 reviewer 給的:
//    **紙上印「收件人:—」一樣寄不出去。**
describe('出貨單:收件人缺值守門判的是【濾過之後】的值', () => {
  const SHIPPING_SRC = readFileSync(`${DIR}/shipping-doc.tsx`, 'utf8');

  it('🔴 blocked 判斷用 stripPictographs(r.name) === null, 不是 r.name.trim()', () => {
    expect(SHIPPING_SRC).toContain("stripPictographs(r.name) === null");
    expect(SHIPPING_SRC).not.toContain("r.name.trim() === ''");
  });

  // 🔴🔴 **[2026-09-10 Sean 拍甲 ⇒ 這一格的期望值整個反過來]**
  //    逐字「印出來 —— 地址欄留白,紙上標注『自取』或『無電話』」(經主視窗 `pcm-website-v2-59` 轉述)。
  //    ⛔ ~~舊期望:電話與地址那兩格【仍然】阻印~~ ⇒ 🔴 **它們現在【不阻印】。**
  //
  //    🔴🔴 **而這一格自己差點變成一個假綠,那比它守的東西更值得記**:
  //    本測試用的是「**原始碼裡有沒有那個字面**」。而我在 `shipping-doc.tsx` 把舊條件
  //    劃掉留存時**把原文逐字抄進了註解** ⇒ 📌 **行為已經改掉,而這一格照樣綠。**
  //    (2026-09-10 codex 唯讀審抓到。修法:那支檔的註解改成敘述,不抄逐字原文。)
  //    ⇒ 🎯 **一個被劃掉的字面,對「找字面」的尺來說跟活的一模一樣。**
  it('🔴 電話與地址那兩格【不再阻印】—— 而這裡同時擋住「把原文抄回註解」那條路', () => {
    expect(SHIPPING_SRC).not.toContain("r.phone.trim() === ''");
    expect(SHIPPING_SRC).not.toContain("r.line.trim() === ''");
  });

  // ⚪ 上面那一格是否定式 ——「不含 X」有無限多種綠法(整個檔被清空也會綠)
  //    ⇒ 🟢 配一格**肯定式**:那兩句標注與共用的判空函式要真的在檔裡。
  it('🟢 正對照:缺電話 / 缺地址的兩句標注真的在檔裡', () => {
    expect(SHIPPING_SRC).toContain('無電話');
    expect(SHIPPING_SRC).toContain('地址未填(自取或待補)');
    expect(SHIPPING_SRC).toContain('isBlankField');
  });
});
