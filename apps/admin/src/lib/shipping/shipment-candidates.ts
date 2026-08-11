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

import type { AdminOrderDetail } from '@pcm/domain';
import { getAdminOrderRepository } from '../orders/order-repository';
import {
  listAssignedQuantitiesByOrderItemIds,
  listOrderCustomerUserIds,
} from './shipment-repository';

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

/** 從一張訂單明細算出它的候選品項(不含金額)。 */
function itemsOf(detail: AdminOrderDetail, assigned: Map<string, number>): ShipmentCandidateItem[] {
  return detail.items.map((it) => {
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
 * ⚠️ 逐張訂單各打一次 `findAdminOrderDetail`(N 張 = N 次查詢)。
 * 員工一次勾的張數是個位數 ⇒ 先用最簡單的做法;真的變慢再改批次查詢,**不預先最佳化**。
 */
export async function loadShipmentCandidates(
  orderIds: readonly string[],
): Promise<ShipmentCandidates> {
  if (orderIds.length === 0) return { items: [], customerUserId: null, recipient: null };

  const repo = getAdminOrderRepository();
  const details = (await Promise.all(orderIds.map((id) => repo.findAdminOrderDetail(id)))).filter(
    (d): d is AdminOrderDetail => d !== null,
  );
  if (details.length === 0) return { items: [], customerUserId: null, recipient: null };

  const allItemIds = details.flatMap((d) => d.items.map((it) => it.id));
  const [assigned, customerByOrderId] = await Promise.all([
    listAssignedQuantitiesByOrderItemIds(allItemIds),
    listOrderCustomerUserIds(details.map((d) => d.id)),
  ]);

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
      .flatMap((d) => itemsOf(d, assigned))
      .sort((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0)),
    customerUserId: complete ? [...distinct][0]! : null,
    recipient: details[0]!.shippingAddress,
  };
}
