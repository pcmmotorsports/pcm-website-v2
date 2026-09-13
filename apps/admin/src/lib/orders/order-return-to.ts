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
import { isUuid } from './note-action-state';

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
// ⛔ 2026-09-13 拆面板:`@panel/orders` 已刪。這顆常數留著只為兩件事 ——
//    ① `orders/page.tsx` 把舊書籤 `?panel=<uuid>` 導成 `?open=<uuid>`(不是 404);
//    ② `stripResultParams` 仍拒絕 `return_to` 指向別張單的 `panel=`(手打 / 偽造那條路)。
//    客人卡那顆 `customer` 參數連同 `CustomerPanel` 一起拿掉了(整頁 `/customers/<id>` 是唯一入口)。
/**
 * 🆕 **P-b(2026-09-13):列表就地展開的那張單。** `?open=<uuid>`。
 *
 * 🔴 **不沿用 `panel`** —— 那個名字綁著一個要退場的容器(右側面板)。
 *    規格 `規格-側欄與訂單明細容器-v1.md` §3-e 逐字「參數名 `?open=<訂單id>`,不沿用 `panel`」。
 * 🔴 **兩個參數並存是刻意的(停用不拆殼)**:列表**只寫 `open`、不再寫 `panel`** ⇒ 面板槽沒內容
 *    ⇒ `globals.css` 那條 `:has()` 自己把它收掉(真瀏覽器驗過,含負對照)。
 *    而 `@panel` 路由**仍然讀 `panel`** ⇒ 舊書籤 / 客人卡 / 手動建單那幾條路照舊開面板,
 *    **那是預期的,不是沒做完** —— 它們各自是 P-c。
 */
export const ORDER_OPEN_PARAM = 'open';
/**
 * 🆕 **P-e-1(2026-09-13,Sean 批 P-e 甲):「下一步」那顆鈕開的彈窗。** `?next=<uuid>&do=<動作>`。
 *
 * 🔴🔴 **它打開的是【表單】,不是動作**(plan `2026-09-13-next-step-button-write-plan.md` §0 逐字):
 *    貼一個網址**不會**寫進任何東西;寫入只發生在他按下「確認」那一刻。
 *    理由用 Sean 的話:**一條網址會被轉貼、被預覽、被瀏覽器預抓 —— 而「按網址就到貨了」是收不回來的。**
 * 🔴 與 `open` **同族、不是第二套機制**(規格 §3-f-4):都是「網址驅動、server 端渲染、零 client 判斷」。
 */
export const ORDER_NEXT_PARAM = 'next';
export const ORDER_NEXT_DO_PARAM = 'do';
/**
 * `do=` 的三個值 = 三個動作(**不沿用貨品軸的 `none` / `ordered` / `instock`** —— 那三個是「貨在哪」的名字,
 * 不是「要做什麼」;設計窗 2026-09-13 對檔定案)。對映在 `order-status-axes.ts` 的 `orderNextStep`。
 */
export const NEXT_STEP_DO_VALUES = ['order', 'receipt', 'ship'] as const;
/**
 * 🆕 **B9 批次列(2026-09-14,稿 v22 `#batch`)**:`next` 可以是**逗號分隔的多個 uuid**(多單版彈窗,一單一份表單),
 * `items=<uuid,…>` 只列勾到的那幾樣(沒帶 = 整張單,列上「下一步」那顆鈕的既有形狀)。
 * 🔴 同一族:網址驅動、只開表單不寫入。`ship` 只認**一張單**(稿:跨單不能一起裝箱)。
 * 🔴 上限 `NEXT_MULTI_MAX` 張:超過就整個當沒帶(不開一個幾十份表單的彈窗;10 × 37 字的 `next` 也要塞得進 512 字的 `return_to`)。
 */
export const ORDER_NEXT_ITEMS_PARAM = 'items';
export const NEXT_MULTI_MAX = 10;
/**
 * 🆕 A2-b(2026-09-14)老闆模式批次列「改成本(勾選的列)」:`?costs_items=<品項 uuid,…>` ⇒ 開「套用到勾選的 N 列」彈窗。
 * 同一族:網址驅動、只開表單不寫入(寫入仍是 `setOrderItemCostsAction` 一發)。上限 `COSTS_ITEMS_MAX` 樣。
 * 🔴 名字用 `costs_items` 不用 `cost_items`:經銷價外洩尺 `\bcost\b`(底線是 word char,其實兩個都不咬;保險起見照主視窗說的用 costs)。
 */
export const ORDER_COSTS_ITEMS_PARAM = 'costs_items';
export const COSTS_ITEMS_MAX = 200;
/**
 * 🆕 **收款欄可點(2026-09-13,Sean 答甲):`?pay=<uuid>` ⇒ 開「新增收款」彈窗。**
 * 與 `next` / `open` 同一族:網址驅動、server 端渲染、**只開表單不寫入**。
 * 🔴 **不進「下一步」欄**(規格刻意把收款排除在貨品軸外:「收款是訂單層的事,在『錢』那塊」)
 *    ⇒ 入口就在收款欄那格本身:點「還差 N」/「還沒收」才開;已收足 / 需確認 / 多收 **不可點**(沒有收款要做)。
 */
export const ORDER_PAY_PARAM = 'pay';
/**
 * 🆕 **v22 展開標題列的四顆鈕(2026-09-13,主視窗派工):`?cancel=<uuid>` ⇒ 「退款 / 取消」彈窗。**
 * 同 `pay` 那一族:網址驅動、server 端渲染、**只開表單不寫入** —— 內容是明細頁「收款 · 退款」分頁裡
 * 取消 / 退款那幾段【原封搬進殼裡】(`OrderDetailRoute({ section: 'money' })`), 寫入仍走它們各自既有的 action。
 * ⚠️ 名字是 `cancel`, 但它開的是**整組**(取消 + 退款帳本 + 退款入口):稿彈窗 2 的標題就叫「退款 / 取消」。
 */
export const ORDER_CANCEL_PARAM = 'cancel';
/** 🆕 v22 展開標題列 ②:`?note=<uuid>` ⇒ 「備註與客人聯繫」彈窗(`OrderDetailRoute({ section: 'notes' })`:時間軸 + 新備註表單 + 通知鈕)。 */
export const ORDER_NOTE_PARAM = 'note';
/** 🆕 v22 展開標題列 ③:`?edit=<uuid>` ⇒ 「編輯個資」彈窗(`OrderDetailRoute({ section: 'customer' })`:明細頁那張改單表單 + 發票小抄入口)。 */
export const ORDER_EDIT_PARAM = 'edit';
/** 🆕 v22 展開標題列 ④:`?more=<uuid>` ⇒ 「更多」彈窗(列印兩顆 · 改品項金額 · 通知信;`OrderDetailRoute({ section: 'more' })`)。 */
export const ORDER_MORE_PARAM = 'more';
export type NextStepDo = (typeof NEXT_STEP_DO_VALUES)[number];

/**
 * 🆕 **發票小抄彈窗(2026-09-13,Sean 拍甲「點 tag 就開,一步到位」)。** `?invoice=<uuid>`。
 *
 * 🔴 與 `next` / `open` **同族**:網址驅動、server 端渲染彈窗殼、**只開表單不寫入**。
 *    貼這條網址不會改任何東西 —— 寫入只發生在他按彈窗裡那顆「確認」。
 * 🔴 **一次性參數**:刻意不進 `buildOrderListHref` 的窮舉鍵表(同 `next` / `do` 的理由)——
 *    翻頁 / chip 不該帶著它走。關掉 = 同一頁不帶它。
 * 🔵 兩個入口共用這一顆:明細「客戶 · 發票」分頁裡的連結、列表上那顆發票 tag。
 */
export const ORDER_INVOICE_PARAM = 'invoice';

/** 把 `?invoice=<id>` 接到「這個視圖自己的網址」後面(列表帶篩選 / 整頁 `/orders/<id>` 都通)。 */
export function buildInvoiceHref(viewHref: string, orderId: string): string {
  const sep = viewHref.includes('?') ? '&' : '?';
  return `${viewHref}${sep}${ORDER_INVOICE_PARAM}=${orderId}`;
}

/**
 * `return_to` 的**表單欄名**(wire 契約)。
 *
 * 🔴 order 域五支表單共用同一顆 —— 改單線原本把它定義在 `workflow-form.ts`(現改為 re-export),
 *    取消 / 備註 / 採購 / 退款接線時**一律 import 這一顆**,不要各自打 `'return_to'` 字面:
 *    欄名打錯的症狀是「`formData.get()` 拿到 null ⇒ 靜默走 fallback ⇒ 面板被關掉」,
 *    typecheck 與現有測試都看不到(memory `feedback_api-silently-ignores-unknown-field-...` 同型)。
 */
export const ORDER_RETURN_TO_FIELD = 'return_to';

/** 訂單列表的路徑 —— `return_to` 合法的兩個視圖之一(另一個是這張單的明細頁)。 */
const ORDERS_PATH = '/orders';

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
 * - `#` —— **不是安全面,是功能面**(R1 nit-3,實測):片段一律排在 query 後面,
 *   而 `appendResultQuery` 是**字串接尾** ⇒ `/orders/<id>#x` 會接成 `/orders/<id>#x?r=…&rt=…`,
 *   瀏覽器把 `?r=…` 當成片段的一部分、**server 根本收不到 `r`/`rt`**
 *   ⇒ 契約 §2 硬條件 1 說的「面板永遠只會說查不到取消紀錄」換一個入口發生。
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
    value.includes('#') ||
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
  // 🔴🔴 **path 段也要指這張單**(R1 must-fix 1,實測擊破:`parseOrderReturnTo('/orders/<B>', A)`
  //    原本原樣放行 —— §6-1 當時只擋了 `?panel=`,path 形式整條漏掉)。
  //    對取消線這是**會多出一筆刪不掉的取消**的路:取消 A 成功後導去 **B 的明細頁**並帶著 `rt`
  //    ⇒ D5 在 B 的帳本查不到那顆 token ⇒ 落 `miss_complete`(全站唯一一句叫員工再送一次)。
  //    ⇒ 合法的 path 只有兩個視圖:列表 `/orders`,或**這張單**的明細頁。其餘一律 fallback。
  if (returnToPathname(cleaned) !== ORDERS_PATH && returnToPathname(cleaned) !== fallback) {
    return fallback;
  }
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

/**
 * `return_to` → **`revalidatePath` 吃得下的路徑**(#350d-2;契約 §5)。
 *
 * 🔴 `revalidatePath` 吃的是**路徑**、不吃 query ——
 *    `revalidatePath('/orders?panel=x')` 不會 revalidate `/orders`,它只會是一條打不中的路徑。
 *    面板版的 `return_to` 一定帶 query ⇒ 少了這一步,「回面板」那條路由**永遠沒被重取**,
 *    而契約 §5 把它列成硬前置的理由是:D5 的 `miss_complete`(全站唯一會讓員工再送一次的那句)
 *    踩的正是「導頁之後那頁拿到的是重算過的資料」。
 * ⚠️ 只切 `?` —— `#` 在 `hasUnsafeShape` 就被擋掉了,這裡再處理一次是**寫不出負測的死碼**。
 */
export function returnToPathname(returnTo: string): string {
  const queryAt = returnTo.indexOf('?');
  return queryAt === -1 ? returnTo : returnTo.slice(0, queryAt);
}

/**
 * `next` / `items` 的逗號清單 → 小寫 uuid 陣列(去重、保序)。任一段不是 uuid、或超過 `max` ⇒ `null`(當沒帶)。
 * 非字串 / 空字串也是 `null`。
 */
export function parseUuidList(raw: unknown, max: number): string[] | null {
  if (typeof raw !== 'string' || raw === '') return null;
  const parts = raw.split(',');
  if (parts.length > max) return null;
  const out: string[] = [];
  for (const p of parts) {
    if (!isUuid(p)) return null;
    const id = p.toLowerCase();
    if (!out.includes(id)) out.push(id);
  }
  return out;
}
