import { describe, expect, it } from 'vitest';

import { shouldShowRefundEntry } from './refund-entry-gate';

// order-detail-refund-entry.test.ts — #445a-3。
//
// 🔴 這支測試的存在理由:445a-3 刪掉 `order-detail-route.tsx` 裡「有帳本列才查未登記額」
//    的短路 ⇒ **每一張訂單**都新增一條對 `pcm_order_refundable_remaining` 可用性的
//    fail-closed 依賴(以前零帳本列時根本不呼叫、不可能失敗)。
// ⚠️ **更正(關卡2 codex nit)**:我原本寫「這個入口閘在 445a-3 之前零測試覆蓋」,
//    量法是 `grep -rln "refundUnregisteredFailed" --include="*.test.tsx"` = 零命中。
//    **那句是假的** —— `app/orders/[id]/refund-wiring.test.tsx:293-309` 早就用整頁渲染
//    覆蓋了「讀取失敗 ⇒ 入口 fail-closed」,字面是 `getLedgerUnregisteredAmount.mockRejectedValue`
//    + `hasRefundEntry()`,**我的 grep 掃不到**。同日第三次「掃描字集比宣稱窄」。
// ⇒ 本檔的定位因此收窄:**補「條件級」的窮舉**(0 / null / 負值 / 各單一條件),
//    頁級行為的 oracle 在 `refund-wiring.test.tsx`,兩者不重疊。

const OK = {
  refundEnabled: true,
  refundsFailed: false,
  refundUnregisteredFailed: false,
  refundUnregisteredAmount: 1000,
  paymentChannel: 'tappay',
  paymentStatus: 'paid',
} as const satisfies Parameters<typeof shouldShowRefundEntry>[0];

describe('shouldShowRefundEntry — #445a-3 入口閘', () => {
  it('[正向] 全部條件成立 ⇒ 開', () => {
    expect(shouldShowRefundEntry(OK)).toBe(true);
  });

  // 🔴 **原本這裡有一格標 `[§6-1] 零帳本列 ⇒ 入口開著`,已刪。**
  //    code-reviewer 抓到:它的輸入與上面 `[正向]` **逐字相同**(`OK` 的 amount 本來就是 1000)
  //    ⇒ 兩格同生同死、零邊際判別力;而且它宣稱覆蓋「零帳本列」,
  //    但這個 gate **根本收不到 rows**、分辨不了有沒有帳本列。**量錯東西。**
  //    ⇒ §6-1 的真 oracle 在頁層:`app/orders/[id]/refund-wiring.test.tsx` 的
  //    「零帳本列也要查未登記額」與「零列+成功仍不渲染」兩格(那裡才跑得到 route)。

  // 🔴 §6-2:**這是 445a-3 新增的行為,不是回歸格。**
  //    以前零列時不呼叫 RPC ⇒ 這個 true 不可能出現;現在會。
  it('[§6-2] 🔴 未登記額讀取失敗 ⇒ 入口 fail-closed 關閉(445a-3 的新依賴)', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredFailed: true })).toBe(false);
  });

  it('[既有] 帳本本身讀取失敗 ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, refundsFailed: true })).toBe(false);
  });

  // 負值 = 帳本登記已超過訂單總額(對帳異常),區塊明寫「勿再發起」⇒ 入口不能還亮著。
  it('[既有] 未登記額為負(對帳異常)⇒ 關,不留「文字叫你別按、按鈕還亮著」', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: -1 })).toBe(false);
  });

  it('[既有] 未登記額 0 ⇒ 開(0 是合法值,不是「讀不到」)', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: 0 })).toBe(true);
  });

  it('[既有] 未登記額 null(查無)⇒ 開 —— null 不等於失敗,失敗有自己的旗標', () => {
    expect(shouldShowRefundEntry({ ...OK, refundUnregisteredAmount: null })).toBe(true);
  });

  it('[既有] 旗標關 ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, refundEnabled: false })).toBe(false);
  });

  // 型別逐字 = `packages/domain/src/order/types.ts:208`
  //   `export type PaymentChannel = 'tappay' | 'bank_transfer' | 'cash' | 'none';`
  //   ⚠️ 第一版我寫 `'transfer'`(不存在的值)—— typecheck 當場紅,已改。窮舉非 tappay 三值。
  it('[既有] 非 tappay 管道 ⇒ 關(轉帳/現金單不該看到線上退款)', () => {
    for (const ch of ['bank_transfer', 'cash', 'none'] as const) {
      expect(shouldShowRefundEntry({ ...OK, paymentChannel: ch })).toBe(false);
    }
  });

  it('[既有] payment status 不在 allowlist ⇒ 關', () => {
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'unpaid' })).toBe(false);
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'refunded' })).toBe(false);
    expect(shouldShowRefundEntry({ ...OK, paymentStatus: 'partiallyRefunded' })).toBe(true);
  });
});
