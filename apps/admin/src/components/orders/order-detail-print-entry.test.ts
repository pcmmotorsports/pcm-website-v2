// order-detail-print-entry.test.ts — 那顆列印鈕的字面與去處(`#240`/Q1-A1)。
//
// 🔴 **這支存在的理由是量出來的**:2026-08-23 我把那顆鈕從「列印揀貨單」改成「訂單明細」,
//    然後跑了 `apps/admin/src/components/orders` + `app/print` 共 1,041 格 —— **一格都沒紅**。
//    再把它改回去(突變)⇒ **仍然一格都沒紅**。
//    ⇒ **那顆鈕的字面在此之前【零守門】** —— 它可以被任何人改掉或改回去,而沒有東西會發現。
//
// ⚠️ 這是**原始碼層**守門(照本 repo 既有慣例,如 `*_SELECT` 的 byte-equal)——
//    它擋的是「字面被改掉」,**不是**「畫面上真的長這樣」。後者要真瀏覽器,見 `線2-016`。
//
// 🔴 為什麼字面本身值得釘:Sean 2026-08-23 拍板②逐字
//    「那原本的揀貨單 按鈕改成 -> **訂單明細**」—— 它是**他指定的字**,不是我們挑的。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SRC = readFileSync(new URL('./order-detail.tsx', import.meta.url), 'utf8');

describe('訂單明細列印入口(order-detail.tsx)', () => {
  it('🔴 鈕的字面是「訂單明細」, 而舊字面「列印揀貨單」零殘留', () => {
    // 舊字面(Sean 拍板②之前那個)不得再出現在任何地方
    expect(SRC).not.toContain('列印揀貨單');
    // 新字面必須出現在 JSX 的文字節點上(前後是換行 + 縮排, 不是註解裡的引用)
    expect(SRC).toMatch(/\n\s+訂單明細\n/u);
  });

  it('🔴 負對照:這把尺讀得到這支檔的內容(否則上面兩格在空字串上也會綠)', () => {
    // 正對照 —— 一定在的字面
    expect(SRC).toContain('order-detail.tsx');
    expect(SRC.length).toBeGreaterThan(1000);
    // 反向 —— 一定不在的字面
    expect(SRC).not.toContain('zzz-not-a-real-token');
  });

  it('鈕仍連到 /print/orders/<id>/picking, 且仍是另開分頁', () => {
    // ⚠️ 路由本身**這一片不改**(它屬 A3 的退役步驟)——
    //    這一格釘的是「改名沒有順手改掉去處」。
    expect(SRC).toContain('/print/orders/${detail.id}/picking');
    expect(SRC).toContain("target='_blank'");
  });
});
