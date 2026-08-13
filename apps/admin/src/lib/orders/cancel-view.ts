// cancel-view.ts — M-4b E10 A13a 前置:訂單可否取消的判定與可取消量計算(純函式,零 IO / 零 JSX / 零 Next 依賴)。
//
// 🔴🔴 **本檔的判定一律是 advisory,不是保證。** 權威永遠是 `admin_cancel_order` 在交易內的重查
//    (`supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql` 步5-步8)。
//    讀到這裡的值與員工按下去之間,單子隨時可能被別人動過 ⇒ **RPC 回拒是正常路徑**,
//    要當一般結果顯示,不是「不該發生」的例外(同 `types.ts:824-828` 對 `chargeAttemptGate` 的立場)。
//    本檔判錯的代價封頂在 UX(按鈕誤亮 → 送出被拒 → 導頁、輸入不保留要重填),**動不到錢**。
//
// 🔴 **為什麼要有這一層**(而不是把判定寫進 tsx):這些條件全是「誰的單能被取消、最多能取消幾件」,
//    屬錢與權限的正確性。寫在 tsx 裡只能靠 render 測試驗,突變(把某道閘拿掉)不好釘;
//    抽成純函式後每條拒因都能寫只紅它一條的負測。
//
// 🔴 **鏡像紀律**:本檔鏡像的是 RPC 的**單層閘與可取消量式**,逐條在下方註明出處行號。
//    RPC 端改了守門,這裡沒改 = 兩份規格漂移 ⇒ 兩處都要改才算改完(同 `cancel-form.ts:52` 的紀律)。
//
// 🔴 **與 RPC 不一致的地方,窮舉如下**(關卡2 codex 打掉原本「只有三處、方向一律更保守」那句 ——
//    那句話有兩處不實:漏了兩條額外阻擋,而且 `INSTOCK_PROXY` 有一個方向**比 RPC 寬**):
//    ① **步6 actor 必須是 `is_active` 的 staff**(RPC `:354-357`)**完全不鏡像** —— 本函式收到的
//      是訂單投影,裡面沒有「當前操作者是誰」;那道閘由 server action 的授權閘(`authorize.ts`)
//      與 RPC 各自把關。代價 = 停用中的員工看得到按鈕、送出被拒(UX,不動錢)。
//    ② `SUMMARY_FAIL_CLOSED` + `ZERO_INFERENCE`:摘要缺列時,五項權威前提全成立才推 `0/0`、否則擋。
//      五項全成立 ⟺ 真相為零 ⟺ RPC 那道閘不觸發 ⇒ **這一格與 RPC 對齊、不再更嚴**
//      (確認輪 R2 已驗;初版寫的「一律擋」是誤加的閘,見 `ZERO_INFERENCE`)。
//    ③ `items_truncated`:RPC 沒有這條(它看得到全部品項),UI 看不全就不給複核(**比 RPC 嚴**)。
//    ④ `cancellations_unreadable`:同上,RPC 直接讀表(**比 RPC 嚴**)。
//    ⑤ 🔴 `INSTOCK_PROXY`:整單模式的「有到貨」用快取代理真相表 —— **兩個方向都會錯**。
//      快取非 0 / 真相 0 ⇒ 少給一個選項(比 RPC 嚴);**快取 0 / 真相非 0 ⇒ 整單取消誤開**
//      (比 RPC 寬)。後者的代價封頂在「按下去被 RPC 拒」,動不到錢,但**不能宣稱一律更保守**。
//
// 🔴 **呼叫端邊界(R1 N6)**:本函式的入口是結構型別,**只准餵明細投影**
//    (`mappers/order.ts:734` 的 `mapQuantitySummary`,缺列 → `null`)。
//    **列表投影不行** —— 它走 `mapListQuantitySummary`(`:335`)、缺列補 0(`:291` 那段「補 0 只在純顯示成立」),
//    餵進來會讓 `quantity_summary_missing` 這道 fail-closed 靜默失效,而型別不會報錯。

import type {
  AdminOrderCancellation,
  AdminOrderDetail,
  AdminOrderDetailItem,
} from '@pcm/domain';

/**
 * P 窗生命週期線 L3 對「未付款逾時自動失效」寫進 `orders.cancelled_reason` 的字面
 * (Sean 2026-08-09 拍 Q1=A:失效沿用 `cancelled_at` + `cancelled_reason='payment_expired'`,
 *  plan `docs/specs/2026-08-09-order-payment-lifecycle-plan.md:81`;主視窗 `E-003-A` §4.2 裁示照它寫文案)。
 *
 * 🔴 L3 **施工中、尚未 apply** ⇒ 現階段這個值在正式庫不會出現,本常數是**先接住**它。
 *    它不會讓任何目前可取消的單變成不可取消 —— 兩條路都落在「已取消」那道閘裡,
 *    差別只在給員工的那句話(「已被取消」vs「未付款自動失效」)。
 */
export const PAYMENT_EXPIRED_CANCEL_REASON = 'payment_expired';

/**
 * 整張單不能取消的理由。**可以同時成立多條**,因此 `blockReasons` 是陣列而不是單一碼:
 * 只回第一條會讓員工修掉一個問題、重新整理、再撞下一個。
 *
 * 🔴 **本聯集是 11 碼,plan 的「八條拒因逐條文案」(`docs/specs/2026-08-05-e10-cancel-ui-wire-plan.md:192`)
 * 是 RPC 的八個條件、不是 UI 的碼數**(關卡2 codex R2 nit):本層把「看不到」的幾種情況拆成獨立碼
 * (`charge_attempt_unknown` / `items_truncated` / `cancellations_unreadable` / `quantity_summary_missing`),
 * 因為它們對員工的處置不同。⇒ **A13a 的文案表要照這個聯集寫滿 11 條**,照 plan 的「八條」會漏。
 * 型別層有保險:`Record<OrderCancelBlockReason, string>` 少寫一條就轉紅。
 */
export type OrderCancelBlockReason =
  /** `orders.cancelled_at IS NOT NULL`(RPC 步5 第一道,`20260805100000:339-341`) */
  | 'already_cancelled'
  /** 同上,但 `cancelledReason` = L3 的自動失效字面 ⇒ 文案不同(見 `PAYMENT_EXPIRED_CANCEL_REASON`) */
  | 'payment_expired'
  /**
   * `payment_status <> 'unpaid'`(RPC 步7,`:360`)。
   * 🔴 **交接註記(R3 N6,缺口在 RPC 不在本檔,別讓它靜靜過去)**:Sean 2026-07-26 拍板逐字
   * 「已付款可取消」(memory `project_m4b-admin-preview-decisions`),而第 1 批的 RPC 對已付款單
   * 一律 fail-closed(母 plan row 65 `:412`:「取消需退款,退款線第 3 批開通」)。
   * ⇒ A13a 照本碼寫文案時,要寫成**「這期還不行、第 3 批開通」**,不是「不能取消」——
   * 否則員工會以為那是永久規則,與 Sean 的拍板衝突。
   */
  | 'payment_not_unpaid'
  /**
   * 明確觀察到非 `failed` 的扣款嘗試(RPC 步7 第二半,`:361-364`)。
   * 🔴 **本碼只在 `paymentStatus === 'unpaid'` 時出現**(#387,理由與失效條件見
   * `buildOrderCancelView` 內該行的註解)——已付款單上那筆非 failed 的嘗試是**付款成功的那一筆**,
   * 掛本碼等於告訴員工「還在進行中」。**RPC 那一側沒有跟著收窄**(它照樣擋),收窄的只有文案面。
   */
  | 'charge_attempt_blocked'
  /**
   * 扣款嘗試**沒讀到或只讀到子集** ⇒ 沒看到的那些可能就有一筆在途(`types.ts:844` 三態的 `'unknown'`)。
   * 🔴 文案要求同 `cancellations_unreadable`(R3 N1):成因之一是**投影退版 / 內嵌鍵沒回來**,
   * 那種情況**重新整理不會好** ⇒ 不可只寫「請重新整理」,要帶「若重整後仍相同,請通知系統維護」。
   */
  | 'charge_attempt_unknown'
  /** 品項清單被截斷 ⇒ 影響範圍是漏的,不可複核(plan §1.4;`AdminOrderDetail.itemsTruncated`) */
  | 'items_truncated'
  /** 零品項單(RPC 步8 第一道,`:372-375`) */
  | 'no_items'
  /**
   * 任一品項讀不到三軸摘要**且推不出 0**⇒ fail-closed,見 `SUMMARY_FAIL_CLOSED` 與 `ZERO_INFERENCE`。
   *
   * 🔴 **`E-007-A` Q1=A 之後,本碼的意思收窄了**(R3 F4:訊號判別力的恢復):
   * 修法之前它在**每一張沒採購過的單**上亮 ⇒ 員工必然學會忽略。修法之後它只在下列兩種**真異常**時亮:
   *   ① 「**有採購活動或取消活動、卻沒有摘要列**」= A4a 應該建列卻沒建
   *      (或 `mappers/order.ts:557` 偵測到 C7 不變式被違反);
   *   ② **採購內嵌投影讀不全**(`procurementTruncated`;來源含「內嵌鍵整個沒回來 = 投影退版」,
   *      `types.ts:521-523`)⇒ 推不出「零採購」這個前提。
   * ⇒ A13a 的文案照這個意思寫:兩種都不是「等一下再試」,是**「請通知系統維護」**。
   *
   * 🔴 **為什麼 ② 不比照 `itemsTruncated` / `ledger.unreadable` 一起抑制**(確認輪 R3 MF-ii 的處置):
   * 那兩者各自**有自己的碼**(`items_truncated` / `cancellations_unreadable`)會擋住整張單,
   * 抑制本碼只是少吐一句誤導的話;而 `procurementTruncated` **沒有對應的碼** ——
   * 抑制它會讓「上限算不出來」卻**一個拒因都不吐** ⇒ `canCancel` 變成 `true` = **fail-open**。
   * ⇒ 寧可讓本碼多涵蓋一種情境(兩種的指路文案相同),也不製造一個沒人擋的洞。
   * 該不變式由測試「抑制發生時一定有別的碼擋住」釘住。
   */
  | 'quantity_summary_missing'
  /**
   * 帳本病理(RPC 步5 第二道,`:342-352`)。
   *
   * 🔴 **三種病理共用一碼是刻意的**(R1 N2):①`cancelled_reason` 殘留 ②Σci > quantity
   * ③零明細 header —— 三者對員工的**處置完全相同**(都不是他能修的,一律「通知系統維護」),
   * 分成三碼只會讓訊息表多兩列而畫面行為一模一樣。要分辨是哪一種,看的是 log 不是 UI。
   */
  | 'ledger_unhealthy'
  /** 取消歷程沒讀到或被截斷 ⇒ 病理②③ 可能藏在沒看到的那批裡,見 `LEDGER_FROM_TRUTH` */
  | 'cancellations_unreadable'
  /** 每個品項的尚可取消量都是 0 ⇒ 整單模式與部分模式都送不出去 */
  | 'nothing_cancellable';

/** 判定所需的最小訂單形狀。用 `Pick` 綁住真型別 ⇒ 上游欄位改名會在型別層轉紅,不是靜默失效。 */
export type CancelViewOrder = Pick<
  AdminOrderDetail,
  | 'paymentStatus'
  | 'cancelledAt'
  | 'cancelledReason'
  | 'chargeAttemptGate'
  | 'itemsTruncated'
  | 'cancellationsTruncated'
> & {
  /**
   * 🔴 **`procurementTruncated` 兼兩個角色**:①`E-007-A` Q1=A 之後,它是「缺摘要列能不能推 0/0」的
   * 前提之一(採購清單被截斷 ⇒ 推不出「零採購」)②「投影判別欄」(主視窗 `E-005-A` §6-5 裁示「要擋」)。
   *
   * 問題:入口是結構型別 ⇒ 列表投影的品項(`AdminOrderLine`)只要形狀相容就餵得進來,
   * 而那條路的 `quantitySummary` 走 `mapListQuantitySummary`(`mappers/order.ts:335`)、**缺列補 0**
   * ⇒ `quantity_summary_missing` 這道 fail-closed 會靜默失效,而型別零報錯。
   *
   * 機制:`AdminOrderDetailItem` 有這個欄位、`AdminOrderLine` **沒有**(前者 10 欄、後者 11 欄,
   * 差集含 `spec` / `procurements` / `procurementTruncated`)⇒ 餵列表品項是**編譯期錯誤**,不是執行期驚喜。
   * 成本 = 每個測試 fixture 多一格布林,不必造全物件。
   * 守門:`cancel-view.test.ts` 有一條 `@ts-expect-error` 把它釘住 —— 這個欄位一旦被拿掉,
   * 那個指令變成「未使用」⇒ **`tsc` 轉紅**(TS2578)。⚠️ 它由 typecheck 守、**不是** vitest,
   * 突變自驗要跑 `tsc --noEmit` 才看得到(見該測試的註解)。
   */
  items: readonly Pick<
    AdminOrderDetailItem,
    'id' | 'quantity' | 'quantitySummary' | 'procurements' | 'procurementTruncated'
  >[];
  /**
   * 🔴 `itemsTruncated` **必須一起收**(R1 N4):病理② 從這裡逐品項加總算出來,
   * 而截斷過的那列只回子集 ⇒ 少算 Σci = fail-open。`types.ts:725-726` 逐字講的「前提關係」。
   */
  cancellations: readonly Pick<AdminOrderCancellation, 'items' | 'itemsTruncated'>[] | null;
};

/** 單一品項的取消視圖。`null` 一律是「不知道」,**不是 0**。 */
export type CancelItemView = {
  orderItemId: string;
  /**
   * 客人買的數量。🔴 **恆有值**(R3 N5):取自真相 `order_items.quantity`
   * (`AdminOrderDetailItem.quantity`,`types.ts:505`),不是摘要快取 ⇒ 摘要缺列也知道買了幾件。
   */
  quantity: number;
  /** 已到貨數量;`null` = 不知道(摘要缺列且推不出 0,見 `ZERO_INFERENCE`) */
  instockQuantity: number | null;
  /**
   * 🔴🔴 **本視圖刻意不帶 `shippedQuantity`(L0,2026-08-13)。**
   *
   * L0 把第四軸 `shipped` 補進了 `AdminOrderItemQuantitySummary`,但**取消流程不得看它**:
   * 可取消量 = `quantity − instock − cancelled`,而 `shipped ⊆ instock`(Sean 2026-08-05 拍板
   * 「出貨必先到貨、無直送」)⇒ 再減一次 shipped 是**重複扣**,會把可取消量算小、
   * 讓畫面顯示「不能取消」而實際上還能取消。
   * ⇒ 不把它放進本視圖 = 讓**下游消費端**寫不出這個錯。
   *
   * 🔴🔴 **但這道防線只蓋到下游,不蓋到本檔(R1 MF4 收窄我原本的宣稱)**:
   * 本檔 `buildCancelItemView` 拿到的是**完整的** `AdminOrderItemQuantitySummary`,
   * 而可取消量的算式就在同一支函式裡 ⇒ **`summary.shippedQuantity` 在那一行完全可及、零型別阻力**。
   * 「順手減一下」最可能被寫的地方**就是那一行**,而它在本防線之外。
   * ⇒ 我原本寫「結構上讓這個錯寫不出來」是**宣稱過強**;真正蓋住那一行的是
   *   `cancel-view.test.ts` 的 source-scan 守門(形狀照 `shipment-repository.test.ts` 的同型先例)。
   * ⚠️ 要拿 shipped 做取消判斷得先推翻那條拍板,不是在這裡加一個欄位。
   */
  /** 已取消數量(歷次累計);`null` = 不知道(同上) */
  cancelledQuantity: number | null;
  /**
   * 這個品項**這次最多能勾幾件**;`null` = 摘要沒讀到 ⇒ **不給勾**。
   *
   * 值 = `min(cancellableQuantity, quantity − instock − cancelled)` 再 clamp 到 `>= 0`
   * (式子出處 `types.ts:582` 與 RPC `:395-406`;取 min 的理由見 `toItemView`)。
   *
   * 🔴 **clamp 與 min 的理由都是「入口型別允許、真實 mapper 產不出」**(R1 MF2 更正原本寫反的理由):
   * `mappers/order.ts:557` 在 `instock + cancelled > quantity` 時整列回 `null`
   * (C7 CHECK `20260730150000:123-124` 的應用層鏡像)⇒ 經由真實明細投影進來的值恆 `>= 0`。
   * 但本函式的入口是結構型別、擋不住手寫的負數,clamp 是純防禦 —— 它**不是**在處理帳本病理②,
   * 那條走 `ledger_unhealthy`(見 `LEDGER_FROM_TRUTH`)。
   */
  maxCancellable: number | null;
};

/**
 * 這個品項**這次勾得動嗎**。`maxCancellable` 為 `null`(上限算不出來,見 `SUMMARY_FAIL_CLOSED`)
 * 或 0 ⇒ 勾不動。
 *
 * 🔴 **匯出是為了讓「哪些品項可選」只有一份**(A13b D4 R1 must-fix 5):D4 的部分取消表單
 *    原本自己寫了一份逐字相同的 `maxCancellable !== null && > 0`,而它同時宣稱「判定不在本檔」。
 *    兩份的漂移面很具體:本檔日後若給「可選」加第三個條件(例如鎖定中的品項),
 *    表單那份不會跟著改 ⇒ 畫出一顆勾得到的 checkbox、員工勾了送出被 RPC 拒
 *    ⇒ 看到「這張單目前不能取消」這句**誤導**的話。
 * ⚠️ 型別述詞(`item is … & { maxCancellable: number }`):`.filter()` 之後
 *    `maxCancellable` 才收窄成 `number`,消費端不必再 `!` 或再判一次 null。
 */
export function isItemSelectable<T extends Pick<CancelItemView, 'maxCancellable'>>(
  item: T,
): item is T & { maxCancellable: number } {
  // 🔴 **要正整數,不只是 `> 0`**(R2 codex nit):`1.5` 與 `Infinity` 都通得過 `> 0`,
  //    而表單把它組成 `<uuid>:1.5` 送出去後,解析器的 `/^[0-9]+$/`(`cancel-form.ts:146`)必拒
  //    ⇒ 畫面上勾得到、送出去卻整份 `{ok:false}` 且輸入不保留。
  //    入口是結構型別、擋不住手寫值,所以這道是**純防禦**——與 `toItemView` 的 clamp 同一性質。
  return (
    item.maxCancellable !== null &&
    Number.isSafeInteger(item.maxCancellable) &&
    item.maxCancellable > 0
  );
}

export type OrderCancelView = {
  /** ⟺ `blockReasons.length === 0` */
  canCancel: boolean;
  blockReasons: OrderCancelBlockReason[];
  /**
   * 能不能選「整單取消」。
   *
   * RPC 整單路徑額外兩道:①任一品項**有到貨** ⇒ 拒(`:409-416`)②全增量為 0 ⇒ 拒(`:422-424`)。
   * ⇒ 有任何一件到貨的單,只能逐品項取消。
   *
   * 🔴 **「部分取消可不可以」不另立欄位**(R1 T4):`canCancel === true` 已經蘊含「至少一個品項勾得動」——
   * 空品項走 `no_items`、缺摘要走 `quantity_summary_missing`、全零走 `nothing_cancellable`,三條都會讓
   * `canCancel` 變 false。多一個恆等於 `canCancel` 的欄位 = 一個永遠寫不出負測的斷言。
   * ⇒ **部分取消 ⟺ `canCancel`**。
   */
  fullCancelAllowed: boolean;
  items: CancelItemView[];
};

/**
 * SUMMARY_FAIL_CLOSED — 「上限算不出來」的品項一律不給勾。
 *
 * ⚠️ **這裡只判「算不算得出來」,不判「為什麼算不出來」** —— 能不能從缺列推出 `0/0`
 * 由 `ZERO_INFERENCE`(五項前提)決定,推得出來的品項在這裡就不是 `null` 了。
 * 依據:`types.ts:542` 逐字「`null` 時一律 fail-closed」+ memory `feedback_guard-reads-non-authoritative-cache`。
 *
 * 🔴 **本函式的結果不等於 `quantity_summary_missing` 會亮**:呼叫端在
 * `order.itemsTruncated` 或 `ledger.unreadable` 時**刻意不報那個碼**(兩者各有自己的碼、且都已擋住),
 * 理由見那兩行的註解 —— 目的是讓那個碼保持「真異常」的判別力。
 */
function hasMissingSummary(items: readonly CancelItemView[]): boolean {
  return items.some((item) => item.maxCancellable === null);
}

/**
 * 整單取消可不可以選。整單取消會把每個品項的**剩餘全部**取消掉(RPC `:417-424` 的 `quantity − Σci`),
 * 所以只有在「每個品項顯示的上限 === 它的剩餘量」時,畫面上的數字才與實際會發生的事一致。
 *
 * 本條擋的是:摘要內部不一致(`cancellable` 欄比三軸自算值小)時,畫面說「最多取消 1 件」
 * 而整單取消會取消 5 件 —— 員工看到的與實際發生的不同(關卡2 codex R2)。
 * 這時只留逐品項模式,讓每個數字都是他自己勾的。
 *
 * 🔴🔴 **它不取代 `hasAnyInstock`(R3 F3 推翻我 R2 的推論,那條守門已還原)**。
 * 我當時的論證是「`instock > 0` ⇒ 上限必定小於剩餘量 ⇒ 本條嚴格蘊含到貨閘」,**那是錯的**:
 * `maxCancellable` 外面那層 `Math.max(0, …)` 會把負的 `derived` **抬回 0**,而
 * `quantity === cancelled` 時 `quantity − cancelled` 也是 0 ⇒ 兩者相等、本條回 true。
 * 反例:`{quantity:5, instock:3, cancelled:5, cancellable:0}` ⇒ `derived = −3` → clamp 0 = `5 − 5`
 * ⇒ 整單取消會被誤開,而該品項有到貨 3 件、RPC `:409-416` 必拒。
 * 🔴 **推論方法本身也要撤回**:我當時的依據是「拿掉 `hasAnyInstock` 後 32 組突變零紅」——
 * 突變零紅**只證明測試沒覆蓋那個形狀**(這裡就是沒覆蓋 C7 違規的 fixture),**不證明嚴格蘊含**。
 * memory `feedback_unconstructible-negative-test-means-noop-guard` 講的是「構造不出負測」,
 * 而這裡是「我沒去構造」——兩者不同,當時我把後者當成前者用了。
 *
 * 🔴 **INSTOCK_PROXY 的殘餘風險在這裡承接**:`instock` 取自惰性快取而非 RPC 讀的真相表
 * `order_item_procurement_receipts`(`:409-416`),兩者由 A4a trigger 維持一致但快取可能落後。
 * **兩個方向都會錯,而且都不只是「少一個選項」**(codex R2 打掉我原本說輕了的字面):
 *   ① 快取 0 / 真相非 0 ⇒ 整單取消**誤開**(比 RPC 寬),按下去被 RPC 拒;逐品項上限也偏高。
 *   ② 快取非 0 / 真相 0 ⇒ 上限偏低;極端情況(快取到貨 = 買的量)會讓每個品項上限都變 0
 *      ⇒ **整張單錯報 `nothing_cancellable`**,員工完全按不到,而 RPC 其實會放行。
 * 兩者的代價都封頂在 UX(誤開 = 送出被拒;誤擋 = 按不到),**動不到錢**——
 * 權威永遠是 RPC 在交易內從真相表重算(`:395-406`)。
 */
function hasAnyInstock(items: readonly CancelItemView[]): boolean {
  return items.some((item) => item.instockQuantity !== null && item.instockQuantity > 0);
}

function everyItemFullyCancellable(items: readonly CancelItemView[]): boolean {
  return items.every(
    (item) =>
      item.cancelledQuantity !== null &&
      item.maxCancellable === item.quantity - item.cancelledQuantity,
  );
}

/**
 * LEDGER_FROM_TRUTH — 帳本病理② 從**取消歷程真相**算,不從摘要快取算(R1 MF1)。
 *
 * 為什麼不能用摘要:`mappers/order.ts:557` 已經在 `instock + cancelled > quantity` 時把整列翻成
 * `null` ⇒ 「`summary.cancelledQuantity > summary.quantity`」在真實資料上**恆假**,寫了也是死碼,
 * 而員工會看到「數量資料尚未就緒」這句**錯的**指路(該找工程師的事被說成等一下重整就好)。
 * 真相在手上:`cancellations[].items[].cancelledQuantity` 逐品項加總,正是 RPC `:343-346` 在做的事。
 *
 * 🔴🔴 **病理③(零明細 header)在 UI 上觀測不到 —— 關卡2 codex 抓到的第二個同型死碼。**
 * `mappers/order-cancellations.ts:86` 逐字 `if (!rows || rows.length === 0) return { items: null, … }`
 * ⇒ **真的零明細的 header,到這裡長得跟「沒讀到」一模一樣**,兩者都落 `cancellations_unreadable`。
 * 下面的 `emptyHeader` 因此是**純防禦**(入口是結構型別、擋不住手寫的 `[]`),
 * **不得**被當成「病理③ 有被偵測」的證據。
 * ⇒ 🔴 **A13a 的文案必須把兩種可能都講**(=E 窗施工序的下一片;plan 原本把 A13a 編為「片 6」,
 *   本窗多切了一片純函式在前,所以片號差一,**以 A13a 這個代號為準、不要對片號**):
 *   `cancellations_unreadable` 不能只寫「讀取不完整,請重新整理」,
 *   要留一句「若重新整理後仍相同,請通知系統維護」——因為它有可能其實是帳本毀損。
 *
 * 🔴 **算得出來的就算,不因為有一列看不到就整包放棄**(關卡2 codex:early return 會吃掉**已經確定成立**
 * 的病理②)。看不到的列只會讓 Σci 變成**下界** ⇒ 下界都已經超過 `quantity` 的話,病理② 是確定的。
 * 兩個旗標各自獨立回報,`blockReasons` 可以同時出現。
 * ⚠️ **「下界」還隱含一個沒寫下來的前提**(R3 N4):投影不會給出**重複或幻影的明細列**。
 * 目前成立(PostgREST 單次查詢的內嵌結構,一列就是一列);日後若改成多次查詢再合併,
 * 這個前提會靜默失效、Σci 變成上界 ⇒ 病理② 會誤報。改查詢形狀的人要回頭看這一段。
 *
 * ✅ **R3 N5 已修**:比較基準改用**真相** `AdminOrderDetailItem.quantity`(`types.ts:505`,
 *   由複合 FK 物理保證等於 `order_items.quantity`),不再用摘要快取的 `quantity`
 *   ⇒ 摘要缺列的品項現在**照樣**檢查病理②(以前那些品項是完全跳過的)。
 * ⚠️ **R3 N3 仍是缺口(明文不修)**:RPC(`:343-346`)按 `ci.order_item_id` 加總、
 *   **不限 header 屬哪張單**;本函式只掃本單 header 底下的明細 ⇒ 跨單腐壞列 UI 偵測不到。
 *   要補得讓投影帶「該品項的全域 Σci」,那是 A9g 的擴充。方向 fail-open,但前提是跨單腐壞(極端)。
 *
 * 🔴 四種「看不到」(逐條都會讓 Σci 少算 = fail-open,故一律標 unreadable):
 *   ① `cancellations === null`(沒讀到,`types.ts:712`)
 *   ② 外層 `cancellationsTruncated`(被切掉的列連同旗標一起消失,`types.ts:725-726`)
 *   ③ 任一列 `items === null`,或該列 `itemsTruncated`(子集)
 *   ④ 🔴 明細列的 `cancelledQuantity` **不是有限的正整數**(關卡2 codex R1+R2):
 *      `null` 在 JS 裡 `0 + null === 0` 會靜默少算;**負數會讓「可讀總和是下界」這個推論整個失效**
 *      (`+6` 後面跟一個 `-2` 會把 6 沖成 4)。DB 端有 `CHECK (cancelled_quantity > 0)`
 *      (`20260730130000:247`),所以這是**執行期**防禦 —— `mappers/order-cancellations.ts:88-93`
 *      逐欄直送、**沒有** `mapQuantitySummary` 那道 `Number.isFinite` 守門。
 *   ⑤ 明細列的 `orderItemId` **不在本單的品項清單裡**:代表品項清單與歷程對不起來,
 *      不可當成「那個品項沒被取消過」。
 *      🔴 **但 `itemsTruncated` 為 true 時不算**(關卡2 codex R2):那時品項清單本來就是子集,
 *      歷程提到看不見的本單品項是**正常的**,標成 unreadable 只是多吐一個錯碼。
 *      該情境已由 `items_truncated` 擋住。
 */
function readCancellationLedger(
  order: CancelViewOrder,
): {
  unreadable: boolean;
  emptyHeader: boolean;
  overCancelled: boolean;
  cancelledByItem: Map<string, number>;
} {
  const knownItemIds = new Set(order.items.map((item) => item.id));
  const cancelledByItem = new Map<string, number>();
  let unreadable = order.cancellations === null || order.cancellationsTruncated;
  let emptyHeader = false;

  for (const entry of order.cancellations ?? []) {
    if (entry.items === null) {
      unreadable = true;
      continue;
    }
    if (entry.itemsTruncated) unreadable = true;
    if (entry.items.length === 0) emptyHeader = true;
    for (const row of entry.items) {
      if (!Number.isFinite(row.cancelledQuantity) || row.cancelledQuantity <= 0) {
        unreadable = true;
        continue;
      }
      if (!knownItemIds.has(row.orderItemId)) {
        if (!order.itemsTruncated) unreadable = true;
        continue;
      }
      cancelledByItem.set(
        row.orderItemId,
        (cancelledByItem.get(row.orderItemId) ?? 0) + row.cancelledQuantity,
      );
    }
  }

  // 🔴 比較基準 = 真相 `order_items.quantity`(R3 N5),不是摘要快取 ⇒ 缺摘要的品項照樣檢查。
  const overCancelled = order.items.some(
    (item) => (cancelledByItem.get(item.id) ?? 0) > item.quantity,
  );
  return { unreadable, emptyHeader, overCancelled, cancelledByItem };
}

/**
 * ZERO_INFERENCE — 🔴 **摘要缺列時,在「權威訊號窮舉成立」的前提下推出 `{instock: 0, cancelled: Σci}`**
 * (R3 F1 + 主視窗 `E-007-A` Q1=A 核准;plan `:103` 同片改字面)。
 *
 * **為什麼原本的一律 fail-closed 是錯的**:A4a 的四支 trigger 只掛
 * `order_item_procurement` / `_receipts` / `order_cancellation_items` 三張表
 * (`20260803140000:714-717` 的 DROP 清單即全集),摘要列**惰性建立**(`:179-180`)
 * ⇒ **從未採購也從未取消過的品項,那一列永遠不會存在**(穩態,不是時序 race)。
 * 而 RPC 的摘要在場閘只在「receipts 或 cancellation 兩個和非零」時 RAISE(`20260805100000:376-387`)
 * ⇒ 同一張單 RPC 全程放行。一律擋 = 把取消 UI 的**主要情境**(客人未付款、還沒跟供應商下單、要求取消)
 * 整個關掉,而且讓 `quantity_summary_missing` 天天亮到失去判別力(R3 F4)。
 *
 * 🔴 **這不是「補 0」,是權威訊號的窮舉**(主視窗 `E-007-A` 理由 1/3;
 * memory `feedback_guard-reads-non-authoritative-cache` 的精神保留 —— 推 0 的來源不是快取):
 *   - `instock = 0` 的依據:`procurements` **零筆且未截斷** ⇒ 沒有採購列 ⇒ 收貨列 FK 掛不上 ⇒ 到貨必為 0。
 *   - `cancelled = 0` 的依據:取消歷程**可讀且完整**、且該品項的 **Σci 恰為 0**。
 *   - `quantity` 的依據:`AdminOrderDetailItem.quantity` = `order_items.quantity` 真相值。
 *
 * 🔴🔴 **五項前提,第五項是確認輪抓到的**(我原本只寫四項,漏了 `Σci === 0`):
 *   RPC 的摘要在場閘逐字是 `receipts > 0 **OR** Σci > 0` **且**缺摘要列 ⇒ RAISE(`:377-385`)
 *   ⇒ 「零採購但已取消過 2 件、且沒有摘要列」這種單,**RPC 必拒**,而我原本會推出上限放行
 *   = 又做出一個「按鈕亮著、送出必失敗」。⚠️ 更該記的是:**我把那個錯的行為寫成測試釘死了**
 *   (「推 0/0 時 cancelled 取自歷程真相」那條),測試綠不代表行為對 —— 它只代表行為與我的預期一致。
 *   (實務上 Σci > 0 會讓 A4a 的 `order_cancellation_items` trigger 建好摘要列
 *    ⇒ 「Σci > 0 卻缺摘要」本來就是真異常,擋掉正確。)
 *
 * ⚠️ **任一前提不成立就退回 fail-closed**(模糊情況維持原紀律):
 *   有採購列 / 採購被截斷 / 歷程不可讀或被截斷 / 品項清單被截斷 / Σci 非零
 *   ⇒ 仍回 `null`、仍走 `quantity_summary_missing`。
 * ⇒ 修完之後那個碼的意思收窄成:**「有採購或取消活動、卻沒有摘要列」= A4a 應該建列卻沒建 = 真異常**
 *   (F4:訊號的判別力因此恢復)。
 *
 * ⚠️ **誠實邊界(確認輪 MF3)**:`mappers/order.ts:557` 把「C7 不變式被違反」的摘要列也壓成 `null`。
 *   在五項前提全成立的品項上(真相 = 零採購、Σci = 0),那種**毀損的快取列**現在會被推 0/0 蓋過去、
 *   不再顯示成異常。⇒ **不得再宣稱「C7 毀損一定看得見」**。
 *   行為面無害:RPC 同樣以真相判定、同樣放行;被蓋掉的只是一列與判定無關的壞快取。
 *   要讓它可見得另立管道(例如對帳報表),不在取消 UI 的職責內。
 */
function toItemView(
  item: CancelViewOrder['items'][number],
  ledger: ReturnType<typeof readCancellationLedger>,
  itemsTruncated: boolean,
): CancelItemView {
  const summary = item.quantitySummary;
  // 🔴 **`== null` 而不是 `=== null`**(A13b D6-a 加的**防禦性**收斂)。
  //    ⚠️ **誠實更正(R1 must-fix)**:第一版寫成「投影退版時這個鍵會整個不存在」並引
  //    `ItemAxisCell` 當佐證 —— 實查 `mappers/order.ts:542-544` 的 `mapQuantitySummary`
  //    回的是 `| null`、**產不出 `undefined`**;`ItemAxisCell` 那句同樣是未經驗證的搬運,
  //    不是獨立來源。真正的觸發是頁層測試 fixture 缺這個鍵 ⇒ `summary.quantity` throw。
  //    ⇒ 保留的理由只有「入口是結構型別、擋不住手寫物件」,而兩種缺值處置相同 —— 純防禦。
  //    ⚠️ 方向不變:兩種缺值都走「上限算不出來 ⇒ 不給勾」的 fail-closed 那一支。
  if (summary == null) {
    const zeroInferable =
      item.procurements.length === 0 &&
      !item.procurementTruncated &&
      !ledger.unreadable &&
      !itemsTruncated &&
      (ledger.cancelledByItem.get(item.id) ?? 0) === 0;
    if (!zeroInferable) {
      return {
        orderItemId: item.id,
        quantity: item.quantity,
        instockQuantity: null,
        cancelledQuantity: null,
        maxCancellable: null,
      };
    }
    // 🔴 第五項前提保證 Σci === 0 ⇒ 已取消量恆為 0、上限恆為買的量。
    return {
      orderItemId: item.id,
      quantity: item.quantity,
      instockQuantity: 0,
      cancelledQuantity: 0,
      maxCancellable: item.quantity,
    };
  }
  // 🔴 **不直接信 `cancellableQuantity`,取它與三軸自算值的較小者**(關卡2 codex):
  //    真實 mapper(`mappers/order.ts:564`)確實是照 `quantity − instock − cancelled` 算的,
  //    但本函式的入口是結構型別 —— 一份 `{quantity:5, instock:0, cancelled:0, cancellable:6}` 的
  //    不一致摘要會讓畫面給出 6 的上限,而 RPC 的真實上限是 5(`:395-406`)⇒ 員工勾 6 送出必被拒。
  //    取 min 是 fail-closed 方向:不一致時寧可少給,不多給。
  //    🔴 **它只治「摘要內部不一致」,治不了「摘要整體落後真相」**(關卡2 codex R2):
  //    四個欄位同源於同一份快取,快取到貨 0 / 真相到貨 1 時 min 的兩邊一起偏高。
  //    那條殘餘風險屬 `INSTOCK_PROXY`,不在本行的能力範圍內 —— 別把 min 講成解決了漂移。
  const derived = summary.quantity - summary.instockQuantity - summary.cancelledQuantity;
  return {
    orderItemId: item.id,
    // 🔴 買了幾件一律取**真相** `order_items.quantity`,不取摘要快取的去正規化欄(A13a R1 F9):
    //    兩者由複合 FK 物理保證相等,但本欄的 docstring 宣稱「取自真相」——
    //    取快取會讓那句宣稱在快取毀損時變成假的,而且會讓同一列的數字兩種來源。
    quantity: item.quantity,
    instockQuantity: summary.instockQuantity,
    cancelledQuantity: summary.cancelledQuantity,
    maxCancellable: Math.max(0, Math.min(summary.cancellableQuantity, derived)),
  };
}

/**
 * 算出一張單的取消視圖。**純函式**:同輸入恆同輸出、無 IO、不丟例外。
 *
 * 🔴 `blockReasons` 的順序是**宣告序、穩定**(不是命中序)——畫面逐條列出來時不會因為
 *    資料細微變動而跳動,測試也能對整個陣列做恰等斷言。
 */
export function buildOrderCancelView(order: CancelViewOrder): OrderCancelView {
  // 🔴 帳本**先讀**:`ZERO_INFERENCE` 需要「歷程可讀且完整」與逐品項 Σci 當前提(R3 F1 修法)。
  const ledger = readCancellationLedger(order);
  const items = order.items.map((item) => toItemView(item, ledger, order.itemsTruncated));
  const reasons: OrderCancelBlockReason[] = [];

  // 步5 第一道:已取消(`:339-341`)。兩條路都擋,差別只在文案。
  if (order.cancelledAt !== null) {
    reasons.push(
      order.cancelledReason === PAYMENT_EXPIRED_CANCEL_REASON
        ? 'payment_expired'
        : 'already_cancelled',
    );
  }

  // 步7:允許集合 = unpaid 且 attempts 全終態 failed(或零筆)。
  // 🔴 `'blocked'` 與 `'unknown'` 分開兩碼:員工要看到的話不同(「有在途扣款」vs「讀取不完整,請重新整理」),
  //    這正是 `chargeAttemptGate` 收成三態的理由(`types.ts:831-836`)——合成一碼就把它退回兩 boolean 的洞。
  if (order.paymentStatus !== 'unpaid') reasons.push('payment_not_unpaid');
  // 🔴 **已付款的單不報這條**(#387;Sean 2026-08-11 實測撞到)。
  //    `mapChargeAttemptGate` 用否定式 `!== CHARGE_ATTEMPT_TERMINAL_FAILED` 判定
  //    (`packages/adapters/src/supabase/mappers/order.ts:619` 與 `:622`)
  //    ⇒ **成功終態 `charged` 與真在途 `pending` 共用 `'blocked'` 一碼**,而本碼的文案只寫了
  //    pending 那種語意(「還在進行中,等它結束」)。單子已付款時,那筆非 failed 的嘗試就是
  //    **付款成功的那一筆** ⇒ 對員工說「刷卡還在進行中」是假話,而且是會讓人一直重整、
  //    等一個永遠不會發生的變化的假話。
  // 🔴 **抑制的只是碼、不是 fail-closed 的實質**(同本檔 `quantity_summary_missing` 的紀律):
  //    抑制只在 `paymentStatus !== 'unpaid'` 時發生,而那正是上一行 `payment_not_unpaid`
  //    **必然成立**的條件 ⇒ 兩行互補、恆有一條在擋,`canCancel` 不受影響(守門見測試)。
  // ⚠️ **失效條件**:日後 L5b 重新付款線若讓「已付款單上再開一筆真 pending 扣款」變可達,
  //    這裡會把那筆**真在途**一起藏掉。那時要走根治 = #387 修法 A(gate 拆四態、`charged`
  //    與 `pending` 分碼),那動的是 `packages/adapters` 的共用 mapper ⇒ 另一片、另一層審查。
  //    在那之前處置不變:`payment_not_unpaid` 照樣擋住,員工該做的事(走退款線)也一樣。
  if (order.chargeAttemptGate === 'blocked' && order.paymentStatus === 'unpaid') {
    reasons.push('charge_attempt_blocked');
  }
  if (order.chargeAttemptGate === 'unknown') reasons.push('charge_attempt_unknown');

  // plan §1.4:品項清單被截斷 ⇒ 複核的「影響範圍」是漏的,不可按。
  if (order.itemsTruncated) reasons.push('items_truncated');
  if (items.length === 0) reasons.push('no_items');
  // 🔴 **「看不全」時不報這條**(確認輪 MF2 + R2 MF-a)。兩個來源都會讓正常資料誤亮:
  //    ①`itemsTruncated`:品項數觸及 `ORDER_ITEMS_EMBED_LIMIT`(200,`mappers/order.ts:385`)的大單;
  //    ②`ledger.unreadable`:某個品項合法取消過 100 次 ⇒ 外層歷程被截 ⇒ **整單**推不出 0/0,
  //      連「從未有過活動」的品項也跟著缺上限 —— 而真正的問題是歷程不完整,不是摘要異常。
  //    兩者各自已有自己的碼(`items_truncated` / `cancellations_unreadable`)且都已擋住整張單,
  //    不缺這一道;多報只會讓本碼在正常資料上亮、失去「真異常」的判別力(F4)。
  //    ⚠️ 抑制的只是**碼**,不是 fail-closed 的實質:那些品項的 `maxCancellable` 仍是 `null`、仍勾不動。
  const cannotSeeEverything = order.itemsTruncated || ledger.unreadable;
  if (!cannotSeeEverything && hasMissingSummary(items)) reasons.push('quantity_summary_missing');

  // 步5 第二道 帳本病理(`:342-352`):①`cancelled_reason` 殘留 ②Σci > quantity ③零明細 header。
  // 🔴 ① 的條件是「`cancelledAt` 為 null **卻** 有 reason」——RPC 走到那行時 `cancelled_at`
  //    已被前一道保證是 NULL(`:339-341` 先 RAISE),所以「已取消單有 reason」是正常、不是病理。
  const reasonResidue = order.cancelledAt === null && order.cancelledReason !== null;
  if (reasonResidue || ledger.overCancelled || ledger.emptyHeader) reasons.push('ledger_unhealthy');
  if (ledger.unreadable) reasons.push('cancellations_unreadable');

  // 全品項都勾不動 ⇒ 兩種模式都送不出去(部分模式最少要送 1 件,`cancel-form.ts:208`)。
  // 🔴 摘要缺列時不重複報這條(那邊已 fail-closed),否則同一個根因會在畫面上列成兩條拒因。
  // 🔴 `itemsTruncated` 時也不報(關卡2 codex R2):看得見的品項全勾不動,不代表**被截掉的**也勾不動
  //    ⇒ 那是一句錯的斷言。該情境已由 `items_truncated` 擋住。
  const anyCancellable = items.some(isItemSelectable);
  if (!anyCancellable && items.length > 0 && !hasMissingSummary(items) && !order.itemsTruncated) {
    reasons.push('nothing_cancellable');
  }

  const canCancel = reasons.length === 0;
  return {
    canCancel,
    blockReasons: reasons,
    fullCancelAllowed: canCancel && !hasAnyInstock(items) && everyItemFullyCancellable(items),
    items,
  };
}
