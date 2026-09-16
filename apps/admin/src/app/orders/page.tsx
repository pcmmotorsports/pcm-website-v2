import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { AdminOrderDetail, AdminOrderFilter, AdminOrderListResult } from '@pcm/domain';
import {
  ORDER_KEYWORD_COOKIE,
  readOrderKeywordCookie,
} from '../../lib/orders/order-keyword-cookie';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  legacyPanelRedirectHref,
  readOpenOrderId,
  ORDERS_PAGE_SIZE,
  PANEL_CLOSED,
} from '../../lib/orders/order-list-view';
// 🆕 P-b:就地展開用的明細 = 與 `@panel/orders/page.tsx` 渲染進面板的【同一支】。
import { OrderInlineHead } from '../../components/orders/order-inline-head';
// 🔵 合體(2026-09-14):展開列換成 `OrderInlineHead`(設計窗),而四個網址彈窗 `?cancel/?note/?edit/?more`(A 窗)
//    各渲染 `OrderDetailRoute` 的一個 section ⇒ 兩支都要 import。
import { OrderDetailRoute } from '../../components/orders/order-detail-route';
import { OpenOrderNotice } from '../../components/orders/open-order-notice';
// 🆕 P-e-1:「下一步」彈窗殼(client)+ 網址參數。內容由本檔依 `do=` 挑、當 children 塞進去。
import { NextStepDialog } from '../../components/orders/next-step-dialog';
import { InvoiceCheatSheetDialog } from '../../components/orders/invoice-cheatsheet-dialog';
import { ManualOrderView } from '../../components/orders/manual-order-view';
// 🆕 P-e-2:三支 body(設計窗)。前兩支是 server component(自己 await),塞進殼當 children;
//    出貨那支是 'use client' 且自帶整片遮罩 ⇒ **不包殼,直接渲染**(見下方 switch)。
import { loadNextStepProcurementParts } from '../../components/orders/next-step-procurement-body';
import { loadNextStepReceiptParts, ReceiptTableHeader } from '../../components/orders/next-step-receipt-body';
import { NextStepBatchForm } from '../../components/orders/next-step-batch-form';
import { NextStepShipmentBody } from '../../components/orders/next-step-shipment-body';
import { ShipmentMoreRows } from '../../components/orders/shipment-more-rows';
// 🆕 收款欄可點:`?pay=<id>` ⇒ 「新增收款」彈窗(復用明細頁收款表單)。
import { NextStepPayBody } from '../../components/orders/next-step-pay-body';
import { orderAmountDue } from '../../lib/orders/payment-list-view';
import {
  ORDER_INVOICE_PARAM,
  buildInvoiceHref,
  ORDER_NEXT_PARAM,
  ORDER_NEXT_DO_PARAM,
  ORDER_NEXT_ITEMS_PARAM,
  ORDER_COSTS_ITEMS_PARAM,
  COSTS_ITEMS_MAX,
  NEXT_MULTI_MAX,
  ORDER_PAY_PARAM,
  ORDER_CANCEL_PARAM,
  ORDER_NOTE_PARAM,
  ORDER_EDIT_PARAM,
  ORDER_MORE_PARAM,
  NEXT_STEP_DO_VALUES,
  parseUuidList,
  type NextStepDo,
} from '../../lib/orders/order-return-to';
import { ORDER_NEXT_STEP_LABEL, NEXT_STEP_DO } from '../../lib/orders/order-status-axes';
import { customerDetailHref } from '../../lib/orders/order-detail-view';
import { isUuid } from '../../lib/orders/note-action-state';
import { CANCEL_REQUEST_TOKEN_PARAM } from '../../lib/orders/cancel-action-state';
// 🆕 `?cancel=` 彈窗(2026-09-13)codex must-fix ②:取消做完導回 `open=A&r=…&rt=…` 而 A 不在這一頁(篩選外 / 取消後離開篩選)
//    ⇒ 沒有展開明細 ⇒ 沒有 CancelResultPanel ⇒ 結果【完全沒地方顯示】。這裡在「open 不在列表」那條路上補畫同一顆面板。
import { CancelResultPanel, isCancelPanelResultCode } from '../../components/orders/cancel-result-panel';
import { getSessionActor, getSessionActorIdWithSource } from '../../lib/session/actor';
import { describeSupplierMatch } from '../../lib/orders/supplier-match-notice';
import { OrdersTable } from '../../components/orders/orders-table';
import { OrderBossToggle } from '../../components/orders/order-boss-toggle';
import { CostEditProvider, CostUnsavedBar, CostsBulkDialog } from '../../components/orders/item-costs-cells';
import { isActiveManager } from '../../lib/staff';
import { loadOrderItemCostCells, type OrderItemCostCells } from '../../lib/orders/order-item-boss-cells';
import { COST_CURRENCY_CODES } from '../../lib/orders/item-costs-view';
import { TruncationReveal } from '../../components/orders/truncation-reveal';
import { OrderExportButton } from '../../components/orders/order-export-button';
import { orderExportBlockedReason } from '../../lib/orders/order-export';
import {
  buildOrderPageCsv,
  orderPageExportFilename,
} from '../../lib/orders/order-export-page';
import { OrderToolbar } from '../../components/orders/order-toolbar';
import { OrdersStickyOffset } from '../../components/orders/orders-sticky-offset';
import { countOrderList, type OrderListCount } from '../../lib/orders/order-list-count';
import { STATUS_CHIPS, applyStatusChip } from '../../lib/orders/order-toolbar-view';
import {
  ShippingSelectionProvider,
  BatchActionBar,
} from '../../components/orders/shipping-selection';
import { ORDER_NEW_PARAM } from '../../lib/orders/manual-order-action-state';
import { ResultBanner } from '../../components/orders/result-banner';
import { ListPagination } from '../../components/shared/list-pagination';

// M-4a 後台訂單列表(server component、篩選 + server 端分頁)。
// A9w2:原本的主狀態軸 `workflow_status` 已隨九碼退場下架 ⇒ 篩選 = 付款/出貨(單選)+
// 來源/管道(多勾選)+ 單號搜尋(flag)。
// A11a-1(2026-08-06):列表的九碼 cell 與整單彙總 badge 已下架 ⇒ 本頁不再讀狀態詞彙。
// 讀 searchParams → 動態渲染;force-dynamic 確保不被靜態預渲染(避免 build 期執行 DB 查詢)。
export const dynamic = 'force-dynamic';

// 🔴🔴 **#350c 把退款 action 的計時 segment 換到了這一頁**(本片唯一碰到錢的地方)。
//    面板改成 searchParams 驅動之後,退款表單是在 **`/orders?panel=<id>`** 這個 URL 上送出的
//    ⇒ 那個 POST 吃的是**本 segment** 的函式時限,不再只有 `/orders/[id]`。
//    為什麼這個數字承重(理由全文在 `app/orders/[id]/page.tsx:16-38`,此處不複述):
//    adapter 的 refund fetch 有 30s 硬逾時,平台時限一旦低於它,慢回應會被砍在 fetch 中途
//    = **錢可能已動、帳本停在 processing**,而那條路徑明文「不得自動重發」。
//    ⚠️ 本頁原本**沒有** `maxDuration`(= 吃平台預設)⇒ 不補這一行就是把退款丟回預設值。
//    `app/@panel/orders/page.tsx` 宣告同一個數字;三處(含 `orders/[id]`)由
//    `order-panel-wiring.test.ts` 釘在一起,改一處會紅。
export const maxDuration = 60;

/**
 * 🔴 **「刷卡未付款單被藏起來」的提示文案**(#347-B;Sean Q-347-B1=B 拍板字面)。
 *
 * 為什麼需要它:兩個專用搜尋欄退場之後,「打單號自動豁免隱藏規則」那條路
 * (D-385-A 的「豁免綁精準鍵」)**沒有實作了** —— 拍板同時要求「查無時提示」來承接,
 * 而這句話就是那個承接體。沒有它,客服用單號查一張刷卡未付款的單會得到
 * 「共 0 筆 / 目前沒有符合條件的訂單」,也就是 Q1=A 明文要禁的「默默降級」。
 *
 * 🔴 **逐字引用畫面上真的看得到的那個勾**(操作直覺化準則:寫怎麼做、不寫內部語彙)——
 * 括號裡那串必須與 `order-filter-controls.tsx` 的 label 一致,改一邊要改兩邊。
 */
/**
 * 🔴 `#841`(2026-08-23)把「不顯示」改成「**會藏起一部分**」—— 一個字的差別,而它是必要的。
 *
 * `SupabaseOrderAdapter.ts:890-892` 逐字要求:「**改動本條件式的人必須連那句提示一起看**:
 * 這裡多藏一種情況,那邊就少講一種情況。」本片是**反方向** —— 隱藏面收窄成真子集:
 * ```
 * 舊  隱藏 ⟺ tappay ∧ unpaid                      ⇒「不顯示刷卡未付款的訂單」為真
 * 新  隱藏 ⟺ tappay ∧ unpaid ∧(帳本淨額 = 0 ∨ 已取消)
 *     ⇒ **有收到錢而且沒取消的刷卡未付款單,現在看得見** ⇒ 舊那句話變成過寬
 * ```
 * ⚠️ **刻意不寫精確條件**(「還沒收到錢的」蓋不到「已取消但收過錢」那一種,寫全了會變成一長串)。
 *    這句話出現的時機是「關鍵字查到 0 筆」,它的任務是**指路到那個勾**,不是解釋規則
 *    ⇒ 對員工而言,**含糊但為真**勝過**精確但有一種情況說錯**。
 * ⚠️ **文案待 Sean 定稿**(結構鎖、字不鎖)。括號裡那串仍必須與 `order-filter-controls.tsx`
 *    的 label 逐字一致 —— 本次**沒有動它**。
 */
// 🔴 Sean 2026-09-14 逐字「這句話也依樣太囉唆」⇒ 一行、不要破折號、不要第二句(同批 `BROWSE_EMPTY_HINT`)。
//    「找不到單」四字與 chip label「含刷卡未付款」是 page.test 釘的兩個錨,留著。
const UNPAID_CARD_HIDDEN_HINT = '找不到單?刷卡未付款的單預設不列,按「含刷卡未付款」再查一次。';

/**
 * 🔴 `#841` 乙-2(2026-08-22,線 A `-86`;主視窗裁 Q=乙-2)。
 *
 * **為什麼要有第二句,而不是把上面那句放寬**:
 * 上面那句的三個條件裡有一個是 `keyword`,逐字理由是「瀏覽列表時它是噪音」。
 * 🔴 **而那個理由只在【有結果】時成立 —— 0 筆的時候它不是噪音,它是畫面上唯一的解釋。**
 * 當天的病:員工照唯一一條人工出路走完(客人刷卡失敗 → 改匯款 → 他登錄收款),
 * 那張單仍然符合隱藏規則(`#841`)⇒ 他之後用任何篩選都可能撈到 0 筆,而沒有一個字告訴他為什麼。
 *
 * 🔴🔴 **而它【不可以】說「因為被隱藏了」** —— 那是一句我們證明不了的話:
 * 0 筆的真正原因可能是別的篩選軸(本檔下面那段「已知的不精確 ①」就是這件事)。
 * ⇒ 所以第三句**必須在**:「勾了還是沒有 ⇒ 那就是其他篩選條件」。
 *    **它擋住的是「以為勾了就一定找得到」,而那正是這句話最容易造成的誤解。**
 *
 * ⚠️ **刻意不重複「沒有符合的訂單」** —— `orders-table.tsx` 已經印了「目前沒有符合條件的訂單。」
 *    同一個畫面講兩次會讓人以為是兩件事。
 * 🔴 **這句話裡刻意【沒有】「找不到單」四個字** —— 那是上面那句的字面,而
 *    `page.test.tsx` 的「負向③」釘著「瀏覽 + 0 筆 ⇒ 不得出現【找不到單】」。
 *    **那條守門一個字都沒動,而它釘的東西仍然成立。**
 *    ⇒ 誰日後要改這句話,**先確認沒有把那四個字帶進來** —— 帶進來會讓負向③ 紅,
 *      而**那不是它壞了,是你撞到它**。
 */
// 🔴 Sean 2026-09-14 逐字「這句話也依樣太囉唆」⇒ 縮成主視窗給的這一句(不要破折號、不要第二句)。
//    上面 docstring 講的「第三句必須在」被這個拍板蓋掉:畫面上不要有需要讀說明才懂的字。
const BROWSE_EMPTY_HINT = '刷卡未付款的單預設不列,按「含刷卡未付款」才會出現。';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  // ⛔ 拆面板(2026-09-13):舊書籤 `?panel=<id>` ⇒ `?open=<id>`、`?panel=new` ⇒ `?new=1`(不是 404)。
  //    放在**最前面**:下面每一支都只認 `open` / `new`, 讓它們看到 `panel` 等於看到一個死鍵。
  const legacyHref = legacyPanelRedirectHref(rawSearchParams);
  if (legacyHref !== null) redirect(legacyHref);
  // #347-B(Q-347-B1=B):`ADMIN_E10_ORDER_NUMBER_SEARCH` / `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH`
  //    兩個逐批啟用閘連同它們的搜尋欄一起退場 —— 兩者的能力併入關鍵字搜尋
  //    (`admin_search_orders` 的 #1 訂單編號 / #12 舊訂單編號 / #11 供應商單號分支)。
  const now = new Date();
  const {
    filter: parsedFilter,
    page,
    // L3 片4:密度是**顯示設定**、不是篩選 ⇒ 與 filter 分開拿,也不進 repository。
    display: urlDisplay,
    datePresetOptions,
    selectedDatePresetKey,
  } = parseOrderListSearchParams(rawSearchParams, {
    // 🔴🔴 #347-3c-2:**給 `now` = 開啟「未選預設近半年」**(Sean Q14=A)。
    //    這一行是這一軸唯一「會藏掉舊單」的地方,所以它明著寫在頁層、不藏在 lib 的預設參數裡。
    //    可見性由 `selectedDatePresetKey` 保證:篩選列會把「近半年」顯示成**選中**,員工改得動。
    //    ⚠️ **不要宣稱「網址列會顯示日期」**(R1 important 4 更正):打開裸 `/orders` 時
    //    沒有任何東西改寫網址列,日期只在按連結 / 翻頁之後才進 URL
    //    ⇒ 首次載入的可見性**完全由那格下拉承擔**。
    //    ⚠️ 頁層 `force-dynamic`,每次請求重算;逃生口 = ~~下拉的「自訂」~~ 工具列月份切換的中間那顆(回近半年)。
    //    🔵 2026-09-13 晚:同一個 `now` 也給工具列(月份切換的中心 / chip 計數的日期寫死)—— 兩邊一個時鐘。
    now,
  });
  // 🔴 **#347-2b:關鍵字這一軸不在 URL、在 httpOnly cookie**(Q-a=B 紅線:搜尋詞是 PII)。
  //    它與其他七軸的來源不同,但**下游一視同仁** —— 合進同一個 `filter` 之後,
  //    分頁 / 篩選 / 查詢全部照原路走,`buildOrderListHref` 一個字都不用改。
  //    讀取 fail-closed(壞值/超長 ⇒ 當沒搜尋),理由與三道閘見 `order-keyword-cookie.ts`。
  const keyword = readOrderKeywordCookie((await cookies()).get(ORDER_KEYWORD_COOKIE)?.value);
  /* 🔴 Q4 甲(Sean 2026-09-14):**裸 `/orders`** 進站預設亮「未完成」(稿的預設)。
     🔴 不動 parser 的預設值:parser 加預設 = 「全部」變成不可表達,而且會蓋掉首頁卡 / 側欄 / chip 帶參數進來的連結
        (它們全走 `frozenListHref`,一律帶 date_from/date_to ⇒ 非空 ⇒ 不被這一行碰到)。
     🔴 副作用明寫:母體從「全部」變 goods_axis in (none, ordered, instock),adapter 那段連帶 `cancelled_at IS NULL`
        + `payment_status <> 'refunded'` ⇒ **進站預設看不到已取消 / 已退款**;按「只看:全部」或任一 chip 之後,
        `buildOrderListHref` 會把狀態鍵寫進網址,之後的每一步都是明的。 */
  const urlFilter: AdminOrderFilter =
    Object.keys(rawSearchParams).length === 0 ? applyStatusChip(parsedFilter, STATUS_CHIPS[0]!) : parsedFilter;
  const filter: AdminOrderFilter = keyword === null ? urlFilter : { ...urlFilter, keyword };
  /* 🆕 A1(2026-09-14, plan `2026-09-14-order-item-cost-columns-plan.md` §1-d):「老闆:成本」的 server 閘。
     🔴 **`?boss=1` 在 URL 上不等於看得到成本**:每一發都用 `isActiveManager`(fail-closed:查不到 / DB 錯 / 非 manager
        一律 false)重閘;非管理者 ⇒ `display.boss` 改回 false ⇒ **參數忽略、勾不渲染、成本查詢不發、連結不帶 `boss`**。
     ⚠️ 代價登記:每次列表多一次 staff 查核(勾要不要出現得先知道他是不是 manager)。`isActiveManager` 自己的
        docstring 記著同一筆帳(Sean 08-28 Q15 甲 選擇不省這一趟)。
     🔴 **身分只認【簽章票】**(codex R1 MF1):`getSessionActor()` 在 `ADMIN_REQUIRE_REAL_IDENTITY` 沒開 + 舊 v1 票時
        會退到 `pcm_admin_actor` 自選 cookie —— 那是使用者自己填的、沒驗證 ⇒ 填一個 manager 的 id 就能開成本。
        成本是最不該靠自選身分放行的東西 ⇒ `source !== 'ticket'` 一律當非管理者(勾不出現、查詢不發)。 */
  const who = await getSessionActorIdWithSource();
  const canBoss = who.source === 'ticket' && (await isActiveManager(who.id));
  const display = { ...urlDisplay, boss: urlDisplay.boss && canBoss };
  const resultCode = typeof rawSearchParams.r === 'string' ? rawSearchParams.r : undefined;
  // ⛔ 2026-09-13 拆面板:`r` 歸誰原本用 `panel` 的有無判定(#350d C2, 讀 `readOpenPanelOrderId` /
  //    `isManualOrderPanel` 那兩支)。面板沒了 ⇒ 那兩支連同 `panelOpen` 一起刪;`r` 的歸屬只剩
  //    「就地展開的明細自己畫 / 列表畫」一條線(下面 `expanded === null`)。
  /* 🆕🆕 **P-b(2026-09-13):訂單明細【就地展開】,右側面板退場(停用不拆殼)。**
     Sean 逐字:「那切掉原因是因為左邊側欄還用原本…右邊訂單明細也還在關係,新版就沒這問題」。

     做法只有兩步,而**兩步都不碰殼**:
       ① 列表產的連結改寫 `?open=<id>`、不再寫 `?panel=`(`buildOrderListHref`)
          ⇒ `@panel` 槽沒內容 ⇒ `globals.css` 的 `:has()` 把面板收掉 ⇒ **表格拿回 868px**
          (真瀏覽器實測 1596 ↔ 728,含「槽有東西就不收」的負對照)。
       ② 這裡讀 `open`、用 `OrderInlineHead`(編輯模式標題列,2026-09-14)渲染,插在那張單第一列上方。
     ⛔ ~~**`panel` 那條路【還在】**:`@panel/orders/page.tsx` 一個字沒動~~ —— **2026-09-13 拆了**
        (Sean 拍「4 也做」):槽頁 / 客人卡 / 手動建單面板一起走, 舊書籤靠上面 `legacyPanelRedirectHref` 導過來。
     🔴 `r` 的歸屬:就地展開的標題列自己會畫它的結果橫幅(`OrderInlineHead` 內建),列表那條靠下面的
        `expanded === null` 停畫 —— 否則同一個結果會印兩次(契約 §2 硬條件 2 的同型)。 */
  const openOrderId = readOpenOrderId(rawSearchParams);
  const offset = (page - 1) * ORDERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯 / migration 未 apply)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識,不把 DB error 原文冒到瀏覽器(避免洩漏)。
  //    🔴 **A11a-1(2026-08-06)**:狀態詞彙(`order_status_options`)那一路**整條移除** ——
  //    它在本頁的唯一用途是餵列表的九碼 cell 與整單彙總 badge,兩者已隨本片下架
  //    ⇒ 原本的「訂單與詞彙分開容錯」雙腿 `Promise.allSettled` 收斂成單一 try/catch。
  //    讀取鏈本體(port / adapter / repository getter)的處置見 plan §3.1 裁定:歸 A9w4c 後半。
  let result: AdminOrderListResult | null = null;
  let loadFailed = false;
  // 🔴 搜尋層的**明示訊息**(Sean 2026-08-07 Q1=A:不默默降級)。
  //    與 `loadFailed` 分開:這些是「使用者可以自己處理」的狀況(改個輸入就好),
  //    混進通用錯誤態會讓人以為系統壞了。
  // ⚠️ #347-B:本頁原本還有「供應商單號命中過多 ⇒ 明示訊息 + 不渲染筆數與空表」那條分流
  //    (`SupplierOrderNoSearchTooManyError` / `searchBlocked`)。供應商兩段式查詢已退場
  //    ⇒ 那個例外**沒有 producer 了**,連同它的旗標一起收掉,不留恆假分支。
  //    現在唯一的搜尋層訊息是下方的「刷卡未付款被藏起來」提示,它是**算出來的**、不靠例外。
  // 🔴 六顆 chip 的計數與列表**同一個 repo、同時發**(`countOrderList` 自己接住失敗回 `count: null`,
  //    不讓一顆 chip 的失敗拖倒列表;列表失敗也不拖倒 chip)。數字 = 按那顆進去的「共 N 筆」,由構造保證。
  //    ⚠️ 計數用 `urlFilter` 不用 `filter`:cookie 裡的關鍵字由 `countOrderList` 自己合進去(同一顆 cookie),
  //       這裡再合一次會變成 `keyword` 進網址(它是 PII,`buildOrderListHref` 刻意不帶它)。
  let chipCounts: (OrderListCount | null)[] = STATUS_CHIPS.map(() => null);
  try {
    // repo 建構(env 缺 requireEnv)是**同步 throw** ⇒ 必須在 try 內建構,不能先建構再 await。
    const repo = getAdminOrderRepository();
    const [listResult, counts] = await Promise.all([
      repo.listOrderSummariesForAdmin(filter, { limit: ORDERS_PAGE_SIZE, offset }).then(
        (r) => ({ ok: true as const, r }),
        (e: unknown) => ({ ok: false as const, e }),
      ),
      Promise.all(
        STATUS_CHIPS.map((chip) => countOrderList(applyStatusChip(urlFilter, chip), now, repo, chip.label)),
      ),
    ]);
    chipCounts = counts;
    if (listResult.ok) result = listResult.r;
    else throw listResult.e;
  } catch (e) {
    console.error('[admin/orders] 訂單列表載入失敗', e);
    loadFailed = true;
  }

  const orders = result?.items ?? [];
  /* 🆕 A1:成本第二發**只在老闆模式**(= manager 且 `?boss=1`)才發;`null` = 一般模式(表格不畫六欄)。
     🔴 讀失敗 ⇒ `'unreadable'`(六格印「讀不到」),**不讓整頁 500** —— 列表本體已經讀到了, 成本讀不到不該把它拖下水。 */
  let costCells: OrderItemCostCells | null = null;
  if (display.boss) {
    try {
      costCells = await loadOrderItemCostCells(orders);
    } catch (e) {
      console.error('[admin/orders] 成本欄載入失敗', e);
      costCells = 'unreadable';
    }
  }

  /* 🆕🆕 **P-d(2026-09-13,主視窗裁甲):`?open=` 指到的單【不在這一頁】時要說一句。**
     🔴 **先判「在不在 `orders[]`」,再決定要不要撈明細** —— 這一步是承重的,不是省一發查詢那麼簡單:
        · 在 ⇒ `await OrderInlineHead`,插在那張單第一列上方(P-b;2026-09-14 前是整頁 `OrderDetailRoute` 塞在列底下)
        · 不在 ⇒ **不撈明細**(撈了也沒有地方塞;舊版就是這樣白撈一發、然後靜靜地什麼都不畫),
          改問「這張單存不存在」⇒ 存在 = 被篩選 / 分頁藏起來(藍提示 + 清除篩選並打開);
          不存在 = 紅提示。**兩句是兩件事,不合併。**
     🔴 用【身分】(`o.id`)判在不在,**不用它現在的樣子**(例如連結字面)——
        展開中的那一列它自己的連結是收合連結(不帶 open),用連結判會誤判成「不在」。
        （2026-09-13 真瀏覽器量測時我自己踩過:尺剛好在你要量的那一格上騙你。）
     ⚠️ 對「篩選把全部濾掉」與「濾掉一部分」是同一個修法 —— 兩種都落在「不在 `orders[]`」。 */
  const openInList = openOrderId !== null && orders.some((o) => o.id === openOrderId);
  /* 🆕🆕 **P-e-1:`?next=<id>&do=<動作>` ⇒ 渲染「下一步」彈窗【殼】。**
     🔴 它打開的是【表單】不是動作(plan §0):殼裡零 action、零寫入,貼這條網址不會寫進任何東西。
     🔴 讀法與 `open` 同款:`next` 非 UUID ⇒ 當沒帶;`do` 不在三值白名單 ⇒ 當沒帶(不開一個不知道要幹嘛的彈窗)。
     🔴🔴 **彈窗的生命週期【不綁】「那張單在不在這一頁」**(codex R2 must-fix ①,2026-09-13;推翻 P-e-1 第一版
        「必須在這一頁才開」):表單送出、RPC 已 commit、回應斷在路上 ⇒ action 的失敗路徑會 revalidate 列表,
        而那張單**可能因此離開篩選**(例:篩「未付款」、收完款變已付;篩「已下訂」、登完到貨變已到貨)。
        綁列表成員資格的話,這一刻整個彈窗**卸載** —— 錯誤訊息、剛讀回的清單、表單手上那把冪等鍵一起消失,
        員工再開就是新鍵 ⇒ **寫兩筆**。⇒ 只驗「是 UUID」;單存不存在由 body 自己讀(讀不到印讀不到,不開空表單)。
        📌 這與 `open`(P-d)不同:`open` 展開的是列表裡的一列,沒那一列就沒地方展開;彈窗是浮在列表上的,不靠那一列。 */
  /* 🆕 B9 批次列(2026-09-14):`next` 可以是**多個** uuid(逗號)⇒ 多單版彈窗,一單一份表單;`items=` 只列勾到的那幾樣。
     🔴 `ship` 只認一張單(稿:跨單不能一起裝箱)⇒ 多單 + ship 當沒帶。超過 `NEXT_MULTI_MAX` 張也當沒帶。 */
  const nextOrderIds = parseUuidList(rawSearchParams[ORDER_NEXT_PARAM], NEXT_MULTI_MAX);
  // 🔴 `items`「沒帶」與「帶了但壞」是兩個世界:前者 = 整張單(列上那顆鈕);後者**不開**(codex R1 must-fix ③:
  //    `items=i1,nope` 若當沒帶,會把勾一樣放寬成整張單的表單)。
  const itemsRaw = rawSearchParams[ORDER_NEXT_ITEMS_PARAM];
  const nextItemIds = itemsRaw === undefined ? [] : parseUuidList(itemsRaw, NEXT_MULTI_MAX * 20);
  /* 🆕 A2-b:`?costs_items=` ⇒ 批次改成本彈窗(只在老闆模式且成本讀得到;只認這一頁列表裡的品項 —— 別頁的 id 不撈不開)。 */
  const costsItemsRaw = rawSearchParams[ORDER_COSTS_ITEMS_PARAM];
  const costsItemIds = (costsItemsRaw === undefined ? null : parseUuidList(costsItemsRaw, COSTS_ITEMS_MAX)) ?? [];
  const doRaw = rawSearchParams[ORDER_NEXT_DO_PARAM];
  const nextDo: NextStepDo | null =
    typeof doRaw === 'string' && (NEXT_STEP_DO_VALUES as readonly string[]).includes(doRaw)
      ? (doRaw as NextStepDo)
      : null;
  const nextStep =
    nextOrderIds !== null && nextItemIds !== null && nextDo !== null && !(nextDo === 'ship' && nextOrderIds.length > 1)
      ? { orderIds: nextOrderIds, orderId: nextOrderIds[0]!, itemIds: nextItemIds, do: nextDo }
      : null;
  /* 🆕 **收款欄可點(2026-09-13,Sean 答甲)**:`?pay=<id>` ⇒ 「新增收款」彈窗。讀法與 `next` 同款:
     非 UUID 當沒帶;**不綁列表成員資格**(理由同上 must-fix ①,收款正是那個「寫兩筆」最貴的地方)。
     **只開表單不寫入** —— 寫入在按「確認」那一刻,走明細頁同一支 `recordManualPaymentAction`。 */
  const payRaw = rawSearchParams[ORDER_PAY_PARAM];
  const payOrderId = typeof payRaw === 'string' && isUuid(payRaw) ? payRaw.toLowerCase() : null;
  /* 🔴 codex must-fix ②(收款欄可點):進彈窗的連結要**保留當下的 open** —— 用 `PANEL_CLOSED` 會讓
     「在展開明細的列表上點收款」一按就把明細收掉,取消回來也是收合的。`next` 那條同款(同一次修)。 */
  const buildPayHref = (orderId: string) => {
    const base = buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED);
    return `${base}${base.includes('?') ? '&' : '?'}${ORDER_PAY_PARAM}=${orderId}`;
  };
  /* 🏁 **P-e-3(2026-09-13):接線完成。** 三支 body 走**明細頁同一份表單元件的預設 action**
     (下訂 `upsertItemProcurementAction` / 到貨 `recordItemReceiptAction` / 出貨 `submitShipment`),
     stub 已刪檔;`next-step-bodies.test.ts` 反向守著「body 不准自己再指一次 action」——
     兩處各指一次,哪天明細頁換 action、列表沒跟上,就是「從彈窗送出與從明細送出進不同支」那個破口。

     🔴 `returnTo` = closeHref(列表自己、不帶 next/do、保留 open)—— 動作做完回這裡。
     🔴 前兩支是 async server component ⇒ **`await` 它、不當 JSX 子元素**(同 `OrderDetailRoute` 的理由:
        沒 await 的話測試 render 出空字串且不報錯)。
     🔴🔴 **出貨那支【不包殼】,而那不是漏包**(設計窗對檔 2026-09-13):
        `NextStepShipmentBody` 是 `'use client'`、走既有 `useShipmentLauncher`
        ⇒ 渲染出來的 `ShipmentDialog` **自己就是整片 `fixed inset-0 z-50` 遮罩 + `role='dialog'`**。
        塞進 `showModal()` 的 `<dialog>` 裡 ⇒ top layer 會把它蓋住,員工看到一個空殼。
        關掉 / 做完它自己 `router.replace(returnTo)`(launcher 的 `onClose` 鉤子)。
        📌 **三顆鈕、兩種容器,而那是既有元件的形狀決定的,不是設計上要有兩種。** */
  /* 🔴 codex must-fix ③:`?open=B&pay=A` 兩張都在本頁時,收的是 A、回去卻展開 B ⇒ A 的 `r=` 橫幅掛到 B 的明細上。
     ⇒ **returnTo 一律展開【真的動作的那張】**(`open=<payOrderId>`),結果歸屬跟著錢走;
        closeHref(取消)則**保留原本的 open** —— 取消不該改變他正在看什麼。`next` 那條同款。 */
  const payUi = await (async () => {
    if (payOrderId === null) return null;
    /* 應收總額:在這一頁就從 `orders[]` 拿;不在(篩選剛好擋住 / 送出後離開篩選)才走 `findAdminOrderDetail`
       —— 同 P-d 那條邊緣路的取捨(撈整張明細比要的重,而這條路一天走不了幾次)。查無 ⇒ 不開(沒有單就沒有錢可收)。 */
    const listedPayOrder = orders.find((o) => o.id === payOrderId);
    let amountDue: number | null = listedPayOrder ? orderAmountDue(listedPayOrder) : null;
    // 🔴🔴 **[R1 M1,2026-09-16]** `amountDue === null` 現在有【兩個】意思:
    //    「這一刻讀不到」與「系統算不出這張單取消後還該收多少」(Sean 拍乙)。
    //    合著用會讓彈窗對後者說「讀取失敗,請重新整理」—— 而**重整幾次都不會變**,
    //    那正是這一片要消滅的那句話,原封不動留在這個入口。⇒ 第三態要自己帶著走。
    let amountUncomputable = listedPayOrder ? listedPayOrder.amountDue === null : false;
    // 🔵 而「算不出來」不必再補查一次明細 —— 補查那條路是給【不在這一頁】的單用的(見上面那段)。
    if (amountDue === null && !amountUncomputable) {
      try {
        const d = await getAdminOrderRepository().findAdminOrderDetail(payOrderId);
        if (d === null) return null; // 查無 = 單不存在(不是「離開篩選」)⇒ 不開
        amountDue = orderAmountDue(d);
        amountUncomputable = d.amountDue === null;
      } catch (e) {
        /* 🔴 codex R3 must-fix ①:補查 **throw** 時不能收窗 —— 這正是「已入帳、回應斷了、DB 這一刻讀不到」那個時刻,
           收窗 = 表單卸載 = 舊冪等鍵沒了。⇒ 照開,`amountDue=null` 交給 body 鎖送出(彙總印「未知」)。 */
        console.error('[admin/orders] pay= 補查應收失敗', e);
      }
    }
    return (
      <NextStepDialog
        // B17:稿標題「新增收款 · 單號 · 買主」(單在這一頁才有得印;補查那條路只印「新增收款」)、殼 wide 800。
        title={(() => {
          const o = orders.find((x) => x.id === payOrderId);
          return o ? `新增收款 · ${o.displayId}${o.customerName ? ` · ${o.customerName}` : ''}` : '新增收款';
        })()}
        wide
        closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
        inlineCancel
      >
        {await NextStepPayBody({
          orderId: payOrderId,
          returnTo: buildOrderListHref(filter, display, page, payOrderId),
          amountDue,
          amountUncomputable,
        })}
      </NextStepDialog>
    );
  })();
  /* 🆕 **v22 展開標題列 ①:`?cancel=<id>` ⇒ 「退款 / 取消」彈窗**(2026-09-13, 主視窗派工)。
     讀法與 `pay` 同款:非 UUID 當沒帶、不綁列表成員資格(取消 / 退款正是那種「不能因為篩選擋住就做不到」的動作)。
     內容 = `OrderDetailRoute({ section: 'money' })`:明細頁「收款 · 退款」分頁裡取消 + 退款那幾段【原封】搬進殼裡,
     loader 同一份、action 同一支、零新寫入路。收款那段不印(它有自己的 `?pay=`)。
     🔴 returnTo 一律展開【真的動作的那張】(`open=<cancelOrderId>`), closeHref 保留原本的 open(同 `pay` 那條 must-fix ③)。
     🔴 `r` / `rt`(取消結果碼與 token)由 action 帶到 returnTo 上 ⇒ 落在展開明細的 CancelResultPanel, 不在彈窗裡。 */
  const cancelRaw = rawSearchParams[ORDER_CANCEL_PARAM];
  const cancelOrderId = typeof cancelRaw === 'string' && isUuid(cancelRaw) ? cancelRaw.toLowerCase() : null;
  const cancelUi =
    cancelOrderId === null ? null : (
      <NextStepDialog
        title='退款 / 取消'
        closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
      >
        {await OrderDetailRoute({
          id: cancelOrderId,
          section: 'money',
          // 🔴 刻意 undefined:彈窗是新開的表單;取消 action 導回的網址不帶 cancel= ⇒ 結果面板永遠不在彈窗裡,
          //    而在展開明細 / 列表那層(`openCancelResult`)。手打混帶 r= 的網址在這裡會被忽略 —— 那不是一條會發生的路。
          resultCode: undefined,
          requestToken: null,
          correctNoteId: null,
          back: { href: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED), label: '收合' },
          returnTo: buildOrderListHref(filter, display, page, cancelOrderId),
          missing: 'inline',
        })}
      </NextStepDialog>
    );
  /* 🆕 **v22 展開標題列 ②:`?note=<id>` ⇒ 「備註與客人聯繫」彈窗**(同 cancel 那條路)。
     內容 = `OrderDetailRoute({ section: 'notes' })`:備註時間軸 + 新備註表單 + 取消通知兩顆鈕, 同一份 loader / action。
     `?correct=<noteId>` 一起帶進去 ⇒ 彈窗裡直接是更正模式(更正連結本身導去整頁 `/orders/<id>?correct=`, 那是既有行為)。 */
  const noteRaw = rawSearchParams[ORDER_NOTE_PARAM];
  const noteOrderId = typeof noteRaw === 'string' && isUuid(noteRaw) ? noteRaw.toLowerCase() : null;
  const noteUi =
    noteOrderId === null ? null : (
      <NextStepDialog
        title='備註與客人聯繫'
        closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
      >
        {await OrderDetailRoute({
          id: noteOrderId,
          section: 'notes',
          resultCode: undefined,
          requestToken: null,
          correctNoteId:
            typeof rawSearchParams.correct === 'string' && isUuid(rawSearchParams.correct) ? rawSearchParams.correct : null,
          back: { href: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED), label: '收合' },
          returnTo: buildOrderListHref(filter, display, page, noteOrderId),
          missing: 'inline',
        })}
      </NextStepDialog>
    );
  /* 🆕 **v22 展開標題列 ③:`?edit=<id>` ⇒ 「編輯個資」彈窗**(同 cancel / note 那條路)。
     內容 = `OrderDetailRoute({ section: 'customer' })`:明細頁那張改單表單(出貨方式 + 發票四格)+ 發票小抄入口。 */
  const editRaw = rawSearchParams[ORDER_EDIT_PARAM];
  const editOrderId = typeof editRaw === 'string' && isUuid(editRaw) ? editRaw.toLowerCase() : null;
  const editUi =
    editOrderId === null ? null : (
      <NextStepDialog
        title='編輯個資'
        closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
      >
        {await OrderDetailRoute({
          id: editOrderId,
          section: 'customer',
          resultCode: undefined,
          requestToken: null,
          correctNoteId: null,
          back: { href: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED), label: '收合' },
          returnTo: buildOrderListHref(filter, display, page, editOrderId),
          missing: 'inline',
        })}
      </NextStepDialog>
    );
  /* 🆕 **v22 展開標題列 ④:`?more=<id>` ⇒ 「更多」彈窗**(列印兩顆 · 改品項金額 · 通知信;同 cancel / note / edit 那條路)。 */
  const moreRaw = rawSearchParams[ORDER_MORE_PARAM];
  const moreOrderId = typeof moreRaw === 'string' && isUuid(moreRaw) ? moreRaw.toLowerCase() : null;
  /* 🔴 `wide`(800)是照稿 v22 第 779 行的規則搬的:`m.classList.toggle('wide', /class="mt"|class="sec"/.test(f))`
     —— 稿說「body 有 `.mt` 表格就撐到 800」,而「更多」body 有兩張(改品項金額 / 通知信)⇒ 它本來就該是 wide。
     ⚠️ 520 的後果 Sean 2026-09-14 在正式站看到:長料號把廠牌 / 品名欄擠成一字一行的直排。 */
  const moreUi =
    moreOrderId === null ? null : (
      <NextStepDialog title='更多' wide closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}>
        {await OrderDetailRoute({
          id: moreOrderId,
          section: 'more',
          resultCode: undefined,
          requestToken: null,
          correctNoteId: null,
          back: { href: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED), label: '收合' },
          returnTo: buildOrderListHref(filter, display, page, moreOrderId),
          missing: 'inline',
        })}
      </NextStepDialog>
    );
  /* 🆕 `?new=1` ⇒ 手動建單彈窗(Sean 2026-09-13「盡可能加速、多工也可以」⇒ 面板版之外多一個容器)。
     同 `next` / `invoice` 那一族:一次性、不進 buildOrderListHref、只開表單不寫入。
     🔴 內容是既有的 `ManualOrderView`(container='dialog'), **寫入那條路一個字沒動** —— 只換容器。 */
  const manualOrderDialogOpen = rawSearchParams[ORDER_NEW_PARAM] === '1';
  /* 🆕 `?invoice=<id>` ⇒ 發票小抄彈窗(同 `next` 那一族:一次性、不進 buildOrderListHref、只開表單)。
     ⛔ ~~只認這一頁列表裡有的單~~ ⇒ 走查 0914 第 8 條(主視窗裁):從搜尋 / 別頁進來的單也要開得了 ⇒ 照 id 撈, 與 `more` / `cancel`
     那一族同形;撈不到 ⇒ 彈窗自己印「找不到這張單」(`InvoiceCheatSheetDialog`), 不是靜靜沒反應。uuid 閘照舊。 */
  const invoiceRaw = rawSearchParams[ORDER_INVOICE_PARAM];
  const invoiceOrderId = typeof invoiceRaw === 'string' && isUuid(invoiceRaw) ? invoiceRaw.toLowerCase() : null;
  const nextStepUi = await (async () => {
    if (nextStep === null) return null;
    const closeHref = buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED);
    // 🔴 codex must-fix ③(同上):動作做完展開【真的動作的那張】,結果歸屬跟著單走。
    const multi = nextStep.orderIds.length > 1;
    /* B9-b(主視窗裁,Sean「一次做到完畢」):下訂 / 到貨彈窗 = **一張表單多列一次送**(`NextStepBatchForm`,
       action 回 state 不 redirect ⇒ 彈窗不卸載,`revalidatePath` 讓列表與彈窗用新資料重畫)。
       ⇒ `returnTo` 對這兩支只剩 revalidate 用途,給列表自己就好。
       出貨維持 P-e-3:一窗一箱、做完展開那一張(codex 09-13 must-fix ③)。 */
    const doneHref = nextStep.do === 'ship' ? buildOrderListHref(filter, display, page, nextStep.orderId) : closeHref;
    if (nextStep.do === 'ship') {
      // 🔴 codex R2 must-fix ②:出貨彈窗的「關掉」與「做完」走同一個鉤子 ⇒ 兩條落點都要給,由 body 依「有沒有建箱」挑。
      /* B13-b:稿「更多」六列(既有箱的動作)是 server component,這裡 `await` 好當 props 傳進 client 的出貨 body。 */
      return (
        <NextStepShipmentBody
          orderId={nextStep.orderId}
          closeHref={closeHref}
          doneHref={doneHref}
          moreRows={await ShipmentMoreRows({ orderId: nextStep.orderId })}
          {...(nextStep.itemIds.length > 0 ? { onlyItemIds: nextStep.itemIds } : {})}
        />
      );
    }
    const label =
      ORDER_NEXT_STEP_LABEL[
        (Object.keys(NEXT_STEP_DO) as (keyof typeof NEXT_STEP_DO)[]).find((k) => NEXT_STEP_DO[k] === nextStep.do)!
      ];
    // B9:批次列開的多單版 —— 標題「· N 樣一起」,到貨表多一欄單號(表頭只印一次)。單張單、列上那顆鈕開的維持原樣。
    const title = nextStep.itemIds.length > 1 ? `${label} · ${nextStep.itemIds.length} 樣一起` : label;
    const only = nextStep.itemIds.length > 0 ? nextStep.itemIds : undefined;
    const parts = await Promise.all(
      nextStep.orderIds.map((orderId) =>
        nextStep.do === 'order'
          ? loadNextStepProcurementParts({ orderId, returnTo: doneHref, onlyItemIds: only, withOrderNo: multi })
          : loadNextStepReceiptParts({ orderId, returnTo: doneHref, onlyItemIds: only, withOrderNo: multi, header: !multi }),
      ),
    );
    // B14:到貨登記照稿 800 寬(`wide`);跟供應商下訂 2026-09-14 也改 800(稿彈窗 7 `#modal.wide`,兩欄 + 作廢摺疊;主視窗派)。
    // B9-b:整個彈窗一張表單(多單也是同一張),一顆「確認全部」;列在 body 裡以 batch 模式渲染。
    // 🔴 作廢 / 撤銷那兩個摺疊(`folds`)放在批次 form **外面**:它們每筆自帶 form、各自送、各自冪等鍵,
    //    包進去 = 巢狀 form,瀏覽器會把內層拆掉(主視窗 2026-09-14 合體抓到)。
    return (
      <NextStepDialog title={title} closeHref={closeHref} wide>
        <NextStepBatchForm kind={nextStep.do}>
          {multi && nextStep.do === 'receipt' && <ReceiptTableHeader withOrderNo />}
          {parts.map((p, i) => (
            <div key={nextStep.orderIds[i]}>{p.rows}</div>
          ))}
        </NextStepBatchForm>
        {parts.map((p, i) => (
          <div key={nextStep.orderIds[i]}>{p.folds}</div>
        ))}
      </NextStepDialog>
    );
  })();
  /* 🆕 A2-b:批次改成本彈窗。品項的現值從這一發的 `costCells` 拿(留空 = 不動 ⇒ 送出時用現值補齊四格);
     沒設過的品項留空 = 0(表的 DEFAULT)。 */
  const costsBulkUi = (() => {
    if (!display.boss || costCells === null || costCells === 'unreadable' || costsItemIds.length === 0) return null;
    const lines = orders.flatMap((o) => o.lines.map((l) => ({ o, l }))).filter(({ l }) => costsItemIds.includes(l.id));
    if (lines.length === 0) return null;
    const closeHref = buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED);
    return (
      <CostsBulkDialog
        closeHref={closeHref}
        returnTo={closeHref}
        itemsJson={JSON.stringify(
          lines.map(({ o, l }) => {
            const c = costCells.get(l.id);
            return {
              orderItemId: l.id,
              orderDisplayId: o.displayId,
              itemTitle: l.title ?? l.variantSku ?? '',
              costPrice: c?.costPrice ?? '',
              costShipping: c?.costShipping ?? '',
              costTax: c?.costTax ?? '',
              currency: c?.currency ?? '',
            };
          }),
        )}
        currencies={COST_CURRENCY_CODES.join(',')}
      />
    );
  })();
  /* 「下一步」連結 = 當下篩選 + 頁碼(**不帶 open** —— 開彈窗不需要先展開那一列)+ next + do。
     🔴 `next` / `do` **刻意不進 `buildOrderListHref` 的窮舉鍵表**:它們是一次性的(關掉就沒了),
        翻頁 / chip 不該帶著它們走(帶著走 = 換頁還開著同一個彈窗)。同 `RESULT_ONLY_PARAMS` 那族的性質。 */
  const buildNextHref = (orderId: string, action: NextStepDo) => {
    const base = buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED);
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}${ORDER_NEXT_PARAM}=${orderId}&${ORDER_NEXT_DO_PARAM}=${action}`;
  };
  /* 🔴 `await` 它、不要當成 JSX 子元素(理由同 `@panel/orders/page.tsx` 與 `orders/[id]/page.tsx`:
     async server component 沒被 await 的話,測試 render 出空字串且不報錯)。
     ⚠️ `missing: 'inline'` 在這裡**幾乎走不到**(能進到這裡代表它剛剛還在列表裡),留著是防兩發查詢
        之間那張單被刪的競態 —— 那時印一句「找不到」比整頁 404 好。
     📌 稿 §3-e 的四種落空,**這條路只會遇到「不在這一頁」與「不存在」兩種** —— 「在別頁」「在別月」
        對 server 端撈單而言與「不在這一頁」是同一件事(都是不在 `orders[]`),不另立分支。 */
  const expanded =
    openOrderId === null || !openInList
      ? null
      : {
          orderId: openOrderId,
          /* 🆕 2026-09-14 展開 = 編輯模式標題列(設計窗,稿 v22 `tr.edithead`):換成 `OrderInlineHead`,**不再把整頁
             `OrderDetailRoute` 塞進列底下**(Sean 截圖「點開不是這樣吧」)。`OrderDetailRoute` 一個字不動,`/orders/[id]` 整頁還在用它。
             六顆鈕一律連到網址彈窗(已接上 pay / invoice;cancel / note / edit / more A 窗在做,`WIRED` 沒翻的先灰);
             零新寫入路;`r=` 的結果橫幅由標題列畫、列表那條照舊停畫。 */
          node: await OrderInlineHead({
            id: openOrderId,
            resultCode: rawSearchParams.r,
            requestToken: rawSearchParams[CANCEL_REQUEST_TOKEN_PARAM],
            tier:orders.find((o) => o.id === openOrderId)?.tierAtCheckout ?? null,
            links: (() => {
              const base = buildOrderListHref(filter, display, page, openOrderId);
              const withParam = (k: string) => `${base}${base.includes('?') ? '&' : '?'}${k}=${openOrderId}`;
              return {
                pay: buildPayHref(openOrderId),
                invoice: buildInvoiceHref(base, openOrderId),
                cancel: withParam('cancel'),
                note: withParam('note'),
                edit: withParam('edit'),
                more: withParam('more'),
              };
            })(),
          }),
        };
  /* 不在這一頁 ⇒ 只問「存不存在」。走既有的 `findAdminOrderDetail`(查無回 null),**只在這條邊緣路上跑**。
     ⚠️ 它撈的是整張明細、比「存在檢查」重 —— 而這條路一天走不了幾次(要同時滿足:有人貼網址 + 篩選剛好擋住),
        為它另開一支 port 方法是 YAGNI。哪天它變熱路徑再換。 */
  let openMissingOrHidden: { displayId: string | null; exists: boolean } | null = null;
  /* 🆕 取消結果面板的資料(只在「open 不在列表 + 網址帶取消結果碼」才撈 actor;detail 反正上面已經撈了)。
     🔴 讀失敗 ⇒ `cancellations: null` ⇒ 面板自己判 `unreadable`「查不到取消紀錄(讀取失敗)…先不要重送」—— fail-closed 方向對。 */
  let openCancelResult: {
    actor: string | null;
    cancellations: AdminOrderDetail['cancellations'] | null;
    cancellationsTruncated: boolean;
    cancelledAt: string | null;
    paymentStatus: AdminOrderDetail['paymentStatus'] | null;
  } | null = null;
  if (openOrderId !== null && !openInList) {
    const wantsCancelResult = isCancelPanelResultCode(resultCode);
    try {
      const d = await getAdminOrderRepository().findAdminOrderDetail(openOrderId);
      openMissingOrHidden = d === null ? { displayId: null, exists: false } : { displayId: d.displayId, exists: true };
      if (wantsCancelResult) {
        openCancelResult = {
          actor: (await getSessionActor())?.id ?? null,
          cancellations: d?.cancellations ?? null,
          cancellationsTruncated: d?.cancellationsTruncated ?? true,
          cancelledAt: d?.cancelledAt ?? null,
          paymentStatus: d?.paymentStatus ?? null,
        };
      }
    } catch (e) {
      // 讀不到就當「找不到」印 —— 不給一顆會把他導去空列表的「清除篩選並打開」。
      console.error('[admin/orders] open= 存在檢查失敗', e);
      openMissingOrHidden = { displayId: null, exists: false };
      if (wantsCancelResult) {
        openCancelResult = { actor: null, cancellations: null, cancellationsTruncated: true, cancelledAt: null, paymentStatus: null };
      }
    }
  }

  /* `#24` 片B:匯出用的三個字串【在 server 端這裡算好】,client 元件只負責存檔。
     🔴 **為什麼不把 `orders` 傳給 client 元件**(code-reviewer `I3`):那會讓整包
        `AdminOrderSummary[]` 跨進 client bundle ——今天不外洩(admin 頁),
        而 `AdminOrderSummary` 日後加成本 / 進貨價 / 經銷價任一欄,會**自動**進瀏覽器 payload,
        而那正是 `CLAUDE.md` Server 端鐵則點名的東西。⇒ 這樣做讓那條前向風險**結構上消失**。
     🔴 **`dataAsOf` 用的是這一次 render 的時刻**(code-reviewer `C2`):它與 `orders` 同時定版
        ⇒ 檔案上那個時間講的是【資料的時刻】,不是【按鈕被按的時刻】。 */
  const exportBlocked = orderExportBlockedReason(orders);
  /* 🔴 `filterNote` 這一版一律傳空字串, 而理由(一個恆為 false 的判斷)
     寫在 `order-export-page.ts` 的 `OrderExportContext.filterNote` 旁邊, 此處不複述。 */
  const exportNow = new Date();
  const exportCtx = {
    page,
    filterNote: '',
    dataAsOf: exportNow.toISOString().slice(0, 16).replace('T', ' '),
  };
  const exportProps = {
    csv: buildOrderPageCsv(orders, exportCtx),
    filename: orderPageExportFilename(exportNow, exportCtx),
    blockedReason: exportBlocked,
  };
  /**
   * 🔴 **查無時的「可能被藏起來了」提示**(Q-347-B1=B 拍板要求的承接體)。
   *
   * 三個條件缺一不可,理由各自不同:
   * - `keyword` —— 只有「員工在找特定一張單」時這句話才成立;瀏覽列表時它是噪音。
   * - `!includeUnpaidCardOrders` —— 勾已經打開就沒有東西被藏,再提示就是在說謊。
   * - `orders.length === 0` —— 有結果時員工不需要逃生口。
   *
   * ⚠️ **刻意不多打一次 count 去確認「真的有單被藏」**:那要為一句提示多掃一次全表,
   *    而措辭已經寫成條件式(「可能」)、不宣稱一定有。
   *
   * 🔴 **兩個已知的不精確,判斷後決定不修 —— 寫出來、不默默放過**(R1 m5/m6):
   * ① **不看其他篩選軸**:`?payment_status=paid` 之下 0 筆時這句照樣出現,而真正的原因
   *    可能是那個篩選。要修得把「哪一軸造成 0 筆」算出來 —— 那需要逐軸再查一次。
   *    ⇒ 判斷=**不修**。措辭是條件式的「可能」,而它指的逃生口(勾起來再查)成本極低、
   *    試一次就知道;為了措辭精確去多打 N 次 DB,代價與收益不成比例。
   * ② **可能與截斷提示同時出現**:`truncated=true` + 0 筆 + 隱藏生效時,畫面會有兩條琥珀
   *    橫幅各講一個原因。⇒ 判斷=**不合併**。兩者是**真的兩個原因**(結果太多 / 有單被藏),
   *    合併成一句會讓員工只處理其中一個;而這個組合在真實資料上罕見。
   *    ⚠️ 若日後回報「橫幅太吵」,正確修法是排序與收合,不是刪掉其中一條。
   */
  const searchNotice: string | null =
    !loadFailed && filter.keyword && !filter.includeUnpaidCardOrders && orders.length === 0
      ? UNPAID_CARD_HIDDEN_HINT
      : null;
  /**
   * 乙-2:**沒有在搜尋**、而清單是空的 ⇒ 講另一句(理由與限定見 `BROWSE_EMPTY_HINT` 的 docstring)。
   * 🔴 與上面那句**互斥**(一個要 `keyword`、一個要 `!keyword`)⇒ 兩條琥珀框不會同時出現。
   */
  const browseEmptyNotice: string | null =
    !loadFailed && !filter.keyword && !filter.includeUnpaidCardOrders && orders.length === 0
      ? BROWSE_EMPTY_HINT
      : null;
  // #338:命中的供應商 → 三態提示(語意在 lib,本檔只排版)。
  const supplierMatch = describeSupplierMatch(
    result?.supplierOrderNoMatchedSuppliers ?? null,
    orders.length > 0,
  );
  const total = result?.total ?? 0;

  return (
    <div className='space-y-4'>
      {/* 工具列(v22 稿三列:訂單 · 月份 · 狀態 chip 帶計數 · 搜尋 · 新增 / 摘要 / 只看)= `components/orders/order-toolbar.tsx`。
          🔴 抽成純元件的理由:版面正確性只有真瀏覽器量得到,而本檔是會抓資料的 async server component。
          🪦 舊的搜尋區塊 / 篩選卡 / 匯出鈕位置 2026-09-13 晚全部併進工具列(Sean:「整個頁面寬度、配置、字體都還沒到位」)。 */}
      {/* 🔴 凍結(Sean 2026-09-13 逐字「這邊以上全部凍結,我要捲動訂單時候保留上面的功能」):
          工具列整塊 sticky top-0、底色不透明、z-30(列上的 `relative z-10` 之上、彈窗 z-50 之下);
          表頭 `<thead>` 在 `orders-table.tsx` 也 sticky,`top` 吃本區量出來的高度(`OrdersStickyOffset`)。
          `-mx-6 px-6`:蓋滿內容區左右的 padding,列捲上來時邊緣不會露出來。 */}
      {/* ⚠️ `data-orders-sticky-head` 是字面不是常數:從 'use client' 模組 import 常數到 server component 會變成
          「client reference」、渲染時炸(2026-09-13 鑽機實測)。`orders-sticky-offset.tsx` 用同一個字面查它。 */}
      <div
        data-orders-sticky-head=''
        className='bg-background sticky top-0 z-30 -mx-6 -mt-6 px-6 pt-6 pb-2'
      >
        <OrdersStickyOffset />
      <OrderToolbar
        panelTarget={openOrderId ?? PANEL_CLOSED}
        filter={filter}
        display={display}
        total={loadFailed ? null : total}
        chipCounts={chipCounts}
        now={now}
        datePresetOptions={datePresetOptions}
        selectedDatePresetKey={selectedDatePresetKey}
        keyword={keyword}
        keywordMatchCount={result?.keywordMatchCount ?? null}
        keywordTruncated={result?.keywordTruncated ?? false}
        /* `#24` 片B:匯出吃的是同一個 `orders` 陣列(下面那張表渲染的那一份)⇒ 匯出 = 畫面上這一頁。
           列表讀失敗 ⇒ 不給(沒有東西可匯)。位置:只看列右端(稿沒有它,主視窗:「放搜尋框右邊小字或更多,你裁」)。 */
        exportSlot={loadFailed ? null : <OrderExportButton {...exportProps} />}
        /* 🆕 A1:「老闆:成本」勾 —— **只有 manager 的請求會 render**(上面 `canBoss`, 非管理者這格是 null)。
           連結翻轉 `display.boss`, 其餘篩選 / 頁碼 / 展開的單原樣帶著走(同一支 `buildOrderListHref`)。位置 = 稿 `label.boss`(＋ 新增左邊)。 */
        bossSlot={
          canBoss ? (
            <OrderBossToggle
              on={display.boss}
              href={buildOrderListHref(filter, { ...display, boss: !display.boss }, page, openOrderId ?? PANEL_CLOSED)}
            />
          ) : null
        }
      />
      </div>

      {expanded === null && <ResultBanner code={resultCode} />}


      {/* 🔴🔴 **截斷提示:`keywordTruncated=true` 時無條件顯示,包含 0 筆**
          (`packages/domain/src/order/types.ts:316-318` 逐字要求)。
          RPC 先取全域最新 100 筆命中,才與其他篩選取交集 ⇒ 真正要找的單可能整張落在那 100 筆之外,
          畫面因此可能顯示 0 筆。**0 筆 + 沒有提示 = 員工得到「查無此單」的錯誤結論**,
          那正是本合約最主要要禁的形狀 ⇒ 這個條件式**不得**加上 `orders.length > 0`。 */}
      {result?.keywordTruncated && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900'>
          符合這個關鍵字的訂單超過 100 筆,目前只找了最新的 100 筆;請輸入更完整的關鍵字(例如完整料號或單號)再查一次。
        </div>
      )}

      {searchNotice && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900'>
          {searchNotice}
        </div>
      )}
      {browseEmptyNotice && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900'>
          {browseEmptyNotice}
        </div>
      )}
      {/* 🔴 #338(2026-08-11 修):本搜尋原本**只有一句常駐警語**「請先點進訂單核對供應商」——
          而員工正是因為不知道是哪一家才來搜,那句話等於把唯一能回答問題的資料藏起來。
          現在 adapter 在**同一次往返**裡把命中的供應商帶回來(不動列表投影白名單),分三態顯示:
          一家 ⇒ 直接具名 / 多家 ⇒ 示警並列名(真正會出事的情況)/ 認不出來 ⇒ 退回原本那句警語。
          語意在 `lib/orders/supplier-match-notice.ts`(純函式 + 守門),本檔只排版。 */}
      {/* 🔴 **閘改成看提示自己的形狀,不看「這次是不是供應商單號搜尋」**(#347-B):
          那個判斷來自已退場的 `supplierOrderNoSearch`。`describeSupplierMatch(null, …)`
          回 `none` ⇒ Q-347-B5=C 之下(`supplierOrderNoMatchedSuppliers` 恆 `null`)
          整塊**不渲染**,而不是渲染成空殼。片 B-2 把 producer 接回來時這裡不用改。 */}
      {supplierMatch.kind !== 'none' && !loadFailed && (
        <>
          {supplierMatch.kind === 'single' && (
            <div className='text-muted-foreground rounded-lg border border-dashed p-3 text-xs'>
              這組單號屬於供應商<strong className='text-foreground'>{supplierMatch.label}</strong>。
            </div>
          )}
          {supplierMatch.kind === 'multiple' && (
            <div className='rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900'>
              ⚠️ 這組單號在 <strong>{supplierMatch.labels.length}</strong> 家供應商都有:
              <strong>{supplierMatch.labels.join('、')}</strong>。
              到貨登記前<strong>務必</strong>先點進訂單確認是哪一家的貨。
            </div>
          )}
          {supplierMatch.kind === 'unknown' && (
            <div className='text-muted-foreground rounded-lg border border-dashed p-3 text-xs'>
              此搜尋不區分供應商:若兩家供應商使用相同單號,結果會同時列出。到貨登記前請先點進訂單核對供應商。
            </div>
          )}
        </>
      )}

      {/* 🆕 手動建單彈窗(`?new=1`)。殼借 NextStepDialog;關掉 = 同一頁不帶 new。
          🔴🔴 **它在 `loadFailed` 那個分岔【外面】**(codex 2026-09-13 must-fix):
             建單不依賴列表 —— 列表撈不到時員工仍然要能建單、要能沿用 `mrid` 重送。
             放進成功分支裡 = 多了一條「列表要先查得到才准建單」的規則, 而面板那條路從來沒有這條。
          🔴 `await` 它(async server component)。⚠️ 表單失敗導回時 action 帶著 `?new=1&r=…&mrid=…`
             ⇒ page 重新渲染本彈窗、`ManualOrderView` 讀 raw 裡的 r / mrid 印橫幅與沿用冪等鍵 —— 與面板版同一套。 */}
      {manualOrderDialogOpen && (
        <NextStepDialog
          title='手動建單'
          closeHref={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
          // 🆕 2026-09-14 Sean「可以改寬一點方便一次填嗎」⇒ 稿 `#modal.wide` 800(A 窗:表單本體同片改兩欄;
          //    520 塞不下品項列、862 高超出 900 視窗, 1440 量到)。
          wide
          // 稿 [取消][確認] 同一排:取消鈕在 `ManualOrderSubmit` 那一排(container='dialog' 才有),殼的 footer 收掉(施工窗)。
          inlineCancel
        >
          {await ManualOrderView({ raw: rawSearchParams, container: 'dialog' })}
        </NextStepDialog>
      )}

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* 2b-1:勾選狀態的 client provider。**只包住表格**,頁面其餘部分仍是純 server render。
              動作列放表格上方(勾了才浮出)。彈窗成箱是 2b-2。 */}
          <ShippingSelectionProvider>
          {/* 🆕 A2:老闆模式下成本四格可改的 client provider(只在老闆模式包;一般模式零 island)。
              浮條「✎ 已改 N 格,還沒存」+ 確認框 + 隱形送出住在 `CostUnsavedBar`;做完 return_to = 這份列表(帶 boss / 篩選 / 頁碼)。 */}
          <CostEditProvider>
            {display.boss && costCells !== 'unreadable' ? (
              <CostUnsavedBar returnTo={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)} />
            ) : null}
            {/* B9:勾了才浮出的批次列(固定在下方置中)。三顆動作只組 `?next=&do=&items=` 網址,彈窗在下面 `nextStepUi`。
                「改成本」那顆:老闆模式(可改)才給 `costItemsParam`(A2-b 接批次彈窗;參數名用 `costs_items`,`\bcost\b` 那把尺不咬)。 */}
            <BatchActionBar
              nextBase={buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED)}
              costItemsParam={display.boss && costCells !== 'unreadable' ? ORDER_COSTS_ITEMS_PARAM : undefined}
            />
            {/* 🆕 P-d:`?open=` 指到的單不在這一頁 ⇒ 說一句(存在=藍+連結 / 不存在=紅)。
                🔴 **放在表格正上方、空狀態之前**:「全部濾掉」時既有空狀態文案照印在它下面,
                   但這一句先講 —— 不然「目前沒有符合條件的訂單」+「已打開單號…」讀起來矛盾。 */}
            {openMissingOrHidden !== null && openOrderId !== null && (
              <OpenOrderNotice
                displayId={openMissingOrHidden.displayId}
                openOrderId={openOrderId}
                exists={openMissingOrHidden.exists}
              />
            )}
            {/* #350c:面板連結**帶著當下篩選與頁碼**一起走(同一支 builder)⇒ 點開一張單不會洗掉列表狀態。 */}
            <OrdersTable
              orders={orders}
              density={display.density}
              /* 🆕 A1:`null` = 一般模式;Map / 'unreadable' = 老闆模式(藏四欄、畫六欄)。 */
              costCells={costCells}
              editCosts={display.boss && costCells !== 'unreadable'}
              /* 🆕 P-b:點【已展開】的那一列 ⇒ 收合(連結不帶 open);點別列 ⇒ 展開那一張。
                 Sean 拍過「不要 ✕ 關閉鈕」⇒ 再點一次那一列就收(規格 §3-d)。 */
              buildOpenHref={(orderId) =>
                buildOrderListHref(filter, display, page, orderId === openOrderId ? PANEL_CLOSED : orderId)
              }
              /* 選中色塊 = 展開的那一組(舊 `panel` 路徑開著時仍照舊亮,兩條路過渡期並存)。 */
              selectedOrderId={openOrderId}
              expanded={expanded}
              buildNextHref={buildNextHref}
              buildPayHref={buildPayHref}
              /* 🆕 入口二:發票 tag ⇒ `?invoice=<id>`, 帶當下篩選與頁碼、不帶 open(開彈窗不需要先展開那一列)。 */
              buildInvoiceHref={(orderId) => buildInvoiceHref(buildOrderListHref(filter, display, page, PANEL_CLOSED), orderId)}
            />
            {/* 🆕 P-e-1:「下一步」彈窗殼。**P-e-1 只有殼**(內容是一段佔位字);P-e-2 設計窗的三支 body
                進來之後,這裡依 `nextStep.do` 換成 `<NextStep<X>Body orderId=… />`(三行 import + switch,我加)。
                🔴 標題字面從 `ORDER_NEXT_STEP_LABEL` 反查(`NEXT_STEP_DO` 的反向),不在這裡抄中文。 */}
            {/* 🆕 發票小抄彈窗(`?invoice=`)。殼借 NextStepDialog, 內容是 server 撈的明細 + panel。
                🔴 `await` 它(async server component 不 await 會渲染成空, 同上面 expanded 那段的理由)。 */}
            {invoiceOrderId !== null &&
              (await InvoiceCheatSheetDialog({
                orderId: invoiceOrderId,
                closeHref: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED),
                returnTo: buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED),
              }))}
            {/* 🆕 **滑到被截斷的字上、原地顯示全文**(Sean 2026-09-13 拍板;第二句推翻第一句的形狀)。
                🔴 **它掛在表格【外面】而不是寫進 `OrdersTable`** —— 那支全檔零 `use client` / 零 hook
                   (有守門)。本元件走**全域事件委派**,`orders-table.tsx` 的 DOM 一個字都不動
                   ⇒ 📌 **它可以整支移除而列表照常運作。**
                ⚠️ 它渲染 `null`,不佔版面;觸控裝置上自己關掉(沒有 hover)。 */}
            <TruncationReveal />
          </CostEditProvider>
          </ShippingSelectionProvider>
          <ListPagination
            page={page}
            total={total}
            pageSize={ORDERS_PAGE_SIZE}
            shownCount={orders.length}
            buildHref={(p) => buildOrderListHref(filter, display, p, openOrderId ?? PANEL_CLOSED)}
            unit='筆'
          />
        </>
      )}
      {/* 🆕 P-e-1 / 收款欄可點:「下一步」與「新增收款」彈窗。
          🔴🔴 **放在 `loadFailed` 三元式【外面】**(codex R4 must-fix,2026-09-13):表單送出、RPC 已 commit、回應斷了
             ⇒ 失敗路徑 revalidate ⇒ 這一刻**列表也讀不到** ⇒ 若彈窗住在成功分支裡,整個彈窗跟著列表一起卸載,
             錯誤態與舊冪等鍵一起沒了。彈窗的生命週期只跟網址上的 `next`/`pay` 走,不跟列表讀取成敗走。
          🔴 標題字面從 `ORDER_NEXT_STEP_LABEL` 反查(`NEXT_STEP_DO` 的反向),不在這裡抄中文。
          ⚠️ 出貨那支自帶 `useShipmentLauncher`,不吃 `ShippingSelectionProvider` ⇒ 放 provider 外面沒差。 */}
      {costsBulkUi}
      {nextStepUi}
      {payUi}
      {cancelUi}
      {noteUi}
      {editUi}
      {moreUi}
      {/* 🆕 codex must-fix ②(R1)+ R2:取消做完、那張單不在這一頁 ⇒ 結果面板在這裡畫(展開明細那份畫不到)。
          🔴 放在列表成功 / 失敗分支【之外】(R2 must-fix):列表查詢拋錯時 `orders=[]`、面板若住在成功分支裡就跟著消失
          —— 而那正是「錢動了、畫面卻什麼都不說」的時刻。同一顆元件、同一支 classifier;`r` 不是取消碼時它自己回 null。 */}
      {openCancelResult !== null && (
        <CancelResultPanel
          resultCode={resultCode}
          requestToken={rawSearchParams[CANCEL_REQUEST_TOKEN_PARAM]}
          actor={openCancelResult.actor}
          cancellations={openCancelResult.cancellations}
          cancellationsTruncated={openCancelResult.cancellationsTruncated}
          orderCancelledAt={openCancelResult.cancelledAt}
          orderPaymentStatus={openCancelResult.paymentStatus}
        />
      )}
    </div>
  );
}
