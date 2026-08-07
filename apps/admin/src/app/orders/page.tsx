import type { AdminOrderSummary, Paginated, SupplierOrderNoSearchInvalidReason } from '@pcm/domain';
import { SupplierOrderNoSearchTooManyError } from '@pcm/domain';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import {
  parseOrderListSearchParams,
  buildOrderListHref,
  ORDERS_PAGE_SIZE,
} from '../../lib/orders/order-list-view';
import { OrderFilterBar } from '../../components/orders/order-filter-bar';
import { OrdersTable } from '../../components/orders/orders-table';
import { ResultBanner } from '../../components/orders/result-banner';
import { ListPagination } from '../../components/shared/list-pagination';

// M-4a 後台訂單列表(server component、篩選 + server 端分頁)。
// A9w2:原本的主狀態軸 `workflow_status` 已隨九碼退場下架 ⇒ 篩選 = 付款/出貨(單選)+
// 來源/管道(多勾選)+ 單號搜尋(flag)。
// A11a-1(2026-08-06):列表的九碼 cell 與整單彙總 badge 已下架 ⇒ 本頁不再讀狀態詞彙。
// 讀 searchParams → 動態渲染;force-dynamic 確保不被靜態預渲染(避免 build 期執行 DB 查詢)。
export const dynamic = 'force-dynamic';

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
  const { filter, page, supplierOrderNoSearch } = parseOrderListSearchParams(rawSearchParams, {
    orderNumberSearchEnabled,
    supplierOrderNoSearchEnabled,
  });
  const resultCode = typeof rawSearchParams.r === 'string' ? rawSearchParams.r : undefined;
  const offset = (page - 1) * ORDERS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯 / migration 未 apply)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識,不把 DB error 原文冒到瀏覽器(避免洩漏)。
  //    🔴 **A11a-1(2026-08-06)**:狀態詞彙(`order_status_options`)那一路**整條移除** ——
  //    它在本頁的唯一用途是餵列表的九碼 cell 與整單彙總 badge,兩者已隨本片下架
  //    ⇒ 原本的「訂單與詞彙分開容錯」雙腿 `Promise.allSettled` 收斂成單一 try/catch。
  //    讀取鏈本體(port / adapter / repository getter)的處置見 plan §3.1 裁定:歸 A9w4c 後半。
  let result: Paginated<AdminOrderSummary> | null = null;
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

      <ResultBanner code={resultCode} />
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
          <OrdersTable orders={orders} />
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
