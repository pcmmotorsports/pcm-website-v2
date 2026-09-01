/**
 * `B4_ORDER_CREATED_STUCK_MINUTES` 的**單一裁決點**。
 *
 * 🔴 **它答的是**:一張已付款的單, `order_created` 那一列超過幾分鐘還沒被建出來, 才算「卡住」。
 *
 * 🔴🔴 **為什麼需要它**(板 `⟦b4-SIG4ERRORS⟧`):
 * enqueue 失敗那一桶(`enqueue-order-created-emails.ts:120` 的 `catch { result.errors += 1 }`,
 * 註解逐字「下一輪會再撈到這一筆」)**會自己好** ⇒ 一輪 `>0` 不是異常。
 * 而「**每一輪都失敗**」才是 —— 而那需要記住上一輪。
 * ⇒ ✅ **解法不是新的狀態表**:持久訊號在【缺口本身的年齡】(`now() - orders.paid_at`)。
 *   · 持續失敗 ⇒ 那一筆一直留在缺口集合裡 ⇒ **年齡單調成長**
 *   · 正常單   ⇒ scanner 下一輪就把它排進去 ⇒ **離開集合**
 *
 * 🛑🛑 **而這一片真正要防的東西, 比「當下不會叫」嚴重一級**:
 * 那個 `errors` 數**只落在 cron 的回應 body, 沒有進任何表**
 * ⇒ **一個沒有進表的計數, 它的歷史等於不存在 —— 事後也查不到。**
 * ⇒ 📌 **前者只是沒被發現, 後者連補救的路都沒有。**
 *
 * 🔵 **門檻是 env 不是常數, 而那是刻意的**:
 * Sean 2026-09-01 13:0x 答「**甲 1 小時**」⇒ 那顆 env 要填 **60**。
 * ⚠️ **而那個 60【不寫死在這裡】** —— 他答的是「那顆 env 要填什麼」, 不是「碼裡的預設值」。
 * ⇒ ⇒ 📌 **碼裡仍然是 `unset` = 不上膛** ⇒ 他改主意時改一顆 env, 不是改一支 migration。
 *
 * 🔵 **60 分鐘 = 大約 12 次失敗**(而我量過才這樣說):
 * `pcm-email-sweep` 每 5 分鐘一輪, 而 enqueue 那條路**沒有次數上限、也沒有退避**
 * (`enqueue-order-created-emails.ts:120` 的 catch 只 `errors += 1`, 下一輪照撈)
 * ⇒ 所以 60 分鐘不是「重試一小時」而是「**連續失敗約 12 次**」。
 * 🛑 **而它與死信是【兩件事】**:死信是「列建出來了而寄不出去」(`attempts >= max_attempts`),
 *   本片是「**那一列根本沒被建出來**」⇒ 兩者的分母不重疊, 不要合併看。
 *
 * ⚠️ **參數化, 不自己讀 `process.env`** —— 照 `deploy-cutoff.ts` 的成例:
 * 那道 `no-restricted-syntax` 的存在理由(動態 env 不進 client bundle)只在 route 那一層說得清楚。
 */

export type StuckMinutesRead =
  | { kind: 'unset' }
  | { kind: 'invalid' }
  | { kind: 'ok'; minutes: number };

/**
 * 🔴 三態, 而三態各自有它非存在不可的理由:
 * · `unset`   = 那條線**還沒上膛** ⇒ 呼叫端不查、行為與加這一片之前【逐字相同】
 * · `invalid` = 設了而值不合法 ⇒ **出聲**, 不要靜靜當成沒設
 * · `ok`      = 才開始叫
 *
 * 🔴 **`raw === undefined` 才是「沒設」** —— 照 `readDeployCutoff` 那一格 codex 換來的教訓:
 *   原本寫 `!raw` ⇒ **env 設了而值是空字串**會被判成「沒設」
 *   ⇒ 有人貼成空值而**整件事安靜地沒發生**, 正是本片一直在防的那種壞法。
 *   空字串在下面落 `invalid` ⇒ 吵得出來。
 */
export function readOrderCreatedStuckMinutes(raw: string | undefined): StuckMinutesRead {
  if (raw === undefined) return { kind: 'unset' };
  // 🔴 只認【純十進位整數】—— 不接受 `60.0` / `6e1` / `+60` / 前後空白。
  //    理由:那些值 `Number()` 都吃得下, 而它們代表「填的人心裡想的不是這一格」
  //    ⇒ 與其猜他的意思, 不如吵出來讓他重填。
  if (!/^\d+$/.test(raw)) return { kind: 'invalid' };
  const minutes = Number(raw);
  // 🛑 `0` 與負數在 DB 那側會 RAISE(那支函式自己擋), 而這裡先擋一次 ——
  //    ⇒ 兩道不是重複:這一道讓它落 `invalid` 印一行, 而不是變成一次 DB 例外。
  //    📌 一個「設定填錯」不該長得像「資料庫壞了」。
  if (minutes <= 0) return { kind: 'invalid' };
  // 🔴 上界:DB 那支吃 `integer`, 而超過 2147483647 會在 PostgREST 那裡炸。
  //    而**這裡擋掉的不是溢位, 是【一個沒有意義的門檻】** —— 一年 = 525,600 分鐘,
  //    比它大的值代表「這條線實際上是關的」, 而那應該用 unset 表達, 不是用一個大數。
  if (minutes > 525_600) return { kind: 'invalid' };
  return { kind: 'ok', minutes };
}
