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

const blank = (v: string | null): boolean => (v ?? '').trim() === '';

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
 * 不擋、但要讓員工在按下去之前看見的事(目前只有一種:沒有地址)。
 *
 * ⚠️ 回 `null` = 沒話要說。**不要把它接到 disabled 上** —— 它的整個用途就是「不擋」。
 */
export function recipientWarning(recipient: RecipientInput): string | null {
  if (blank(recipient.line)) {
    return '這張單沒有收件地址。自取或站到站可以照建;要寄送的話請先補地址,否則出貨單上不會有地址。';
  }
  return null;
}

/** 給 server 端用的拒絕訊息(單一字面,client 與 server 不各寫一份)。 */
export const RECIPIENT_NAME_REQUIRED =
  '這張單沒有收件人姓名,不能建箱(建出來的出貨單會沒有收件人)。請先到客人資料補齊再回來。';
