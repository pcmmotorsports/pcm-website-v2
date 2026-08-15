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
  ORDERS_PAGE_SIZE,
} from '../../lib/orders/order-list-view';
import { describeSupplierMatch } from '../../lib/orders/supplier-match-notice';
import { OrderFilterBar } from '../../components/orders/order-filter-bar';
import { OrdersTable } from '../../components/orders/orders-table';
import { OrderDensityToggle } from '../../components/orders/order-density-toggle';
import { OrderFilterChips } from '../../components/orders/order-filter-chips';
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
const UNPAID_CARD_HIDDEN_HINT =
  '找不到單?列表預設不顯示「刷卡未付款」的訂單。勾選下方的「顯示刷卡未付款(預設隱藏)」再查一次。';

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
  // #338:命中的供應商 → 三態提示(語意在 lib,本檔只排版)。
  const supplierMatch = describeSupplierMatch(
    result?.supplierOrderNoMatchedSuppliers ?? null,
    orders.length > 0,
  );
  const total = result?.total ?? 0;

  return (
    <div className='space-y-4'>
      {/* 🔴 `#484` 片 B-1:chip 排照 OD `.bar` 的**位置**
          (`overview-desktop.html:609-614`:`<h2>訂單</h2>` 之後緊接四顆 `.fchip`)。
          ⚠️ **只有位置照搬,不是逐字**(R1 nit 7):我方沒搬 `.bar` 本身
          (OD `:91` 34px 高的 bar、`:92` h2 13px),用的是既有的 `h1 text-2xl` + flex。

          🔴🔴 **`#485` 片3:窄版 chip 改排自己一行(主視窗 2026-08-15 裁【甲】)。**
          ⚠️ **OD 只有桌機稿,窄版沒有真權威** —— 這是版面決定,不是搬 design。
          裁定的依據是量到的數,不是偏好(兩案代價各量過一次):
            · 現況 390:三顆 chip 擠不下 ⇒ **字在 chip 裡折兩行**,「待處理」實測 46×**62**、
              「全部」39×**44**,整列 64px。**這不是「有點擠」,是已經壞掉的畫面。**
            · 乙案(窄版藏掉密度鈕)被否掉,因為**密度在卡片模式下是真的有效**:
              實測字級 14→13→12、列高 25→23.5→22(量法做過兩向對照:注入 `!important`
              讓它「不該變」時回報沒變、移除後回報有變 ⇒ 分得出「真沒變」與「我量不到」)。
              **而手機正是最需要它的地方。**
            · 甲案代價 ≈ 0:整列**現在就已經是兩層**,而三顆 chip 單獨一列只要 **184px**,
              窄版可用 358px ⇒ 一倍餘裕。

          🔴 **做法是「讓 chip 那組換到自己一行」,不是給 chip 加 `white-space: nowrap`。**
             `nowrap` 已實測過:它只把擠壓**轉嫁**給右邊那組,總寬需求一點沒少。
          🔴 **也不是加 `padding` 撐觸控區** —— `#466` 的設計是 `::after` 熱區
             (`globals.css:731` / `:735-739`),加 padding 正是那條裁定禁止的做法。

          版面:`flex-wrap` + 右組 `ml-auto`(桌機等同原本的 `justify-between`);
          窄版 chip 組 `order-last basis-full` ⇒ 它自己佔滿一行、被推到第二行。
          斷點取 `md`(768)而非 `sm`(640):768 是驗收要求不得回歸的寬度,取 `md` 讓
          640–767 這段也走窄版排法 —— 那段扣掉側欄之後不保證塞得下整列。
          🔴 **這裡的數字我更正過一次,錯法留著**(2026-08-15,本片剛落地後量候選名字時撞到):
            原句寫「整列自然寬(**477px**)」。**477 這個數不是整列寬,是「整列 + `p-4` 外距 32」**
            —— 出處算式 `244(標題+三顆 chip) + 201(密度鈕+共 N 筆) + 32(外距) = 477`,
            **而 244+201 = 445 才是整列寬**(真瀏覽器對改版前 markup 複量,一致)。
          ⇒ **改版後**(本片加了 `gap-x-3`,chip 組與右組之間多 12px):
            **整列自然寬 = 457**、要不被擠壓的**容器**寬 = 457 + 32 = **489**。
          ⚠️ **裁定不受影響**(640 扣掉側欄與外距後仍 < 457,取 `md` 依然是保守的那一邊),
             **但「量到的東西」與「標籤」不一致就是假字面** —— 這是同一天第二次同型錯
             (前一次:把壓縮後的寬度當成需要的寬度)。
          `gap-y-1`(4px)不是隨手挑的:32(標題列)+ 4 + 26(chip 列)= **62 ≤ 現況 64**。 */}
      <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
        <h1 className='text-2xl font-semibold'>訂單</h1>
        <div className='order-last basis-full md:order-none md:basis-auto'>
          <OrderFilterChips filter={filter} display={display} />
        </div>
        <div className='ml-auto flex items-center gap-4'>
          {/* L3 片4:密度切換。🔴 `page` 帶**當下這一頁**、不是固定 1 ——
              切密度不是換篩選條件,不該把人踢回第一頁(對照上面搜尋框那條刻意給 1 的理由)。 */}
          <OrderDensityToggle
            current={display.density}
            buildHref={(density) => buildOrderListHref(filter, { density }, page)}
          />
          {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 筆</p>}
        </div>
      </div>

      {!panelOpen && <ResultBanner code={resultCode} />}

      {/* #347-2b:關鍵字搜尋框 + 「目前搜尋」chip。
          🔴 `listHref` 的 `page` 固定給 **1**:換了搜尋條件還停在第 3 頁,常常直接看到空白頁。
          其餘篩選軸照 `filter` 原樣帶回 ⇒ 搜尋不會把使用者的篩選洗掉。 */}
      <OrderKeywordSearch
        keyword={keyword}
        listHref={buildOrderListHref(filter, display, 1)}
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
              登錄到貨前<strong>務必</strong>先點進訂單確認是哪一家的貨。
            </div>
          )}
          {supplierMatch.kind === 'unknown' && (
            <div className='text-muted-foreground rounded-lg border border-dashed p-3 text-xs'>
              此搜尋不區分供應商:若兩家供應商使用相同單號,結果會同時列出。登錄到貨前請先點進訂單核對供應商。
            </div>
          )}
        </>
      )}
      <OrderFilterBar
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
            {/* #350c:面板連結**帶著當下篩選與頁碼**一起走(同一支 builder)⇒ 點開一張單不會洗掉列表狀態。 */}
            <OrdersTable
              orders={orders}
              density={display.density}
              buildPanelHref={(orderId) => buildOrderListHref(filter, display, page, orderId)}
            />
          </ShippingSelectionProvider>
          <ListPagination
            page={page}
            total={total}
            pageSize={ORDERS_PAGE_SIZE}
            shownCount={orders.length}
            buildHref={(p) => buildOrderListHref(filter, display, p)}
            unit='筆'
          />
        </>
      )}
    </div>
  );
}
