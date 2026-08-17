import 'server-only';

// shipment-candidates.ts — 建箱彈窗的資料源:把勾選的訂單換成「還能出什麼、還能出幾件」。
//
// 🔴🔴 **鐵則 12 面:這支的唯一職責就是把價格擋在 server 端。**
//    `AdminOrderDetail.items` 帶成交價(`unitPrice` / `lineTotal`)與客人 PII。
//    彈窗只需要**單號 + 品名 + 料號 + 還能出幾件**,所以本檔吐的是一個**刻意很窄的 DTO**:
//    `{ orderId, orderItemId, orderDisplayId, variantSku, title, remaining, blockedReason }`
//    —— 沒有任何金額欄位。
//
// 🔴 **「窄」的判準是資訊類別,不是欄位數**(2026-08-11 主視窗裁 D1 時補明,免得被讀成「不可增欄」):
//    這條不變式守的是**價格 / 客人 PII / 供應商身分**這三類不得跨到 client;
//    **不進新類別**的欄位可以增(例:`variantSku` 是料號、`orderId` 是 client 已持有集合的逐件對映)。
//    ⇒ 要加欄時先問「它屬於上面三類的哪一類」,答得出來就別加、答不出來再看必要性。
//    ⚠️ 反面提醒:當年 #352-b-2 一度想把**採購列(含供應商 label)**塞進來當入口 2 的資料源,
//    那就是**新類別**,已改成「按下去才抓」的獨立 action(`fetchItemProcurementChoices`)。
//    (`variantSku` = 料號,2026-08-09 Sean 實測後追加:員工核對包裹內容靠料號、不是靠品名。
//     它是非價格欄、`ADMIN_ORDER_DETAIL_SELECT` 早就取了它 ⇒ 零白名單改動。)
//    ⇒ 呼叫端把這個 DTO 交給 client 元件是安全的;把 `AdminOrderDetail` 交過去不是。
//    `import 'server-only'` 讓「有人不小心從 client 檔 import 它」變成**建置期錯誤**,
//    不是等到上線才發現金額進了 bundle。守門另有一條釘住這個 import。
//
// 🔴 **「還能出幾件」= 已到貨 − 已配箱**(2026-08-10 #351②:從**訂購量**起算改成從**到貨量**起算)。
//    舊式子是 `訂購 − 已取消 − 已配箱`,它從訂購量起算 ⇒ **還沒到貨的件在彈窗上是「還能出」**,
//    而 DB 判「可出 0」。員工看到能出就出,失敗是**靜默的**(畫面說能出、貨根本還沒到)。
//
//    對齊的是 DB 那條權威式(`20260807180000:230`,掛品項 RPC 的前緣拒絕):
//      `avail = instock − shipped − pending`
//    而本檔的 `already`(`listAssignedQuantitiesByOrderItemIds`)只濾 `deleted_at IS NULL`、
//    **不看 `shipped_at`** ⇒ 它同時含「已出貨的箱」與「已裝箱未出貨的箱」。
//    DB 的 `shipped`(`20260806180000:222-229` 唯一 writer,`shipped_at IS NOT NULL`)與
//    `pending`(`20260807180000:244-250`,`shipped_at IS NULL`)對同一組非作廢箱做 **NULL/NOT NULL 二分**
//    ⇒ 兩者相加涵蓋且只涵蓋 `already` 那一組列。
//    🔴 **這個等式有前提,前提要寫出來**:DB 那條式子用的 `shipped` 是**摘要快取欄**、不是即時聚合,
//       所以「`already = shipped + pending`」只在快取與 `shipment_items` 同步時成立。
//       撐住它的是唯一那支 `shipments AFTER UPDATE OF shipped_at, deleted_at` 重算 trigger
//       (`20260806180000:362`;同檔 COMMENT 逐字說明 `shipment_items` 上**刻意不掛** trigger,
//        靠 append-only 三支擋住改/刪)。那三支哪天被放寬,這個等式就跟著失效。
//    ⇒ 這也是為什麼本檔**不需要** `shipped_quantity`(投影裡本來就沒有,不必為此動投影)。
//
// 🔴 **`cancelled` 是被刻意拿掉的,不是漏掉 —— 不要「順手」加回來**。
//    取消掉的量**從來就不在 `instock` 裡**,再減一次是**重複扣**,會把可出量算得比實際少。
//    權威依據是 A8a2 的可取消量守門(`20260805100000:395-406`:增量 ≤ `quantity − instock − cancelled`,
//    對應 `types.ts:684-685` 的 `cancellableQuantity`)—— **那條才是讓已到貨的件永遠取消不掉的東西**。
//    ⚠️ 摘要表 CHECK C7 `oiqs_instock_cancelled_le_quantity`(`20260730150000:123-124`,
//       `instock + cancelled <= quantity`)只是**必要條件、不是充分條件**:數值上它容得下重疊
//       (例:quantity 4 / instock 2 / cancelled 1 滿足 C7,但它證不出那 1 件沒到過貨)。
//       引它當唯一理由是錯的;它的角色是「後來到貨把總量撐爆時會紅在重算」的那道網。
//    (這是 `cancellableQuantity` 那條「不可再減 shipped」的鏡像:兩式同表不同義,互抄必錯。)
//
// 🔴 **已配箱(`already`)含還沒寄出的草稿箱**(見 `listAssignedQuantitiesByOrderItemIds` 檔頭)——
//    漏了它,同一件會被裝進第二個箱子。
//
// ⚠️ 這裡**不是**正確性層。真正擋住超額出貨的是 DB;本檔是要讓員工看得懂畫面。
// ⚠️ 兩邊的資料新鮮度不完全同源:DB 用「快取 shipped + 即時 pending」,本檔用「快取 instock + 即時 already」。
//    在 shipped/pending 那一軸本檔偏保守側(`already` 取即時值 ⇒ 算得不會比 DB 多);
//    但 **`instock` 那一軸不保證**:摘要的 instock 被下修(退貨/更正)而彈窗還拿著舊值時,
//    本檔會算得**比 DB 多** = fail-open。那個窗口 DB 端已知並逐字記在 `20260807180000:53-54`
//    (「前緣通過 → 之後 instock 被下修 → **出貨時**才噴 raw 23514」),擋線在 DB、不在這裡。
//
// 🔴 **`remaining === 0` 的品項要留在清單裡、標出原因,不可以整列消失**(backlog #351 ② 逐字
//    「0 件品項不預選+標『未到貨』」)。改成到貨量起算後,「可出 0」從罕見態變成**常態**
//    (東西還沒到),整列消失會製造 #351 原本要修的那個症狀的變體:員工找不到品項、以為系統壞了。

import type { AdminOrderDetail, AdminOrderPrintItem } from '@pcm/domain';
import { getAdminOrderRepository } from '../orders/order-repository';
import {
  listAssignedQuantitiesByOrderItemIds,
  listOrderCustomerUserIds,
} from './shipment-repository';
// 🔴 上限常數住在【沒有 server-only】的 `shipment-limits.ts`,因為 client 端的文案也要用同一個值。
//    抄成兩份的話,兩邊會各自漂而**沒有任何東西會紅**。
import { MAX_SHIPMENT_CANDIDATE_ORDERS } from './shipment-limits';

export { MAX_SHIPMENT_CANDIDATE_ORDERS };

/** 彈窗用的一個可出貨品項。**刻意沒有任何金額欄位**(見檔頭)。 */
export type ShipmentCandidateItem = {
  /**
   * 這件屬於哪一張訂單(uuid)。
   *
   * 🔴 **為什麼需要它**(#352-b-2 入口 2):跨單裝同一箱是允許的 ⇒ 彈窗手上那組 `orderIds`
   * **反推不出**某一件屬於哪張單。而「登錄到貨」的歸屬閘要的是 `(orderId, orderItemId)` 配對,
   * 不能靠 client 送一個「允許集合」來近似 —— 那正是歸屬閘要防的形狀。
   * 🔴 **不是新資訊類別**:`orderIds` 本來就整組傳給 client 了(見 `shipment-launcher`),
   * 這只是把逐件對映講清楚。判準見檔頭。
   */
  orderId: string;
  orderItemId: string;
  /** 顯示用的單號(讓員工看得出這件來自哪一張單;跨單裝同一箱是允許的)。 */
  orderDisplayId: string;
  /** 料號(`order_items.variant_sku`)。非價格欄;員工核對箱內實物靠它。 */
  variantSku: string;
  title: string | null;
  /** 還能出幾件 = 已到貨 − 已配箱,夾在 0 以上(見檔頭)。 */
  remaining: number;
  /**
   * `remaining === 0` 時**為什麼**出不了;可以出的品項為 `null`。
   *
   * 🔴 存在的理由是「不可以只顯示一個 0」(backlog #351 ②)。四個值不可互換,因為它們對員工
   * 是四種完全不同的下一步動作:
   *   · `cancelled`    這件已經整筆被取消 ⇒ 它永遠不會到,別再等。
   *   · `all_boxed`    到貨的都已經裝進別的箱了 ⇒ 去看既有包裹,不要再開一箱。
   *   · `not_arrived`  貨還沒到 ⇒ 去看採購/到貨,不是這裡的問題。
   *   · `unknown`      數量資料讀不到或不可信 ⇒ 誰都不該憑它出貨(見 `itemsOf` 內註)。
   * ⚠️ **不要為了少一個分支把它們合併成「未到貨」**:對已全數配箱或已取消的品項說「未到貨」
   *    是**假話**,而且會把員工指去追一批根本不會來的貨。
   */
  blockedReason: 'cancelled' | 'all_boxed' | 'not_arrived' | 'unknown' | null;
};

export type ShipmentCandidates = {
  items: ShipmentCandidateItem[];
  /**
   * 這批訂單**共同**的客人。`null` = 查不到、或它們不屬於同一位客人 ⇒ 呼叫端不得開窗。
   *
   * 🔴 **這一欄是「早期偵測」,不是權威。** 它會跨 server→client 邊界送給彈窗的呼叫端,
   * 所以**不能**拿它當建箱的客人來源 —— 送出去的東西回得來,回得來的東西可以被改。
   * 建箱真正用的客人由 `submitShipment` **從送出的品項自己反查**
   * (`listCustomerUserIdsByOrderItemIds`),client 連這個欄位都送不出去。
   * ⇒ 本欄唯一的作用是讓員工在**按下去之前**就看到「這批單裝不成同一箱」。
   */
  customerUserId: string | null;
  /**
   * 收件資料(取自第一張單的 `shippingAddress`)。
   * 🔴 形狀**恰好**是 `admin_create_shipment` 要的 `{name, phone, line}` 三欄
   * (`pcm_b2_w3a_recipient_shape` 多一個少一個都退件)。
   */
  recipient: { name: string | null; phone: string | null; line: string | null } | null;
};

/**
 * 🔴🔴 **「同客人」的 server 端交叉核對(2026-08-09 補上;先前是明說的缺口)。**
 *
 * 舊註解說這一道做不起來,理由是「`AdminOrderDetail` 沒有 customer id,要拿得動
 * `ADMIN_ORDER_DETAIL_SELECT` 這份帶 PII 的白名單」。**那個理由的失效條件當時就寫下來了**,
 * 而它現在成立了:詳情頁出貨入口需要客人身分,於是改走
 * `listOrderCustomerUserIds()` —— **只投影 `id, customer_user_id` 兩欄的獨立查詢**,
 * 完全不碰明細白名單。⇒ 原本「代價與收益不成比例」的判斷不再成立,這道就補上了。
 *
 * 現在四道:
 *   ① UI:別的客人的框變灰(`shipping-selection.tsx`)
 *   ② 狀態層:`nextSelection` 拒收不同客人
 *   ③ **本檔(server)**:`orders` 查出來的客人不只一位 ⇒ `customerUserId = null` ⇒ 開不了窗
 *   ④ **DB(權威)**:`pcm_b2_w3b2_item_not_customers` —— 前三道全繞過也會被退件
 *
 * ⚠️ **①②③ 全是體驗層,一條都不是權威**:它們算出來的值都會跨到 client、都可以被改。
 * 「箱子掛誰」的來源在 `submitShipment` —— 它從**送出的品項自己**反查客人,
 * 而那批品項正是 ④ 會拿去核對的同一批 ⇒ 竄改構造不出跨客人的箱。
 * 🔴 這個區分是 2026-08-09 codex R1 打回來的:第一版把 ③ 寫成「client 碰不到的來源」,
 * 但那個值**經過 client 再送回來**,宣稱與事實不符。
 */

/**
 * `remaining === 0` 時,**為什麼**出不了。
 *
 * 🔴 **分支順序是規格的一部分**,不是隨手排的:每一條都要在「它成立時,前面的都不成立」下才正確。
 *   ① 整筆被取消 ⇒ 這件永遠不會到,講「未到貨」會把員工指去追一批不存在的貨。
 *      (只認**整筆**取消:部分取消時剩下的那些確實還在等到貨,`not_arrived` 才是對的。)
 *   ② 有東西已經裝進箱(`already > 0`)⇒ `all_boxed`。**這條必須排在 `instock === 0` 之前**:
 *      「先到貨 → 裝進未寄出的草稿箱 → 到貨紀錄被更正下修」會走到 `instock = 0 且 already > 0`,
 *      此時說「未到貨」是假話 —— 東西在別人開的箱子裡,不在供應商那邊。
 *   ③ 剩下的(`already === 0` 且 `instock === 0`)才是真的還沒到。
 * ⚠️ ① 排在 ② 之前是**刻意的,但那組資料本身是角落**:「整筆取消 且 `already > 0`」
 *    (先裝箱 → 到貨被下修 → 整筆取消)兩句話都是真的,這裡挑「已取消」講,因為它是
 *    對員工更決定性的事實(這件永遠不會來)。⚠️ 但草稿箱裡還掛著它的配額,
 *    真要收尾得去把那個箱作廢/移除 —— 本標籤指不到那條路,那是 #359 的域。
 * ⇒ ①②③ 對 `remaining === 0` 是**窮舉**的:C2 保證 `instock >= 0`,
 *   而 `already === 0 且 instock > 0` 會讓 `remaining > 0`、根本不會呼叫到這裡。
 */
function blockedReasonOf(
  summary: NonNullable<AdminOrderDetail['items'][number]['quantitySummary']>,
  already: number,
): NonNullable<ShipmentCandidateItem['blockedReason']> {
  if (summary.cancelledQuantity >= summary.quantity) return 'cancelled';
  if (already > 0) return 'all_boxed';
  return 'not_arrived';
}

/**
 * 從一張訂單算出它的候選品項(不含金額)。
 *
 * 🔴 **品項【不】從 `detail.items` 來** —— 那份是內嵌撈的、被 `ORDER_ITEMS_EMBED_LIMIT = 200` 夾住。
 *    呼叫端改餵 `listOrderItemsForPrint` 撈到盡的那份(理由見 `loadShipmentCandidates`)。
 *    `detail` 這個參數現在只出借**訂單層**的兩個欄(`id` / `displayId`),不再出借品項。
 */
function itemsOf(
  detail: AdminOrderDetail,
  items: readonly AdminOrderPrintItem[],
  assigned: Map<string, number>,
): ShipmentCandidateItem[] {
  return items.map((it) => {
    const summary = it.quantitySummary;
    const already = assigned.get(it.id) ?? 0;

    // 🔴 `summary === null` 走的是 `unknown`,**不是** `not_arrived`。
    //    `mapQuantitySummary`(`mappers/order.ts:536-566`)吐 `null` 有**三個**來源,而這裡分不出是哪個:
    //      ①缺列(A4a 惰性建列 ⇒ 從沒被採購過,到貨確實是 0)
    //      ②讀不到(內嵌鍵沒回來 / 欄位非數 ⇒ 完全不知道)
    //      ③C7 不變式被違反(資料已損壞,instock 可能是任何值)
    //    ⇒ 「缺列代表到貨真的是 0」只對 ① 成立,不能拿來當三者共用的理由;
    //    對 ②③ 誠實的說法就是「不知道」。`types.ts:638-660` 立過契約:`null` 一律 fail-closed。
    //    ⚠️ 這條在 `remaining` 那一欄上**觀測不到**(`?? 0` 也得 0),但在 `blockedReason` 上觀測得到:
    //       寫成 `?? 0` 會讓「讀不到」被標成 `not_arrived`(編一個看起來正常的原因給員工)。
    //       ⇒ 有測試釘得住(`shipment-candidates.test.ts` 的 `unknown` 那格)。
    if (summary === null) {
      return {
        orderId: detail.id,
        orderItemId: it.id,
        orderDisplayId: detail.displayId,
        variantSku: it.variantSku,
        title: it.title,
        remaining: 0,
        blockedReason: 'unknown',
      };
    }

    // 摘要是衍生快取(A1 表 COMMENT 逐字「衍生值,非真相」)、可能與 shipment_items 短暫不一致
    // ⇒ 算出負數是可能的,而**負數與 0 一樣都代表「這件不能再出」**⇒ 夾在 0 以上再交出去。
    //    (夾這一下不是死碼:0 與負數現在都要**顯示**,`-97` 進數量框沒有意義。)
    const raw = summary.instockQuantity - already;
    const remaining = raw > 0 ? raw : 0;
    return {
      orderId: detail.id,
      orderItemId: it.id,
      orderDisplayId: detail.displayId,
      variantSku: it.variantSku,
      title: it.title,
      remaining,
      blockedReason: remaining > 0 ? null : blockedReasonOf(summary, already),
    };
  });
}


/**
 * 勾選的訂單 → 品項清單(**含出不了的**;出不了的那些帶 `blockedReason`,見該欄註解)。
 *
 *
 * ⚠️ 逐張訂單各打一次 `findAdminOrderDetail`,**再**逐張打一次 `listOrderItemsForPrint`
 * (它自己還會依品項數翻頁)⇒ N 張 = N 次明細 + N×(品項頁數) 次品項查詢。
 * 員工一次勾的張數是個位數 ⇒ 先用最簡單的做法;真的變慢再改批次查詢,**不預先最佳化**。
 * 🔴 **而「變慢」現在沒有量測值**:本片(2026-08-17)改成撈到盡時**未量**改前改後的回應時間。
 *
 * @throws 勾超過 {@link MAX_SHIPMENT_CANDIDATE_ORDERS} 張時直接丟,**在打任何 DB 查詢之前**。
 */
export async function loadShipmentCandidates(
  orderIds: readonly string[],
): Promise<ShipmentCandidates> {
  if (orderIds.length === 0) return { items: [], customerUserId: null, recipient: null };

  // 🔴 **輸入長度上限 —— 必須在下面那個 `Promise.all` 【之前】。**
  //
  //    病:`fetchShipmentCandidates` 是 **server action**(`shipment-actions.ts`),
  //    而這支對 `orderIds` 原本**零長度上限**、只有 `length === 0` 早退
  //    ⇒ 一個被盜的 admin session 可以餵上千個 id,觸發**無界並行** DB fan-out(`Promise.all` 一次全發)。
  //
  //    🔴🔴 **病的描述要收窄 —— 我第一版(照抄規格)寫「一次撈走全部訂單的成交價 + 客人 PII」,
  //       而那是【假的】**(codex 2026-08-17 R2 開檔核出來的):
  //       這支回的是**刻意很窄的 DTO**(見檔頭,零金額欄),而 `recipient` 只有
  //       **`details[0]` 那一張單的**收件資料 ⇒ **成交價根本不回,也不是 N 份 PII。**
  //       ✅ **真正證實的危害只有兩件**:① 無界 DB fan-out ② 一次拿到大量訂單的品項 / 料號 / 單號對映。
  //       📎 **為什麼要專程收窄**:誇大的威脅描述會讓下一個人把力氣投在錯的地方
  //          (例如去做「不要回傳金額」—— **它本來就沒回**),而真正該做的是速率限制。
  //          **論證寫得越有說服力,搬走的人越不會回頭核它。**
  //    ⚠️ **等級 LOW-MEDIUM**:它**不跨授權邊界**、仍然要有 admin session
  //    ⇒ 它是**帳號被盜之後的放大器**,不是入口。(E 窗 2026-08-17 稽核找到,主視窗背書。)
  //
  //    🔴🔴 **這道上限【只】綁住【單一請求】的 fan-out(≤ N),擋不住跨請求放大。**
  //    原規格與我第一版註解寫「長度一上限,fan-out 自動有界 ⇒ **不需要另外做 concurrency 限制**」
  //    —— **那句話是錯的**(codex 2026-08-17 抓到):同一個被盜 session
  //    **平行送 20 個請求、每個 50 個不同 id ⇒ 照樣 1000 次明細查詢。**
  //    ⇒ 真正要治它的是**速率限制 / 全域並行上限**,那是另一件事、另一片:**backlog `#611`**。
  //    📎 **本片沒有變成白做**:它把「一個請求 = 無限」變成「一個請求 = 50」,
  //       攻擊者要達到同樣量得**自己發 N 倍的請求**,而那是速率限制看得見的形狀。
  //       **但不要把本片讀成「fan-out 問題解決了」。**
  //
  // 🔴 **為什麼是【擋掉】不是【截斷】** —— 這條理由 2026-08-17 換過一次,**換過的痕跡要留著**:
  //    ❌ 原規格寫「對齊 Sean `Q2`=甲(撈不全就整區失敗)」⇒ **那條理由已作廢**:
  //       Sean 同日下午把 `Q-5`(=`Q2`)**改判乙**(顯示已取得的 + 標示不完整)。
  //    ✅ 現行理由是它自己的那條:**截斷會靜默丟單** —— 員工以為全勾進去了、實際少幾張,
  //       而少的那幾張**不會有任何症狀**。這與 Sean 拍 `Q-C16` 甲的理由同一件事:
  //       **「少印沒人會發現,多印客人會打電話」。**
  //    🔴 **而且 `Q-5`=乙【在這裡不成立】,不是被我忽略**:
  //       ```
  //       Q-5 講的是「【撈】不完整時，畫面要怎麼呈現」 ← 資料撈不回來，是系統的問題
  //       這裡講的是「使用者【送】了超量輸入」        ← 輸入超限，是請求的問題
  //       ```
  //       ⇒ 不是同一件事。乙(顯示部分 + 標示)在這裡**沒有「部分」可以顯示**,
  //         只有一個不該被接受的請求。
  //    ⚠️ 看到「`Q2`=甲」的字面**不要**以為本片過期;看到 `Q-5`=乙 **也不要**拿來把這道擋板改掉。
  //
  // ⚠️ **丟例外而不是回 `{ ok:false }`,而【員工在正式站上看不到下面這句話】。**
  //    🔴 **Next 在 production 會遮蔽 server action 丟出的原始 Error message**
  //       (codex 2026-08-17 抓到,而我第一版註解寫「這句話會直接印給員工看」—— **錯的**)。
  //       `shipment-launcher.openDialog` 確實有 `try/catch` + `toMessage(e)`,
  //       但它拿到的會是一則通用訊息,**不是「一次最多勾 50 張」**。
  //    ❌ **我第二版寫「知情之下仍然不補 UI 文案,因為合法使用者踩不到」—— 那個理由【也垮了】。**
  //       我當時自己標了「跨頁勾選會不會保留,未查證」,而 codex R2 去查了:
  //       勾選狀態住在 `ShippingSelectionProvider`(`app/orders/page.tsx:247`),
  //       純 search-param 換頁**會保留** ⇒ **員工翻到第三頁就合法累積得到 51 張。**
  //       ⚠️ 那條**我沒有在真瀏覽器上驗過**(codex 讀 Next 原始碼推出來的)⇒ 仍標未實測。
  //    ✅ **處置:不再爭論踩不踩得到,直接讓它不重要** ——
  //       `shipment-launcher.openDialog` 在**送出之前**先擋並顯示明確文案(見該檔)。
  //       ⇒ **client 那道是文案、不是安全控制;下面這道才是安全控制。** 兩道都要有:
  //         少了 client 那道,員工看到一則沒有解釋的通用錯誤;
  //         少了這一道,被竄改的請求直接進 fan-out。
  //    📎 訊息本身只有兩個數字,**不含 PII 也不含內部識別碼** ⇒ 就算哪天沒被遮蔽也不外洩。
  //    ⚠️ 另一個呼叫點 `onRefreshCandidates` 用的是**當下 render 的 `orderIds`**、不是開窗快照,
  //       而 `shipment-dialog.tsx:137` 是 `void onRefreshCandidates?.()` ⇒ **沒有接住 rejection**。
  //       (我第一版寫它「踩不到這裡」—— **那是推的**。而 codex R2 又指出更廣的一面:
  //        **一般 DB / 網路錯誤本來就會在那裡變成 unhandled rejection**,與 50 這道閘無關
  //        ⇒ 那是既有缺口、不是本片造成的,**已記進 `#611`**,本片不順手改它。)
  if (orderIds.length > MAX_SHIPMENT_CANDIDATE_ORDERS) {
    throw new Error(
      `一次最多勾 ${MAX_SHIPMENT_CANDIDATE_ORDERS} 張訂單(這次勾了 ${orderIds.length} 張)。請分批建箱。`,
    );
  }

  // 🔴 **去重要在長度上限【之後】、fan-out【之前】**(codex 2026-08-17 MF3)。
  //    · 在上限之後:餵 1000 個重複 id 仍然是一個該被拒絕的請求,
  //      先去重的話它會變成「1 張」而合法通過 ⇒ 上限被繞過。
  //    · 在 fan-out 之前:`['o1','o1']` 原本會讓同一張單被查兩次、
  //      **同一批品項出現兩份** ⇒ 彈窗重複列、送出的 payload 帶重複 `order_item_id`
  //      (最後被 DB 退件,而員工看到的是一個沒有解釋的失敗)。
  //    📎 這個形狀在本片之前就在了(舊版 `details.flatMap` 同樣吐兩份);
  //       本片把品項改成用 `Map` 按單號存,**兩邊的重複程度不再一致** ⇒ 順手收掉,不留半修狀態。
  const uniqueOrderIds = [...new Set(orderIds)];

  const repo = getAdminOrderRepository();
  const details = (
    await Promise.all(uniqueOrderIds.map((id) => repo.findAdminOrderDetail(id)))
  ).filter((d): d is AdminOrderDetail => d !== null);
  if (details.length === 0) return { items: [], customerUserId: null, recipient: null };

  // 🔴🔴 **品項改走頂層分頁查詢撈到盡**(`D2` 甲,Sean 2026-08-17 批;plan §3 的 A)。
  //    `detail.items` 是**內嵌**撈的、被 `ORDER_ITEMS_EMBED_LIMIT = 200`
  //    (`packages/adapters/src/supabase/mappers/order.ts:407`)夾住,而 Sean 逐字說
  //    一張單「可能到 200 個品項」⇒ **那是正常業務的上緣,不是極端值**。
  //    ⚠️ **措辭要準**(codex 2026-08-17 nit 更正我第一版的「恰好 200 就已經被截」):
  //       **恰好 200 項時查詢會回完整的 200 筆**,沒有掉東西;
  //       只是判定寫成 `>=` ⇒ 它**證不出**是不是還有更多 ⇒ 旗標會是 `true`(保守)。
  //       **真的會掉件的輸入是「至少 201 項」。** 兩者差一,而差的那一件就是病。
  //    這條路上被截的後果**不是顯示不全,是功能上做不到**:第 201 項之後的件
  //    **永遠不會出現在建箱彈窗裡** ⇒ 員工沒有任何辦法把它裝箱,而畫面完全正常。
  //
  // 🔴 **而這一行同時解掉「A 餵壞 B」那條連鎖** —— 下面 `allItemIds` 以前來自
  //    `d.items`(**已被 200 夾過**)⇒ 第 201 項之後的 id 根本不會拿去問
  //    `listAssignedQuantitiesByOrderItemIds` ⇒ **那不算截斷、零訊號**。
  //    ⇒ **只修品項那半等於沒修**,兩半必須同一顆改(plan §2-b)。
  //
  // ⚠️ **不重寫第二支分頁迴圈** —— 沿用 `listOrderItemsForPrint`(`Q-C18` 甲已落地、已有單測)。
  //    它在 `MAX_PAGES = 50`(10,000 列)時**throw、不回部分**,而**這裡就是要它 throw**:
  //    回部分 = 彈窗少幾件而畫面正常,正是本片在修的那個病。
  //    (方向與 Sean `Q2` 甲一致:撈不全就整區失敗,不顯示任何一列。)
  //
  // 🔴 **它沒有進 `IOrderRepository`**(`git grep -n 'listOrderItemsForPrint' packages/ports/src/IOrderRepository.ts` ⇒ 零命中);
  //    這裡能呼叫是因為 `getAdminOrderRepository()` 的回傳型別逐字是 `SupabaseOrderAdapter`
  //    (`../orders/order-repository.ts:24`)。**本片沿用具體型別 = 最小改動**,
  //    與同一支方法的另一個呼叫端(`app/print/orders/[id]/shipping/[shipmentId]/page.tsx:61`)一致。
  //    ⇒ 要不要提進 port 是一件獨立的事(動共用契約 = 鐵則 12⑥),不夾在本片做。
  //
  // ⚠️ **代價:多打 DB,而且要把數字寫出來**(codex 2026-08-17 MF5 算的,我核過形狀):
  //    ```
  //    改之前：50 張單 →  50 次明細 + 2 次下游            =  52 次
  //    改之後：50 張單 →  50 次明細 + 100 次品項 + 2 次    = 152 次
  //                                   ^^^ 每張至少 2 頁：一頁有料、一頁空的才停
  //                                       （終止條件是「拿到 0 列」，見 adapter docstring；
  //                                         改成「本頁不滿即停」會把零餘裕那個病裝回來 ⇒ 不改）
  //    ```
  //    🔴 **⇒ `MAX_SHIPMENT_CANDIDATE_ORDERS = 50` 這道閘擋住的 fan-out 變成約 3 倍。**
  //    ⚠️ 而那個 `50` **本來就不是量出來的**(它自己的 docstring 第一句就這麼寫)⇒
  //       **本片沒有把它變成量過的**,只是讓它守的東西變大。
  //       要不要調低 / 要不要改批次查詢 = **Sean 的取捨**(員工一次勾幾張 vs 等多久),已寫進 STOP。
  //    🔴 **本片未量**改前改後的實際回應時間 ⇒ 上面全是**次數**不是**秒數**(plan §4 同一條)。
  //
  // 🔴 **`reportedTotal` 要對帳,不可以丟掉**(codex 2026-08-17 MF2)。
  //    adapter 回 `{items, reportedTotal}`,而 `reportedTotal` 是第一頁 `count: 'exact'` 的值。
  //    對帳不上(例如回了 199 筆而 count 說 200)⇒ **這份清單少了東西**,
  //    而少的那幾件在彈窗上**沒有任何症狀** —— 正是本片在修的那個病原樣復發。
  //    ⚠️ **adapter 自己說 `count !== items.length` 在有並發寫入時是正常的**(它的 docstring:
  //       「不拿它判『撈完了』(那是 TOCTOU)」)。這裡仍然當成錯,理由是**這條路上寫入構造不出來**:
  //       同一份 docstring 量過「`order_items` 在建單之後不再新增或刪除」(8 支 migration 逐支數過)。
  //       🔴 **那個結論的失效條件寫在那裡**:哪天有「訂單成立後補品項 / 刪品項」的功能,
  //          這裡就會開始誤報 ⇒ **到時要改的是這一段,不是把對帳拿掉。**
  const itemsByOrderId = new Map(
    await Promise.all(
      details.map(async (d) => {
        const { items, reportedTotal } = await repo.listOrderItemsForPrint(d.id);
        if (reportedTotal !== null && items.length !== reportedTotal) {
          throw new Error(
            `訂單 ${d.displayId} 的品項對不上:撈到 ${items.length} 筆,伺服器說有 ${reportedTotal} 筆。` +
              `不顯示部分清單 —— 少幾件的彈窗看起來與正常的一模一樣。`,
          );
        }
        return [d.id, items] as const;
      }),
    ),
  );

  const allItemIds = [...itemsByOrderId.values()].flat().map((it) => it.id);
  const [assigned, customerByOrderId] = await Promise.all([
    listAssignedQuantitiesByOrderItemIds(allItemIds),
    listOrderCustomerUserIds(details.map((d) => d.id)),
  ]);

  // 🔴 **`listAssignedQuantitiesByOrderItemIds` 現在自己翻頁撈到盡、撈不完直接 throw**
  //    (2026-08-17 codex R2 打回第一版的「自夾 900 列」形狀 —— 那個做法要同時猜
  //     伺服器上限與合法最大用量,兩個都沒量過。詳見它自己的 docstring)。
  //    ⇒ **這裡不需要再判一次**:它要嘛回完整的 Map,要嘛丟。
  //    ⚠️ 而「回部分」是這條路上最貴的失敗:`already` 少算 ⇒ 已裝進別的箱的件顯示成還可以出
  //       ⇒ **同一件被裝進第二個箱**,而彈窗看起來完全正常。

  // 🔴 **恰好一位**才給:0 位(查不到)與 2 位以上(跨客人)都回 null ⇒ 呼叫端開不了窗。
  //    ⚠️ 用 `details` 的 id 而不是輸入的 `orderIds` —— 查無的訂單上面已經濾掉了,
  //    拿沒濾過的清單去比會讓「有一張單查不到」被誤判成「跨客人」。
  const distinct = new Set(
    details.map((d) => customerByOrderId.get(d.id)).filter((v): v is string => v !== undefined),
  );
  const complete = distinct.size === 1 && customerByOrderId.size === details.length;

  return {
    // 🔴 **2026-08-10 #351②:不再濾掉 `remaining === 0` 的列。**
    //    舊註解寫「員工看到一個永遠選不了的列只會困惑」,那在「訂購量起算」的舊式下講得通
    //    (可出 0 是罕見態)。改成到貨量起算後,可出 0 變成**常態**(貨還沒到)⇒ 濾掉它
    //    = 員工訂了 4 件卻在彈窗裡一列都看不到,那正是 #351 要修的「以為系統壞了」的變體。
    //    ⇒ 全部吐出去,由 `blockedReason` 告訴他為什麼、由彈窗把它畫成不可選。
    // 🔴 **可出的排前面、出不了的沉底**(Sean 2026-08-10 晚拍 A;backlog `:9425` 逐字)。
    //    理由:一次勾 5 張單可能是 40 列、其中 35 列是灰的,能出的那幾件散在中間就等於沒解決
    //    #351 的「找不到 / 看不懂」。排序放 **server 端**,讓彈窗只負責畫。
    // 🔴 `sort` 的穩定性是這裡的規格,不是實作細節:同一組內要維持「訂單 → 品項」的原順序,
    //    員工才對得起訂單頁。ES2019 起 `Array.prototype.sort` **保證穩定**,所以比較子
    //    **只准比「能不能出」這一個鍵**;多加任何 tie-breaker 都會把那個對齊打散。
    items: details
      .flatMap((d) => itemsOf(d, itemsByOrderId.get(d.id)!, assigned))
      .sort((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0)),
    customerUserId: complete ? [...distinct][0]! : null,
    recipient: details[0]!.shippingAddress,
  };
}
