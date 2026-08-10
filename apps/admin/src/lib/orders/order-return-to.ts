// order-return-to.ts — #350d:訂單域五支 server action 共用的「動作做完回哪裡」解析器。
//
// 🔴 契約權威 = `D-405-NOTE` v2(E 窗會簽、主視窗核)。本檔實作它的 §3。
//    C1:動作結束後回哪裡由表單的 `return_to` 決定,action 不再自己拼路徑
//    ⇒ 同一份明細在**面板**(`/orders?<列表狀態>&panel=<id>`)裡動作,結果回面板;
//      在**整頁**(`/orders/<id>`)裡動作,結果回整頁(= 今天的行為,零變更)。
//
// 🔴🔴 **契約字面更正(`D-420-NOTE` §1,實查推翻)**:契約 §4 表最後一列與 §6-2 寫
//    「`return_to` 的值 = `back.href`」—— **那句是錯的**。`back.href` 在面板版是
//    `buildPanelCloseHref()`(= **關閉**面板的連結,`ONE_SHOT_PARAMS` 含 `panel`)、
//    在整頁版是 `'/orders'`(= 回列表)⇒ 照字面接的話,動作做完面板會被關掉、
//    整頁版的人會被踢回列表(後者還是**回歸**)。⇒ 值改用「**當下視圖自己的 URL**」:
//    面板 = `buildPanelSelfHref(raw, id)`、整頁 = `/orders/{id}`。
//
// 🔴 為什麼 fail-closed 是「**退回 `/orders/{orderId}`** 而不是擲錯」(契約 §3 逐字):
//    走到這裡時錢 / 取消**可能已經做完了**,不能因為一個 URL 參數壞掉就讓員工看到錯誤頁
//    而不知道結果。方向是「少一個狀態」,不是「多一個失敗點」。

import { CANCEL_REQUEST_TOKEN_PARAM, CANCEL_RESULT_PARAM } from './cancel-action-state';

/**
 * 「只對剛剛那個動作有意義」的一次性參數 —— `return_to` **一律不得夾帶**它們。
 *
 * 🔴 為什麼要在**解析器**裡剝(而不是只靠產生端小心):`return_to` 是 client 送來的字串,
 *    五支 action 全部經過本檔 = 唯一的 choke point。夾帶 `rt` 的後果不是理論的:
 *    重組後會變成 `?rt=<舊>&rt=<新>` 重複鍵 ⇒ D3 的 classifier fail-closed 落 `unreadable`
 *    ⇒ 面板永遠只說「查不到取消紀錄(讀取失敗)」,而契約 §2 硬條件 1 正是為了防這個結局。
 *    夾帶 `r` 的後果同型:兩顆 `r` ⇒ `typeof searchParams.r === 'string'` 為假 ⇒ **零橫幅**。
 * ⚠️ **不含 `panel`** —— 面板的 `return_to` 就是要帶著它才回得去面板。
 *    「關閉面板時要丟掉 `panel`」是另一件事,在 `order-list-view.ts` 的 `ONE_SHOT_PARAMS`。
 */
export const RESULT_ONLY_PARAMS: readonly string[] = [
  CANCEL_RESULT_PARAM,
  CANCEL_REQUEST_TOKEN_PARAM,
  // ⚠️ `correct`(A10a-3 更正模式目標)全樹沒有常數,三處都是字面
  //    (`app/orders/[id]/page.tsx`、`app/@panel/orders/page.tsx`、這裡)。
  //    本片不順手抽常數(會擴散到兩個不相干的頁檔);寫在這裡讓下一個抽的人知道有三處。
  'correct',
];

/**
 * 右側面板要開哪一張單(#350c)。
 *
 * ⚠️ 定義住在本檔、由 `order-list-view.ts` re-export —— 那邊才是它的主場,但本檔要用它比對
 *    「`return_to` 指的是不是同一張單」(§6-1),而 `order-list-view` 反向 import 本檔會成環。
 */
export const ORDER_PANEL_PARAM = 'panel';

/** `return_to` 長度上限(契約 §3 ③)。 */
const MAX_RETURN_TO_LENGTH = 512;

/**
 * 控制字元(含 DEL)。**不是** open-redirect 面 —— 那條被 `/orders` 前綴白名單擋死了 ——
 * 而是**會讓 `redirect()` 自己爆掉**:Node 對 header 值裡的這些字元擲 `ERR_INVALID_CHAR`,
 * 結局正好是本檔開頭說要避免的「錢已經動了、員工卻看到錯誤頁」。
 * (形狀取自 `keyword-search-action.ts` 的 `safeListReturnTo`;那裡逐字記過同一個理由。)
 */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 非 latin-1 字元 —— 同上,header 層會擲 ERR_INVALID_CHAR。**只驗 raw**,理由見 `parseOrderReturnTo`。 */
function hasNonLatin1(value: string): boolean {
  for (const ch of value) {
    if ((ch.codePointAt(0) ?? 0) > 0xff) return true;
  }
  return false;
}

/**
 * 站內 `/orders` 路徑的**危險形狀**(契約 §3 ②;raw 與 decode 後**兩次**都要過)。
 *
 * - `..` —— 防站內 redirect gadget(`/orders/../../api/sso/start`;`workflow-form.ts` 原註 Fable nit-6)。
 * - `//` 開頭 / `://` —— open redirect(離站)。
 * - 空白與控制字元 —— 見 `hasControlChars`。
 *
 * ⚠️ **已知誤殺**(code-reviewer R1 nit-5,誠實記下不假裝沒有):`..` 這道看的是**整串**,
 *    所以某個篩選值裡出現 `..`(例如訂單編號 `AB..CD`)會讓整條 `return_to` 落 fallback
 *    ⇒ 動作做完靜默跳回整頁版、面板關掉。**沒有收窄成「只看 path 段」是刻意的**:
 *    收窄等於為了一個**尚未觀察到**的值放寬一條擋 gadget 的檢查。哪天真的有那種單號,
 *    修法是把 `..` 那道改成只驗 `?` 之前的部分,並補一格「query 裡的 `..` 放行」負測。
 */
function hasUnsafeShape(value: string): boolean {
  return (
    value.includes('..') ||
    value.startsWith('//') ||
    value.includes('://') ||
    /\s/.test(value) ||
    hasControlChars(value)
  );
}

/** 站內 `/orders` 前綴(`/ordersevil` 不算:下一個字元必須是 `/` 或 `?`)。 */
function isOrdersPath(value: string): boolean {
  return /^\/orders([/?].*)?$/.test(value);
}

/**
 * 剝掉一次性參數 + 檢查 `panel` 指的是不是同一張單;沒有 query 就原樣回。
 *
 * 🔴 **`panel` 不同單 ⇒ 整條退回 fallback**(契約 §6-1 逐字:「`return_to` **只決定用哪個視圖**,
 *    不決定**哪一張單**;兩者衝突時以 envelope 的 `orderId` 為準」)。
 *    不擋的話:對 A 單按儲存、`return_to` 指向 B 單的面板 ⇒ 畫面在 **B 單**上說「已儲存變更」。
 *    不是權限洞(兩張單本來就都看得到),但是**對著錯的單顯示動作結果** —— 而契約把這條
 *    列成邊界的理由是:E 的 D2a open-redirect 宣稱建立在「導頁目標由授權後的 envelope 決定」上,
 *    讓 `return_to` 決定單號會讓那條宣稱要重寫。
 * ⚠️ 重複鍵(`?panel=A&panel=A`)也退:`getAll` 長度 >1 一律不放行,不去猜哪一顆算數。
 */
function stripResultParams(value: string, orderId: string): string | null {
  const queryAt = value.indexOf('?');
  if (queryAt === -1) return value;
  const path = value.slice(0, queryAt);
  const params = new URLSearchParams(value.slice(queryAt + 1));
  for (const key of RESULT_ONLY_PARAMS) params.delete(key);
  const panels = params.getAll(ORDER_PANEL_PARAM);
  if (panels.length > 1) return null;
  if (panels.length === 1 && panels[0] !== orderId) return null;
  const query = params.toString();
  return query === '' ? path : `${path}?${query}`;
}

/**
 * 表單的 `return_to` → **可以安全 redirect 過去的站內路徑**(契約 §3)。
 *
 * 非法一律退回 `/orders/{orderId}`(不擲錯、不 500 —— 見檔頭)。
 *
 * ⚠️ **`orderId` 呼叫端要先過 uuid 閘**:本檔不驗它,只把它拼進 fallback。
 *    五支 action 的 parser 都在 `orderId` 形狀不合時就 `{ok:false}` 了,拿不到這裡來。
 * 🔴 **decode 後再驗一次**(契約 §3 ④):`%2e%2e` 這種編碼過的 `..` 逃得過 raw 那道。
 *    ⚠️ 但**字元集那道只驗 raw**:decode 後出現中文(某個帶 CJK 的搜尋參數值)是合法的 ——
 *    真正送進 header 的是**還沒 decode 的那個字串**,所以 latin-1 那條對 raw 成立就夠了。
 *    對 decoded 也套字元集會把合法網址誤殺成 fallback = 員工的篩選被靜默洗掉。
 */
export function parseOrderReturnTo(raw: unknown, orderId: string): string {
  const fallback = `/orders/${orderId}`;
  if (typeof raw !== 'string') return fallback;
  if (raw.length === 0 || raw.length > MAX_RETURN_TO_LENGTH) return fallback;
  if (hasNonLatin1(raw)) return fallback;
  if (!isOrdersPath(raw) || hasUnsafeShape(raw)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 壞的 percent-encoding(`%zz`)—— 證不了它 decode 後長什麼樣 ⇒ 不放行。
    return fallback;
  }
  if (!isOrdersPath(decoded) || hasUnsafeShape(decoded)) return fallback;

  // 🔴 **驗的是「真正要送出去的那個字串」**(code-reviewer R1 nit-3/4):上面兩道驗的是 `raw`,
  //    而 `URLSearchParams.toString()` 會**重新編碼**(`~` → `%7E` 之類)⇒ 吐出來的東西
  //    既可能比 `raw` 長(512 那道就白訂了)、原則上也可能長得不一樣。
  //    今天找不到能逃逸的構造(form-urlencoded 的安全字元集吐不出 `:` `/` 換行),
  //    但「靠兩道檢查碰巧覆蓋」不是守門 —— 把出口那道補上,判準就不依賴那個巧合。
  const cleaned = stripResultParams(raw, orderId);
  if (cleaned === null) return fallback;
  if (cleaned.length > MAX_RETURN_TO_LENGTH) return fallback;
  // ⚠️ **誠實界線**(R2 F3):上面那條長度檢查有殺得死它的負測(`~`×200 重編碼後爆表);
  //    下面這條**形狀**複驗**構造不出負測** —— `toString()` 把危險字元全編碼掉、path 段沒動過。
  //    ⇒ 它是縱深、不是有判別力的守門。留著的理由是「出口驗出口」這條原則本身,
  //    不是因為我證得出它今天擋到了什麼。誰要刪它,請先確認 `stripResultParams` 還是純重組。
  if (!isOrdersPath(cleaned) || hasUnsafeShape(cleaned)) return fallback;
  return cleaned;
}

/**
 * `return_to` + 結果 query → 完整導頁網址。
 *
 * ⚠️ 契約 §4 把這支叫 `redirectWithResult`(直接 `redirect()`)。這裡只做**字串組合**、
 *    不呼叫 `next/navigation` —— 純函式才單測得到,而且 `RedirectType`(取消線一律 `replace`)
 *    本來就該由呼叫端決定。呼叫端寫 `redirect(appendResultQuery(returnTo, query), type)`,
 *    行為與契約相同。
 */
export function appendResultQuery(returnTo: string, query: string): string {
  return `${returnTo}${returnTo.includes('?') ? '&' : '?'}${query}`;
}
