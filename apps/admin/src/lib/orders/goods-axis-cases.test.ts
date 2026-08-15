// goods-axis-cases.test.ts — 貨品軸的【共用真值表】,TS 這一側(`#522`)。
//
// ══ 🔴 為什麼是真值表,不是「兩邊互比」 ═══════════════════════════════════════
//
// 主視窗給的守門規格逐字是「餵一組含取消的輸入,兩邊各跑一次,**比結果**」。
// 🔴 **那擋不住 `#522`** —— `#522` 正是**兩邊【一起】用錯分母**:
//    SQL `>= oi.quantity` 與 TS `>= l.quantity` 對同一組輸入會給出**同一個錯答案**,
//    互比一致通過。**互比只能抓「抄漏」,抓不到「一起錯」。**
// ⇒ 必須有一組**人寫的期望值**當第三方,兩邊各自對它比。
//   那份期望值 = `goods-axis-cases.json`,SQL 那側由
//   `docs/probes/order-goods-axis-parity-probe.sh` 讀同一個檔。
//
// 🔴 **兩側的【觸發】不對稱,這是已知缺口不是疏漏**(code-reviewer 2026-08-16 實查):
//    **本檔每次 `vitest` 都跑;SQL 側那支 probe 只有人想到時才跑** ——
//    `.husky/pre-commit` / `.github/` / `package.json` 對 `docs/probes` **零命中**。
//    ⇒ **有人改了 `admin_order_list_v` 而沒跑 probe,不會有任何東西紅。**
//
// ⚠️ **它守不住什麼**:期望值是人寫的 ⇒ **人寫錯了兩邊會一起錯**。
//    防線是每一條 case 的 `label` 都寫了「為什麼是這個值」,讓下一個人審得動。

import { describe, it, expect } from 'vitest';
import { goodsAxisOfLines } from './order-status-axes';
import cases from './goods-axis-cases.json';

type Row = { quantity: number; ordered: number; instock: number; shipped: number; cancelled: number };

function toLines(rows: readonly Row[]) {
  return rows.map((r) => ({
    quantity: r.quantity,
    quantitySummary: {
      orderedQuantity: r.ordered,
      instockQuantity: r.instock,
      shippedQuantity: r.shipped,
      cancelledQuantity: r.cancelled,
    },
  }));
}

describe('🔴 貨品軸真值表 — TS 側(SQL 側跑 docs/probes/order-goods-axis-parity-probe.sh)', () => {
  it('前置檢查:真值表非空,而且真的含有取消的案例', () => {
    // 🔴 沒有這一格的話,`cases` 被清空時下面的 `it.each` 會**一格都不跑而整支綠**。
    expect(cases.cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.cases.filter((c) => c.lines.some((l) => l.cancelled > 0)).length).toBeGreaterThanOrEqual(5);
  });

  for (const c of cases.cases) {
    it(c.label, () => {
      expect(goodsAxisOfLines(toLines(c.lines as Row[]))).toBe(c.expected);
    });
  }
});
