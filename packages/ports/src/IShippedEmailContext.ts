/**
 * @module @pcm/ports/IShippedEmailContext — 出貨通知信的**寄送時讀取** port(`Q-C9-b` 前置)
 *
 * 🔴 **為什麼需要一個 port,而不是把東西放進 payload**:
 * `packages/adapters/src/email/order-email-assembly.ts:12` 逐字寫著設計意圖 ——
 * 「品項/金額/地址等渲染資料**寄信時即時查主表**,不進 payload(**可後台改的欄存了會過期**)」。
 * 而 `sweepEmailOutbox` 手上只有 `outbox` + `sender`,**沒有任何可以查主表的東西**
 * ⇒ 那個能力不存在。本 port 就是把它做出來。
 *
 * ⚠️ 追蹤碼**後台可改** ⇒ 存進 payload 的是「入列當下」那一刻的值,
 * 員工改過之後信裡帶的是**舊碼** ⇒ 客人拿舊碼去貨運網站查 ⇒ 查無 ⇒ 打電話來,
 * **而信已經寄出去、收不回來**(鐵則 12⑤)。**那條錯在寄出前看不出來** ——
 * payload 裡那個字串是合法的、格式正確的、長度也對。
 *
 * ── 🔴 2026-08-22(M-4b E4-b)接上了 · **而本段原文有一半是錯的,更正一起留著** ──────
 *
 * 🔴🔴 **狀態要分三層講,合成一句就會有一句不成立**(codex 2026-08-22 R1 ③ 抓到我的第二版):
 * ```
 * ① 有實作嗎？   ✅ 有 —— packages/adapters/src/email/SupabaseShippedEmailContextAdapter.ts
 * ② 被建構了嗎？ ✅ 有 —— apps/storefront/src/lib/email/composition.ts 注入 Deps.shippedContext
 * ③ 被【呼叫】了嗎？⛔ ~~🔴 **沒有** —— sweep-email-outbox.ts 只解構 { outbox, sender }，
 *                    整支 use-case 一次都沒有讀 shippedContext。**它現在是「建構後閒置」。**~~
 *                    🔵 **2026-09-03 訂正:已被呼叫。**
 *                    `packages/use-cases/src/sweep-email-outbox.ts:938` 逐字
 *                    `loaded = await deps.shippedContext.loadShippedContext({ orderId, shipmentId });`
 *                    (數法 `grep -c loadShippedContext packages/use-cases/src/sweep-email-outbox.ts` ⇒ **1**,
 *                     開檔看過那 1 行**是碼不是註解**)
 *                    🛑 **而「被呼叫」不等於「信變了」** —— 同檔 `:932` 逐字
 *                    `if (deps.shippedContext === undefined || shipmentId === null)` 那道分支仍在,
 *                    本檔下方「傳不傳 shippedContext,order_shipped 都維持 fail-closed」那句**我沒有重驗**。
 * ```
 * ⇒ ~~「本 port 目前沒有任何 production 呼叫端」~~ 不成立(有實作、有注入),
 *   **而「已經接上了」也不成立**(沒有人呼叫它)。**兩句都錯,所以拆成三行寫。**
 * ⇒ 🔴 **真正呼叫它的是片3**(模板那一片);在那之前它是一個**準備好、但沒被用到**的依賴。
 * 📌 判別句(我自己今天寫的,而我第二版沒對自己用):
 *   **這句話在【這一顆 commit 的內容】之下,是不是真的?**
 *
 * 🔴 **而原文那句「2026-08-18 落地時只做到『介面 + 實作 + use-case 的選用欄』三件」**
 *   —— **三件裡有兩件當時【沒有發生】**(2026-08-22 實測):
 *   ```
 *   grep -rn "ShippedEmailContext" --include='*.ts' . | grep -v node_modules
 *   ⇒ 全 repo 只命中 ports/ 兩支檔（本檔 + index.ts）
 *   ⇒ ❌ adapter 實作 零檔   ❌ use-cases 的選用欄 零欄
 *   ✅ 正對照：同把尺量 IEmailOutbox ⇒ 命中 10 支檔 ⇒ 尺是活的
 *   ```
 *   ⇒ **這段檔頭當時在描述一件沒有發生的事,而它讀起來完全像進度紀錄。**
 *   📌 留著這段更正,是因為下一個人可能又會照著檔頭的字面規劃工作。
 *
 * ⇒ **傳不傳 `shippedContext`,`order_shipped` 都維持 fail-closed** —— 因為根本沒人讀它。
 * 🔴 **而「有這個依賴」不等於「開始寄信」**:`buildEmailText` 對 `order_shipped` 仍然 throw
 *   ⇒ **一封都不寄**。打開那道閘的是模板那一片(片3),不是本 port。
 *   那個狀態由 `sweep-email-outbox.test.ts` 的既有測試 + 2026-08-22 新增的三格持續驗著
 *   (其中一格特別釘住:**給了 `shippedContext` 也一樣不寄**)。
 */

/** 這一箱裡的一列(**辨識用,不是對帳用** —— Sean `Q2`=乙 的定位)。 */
export type ShippedEmailLine = {
  /** 品名快照;缺 → `null`(防禦容缺,與 `AdminOrderDetailItem.title` 同慣例)。 */
  title: string | null;
  /** 這一箱裝了幾件(**不是下單量**)。 */
  quantity: number;
};

/**
 * 一封出貨通知信要印的東西。
 *
 * 🔴 **`linesTruncated` 不是選配,是本型別存在的第二個理由。**
 * 讀取端一定有上限(內嵌 / `max-rows` / 分頁),而**少列幾項的信與正常的信長得一模一樣**
 * —— 客人收到之後照著清單對,少的那一項他不會知道要問。
 * ⇒ 為 `true` 時**呼叫端必須 fail-closed(不寄)**,不得「就把載到的印上去」。
 * 📎 同族的完整分析在 backlog `#629`(**code 依賴一個住在伺服器設定裡的數字**)。
 */
export type ShippedEmailContext = {
  /** 訂單顯示編號(信件主旨與內文都用它)。 */
  orderDisplayId: string;
  /** 箱號。**同一張訂單分批出貨會寄多封,這是收信人分辨「哪一箱」的唯一依據。** */
  shipmentReference: string;
  /** 貨運商顯示名;自取 / 自送 → `null`。 */
  carrierName: string | null;
  /**
   * 追蹤碼。`null` = **這一批沒有碼**(自取 / 自送,Sean `Q3`=甲「照寄,信裡寫無追蹤碼」)。
   * 🔴 **`null` 與「查不到」是兩件事** —— 查不到請整包回 `null`(見 `loadShippedContext`),
   * 不要把讀取失敗降級成「沒有碼」,那會寄出一封說「本批為自取」的假話。
   */
  trackingNumber: string | null;
  /** 這一箱裝了什麼。 */
  lines: ShippedEmailLine[];
  /** 🔴 `lines` 沒載完(見上方 docstring)⇒ 呼叫端 fail-closed、**不寄**。 */
  linesTruncated: boolean;
  /**
   * 這張訂單**還有沒出的東西** ⇒ 信裡要加那一句「其餘商品出貨時會另外通知您」。
   *
   * 🔴 **它存在的唯一理由是一句拍板的【條件】**(Sean 2026-08-30 `q3: C`):
   * C 的第二段逐字是「**這張訂單可能分批出貨,其餘商品出貨時會另外通知您**」,
   * 而他讀到的理由逐字是「**那兩句只在該出現的那一批出現, 不是每封信都變長**」。
   * ⇒ ⇒ **所以這一句需要一個條件, 而在本欄之前【這個型別答不出那個條件】** ——
   * 六個欄位裡沒有任何一個講得出「這張單還有沒有別的東西沒出」。
   *
   * 🔴 **判準逐字對齊 DB 那一側**(`supabase/migrations/20260816050000_m4b_522_*.sql:88-90`):
   * ```
   * 全出完 ⟺ bool_and( COALESCE(shipped_quantity,0)
   *                    >= GREATEST(quantity - COALESCE(cancelled_quantity,0), 0) )
   * ⇒ 本欄 = NOT 全出完
   * ```
   * ⚠️ **`cancelled_quantity` 那一項不是裝飾**:少了它, 一張「訂 3 件、取消 1 件、出 2 件」的單
   * 會被判成還有東西沒出 ⇒ **客人收到一封說「其餘商品會再通知」的信, 而永遠不會有下一封。**
   *
   * 🛑 **兩個方向的錯都會打電話進來, 而它們不對稱**:
   * ```
   * 印了而其實出完了 ⇒ 客人等一封永遠不會來的信
   * 沒印而其實還有  ⇒ 客人收到第二封時以為我們重複寄（那正是他選 C 要防的）
   * ```
   */
  orderHasUnshippedItems: boolean;
};

/**
 * 寄送當下去主表撈這一箱的脈絡。
 *
 * 🔴 **回 `{kind:'unavailable'}` = 「讀不到」,不是「沒有東西」。** 呼叫端必須 fail-closed(不寄、計 error),
 * **不得**退化成一封沒有品項或沒有追蹤碼的通用信 —— 那是 DB COLUMN COMMENT 明文禁止的
 * (`supabase/migrations/20260805170000_*` 逐字:「**不得寄出「已出貨但無單號」的通用信**」)。
 * ⚠️ 而「**沒有碼**」這個合法狀態走的是 `trackingNumber: null`,**不是** `unavailable`。
 * **兩者不可以合併** —— 合併之後「系統壞了」與「這批本來就沒碼」在呼叫端變成同一件事。
 * 🔴 而**同一條原則在高一層也適用**:「箱被作廢」走 `voided`,不是 `unavailable`(見下方型別)。
 */
/**
 * 讀取結果。**三態,而分成三態的理由是【告警】不是型別潔癖**(Fable 2026-08-22 R2 F2)。
 *
 * 🔴 原本是 `ShippedEmailContext | null`,而那把**兩件完全不同的事**壓成同一個 `null`:
 * ```
 * 箱子被作廢了  = **正常業務動作**（裝箱打錯的唯一補救就是整箱作廢重開，
 *                 `20260805170200` COMMENT 逐字、Sean Q-a=C）⇒ 不罕見
 * 讀不到 / 壞了 = 異常 ⇒ 要有人來看
 * ```
 * 合併之後會發生什麼(它推的失敗鏈,而我認為它成立):
 * 信排進佇列 → 員工把箱子作廢 → 每一輪 claim 都拿到 `null` → throw → `errors` +1 → route 503
 * → 燒完 attempts 進死信 → **訊號 2 每日告警** ⇒ **有人半夜起來查一個正常的業務動作。**
 *
 * 🔴 而這正好違反了本檔自己上面立的原則:**「兩種 null 不可以合併」** —— 我在低一層守住了
 * (`trackingNumber: null` vs 整包 null),**卻在高一層自己犯了同一件事**。
 *
 * ⚠️ **`voided` 不代表「可以當作沒事」** —— 呼叫端應該落一列「跳過」的痕跡
 * (先例:`markSkippedOrderIneligible`),**不是靜默丟掉**。
 * 少了痕跡的話,「這封信為什麼沒寄」日後查不到任何東西。
 */
export type LoadShippedContextResult =
  /** 撈到了,可以寄。 */
  | { kind: 'ok'; context: ShippedEmailContext }
  /** 這一箱已作廢 = **預期中的狀態**。呼叫端:不寄、落跳過痕跡、**不要計 error**。 */
  | { kind: 'voided' }
  /**
   * 讀不到、或撈回來的東西對不上(箱不存在 / 還沒標出貨 / 這張單在這箱 0 項 / 撈不到 display_id)。
   * 🔴 呼叫端必須 fail-closed:**不寄、計 error**。這一態**應該**吵。
   */
  | { kind: 'unavailable' };

export interface IShippedEmailContext {
  loadShippedContext(input: {
    orderId: string;
    /** 對應 `email_outbox` 那一列的批次(一箱一封 ⇒ 一列一箱)。 */
    shipmentId: string;
  }): Promise<LoadShippedContextResult>;
}
