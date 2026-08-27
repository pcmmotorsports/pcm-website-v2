'use server';

import { RedirectType, redirect } from 'next/navigation';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { appendResultQuery } from './order-return-to';
import { revalidateOrderViews } from './order-revalidate';
import { readSingleString } from '../forms/single-value';
import { isUuid } from './note-action-state';
import {
  MANUAL_ORDER_IN_PANEL_FIELD,
  MANUAL_ORDER_IN_PANEL_VALUE,
  MANUAL_ORDER_REQUEST_ID_FIELD,
  parseManualOrderForm,
} from './manual-order-form';
import { createManualOrder } from './manual-order-repository';
// 🔴 常數住在隔壁那支檔, 因為 `'use server'` 檔【只能匯出 async 函式】(該檔頭有實測紀錄)。
import {
  MANUAL_ORDER_PATH,
  ORDER_PANEL_PARAM_FOR_MANUAL,
  manualOrderBasePath,
  manualOrderResultQuery,
} from './manual-order-action-state';

// manual-order-actions.ts — M12-A2:後台手動建單 server action(`#858`)。
//
// 體例逐字沿用同目錄 `cancel-actions.ts`(同一條 owner-RPC 鏈):
//   · **全 PRG**,不回傳 action state ⇒ 畫面狀態由 server 重建
//   · **主流程一行 try 都沒有** —— `manual-order-repository.ts` 永不 throw、把所有失敗收斂成回傳值
//     ⇒ 「`redirect()` 拋的 NEXT_REDIRECT 被 catch 吞掉」那個坑在**結構上不存在**,
//     不是靠下一個人記得把 `redirect()` 寫在 try 外面(備註片 `note-actions.ts:28-30` 的教訓)
//   · **本檔沒有一行稽核 code** —— RPC 的 `G9` 在同交易寫 `admin_audit_log`
//
// ⛔ ~~🔴🔴 **本 action 目前【零呼叫端】** —— `/orders/new` 那一頁還不存在
//    (`ls apps/admin/src/app/orders` ⇒ `[id]` / `page.tsx` / `refund-exceptions`,2026-08-24 當場量)。
//    ⇒ **它必須與表單頁同一片上線**;先推它會讓每一條失敗路徑導去一個 404。~~
// ✅ **它有呼叫端了**:`components/orders/manual-order-form-body.tsx` 的 `<form action={…}>`,
//    頁面在 `app/orders/new/page.tsx`。
// 🔴🔴 **而上面那句是【什麼時候】變假的,值得記一筆**:它在 **A3-b 落地的當天**就假了
//    (那一片同時建了頁面與 `<form action={…}>`),而**它躺到 A3-c 才被發現**。
//    ⇒ 寫下「目前零呼叫端」的人**沒有辦法知道**它哪一天會變假 —— 那一天是別人做的事。
//    ⇒ 所以本檔的測試裡有一格**去掃原始碼**釘住這件事:
//      `manual-order-actions.test.ts` 的「本 action 必須有呼叫端」那一格。
//      **中間態的宣稱要有守門,不然它只會在下一個人碰巧讀到時才被更正。**
//
// ⚠️ **plan §3-③ 有一格本片【刻意沒做】,不是忘了**:那張表寫「其他 `P0001` ⇒ 原樣顯示 RPC 訊息」。
//    本片只把**代碼**放進 URL、把訊息寫進 log。理由:`?r=` 是任何人都能自己打的字
//    ⇒ 把 RPC 訊息放進 URL = 讓任何人對員工顯示任意一句「系統說的話」。
//    ⇒ **那句訊息要怎麼回到畫面上,是表單頁那一片的題目**(它有 server 端可以重建狀態的位置)。
//    🔴 **不得因為「反正 log 裡有」就當它做完了** —— 員工看不到 log。

/**
 * 失敗導頁的單一出口。
 *
 * 🔴 一律 `replace`:`redirect()` 在 Server Action 預設是 push ⇒ 每失敗一次就在歷史多堆一格
 *    帶著結果碼的網址,按上一頁會重播一個早就不成立的畫面。
 * 🔴 回傳 `never`:`redirect()` 用拋例外實作 ⇒ 呼叫點後面的 code 不會執行。
 */
function failRedirect(basePath: string, query: string): never {
  redirect(appendResultQuery(basePath, query), RedirectType.replace);
}

/**
 * 建一張手動單。
 *
 * 🔴🔴 **參數列只有 `formData`,沒有 actor,而那是承重的**:
 *    `p_actor` 一律取自 `authorizeAdminMutation().actorId`,**表單送什麼都不看**。
 *    ⇒ 「表單指定經手人」這件事在**型別上就寫不出來** —— `parseManualOrderForm()` 產出的
 *      `ManualOrderValues` 根本沒有那一格。
 *    ⚠️ 而 RPC 那一側**擋不到這件事**:它的 `G1` 只驗 `p_actor` 是啟用中的 staff,
 *      不驗那個 actor 是不是真的按下送出的人(`session/actor.ts:7` 自陳
 *      「actor 以 cookie 承載…**這不是**登入 / 授權邊界」)。
 *    ⇒ **就我掃到的範圍,這一層是唯一擋得住它的地方。**
 *      ⚠️ 射程:我掃的是 RPC 本體 + `session/`;**沒有去確認有沒有第三道守門住在別處。**
 */
/**
 * 訊息本文可以進 log 的 SQLSTATE 白名單。
 * 🔴 **白名單不是黑名單**:黑名單要列舉「哪些會引用輸入」,而那是一個**無限集合**
 *    (RPC 每加一句 RAISE 就多一個)。白名單只需要列舉「我逐字讀過、確定安全」的那幾支。
 */
const SAFE_MESSAGE_SQLSTATES = new Set(['P858A', 'P858B']);

export async function createManualOrderAction(formData: FormData): Promise<void> {
  // ① 授權閘。🔴 **絕對第一,連讀一個欄位都在它之後** ——
  //    未授權者送爛表單要拿到 `denied` 而不是 `invalid`,否則等於對未授權者洩漏表單規則。
  const authorization = await authorizeAdminMutation();
  // 🔴 `denied` **刻意一律導整頁版**:那條路上一個表單欄位都還沒讀(閘絕對第一)。
  if (!authorization) failRedirect(MANUAL_ORDER_PATH, manualOrderResultQuery('denied'));

  // 🔴 這一格在閘**之後**才讀,而且只有兩個值(在面板 / 不在)⇒ 不影響任何驗證分支。
  //    它決定「送出之後回到哪裡」:面板裡送出要留在面板裡,不然畫面會整頁跳掉。
  const inPanel =
    readSingleString(formData, MANUAL_ORDER_IN_PANEL_FIELD) === MANUAL_ORDER_IN_PANEL_VALUE;
  const basePath = manualOrderBasePath(inPanel);

  // ② 表單形狀。錯在哪只進 log、不進 URL(理由見檔頭那段)。
  const parsed = parseManualOrderForm(formData);
  const requestId = await getRequestId();
  if (!parsed.ok) {
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_order.invalid',
        requestId,
        // 🔴 只記解析器自己產的**理由字串**,不記員工打的值:那些值含客人姓名 / 電話 / 地址。
        reason: parsed.error.slice(0, 200),
      }),
    );
    // 🔴 **合法的冪等鍵要帶回去**(codex R1 must-fix):只缺一個必填欄就換一顆新鍵的話,
    //    另一個分頁若已經用舊鍵送成功了,他補完欄位再送就會建出**第二張真訂單**。
    //    ⚠️ 只帶【看起來是 uuid】的那顆:它來自表單、可能是任何字串,而 RPC 對非 uuid 一律拒。
    const rawKey = readSingleString(formData, MANUAL_ORDER_REQUEST_ID_FIELD);
    failRedirect(
      basePath,
      manualOrderResultQuery('invalid', rawKey !== null && isUuid(rawKey) ? rawKey : undefined),
    );
  }

  // ③ 送 RPC。actor 只有這一個來源。
  const outcome = await createManualOrder({ values: parsed.values, actor: authorization.actorId });

  if (!outcome.ok) {
    // 🔴 **失敗一定要留下可觀測資訊**:`concurrent` 與 `mismatch` 的下一步完全相反,
    //    而災難當天分辨它們的唯一依據就是這行 log 裡的 `sqlstate`。
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_order.failed',
        requestId,
        code: outcome.code,
        sqlstate: outcome.sqlstate,
        constraint: outcome.constraint,
        // 🔴🔴 **預設【不記】訊息本文,只有已知安全的兩支才記**(codex R1 + R2 兩輪)。
        //    R1 抓到:`rejected` 的訊息**逐字引用員工填的那一列**(料號 / 品名),
        //      而手動單的自由品名可能是「王小明 0912345678」⇒ 記進 log 就是把客人資料送出去。
        //      ⚠️ 不讀 `details`/`hint` **擋不到這一格** —— PII 在 `message` 裡。
        //    🔴 R2 抓到:**只遮 `rejected` 不夠** —— RPC 的型別轉換(`:351,362,367`)
        //      會讓 `22P02` / `22003` 的訊息也引用原始輸入,而 repository 把它們歸到
        //      `error` / `bug` ⇒ 照樣記進去。
        //    ⇒ **改成白名單**:只有 `P858A` / `P858B` 這兩支是我們自己 RAISE 的固定句、
        //      逐字讀過、不含員工輸入。其餘一律不記本文。
        //    📌 代價寫清楚:診斷力下降。**而 `sqlstate` / `constraint` / `code` 三格仍在**,
        //      災難當天靠它們分得出是哪一種失敗;要看原文請去 Supabase 那一側的 log。
        message: SAFE_MESSAGE_SQLSTATES.has(outcome.sqlstate ?? '')
          ? outcome.logMessage
          : '(訊息可能含客人資料,不記;看 sqlstate)',
        // 🔴 **冪等鍵要記** —— 員工回報「我按了兩次」時,靠它才對得回同一顆鍵。
        //    它是我們自己產的 uuid,不是客人資料。
        manualRequestId: parsed.values.manualRequestId,
      }),
    );
    // 🔴 把冪等鍵帶回表單頁 —— 否則下一次 render 會鑄一顆新的,
    //    而 `concurrent`「再按一次送出」就會建出**第二張真訂單**(見 action-state 那段)。
    failRedirect(basePath, manualOrderResultQuery(outcome.code, parsed.values.manualRequestId));
  }

  // ④ 成功(含 `idempotent: true` 那條路)⇒ 導去那張單。
  // 🔴 **`idempotent: true` 也導同一個地方,而且刻意不分兩種畫面**:
  //    那代表「這顆鍵已經建過這張單」⇒ 員工要看到的就是那張單。
  //    分成兩種訊息只會讓他懷疑自己是不是建了兩張 —— 而他沒有。
  revalidateOrderViews({
    orderId: outcome.orderId,
    returnTo: basePath,
    scope: 'manual-order',
    requestId,
  });
  // 🔴 建好之後**留在原來那個容器**:面板裡建的單就在面板裡打開它
  //    (`/orders?panel=<uuid>` 正是既有訂單面板認的形狀,`@panel/orders/page.tsx:44-56`)。
  redirect(
    inPanel
      ? `/orders?${ORDER_PANEL_PARAM_FOR_MANUAL}=${outcome.orderId}`
      : `/orders/${outcome.orderId}`,
    RedirectType.replace,
  );
}
