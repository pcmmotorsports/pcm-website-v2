import { cookies } from 'next/headers';
import type { AdminOrderFilter, AdminOrderListResult } from '@pcm/domain';
import {
  ORDER_KEYWORD_COOKIE,
  readOrderKeywordCookie,
} from '../../lib/orders/order-keyword-cookie';
import { OrderKeywordSearch } from '../../components/orders/order-keyword-search';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  readOpenPanelOrderId,
  readOpenOrderId,
  ORDERS_PAGE_SIZE,
  PANEL_CLOSED,
  buildCarriedUrlValues,
} from '../../lib/orders/order-list-view';
// 🆕 P-b:就地展開用的明細 = 與 `@panel/orders/page.tsx` 渲染進面板的【同一支】。
import { OrderDetailRoute } from '../../components/orders/order-detail-route';
import { OpenOrderNotice } from '../../components/orders/open-order-notice';
// 🆕 P-e-1:「下一步」彈窗殼(client)+ 網址參數。內容由本檔依 `do=` 挑、當 children 塞進去。
import { NextStepDialog } from '../../components/orders/next-step-dialog';
import { InvoiceCheatSheetDialog } from '../../components/orders/invoice-cheatsheet-dialog';
// 🆕 P-e-2:三支 body(設計窗)。前兩支是 server component(自己 await),塞進殼當 children;
//    出貨那支是 'use client' 且自帶整片遮罩 ⇒ **不包殼,直接渲染**(見下方 switch)。
import { NextStepProcurementBody } from '../../components/orders/next-step-procurement-body';
import { NextStepReceiptBody } from '../../components/orders/next-step-receipt-body';
import { NextStepShipmentBody } from '../../components/orders/next-step-shipment-body';
import {
  ORDER_INVOICE_PARAM,
  buildInvoiceHref,
  ORDER_NEXT_PARAM,
  ORDER_NEXT_DO_PARAM,
  NEXT_STEP_DO_VALUES,
  type NextStepDo,
} from '../../lib/orders/order-return-to';
import { ORDER_NEXT_STEP_LABEL, NEXT_STEP_DO } from '../../lib/orders/order-status-axes';
import { customerDetailHref } from '../../lib/orders/order-detail-view';
import { isUuid } from '../../lib/orders/note-action-state';
import { CANCEL_REQUEST_TOKEN_PARAM } from '../../lib/orders/cancel-action-state';
import { describeSupplierMatch } from '../../lib/orders/supplier-match-notice';
import { OrderFilterBar } from '../../components/orders/order-filter-bar';
import { OrdersTable } from '../../components/orders/orders-table';
import { TruncationReveal } from '../../components/orders/truncation-reveal';
import { OrderExportButton } from '../../components/orders/order-export-button';
import { orderExportBlockedReason } from '../../lib/orders/order-export';
import {
  buildOrderPageCsv,
  orderPageExportFilename,
} from '../../lib/orders/order-export-page';
import { OrderToolbar } from '../../components/orders/order-toolbar';
import {
  ShippingSelectionProvider,
  ShippingSelectionBar,
} from '../../components/orders/shipping-selection';
import { isManualOrderPanel } from '../../lib/orders/manual-order-action-state';
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
const UNPAID_CARD_HIDDEN_HINT =
  '找不到單?列表預設會藏起一部分「刷卡未付款」的訂單。勾選下方的「顯示刷卡未付款(預設隱藏)」再查一次。';

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
const BROWSE_EMPTY_HINT =
  '有些訂單預設不會列出來 —— 刷卡未付款的那些。要看它們,請勾下方的「顯示刷卡未付款(預設隱藏)」。若勾了還是沒有,那就是其他篩選條件把它濾掉了。';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  // #347-B(Q-347-B1=B):`ADMIN_E10_ORDER_NUMBER_SEARCH` / `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH`
  //    兩個逐批啟用閘連同它們的搜尋欄一起退場 —— 兩者的能力併入關鍵字搜尋
  //    (`admin_search_orders` 的 #1 訂單編號 / #12 舊訂單編號 / #11 供應商單號分支)。
  const {
    filter: urlFilter,
    page,
    // L3 片4:密度是**顯示設定**、不是篩選 ⇒ 與 filter 分開拿,也不進 repository。
    display,
    datePresetOptions,
    selectedDatePresetKey,
  } = parseOrderListSearchParams(rawSearchParams, {
    // 🔴🔴 #347-3c-2:**給 `now` = 開啟「未選預設近半年」**(Sean Q14=A)。
    //    這一行是這一軸唯一「會藏掉舊單」的地方,所以它明著寫在頁層、不藏在 lib 的預設參數裡。
    //    可見性由 `selectedDatePresetKey` 保證:篩選列會把「近半年」顯示成**選中**,員工改得動。
    //    ⚠️ **不要宣稱「網址列會顯示日期」**(R1 important 4 更正):打開裸 `/orders` 時
    //    沒有任何東西改寫網址列,日期只在按連結 / 翻頁之後才進 URL
    //    ⇒ 首次載入的可見性**完全由那格下拉承擔**。
    //    ⚠️ 頁層 `force-dynamic`,每次請求重算;逃生口 = 下拉的「自訂」。
    now: new Date(),
  });
  // 🔴 **#347-2b:關鍵字這一軸不在 URL、在 httpOnly cookie**(Q-a=B 紅線:搜尋詞是 PII)。
  //    它與其他七軸的來源不同,但**下游一視同仁** —— 合進同一個 `filter` 之後,
  //    分頁 / 篩選 / 查詢全部照原路走,`buildOrderListHref` 一個字都不用改。
  //    讀取 fail-closed(壞值/超長 ⇒ 當沒搜尋),理由與三道閘見 `order-keyword-cookie.ts`。
  const keyword = readOrderKeywordCookie((await cookies()).get(ORDER_KEYWORD_COOKIE)?.value);
  const filter: AdminOrderFilter = keyword === null ? urlFilter : { ...urlFilter, keyword };
  const resultCode = typeof rawSearchParams.r === 'string' ? rawSearchParams.r : undefined;
  // 🔴🔴 **#350d C2:`r` 歸誰,用 `panel` 的有無判定** —— 面板開著時它是**面板的**結果碼,
  //    列表停畫自己那條,否則員工會同時看到兩條說同一件事的橫幅(契約 §2 硬條件 2)。
  //    🔴 判準必須是 `readOpenPanelOrderId`(= 槽頁決定開不開面板的**同一支**),不能自己看
  //    `rawSearchParams.panel` 在不在:`?panel=not-a-uuid&r=saved` 時槽頁回 null(面板不開),
  //    列表若也停畫就是**零橫幅** —— 動作做完了畫面上一個字都不說。
  /* 🔴 **片 A-1:這裡原本把 `readOpenPanelOrderId` 的回傳值【算成布林就丟掉】。**
     選中色塊需要的就是那個 id,**不是新查一次** —— 留住它,`panelOpen` 的語意一個字沒變。
     ⚠️ **判準仍必須是 `readOpenPanelOrderId`(= 槽頁決定開不開面板的同一支)**,理由見上面那段:
        自己看 `rawSearchParams.panel` 在不在會與槽頁不一致。**選中色塊也吃這個一致性** ——
        `?panel=not-a-uuid` 時面板不開,而列表**也不該有任何一組亮著**。 */
  const panelOrderId = readOpenPanelOrderId(rawSearchParams);
  // 🔴🔴 **codex R1 nit(2026-08-28):`panel=new`(手動建單面板)也算「面板開著」。**
  //    少了它,`?panel=new&r=manual_order_error` 會**由列表與面板各畫一次同一條橫幅**。
  //    ⚠️ ~~原例子寫 `manual_customer_error`~~ —— **那顆碼 2026-08-28 已經連同它的導頁一起刪掉了**
  //       (建客人改成就地回傳,不再導頁)⇒ 拿一個已經不存在的碼當現行例子,
  //       會讓下一個人以為那條路還在。**註解裡的例子也是一個宣稱。**
  //    ⚠️ 判準走 `isManualOrderPanel` = **槽頁決定開不開的同一支**(理由同上面那段)。
  const panelOpen = panelOrderId !== null || isManualOrderPanel(rawSearchParams);
  /* 🆕🆕 **P-b(2026-09-13):訂單明細【就地展開】,右側面板退場(停用不拆殼)。**
     Sean 逐字:「那切掉原因是因為左邊側欄還用原本…右邊訂單明細也還在關係,新版就沒這問題」。

     做法只有兩步,而**兩步都不碰殼**:
       ① 列表產的連結改寫 `?open=<id>`、不再寫 `?panel=`(`buildOrderListHref`)
          ⇒ `@panel` 槽沒內容 ⇒ `globals.css` 的 `:has()` 把面板收掉 ⇒ **表格拿回 868px**
          (真瀏覽器實測 1596 ↔ 728,含「槽有東西就不收」的負對照)。
       ② 這裡讀 `open`、用**面板版同一支** `OrderDetailRoute` 渲染,塞進那一列底下。
     🔴 **`panel` 那條路【還在】**:`@panel/orders/page.tsx` 一個字沒動 ⇒ 舊書籤 / 客人卡 /
        手動建單照舊開面板。**那是預期的,不是沒做完** —— 各自是 P-c。
     🔴 **`resultCode` / `panelOpen` 的歸屬邏輯【沒有改】**:`r` 仍然只在面板開著時歸面板;
        就地展開的明細自己會畫它的結果橫幅(`OrderDetailRoute` 內建),列表那條靠下面的
        `!panelOpen && !openOrderId` 停畫 —— 否則同一個結果會印兩次(契約 §2 硬條件 2 的同型)。 */
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
  try {
    // repo 建構(env 缺 requireEnv)是**同步 throw** ⇒ 必須在 try 內建構,不能先建構再 await。
    result = await getAdminOrderRepository().listOrderSummariesForAdmin(filter, {
      limit: ORDERS_PAGE_SIZE,
      offset,
    });
  } catch (e) {
    console.error('[admin/orders] 訂單列表載入失敗', e);
    loadFailed = true;
  }

  const orders = result?.items ?? [];

  /* 🆕🆕 **P-d(2026-09-13,主視窗裁甲):`?open=` 指到的單【不在這一頁】時要說一句。**
     🔴 **先判「在不在 `orders[]`」,再決定要不要撈明細** —— 這一步是承重的,不是省一發查詢那麼簡單:
        · 在 ⇒ `await OrderDetailRoute`,塞進那一列底下(P-b)
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
     🔴 **`next` 那張單【必須在這一頁】** —— 同 P-d 的理由:那顆鈕長在那一列上,那一列不在就沒有那顆鈕;
        貼來的網址指到不在這頁的單 ⇒ **不開彈窗**(P-d 那條藍/紅提示不管 next,它只管 open;
        要不要為 next 也補一句,等 P-e-2 看實體再說,先不設計)。 */
  const nextRaw = rawSearchParams[ORDER_NEXT_PARAM];
  const doRaw = rawSearchParams[ORDER_NEXT_DO_PARAM];
  const nextOrderId =
    typeof nextRaw === 'string' && isUuid(nextRaw) && orders.some((o) => o.id === nextRaw.toLowerCase())
      ? nextRaw.toLowerCase()
      : null;
  const nextDo: NextStepDo | null =
    typeof doRaw === 'string' && (NEXT_STEP_DO_VALUES as readonly string[]).includes(doRaw)
      ? (doRaw as NextStepDo)
      : null;
  const nextStep = nextOrderId !== null && nextDo !== null ? { orderId: nextOrderId, do: nextDo } : null;
  /* 🆕 `?invoice=<id>` ⇒ 發票小抄彈窗(同 `next` 那一族:一次性、不進 buildOrderListHref、只開表單)。
     🔴 只認**這一頁列表裡有**的單 —— 與 `next` 同一條防線:貼一個別頁的 id 進來, 不撈、不開。 */
  const invoiceRaw = rawSearchParams[ORDER_INVOICE_PARAM];
  const invoiceOrderId =
    typeof invoiceRaw === 'string' && isUuid(invoiceRaw) && orders.some((o) => o.id === invoiceRaw.toLowerCase())
      ? invoiceRaw.toLowerCase()
      : null;
  /* 🏁 **P-e-2(2026-09-13):三支 body(設計窗)進來了,佔位字退場。** 仍然零寫入 ——
     三支的 action / submit 都接 `next-step-stub-action.ts`(只 throw「P-e-3 未接線」),
     由 `next-step-bodies.test.ts` 靜態守著。**按確認會炸,那是預期的。**
     🔴 `returnTo` = closeHref(列表自己、不帶 next/do、保留 open)—— 動作做完回這裡。
     🔴 前兩支是 async server component ⇒ **`await` 它、不當 JSX 子元素**(同 `OrderDetailRoute` 的理由:
        沒 await 的話測試 render 出空字串且不報錯)。
     🔴🔴 **出貨那支【不包殼】,而那不是漏包**(設計窗對檔 2026-09-13):
        `NextStepShipmentBody` 是 `'use client'`、走既有 `useShipmentLauncher`
        ⇒ 渲染出來的 `ShipmentDialog` **自己就是整片 `fixed inset-0 z-50` 遮罩 + `role='dialog'`**。
        塞進 `showModal()` 的 `<dialog>` 裡 ⇒ top layer 會把它蓋住,員工看到一個空殼。
        關掉 / 做完它自己 `router.replace(returnTo)`(launcher 的 `onClose` 鉤子)。
        📌 **三顆鈕、兩種容器,而那是既有元件的形狀決定的,不是設計上要有兩種。** */
  const nextStepUi = await (async () => {
    if (nextStep === null) return null;
    const closeHref = buildOrderListHref(filter, display, page, openOrderId ?? PANEL_CLOSED);
    if (nextStep.do === 'ship') {
      return <NextStepShipmentBody orderId={nextStep.orderId} returnTo={closeHref} />;
    }
    const title =
      ORDER_NEXT_STEP_LABEL[
        (Object.keys(NEXT_STEP_DO) as (keyof typeof NEXT_STEP_DO)[]).find((k) => NEXT_STEP_DO[k] === nextStep.do)!
      ];
    const body =
      nextStep.do === 'order'
        ? await NextStepProcurementBody({ orderId: nextStep.orderId, returnTo: closeHref })
        : await NextStepReceiptBody({ orderId: nextStep.orderId, returnTo: closeHref });
    return (
      <NextStepDialog title={title} closeHref={closeHref}>
        {body}
      </NextStepDialog>
    );
  })();
  /* 「下一步」連結 = 當下篩選 + 頁碼(**不帶 open** —— 開彈窗不需要先展開那一列)+ next + do。
     🔴 `next` / `do` **刻意不進 `buildOrderListHref` 的窮舉鍵表**:它們是一次性的(關掉就沒了),
        翻頁 / chip 不該帶著它們走(帶著走 = 換頁還開著同一個彈窗)。同 `RESULT_ONLY_PARAMS` 那族的性質。 */
  const buildNextHref = (orderId: string, action: NextStepDo) => {
    const base = buildOrderListHref(filter, display, page, PANEL_CLOSED);
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
          node: await OrderDetailRoute({
            id: openOrderId,
            resultCode: rawSearchParams.r,
            requestToken: rawSearchParams[CANCEL_REQUEST_TOKEN_PARAM],
            correctNoteId:
              typeof rawSearchParams.correct === 'string' && isUuid(rawSearchParams.correct)
                ? rawSearchParams.correct
                : null,
            // 「收合」= 同一頁、同一組篩選與頁碼、只是不帶 open。**不是回列表**(本來就在列表上)。
            back: { href: buildOrderListHref(filter, display, page, PANEL_CLOSED), label: '收合' },
            // return_to = **這個展開視圖自己** ⇒ 動作做完那張單還開著(同 #350d 面板版的理由)。
            returnTo: buildOrderListHref(filter, display, page, openOrderId),
            missing: 'inline',
            // 🔴 客人卡走【整頁】`/customers/<id>`(設計窗 P-c 對檔定案),**不再產生 `customer` 參數**
            //    ⇒ 客人卡那條面板路從這裡退場。與 `orders/[id]/page.tsx` 傳的是同一支。
            buildCustomerHref: customerDetailHref,
          }),
        };
  /* 不在這一頁 ⇒ 只問「存不存在」。走既有的 `findAdminOrderDetail`(查無回 null),**只在這條邊緣路上跑**。
     ⚠️ 它撈的是整張明細、比「存在檢查」重 —— 而這條路一天走不了幾次(要同時滿足:有人貼網址 + 篩選剛好擋住),
        為它另開一支 port 方法是 YAGNI。哪天它變熱路徑再換。 */
  let openMissingOrHidden: { displayId: string | null; exists: boolean } | null = null;
  if (openOrderId !== null && !openInList) {
    try {
      const d = await getAdminOrderRepository().findAdminOrderDetail(openOrderId);
      openMissingOrHidden = d === null ? { displayId: null, exists: false } : { displayId: d.displayId, exists: true };
    } catch (e) {
      // 讀不到就當「找不到」印 —— 不給一顆會把他導去空列表的「清除篩選並打開」。
      console.error('[admin/orders] open= 存在檢查失敗', e);
      openMissingOrHidden = { displayId: null, exists: false };
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
      {/* 工具列(標題 + 快速篩選 chip + 密度 + 共 N 筆)= `components/orders/order-toolbar.tsx`。
          🔴 **抽出去的理由不是整潔** —— 那一列的正確性(chip 塞不塞得下、觸控命中區)
          **只有真瀏覽器量得到**,而本檔是會抓資料的 async server component、渲染不動
          ⇒ 抽成純元件才接得上 `cancel-forms-browser.test.tsx` 那條現成 harness(`#485` 片5)。
          版面決策與量測數字全部隨 markup 一起搬過去,**本檔不留第二份**(留了就會漂移)。 */}
      <OrderToolbar
        panelTarget={openOrderId ?? PANEL_CLOSED}
        filter={filter}
        display={display}
        page={page}
        total={total}
        loadFailed={loadFailed}
      />

      {!panelOpen && expanded === null && <ResultBanner code={resultCode} />}

      {/* #347-2b:關鍵字搜尋框 + 「目前搜尋」chip。
          🔴 `listHref` 的 `page` 固定給 **1**:換了搜尋條件還停在第 3 頁,常常直接看到空白頁。
          其餘篩選軸照 `filter` 原樣帶回 ⇒ 搜尋不會把使用者的篩選洗掉。 */}
      <OrderKeywordSearch
        keyword={keyword}
        /* 🔴 `#742`:**這一格是【刻意】關掉面板** —— 「用單號重查」是回到列表這個動作本身,
           帶著上一張單的面板反而奇怪。寫成 `PANEL_CLOSED` 而不是省略,是為了讓「刻意」
           與「忘了」在程式碼上分得開(那個分不開正是 `#742` 的病灶)。 */
        listHref={buildOrderListHref(filter, display, 1, PANEL_CLOSED)}
        matchCount={result?.keywordMatchCount ?? null}
        truncated={result?.keywordTruncated ?? false}
      />

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
      <OrderFilterBar
        /* 🔴 `#742`:篩選列不擁有、但不得吃掉的那四個鍵(`panel`/`customer`/`den`/`pending`)。
           逐鍵走各自的 reader 算出來 —— 理由見 `buildCarriedUrlValues` 的 docstring。 */
        carried={buildCarriedUrlValues(rawSearchParams)}
        filter={filter}
        datePresetOptions={datePresetOptions}
        selectedDatePresetKey={selectedDatePresetKey}
      />

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          訂單列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* 2b-1:勾選狀態的 client provider。**只包住表格**,頁面其餘部分仍是純 server render。
              動作列放表格上方(勾了才浮出)。彈窗成箱是 2b-2。 */}
          <ShippingSelectionProvider>
            <ShippingSelectionBar />
            {/* `#24` 片B:匯出這一頁的品項。
                🔴 **它吃的是同一個 `orders` 陣列** —— 就是下面那張表用來渲染的那一份。
                   ⇒ 「匯出的內容等於畫面上那一頁」不是靠紀律, 是**因為它們是同一個變數**。
                🔴 放在表格【上方】而不是工具列那一列:那一列的高度被
                   `order-toolbar-browser.test.tsx:208` 釘在 35(Sean 2026-08-24 拍板的字級規則撐的),
                   而我在 `fc6a1edf` 已經因為往那一列塞東西而撐高過一次(修在 `03f7e27f`)。
                   ⇒ **不要再往那一列加東西。**
                ⚠️ `filterNote` 目前只帶「有沒有套篩選」這個粗略訊息 —— 見該元件註解與 §未做。 */}
            <div className='mb-2'>
              <OrderExportButton {...exportProps} />
            </div>
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
              /* 🆕 P-b:點【已展開】的那一列 ⇒ 收合(連結不帶 open);點別列 ⇒ 展開那一張。
                 Sean 拍過「不要 ✕ 關閉鈕」⇒ 再點一次那一列就收(規格 §3-d)。 */
              buildPanelHref={(orderId) =>
                buildOrderListHref(filter, display, page, orderId === openOrderId ? PANEL_CLOSED : orderId)
              }
              /* 選中色塊 = 展開的那一組(舊 `panel` 路徑開著時仍照舊亮,兩條路過渡期並存)。 */
              selectedOrderId={openOrderId ?? panelOrderId}
              expanded={expanded}
              buildNextHref={buildNextHref}
              /* 🆕 入口二:發票 tag ⇒ `?invoice=<id>`, 帶當下篩選與頁碼、不帶 open(開彈窗不需要先展開那一列)。 */
              buildInvoiceHref={(orderId) => buildInvoiceHref(buildOrderListHref(filter, display, page, PANEL_CLOSED), orderId)}
            />
            {/* 🆕 P-e-1:「下一步」彈窗殼。**P-e-1 只有殼**(內容是一段佔位字);P-e-2 設計窗的三支 body
                進來之後,這裡依 `nextStep.do` 換成 `<NextStep<X>Body orderId=… />`(三行 import + switch,我加)。
                🔴 標題字面從 `ORDER_NEXT_STEP_LABEL` 反查(`NEXT_STEP_DO` 的反向),不在這裡抄中文。 */}
            {nextStepUi}
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
    </div>
  );
}
