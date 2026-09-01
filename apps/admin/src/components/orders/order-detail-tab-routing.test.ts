import { describe, expect, it } from 'vitest';

import { resolveOrderDetailTabFlags } from './order-detail-tab-routing';

// order-detail-tab-routing.test.ts — `moneyTabMustSee` 的 **fail-loud 逐路徑實證**。
//
// 🔴🔴 **為什麼這支檔存在(codex 關卡2 R2 must-fix,2026-08-25)**:
//    §12 組 28 那顆警示圓點的判準就是 `moneyTabMustSee`,而「判不出來的時候它會不會亮」
//    這件事,我原本是**用註解描述上游契約**在宣稱的 —— codex 逐字:
//    「仍只由註解宣稱;瀏覽器 REVOKE 只實證收款 RPC,沒有測到三種退款失敗路徑
//      確實各自產生 `*Failed = true`」。
//    ⇒ **描述一個契約 ≠ 證明它成立。** 這支檔把**下游那一半**換成可重跑的證據。
//    🔴 **上游那一半仍然是契約,沒有被本檔關閉** —— 講清楚免得後面的人把它讀成「已經全驗了」:
//       本檔證的是「**給定**旗標為真 ⇒ 那顆點會亮」;
//       「讀取失敗時上游**真的會**把旗標設成真」是 `order-detail-route.tsx` 的事,本檔碰不到。
//       (codex 關卡2 R3 nit:原本這句寫成「把那個宣稱換成可重跑的證據」,
//        與下面自承「其餘三條仍是上游契約」互相矛盾 ⇒ 會讓下一個審查者誤以為 must-fix 已關閉。)
//
// 🔴 **為什麼 fail-loud 在這裡是承重的**:這顆點旁邊就是錢。判不出來卻**安靜地不亮**,
//    等於告訴員工「這一頁沒事」—— 而那正是它要解的問題。
//    📌 本 repo 碰錢的路徑既有慣例是 fail-CLOSED(逐字:「判不出在哪一側 ⇒ 拒絕」
//       「查不到就不給數字,不編一個」)⇒ 這顆點的正確極性是**寧可多亮**。
//
// ⚠️ **本檔證得到 / 證不到**:
//    證得到 —— 每一條「讀不到 / 沒讀完 / 出錯」的輸入,單獨成立時 `moneyTabMustSee` 為真。
//    **證不到** —— 上游真的會在讀取失敗時把那個旗標設成 `true`(那是 `order-detail-route.tsx` 的事,
//    本檔只吃它的輸出)。收款那一條已由**真後台 REVOKE 實測**補上,其餘三條仍是上游契約。

/** 全部「一切正常」的基準輸入 —— 每一格測試只翻動其中一個,其餘保持乾淨。 */
const CLEAN = {
  refundsFailed: false,
  refundUnregisteredFailed: false,
  manualRefundsFailed: false,
  refundUnregisteredAmount: 0,
  refundsTruncated: false,
  manualRefundsTruncated: false,
  manualRefundRailCapRed: false,
  payments: { status: 'ok' as const, rows: [] },
};

describe('moneyTabMustSee —— fail-loud 逐路徑(組 28 警示圓點的判準)', () => {
  // 🔴 ⟦b4-PCM01RECORD⟧ 2026-09-02 新增的那一條紅(R3/Fable F1)。
  //    少了這一格, 「新增一種紅而沒進分母」這件事**第二次發生時照樣全綠** ——
  //    而它第一次發生時(`refundsTruncated`/`manualRefundsTruncated` 沒接)也是零訊號。
  it('🔴 非卡退款上限紅(超額 或 算不出上限)⇒ **要亮**', () => {
    expect(
      resolveOrderDetailTabFlags({ ...CLEAN, manualRefundRailCapRed: true }).moneyTabMustSee,
    ).toBe(true);
  });

  it('🔴 正常態:全部乾淨 ⇒ **不亮**(沒有這一格,下面每一格都會恆綠)', () => {
    const { moneyTabMustSee } = resolveOrderDetailTabFlags(CLEAN);
    expect(moneyTabMustSee).toBe(false);
  });

  // 🔴 逐條翻動,一次只翻一個 —— 一起翻的話,任何一條壞掉都會被其他條蓋住。
  it.each([
    ['退款讀取失敗', { refundsFailed: true }],
    ['未登記額讀取失敗', { refundUnregisteredFailed: true }],
    ['人工退款讀取失敗', { manualRefundsFailed: true }],
    ['未登記額為負(帳本對不起來)', { refundUnregisteredAmount: -1 }],
    ['退款清單沒讀完', { refundsTruncated: true }],
    ['人工退款清單沒讀完', { manualRefundsTruncated: true }],
    ['收款讀不到', { payments: { status: 'unreadable' as const } }],
    ['收款查無這張單', { payments: { status: 'order_not_found' as const } }],
  ])('🔴 %s ⇒ **亮**(判不出來/沒讀完一律亮,不得安靜地不亮)', (_label, patch) => {
    const { moneyTabMustSee } = resolveOrderDetailTabFlags({ ...CLEAN, ...patch });
    expect(moneyTabMustSee).toBe(true);
  });

  // 🔴 這一格擋的是**極性寫反**:`refundUnregisteredAmount === null` 為假是**對的**,
  //    因為 null 的語意是「真的沒有未登記額」,不是「讀不到」——
  //    讀不到走的是 `refundUnregisteredFailed`(上一組已驗)。
  //    ⚠️ 若哪天有人把「讀不到」也壓成 null,這一格會**繼續綠**而那顆點會安靜地不亮
  //       ⇒ 本檔守不到那件事,它守在 `order-detail-route.tsx`(該處逐字:「失敗≠查無」)。
  it('🔴 `refundUnregisteredAmount === null` ⇒ 不亮(null = 真的沒有,不是讀不到;射程見上方註解)', () => {
    const { moneyTabMustSee } = resolveOrderDetailTabFlags({
      ...CLEAN,
      refundUnregisteredAmount: null,
    });
    expect(moneyTabMustSee).toBe(false);
  });

  it('🔴 `refundLedgerAbnormal` 不含截斷(截斷不是對帳異常,掛紅標題會說謊)', () => {
    // 📌 這一格釘的是 repo 既有的判斷,不是我新增的意見 ——
    //    `order-detail-money-tab.tsx` 逐字:「截斷不是對帳異常,掛那五個字會說謊」。
    //    而**同一組輸入下那顆點仍然要亮**(它的門檻比紅標題低)⇒ 兩個宣稱一起釘。
    const flags = resolveOrderDetailTabFlags({ ...CLEAN, refundsTruncated: true });
    expect(flags.refundLedgerAbnormal).toBe(false);
    expect(flags.moneyTabMustSee).toBe(true);
  });
});
