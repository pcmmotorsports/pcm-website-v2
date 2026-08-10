import { cookies } from 'next/headers';
import type {
  AdminOrderFilter,
  AdminOrderListResult,
  SupplierOrderNoSearchInvalidReason,
} from '@pcm/domain';
import { SupplierOrderNoSearchTooManyError } from '@pcm/domain';
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
  ORDERS_PAGE_SIZE,
} from '../../lib/orders/order-list-view';
import { OrderFilterBar } from '../../components/orders/order-filter-bar';
import { OrdersTable } from '../../components/orders/orders-table';
import {
  ShippingSelectionProvider,
  ShippingSelectionBar,
} from '../../components/orders/shipping-selection';
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
 * 供應商單號搜尋詞不合法時的**明示**訊息(M-4b E10 A10c2;Sean 2026-08-07 Q1=A)。
 *
 * 🔴 三種 reason 的訊息**刻意不同** —— 使用者要能從訊息知道「我該怎麼改」。
 * 全部合成一句「查無此單」就是 Q1=A 要禁的默默降級。
 */
const SUPPLIER_SEARCH_INVALID_MESSAGE: Record<SupplierOrderNoSearchInvalidReason, string> = {
  non_ascii: '這個供應商單號含有中文或特殊符號,目前的搜尋只支援英數與常見標點;請改用訂單編號或客戶姓名查詢。',
  reserved_char: '供應商單號不能含有逗號、括號、引號或反斜線;請去掉這些符號再查一次。',
  too_long: '供應商單號太長(上限 32 字);請只輸入單號本身。',
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  // M-4b E10 A10c1 單號搜尋:§7.1 逐批啟用閘,U 片一律掛 env flag、預設 off。
  // 🔴 硬前置 = D0 migration 已 apply(orders.legacy_display_id)。未 apply 就開 ⇒
  //    PostgREST 42703 ⇒ 整個訂單列表進錯誤態(不只搜尋壞掉)。
  const orderNumberSearchEnabled = process.env.ADMIN_E10_ORDER_NUMBER_SEARCH === '1';
  // M-4b E10 A10c2 供應商單號搜尋:同一個逐批啟用閘,前置不同。
  // 🔴 硬前置 = A9b2-M migration 已 apply(`supplier_order_no_upper` 產生欄,
  //    `supabase/migrations/20260807130000_…`)。未 apply 就開 ⇒ PostgREST 42703 ⇒
  //    **整個訂單列表**進錯誤態(不只搜尋壞掉),與 A10c1/D0 同族。
  const supplierOrderNoSearchEnabled =
    process.env.ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH === '1';
  const {
    filter: urlFilter,
    page,
    supplierOrderNoSearch,
    datePresetOptions,
    selectedDatePresetKey,
  } = parseOrderListSearchParams(rawSearchParams, {
    orderNumberSearchEnabled,
    supplierOrderNoSearchEnabled,
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
  const panelOpen = readOpenPanelOrderId(rawSearchParams) !== null;
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
  // 🔴 命中過多時**不渲染筆數與空表**(階段 C must-fix 2)。
  //    不擋的話同一畫面會吐三句互相打臉的字面:橫幅說「太多」、標題說「共 0 筆」、
  //    表格說「目前沒有符合條件的訂單」。員工的閱讀順序常是先看表格 ⇒ 直接判定這個單號不存在,
  //    正是 Q1=A 拍板要禁的那個結論。
  let searchBlocked = false;
  let searchNotice: string | null =
    supplierOrderNoSearch.kind === 'invalid'
      ? SUPPLIER_SEARCH_INVALID_MESSAGE[supplierOrderNoSearch.reason]
      : null;
  try {
    // repo 建構(env 缺 requireEnv)是**同步 throw** ⇒ 必須在 try 內建構,不能先建構再 await。
    result = await getAdminOrderRepository().listOrderSummariesForAdmin(filter, {
      limit: ORDERS_PAGE_SIZE,
      offset,
    });
  } catch (e) {
    // 🔴 **分流**:命中數過多是使用者可處理的狀況 ⇒ 明示訊息 + 空列表,不進通用錯誤態。
    //    其餘(含 `SupplierOrderNoSearchShapeError` = 回傳形狀與假設不符)一律進錯誤態並
    //    `console.error` 留鑑識 —— 那類是**程式壞了**、要工程師看,不該被當成使用者問題吞掉。
    if (e instanceof SupplierOrderNoSearchTooManyError) {
      // 🔴 刻意不寫「訂單超過 N 筆」:`cap` 可能是**採購列**上限(500)、也可能是**去重後訂單數**
      //    上限(100),兩個是不同的量(adapter 檔內明文)。寫死其中一種就會有一半的情況對不上事實。
      searchNotice = `符合這個供應商單號的資料太多(超過 ${e.cap} 筆),請加上其他篩選條件縮小範圍。`;
      // 🔴 **同時擋掉「共 0 筆」與空表** —— 見下方 searchBlocked。
      searchBlocked = true;
      console.warn('[admin/orders] 供應商單號搜尋命中過多', e.cap);
    } else {
      console.error('[admin/orders] 訂單列表載入失敗', e);
      loadFailed = true;
    }
  }

  const orders = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>訂單</h1>
        {!loadFailed && !searchBlocked && (
          <p className='text-muted-foreground text-sm'>共 {total} 筆</p>
        )}
      </div>

      {!panelOpen && <ResultBanner code={resultCode} />}

      {/* #347-2b:關鍵字搜尋框 + 「目前搜尋」chip。
          🔴 `listHref` 的 `page` 固定給 **1**:換了搜尋條件還停在第 3 頁,常常直接看到空白頁。
          其餘篩選軸照 `filter` 原樣帶回 ⇒ 搜尋不會把使用者的篩選洗掉。 */}
      <OrderKeywordSearch
        keyword={keyword}
        listHref={buildOrderListHref(filter, 1)}
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
      {/* 🔴 **過渡緩解**(A9b2-A 階段 C must-fix 4):本搜尋**沒有供應商維度** ——
          兩家供應商用同一組單號時會一起列出,而列表投影裡沒有供應商欄可以標示是哪一家。
          真正的修法(把供應商帶進列表)需要動 adapter 契約或列表投影白名單,**不在本片範圍**;
          在那之前先用一句常駐提醒讓人知道要核對,總比什麼都不說好。
          🔴 已立 backlog **#338**(含兩條修法方向與「不修會痛在哪」)—— 不只留這段註解。 */}
      {supplierOrderNoSearch.kind === 'ok' && !loadFailed && !searchBlocked && orders.length > 0 && (
        <div className='text-muted-foreground rounded-lg border border-dashed p-3 text-xs'>
          此搜尋不區分供應商:若兩家供應商使用相同單號,結果會同時列出。登錄到貨前請先點進訂單核對供應商。
        </div>
      )}
      <OrderFilterBar
        filter={filter}
        datePresetOptions={datePresetOptions}
        selectedDatePresetKey={selectedDatePresetKey}
        orderNumberSearchEnabled={orderNumberSearchEnabled}
        supplierOrderNoSearchEnabled={supplierOrderNoSearchEnabled}
      />

      {loadFailed || searchBlocked ? (
        loadFailed && (
          <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
            訂單列表載入失敗,請稍後再試或聯絡系統維護。
          </div>
        )
      ) : (
        <>
          {/* 2b-1:勾選狀態的 client provider。**只包住表格**,頁面其餘部分仍是純 server render。
              動作列放表格上方(勾了才浮出)。彈窗成箱是 2b-2。 */}
          <ShippingSelectionProvider>
            <ShippingSelectionBar />
            {/* #350c:面板連結**帶著當下篩選與頁碼**一起走(同一支 builder)⇒ 點開一張單不會洗掉列表狀態。 */}
            <OrdersTable
              orders={orders}
              buildPanelHref={(orderId) => buildOrderListHref(filter, page, orderId)}
            />
          </ShippingSelectionProvider>
          <ListPagination
            page={page}
            total={total}
            pageSize={ORDERS_PAGE_SIZE}
            shownCount={orders.length}
            buildHref={(p) => buildOrderListHref(filter, p)}
            unit='筆'
          />
        </>
      )}
    </div>
  );
}
