import type { AdminOrderItemProcurement, AdminProcurementReplyStatus } from '@pcm/domain';

// item-stuck.ts — 「這個品項卡住了嗎」的**唯一定義**(M-4b 訂單面板線 片6,線主 W1 裁【丙】)。
//
// 🔴🔴 **為什麼是一支獨立的檔、而且只有一個定義**
//    設計稿在卡住的那一項旁邊畫了一顆紅 chip「異常」,並讓那一項**自己展開**
//    (`~/pcm-mailbox/MAIN-057-…-20260819.md` §1 區塊② 逐字:「這一項【展開】了(卡住的那一項會自己打開)」)。
//    而「卡住」這個詞會同時被**品項列的自動展開**與**未來的商品卡**用到 ——
//    兩邊各判各的話,症狀是**畫面自洽而互相矛盾**(這一項的卡是開的,而它旁邊沒有紅 chip),
//    **不會有任何東西紅**。⇒ 定義寫一次,兩邊都吃這支。
//
// 🔴 **「異常」這個值系統裡【不存在】—— 這是【新定義】,不是沿用**(W1 2026-08-19 實查):
//    `REPLY_STATUS_LABEL`(`procurement-view.ts`)只有五個值:
//      no_reply 未回覆 / confirmed 已確認 / price_changed 改價 / out_of_stock 缺貨 / partial 部分出貨
//    `grep -n "異常" procurement-view.ts` ⇒ **0 命中**。
//    ⇒ 設計稿那顆紅 chip 的範例文字是「缺料,最快九月初出貨」⇒ 對得上的只有 `out_of_stock`。
//
// 🔴 **起手值只認 `out_of_stock`,而【要不要放寬是線主的決定,不是我的】**(W1 明定的約束):
//    放寬(例如把 `price_changed`、或「到貨 < 訂貨」也算)會直接決定
//    **員工打開單子時有幾張卡是開的** —— 寬了等於全開,等於沒有這個功能。
//    ⇒ 想擴,先回報 W1。**不要在這支檔裡自己加一個值。**

/**
 * 判斷結果。**三個世界,不是兩個** —— 這是本檔最重要的形狀。
 *
 * 🔴 **`unknown` 不是「不卡」的一種**。本 repo 對這件事有明文家規(`#646`):
 *    「沒讀到」與「沒有」被拆成兩個欄位表達,就是因為**一個旗標兩個世界 ⇒ 消費端分不出自己在哪一個**。
 *    ⇒ 呼叫端**必須**把 `unknown` 畫出來(見 `describeItemStuck`),
 *      靜靜地當成 `not-stuck` = 卡住的那一項不會自己打開,**而畫面看起來完全正常**。
 */
export type ItemStuckVerdict =
  | { readonly kind: 'stuck'; readonly reason: StuckReason }
  | { readonly kind: 'not-stuck' }
  /**
   * 判不出來。`why` 分兩種,**因為它們對員工的意思不同**
   * (`procurements === null` vs `procurementTruncated`,兩個欄位回答兩個不同的問題):
   * · `unreadable` —— 採購清單**整個沒回來**(投影退版 / 權限變動)。
   *   ⚠️ 我們**沒有證據說它是哪個世界** ⇒ 不宣稱、不猜。
   * · `possibly-incomplete` —— 清單回來了但**可能被截斷**,而我看到的這幾筆裡沒有缺貨。
   *   🔴 **重整不會好**(`types.ts:840` 逐字:「這個世界重整不會好,文案不得叫員工**重整**」)。
   */
  | { readonly kind: 'unknown'; readonly why: 'unreadable' | 'possibly-incomplete' };

/**
 * 目前算「卡住」的回覆狀態。**擴充要先問線主**(見檔頭)。
 *
 * 🔴 **`as const` 不是裝飾(R3 nit L)**:它讓下面的 `StuckReason` 從這個陣列**導出**,
 *    於是「往這裡加一個值」會被型別一路逼到 `STUCK_REASON_LABEL` ——
 *    **不加文案就 typecheck 紅**。
 *    ⚠️ 在此之前 `reason` 與那句文案都是**寫死**的,與這個陣列**只有註解耦合**:
 *    加 `'price_changed'` 是型別合法的,而畫面會對一筆改價的採購說「供應商回報缺貨」
 *    ⇒ **標籤說謊,而沒有任何東西會紅。**
 */
const STUCK_REPLY_STATUSES = ['out_of_stock'] as const;

/** 卡住的原因 —— 從上面那個陣列導出,不另外寫一份。 */
export type StuckReason = (typeof STUCK_REPLY_STATUSES)[number];

/** 每個原因對員工講的話。**加一個 `StuckReason` 而沒加這裡 ⇒ typecheck 紅。** */
const STUCK_REASON_LABEL: Record<StuckReason, string> = {
  out_of_stock: '供應商回報缺貨',
};

/** 這個回覆狀態算不算卡住(type guard —— 讓 `find` 的結果帶著窄型別出來)。 */
function isStuckStatus(status: AdminProcurementReplyStatus): status is StuckReason {
  return (STUCK_REPLY_STATUSES as readonly AdminProcurementReplyStatus[]).includes(status);
}

/**
 * 這個品項卡住了嗎。
 *
 * 🔴🔴 **不對稱是刻意的,而它是本函式的核心**:
 * ```
 * 看到一筆缺貨            ⇒ stuck        —— 即使清單被截斷,這個【正面發現】仍然成立
 * 沒看到、而清單是完整的   ⇒ not-stuck    —— 這才是一個真正的否定
 * 沒看到、而清單可能被截斷 ⇒ unknown      —— 沒看到的那幾筆裡可能就有
 * 清單整個沒回來          ⇒ unknown      —— 什麼都不知道
 * ```
 * ⇒ **「找到」與「沒找到」的證據強度不對等** —— 截斷吃掉的是**否定**的效力,不是肯定的。
 *   把這四格塌成 `some(...)` 一行,第三格會變成「not-stuck」,而那是一句**沒有證據的否定**。
 *
 * @param procurements `null` = 讀不到(**不是**「沒有採購」)
 * @param truncated `true` = 清單可能不完整
 */
export function resolveItemStuck(
  procurements: readonly AdminOrderItemProcurement[] | null,
  truncated: boolean,
): ItemStuckVerdict {
  if (procurements === null) return { kind: 'unknown', why: 'unreadable' };

  // 🔴🔴 **`voidedAt == null` 少不得 —— 這是一個【已經被明文命名】的失效模式(R1 must-fix 3)。**
  //    `packages/domain/src/order/types.ts:773` 逐字:
  //    「**任何 `find`/`some`/`length` 只要不帶 `voidedAt === null` 就可能命中作廢那列**」。
  //    成因(同段 `:771-772`):business key 是 partial unique(`WHERE voided_at IS NULL`)
  //    + Sean `Q-S1=A` 允許對同一家重下單 ⇒ **同一個 `(order_item_id, supplier_id)` 可以有兩列**。
  //
  //    失敗情境(可構造,而且是日常流程):
  //      供應商 A 回 `out_of_stock` → 員工**作廢**該列、改向 B 重下 → B `confirmed` 且貨已到。
  //      `procurements` 仍含 A 那列(`voidedAt != null`、`replyStatus: 'out_of_stock'`)
  //      ⇒ 沒有這道過濾的話,這個品項**永遠**回 `stuck` ⇒ 那張卡永遠自己展開、
  //        永遠寫著「供應商回報缺貨」,**而貨早就到了**。
  //
  // 🔴 **`== null` 而不是 `=== null`,這一個字元決定壞掉時往哪邊倒** ——
  //    慣例與完整理由在 `procurement-view.ts:124-133`(逐字寫了兩個方向的後果):
  //    `voidedAt` 變成 `undefined` 是可能的(投影退版 / 手寫 fixture 繞過型別),
  //    而 `=== null` 會把**每一列**都判成作廢 ⇒ 這裡會退化成「永遠不卡住」= 靜默關掉整個功能。
  //    `== null` 缺欄時退回「舊行為」(可能挑到作廢列),**不會更糟**。
  //    ⇒ 照那條慣例:選「壞掉時只退回原狀、不新增破壞」的方向。**不要自己改成 `===`。**
  const hit = procurements.find((p) => p.voidedAt == null && isStuckStatus(p.replyStatus));
  // 🔴 先判命中再判截斷 —— 順序不可換(見上方那張表的第一列)。
  // 🔴 `reason` 取**命中那一列的實際值**,不寫死(R3 nit L)—— 標籤不會與集合脫節。
  if (hit !== undefined && isStuckStatus(hit.replyStatus)) {
    return { kind: 'stuck', reason: hit.replyStatus };
  }

  if (truncated) return { kind: 'unknown', why: 'possibly-incomplete' };
  return { kind: 'not-stuck' };
}

/**
 * 給員工看的一句話。`null` = 這一列不需要多說什麼(沒卡住、而且我們確定)。
 *
 * 🔴 **`unknown` 一定要有字** —— 那正是「不是靜靜地當作沒事」那條:
 *    回 `not-stuck` 而不出聲,與「真的沒卡住」在畫面上**完全一樣**。
 * 🔴🔴 **兩種 `unknown` 的文案要求【方向相反】,不可以套同一條規則(R1 must-fix 4 + nit I)**:
 *
 * · `possibly-incomplete`(截斷)—— `types.ts:840` 逐字:
 *   「**這個世界重整不會好,文案不得叫員工重整**」⇒ **不提重整**。
 *   ⚠️ 原字面是「**重整**」;我一度引成「重新整理」,多兩個字**把它的射程放寬了**,
 *      於是被我自己套到下面那一種身上 —— **改寫一個字面,就改寫了它管得到誰。**(nit I)
 *
 * · `unreadable`(`procurements === null`)—— `types.ts:826-830` 逐字要求**相反**的事:
 *   成因有兩種(投影退版 ⇒ 重整**可能**會好 / 固定限制 ⇒ 不會好),而我們分不出是哪一種
 *   ⇒ 「**標未確認,兩種都當可能** ⇒ 顯示端一律用**條件句**(可以先重整看看／
 *   還是這樣就是固定限制),**不得往任一邊斷言**。(`#646` 關卡2 code-reviewer 抓到這個矛盾。)」
 *   同段 `:834` 並要求「給員工的話要說「**重新整理**」—— 那是這一種真的會好的世界」。
 *   ⇒ 🔴 我第一版寫「請告知系統維護」= **直接斷言「重整沒用」**,正是 `:830` 那條被關卡2
 *     抓過的矛盾重演。已改成條件句。
 */
export function describeItemStuck(verdict: ItemStuckVerdict): string | null {
  switch (verdict.kind) {
    case 'stuck':
      return STUCK_REASON_LABEL[verdict.reason];
    case 'not-stuck':
      // 🔴 只有這一格可以沉默 —— 我們**確定**它沒卡住。
      return null;
    case 'unknown':
      return verdict.why === 'unreadable'
        ? // 條件句:兩種成因都當可能,不往任一邊斷言(types.ts:826-830 / :834)
          '讀不到這一項的採購資料,無法判斷它有沒有卡住。可以先重新整理看看;如果還是這樣,請告知系統維護。'
        : // 截斷:重整不會好 ⇒ 一個字都不提重整(types.ts:840)
          '採購清單可能不完整,無法確定這一項有沒有卡住。請告知系統維護。';
  }
}
