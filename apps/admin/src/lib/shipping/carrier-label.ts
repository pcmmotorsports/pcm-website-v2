// #10:貨運商代碼 → 中文標籤。**三個消費端共用的唯一一份。**
//
// 🔴 **代碼的【集合】權威在 DB,不在本檔**:
//    `supabase/migrations/20260805170000_m4b_e10_b2_s1a1_shipments.sql` 的
//    `CONSTRAINT shipments_carrier_domain CHECK (carrier_code IN ('hct', 'sf', 'other'))`。
//    本檔是那個集合的**投影**(補上 DB 裡不存在的中文標籤),不是它的真相源。
//    ⇒ 想新增一家貨運商:**先改 migration,再改這裡**。反過來做的話 DB 會擋掉寫入。
//
// 🔴🔴 **抽之前這個值域在 TS 側有【五份】手抄,而它們用四種不同的形狀寫。**
//    數法(可重跑):`git grep -nE "'hct'|新竹物流" 82ee3102^ -- apps packages` ⇒ **15 行**,
//    ⚠️ **那 15 行要先分類再報數** —— 大部分是測試 fixture 裡的單一個值 `'hct'`,
//    **不是「這個值域有哪些成員」的宣告**。逐行分類後,宣告型的有 5 份:
//    ```
//    lib/shipping/shipment-repository.ts:39   type CarrierCode = 'hct'|'sf'|'other'  ← 🔴 寫入路徑
//    components/orders/shipment-section.tsx:21  Record<string,string>                （顯示）
//    components/orders/shipment-dialog.tsx:43   [{code,label}]                       （下拉）
//    components/orders/shipment-dialog.tsx:85   useState<'hct'|'sf'|'other'>         （state）
//    components/orders/shipment-dialog.tsx:353  as 'hct'|'sf'|'other'                （cast）
//    ```
//    🔴 **我自己也報錯過兩次**:先報 1 份(照 plan)、再報 2 份、commit body 寫 4 份,
//    **正確是 5** —— 第 5 份那個 `as` cast 是 R2 抓的。⇒ 這條的教訓不是「plan 沒數」,
//    是**每一次重數都又漏一種形狀**,而每次都覺得這次總該數完了。
//    ⚠️ **plan §2.1 逐字寫「目前【唯一】一份」—— 那句是錯的,而且它的數法也不夠寬**:
//       用 `CARRIER_LABEL` 這個識別字 grep 只撈得到一份;用中文標籤 grep 撈得到兩份;
//       **`CarrierCode` 與兩處 union 字面用那兩種數法都撈不到**(它們一個中文字都沒有)。
//    ⇒ **本檔把「標籤」統一,並用 `Record<CarrierCode, …>` 把它綁回【寫入路徑那份型別】** ——
//       之後 DB 加第四碼時,改 `CarrierCode` 會讓本檔 **typecheck 直接紅**,不必等測試。

import type { CarrierCode } from './shipment-repository';

/**
 * 代碼 → 中文標籤。**鍵的集合要與 DB 的 CHECK 完全一致**(守門在 `carrier-label.test.ts`)。
 *
 * 🔴 型別是 `Record<CarrierCode, string>` 不是 `Record<string, string>`:
 *    少一個鍵 ⇒ **typecheck 紅**(比測試早一步、而且不需要跑)。
 *    ⚠️ 但 `CarrierCode` 本身仍是**手抄**的 union ⇒ 測試那格(讀 migration)才是對 DB 的那一道。
 *    兩道各守一半:型別守「TS 內部一致」、測試守「TS 對得上 migration」。
 *
 * ⚠️ 順序有意義:`CARRIER_OPTIONS` 直接取本物件的鍵序當下拉選單順序
 * (JS 的字串鍵保插入序),與抽出前 `shipment-dialog.tsx` 那份 `CARRIERS` 的順序逐字相同。
 */
export const CARRIER_LABEL: Record<CarrierCode, string> = {
  hct: '新竹物流',
  sf: '順豐',
  other: '其他',
};

/**
 * 顯示用標籤。**查不到就回代碼本身,絕不回空字串。**
 *
 * 🔴🔴 **這一行的回退方向是本檔最重要的東西**(plan §2.2):
 *    完備性守門**看不到線上的 DB** —— 它讀的是 repo 裡的 migration 檔。
 *    真的有人繞過 migration 直接改線上 CHECK 時,這裡會拿到一個沒見過的代碼。
 *    ```
 *    回空白 ⇒ 紙上「貨運商:」後面什麼都沒有 ⇒ 客人以為沒有貨運商，沒有人會來問  🔴 少報
 *    回代碼 ⇒ 紙上「貨運商:xyz」          ⇒ 醜，但有人會打電話來問            ✅ 多報
 *    ```
 *    ⚠️ 與 `outstandingQuantity` 的「寧可讓人來問,不可讓人放心」是**同一條原則**。
 */
export function carrierLabelOf(code: string): string {
  // ⚠️ 參數刻意收 `string` 不收 `CarrierCode` —— **DB 讀回來的就是 `string`**
  //    (`ShipmentRow.carrierCode: string`,見 `shipment-repository.ts` 錨點 `carrierCode: string`)。
  //    收窄成 union 會把「未知代碼」這條路徑從**執行期事實**變成**型別上不存在**,
  //    而它是真的會發生的(有人繞過 migration 改線上 CHECK)⇒ 那才是本函式存在的理由。
  return (CARRIER_LABEL as Record<string, string | undefined>)[code] ?? code;
}

/**
 * 建箱彈窗的下拉選單。**從同一份表推出來,不再手抄一遍。**
 * 🔴 `code` 保持 `CarrierCode` 而不是 `string`:下拉送出去的值會進**寫入路徑**,
 *    型別放寬的話「表加了第四碼、而 state 的 union 沒加」會 typecheck 全綠(R1 nit 5)。
 */
export const CARRIER_OPTIONS: readonly { code: CarrierCode; label: string }[] = (
  Object.keys(CARRIER_LABEL) as CarrierCode[]
).map((code) => ({ code, label: CARRIER_LABEL[code] }));
