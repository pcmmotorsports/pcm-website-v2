import 'server-only';

/**
 * isBankTransferCheckoutEnabled:顧客站「匯款」結帳路徑的 **action 層閘**(M-4b 段 1, 2026-09-04)。
 *
 * ⛔ ~~原句寫「總開關」~~ **那個詞比它的射程大**(codex 關卡2 R2 nit ③)——
 *   它只擋走 `chargePaymentAction` 的人;直接打 PostgREST `/rpc/create_order` 繞得過去(見下方射程)。
 *   📌 **一個叫「總開關」的東西, 會讓讀的人以為別的入口也被它管著。**
 *
 * 嚴格 opt-in:**只認字面 `'true'`**;未設 / 空 / `'TRUE'` / `'1'` → false
 * (對齊 `three-ds-flag.ts` 與 `CRON_SWEEPER_ENABLED` 的解析紀律)。
 *
 * 🔴 server-only:靜態 `process.env.BANK_TRANSFER_CHECKOUT_ENABLED`(非 computed member access
 *   → 不觸 #182 動態 env 規則、無 client bundle inlining 風險)。
 *
 * ## 🔴🔴 這道閘【不是】為了滾動發布,它擋的是一個會兩邊都付錢的洞
 * ```
 * 🔬 begin_charge_attempt 的 cart-instance dedup
 *    (20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql:441-445)述詞逐字:
 *      a.status = 'charged'
 *      OR o.payment_status = 'paid'
 *      OR (a.status = 'pending' AND o.payment_status <> 'paid')
 * 🛑 匯款單 = unpaid + **零 payment_charge_attempts** ⇒ 三支全假 ⇒ 撈不到
 * ⇒ 🎯 客人先建匯款單、再回頭刷卡 ⇒ dedup 看不見那張匯款單 ⇒ 放行
 * ⇒ ⇒ 🔴 **一張刷卡真的付掉、一張還在等匯款, 而客人可能兩邊都付。**
 * ```
 * 🔵 **同一個盲區的另外兩個受詞**(同族, 不是三個 bug):
 *   · `find_active_sibling_own`(同檔 :336-344)⇒ 反查看不見未付款匯款單
 *   · `reconcile-actions.ts:81-84` ⇒ 建單後回應掉了, 復原流程回 pending、撈不回那張單
 *   📌 根因一句:**它們用「有沒有 charge attempt」當「有沒有進行中的單」的代理**,
 *      而**一條正確的匯款流程不應該建立卡片 attempt** ⇒ 那些述詞對它一律為假。
 *      ⛔ ~~原句「匯款單結構上永遠沒有 attempt」~~ **過強**(codex 關卡2 R2 nit ②):
 *      同一份註解稍後就承認, 分岔沒做之前那條路會走進 `confirmPayment` ⇒ 那正好會建出 attempt。
 *
 * ## 🛑 什麼時候可以翻 true —— **三條, 而不是一條**(codex 關卡2 must-fix ③ 逼出來的)
 * ```
 * ⛔ ~~原句:關閉條件 =「那個述詞看得見匯款單」(主視窗逐字)~~
 *    ⇒ **那句沒有錯, 而它只是三條裡的一條** —— 照原句讀, 補完 ① 就翻, 而那會扣到客人的卡。
 * ✅ 【flag 可啟用條件】三條全成立才可以翻:
 *   ① `begin_charge_attempt` 的 dedup 述詞**看得見匯款單**(主視窗 2026-09-04 逐字, 不是我的形容詞)
 *   ② **匯款的分岔真的做出來了** —— 🔴 今天沒有:flag 翻 true + 客人送 bank_transfer
 *      ⇒ 建單 ⇒ read-back 相符 ⇒ **現行碼繼續走進 confirmPayment ⇒ 拿卡去扣一張匯款單的錢**
 *      (守門格在 `charge-actions.test.ts` 那個 describe 裡, 逐字寫著這件事)
 *   ③ **RPC 那一側也有 opt-in 守門** —— 見下方「射程」
 * ```
 * ## 🛑🛑 射程:**這道閘只擋走 server action 的人, 它不是那個洞的鎖**
 * ```
 * 🔬 `20260904020000_m4b_create_order_payment_channel.sql:533` 逐字
 *    `GRANT EXECUTE ON FUNCTION public.create_order(...) TO authenticated;`
 * ⇒ 🔴 登入中的客人可直接打 PostgREST `/rpc/create_order` 送 bank_transfer, 白名單(同檔 :168)收它
 *    ⇒ **完全不經過本 flag。**
 * ✅ 而今天那條繞路走不通, **理由不是這道閘**:段 1-A 那支 migration **還沒 apply 正式庫**
 *    ⇒ 正式庫的 create_order 沒有第 11 參 ⇒ PGRST202。
 * 🛑 **⇒ 那是一個會過期的理由, 而 Sean 貼下 A 的那一刻它就失效, 沒有東西會叫。**
 * ```
 * ⇒ 板列 `⟦b4-BANKORDERINVISIBLE⟧` 是正本, 本註解是指標。
 *
 * ⚠️ **射程**:本 flag 只擋【顧客站結帳】這條路。後台 `admin_create_manual_order` 的
 *   現金/匯款那條**不受它管**, 也不該受 —— 那條是員工手動建單, 沒有客人連按兩下的形狀。
 */
export function isBankTransferCheckoutEnabled(): boolean {
  return process.env.BANK_TRANSFER_CHECKOUT_ENABLED === 'true';
}
