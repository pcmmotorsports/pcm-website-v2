/**
 * invoiceCheatSheet —— 發票小抄的三個數(未稅 / 稅 / 總計), 純函式。
 *
 * 🎯 **Sean 2026-09-13 逐字判準**:「**單純方便我開發票時候抄寫用**」
 * ⇒ 📌 那個畫面**不是資料輸入表單, 是抄寫小抄**:他手上拿著一張**紙本發票**要寫。
 * ⇒ 🔴🔴 **這三個數會被抄到紙上, 而紙收不回來。** 本檔錯一個字, 錯的是實物。
 *
 * ── 🔴 分界 = `orders.price_tax_mode`, **不是**「有沒有勾開發票」──────────────
 *   · `exclusive` = 未稅、稅另計(2026-09-05 起的後台手動單)⇒ 稅是**存好的**
 *   · `inclusive` = 含稅(顧客站 `create_order`, 以及該欄加上去之前的**所有**既有單)
 *                   ⇒ 系統只存含稅一個數、`tax_total = 0` ⇒ 稅要**拆出來**
 *   · `null`      = 讀不到 ⇒ **整塊不印**(見下面 fail-closed 那段)
 *
 *   🛑 **不可以用 `taxTotal === 0` 代替它** —— 那分不出「含稅舊單」與「真的免稅」,
 *      而**「`exclusive` 而 `tax_total = 0`」是真實存在的兩種單**
 *      (`apps/admin/src/components/orders/order-detail-items-support.tsx:155-160` 逐字):
 *        後台手動單稅基 < 10 元 ⇒ 5% 捨入成 0 · 前台經銷客人付轉帳 ⇒ `v_tax := 0`
 *      ⇒ 用 `taxTotal` 判, 這兩種單會被當成 `inclusive` ⇒ **被除以 1.05** ⇒ 印出比訂單少的數。
 *
 * ── 🔴 `inclusive` 的拆法 = **殘差**, 與貼板 121 同一支算式 ─────────────────
 *   `20260910090000` 檔頭實量:`未稅 = round(含稅 / 1.05)` · `稅 = 含稅 − 未稅`(1100 ⇒ 1048 / 52)
 *   🛑 **不可以改成正推** `round(未稅 × 5%)` —— 同一份檔頭實算「兩者在 1..20,000 裡
 *      **有 952 個金額差一塊**」。差一塊, 就是紙本發票上的一塊。
 *
 * ── 🔴🔴 而我**沒有照規格 §6-13 逐字做**, 這一格要說清楚 ────────────────────
 *   規格 §6-13 寫「`exclusive` 的單:小抄三個數 = `subtotal` / `tax_total` / `total` **原值**」。
 *   🛑 **那在有運費的單上不成立**, 而後果是紙本發票**自己加不起來**:
 *     RPC 逐字(`20260910090000:681`, `:722`):
 *       稅基 = **小計 + 運費 − 折扣** · `v_total := v_subtotal + p_shipping_fee + v_tax`
 *     ⇒ 反例:小計 1000 · 運費 200 · 稅 `round(1200 × 5%) = 60` · 總計 **1260**
 *       · 照規格印 ⇒ 未稅 **1000** / 稅 60 / 總計 1260 ⇒ **1000 + 60 = 1060 ≠ 1260** ❌
 *       · 本檔印   ⇒ 未稅 **1200** / 稅 60 / 總計 1260 ⇒ **1200 + 60 = 1260** ✅
 *   📌 **三聯式發票上「銷售額 + 營業稅額」必須等於總計** —— 那不是美觀, 那是那張紙的規則。
 *   ⇒ ✅ 所以 `untaxed` **一律由 `total − tax` 反推**, 兩種 mode 共用一行:
 *      **它在結構上保證三個數加得起來**, 而「照原值印」做不到這件事。
 *   ⚠️ 今天正式庫的手動單運費都是 0 ⇒ 兩種算法**在現有資料上結果相同**
 *      ⇒ 🔴 **那正是它危險的地方:它不會在今天叫, 會在第一張有運費的單上叫, 而那時它已經在紙上。**
 *
 * ── 🛑 零寫入(承重, Sean 明文否決過往那個方向)──────────────────────────
 *   本檔是**純函式**:不碰 DB、不改 `price_tax_mode` / `tax_total` / `total` / `unit_price`。
 *   二聯 / 三聯的切換只換**呈現**, 不換這三個數 —— 那是呼叫端的事, 不在這裡。
 *
 * ── 🎯 兩本帳(Sean 2026-09-13 逐字)────────────────────────────────────
 *   「並不應該要去連動到我們系統紀錄的訂單金額, 因為我在算營業額的時候
 *     我不會把含稅發票的稅金算進去」
 *   ⇒ 📌 **訂單金額(營業額)與發票金額本來就不相等, 而他要的正是這件事。**
 *   ⇒ 🔴 所以畫面上那三個數的標籤要說「**發票上要寫的**」, 不要只寫「小計 / 稅 / 總計」
 *      讓人以為那是訂單金額。**標籤是呼叫端的事, 而這條理由住在這裡, 因為數字在這裡。**
 */

/** 營業稅率(5%)。與 `tax.ts` 的 `VAT_RATE` 同值, **刻意各自持有**:那一支是正推、本支是殘差, 兩條路的依據不同。 */
const VAT_DIVISOR = 1.05;

/** `orders` 的金額欄是 `integer` ⇒ 上限。與 RPC 那道溢位閘同一個數(`20260910090000:724`)。 */
const MAX_ORDER_AMOUNT = 2147483647;

export type InvoiceCheatSheetInput = {
  /** `orders.price_tax_mode` 原值。**`null` = 讀不到**, 不是 `'inclusive'` 的同義詞。 */
  readonly priceTaxMode: 'inclusive' | 'exclusive' | null;
  /** `orders.total` 原值(元位整數)= 客人實際要付的含稅總額。 */
  readonly total: number;
  /** `orders.tax_total` 原值(元位整數)。`inclusive` 的單恆為 0, 本檔不讀它。 */
  readonly taxTotal: number;
  /**
   * `orders.invoice_requested` —— 這張單**要不要**開發票(建單當下的決定)。
   * `false` ⇒ 整塊不印(畫面換成「此單不開發票」那句)。
   */
  readonly invoiceRequested: boolean;
};

export type InvoiceCheatSheet = {
  /** 銷售額(未稅)—— 三聯式要寫的第一個數。 */
  readonly untaxed: number;
  /** 營業稅額 —— 三聯式要寫的第二個數。 */
  readonly tax: number;
  /** 總計 —— 二聯式**唯一**要寫的數, 也是三聯式的第三個數。恆等於 `orders.total`。 */
  readonly total: number;
};

/**
 * 算出小抄要印的三個數;**算不出來就回 `null`, 呼叫端整塊不印**。
 *
 * 🔴🔴 **`null` 的三個成因, 對畫面是同一件事:不要印。**
 *   ① `invoiceRequested === false` —— 這張單不開發票, 沒有「發票上要寫的數」這回事。
 *   ② `priceTaxMode === null` —— **讀不到這張單的稅口徑。**
 *      🛑 **不可以挑一個預設值**:DB 端那一欄有 `DEFAULT 'inclusive'`, 而
 *         **「DB 的預設」與「我讀不到時該假設什麼」是兩件事**。
 *         猜錯的方向(把 `exclusive` 當 `inclusive`)正好是**印出比訂單少**的那個方向。
 *   ③ `total` 不是有限的非負整數 —— 壞資料進來寧可不印。
 *
 * ⇒ 📌 **寧可讓他看到「算不出來, 請通知系統維護」, 也不要給他一個看起來很正常的錯數字。**
 *    前者他會停下來問;後者他會抄到紙上。
 */
export function invoiceCheatSheet(input: InvoiceCheatSheetInput): InvoiceCheatSheet | null {
  if (!input.invoiceRequested) return null;
  if (!Number.isInteger(input.total) || input.total < 0) return null;
  // 🔴 `integer` 上限 —— 金額欄在 DB 是 `integer`(RPC 自己也有這道閘,
  //    `20260910090000:724` 逐字 `IF v_total > 2147483647 … RAISE`)。
  //    ⚠️ 超過這個數之後 JS 的除法會開始掉精度而**加總檢查照樣成立** ⇒ 紙上會多一元而沒有東西會叫
  //    (codex 2026-09-13 nit 1 實算:`total = 9007199254740795` ⇒ 稅多一元)。
  //    ⇒ 現行資料走不到, 而這道閘讓「走到的那天」是紅的而不是錯的。
  if (input.total > MAX_ORDER_AMOUNT) return null;

  const total = input.total;

  // 🔴 `exclusive`:稅是建單時照拍板算好存進去的 ⇒ **直接讀, 不重算。**
  //    重算等於重跑一次演算法, 而且要重現「這張單當初走哪一條」⇒ 第二份實作、第二個真相。
  // 🔴 `inclusive`:系統只存含稅一個數(`tax_total` 恆 0)⇒ 殘差拆出來, 與貼板 121 同一支算式。
  //
  // 🛑🛑 **三態寫成顯式的兩個 `===`, 不寫成 `exclusive ? A : B`**(codex 2026-09-13 nit 2):
  //    後者會把**任何不是 `'exclusive'` 的值**(執行期的 `undefined` / 日後多出來的第三個 CHECK 值)
  //    靜默丟進含稅那條路 ⇒ 一張未稅單被除以 1.05。型別擋不住執行期的髒值。
  let tax: number;
  if (input.priceTaxMode === 'exclusive') {
    tax = input.taxTotal;
  } else if (input.priceTaxMode === 'inclusive') {
    // 🔴🔴 **`inclusive` 而 `tax_total` 不是 0 ⇒ 矛盾資料, 不印**(codex 2026-09-13 must-fix 1)。
    //    `inclusive` 的定義就是「稅沒有另計」⇒ 系統存的稅必然是 0。
    //    ⚠️ **而表級 CHECK 沒有強制這件事** ⇒ 這種列在 DB 裡是合法的。
    //    ⛔ 舊版直接忽略 `taxTotal` 去算殘差 ⇒ 反例 `total 1050 / taxTotal 49`
    //       印出 `1000 / 50 / 1050`, **把系統存的 49 丟掉而畫面完全正常**。
    //    ⇒ 📌 **兩個來源互相矛盾的時候, 挑一個來信就是替資料做決定** —— 那不是我的位置。
    if (input.taxTotal !== 0) return null;
    tax = total - Math.round(total / VAT_DIVISOR);
  } else {
    // `null`(讀不到)與任何非預期值 ⇒ 不印。
    // 🛑 **不可以挑一個預設值**:DB 端那一欄有 `DEFAULT 'inclusive'`, 而
    //    **「DB 的預設」與「我讀不到時該假設什麼」是兩件事**。
    //    猜錯的方向(把 `exclusive` 當 `inclusive`)正好是**印出比訂單少**的那個方向。
    return null;
  }

  if (!Number.isInteger(tax) || tax < 0 || tax > total) return null;

  // 🔴🔴 **未稅一律由總計反推, 兩種 mode 共用這一行** —— 見檔頭那段反例。
  //    這一行是「三個數加得起來」的**結構保證**, 不是一個算式選擇:
  //    `untaxed + tax === total` 在任何輸入下恆真, 不需要另外驗。
  return { untaxed: total - tax, tax, total };
}
