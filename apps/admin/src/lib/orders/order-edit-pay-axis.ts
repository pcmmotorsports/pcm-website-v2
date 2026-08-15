// order-edit-pay-axis.ts — 改單矩陣專用的**收款軸**(M-4b E10 #13 片1c-1;母 plan §4)。
//
// 🔴 **為什麼另開一支,而不是把 `order-status-axes.ts` 的那支改成 3 值**
//    (母 plan `docs/specs/2026-08-15-e10-13-slice1-edit-amount-plan.md:313-316`,採 0a 推薦的「乙」):
//    那支是**膠囊顯示**那條路上的收款軸,Sean 拍過的八值長相靠它。
//    改它 = 動一個已拍板的顯示契約,而改單矩陣要的只是「這張單能不能改、要不要警告」。
//    ⇒ **膠囊那支一個字不動**;本檔只服務改單。
//
// 🔴🔴 **兩支並存就是下一次漂移的來源,而「並存」本身沒有守門**(母 plan `:317` 逐字)。
//    ⇒ 釘住兩者關係的那格測試在 `order-edit-pay-axis.test.ts`:
//    **本函式回 `partiallyPaid` 時,`orderPayAxis` 必回 `unpaid`**;突變任一支 ⇒ 該格紅。
//    ⚠️ 那格守的是「兩支的對應關係」,**不是**「兩支各自對」——後者各自有自己的格。
//
// ⚠️ **本檔不決定「能不能改」,只回答「錢收到哪了」。** 能不能改的權威在 RPC
//    (`:388` 有任何一列收款 ⇒ RAISE),而**那道閘用的是「有沒有收款列」、不是本軸的值**
//    —— 兩者條件不重疊,不要拿本軸去推論 RPC 會不會放行。
//    (母 plan 檔頭記過同款錯誤:拿一道「條件不重疊」的守門去回答另一個場景。)

import type { PaymentStatus } from '@pcm/domain';

/**
 * 改單矩陣的收款軸:**三值**。
 *
 * 與 `order-status-axes.ts` 的 `OrderPayAxis`(兩值 `unpaid` / `paid`)**刻意不同名也不同值域**
 * —— 同名會讓下一個人以為可以互換。
 */
export type OrderEditPayAxis = 'unpaid' | 'partiallyPaid' | 'paid';

/**
 * `payment_status`(五態)⇒ 改單收款軸(三值)。
 *
 * 對映(逐值寫死,不用 default 兜):
 * - `paid` ⇒ `paid`
 * - `partiallyPaid` ⇒ `partiallyPaid`
 * - `unpaid` ⇒ `unpaid`
 * - 🔴 `refunded` / `partiallyRefunded` ⇒ **`paid`**
 *   理由:退款只發生在**收過錢**的單上。把它們判成 `unpaid` 會讓改單矩陣以為「這張單還沒收錢、
 *   隨便改」——**方向剛好是最危險的那邊**。
 *   ⚠️ 這與 `orderPayAxis` 的處置**不同**(那支把 `refunded` 判成 `unpaid`),
 *   而那支的註解自己寫著「`refunded` 從 `orderStatusView` 就早退了、根本走不到這裡」
 *   ⇒ **它的 `unpaid` 不是一個關於這張單的判斷,而本檔的值是。**
 *
 * 🔴 **沒有 `default` 分支是刻意的**:`PaymentStatus` 新增第六值時,
 * TypeScript 的窮盡檢查會讓這裡**編譯錯誤**,而不是靜默落進某一格。
 * ⇒ 那個 `never` 賦值就是守門本體,拿掉它等於把「新狀態沒人處理」變成靜默通過。
 */
export function orderEditPayAxis(paymentStatus: PaymentStatus): OrderEditPayAxis {
  switch (paymentStatus) {
    case 'paid':
      return 'paid';
    case 'partiallyPaid':
      return 'partiallyPaid';
    case 'unpaid':
      return 'unpaid';
    case 'refunded':
    case 'partiallyRefunded':
      return 'paid';
    default: {
      const exhaustive: never = paymentStatus;
      return exhaustive;
    }
  }
}
