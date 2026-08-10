'use server';

import { RedirectType, redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { parseOrderCancelForm } from './cancel-form';
import {
  CANCEL_ORDER_ID_FIELD,
  cancelledResultQuery,
  notSentResultQuery,
  sentResultQuery,
} from './cancel-action-state';
import { isUuid } from './note-action-state';
import {
  ORDER_RETURN_TO_FIELD,
  appendResultQuery,
  parseOrderReturnTo,
} from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';
import { cancelOrder } from './cancel-repository';

// cancel-actions.ts — M-4b E10 A9d2-2c:取消訂單 server action。
//
// 🔴 **全 PRG**(A13b **D2a**;`E-012-A` Q1=A 換路,推翻本片原本的「混合形」)。
//    ⚠️ 原本這行寫「全 PRG、零 client state」—— **A13b E1 之後「零 client state」為假**
//    (表單多了 `cancel-form-body.tsx` 的漸進增強層)。本 action 這一側沒變:它不回傳 state、
//    一律導頁,畫面狀態仍全部由 server 從帳本重建。
//   原本是「失敗回 action state、成功才 redirect」——那個形狀在 React 19 的 form reset 競態下
//   **可能誤送整單取消**(四輪修不穩,`E-011-STOP`)⇒ 現在**每一條路徑都導頁**,
//   URL 上只留碼與 token:**A 類(沒送到 RPC)只帶碼**(帳本裡本來就沒那筆,給 token 是叫 D5 去找鬼);
//   **B 類與成功帶碼 + `rt`**。畫面狀態一律由 server 從帳本重建。
//
// 🔴 **主流程一行 try 都沒有,是刻意的**:`cancel-repository.ts` 永不 throw、把所有失敗
//   收斂成回傳值 ⇒ 「`redirect()` 拋的 NEXT_REDIRECT 被 catch 吞掉、把已經成功的取消
//   分類成失敗」那個坑(plan §2 慣例 2、備註片 `:28-30` 的教訓)在結構上不存在,
//   不是靠下一個人記得把 `redirect()` 寫在 try 外面。
//   ⚠️ **本檔自 #350d-3 起一行 try 都沒有** —— 原本唯一那個(`safeRevalidate`)已經連同它的
//   兩份複製一起搬進 `order-revalidate.ts`(契約 §5 的單一實作,`import 'server-only'`)。
//   那支自己逐條包 try、拋錯不外傳,理由寫在它的 docstring。
//   要在本檔加 try 的人:先確認它包不到 `redirect()`。
//
// 🔴 **本檔沒有一行稽核 code** —— `admin_cancel_order` 在同交易寫 `admin_audit_log`。
//
// ⚠️ **導頁之後畫面上會看到什麼,本檔決定不了**(D2a 現況,誠實寫清楚):
//   - `order_cancel_denied` / `order_cancel_invalid`(沒送到 RPC 那兩支)⇒ 既有 `ResultBanner` 有文案。
//   - **成功碼與「已送到 RPC」那四支目前畫面上一片空白** —— 它們刻意不進 banner:
//     `?r=` 是任何人都能自己打的字,靜態訊息等於對一張沒被取消的單說「已完成」(D1 關卡2 must-fix)。
//     它們要由 **D5 的帳本核對面板**拿 `?rt=` 對帳本查出真話才顯示。
//   🔴 ⇒ **D5 落地前,取消成功後員工看不到提示**。這與 D1 之前相同、不是回歸,
//     但**在 D5 之前不得接線曝光給員工**(plan §3 的排序原則)。
//   ⓘ **未知碼靜默不顯示,現在由守門本身承擔**(#332-2,Sean 2026-08-06 拍板 Q1=A):
//   `result-banner.tsx` 的查表已硬化成 `Object.hasOwn(MESSAGES, code)`
//   ⇒ 任何非自有 key(含 `__proto__` 那族)都走 `return null`。
//   歷史註記:2026-08-02 拍板 B 曾把這個修法退回,那段期間本檔逐字警告過
//   「不要照抄『banner 用 hasOwn 所以未知碼安全』」—— 當時那句話是假的(裸索引),
//   `order_cancelled` 之所以安全只是**因為這個字串剛好不在原型鏈上**。現在理由變成守門本身,
//   兩者結論相同但**依據不同**:D1 接線時可以依賴守門,不必再論證字串「剛好不毒」。

const ORDERS_PATH = '/orders';

/** 🔴 `orderId` 必已過 uuid 閘 —— **兩個來源都是**:完整解析器,或 `readRedirectTargetOrderId`。 */
function detailPath(orderId: string): string {
  return `${ORDERS_PATH}/${orderId}`;
}

/**
 * 重取明細頁(plan §2 慣例 3:**失敗路徑也要 revalidate**;前例 `note-actions.ts:133-135`)——
 * `rejected` / `error` / `bug` 的 payload 形狀那一支都可能已經寫進去了,不重取的話**導頁之後那一頁**
 * 會停在看不到那筆取消的舊快取上,而 D5 的帳本核對面板正是要在那頁上說「你那筆寫進去了沒有」。
 * ⚠️ 理由已隨 D2a 換過:原本寫的是「凍結畫面上兩顆鍵同時在」——那個時間窗隨 client state 一起消失了。
 *
 * 🔴 **拋錯不得往外傳**(關卡2 codex must-fix):它是「讓畫面新一點」的動作,不是取消成功與否的一部分。
 * 讓它炸出去 = 補償 log 與導頁**全部不會發生**,員工拿到 500、重整後表單重繪換到新 token,
 * 而前一次可能已 commit ⇒ 換一顆 token 的部分取消**擋不住**(§6-5 認列的殘餘風險、backlog #353)。
 * 這是本檔唯一的 try,且離 `redirect()` 很遠。
 */

/**
 * 失敗導頁的單一出口。
 *
 * 🔴 **一律 `replace`**:`redirect()` 在 Server Action 預設是 push ⇒ 每失敗一次就在瀏覽器歷史
 *    多堆一格帶著結果碼的網址,上一頁按回去會重播一個早就不成立的畫面。
 *    ⚠️ **但安全論證不掛在這上面**(plan §1b):Next 16.2.6 的 progressive(無 JS)路徑只送 303
 *    Location、不吃 `replace`,而**該路徑的實際 history 行為本窗沒有量過**
 *    (要量得起真的 admin + 真瀏覽器,`E-031-A` 把那件事排到 #350 線下)。
 *    ⇒ 真正撐住「重播看不到假訊息」的是 D5 那側:**顯示什麼一律先查帳本**,URL 只是線索。
 *
 * 🔴 回傳型別 `never`:`redirect()` 用拋例外實作 ⇒ 呼叫點後面的 code 不會執行。
 *    寫成 `never` 讓 TS 也知道這件事,呼叫點才不用寫 `return`(寫了反而像「還會往下跑」)。
 */
function failRedirect(path: string, query: string): never {
  // 🔴 #350d:接法走共用的 `appendResultQuery` —— `path` 現在可能是**面板網址**(本來就帶 query),
  //    寫死 `?` 會把整串篩選蓋掉(而畫面上只看得出「篩選不見了」,看不出是誰蓋的)。
  redirect(appendResultQuery(path, query), RedirectType.replace);
}

/**
 * 授權**之後**才跑的「信封解析」——只為了決定**失敗要導去哪一頁**(D2a;關卡1 R2 finding 9)。
 *
 * 🔴 為什麼需要它:完整解析器失敗時只回 `{ ok: false }`、**拿不到 orderId** ⇒ 沒有它就只能把
 *    所有失敗都導去 `/orders`,員工每填錯一次就被踢出他正在看的那張單。
 * 🔴 為什麼排在授權閘**之後**:授權前連一個欄位都不准讀(plan §2 慣例 1),這條不破。
 *
 * ⚠️ **只驗 uuid 形狀,不驗「這張單存在且本 actor 看得到」** —— 與 `E-014-A` 追加的字面有出入,
 *    理由據實寫在這裡(已在 D2a 收工信向主視窗申報,不是偷偷縮範圍):
 *    ① **本 repo 沒有「本 actor 看得到哪些單」這個東西** —— actor 是使用者自己下拉挑的、系統未驗證
 *       (`../session/actor.ts` 自陳非授權邊界)⇒ 以它為準寫存在性檢查 = 守門的名字大於實際能力,
 *       正是本線一再被抓到的那種假守門。
 *    ② **目的地本身就是權威**:`/orders/<uuid>` 那頁對查無的單 `notFound()`(`app/orders/[id]/page.tsx`),
 *       在這裡多打一次 DB 只是把同一個判斷做兩遍,而且做在**失敗路徑**上。
 *    ⇒ 因此只宣稱一條、也只做得到這一條:**導頁目標永遠是 uuid 形狀的自家路徑**,
 *      client 送的字串轉不成任意網址(開放重導向面關掉)。
 */
function readRedirectTargetOrderId(formData: FormData): string | null {
  // 🔴🔴 **`getAll()` 恰一筆,不是 `get()`**(關卡2 codex 複審 #3):送兩份 `order_id` 時,
  //    解析器那邊會拒(`cancel-form.ts` 的 `readSingle`),但**失敗導頁**若採第一筆,
  //    員工會被導到**另一張單**的頁面、看著別人的取消結果面板。
  //    ⇒ 導頁目標與解析器必須用同一套讀法,否則「兩邊各自正確、合起來錯」。
  const all = formData.getAll(CANCEL_ORDER_ID_FIELD);
  if (all.length !== 1) return null;
  const raw = all[0];
  return typeof raw === 'string' && isUuid(raw) ? raw : null;
}

export async function cancelOrderAction(formData: FormData): Promise<void> {
  // ① 授權閘。🔴 **絕對第一,連讀一個欄位都在它之後**(plan §2 慣例 1)——
  //    未授權者送爛表單要拿到 `denied` 而不是 `invalid`,否則等於對未授權者洩漏表單規則。
  //    🔴 代價:`denied` 因此**不保留員工輸入**(拿不到就回不了)。同備註片 `:88-93` 的取捨,
  //    理由 = denied 意謂 session 已失效,他下一步一定要重新登入,留著也接不回去。
  const authorization = await authorizeAdminMutation();
  // 🔴 導**固定安全頁** `/orders`,不是明細頁:這條路上我們還沒讀過任何欄位(也不准讀),
  //    手上根本沒有可信的 orderId(關卡1 R1 finding 2)。
  if (!authorization) failRedirect(ORDERS_PATH, notSentResultQuery('denied'));

  // ② 失敗導頁目標(授權後才讀;理由見 `readRedirectTargetOrderId`)。
  //    🔴 **舊的「凍結短路」在這裡整段消失了,而且是刻意的**:它讀的是 `prevState`
  //    = client 送回來的參數(自陳只是 UX 層、可偽造)。PRG 之後根本沒有 client state 可讀,
  //    而它原本要防的事(員工在凍結畫面上手滑重送)改由 **D5 的帳本核對面板**接手 ——
  //    那一側說得出「你那筆到底寫進去了沒有」,比一個攔不住偽造的凍結旗標強。
  const targetOrderId = readRedirectTargetOrderId(formData);
  // 🔴 #350d C1:動作做完回哪裡由表單決定(面板裡取消 ⇒ 回面板)。
  //    **與 `targetOrderId` 綁在一起讀**:`parseOrderReturnTo` 的 fallback 需要一個可信的 orderId,
  //    而契約 §6-1 要求「`return_to` 只決定視圖、不決定哪一張單」—— 兩者都吃這一顆。
  //    🔴 `targetOrderId` 為 null(連 uuid 形狀都不合)⇒ **完全不看 `return_to`**:
  //    此時沒有可信的單號可以拿來做 §6-1 比對,放行等於讓 client 自己挑導頁目標。
  const returnTo =
    targetOrderId === null
      ? ORDERS_PATH
      : parseOrderReturnTo(formData.get(ORDER_RETURN_TO_FIELD), targetOrderId);


  // ③ 解析。任一形狀不合 → 導頁帶 `invalid`。
  //    🔴 **新 token 從哪來**:舊形狀是 builder 內鑄;PRG 之後**由整頁重繪時表單自己鑄**
  //    (D4 的義務;`cancel-action-state.ts` 的 `generateCancelRequestToken` docstring 逐字寫著
  //    「產生點必須在 server component 渲染期、且不得落在任何快取層內」——落了快取 = 兩個人拿到同一把)。
  //    ✅ **D4 已落地**(`components/orders/cancel-order-forms.tsx` 的 `CancelFormShell`):
  //    token 在渲染期鑄,守門 = `cancel-order-forms.test.tsx` 的「兩次獨立 render 兩顆不同合法 uuid」
  //    +「同一頁兩支表單兩顆不同 token」+ 原始碼層「本檔不得 import 快取層」三條。
  //    ⚠️ **涵蓋範圍有邊界**(`React.cache` 在測試環境是純透傳、行為層分辨不出來),
  //    逐字見 `CancelFormShell` 的 docstring —— 別把它讀成「已完全擋住」。
  const parsed = parseOrderCancelForm(formData);
  // 🔴 **不帶回員工輸入**(`E-014-A` Q2=A:失敗一律重填、從無效空值起始)——
  //    PRG 之下「保留輸入」要嘛把內容塞進 URL(違反 §2-2 只帶碼不帶內容),
  //    要嘛留 client state(正是本線換路要殺掉的東西)。
  if (!parsed.ok) failRedirect(returnTo, notSentResultQuery('invalid'));

  const httpRequestId = await getRequestId();
  // 🔴 **不記 `reasonDetail` 全文**(員工打的營運內容),只記長度 —— 同備註片 `:104` 的慣例。
  // 🔴 兩個 id 都記:冪等鍵是表單 token、不等於 HTTP `x-request-id`,兩者都留才對得回去。
  console.info('[admin/orders/cancel] order_cancel.attempt', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    sid: authorization.sid,
    actor: authorization.actorId,
    order_id: parsed.orderId,
    reason_code: parsed.reasonCode,
    reason_detail_length: parsed.reasonDetail === null ? 0 : [...parsed.reasonDetail].length,
    // 🔴 `null` = 整單取消。記筆數而不是品項內容:品項 id 對除錯沒用,筆數看得出模式對不對。
    mode: parsed.items === null ? 'full' : 'partial',
    item_count: parsed.items === null ? null : parsed.items.length,
  });

  const outcome = await cancelOrder({
    orderId: parsed.orderId,
    reasonCode: parsed.reasonCode,
    reasonDetail: parsed.reasonDetail,
    items: parsed.items,
    actor: authorization.actorId,
    requestToken: parsed.requestToken,
  });

  if (!outcome.ok) {
    // 🔴 **`P0001` 路徑必須記 message**(plan §4.2 補償條款,不是選配):`P0001` 同時是
    //    「這張單不能取消」與「我們送了畸形參數」的 SQLSTATE,判別器從 UI 分支移到這裡。
    //    這裡對**所有**失敗碼都記 —— 只挑 `P0001` 記等於再養一個會漂移的判別式。
    //    ⚠️ `logMessage` 由 repository 截成 200 字且**不含** `details`/`hint`(那會帶整列內容)。
    console.error('[admin/orders/cancel] 取消失敗', {
      request_id: httpRequestId,
      request_token: parsed.requestToken,
      order_id: parsed.orderId,
      code: outcome.code,
      sqlstate: outcome.sqlstate,
      message: outcome.logMessage,
    });
    // 🔴 **revalidate 排在 log 之後、且不准吃掉回傳**(關卡2 codex must-fix):
    //    原本它排在最前面 —— 它一拋錯,補償 log 與導頁就**全部不會發生**,
    //    員工拿到 500、重整後表單重繪換到新 token,而前一次可能已 commit ⇒ 正是重複部分取消的路。
    revalidateOrderViews({ orderId: parsed.orderId, returnTo, scope: 'cancel', requestId: httpRequestId });
    // 🔴 **原樣帶回這次送出的 token**(不鑄新的):換新鍵 = 全新 payload_hash =
    //    同一份 payload 會真的再取消一次(payload_hash 綁定見 `cancel-action-state.ts:14-20`;
    //    原本指的那句在 `cancelSentFailure` 的 docstring 裡,已隨 D2b 刪除)。
    // 🔴 **帶著這次送出的 token 導頁**(不鑄新的):它是 D5 拿去對取消帳本的唯一線索,
    //    也是員工那側「我剛送的那筆到底寫進去了沒有」唯一問得出答案的方法。
    //    型別上這裡**要不到不帶 token 的版本**(`sentResultQuery` 簽章必填,D1 交付面)。
    // 🔴 #350d C1:導回**動作發起的那個視圖**(面板裡取消 ⇒ 回面板),不再寫死明細頁。
    //    `returnTo` 已由 `parseOrderReturnTo` 綁在 `targetOrderId` 上(契約 §6-1)⇒ 它指的一定是這張單。
    failRedirect(returnTo, sentResultQuery(outcome.code, parsed.requestToken));
  }

  // 🔴 成功也留一行 log:把 `request_token` 對回 `cancellation_id` ——
  //    災難當天員工手上只有 token,而帳本上的鍵是 cancellation_id,靠這行才接得起來。
  //    (稽核本體在 DB 的 `admin_audit_log`,這行是營運可觀測面、不是稽核。)
  console.info('[admin/orders/cancel] order_cancel.done', {
    request_id: httpRequestId,
    request_token: parsed.requestToken,
    order_id: parsed.orderId,
    cancellation_id: outcome.cancellationId,
    idempotent: outcome.idempotent,
    closed: outcome.closed,
  });
  revalidateOrderViews({ orderId: parsed.orderId, returnTo, scope: 'cancel', requestId: httpRequestId });

  // 🔴 `idempotent: true` 也是成功:它意謂 RPC 認出同鍵同 payload 而吸收掉這次重送
  //    ——顯示成錯誤會誘導員工換一把 token 重送 = 冪等設計反而製造第二筆取消
  //    (同備註片對 `DUPLICATE_REQUEST` 的處置,`note-actions.ts:45-47`)。
  // ④ 成功才 PRG。🔴 **本檔自 #350d-3 起沒有任何 try**(那個唯一的 try 隨 `safeRevalidate`
  //    搬進 `order-revalidate.ts`)⇒ 這一行結構上不可能被 catch 吞掉。
  // 🔴 成功也要帶 `rt`(關卡2 R2 must-fix):成功訊息由 D5 查帳本後才顯示,
  //    沒有 token 就分不出「這次成功 / 帳本裡的舊紀錄 / 有人自己打的網址」。
  redirect(
    appendResultQuery(returnTo, cancelledResultQuery(parsed.requestToken)),
    RedirectType.replace,
  );
}
