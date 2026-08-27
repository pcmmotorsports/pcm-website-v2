import type { ManualOrderSentCode } from './manual-order-repository';
// 🔴 面板槽的參數名**從 `order-return-to.ts` 拿**,不在這裡再打一次字串:
//    兩處各寫一次的話,改名的那天面板會安靜地打不開(兩邊都不會紅)。
import { ORDER_PANEL_PARAM } from './order-return-to';

// manual-order-action-state.ts — M12-A3-b:手動建單的**結果碼與路徑**(常數層)。
//
// 🔴🔴 **它為什麼必須是獨立一支檔,而不是住在 `manual-order-actions.ts` 裡**:
//    那支檔有 `'use server'`,而 Next 的規則是
//    **`Only async functions are allowed to be exported in a "use server" file.`**
//    ⇒ 常數 / 型別 / 純函式一個都不能從那裡匯出。
//
//    ⚠️ **而這件事我是【踩到才知道】的,寫下來免得下一個人重踩**:
//    M12-A2 交件時這五個東西就寫在 `manual-order-actions.ts` 裡,
//    **typecheck 綠、lint 綠、build 綠、admin 全套 4702 passed** ——
//    🔴 因為**那時沒有任何檔 import 它**。build 看不到一個沒有人載入的模組的匯出規則。
//    2026-08-24 一把它接進 `app/orders/new/page.tsx` ⇒ **當場 build 紅**,逐字:
//      `Error: Only async functions are allowed to be exported in a "use server" file.`
//    📌 這正是「**分階段的中間態沒有偵測器**」的一個實例 —— 而我自己就是那個中間態。
//    ⇒ 那個偵測器 = A3-c 要交的「action 有呼叫端」守門。
//
//    體例對照:`cancel-actions.ts` 只匯出一支 async(`:127`),常數全在 `cancel-action-state.ts`。
//    **那個拆法不是整理,是這條規則逼出來的。**

/** 表單**整頁版**的路徑。 */
export const MANUAL_ORDER_PATH = '/orders/new';

// ── 側邊面板版(2026-08-28 線A;Sean 2026-08-27 逐字「一樣是側邊欄位」「直接跳出一個視窗」)──
//
// 🔴 **抄的是 `app/@panel/orders/page.tsx:44-56` 那條 searchParams 驅動的路**,不碰攔截路由
//    —— 後者實測會讓面板黏著不放(該檔 `:18-24` 有五格實測表),已作廢。
//
// 🔴🔴 **「現在在哪個容器裡」刻意做成【兩個值的封閉集】,不做成一個 `return_to` 字串。**
//    那是安全面的選擇,不是省事:自由字串的導頁目標要一整套驗證才擋得住 open redirect
//    (`order-return-to.ts` 為此寫了 150 行,而它綁死在一張既有訂單的 id 上、這裡沒有那個 id)。
//    **一個只有兩個成員的集合,構造不出第三個目標。**

/** 面板槽認的值:`/orders?panel=new`。🔴 它**不是 uuid** ⇒ `readOpenPanelOrderId` 會回 null,
 *  所以面板頁必須在那道檢查**之前**先認它,否則面板永遠打不開。 */
export const MANUAL_ORDER_PANEL_VALUE = 'new';

/** `panel` 這顆參數名的 re-export —— 建單 action 要用它組「建好之後打開那張單」的網址,
 *  而它不該為此去 import `order-return-to`(那支是導頁驗證,兩件事)。 */
export const ORDER_PANEL_PARAM_FOR_MANUAL = ORDER_PANEL_PARAM;

/**
 * 這個 URL 要不要開**手動建單面板** —— 🔴 **槽頁與列表問的必須是同一支。**
 *
 * 理由逐字沿用 `app/orders/page.tsx:144-151`(`readOpenPanelOrderId` 那條):兩邊各判一次的話,
 * 其中一邊漏了 ⇒ `?panel=new&r=…` 會**由列表與面板各畫一次同一條橫幅**(codex R1 nit,2026-08-28),
 * 或者反過來變成零橫幅。**那種不一致在畫面上長得像「訊息偶爾會怪怪的」。**
 */
export function isManualOrderPanel(
  raw: Record<string, string | string[] | undefined>,
): boolean {
  return raw[ORDER_PANEL_PARAM] === MANUAL_ORDER_PANEL_VALUE;
}

/** 面板版網址。 */
export const MANUAL_ORDER_PANEL_PATH = `/orders?${ORDER_PANEL_PARAM}=${MANUAL_ORDER_PANEL_VALUE}`;

/**
 * 表單此刻所有連結與導頁的**基底** —— 整頁版與面板版共用同一份表單,
 * 而它們送出之後要回到**自己那一邊**。
 *
 * 🔴 少了它的話,在面板裡按「找客人」會**跳出面板、整頁換到 `/orders/new`**
 *    —— 而那正是 Sean 抱怨的「一塊一塊、跑來跑去」。
 */
export function manualOrderBasePath(inPanel: boolean): string {
  return inPanel ? MANUAL_ORDER_PANEL_PATH : MANUAL_ORDER_PATH;
}

/** 沒送到 RPC 的兩支:授權失敗 / 表單形狀不合。 */
export const MANUAL_ORDER_NOT_SENT_CODES = Object.freeze(['denied', 'invalid'] as const);
export type ManualOrderNotSentCode = (typeof MANUAL_ORDER_NOT_SENT_CODES)[number];

/** 送到 RPC 之後才失敗的六支(與 repository 的 `ManualOrderSentCode` 同一個集合)。 */
export const MANUAL_ORDER_SENT_CODES = Object.freeze([
  'concurrent',
  'mismatch',
  'exhausted',
  'rejected',
  'bug',
  'error',
] as const);

export const MANUAL_ORDER_RESULT_PARAM = 'r';

/**
 * 失敗導頁時把**冪等鍵**帶回表單頁的 query 參數。
 *
 * 🔴🔴 **它不是加值,是讓兩句話變成真的**:
 *   · `concurrent` 的文案叫員工「**再按一次送出**」—— 而那句話只有在【鍵沒變】時才成立。
 *     表單頁每次 render 都鑄一顆新 uuid ⇒ 他「再按一次」會拿到**新鍵** ⇒ **建出第二張真訂單**。
 *   · `error` 的文案逐字寫著「編號不變,不會建成兩張」—— 少了本參數,**那句話是假的**。
 *   ⇒ 這兩句文案與本參數是**同一件事的兩半**,不得只改一半。
 *
 * ⚠️ **可偽造性**:`?mrid=` 是任何人都能自己打的字。而它的最壞後果**有界**:
 *   同鍵同內容 ⇒ RPC 回 idempotent(不會多建);同鍵不同內容 ⇒ `P858B` 拒絕。
 *   ⇒ 它挑不出「多建一張單」這個結果。**而客人資料一個字都沒有進 URL**(這是我們自己產的 uuid)。
 */
export const MANUAL_ORDER_REQUEST_ID_PARAM = 'mrid';

/**
 * 結果碼加前綴。
 *
 * 🔴 **前綴不是裝飾**:`?r=` 是共用參數,同一批頁面上還有取消片 / 改金額片 / 上下架片的碼在跑。
 *    不加前綴的話 `denied` / `invalid` / `error` 會被多條線同時認領,
 *    而**各線的下一步不一樣** —— 那種撞號在畫面上長得像「訊息偶爾會不對」。
 *    零碰撞由 `result-banner.test.tsx` 的鍵集合比對釘住。
 */
export function manualOrderResultCode(
  code: ManualOrderNotSentCode | ManualOrderSentCode,
): string {
  return `manual_order_${code}`;
}

export function manualOrderResultQuery(
  code: ManualOrderNotSentCode | ManualOrderSentCode,
  /**
   * 🔴 有鍵就帶。
   * · 送到過 RPC 的六支:一定有(解析成功過)。
   * · `invalid`:**表單上那顆若是合法 uuid 就帶**(codex R1 must-fix 之後改的)——
   *   只缺一個必填欄就換新鍵的話,另一分頁若已用舊鍵送成功,他補完再送會建出第二張。
   * · `denied`:**沒有**。那條路上一個欄位都還沒讀(授權閘絕對第一)。
   */
  manualRequestId?: string,
): string {
  const base = `${MANUAL_ORDER_RESULT_PARAM}=${manualOrderResultCode(code)}`;
  return manualRequestId === undefined
    ? base
    : `${base}&${MANUAL_ORDER_REQUEST_ID_PARAM}=${encodeURIComponent(manualRequestId)}`;
}

// ── 面板裡「直接新增這位客人」那條路(`createManualCustomerAction`)────────────────────
//
// 🔴 **為什麼它的結果碼住在【建單】這支檔**:它導回的就是建單那一頁(`MANUAL_ORDER_PATH`),
//    而 `?r=` 是同一顆共用參數。分兩支檔會讓「零碰撞」那道守門要同時讀兩個地方,
//    而漏讀一邊的那天不會有東西紅。
// 🔴 **授權失敗刻意【共用】`manual_order_denied`**,不另開一顆:兩條路的下一步逐字相同
//    (重新登入再來一次),而多一顆碼就多一句要維護的文案。

/** 沒建成客人的兩支。 */
export const MANUAL_CUSTOMER_CODES = Object.freeze(['invalid', 'error'] as const);
export type ManualCustomerResultCode = (typeof MANUAL_CUSTOMER_CODES)[number];

export function manualCustomerResultCode(code: ManualCustomerResultCode): string {
  return `manual_customer_${code}`;
}

/**
 * 建客人失敗時導回建單頁的 query。
 *
 * 🔴 **冪等鍵要帶回去**,理由與 {@link manualOrderResultQuery} 那一段逐字相同:
 *    這一頁每次 render 都會鑄新鍵,而員工可能已經在另一個分頁用舊鍵送出過。
 * 🔴 **電話也要帶回去**:少了它,他填的那支電話會消失、候選清單變空
 *    ⇒ 他得從頭再打一次電話 —— 而「重打一次」正是這一片要拿掉的動作。
 */
export function manualCustomerResultQuery(
  code: ManualCustomerResultCode,
  manualRequestId?: string,
  phone?: string,
): string {
  const parts = [`${MANUAL_ORDER_RESULT_PARAM}=${manualCustomerResultCode(code)}`];
  if (manualRequestId !== undefined) {
    parts.push(`${MANUAL_ORDER_REQUEST_ID_PARAM}=${encodeURIComponent(manualRequestId)}`);
  }
  if (phone !== undefined && phone !== '') parts.push(`phone=${encodeURIComponent(phone)}`);
  return parts.join('&');
}

/**
 * 「這支電話 + 選定這位客人」的建單頁網址 —— **唯一產生處**。
 *
 * 🔴 **三個地方會用到它,而它們必須逐字相同**:候選清單上的連結、剛建好客人之後的導頁、
 *    以及測試。各自拼一次的話,漏掉 `phone` 的那一份會**靜默失效** ——
 *    頁面是拿「這次查回來的候選」去核 `customer` 的(`components/orders/manual-order-view.tsx:92`),
 *    少了 `phone` ⇒ 候選是空的 ⇒ `customer` 被判無效 ⇒ **點誰都選不上**。
 *    (那正是 codex R2 在 `manual-order-form-body.tsx:142-145` 抓到的那一格。)
 */
export function manualOrderCustomerHref(args: {
  manualRequestId: string;
  phone: string;
  customerId: string;
  /** 在面板裡 ⇒ 連結要留在面板裡(預設整頁版)。 */
  inPanel?: boolean;
}): string {
  const base = manualOrderBasePath(args.inPanel === true);
  const sep = base.includes('?') ? '&' : '?';
  return (
    `${base}${sep}${MANUAL_ORDER_REQUEST_ID_PARAM}=${encodeURIComponent(args.manualRequestId)}` +
    `&phone=${encodeURIComponent(args.phone)}` +
    `&customer=${encodeURIComponent(args.customerId)}`
  );
}
