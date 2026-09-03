// order-detail-items-table.tsx — 訂單明細頁的「品項」表格(M-4b E10 #13 片1c-2 版面片抽出)。
//
// 🔴 **為什麼在這一片抽**(鐵則 6:>400 行預設拆,不拆要寫理由):
//    `order-detail.tsx` **本片開工時 582 行**(`git show <本片前的 HEAD>:…|wc -l`,可驗);
//    接上展開列之後 600 行(**那個 600 沒有進 git**,任何人回頭量都量不到、別拿它當基準);
//    把這一塊抽走之後 **404 行**。
//    ⚠️ **404 仍然 > 400** —— 抽這一塊**沒有讓它達標**,只是把最大的一塊搬到它自己的檔。
//    下一塊(客戶資訊 / 收件與出貨 / 付款 / 發票四張卡 + `Field`)**留給另一片**,
//    前提是先查 `Field` 是不是只有那四張卡在用(**我沒查**)。
//
// 🔴🔴 **這個「寫理由」是【有期限的】,不是永久豁免**(主視窗 2026-08-16 裁):
//    現在 404 行、距 400 只有 **4 行** ⇒ **下一次任何人動 `order-detail.tsx`,
//    先抽下一塊再改,不得再走「寫理由」這條路徑。**
//    理由:那條路徑用第二次就變成慣例,而**慣例不會有人回頭檢查**。
//    ⚠️ 下一塊的前提仍是先查 `Field` 有沒有別的使用者(`grep "<Field"` 別檔 23 處命中,未分類)。
//
// 📎 旁證(主視窗 2026-08-16 量):`apps/admin/src/components` 底下 >400 行的**非測試**檔共 5 支 ——
//    741 `ui/sidebar.tsx` / 538 `orders/orders-table.tsx` / 463 `orders/shipment-dialog.tsx` /
//    404 本檔的來源 `orders/order-detail.tsx` / 403 `orders/item-procurement-form.tsx`。
//    ⇒ 「>400 就必拆」**不是本 repo 的實際共識**(403 那支沒有人管);
//      本片是這一輪**唯一主動減了 178 行**的。
//
// 🔴 **為什麼不是「另開一片專門拆檔」**:那條規矩的理由是「拆檔會蓋掉真正的改動」,
//    而**本片就是在改這一塊** ⇒ 兩者不再混淆,那個理由在這裡不成立。
//    ⇒ commit body 分兩段講(版面改動 / 抽檔),讓 reviewer 分得出哪些行是哪一件。
//
// 🔴 **本檔仍是 server component**(無 `'use client'`)——
//    client 島有兩個:`item-amount-row.tsx`(握「展開誰」那個狀態)、
//    `item-name-cell.tsx`(2026-08-21 新增,品名 hover 完整字,base-ui Tooltip 需要 client)。

import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import type { PaymentListData } from './payment-list';
import { ItemAmountRow, ItemAmountRowGroup } from './item-amount-row';
import { ItemNameCell } from './item-name-cell';
// 🔴 拆檔片(2026-08-24):葉元件與純判斷住在 support 檔,本檔只留品項迴圈與表頭。
import {
  ItemAxisMissingNote,
  ItemAxisValue,
  ItemCancelledNote,
  ItemsTotals,
  ITEMS_TABLE_COLSPAN,
  resolveAmountEditBlock,
} from './order-detail-items-support';
// 🔴 片C(取消介面搬家):品項的取消 checkbox 現在畫在這裡,判準仍是 `buildOrderCancelView`
//    這唯一一份真相 —— 呼叫它是**再算一次同一個純函式**,不是重寫判準
//    (`buildOrderCancelView` 只讀 `detail`、零 I/O,`OrderCancelBlock` 也各自呼叫它一次,
//    輸入相同、輸出必然相同,見 plan `W2-005` §1)。
import { buildOrderCancelView } from '../../lib/orders/cancel-view';
import { PartialCancelItemControl } from './cancel-order-forms';
// 🔴 片6a-2:「卡住」的**唯一定義**在 `item-stuck.ts` —— **本檔不得自己再判一次**。
//    兩邊各判各的,症狀是**畫面自洽而互相矛盾**(卡是開的、旁邊卻沒有異常字),而不會有東西紅。
import { describeItemStuck, resolveItemStuck } from '../../lib/orders/item-stuck';
// 🔴 片7:採購從獨立一張卡搬進每張商品卡的展開區(理由與邊界在該檔檔頭)。
import {
  ItemProcurementBlock,
  ItemProcurementOrderNotices,
} from './item-procurement-section';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';
import type { OrderItemReceiptRow } from '../../lib/orders/receipt-repository';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';

// 🔴 葉元件與純判斷(三軸小元件 / `resolveAmountEditBlock` / 兩個 colSpan 常數 / 總計區)
//    2026-08-24 拆檔片整塊搬到 `order-detail-items-support.tsx`(鐵則 6:本檔當時 591 行)。
//    各段註解逐字跟著走,含片 A-1 檔頭承接那一整段 —— 要考古去那裡。

export function ItemsTable({
  detail,
  payments,
  returnTo,
  suppliers,
  suppliersFailed,
  cancelFormsAllowed,
  receiptRows,
  shipmentGroups,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
  /**
   * 🔴 片7:採購那一層搬進每張卡的展開區之後,這三個 prop 是**跟著它一起搬過來的**,
   *    不是本表格自己要用的東西。
   *    `returnTo` 的不可信任性質與白名單檢查一個字沒變(action 端一律再過 `parseOrderReturnTo`)。
   */
  returnTo: string;
  suppliers: readonly SupplierOption[];
  suppliersFailed: boolean;
  /**
   * 片C(取消介面搬家):這一次渲染准不准出現取消控制項 —— 與 `OrderCancelBlock` 吃的
   * `formsAllowed` 是同一顆值(`order-detail.tsx` 往下傳),語意與 fail-closed 立場一併沿用:
   * 缺省 `undefined` ⇒ `=== true` 為 false ⇒ **不給**,不是「照常給」(理由見 `order-cancel-block.tsx`
   * 同名 prop 的檔頭:忘記接的症狀不能是「靜默把控制項開回去」)。
   */
  cancelFormsAllowed?: boolean;
  /** `#450` 逐筆到貨(`null` = 讀不到 / 被截斷)。**必填無預設**, 只轉手不看內容。 */
  receiptRows: readonly OrderItemReceiptRow[] | null;
  /** `#450` 包裹分組(`null` = 讀不到)。**必填無預設**, 只轉手不看內容。 */
  shipmentGroups: readonly OrderShipmentGroup[] | null;
}) {
  const amountEditBlock = resolveAmountEditBlock(detail, payments);
  // 🔴 兩道都要成立才給取消控制項(與 `OrderCancelBlock:63` 的 `showForms` 同一組判準,
  //    這裡是逐品項那一半,不重算不同的規則):①判定說這張單可以取消
  //    ②這次渲染准不准出現表單(結果頁不給,見 `cancelFormsAllowedOnResultPage`)。
  // 🔴 片 B:判定要吃收款三態(現金/匯款可取消、刷卡不行)。`payments` 本表本來就收著
  //    (它同時是金額編輯那一塊的輸入)⇒ 這裡零新增 prop,只是把它接進判定。
  const cancelView = buildOrderCancelView({ ...detail, payments });
  const showCancelControls = cancelView.canCancel && cancelFormsAllowed === true;
  // orderItemId → CancelItemView(帶 maxCancellable),給下面逐列查 —— `detail.items` 與
  // `cancelView.items` 是同一份 order 算出來的兩份陣列,用 id 對齊。
  const cancelItemById = new Map(cancelView.items.map((item) => [item.orderItemId, item]));
  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';
  /**
   * 🔴 片6a-1:**表格 → 表頭列 + 每個商品一張可展開的卡**。
   *
   * **依據**:Sean 2026-08-19 看兩張真畫面後逐字選「**甲 = 一個商品一張卡片,沒有表格**」;
   * 而設計稿 08-17「720 側邊欄確認稿」`:280-299` 畫的正是 `.ihead` 表頭列 + 每列一個
   * `<details class="icard">`(**零 `<table>`**)⇒ 他的答案與設計稿同一個東西。
   *
   * **搬的是哪一份**:`~/.claude/projects/…/tool-results/artifact-c3c6cc94-1786959567-bf41.html`
   * (669 行 / **mtime 2026-08-17 18:39**)。⚠️ **不是 Aug-13 那份**(那份 class 叫 `.pcard`,已過期)。
   *
   * 🔴 **三處刻意偏離,都不是漏搬**(逐條理由在 `globals.css` 片6a-1 那段):
   *   ① 膠囊**方角**(設計稿是 `999px` 圓角;Sean 08-16 拍「方角、全站統一沒有例外」)
   *      🔴 **2026-08-23 晚:這一條的【前提】被 Sean 自己推翻了(原句不改,加註)** ——
   *      他逐字裁「乙 不算了 —— 照 OD 新稿,**全部圓角**」,線A 已把 `--radius` 由 0 改成 8px。
   *      ✅ **而這顆膠囊【已經回圓了】,不是待辦** —— 線A 同日搬 OD 樣式(FIX-37)時一起進來的。
   *      **我自己 grep 過,不是聽來的**:`globals.css:1961` 逐字
   *      `.pcm-step .pcm-pill {border-radius:9999px}`。
   *      ⚠️ 所以上面那句「膠囊**方角**」**現在是假的** —— 而**本檔一個字都沒改、也沒有東西會紅**,
   *      因為那個值住在 `globals.css`(線A 獨佔),不在這裡。
   *      🔴 這正是本片反覆撞到的同一個形狀:**「我確認過這個 class」不等於「我確認過它會畫出什麼」。**
   *   ② **六軌**(設計稿五軌無單價;Sean 08-19 逐字「要顯示」)
   *   ③ **總計那一區留著** —— 設計稿 `grep '運費|總計'` ⇒ **零命中**,而我方有小計/運費/折扣/總計。
   *      **「設計稿沒畫」不等於「該刪掉」** ——拿掉會刪掉真的資訊。
   */
  return (
    <div className='rounded-lg border bg-card p-4'>
      {/* 🔴 FIX-03(OD):**這張卡原本沒有標題,這次補上** —— 逐字「商品明細(原本這張卡沒有標題,
          這次補上)」。字級走 OD 壓縮後的**卡片標題**那一級,與摘要卡的 `CARD_TITLE`
          (`order-detail-summary-cards.tsx`)逐字相同 —— FIX-03 的整條要求就是「四種標題壓成兩種」,
          所以這裡**不得自創第三種寫法**。
          🔴 **位置在 `.ihead` 之前**:`order-detail-items-table-shape.test.tsx` 的欄名那格用
             `<div className='ihead'>…</div>\s*<ItemAmountRowGroup>` 抓表頭,插在那兩者中間會抓不到。
             ⚠️ 而那不是我把它擺這裡的**理由** —— 卡片標題本來就該在卡的最上面;
                寫下來只是免得下一個人以為那個位置是隨便挑的。 */}
      {/* 🔴 **R2 MF-B(審查抓):`mb-3` → `mb-2`。而值得記的是【那句宣稱在同一份 diff 裡就變假了】。**
          上面那段寫「與摘要卡的 `CARD_TITLE` **逐字相同** —— 這裡不得自創第三種寫法」,
          而**同一片**的 FIX-02 把 `CARD_TITLE` 從 `mb-3` 壓成 `mb-2`
          (`order-detail-summary-cards.tsx:102`)⇒ **我寫下那句的時候它是真的,
          而我在同一次改動裡把它弄假了,兩處相隔 284 行。**
          量法(可重跑):`grep -rho 'mb-[0-9] text-xs font-bold tracking-\[1.5px\]' apps/admin/src | sort | uniq -c`
          ⇒ 修前 `mb-2` 1 / `mb-3` 1(FIX-03「四種標題壓成兩種」沒達成);修後應為 `mb-2` 2。
          📌 判別句:**「與 X 逐字相同」是一句會被【別處的改動】弄假的宣稱,而它不會有東西紅。**
             寫這種句子時,要嘛同片一起改、要嘛把數法寫在旁邊讓下一個人量得出來。 */}
      <h2 className='text-muted-foreground mb-2 text-xs font-bold tracking-[1.5px]'>商品明細</h2>

      {/* 🔴 片7:**對整張單說的**那兩則(品項被截斷 / 供應商清單載入失敗)留在這裡、只出現一次。
          搬進卡片裡會變成同一句話出現 N 次,而「供應商清單載入失敗」講的是整個選單壞了,
          不是某一項的事。理由全文在 `ItemProcurementOrderNotices` 檔頭。 */}
      <ItemProcurementOrderNotices detail={detail} suppliersFailed={suppliersFailed} />

      {/* ══ 🔴🔴 「看得完整」這句話,在這一區推出過【兩個方向相反的動作,而兩個都對】══════════
           (2026-08-19 落;片7 / 片16 / 片17 / 高度量測四片的公因數。**落在這支檔是刻意的**:
            下一個人只會讀到其中一片,而**單獨讀任一片都會學成一條會打架的規則**,
            而不論他碰哪一片,都會經過這支檔。)

           Sean 逐字:「**看得完整**,但佔高度」
           ```
           片7  採購從獨立的一張卡【搬進】品項卡，有採購資料的卡【預設展開】 ⇒ 讓他看得到
           片17 那份「新增採購」空表單【收起來】                              ⇒ 反方向
           高度量測 商品區佔面板 62%，而【不壓它】                            ⇒ 又是反方向
           ```
           🔴 **判準(它讓三者不打架)**:
              **「看得完整」指的是【已經存在的事實要看得到】,不是【所有能做的動作都攤開】。**
              · 採購那幾列 = **事實**(這一項向誰訂了、到了幾件)⇒ 攤開
              · 新增採購表單 = **一個還沒發生的動作** ⇒ 收起來,要做的時候再點
              · 商品那 12 張卡 = **事實** ⇒ 不壓,即使它佔 62%

           📌 **而第二個維度是【頻率】,不是「填 vs 看」**(2026-08-19 主視窗自我修正):
              同一條「表單預設收起」用在不同頻率的動作上,一個是省事、一個是加班。
              · 採購表單:一張單訂一次貨 ⇒ 收起來的代價是偶爾多一下
              · 🔴 收款登錄:**每天**(M-4b 北極星「員工的一天」的核心動作)⇒ **不收,即使它很高**
                (它今天已經是收著的,那是既有決定,不是本族推出來的)

           🔴 **而高度不是目的,是代價**:他**明說接受高度**。
              「壓回 2-3 螢幕」那個數字是我們自己編的,**他沒說過**。
              ⇒ 目標是他那句話,不是那個數字。**壓數字壓到員工每天多點十下,
                 是把成本從版面移到人身上 —— 而版面的成本量得到,人的成本量不到。**

           📎 逐區高度實量與「量完決定不動」的完整紀錄:
              `docs/probes/2026-08-19-order-panel-height-composition.md` */}

      {/* 🔴 表頭列與每一列**必須共用同一組軌道**(`.ihead` / `.iline` 在 CSS 裡是同一條規則)。
          設計稿 `:119-120` 自己記著:兩個獨立 grid 的 `auto` 欄各自依內容算寬
          (「數量」2 字 vs 「×2」)⇒ **實測整排錯開 8px**。**那是會靜默錯開、沒有東西會紅的東西。** */}
      <div className='ihead'>
        <span>商品名稱</span>
        <span>料號</span>
        {/* 🔴 丙案:「訂 / 到 / 出」三個字**住在欄頭**,不再跟著每一列重複三次
            (Sean 選的;設計稿 `:280` 註解逐字「② 商品:五欄 + 丙案三軸」)。 */}
        <span className='three'>
          <span>訂</span>
          <span>到</span>
          <span>出</span>
        </span>
        <span className='text-right'>數量</span>
        <span className='text-right'>單價</span>
        <span className='text-right'>小計</span>
      </div>

      <ItemAmountRowGroup>
        {detail.items.map((item) => {
          // 🔴 **三個世界,不是兩個**(`item-stuck.ts` 檔頭逐字):`unknown` **不是「不卡」的一種**。
          //    靜靜當成 `not-stuck` ⇒ 卡住的那一項不會自己打開,**而畫面看起來完全正常**。
          //    ⇒ 所以下面兩件都要做:①只有 `stuck` 才自動展開 ②`unknown` 的話**把話講出來**。
          const stuck = resolveItemStuck(item.procurements, item.procurementTruncated);
          const stuckNote = describeItemStuck(stuck);
          /**
           * 🔴 片7:**這一項有沒有採購資料** —— 給「預設要不要展開」用,**不是**在判「卡住了沒」。
           *
           * ⚠️ 本檔有一格守門明文禁止**自己判卡住**(`order-detail-items-table-shape.test.tsx`
           *    的「自己判」那格,禁 `procurements.find|some|filter|length`)。
           *    **這一行不是那件事** —— 它問的是「有沒有列」,而「卡住」的定義仍然**只有**
           *    `item-stuck.ts` 一處。取個名字寫在這裡,是為了讓下一個人一眼看出這兩件事不同,
           *    **而不是靠我的寫法剛好躲過那個 regex**。
           * 🔴 `procurements === null`(讀不到)⇒ `?? []` ⇒ **false** ⇒ 歸「收起」那半。
           *    那是刻意的:讀不到**不是資料**。
           */
          const hasProcurementRows = (item.procurements ?? []).length > 0;
          // 🔴 片C:`cancelItemById` 沒有這個 id 或這張單根本不給取消 ⇒ 不畫 —— 交給
          //    `PartialCancelItemControl` 自己再判一次 `isItemSelectable`(fail-closed,
          //    呼叫端算錯也不會漏放行)。undefined 時不渲染,不是渲染一個 disabled 的假控制項。
          const cancelItem = showCancelControls ? cancelItemById.get(item.id) : undefined;
          return (
          <ItemAmountRow
            key={item.id}
            variant='card-line'
            colSpan={ITEMS_TABLE_COLSPAN}
            cancelControl={
              cancelItem === undefined ? null : (
                <PartialCancelItemControl
                  orderId={detail.id}
                  item={cancelItem}
                  itemName={item.title ?? undefined}
                />
              )
            }
            /* 🔴🔴 片6a-2:**缺料那一項自己打開**(設計稿 `MAIN-057 §1` 區塊② 逐字
               「這一項【展開】了(卡住的那一項會自己打開)」)。
               判斷來自 `item-stuck.ts` 的**唯一定義**,本檔零判斷邏輯。
               ⚠️ **依據標弱,不得寫成「Sean 已批」**:他選的是「卡片 vs 表格展開列」,
                  而**自動展開在兩張原型裡是常數、不是變數** ⇒ 他**看過而沒有反對**,不是選了它。
                  ⇒ 已列成肉眼題,等他在真環境看。 */
            /* 🔴🔴 **片7:預設展開的條件從「只有缺料」放寬成「缺料【或】已經有採購資料」**
               —— 主視窗 2026-08-19 裁,而**依據是 Sean 自己的字**:
               他選卡片版時逐字說「**看得完整**,但佔高度」⇒ **他接受的是【高度】,不是【多點一下】**。
               ⇒ 全部收起來等於把他接受的代價換成一個他沒被問過的代價,而換完之後畫面**反而不完整**
                 —— 那正是他選甲要避開的東西。
               ⚠️ **沒有採購資料的維持收起**:那格展開是空的,展開它不叫「看得完整」。
               🔴 `procurements === null`(讀不到)**歸在「收起」那半** —— 它不是資料。
                  而那不會讓警告消失:`describeItemStuck` 那行字在卡頭底下、**不依賴卡片開不開**。 */
            defaultOpen={stuck.kind === 'stuck' || hasProcurementRows}
            /* 🔴 片16(2026-08-19):品牌那一行 —— 確認稿 `:291`/`:304`/`:317`
               `<div class="ibrand">BREMBO</div>`,畫在 `<summary>` 裡、`.iline` grid **上方**、
               **橫跨整列**(`:137` CSS)。⇒ **不是第七軌,六軌一格沒動。**
               🔴 **`null` ⇒ 整行不印,不印 `—`**(型別 docstring 有完整理由):
                 `variant_id` 為 null 的手 key 單本來就沒有品牌 ⇒ **缺值不是異常**,
                 印一條空標籤行只是多一條沒有意義的留白。
                 ⚠️ 而這與同一片的「收件人資訊缺值要印 `—`」**刻意相反** —— 那裡缺值是異常、要看得出來。
                 **判準是「缺值本身算不算一個需要被看見的事實」,不是憑感覺挑一種。** */
            brandLine={item.brand === null ? null : <div className='ibrand'>{item.brand}</div>}
            before={
              <>
                {/* 🔴🔴 **codex 關卡2 must-fix 4**:上一版把橫向捲動拿掉(`overflow-x-auto` 隨表格一起沒了)
                    **同時**加了三處 `truncate`,而**沒有給任何看到完整值的路** ——
                    長料號 / 長規格會變成**畫面上讀不出來的資訊**。**那是行為退化,不只是版面改動。**
                    ⇒ 修法三件:
                      ① 品名與料號補完整值的逃生門——
                         **這不是我發明的**:Aug-13 設計稿 `:1027` 逐字 `<span class="nm" title="${l[3]}">`。
                      ② **規格那一行不截斷,讓它換行** —— 它是次要行,換行零資訊損失。
                      ③(料號欄仍用原生 `title`,見下方 :variantSku 那格)。
                    🔴🔴 **2026-08-21 更新(Sean 逐字拍板「維持切字,hover 要看得到完整的字」)**:
                       **品名這一格換掉原生 `title`**,改用 `ItemNameCell`(app 內 Tooltip 元件)——
                       原生 title 由 OS 畫、不進 DOM,寫不出「拿掉會紅」的守門(見該檔檔頭)。
                       🔴 **料號欄刻意不動**(W4 nit N1 審過同意):正式庫 `product_variants`
                       最長 sku 65 字、超過 20 字的有 1170 件(分母 51647),而料號欄實測寬
                       158px 會截斷——同一列會變成「hover 品名有反應、hover 料號沒反應」,
                       比兩個都沒有更困惑。**這不是漏改**,是 Sean 這次只要求品名、擴大範圍
                       要他拍板(主視窗開 backlog 追蹤)。 */}
                <div className='min-w-0'>
                  {item.title ? (
                    <ItemNameCell title={item.title} />
                  ) : (
                    <div className='truncate text-[13px]'>—</div>
                  )}
                  {item.spec && (
                    <div className='text-muted-foreground mt-0.5 text-xs'>
                      {Object.entries(item.spec)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(' · ')}
                    </div>
                  )}
                  {/* 三軸缺值時,原因講在這裡(只講一次)—— 見 `ItemAxisMissingNote` 檔頭。 */}
                  <ItemAxisMissingNote summary={item.quantitySummary} />
                  {/* 🔴 片6a-2:卡住的原因、以及**判不出來**的兩種原因,都畫在這裡。
                      `describeItemStuck` 對 `not-stuck` 回 `null` ⇒ **只有那一種可以沉默**
                      (我們確定它沒卡住);其餘兩種都必須出聲。 */}
                  {stuckNote !== null && (
                    <div
                      className={
                        stuck.kind === 'stuck'
                          ? 'text-destructive mt-0.5 text-xs'
                          : 'text-muted-foreground mt-0.5 text-xs'
                      }
                    >
                      {stuckNote}
                    </div>
                  )}
                </div>
                {/* 🔴 FIX-04(OD):**料號拿掉 `font-semibold`** —— 症狀逐字:
                    「料號用 `font-mono text-xs font-semibold`(等寬＋加粗),比品名還搶眼,
                     眼睛先讀到料號」⇒ **品名才是錨點**。
                    ⚠️ **`font-mono` 留著**:等寬是料號**讀得準**的理由(對位、分得出 0 與 O),
                       不是它搶眼的理由。OD 那條只動 `font-semibold` 一個 token。
                    ⚠️ **原生 `title` 一個字沒動**(FIX-69「會截的欄要有看到全名的路」那一半);
                       料號欄刻意不換成 Tooltip 元件,理由在上方 `ItemNameCell` 那段。
                    🔴 **FIX-04 的另一半(品名 `text-[13px]` → `text-sm font-medium`)本片【沒做】**:
                       品名那一格是 `ItemNameCell`(另一支檔),不在本條線獨佔的三支裡。已列進回報。 */}
                <div
                  className='text-muted-foreground truncate font-mono text-xs'
                  title={item.variantSku}
                >
                  {item.variantSku}
                </div>
                {/* 🔴 三軸:一格一軸,分母永遠是 `summary.quantity`(在 `ItemAxisValue` 裡)
                    ⇒ 三格的分母不可能各自漂掉。
                    🔴 `pcm-pill` 的寬度來自 `--pcm-pill-w`,**與欄頭那三格同一個變數** ——
                       那是設計稿記的 8px 坑的修法本體,不要改成寫死的數字。 */}
                <div className='pcm-step'>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.orderedQuantity} />
                  </span>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.instockQuantity} />
                  </span>
                  <span className='pcm-pill'>
                    <ItemAxisValue summary={item.quantitySummary} pick={(q) => q.shippedQuantity} />
                  </span>
                </div>
                <div className='text-right text-xs tabular-nums'>
                  {item.quantity}
                  {/* 「已取消」掛在數量底下 —— 它是例外不是第四軸,見 `ItemCancelledNote` 檔頭。 */}
                  <ItemCancelledNote summary={item.quantitySummary} />
                </div>
              </>
            }
            priceText={<>NT$ {formatOrderAmount(item.unitPrice.amount)}</>}
            after={
              <div className='text-right text-[13px] font-bold tabular-nums whitespace-nowrap'>
                NT$ {formatOrderAmount(item.lineTotal.amount)}
              </div>
            }
            // 🔴 版本用**訂單層**的 `detail.version`,不是品項的 —— RPC 的樂觀鎖比 `v_ord.version`。
            orderId={detail.id}
            expectedVersion={detail.version}
            orderItemId={item.id}
            currentUnitPrice={item.unitPrice.amount}
            returnTo={`/orders/${detail.id}`}
            // 🔴🔴 **重構時最容易掉的就是這一行** —— 它是 `unreadable` 的 fail-closed 出口,
            //    也是「已收款 ⇒ 不得改金額」那道全站唯一的閘走到畫面上的最後一段。
            //    主視窗 2026-08-19 裁本片中鐵則 12①,用的就是這個理由:
            //    **一道閘在殼被重寫的過程中被漏掉,不會有東西紅。**
            blockedReason={amountEditBlock}
            /* 🔴 片7:展開區裡、改金額表單【之上】的那一層 = 這一項的採購與到貨。
               ⚠️ 它**永遠**渲染(只要卡片是開的),與「有沒有點改金額」無關 ——
                  兩個狀態的分家在 `item-amount-row.tsx` 的 `amountEditId` 那段。 */
            body={
              <ItemProcurementBlock
                receiptRows={receiptRows}
                shipmentGroups={shipmentGroups}
                detail={detail}
                item={item}
                returnTo={returnTo}
                suppliers={suppliers}
              />
            }
          />
          );
        })}
      </ItemAmountRowGroup>

      {/* 🔴 小計/運費/折扣/總計 —— 2026-08-24 拆檔片整塊搬到 `order-detail-items-support.tsx`
          (`ItemsTotals`),FIX-05 的字面與「錨點不該被弄丟」那段逐字在那裡;
          呼叫端守門見 `order-detail-items-totals-wiring.test.tsx`。 */}
      <ItemsTotals detail={detail} />
    </div>
  );
}
