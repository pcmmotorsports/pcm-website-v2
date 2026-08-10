import 'server-only';
import { revalidatePath } from 'next/cache';
import { returnToPathname } from './order-return-to';

// order-revalidate.ts — #350d-3:契約 §5「`return_to` 指向哪條路由就 revalidate 哪條」的單一實作。
//
// 🔴 **為什麼不放進 `order-return-to.ts`**:那支被三個 client 元件直接 import
//    (`note-compose-form.tsx` / `item-procurement-form.tsx` / `cancel-order-forms.tsx` 要拿欄名常數)
//    ⇒ 把 `next/cache` 放進去等於把 server 專用模組拉進 client 圖(`cancel-action-state.ts:6-7`
//    自陳的那條鐵線)。本檔 `import 'server-only'` ⇒ 誰把它 import 進 client 元件,**建置期就炸**。
//
// 🔴 **為什麼要共用**:#350d-3 code-reviewer 實查指出這段迴圈當時被複製了**三份**
//    (cancel / note / procurement),而它實作的是**契約條款** —— 契約改一次要記得改三處,
//    第一個忘記的人不會有任何訊號。複製版之間也已經漂移(兩份掉了 `request_id`)。

/**
 * 重取這次動作牽涉到的**兩個視圖**:明細頁,加上 `return_to` 指的那條路由。
 *
 * 🔴 `revalidatePath` 吃的是**路徑**、不吃 query ⇒ 面板版的 `return_to`(帶 `?panel=…`)
 *    要先過 `returnToPathname`,否則那是一條**打不中的路徑,而且不會報錯**。
 * 🔴 **逐條各包各的 try**:共用一個 try 的話第一條拋錯會讓第二條整個被跳過,
 *    而第二條正是員工真正落地的那一頁(取消線 codex 關卡2 抓過)。
 * 🔴 **拋錯一律不外傳**:這是「讓畫面新一點」的動作,不是寫入成功與否的一部分。
 *    讓它炸出去 = 補償 log 與導頁全都不會發生,而前一次可能已經 commit
 *    ⇒ 員工重整換到新 token 重送 = 第二筆刪不掉的紀錄。
 */
export function revalidateOrderViews(args: {
  orderId: string;
  returnTo: string;
  /** 動作域,寫進 log 前綴(`cancel` / `note` / `procurement`)—— 少了它三支的輸出逐字相同、對不回來。 */
  scope: string;
  /** HTTP `x-request-id`:災難當天靠它把這行對回那一次請求。 */
  requestId: string;
}): void {
  for (const path of new Set([`/orders/${args.orderId}`, returnToPathname(args.returnTo)])) {
    try {
      revalidatePath(path);
    } catch (thrown) {
      console.error(`[admin/orders/${args.scope}] revalidate 失敗(不影響寫入結果)`, {
        request_id: args.requestId,
        order_id: args.orderId,
        path,
        message: String((thrown as { message?: unknown } | null)?.message ?? '').slice(0, 200),
      });
    }
  }
}
