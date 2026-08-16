// order-detail-items-table.test.ts — 🔴 `resolveAmountEditBlock` 的四個 fail-closed 分支
// (M-4b E10 #13 片1c-2 版面片;code-reviewer R1 must-fix 4)。
//
// **為什麼補這一格**:那個函式是「不給改金額」的**唯一**判斷點,而它在本片被搬過家。
// 搬家前它四個分支**全樹零測試格** ⇒ 版面重構把它搬歪、或哪天有人把 `unreadable`
// 誤讀成「沒有收款」,**不會有任何東西紅**。
// ⚠️ 它守得住的是「四個分支各自回什麼」,守不住「呼叫端有沒有把回傳值接上去」——
//    那條由 `item-amount-row.test.tsx` 的 `blockedReason` 格守。

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { resolveAmountEditBlock } from './order-detail-items-table';

const OK = { discountTotal: { amount: 0 } } as never;
const NO_PAY = { status: 'ok', rows: [] } as never;

describe('resolveAmountEditBlock — 四個分支', () => {
  it('🔴 `unreadable` = 「不知道有沒有收款」⇒ 擋(fail-closed,不是放行)', () => {
    const r = resolveAmountEditBlock(OK, { status: 'unreadable' } as never);
    expect(r).not.toBeNull();
    expect(r).toContain('讀取不完整');
  });

  it('`order_not_found` ⇒ 擋', () => {
    expect(resolveAmountEditBlock(OK, { status: 'order_not_found' } as never)).toContain('讀不到');
  });

  it('🔴 有【任何一列】收款就擋(不看金額口徑,對齊 RPC)', () => {
    const r = resolveAmountEditBlock(OK, { status: 'ok', rows: [{}] } as never);
    expect(r).toContain('收款紀錄');
  });

  it('有折扣就擋(discountTotal 非 0)', () => {
    const r = resolveAmountEditBlock({ discountTotal: { amount: -100 } } as never, NO_PAY);
    expect(r).toContain('折扣');
  });

  it('正向對照:四個條件都不成立時回 `null`(不是恆擋)', () => {
    expect(resolveAmountEditBlock(OK, NO_PAY)).toBeNull();
  });
});
