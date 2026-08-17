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
 * ── 🔴 本 port 目前【沒有任何 production 呼叫端】────────────────────────
 *   2026-08-18 落地時只做到「介面 + 實作 + use-case 的選用欄」三件,
 *   **`composition.ts` 那一行【刻意沒接】** —— 它是唯一會改變執行時行為的一步,
 *   卡在一個具體的授權缺口(見 `docs/specs/2026-08-17-qc9b-sweeper-read-port-plan.md` 檔頭)。
 *   ⇒ **不傳 `shippedContext` 時,`order_shipped` 維持今天的 fail-closed**,
 *     而那個狀態由 `sweep-email-outbox.test.ts` 的 10 格既有測試持續驗著。
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
};

/**
 * 寄送當下去主表撈這一箱的脈絡。
 *
 * 🔴 **回 `null` = 「讀不到」,不是「沒有東西」。** 呼叫端必須 fail-closed(不寄、計 error),
 * **不得**退化成一封沒有品項或沒有追蹤碼的通用信 —— 那是 DB COLUMN COMMENT 明文禁止的
 * (`supabase/migrations/20260805170000_*` 逐字:「**不得寄出「已出貨但無單號」的通用信**」)。
 * ⚠️ 而「**沒有碼**」這個合法狀態走的是 `trackingNumber: null`,**不是**整包 `null`。
 * **兩者不可以合併** —— 合併之後「系統壞了」與「這批本來就沒碼」在呼叫端變成同一件事。
 */
export interface IShippedEmailContext {
  loadShippedContext(input: {
    orderId: string;
    /** 對應 `email_outbox` 那一列的批次(一箱一封 ⇒ 一列一箱)。 */
    shipmentId: string;
  }): Promise<ShippedEmailContext | null>;
}
