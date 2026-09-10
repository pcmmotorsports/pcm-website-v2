// recipient.ts — 建箱時的收件資料判定(`#503` 甲的單一真相源)。
//
// 🔴🔴 **病**:建箱彈窗原本在送出那一行做 `recipient.name ?? ''` ——
//    那不是漏擋,是**主動把「我沒有收件資料」寫成「客人沒有名字」**。
//    而寫入鏈五層沒有一層擋空字串:
//      RPC   `20260807170000:143-150` 只驗「恰好三鍵的 object」
//      CHECK `20260805170000:120-126` 走 `m3_jsonb_values_all_string`,而那支
//            (`20260604120000:73-87`)**只看型別、不看長度** ⇒ `''` 是合法 string ⇒ 過關
//    ⇒ 一張**沒有收件人的出貨單**會被印出來,而員工會真的拿去寄。
//
// 🔴 **為什麼只擋 `name`,不擋 `line` / `phone`** —— 這一段是本檔存在的理由,不要「順手補齊」:
//    🔵 **[2026-09-04 訂正指標, 線 `-front`]這條政策被推翻了【一半】, 而本檔行為不變**:
//       Sean 2026-09-04 拍甲「**顧客站收件地址的電話改必填**」⇒ `packages/schemas` 的
//       `AddressInput.phone` 現在是 `z.string().trim().min(1)`(不再 `default('')`)。
//       ⇒ 📌 **【新】從顧客站存進來的地址一定有電話, 而【舊列】與 OAuth 首登會員仍然可能空。**
//       🛑 **所以本檔【仍然不擋】** —— 擋了會退掉那些既有的單。這一行只是不讓下一個人
//       讀到一句已經過期一半的政策(而下面那句在【它的射程內】仍然為真)。
//    · `phone` 空是**業務允許**的值:`create_order` RPC(`20260604130000:98`)逐字
//      「coalesce '' 收乾淨(**空電話業務允許**、欄 DEFAULT '')」;`customer_addresses` 也是
//      `phone text DEFAULT ''`。⚠️ backlog `#503` 原文寫「三鍵皆非空白」——**照它做會退掉沒有電話的客人。**
//    · `line`(地址)空 ⇒ **只警告不擋**。畫面上「客人自取」現在是 `carrierNote` 的**自由文字**
//      (`shipment-dialog.tsx` 的 placeholder「例:客人自取 / 站到站」)、**沒有結構化的自取模式**
//      ⇒ 我分不出「自取所以不需要地址」與「地址真的漏了」。
//      🔴 關卡2 codex 抓到的正是這一格:硬擋會讓**既有的無地址自取單從可建箱變成完全無出口**,
//        而「從自由文字猜自取」是另一個沒有證據的宣稱。⇒ **沒有證據就不擋,只警告。**
//    · `name` 空 ⇒ **擋**。一張連收件人姓名都沒有的出貨單,在**任何**寄送模式下都不能用。
//
// ⚠️ **本檔只做判定,不做修改**:`trim()` 只用來**判斷空白**,回傳的仍是原值 ——
//    出貨單要對得起訂單上的地址,不是對得起我整理過的版本。

/** 建箱要送進 RPC 的收件快照(形狀恰好是 `admin_create_shipment` 要的三欄)。 */
export type RecipientSnapshot = { name: string; phone: string; line: string };

/** 呼叫端拿到的收件資料(來自訂單的 `shippingAddress`,每一欄都可能是 `null`)。 */
export type RecipientInput = { name: string | null; phone: string | null; line: string | null };

/**
 * 這一格是不是「沒有」。**本檔判空的唯一寫法,而畫面也用它。**
 *
 * 🔴 **[2026-09-10] 從 `const blank` 改成匯出的,理由不是整潔**:
 *    建箱彈窗要決定「這一格印值還是印『無電話』」,而**那個判斷必須與這裡的警告同一把尺** ——
 *    ⇒ 📌 兩把尺不一致的下場是:**畫面印了值而警告說沒有,或反過來**,
 *      而那種不一致沒有任何東西會紅。
 *    🎯 而這條線今天修的病,本身就是「兩層對同一個欄位各寫一套判準」。
 */
export const blankish = (v: string | null | undefined): boolean => (v ?? '').trim() === '';

const blank = (v: string | null): boolean => blankish(v);

/**
 * 缺姓名 ⇒ `null`(**不得建箱**);其餘一律回快照(原值,不 trim)。
 *
 * 🔴 回 `null` 的意思是「**這批貨沒有收件人**」,不是「資料不完美」——
 *    呼叫端要把它當**拒絕**處理,不要 `?? ''` 兜一個空字串出來(那正是本檔在修的病)。
 */
export function toRecipientSnapshot(recipient: RecipientInput): RecipientSnapshot | null {
  if (blank(recipient.name)) return null;
  return { name: recipient.name ?? '', phone: recipient.phone ?? '', line: recipient.line ?? '' };
}

/**
 * 不擋、但要讓員工在按下去之前看見的事(**兩種**:沒有地址、沒有電話)。
 *
 * ⚠️ 回 `null` = 沒話要說。**不要把它接到 disabled 上** —— 它的整個用途就是「不擋」。
 *
 * 🔴🔴 **[2026-09-10]「沒有電話」那一句是補的,而它補的是一條【完全靜音】的路**:
 *    在此之前,`phone` 空 ⇒ 建箱層放行、**而且一句話都不說**;
 *    而那條路的另一端(出貨明細單)當時是**阻印**的
 *    ⇒ 🎯 **箱建得起來,而它的紙永遠印不出來 —— 中間沒有任何一個字提醒過他。**
 *    ✅ 列印那一端 2026-09-10 已改成「印出來並標注」(Sean 拍甲);這裡補的是**前端那一半**。
 *
 * 🛑 **而「空電話放行」這個決定【不推翻】** —— `create_order` RPC(`20260604130000:98`)
 *    逐字「空電話業務允許」;`customer_addresses.phone DEFAULT ''`。
 *    ⇒ 📌 **補的是【他知不知道】,不是【能不能建】。**
 *
 * 🔵 **措辭與那張紙對得起來** —— 紙上印「無電話」⇒ 這裡不發明第三種講法。
 * 🛑 **而不要寫成「出貨單會印不出來」** —— 那句話今天已經不真了(2026-09-10 那一片修掉了)。
 *
 * 🔴🔴 **而這一句【刻意不告訴他去哪裡補】**(2026-09-10 codex 唯讀審 nit,採信):
 *    ⛔ ~~第一版寫「要補的話請先到客人資料填電話」~~
 *    🔴 **那會叫他去做一件沒有用的事** —— 建箱讀的是**這張訂單的收件快照**
 *      (`shipment-candidates.ts:479` 逐字 `recipient: details[0]!.shippingAddress`
 *       ⇒ `orders.shipping_address_snapshot`),**不是 `customers.phone`**。
 *      ⇒ 📌 他去改客人資料,回來這張單還是「無電話」。
 *    ⚠️ **而「有沒有別的路可以補這張單的收件資料」我沒查到,那是【查無】不是【沒有】**
 *      ⇒ 所以這一句只說**後果**,不指路。指錯路比不指路貴。
 *
 * 🔴 **兩種同時缺 ⇒ 兩句都要說。** 舊寫法是「第一個命中就 return」,
 *    ⇒ 📌 兩格都空時**電話那句會被地址那句吃掉** ⇒ 他**可能漏補另一欄**。
 *    ⚠️ 「他會不會漏補」不是碼或測試量得到的事 —— 量得到的只有「那一句在不在」。
 */
export function recipientWarning(recipient: RecipientInput): string | null {
  const notes: string[] = [];
  if (blank(recipient.line)) {
    notes.push('這張單沒有收件地址。自取或站到站可以照建;要寄送的話請先補地址,否則出貨單上不會有地址。');
  }
  if (blank(recipient.phone)) {
    notes.push(
      '這位客人沒有留電話(出貨單上會印「無電話」)。貨運可能聯絡不到收件人。',
    );
  }
  return notes.length === 0 ? null : notes.join(' ');
}

/** 給 server 端用的拒絕訊息(單一字面,client 與 server 不各寫一份)。 */
export const RECIPIENT_NAME_REQUIRED =
  '這張單沒有收件人姓名,不能建箱(建出來的出貨單會沒有收件人)。請先到客人資料補齊再回來。';
