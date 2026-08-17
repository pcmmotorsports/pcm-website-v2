// #10 片3:出貨單表頭那三個新欄位裡,**兩個需要判斷**的推導(貨運商標籤在 `carrier-label.ts`)。
//
// 🔴🔴 **2026-08-17 更正,而上面那句話現在只對一半**:`Q-C5`=丙 之後,
//    紙上只剩**貨運商**與**日期**兩欄,**追蹤碼那一欄不存在了** ⇒ 本檔兩支的處境不同:
//      `shippedDateText`  ⇒ 仍然印在紙上(「日期」那格)。
//      `trackingDisplay`  ⇒ **零消費端**,保留給 `Q-C9`(客人訂單頁 / 出貨通知信)。詳其 docstring。
//    ⚠️ 下面那句「**印在客人手上那張紙的字**」對 `trackingDisplay` 已不成立 ——
//    它現在是「**呈現給客人時要說的字**」,而載體換成了簡訊／Email。
//    📎 **原文零刪除**:那句話是這兩支被抽出來的**理由**,理由沒有錯,只是其中一支換了出海口。
//
// 🔴 **為什麼不留在 `shipping-doc.tsx` 裡** —— 與 `shipping-doc-quantities.ts` 同一個理由:
//    這是**印在客人手上那張紙的字**,它該有**不需要 render 就跑得動**的測試。
//    留在元件裡的話,「出貨日算對了沒」要先渲染一整頁才問得到,
//    而**出貨日那格必須在 `TZ=UTC` 下跑**(見下方 `shippedDateText`)—— 那在 jsdom 頁測裡很難乾淨地做。
//
// 🔴 本檔**純顯示推導**:不查 DB、不寫入、不碰金額。

import { carrierLabelOf } from './carrier-label';

/**
 * 🔴🔴 **2026-08-17 起【零消費端】,而它是刻意留著的,不是漏刪。**
 *
 * `Q-C5`=丙(Sean 逐字 `q3: 丙`):**出貨明細單不印追蹤碼,追蹤碼只走簡訊／Email 給客人。**
 * ⇒ 唯一的呼叫端(`components/print/shipping-doc.tsx` 貨運資訊區)已經拿掉那一列。
 *
 * **為什麼不順手刪**:下面那三種 `null` 的分法是**一份已經被想清楚的知識** ——
 * 「還沒出貨」/「該有卻沒有」/「這家本來就不給碼」在資料上長得一模一樣,而**客人信裡也要分**。
 * `Q-C9`(客人訂單頁 + 出貨通知信顯示追蹤碼)**很可能需要同一組判斷**;刪了要重想一次。
 * ⇒ 處置紀律照 `docs/specs/2026-08-17-qc5-tracking-off-paper-decommission-list.md` §2:
 *   **標明、不刪**;真要刪,等 `Q-C9` 落地後再數一次消費端。
 * ⚠️ 它的測試(`shipping-doc-dispatch.test.ts`)**一格斷言都沒改** —— 那些測的是判斷本身,不是紙。
 *   (該檔本輪確實有 `+7` 行**檔頭語境註解**;**「沒改」指的是斷言與測試名,不是檔案零 diff**。)
 * ⚠️ 以下原文裡的「紙上」「印」是**丙之前的語境**,原文保留、現在讀成「**呈現給客人時**」。
 *
 * ---
 *
 * 追蹤碼那一格要印什麼。**`null` 有三種意思,而紙上不可以長成同一個樣子**
 * (plan `2026-08-16-shipping-doc-carrier-tracking-plan.md` §3.1)。
 *
 * `shipments.tracking_number` 的 COLUMN COMMENT 逐字
 * (`20260805170000_m4b_e10_b2_s1a1_shipments.sql`,錨點 `已出貨的列`):
 * > **已出貨的列**之中,`tracking_number IS NULL` 只可能發生在 `other`(自取/自送,carrier_note 有說明)。
 *
 * 而 `mark_shipped`(同族 migration,錨點 `pcm_b2_is_blank(tracking_number)`)擋:
 * **非 `other` 且追蹤碼空白 ⇒ 拒絕標記出貨。**
 *
 * ```
 * ① 箱還沒標出貨            ⇒ 還沒有追蹤碼（正常）  → pending
 * ② 已出貨 + other（自取）  ⇒ 本來就沒有（正常）    → selfService
 * ③ 已出貨 + 非 other 沒有  ⇒ 🔴 DB 說這不可能發生  → missing（fail-loud）
 * ```
 * 🔴🔴 **③ 為什麼不留白**:那代表寫入鏈有洞,而**這張紙已經要跟著貨出門了**。
 *    留白 ⇒ 員工不會發現,客人拿到一張**查不到貨的紙**,而且他不知道該不該打電話來。
 *    印「請回報」⇒ 有人會來問。**與 `carrierLabelOf` 的回退是同一條原則。**
 *
 * ⚠️ **`other` 也可能有追蹤碼**(DB 只對「非 other」強制非空,沒禁止 other 填)⇒
 *    有值就照印,不因為代碼是 `other` 就把手上的資料藏起來。
 */
export type TrackingDisplay =
  /** 有追蹤碼。`label` 一定帶貨運商名 —— 見 plan §4:紙上三個號碼並排,客人不知道拿哪個去查。 */
  | { kind: 'number'; label: string; value: string }
  /**
   * 🔴 **刻意【沒有】`text`**(R2 F5):`Q-C9b`=乙 之後這一支就是「整列不印」,
   *    給它一個永遠是空字串的 `text` = 一個讀不到的死欄位,而**它會誘導畫面端寫 fallback** ——
   *    真有人拿掉 `shipping-doc.tsx` 那行 `if (kind === 'pending') return null`,
   *    fallback 就會印出「追蹤碼:」加空白,**正好是註解說「看起來壞掉的欄位」那個東西**。
   *    ⇒ 讓型別自己擋住:沒有 `text` 可讀,fallback 寫不出來。
   */
  | { kind: 'pending' }
  | { kind: 'selfService'; text: string }
  | { kind: 'missing'; text: string };

export function trackingDisplay(args: {
  carrierCode: string;
  trackingNumber: string | null;
  shippedAt: string | null;
}): TrackingDisplay {
  const { carrierCode, trackingNumber, shippedAt } = args;
  // 🔴 空字串當成沒有 —— DB 用 `pcm_b2_is_blank` 判空,顯示端跟著用 trim,
  //    否則「一格空白字元」會被印成一個看不見的追蹤碼。
  const tracking = trackingNumber === null ? '' : trackingNumber.trim();

  if (tracking !== '') {
    return { kind: 'number', label: `${carrierLabelOf(carrierCode)}追蹤碼`, value: tracking };
  }
  // 情形①:順序在 other 之前 —— 還沒出貨的 `other` 箱走這一支,不是「自取自送」那一支。
  //
  // 🔴🔴 **`Q-C9b` = 乙(Sean 2026-08-16 逐字「什麼都不寫 ,空格」)⇒ 這一支【整列不印】。**
  //    原本印「尚未出貨,出貨後補」,而 `Q-C5`=乙 之後**那個「補」的管道不存在**
  //    (通知信暫緩、沒有會員訂單頁、storefront 零 `trackingNumber`)⇒ 那句話是對客的假承諾。
  //    ⚠️ **空格就是空格** —— 不要填一個「看起來比較完整」的字。
  //
  // 🔴🔴 **與情形③(`missing`)長得一模一樣,而它們【必須】是兩條分支:**
  //    ```
  //    情形①  還沒出貨、沒有追蹤碼  ⇒ 正常   ⇒ 紙上【空白】
  //    情形③  已出貨、非 other、沒有 ⇒ DB 說不可能 ⇒ 紙上【fail-loud 印請回報】
  //    ```
  //    ⚠️ 兩者在資料上都是「沒有追蹤碼」,**差別只在 `shippedAt`**。
  //    **合併成「都留空」會把一個資料鏈的洞變成看不見的** —— 那正是情形③ 存在的理由。
  //    ⇒ 兩條各有一格守門(`shipping-doc-dispatch.test.ts` 與紙面的 `page.test.tsx`)。
  if (shippedAt === null) {
    return { kind: 'pending' };
  }
  // 情形②
  // 🔴 **`carrierNote` 刻意【不】在這裡重印一次**(R1 must-fix 4):它已經印在「貨運商」那格
  //    (`shipping-doc.tsx`,錨點 `貨運商:`)。同一句話在同一張紙出現兩次,讀的人會以為是兩件事。
  // ⚠️ plan §6 驗收 ③ 逐字寫「**不印追蹤碼欄**」,而本實作**照樣印一句「無追蹤碼」** ——
  //    這是刻意偏離,理由:整欄消失 = 留白,而留白正是本檔其他三條分支拚命在避免的東西。
  //    ⇒ 偏離已寫進 plan §6 的更正框與 commit body,不是漏做。
  // 🔴 **2026-08-17 更新(`Q-C5`=丙)**:上面兩句的「印」**在紙這一面已經不成立** ——
  //    紙上沒有這一格了(見本檔頂端的零消費端說明)。**但這支的回傳值本身沒變**,
  //    它現在的意義是「**呈現給客人時**要說的那句話」,`Q-C9` 的信會用到。
  //    ⚠️ 而「不要用留白表達『沒有』」這條原則到了信裡照樣適用,所以文字不動。
  if (carrierCode === 'other') {
    return { kind: 'selfService', text: '無追蹤碼(自取 / 自送)' };
  }
  // 情形③
  // 🔴 **文案兩度更正,兩次都是 R2 抓的,記著原因**:
  //    ① 原本渲染成「追蹤碼:追蹤碼缺漏,請回報」——「追蹤碼」四個字重複。
  //    ② 曾在畫面端接一句「(【請勿出貨前先確認】)」,**兩個病**:
  //       中文最自然的斷句是「請勿(出貨前先確認)」= 叫人**不要**確認;
  //       而且 `missing` 只在 `shippedAt !== null` 才成立 ⇒ 系統已記成出貨了,講「出貨前」是錯的狀態。
  //    ⇒ 現在這句**自帶主詞、自帶狀態、不靠畫面端補字**(畫面端也不再加前綴)。
  return { kind: 'missing', text: '追蹤碼缺漏 —— 系統已記為已出貨,請立即回報' };
}

const TAIPEI_YMD_OPTIONS: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Taipei' };

/**
 * 出貨日。**未出貨時印【列印當天】**——Sean 拍甲,設計需求書
 * `2026-08-16-print-docs-design-brief.md`(錨點 `未出貨時印`)逐字標明
 * **「明知偶爾會與系統差一天」** ⇒ **不加任何但書**(他明講設計端不要加「以系統為準」之類的字)。
 *
 * 🔴🔴 **`timeZone: 'Asia/Taipei'` 不是可有可無的**:
 *    這支在 server component 裡跑,而**伺服器在 UTC** ⇒ 台北時間 00:00–08:00 之間
 *    不指定時區會印成**昨天**。紙上的日期差一天,而紙已經寄出去了。
 *
 * 🔴🔴 **而這個 bug 在本專案的測試裡【天生假綠】**:`vitest.config.ts`(錨點 `env: { TZ:`)
 *    把測試時區釘死成 `Asia/Taipei` ⇒ 指不指定時區產出**完全一樣**。
 *    ⚠️ 實測(2026-08-16,可重跑):在 `TZ=Asia/Taipei` 下掃 960 個整點,
 *       「不指定時區」與「指定 Asia/Taipei」**不同的時刻 = 0** ——
 *       **換測資救不了這格,只能換環境。** `shipping-doc-dispatch.test.ts` 因此在執行期切 `TZ=UTC`。
 *
 * 🔴 `now` 可注入:綁死真時鐘的話,這格會在半夜自己變色(house 慣例同 `formatOrderListDate`)。
 * 🔴 非法 iso **不 throw**、原樣回傳:本支在 server component 內呼叫,
 *    throw 會把「一格顯示怪字」升級成「整張出貨單 500」(同 `formatOrderListDate` 的理由)。
 */
export function shippedDateText(shippedAt: string | null, now: Date = new Date()): string {
  if (shippedAt === null) return now.toLocaleDateString('en-CA', TAIPEI_YMD_OPTIONS);
  const parsed = new Date(shippedAt);
  if (Number.isNaN(parsed.getTime())) return shippedAt;
  return parsed.toLocaleDateString('en-CA', TAIPEI_YMD_OPTIONS);
}
