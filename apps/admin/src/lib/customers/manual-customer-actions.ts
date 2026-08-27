'use server';

import { RedirectType, redirect } from 'next/navigation';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { getRequestId } from '../audit/context';
import { authorizeAdminMutation } from '../session/authorize';
import { readSingleString } from '../forms/single-value';
import { isUuid } from '../orders/note-action-state';
import {
  MANUAL_CUSTOMER_NEW_NAME_FIELD,
  MANUAL_CUSTOMER_NEW_PHONE_FIELD,
  MANUAL_ORDER_IN_PANEL_FIELD,
  MANUAL_ORDER_IN_PANEL_VALUE,
  MANUAL_ORDER_REQUEST_ID_FIELD,
} from '../orders/manual-order-form';
import {
  MANUAL_ORDER_PATH,
  manualCustomerResultQuery,
  manualOrderBasePath,
  manualOrderCustomerHref,
  manualOrderResultQuery,
} from '../orders/manual-order-action-state';
import { appendResultQuery } from '../orders/order-return-to';
import {
  createManualCustomer,
  normalizeManualPhone,
  type ManualCustomerClient,
} from './manual-customer';

// manual-customer-actions.ts — 在建單畫面上**直接把這位客人建出來**的 server action。
//
// 🔴🔴 **它修的是一條死路,不是一個不方便。**(2026-08-28 線A 量到)
//    建單畫面原本印的是逐字「這支電話找不到客人。請先到【客人】頁建立這位客人,再回來建單。」
//    —— 而**客人頁沒有新增客人的按鈕**:那一頁與 `components/customers/*` 全部的 `<form>` 共 5 個,
//    分別是篩選 / 關鍵字搜尋 / 改資料 / 改等級 / 儲值金,**零個是建立**。
//    (負對照同一把尺:`grep -c '<form' manual-order-form-body.tsx` ⇒ 2 ⇒ 尺是活的、不是恆零。)
//    ⇒ 也就是說:電話找不到人 ⇒ **後台完全建不出這張單**。而電話下單最常見的正是新客人。
//    ⇒ Sean 2026-08-27 逐字「沒有直接新增」講的就是這一格。
//
// 🔴 而 `createManualCustomer`(`manual-customer.ts:324`)**早就寫好、審過**,只是零呼叫端。
//    本檔就是那個呼叫端。**沒有新增任何建帳號的邏輯** —— 那一層的驗證與 trigger 回核全在它裡面。
//
// 體例逐字沿用 `lib/orders/manual-order-actions.ts`:全 PRG、授權閘絕對第一、失敗只把**代碼**
// 放進 URL(`?r=` 是任何人都能自己打的字 ⇒ 訊息本文進 URL = 讓任何人對員工顯示任意一句系統的話)。
//
// ⚠️ **本檔【不】把兩段式拆掉**(主視窗 2026-08-28 裁定):客人搜尋現在是 GET 導頁,
//    而導頁會把已填的運費與地址清光(`manual-order-form-body.tsx:38-42`,codex R1 must-fix)。
//    ⇒ 建好客人之後導回的仍然是「選好客人、建單表單才出現」那個狀態 ——
//      而那個狀態下**還沒有任何東西被填**,所以這條路不會清掉任何值。

/**
 * 失敗導頁的單一出口(理由逐字同 `manual-order-actions.ts:45-48`:一律 replace)。
 * `basePath` = 整頁版或面板版,由呼叫點決定 —— 在面板裡失敗要留在面板裡。
 */
function failRedirect(basePath: string, query: string): never {
  redirect(appendResultQuery(basePath, query), RedirectType.replace);
}

/**
 * 在建單畫面上直接建一位新客人,建好之後**回到同一頁、而且已經選好他**。
 *
 * 🔴 導回的網址由 `manualOrderCustomerHref` 產 —— **`phone` 一定要帶**:
 *    頁面是拿「這次查回來的候選」去核 `customer` 的(`components/orders/manual-order-view.tsx:92`)
 *    ⇒ 少了 `phone` ⇒ 候選是空的 ⇒ 剛建好的人**選不上**,而畫面看起來像什麼都沒發生。
 */
export async function createManualCustomerAction(formData: FormData): Promise<void> {
  // ① 授權閘絕對第一 —— 連一個欄位都在它之後(同 `manual-order-actions.ts:74-77`)。
  const authorization = await authorizeAdminMutation();
  // 🔴 `denied` **刻意一律導整頁版**:那條路上一個表單欄位都還沒讀(閘絕對第一),
  //    而未授權者本來就得先重新登入 —— 為了一個「回到面板」而在閘之前讀欄位不划算。
  if (!authorization) failRedirect(MANUAL_ORDER_PATH, manualOrderResultQuery('denied'));

  const requestId = await getRequestId();
  // 這一格在閘**之後**才讀。它只有兩個值(在面板 / 不在),不影響任何驗證分支。
  const inPanel =
    readSingleString(formData, MANUAL_ORDER_IN_PANEL_FIELD) === MANUAL_ORDER_IN_PANEL_VALUE;
  const basePath = manualOrderBasePath(inPanel);

  // ② 冪等鍵**照原樣帶回去**:這一頁每次 render 都會鑄新的一顆,而員工可能已經在
  //    另一個分頁用舊鍵送出過建單。只帶看起來是 uuid 的那顆(它來自表單、可能是任何字串)。
  const rawKey = readSingleString(formData, MANUAL_ORDER_REQUEST_ID_FIELD);
  const carriedKey = rawKey !== null && isUuid(rawKey) ? rawKey : undefined;

  const rawName = readSingleString(formData, MANUAL_CUSTOMER_NEW_NAME_FIELD) ?? '';
  const rawPhone = readSingleString(formData, MANUAL_CUSTOMER_NEW_PHONE_FIELD) ?? '';
  // 🔴 導回用的電話一律是**正規化過的數字串**,不是他打的原文:
  //    候選查詢那支 RPC 比的是去掉非數字之後的值(`manual-customer.ts:127` `normalizeManualPhone`),
  //    而剛建好的那筆存進去的也是正規化值 ⇒ 帶原文回去在「他打了 0912-345-678」時**找不到自己剛建的人**。
  const normalizedPhone = normalizeManualPhone(rawPhone);

  // ③ 建帳號。**驗證不在本檔** —— 姓名空白 / 電話太短由 `createManualCustomer` 自己擋
  //    (`manual-customer.ts:344-355`,那是它的信任邊界,不是這裡的)。
  //
  // 🔴🔴 **try 只包這一發,`redirect()` 一律在 try 外面**:`redirect()` 是用拋例外實作的,
  //    包進 try 會被自己的 catch 吞掉(同目錄 `note-actions.ts:28-30` 的教訓)。
  let created: Awaited<ReturnType<typeof createManualCustomer>> | null = null;
  let threw = false;
  try {
    created = await createManualCustomer(
      createSupabaseServiceClient() as unknown as ManualCustomerClient,
      // 🔴🔴 **冪等鍵一定要遞下去**(codex R1 must-fix,2026-08-28):它決定佔位信箱,
      //    而那是這條路上**唯一**擋得住「雙擊建出兩個真 auth user」的東西。
      //    ⚠️ `carriedKey` 是 `undefined` 時**不自己鑄一顆**:鑄了等於每一發都是新鍵 = 沒有冪等,
      //       而且畫面上完全看不出差別。讓它走 `invalid_request_id` 那條、叫員工重新整理。
      { name: rawName, phone: rawPhone, requestId: carriedKey ?? '' },
    );
  } catch (error) {
    // 🔴 這條路**可能已經建出一個真的帳號了**:`createManualCustomer:429-436` 自陳
    //    「這一發不是與 createUser 同一個原子操作」⇒ 帳號建好、回頭確認那一發自己斷線時,
    //    它會拋,而**帳號與 customers 那一列不會回滾**。
    //    ⇒ 文案必須叫員工**先去找一下**,不能叫他直接再送一次(那會建出第二個)。
    console.error(
      JSON.stringify({ evt: 'admin.manual_customer.failed', requestId }),
      error,
    );
    threw = true;
  }
  if (threw) failRedirect(basePath, manualCustomerResultQuery('error', carriedKey, normalizedPhone));

  if (created === null || !created.ok) {
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_customer.invalid',
        requestId,
        // 🔴 只記**理由代碼**,不記他打的值:那些值是客人姓名與電話。
        reason: created === null ? 'null' : created.reason,
      }),
    );
    failRedirect(basePath, manualCustomerResultQuery('invalid', carriedKey, normalizedPhone));
  }

  // 🔴🔴 **重送(冪等)這條路要留下訊號**(R3 F9):它原本與「全新建立」走**完全相同**的分支
  //    ⇒ 零 log、畫面零訊號。**F1 那條之所以無聲,一半在這一格。**
  //    ⇒ 至少讓災難當天查得到:哪一顆鍵、在什麼時候、被判成了重送。
  //    ⚠️ **不記姓名與電話**(PII);`requestId` 是我們自己產的 uuid,不是客人資料。
  if (created.idempotent === true) {
    console.warn(
      JSON.stringify({
        evt: 'admin.manual_customer.idempotent_hit',
        requestId,
        manualRequestId: carriedKey ?? null,
      }),
    );
  }

  // ④ 成功 ⇒ 回到建單頁,而且**已經選好這位客人**(不必再按一次「找客人」)。
  // 🔴 **`carriedKey` 一定不是 undefined 到得了這裡**(R3 F11:上一版那個三元是死碼)——
  //    `undefined` ⇒ 上面遞 `requestId: ''` ⇒ `createManualCustomer` 必回 `invalid_request_id`
  //    ⇒ `!created.ok` 那道已經導走了。⇒ 拿掉那條手拼的分支:
  //    它同時是 `manualOrderCustomerHref` docstring 逐字宣告的「**唯一產生處**」的第二處手拼。
  redirect(
    manualOrderCustomerHref({
      manualRequestId: carriedKey as string,
      phone: normalizedPhone,
      customerId: created.userId,
      inPanel,
    }),
    RedirectType.replace,
  );
}
