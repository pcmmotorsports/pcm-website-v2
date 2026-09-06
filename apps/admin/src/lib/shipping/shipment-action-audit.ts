// shipment-action-audit.ts — 出貨那族 server action 共用的兩樣東西(⟦ship-SHIPFILESSPLIT⟧ 2026-09-06)。
//
// 🔴🔴 **本檔【沒有】`'use server'`, 而那是它存在的全部理由。**
//    `'use server'` 的檔**只能 export async function** —— 而下面兩樣一個是 `const`、
//    一個是非 async 的 `function` ⇒ **它們從一個 server-action 檔裡匯不出去。**
//    ⇒ 📌 把 `submitShipmentToHctAction` 拆去自己的檔時, 這兩樣必須先落在一個
//      **不是** server-action 的模組裡, 否則兩支 `'use server'` 檔只能互相 re-export,
//      而那是環狀 import + 同樣撞到那條規矩。
//
// 🛑🛑 **本檔【不是】給別處共用的公開介面。**
//    目前呼叫端**只有兩支**:`shipment-actions.ts` 與 `shipment-submit-hct-action.ts`。
//    ⚠️ **為什麼要寫死這一句**:把 `auditLog` 從「一支檔的私有 helper」搬成「跨檔可 import」
//    **本身就是一次介面擴大** —— 而擴大的代價不會出現在 diff 上, 它出現在半年後
//    「原來這個到處都有人叫」的那一天。
//    ⇒ 🔴 **要在第三個地方叫它, 先來改這一句** —— 改不動這一句就不要 import 它。
//
// 🔵 下面兩段**逐位元照搬, 一個字都沒改**(條件①)—— 連 `export` 都沒有加在它們身上:
//    匯出走**檔尾那一行獨立的 `export { }`**, 就是為了讓那兩段的 md5 與搬前逐位元相同。
//    三段搬前/搬後的 md5 都寫在那顆 commit 的 body 裡。
// 🔵 **本檔零 import** —— `auditLog` 的 `auth` 參數是**行內型別** `{ sid; actorId }`,
//    而 `LOG_FIELDS` / `LogField` 也跟著那一段一起搬過來了。
//    ⚠️ 我第一版憑印象加了 `import type { AdminMutationAuth }` ⇒ **那個名字根本不存在**
//      (`session/authorize.ts` 只 export 兩個 async function)⇒ typecheck 當場紅。
//      📌 **搬檔時最容易多寫的就是一個「看起來一定有」的 import。**

/**
 * 出貨線的稽核用應用層 log(不是 `admin_audit_log`,DB 層那一列是 A2 的事)。
 *
 * 🔴 **一定要有 outcome 那一半**(codex 2026-08-16 must-fix):只記 attempt 的話,
 *    RPC 失敗或冪等重放時**分不出「誰做成了」與「誰試了沒成」** ——
 *    而稽核要回答的正是前者。attempt 單獨存在時,宣稱強於能力。
 *
 * 🔴 **欄位白名單在這裡,不在呼叫端。** 呼叫端只能送這幾個 key,
 *    收件人姓名/電話/地址、備註內容、追蹤碼一律不進來(PII;log 是一份不受 service_role
 *    邊界保護的副本)。要加欄位請先問「這一欄外洩了會怎樣」。
 */
const LOG_FIELDS = ['shipment_id', 'item_count', 'carrier_code', 'mark_shipped', 'has_tracking_number'] as const;
type LogField = (typeof LOG_FIELDS)[number];

function auditLog(
  event: string,
  auth: { sid: string; actorId: string },
  outcome: 'attempt' | 'ok' | 'fail',
  extra: Partial<Record<LogField, string | number | boolean | null>> = {},
): void {
  console.info(`[admin/shipping] ${event}.${outcome}`, { sid: auth.sid, actor: auth.actorId, ...extra });
}

/**
 * 沒有具名 actor 時給員工看的話。
 *
 * 🔴 **不寫「這個動作會記在稽核紀錄上」** —— 原版那樣寫,而**那是給使用者看的假字面**:
 *    本片(A1)只加閘,**一列 `admin_audit_log` 都沒有寫**;DB 層的稽核列是 A2 的事。
 *    ⇒ 承諾一個還不存在的東西,而員工沒有任何辦法發現它不存在。
 *
 * ⚠️ **也不寫「權限不足」** —— `authorizeAdminMutation` 三條路都回 `null`
 *    (`session/authorize.ts:30-33`:session 無效 / Origin 被拒 / 無 actor),
 *    而只有第三條是「選一下就好」。前兩條選了也沒用。
 *    ⇒ 訊息**同時給出兩條出路**,不要讓員工在唯一一條上鬼打牆。
 */
const NO_ACTOR_MESSAGE =
  '請先在右上角選擇操作人員,再送出一次。' +
  '(若已經選過還是看到這則訊息,請重新整理頁面或重新登入 —— 那表示這次的連線沒被認出來。)';

export { auditLog, NO_ACTOR_MESSAGE };
