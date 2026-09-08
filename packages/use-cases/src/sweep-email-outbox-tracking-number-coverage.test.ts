import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPRESS_WHEN_ORDER_INELIGIBLE } from '@pcm/ports';
import type { EmailOutboxEventType } from '@pcm/ports';

/**
 * ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ —— **「寄了信而沒記下它印的號碼」在碼層的量具。**
 *
 * 🔬 **為什麼是這一格, 而不是再寫兩個行為測試**(2026-09-06 `-ship` 實測出來的):
 * `sweep-email-outbox.ts` 那個三元式已經有兩支被守到了 —— 我拿突變證過, **不是讀碼推的**:
 *   · 把 `order_shipped` 那支改成恆 `null` ⇒ `Tests 1 failed | 128 passed`
 *     (紅在「🔴 有追蹤碼 ⇒ markSent 帶著【信裡印的那個號碼】落表」)
 *   · 把 `shipment_tracking_corrected` 那支改成恆 `null` ⇒ 同樣 `1 failed | 128 passed`
 * ⇒ 📌 **那兩支不需要再補測試。**
 *
 * 🛑 **而【第三支】沒有任何東西在守**:那個三元式的結尾是一個裸的 `: null`。
 *    `buildEmailText` 的 `switch` 有 `satisfies never` ⇒ 加一個新 event_type **會**逼你補模板;
 *    🔴 **而號碼那個三元式沒有那道保險** ⇒ 新的 event_type 會**靜靜掉進 `: null`**
 *    ⇒ 那封信在紙上印了一個號碼, 而我們記下來的是「沒告訴過他號碼」
 *    ⇒ 掃描面判成「不用寄更正信」⇒ **客人永久拿著錯號碼, 而每一把綠都是綠的。**
 *
 * ✅ **這一格把「記得去改」換成「不標就編不過」**(形狀照 `SUPPRESS_WHEN_ORDER_INELIGIBLE` 自己):
 *    下面那個 `Record<EmailOutboxEventType, …>` 對 union 是**窮舉**的
 *    ⇒ 加一個 event_type 而沒標這一格 ⇒ **typecheck 當場紅**。
 *
 * 🛑 **它證不到什麼(照實寫, 不要把它讀得比它大)**:
 *    · 它**不驗行為** —— 它不跑 sweep, 所以它答不出「那一支真的取到號碼了嗎」。
 *      那個問題由上面那兩格行為測試回答, 而**它們只涵蓋兩支**。
 *    · 它**答不出**一個標成 `'none'` 的 event_type 是不是標錯了 —— 標籤是人填的。
 *      它保證的是**有人被迫填**, 不是**填對**。
 *    · ⇒ 📌 **所以判別句寫在下面那個 Record 的註解裡**, 讓填的人有東西照著填。
 */
describe('⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 每一種信都要表態:它印不印追蹤號碼', () => {
  /**
   * 🎯 **判別句(加新 event_type 時照這句填, 不要照抄旁邊那一格)**:
   * ```
   * 這封信的內文裡會出現【一個貨運追蹤號碼】嗎?
   *   會   ⇒ 標 'records-number' ——【而且】你必須去 sweep-email-outbox.ts 的
   *          sentTrackingNumber 三元式補一支, 並補一個行為測試斷言 markSent 帶著它
   *   不會 ⇒ 標 'no-number'(掉進裸的 `: null` 是【對的】)
   * ```
   * 🔴 **標 'records-number' 卻沒去補那個三元式 ⇒ 這一格【看不出來】** ——
   *    它是分母守門, 不是行為守門。那一半靠下面那條 key 集合斷言之外的行為測試。
   */
  const PRINTS_TRACKING_NUMBER: Record<EmailOutboxEventType, 'records-number' | 'no-number'> = {
    // 取消通知:講的是這張單沒了, 沒有箱、沒有號碼
    order_cancelled: 'no-number',
    // 付款成功通知:這時候還沒出貨
    order_created: 'no-number',
    // 🔴 出貨通知:信裡就印著那個號碼 ⇒ 三元式取 shipped?.trackingNumber
    order_shipped: 'records-number',
    // 未付款自動取消:同 order_cancelled
    order_unpaid_cancelled: 'no-number',
    // 🔴 更正信:整封信就是為了那個號碼 ⇒ 三元式取 payload.tracking_number
    shipment_tracking_corrected: 'records-number',
    // 匯款待付款通知:還沒出貨
    bank_order_created: 'no-number',
    // QB-16 部分退款通知(2026-09-08):講的是【退回去的錢】—— 沒有箱、沒有號碼。
    // 🔵 照判別句走過:本封信的內文只有訂單編號 / 退款金額 / 會員中心連結 / 聯絡資訊,
    //    `buildOrderPartiallyRefundedText` 裡零貨運欄位 ⇒ 'no-number'。
    order_partially_refunded: 'no-number',
  };

  it('🔴 分母 = 生產碼裡那個窮舉 Record, 不是我自己抄的一份清單', () => {
    // 🛑 **為什麼要比 key 集合而不是比個數**:個數相等而內容不同會通過
    //    (換掉一個 event_type 的名字 ⇒ 兩邊都是 6)⇒ 本 repo 記過這一族。
    const mine = Object.keys(PRINTS_TRACKING_NUMBER).sort();
    const theirs = Object.keys(SUPPRESS_WHEN_ORDER_INELIGIBLE).sort();
    expect(mine).toEqual(theirs);

    // 🟢 **正對照**:分母不是空的 —— 少了這一格, 兩邊都是 `[]` 時上面那句照樣綠,
    //    而那個世界裡這道守門根本沒有接上任何東西。
    expect(theirs.length).toBeGreaterThan(0);
  });

  it('🔴 每一種都必須表態(沒有第三種值, 也不准漏)', () => {
    const values = Object.values(PRINTS_TRACKING_NUMBER);
    expect(values).toHaveLength(Object.keys(SUPPRESS_WHEN_ORDER_INELIGIBLE).length);
    for (const v of values) expect(['records-number', 'no-number']).toContain(v);

    // 🟢 **正對照**:兩種值都真的出現過 —— 否則「全部標成 no-number」也會通過,
    //    而那正是本片要防的那個世界(所有人都掉進裸的 `: null`)。
    expect(values).toContain('records-number');
    expect(values).toContain('no-number');
  });

  it('🔴 標成 records-number 的那幾種, 在生產碼那個三元式裡真的有一支分支', () => {
    // 🔴🔴 **這一格是本檔唯一一條【跨到生產碼】的線** ——
    //    上面兩格只是我自己抄的兩份東西互相比對(它們擋的是「漏填」),
    //    而如果沒有這一格, 一個標成 records-number 卻**沒去補三元式**的 event_type
    //    會讓上面兩格【全綠】⇒ 📌 那就是本片要防的那個世界原封不動地回來。
    const src = readFileSync(join(__dirname, 'sweep-email-outbox.ts'), 'utf8');
    const start = src.indexOf('const sentTrackingNumber');
    // 🟢 **正對照**:先證這把尺抓到東西了 —— 抓不到時下面每一格都會是【假綠】
    //    (`indexOf` 回 -1 ⇒ slice 從尾巴切 ⇒ 空字串 ⇒ 每個 includes 都 false ⇒ 那是紅, 而
    //     若我寫成「不在就跳過」就會變成假綠)。
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 900);

    for (const [eventType, v] of Object.entries(PRINTS_TRACKING_NUMBER)) {
      if (v !== 'records-number') continue;
      expect(block, `${eventType} 標成 records-number, 而三元式裡沒有它的分支`).toContain(
        `'${eventType}'`,
      );
    }

    // ⚪ **負對照**:一個現造的 event_type 名字【不該】在那段裡 ——
    //    少了它, 「toContain 永遠為真」(例如 block 變成整個檔案)也會全綠。
    expect(block).not.toContain('zz_never_an_event_type');

    // ⚠️ **它證不到什麼**:字面尺繞得過(別名 / 把字串放進變數 / 用常數)。
    //    它擋的是最常見的那一種:標了而忘了補。
  });
});
