import { MAX_ORDER_KEYWORD_LENGTH, normalizeOrderKeywordSearch } from '@pcm/domain';

// customer-keyword-cookie.ts — `#525`:客戶搜尋詞的**載體**(唯一落點)。
//
// 🔴🔴 **為什麼搜尋詞在 cookie 而不是 URL** —— 這條是**全站紅線,不是本片的選擇**
//    (`Q-a=B`,2026-08-09 拍板;訂單側同款檔 `lib/orders/order-keyword-cookie.ts:8-11` 逐字):
//    搜尋詞是 PII —— 它會是客人姓名、電話、Email。
//    「搜尋詞不進 URL」是 347-1(RPC 走 POST)與 A13b(URL 只帶結果碼)兩線立起來的紅線;
//    把它放回 query string = 親手推翻既有防護。
//
// 🔴 **但這樣就沒有東西帶著它翻頁了** —— `buildCustomerListHref` 是把 filter 逐欄拼成 query string 的,
//    搜尋詞刻意不在裡面 ⇒ 員工搜完按「下一頁」搜尋詞就消失、**列表靜默變回全部客戶**(fail-open)。
//    ⇒ 載體是 **server 端 session cookie**:分頁 `<Link>` 一個字都不用動,搜尋詞天然跟著走。
//
// ⚠️ **一併繼承訂單側已認列的缺陷(不是漏想)**:cookie **跨分頁共用**
//    ⇒ 同一個瀏覽器開兩個客戶列表分頁、各搜各的,會互相蓋掉。
//    要消除得讓每個分頁鈕都變成 POST 表單,那會殺掉零-JS 的 `<Link>` 分頁(中鍵開新分頁、
//    鍵盤操作、右鍵複製網址全失),代價更大。
//    **緩解 = 列表頁常駐顯示「目前搜尋:XXX ✕」** —— 讓這個看不見的狀態變成看得見、關得掉。
//    🔴 **那個常駐顯示是機制的一部分,不是可選的美化。**
//
// 🔴 **正規化直接共用 `normalizeOrderKeywordSearch`,不抄第二份。**
//    ⚠️ **它的名字綁著 `Order`,而本檔是客戶軸** —— 那是**刻意接受的命名債**,理由:
//    它做的事(長度 120 / NUL / 落單代理 / 修剪全形空白)**與軸無關**,而**兩份實作遲早分岔**,
//    分岔的症狀是「UI 覺得可以、RPC 收到卻炸掉」。
//    ⇒ **寧可名字不好看,不要兩份規則。** 日後若要改名,那是 domain 那側的重構、不是本檔的事。
//    📎 長度上限也因此兩軸一致(120),員工不用記兩套。

/**
 * 搜尋詞 cookie 名稱。
 *
 * 🔴 與 `ADMIN_SESS_COOKIE`、`WORKSPACE_PANEL_COOKIE`、`ORDER_KEYWORD_COOKIE` 同命名族;
 * 改名要同時改 action 與 page 兩端,而**漏改的症狀是「搜尋按了沒反應」且完全沒有錯誤訊息**
 * (cookie 寫了但沒人讀)⇒ 接線測試把兩端釘在本常數上。
 */
export const CUSTOMER_KEYWORD_COOKIE = 'admin_customer_keyword';

/**
 * 搜尋表單的兩個欄位名。
 *
 * 🔴 **為什麼住在這裡而不是 action 檔**:`'use server'` 模組**只能 export async function** ——
 * 多一個常數 export,`next build` 會直接紅「The module has no exports at all」。
 * ⚠️ 這條 **typecheck / lint / 全套測試都抓不到,只有 build 抓得到**(訂單側 2026-08-10 實測踩過)。
 */
export const CUSTOMER_KEYWORD_FIELD = 'keyword';
export const CUSTOMER_KEYWORD_RETURN_TO_FIELD = 'return_to';

/**
 * 寫進 cookie 的值。
 *
 * 🔴 **一定要 encode**:搜尋詞**合法含中文、空白、`%`、`_`、`(`**
 * (RPC 那側刻意沒有字元集守門 —— 因為它走 POST body;理由見 migration 檔頭)
 * ⇒ 原樣塞進 `Set-Cookie` 會弄壞標頭。
 */
export function encodeCustomerKeywordCookie(keyword: string): string {
  return encodeURIComponent(keyword);
}

/**
 * 從 cookie 值還原搜尋詞;**任何異常一律回 `null` = 當作沒搜尋**(fail-closed)。
 *
 * 🔴 為什麼 fail-closed 而不是報錯:cookie 是**使用者可以自己竄改**的輸入。
 * 壞值讓「搜尋失效」是小事,讓**整個客戶列表打不開**是大事。
 *
 * 三道閘(每道都有對應負測):
 *   ① `decodeURIComponent` 擲錯(例如單獨一個 `%`)⇒ null
 *   ② 超過 `MAX_ORDER_KEYWORD_LENGTH`(120)⇒ null(由 domain 判定,不在這裡重寫長度規則)
 *   ③ 正規化結果不是 `ok`(空字串 / NUL / 落單代理)⇒ null
 */
export function readCustomerKeywordCookie(raw: string | undefined): string | null {
  if (typeof raw !== 'string' || raw === '') return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // ① 壞的百分號編碼。**不記 log** —— 內容是 PII(migration 檔頭明令搜尋詞不得落 log)。
    return null;
  }

  // ②③ 長度與字元的判定**一律交給 domain**,不在本檔重寫一份 ——
  //     兩份規則遲早會分岔,而分岔的症狀是「UI 覺得可以、RPC 收到卻炸掉」。
  const parsed = normalizeOrderKeywordSearch(decoded);
  return parsed.kind === 'ok' ? parsed.value : null;
}

/** 給守門用:讓測試能對「長度上限」寫出**剛好越界**的負測,而不是自己猜一個數字。 */
export { MAX_ORDER_KEYWORD_LENGTH };
