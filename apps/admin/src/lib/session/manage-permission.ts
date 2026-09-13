// manage-permission.ts — 「這個人有沒有管理權」的三態 + 它的兩句話。
//
// 🔴🔴 **本檔零 IO、零 Next 依賴、零 `server-only`** —— 而那正是它存在的理由。
//    這三態原本住在 `components/settings/staff-edit-row.tsx`(它現在 re-export 本檔,
//    既有呼叫端一個字都不用改),而那支元件 import 了 `lib/staff-actions`
//    ⇒ 拉進 `lib/staff-repository` 的 `import 'server-only'`。
//    ⇒ 📌 於是**任何想從那支檔取【執行期的值】的 client 元件,都會被那條鏈炸掉**
//      (貼板 138 的備註時間軸就是這樣撞到的:它要的是 `permissionNotice` 那一句話)。
//    ⚠️ **收窄一句**(codex 2026-09-13 nit 1 證偽我第一版):**只 `import type` 不會炸** ——
//       型別 import 在編譯期整個被移除,不會建立執行期相依鏈。
//       ⇒ 會炸的是「同時要文案或 helper」那一種,不是型別本身。
//    ⇒ 搬出來之後,型別與文案跟「誰去查 DB」解耦。**沒有任何行為改變。**
//
// 🔴 **為什麼是三態,不是布林**(逐字搬自原處,因為這一段才是這個型別存在的理由):
//    唯一現成的查核 `lib/staff.ts` 的 `isActiveManager` 在 **DB 故障時回 `false`**
//    (刻意的 fail-closed,而它留了 log)。對【閘】來說那是對的;
//    **對【UI】直接沿用就錯了** —— DB 打嗝 ⇒ 回 false ⇒ 鈕灰掉 ⇒
//    **一個真的是管理者的人會以為自己被降權**,而畫面上沒有任何字告訴他
//    「這是查不到,不是你沒權限」。
//    📌 一個二態的東西被用來表達三種狀態,而第三種悄悄變成第二種。
//
// 🛑 **這三態不是安全邊界** —— 擋得住的一律是 server 那道 `authorizeManagerMutation()`。
//    本檔只決定畫面上看不看得到、以及看不到時要說什麼。

export type ManagePermission = 'yes' | 'no' | 'unknown';

export const NO_PERMISSION_TEXT = '你沒有權限修改員工資料。';

/** ⚠️ 暫定文案,未經 Sean 確認(2026-08-31)。 */
export const UNKNOWN_PERMISSION_TEXT =
  '暫時無法確認你的權限,請重新整理;若持續如此請回報。';

/**
 * 三態裡只有 `yes` 可以編輯。`no` 與 `unknown` 都整組停用,差別在上面那兩句話。
 *
 * 🔴 **2026-08-31 Sean 拍甲**:`unknown` **也停用** —— 而正確的解法不是讓他按,
 *    是**告訴他為什麼**:`no` ⇒「你沒有權限」/ `unknown` ⇒「暫時無法確認權限」。
 */
export function isEditable(canManage: ManagePermission): boolean {
  return canManage === 'yes';
}

/**
 * 停用時要顯示的那一句;`yes` 沒有訊息。
 *
 * 🔴 **這一句由【頁面】印一次, 不由元件各印一次**(codex R3 must-fix, 2026-08-31):
 *    第一版放進 `StaffProfileForm` ⇒ **N 位員工就出現 N 次**,
 *    而 `StaffTable` 桌機 + 手機雙渲染 ⇒ DOM 裡是 **2N+1 個 `role='status'`**。
 *    50 位員工 = 51 段紅字。而當時的測試只驗「至少存在一次」⇒ **完全抓不到。**
 */
export function permissionNotice(canManage: ManagePermission): string | null {
  if (canManage === 'no') return NO_PERMISSION_TEXT;
  if (canManage === 'unknown') return UNKNOWN_PERMISSION_TEXT;
  return null;
}
