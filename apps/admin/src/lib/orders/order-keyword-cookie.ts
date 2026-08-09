import {
  MAX_ORDER_KEYWORD_LENGTH,
  normalizeOrderKeywordSearch,
} from '@pcm/domain';

// order-keyword-cookie.ts — #347-2b:關鍵字搜尋詞的**載體**(唯一落點)。
//
// 🔴🔴 **為什麼搜尋詞在 cookie 而不是 URL**(Q-a=B,2026-08-09 拍板):
//    搜尋詞是 PII —— 它會是客人姓名、電話、收件地址片段(RPC 是八維度子字串搜尋)。
//    「搜尋詞不進 URL」是 347-1(RPC 走 POST)與 A13b(URL 只帶結果碼)兩線立起來的**全站紅線**;
//    把它放回 query string = 親手推翻一小時前才上線的防護。
//
// 🔴 **但這樣就沒有東西帶著它翻頁了** —— `buildOrderListHref` 是把 filter 逐欄拼成 query string 的,
//    搜尋詞刻意不在裡面 ⇒ 員工搜完按「下一頁」搜尋詞就消失、**列表靜默變回全部訂單**
//    (正是 `order-list-view.ts` 那兩條 🔴 註警告過的 fail-open 形狀)。
//    ⇒ 載體改成 **server 端 session cookie**:分頁 `<Link>` 一個字都不用動,搜尋詞天然跟著走。
//
// ⚠️ **誠實界線(主視窗 2026-08-10 裁決條件②:認列、不修)**:cookie 是**跨分頁共用**的
//    ⇒ 同一個瀏覽器開兩個訂單列表分頁、各搜各的,會互相蓋掉。
//    要完全消除得讓每個分頁鈕都變成 POST 表單(B 案)—— 那會殺掉現有零-JS 的 `<Link>` 分頁
//    (中鍵開新分頁、鍵盤操作、右鍵複製網址全失),代價更大。
//    緩解 = 列表頁**常駐顯示**「目前搜尋:XXX ✕」,讓這個看不見的狀態變成看得見、關得掉。

/**
 * 搜尋詞 cookie 名稱。
 *
 * 🔴 與 `ADMIN_SESS_COOKIE`(`lib/session/session.ts`)、`WORKSPACE_PANEL_COOKIE`
 * (`lib/layout/workspace-panel.ts`)同命名族;改名要同時改 action 與 page 兩端,
 * 而漏改的症狀是「搜尋按了沒反應」且**完全沒有錯誤訊息**(cookie 寫了但沒人讀)。
 * ⇒ `order-keyword-search-wiring.test.tsx` 把兩端釘在本常數上。
 */
export const ORDER_KEYWORD_COOKIE = 'admin_order_keyword';

/**
 * 搜尋表單的兩個欄位名(#347-2b)。
 *
 * 🔴 **為什麼住在這裡而不是 action 檔**:`keyword-search-action.ts` 帶 `'use server'`,
 * 那種模組**只能 export async function** —— 多一個常數 export,`next build` 會直接紅
 * 「The module has no exports at all」(Next 看到非函式 export 就把整個模組的 export 清空)。
 * ⚠️ 這條 **typecheck / lint / 全套測試都抓不到**,只有 build 抓得到(2026-08-10 實測踩過)。
 */
export const ORDER_KEYWORD_FIELD = 'keyword';
export const ORDER_KEYWORD_RETURN_TO_FIELD = 'return_to';

/**
 * 寫進 cookie 的值。
 *
 * 🔴 **一定要 encode**:本軸的搜尋詞**合法含中文、空白、逗號、`%`、`(`**
 * (`packages/domain/src/order/keyword-search.ts` 檔頭整段在講為什麼本軸刻意沒有字元集守門)
 * ⇒ 原樣塞進 `Set-Cookie` 會弄壞標頭。
 */
export function encodeOrderKeywordCookie(keyword: string): string {
  return encodeURIComponent(keyword);
}

/**
 * 從 cookie 值還原搜尋詞;**任何異常一律回 `null` = 當作沒搜尋**(fail-closed)。
 *
 * 🔴 為什麼 fail-closed 而不是報錯(主視窗 2026-08-10 裁決條件③):
 * cookie 是**使用者可以自己竄改**的輸入。壞值讓「搜尋失效」是小事,
 * 讓**整個訂單列表打不開**是大事 —— 而後者正是「解碼擲錯往上冒」會造成的結果。
 *
 * 三道閘,每一道都有對應的負測(`order-keyword-search-wiring.test.tsx` 守門 1):
 *   ① `decodeURIComponent` 擲錯(例如單獨一個 `%`)⇒ null
 *   ② 超過 `MAX_ORDER_KEYWORD_LENGTH`(120)⇒ null(由 domain 正規化判定,不在這裡重寫長度規則)
 *   ③ 正規化結果不是 `ok`(空字串 / NUL / 落單代理)⇒ null
 */
export function readOrderKeywordCookie(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ① 壞的百分號編碼。不記 log —— 內容是 PII(migration `:50-74` 明令搜尋詞不得落 log)。
    return null;
  }

  // ②③ 長度與字元的判定**一律交給 domain**,不在本檔重寫一份 ——
  //     兩份規則遲早會分岔,而分岔的症狀是「UI 覺得可以、RPC 收到卻炸掉」。
  const parsed = normalizeOrderKeywordSearch(decoded);
  return parsed.kind === 'ok' ? parsed.value : null;
}

/** 給守門用:讓測試能對「長度上限」寫出**剛好越界**的負測,而不是自己猜一個數字。 */
export { MAX_ORDER_KEYWORD_LENGTH };
