// shipment-list-view.ts —— 出貨清單那一頁的**語意層**(純函式,不碰 DB、不碰 React)。
//
// ══ 規格出處 ═══════════════════════════════════════════════════════════════
// Sean 2026-09-10 逐字:
//   「甲 = 現在做一頁最陽春的 —— 一個列表:**日期 / 箱號 / 訂單 / 客人 / 貨號 / 狀態**,
//     可以挑日期,每一列可以直接點去印。上線前做得完。」
// 🛑 **六欄,不加第七欄。** 不做批次動作。**只讀,不寫。**
//
// ══ 🔴 鐵則 1:稿裡沒有這一頁,而那是量過的(窗B 量,2026-09-10)═══════════
//   `HANDOFF-orders-ui.md`(4,309 行)搜「出貨清單 / 包裹清單 / 出貨列表 / 箱子列表 /
//     shipments 頁 / 清單頁」⇒ **0**
//   🟢 正對照:同一把尺搜「箱號」⇒ 命中 `:1963` / `:2079` / `:2110`
//     (**而那些是【列印版面】,不是清單頁**)
//   🔴 `grep -rli` 整個 OD 專案目錄 `pcm-524f` ⇒ **0 支檔**提到出貨清單
// ⇒ 📌 **不是「那支稿沒寫」,是整個 OD 專案沒有這一頁。**
// ⇒ ✅ **樣式沿用後台既有列表**(`app/orders/refund-exceptions/page.tsx` 那張陽春表),
//   **不新做一套視覺,也不憑記憶發明。**
//   🔵 形狀照抄 `components/orders/shipment-section.tsx:322-345` 那段的寫法:
//     「稿裡沒有這顆鈕,所以樣式沿用同排那顆而不是照稿」。
//
// ══ 🔴🔴 三個承重的判斷,全部有正式庫實測撐著(2026-09-10 唯讀)═══════════
// 四箱全量:
// ```
// 箱號    carrier  hct_status  tracking_number  hct_request_id  shipped_at  deleted_at
// XS6XVY  hct      draft       123123           (空)            有          有  ← 作廢
// ZN2HDP  hct      draft       31223            (空)            有          有  ← 作廢
// ZNDXJP  other    draft       123              (空)            有          有  ← 作廢
// S9FC6P  hct      submitted   (空)             8947081964      (空)        (空) ← 第一箱, 活著
// ```
// 🎯 **⇒ 照字面接 DB 的話,Sean 最想看的那一箱【日期與貨號兩欄都空白】,
//    而三個作廢的箱反而是滿的。** 他打開第一眼會覺得這頁壞了。
// 🛑 而三個作廢箱的 `tracking_number`(`123123` / `31223` / `123`)**是人手打的測試值**,
//    不是真貨號 —— 這一點決定了下面「貨號欄」的優先序理由。

/** 一箱在清單上的原始輸入(取數層負責填,語意由本檔決定)。 */
export type ShipmentListRow = {
  shipmentId: string;
  shipmentReference: string;
  carrierCode: string;
  hctStatus: string;
  trackingNumber: string | null;
  /**
   * 🔴 **新竹配的貨號就住在這一欄。**
   * 出處:`hct-submit-flow.ts:115` / `:133` / `:143` 逐字 `requestId: out.edelno`
   * ⇒ 送單成功之後 `edelno`(新竹的貨號)被寫進 `shipments.hct_request_id`。
   * 🟢 **實測**(2026-09-10 唯讀正式庫):S9FC6P 的 `hct_request_id` = `8947081964`
   *    —— 逐字就是 Sean 說「已經送出去」那一箱的貨號。
   * 🛑🛑 **⇒ 所以【不要】去讀 `hct_raw_response`** —— 同一個值在那包 19,432 bytes 的
   *    jsonb 裡也有(`edelno`),而 `shipment-repository.ts:460-467` 逐字拒絕過那件事:
   *    「往它加 `raw` 就是把每箱 ~20KB 的圖拉進**每一次頁面渲染**, 而那一頁根本不印圖。」
   *    ⇒ 📌 **那句話的形狀逐字命中這一頁**,而同一個字串在一個普通小欄位裡就拿得到。
   */
  hctRequestId: string | null;
  shippedAt: string | null;
  voidedAt: string | null;
  createdAt: string;
  recipientName: string | null;
  /**
   * 這一箱裝到的訂單(去重後,依 display_id 排序)。
   * 🔴 **它是【多值】,不是一格** —— `shipment-repository.ts:857` 逐字:
   *    「回傳的箱子**可能還裝著別單的品項** —— **箱子掛客人不掛訂單**。
   *      呼叫端要自己決定只列本單的品項。」
   * ⇒ 📌 **不是「schema 沒擋」,是這個 codebase 已經知道會發生, 並把責任明文交給呼叫端。**
   * ⚠️ 而正式庫今天四箱**全部是單值** —— 🛑 **分母 4 ⇒ 那是「還沒發生過」,不是「不可能」。**
   */
  orders: readonly { orderId: string; displayId: string }[];
};

/** 一欄的顯示值 + 它是不是**退而求其次**來的。 */
export type CellWithFallback = {
  text: string;
  /** 非 null ⇒ 這個值不是那一欄的第一來源,畫面要把這句小字印出來。 */
  note: string | null;
};

/**
 * 日期欄。
 *
 * 🔴🔴 **`shipped_at` 空的時候【不准印「—」】。**
 *    「這一箱沒有出貨日」與「它還沒走到標記出貨那一步」是**兩件不同的事**,
 *    而一個 `—` 會把它們印成同一個畫面 —— 那正是這個專案一直在踩的那一族。
 * ✅ 退回 `created_at`(建箱日,`NOT NULL` ⇒ 一定有值),而**帶一句小字說明它是建箱日**。
 */
export function shipmentListDate(row: ShipmentListRow): CellWithFallback {
  if (row.shippedAt !== null && row.shippedAt !== '') {
    return { text: row.shippedAt, note: null };
  }
  return { text: row.createdAt, note: '建箱日(還沒標記出貨)' };
}

/**
 * 貨號欄。
 *
 * 🔵 **優先序是 `tracking_number` 先、`hct_request_id` 後**,而理由不是「哪個比較新」:
 *    `tracking_number` 是**人手填的欄**(任何貨運商都能用);`hct_request_id` 只有走新竹才有值。
 *    ⇒ 員工自己打進去的號碼**應該蓋過系統推回來的**,否則他改不動它。
 * ⚠️ **而今天正式庫的四箱剛好證明兩邊都會發生**:三個作廢箱有人手值、真的那一箱只有新竹配號。
 * 🔴 兩者都沒有 ⇒ 印「尚未取得」,**不是「—」**(同上,兩種空不能長一樣)。
 */
export function shipmentListTracking(row: ShipmentListRow): CellWithFallback {
  if (row.trackingNumber !== null && row.trackingNumber.trim() !== '') {
    return { text: row.trackingNumber, note: null };
  }
  if (row.hctRequestId !== null && row.hctRequestId.trim() !== '') {
    return { text: row.hctRequestId, note: '新竹配號' };
  }
  return { text: '尚未取得', note: null };
}

/**
 * 狀態欄 —— Sean 只說「狀態」,而 DB 上是**三個不同的東西**。這是我的對應表。
 *
 * ```
 * deleted_at 非空                          ⇒ 已作廢     (終態, 蓋過一切)
 * shipped_at 非空                          ⇒ 已出貨
 * carrier=hct 且 hct_status='submitted'    ⇒ 新竹已收單
 * 其餘                                     ⇒ 已建立
 * ```
 * 🔴 **順序是承重的**:作廢排第一,因為一個作廢的箱**同時**可能有 `shipped_at`
 *    (正式庫三個作廢箱全部是這樣)⇒ 順序反了會把作廢的箱印成「已出貨」。
 * 🔵 **「新竹已收單」與「已出貨」刻意分開**:S9FC6P 是 `submitted` 而 `shipped_at` 空 ——
 *    📌 **「新竹收單了」與「我們標記出貨了」是兩件事**,合成一句會讓員工以為貨已經走了。
 * 🛑 `hct_status` 的其他值(`draft` / `unknown` …)**不各給一句** —— Sean 要的是「最陽春的」,
 *    而那些值今天在畫面上分不出對員工的差別。要細分是另一片。
 */
export function shipmentListStatus(row: ShipmentListRow): string {
  if (row.voidedAt !== null && row.voidedAt !== '') return '已作廢';
  if (row.shippedAt !== null && row.shippedAt !== '') return '已出貨';
  if (row.carrierCode === 'hct' && row.hctStatus === 'submitted') return '新竹已收單';
  return '已建立';
}

/** 這一箱是不是作廢了(列印入口的唯一判準)。 */
export function isVoided(row: ShipmentListRow): boolean {
  return row.voidedAt !== null && row.voidedAt !== '';
}

/**
 * 列印連結要用哪一張訂單的 id。
 *
 * 🔴🔴 **三顆列印 URL 都長 `/print/orders/<orderId>/shipping/<shipmentId>`,
 *    而 route 那一層【不信網址】** —— 它先用訂單查它的箱,找不到就 404。
 * ⇒ 📌 **一個跨兩張單的箱子,挑錯那張單 ⇒ 按下去是 404,而畫面上看不出為什麼。**
 * ✅ **所以這裡挑的必須是【畫面上印出來的那一張】** —— 讓員工**看到的那張單**與
 *    **按下去會開的那張單**是同一張。兩者不一致的話,他按了 404 會以為壞了,
 *    而其實是他看到 A、按到 B。
 * 🔵 而「畫面上印哪一張」= `orders[0]`(取數層已依 `displayId` 排序 ⇒ 穩定,不隨查詢順序漂)。
 */
export function printOrderId(row: ShipmentListRow): string | null {
  return row.orders[0]?.orderId ?? null;
}

/**
 * 訂單欄要印的字。
 *
 * 🔵 **印第一張 + 「還有 N 張」**,而不是假設只有一張 —— 理由見 `orders` 那個欄位的註解。
 * 🔴 一箱一個 `shipment_item` 都沒有(理論上不該發生,而 DB 沒有約束擋)⇒ 印「查無訂單」,
 *    **不是空白** —— 空白會讓人以為是版面沒對齊。
 */
export function shipmentListOrders(row: ShipmentListRow): {
  first: { orderId: string; displayId: string } | null;
  moreCount: number;
} {
  const first = row.orders[0] ?? null;
  return { first, moreCount: Math.max(0, row.orders.length - 1) };
}

/**
 * 託運標籤那顆鈕要不要出現。
 *
 * 🔴 **條件不放寬** —— 逐字沿用 `shipment-section.tsx:346-357` 的既有立場:
 *    沒送新竹就沒有圖,那條 route 會回 **409**
 *    ⇒ 「**讓一顆按了必定失敗的鈕出現在畫面上, 比不出現更糟。**」
 * ⚠️ 而那段檔頭自己也標了天花板:**`submitted` 不保證那一包裡有一張看得懂的圖**
 *    ⇒ 📌 **這一格不要讀成「submitted 就一定印得出來」。**
 * 🛑 **而這只是 UX,不是守門** —— 網址可貼、可書籤 ⇒ 真守門在 route 那一層。**兩層都要。**
 */
export function canPrintLabel(row: ShipmentListRow): boolean {
  return !isVoided(row) && row.carrierCode === 'hct' && row.hctStatus === 'submitted';
}
