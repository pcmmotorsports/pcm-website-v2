import Link from 'next/link';
import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
/* 🔴🔴 **片4a 搬家留下的 11 個死 import 已一次清完**(2026-08-16 片4c)。
   `GoodsAxisValue` 與四張摘要卡在片4a 搬進 `order-detail-summary-cards.tsx`,
   **而它們用的 import 全部留在這裡沒跟著走。** 清掉的 11 個:
     `PAYMENT_STATUS_LABEL` `GOODS_AXIS_LABEL` `ORDER_SOURCE_LABEL` `PAYMENT_CHANNEL_LABEL`
     `formatOrderAmount` `INVOICE_STATUS_LABEL` `customerEmailDisplay`
     `invoiceTypeLabel` `shippingMethodLabel` `orderDetailGoodsAxis` `goodsAxisProgressNote`
   **數法**:`for s in <每個符號>; do grep -c "$s" <本檔>; done` ⇒ 全部 **1**(只命中 import 行本身)。
   留下的只有 `formatOrderDateTime`(實得 3)。

   ⚠️ **`lint --force` 18/18 全綠抓不到它們** —— `eslint.config.js` 全檔 `grep -n unused` 零命中,
      沒有 `no-unused-vars` / `unused-imports` 規則 ⇒ **結構上抓不到,不是這次剛好沒抓到。**
   🔴 **真實傷害不是體積**:code-reviewer 找「軸的消費者」時命中這裡,據以判斷本檔是第二個消費者
      —— **一個不存在的消費者比沒有消費者更花時間。**
   🔴🔴 **而我第一版【只清了被指名的那 2 個】** —— 同一批、同一次搬家、同一種傷害的另外 9 個
      原封不動,是下一輪 code-reviewer 抓的。**finding 是症狀的位置,不是病的邊界。** */
import { formatOrderDateTime } from '../../lib/orders/order-detail-view';
// 片2 標頭列:兩個標籤表都是**既有的**,本片零新增詞彙(理由見 `OrderHeadChip` 那段)。
import { PAYMENT_STATUS_LABEL, formatOrderAmount } from '../../lib/orders/order-list-view';
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
import { DangerZoneDetails } from './danger-zone-details';
import { ItemProcurementSection } from './item-procurement-section';
import { ItemsTable } from './order-detail-items-table';
import { OrderSummaryCards } from './order-detail-summary-cards';
import { OrderCancelBlock } from './order-cancel-block';
import { ShipmentSection } from './shipment-section';
import { RefundSection } from './refund-section';
import { RefundLedgerSection } from './refund-ledger-section';
import { shouldShowRefundEntry } from './refund-entry-gate';
import type { PaymentListData } from './payment-list';
import { PaymentSection } from './payment-section';
import { generateRefundRequestToken } from '../../lib/payment/refund-action-state';
import type { OrderRefundRow } from '../../lib/payment/refund-read';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';

// M-4a Slice B:訂單明細(server-render、唯讀;狀態/出貨/發票的「改」= Slice C 寫入片)。
// M-4b E10 A9w1(P3 九碼退場):本頁的九碼**全部下架** —— 品項列的 `ItemWorkflowStatusCell`
// 與 header 的整單彙總 badge(`summarizeOrderItemWorkflow` + `workflowStatusBadge`)一併移除,
// 品項列改顯示 A9g-1 三軸數量摘要;`statusOptions` prop 隨之消失(頁層不再讀狀態詞彙)。
// 列表側的九碼 cell 當時**不在本片** —— 🏁 已於 **A11a-1(2026-08-06)**隨列表重建退場。
// ⚠️ 上一段提到的 `summarizeOrderItemWorkflow` / `workflowStatusBadge` 兩個具名**現已不存在**
// (A11a-1 同片刪);保留這段是歷史敘述,別照著去 grep。
// 🔴 PII 邊界:本頁顯示客人姓名/電話/email+收件快照(admin-only、service_role、明細專用白名單);
// 仍零成本/經銷價(品項單價=該單成交價)、零 tappay_rec_trade_id。

// M-3 RW2d:退款入口的**顯示層**狀態閘(權威在 RPC 步 5 白名單 `20260803150000:530-532`:
// paid/partiallyRefunded 可退、refunded 回 LEDGER_FULL、其餘 NOT_REFUNDABLE)——
// 🔴 判斷本體與 `REFUND_ENTRY_STATUSES` 已於 **#445a-3** 搬到 `refund-entry-gate.ts`,
//    理由:445a-3 讓「未登記額讀取失敗」變成每張單都可達的狀態,那個閘需要 oracle,
//    而純判斷不該為了被測而在測試裡 mock `server-only`。**邏輯未變,只是換了位置。**

/**
 * A9w1:品項列的三軸顯示(取代九碼 `ItemWorkflowStatusCell`)。
 *
 * 資料源 = A9g-1 的 `quantitySummary`(`order_item_quantity_summary` 衍生快取,A4a trigger 維護)。
 * 🔴 `null` 的意思是「不知道」,**不是**「都是 0」(`packages/domain/src/order/types.ts:477-501` 逐字:
 *    品項從未被採購也從未被取消時根本沒有那一列)⇒ 這裡顯示「數量資料尚未就緒」、**不補 0**。
 *    純顯示補 0 的最壞後果只是少顯示資訊,但同一個 `?? 0` 一旦被抄進取消流程就會放行超量取消
 *    ⇒ 這一格從一開始就不留那個寫法可抄。
 * 🔴 **出貨軸本片仍不畫,但理由已經換了(L0,2026-08-13)**:
 *    ⚠️ 這段原本寫「`shipped_quantity` **目前不存在**」—— **那句現在是假的**:
 *    L0 已把它補進 `AdminOrderItemQuantitySummary` 與兩條投影(DB 側自 B2-S2b 就有)。
 *    🔴 留著錯字面的代價是具體的:下一個做狀態八值的人 grep 到這句,會得出
 *    「欄還沒有、要先做前置」的**反向結論**,而欄已經在手上。
 *    ⇒ 現在的正確理由是:**本片(明細頁)沒有要畫它**,不是拿不到它。
 */
/**
 * A10a-3:`?correct=<id>` → 表單更正模式的目標(含原型別 = MF1 radio 初值;節錄 40 字供辨認)。
 * 解析不到(不在已載入集合 —— 截斷後的書籤/返回、或已被更正 —— 並行 session 先更正了)
 * → 回 null,呼叫端**必須**顯示警告、不得靜默當一般新增(MF2);
 * RPC 端 `ALREADY_CORRECTED` / `CORRECTS_NOT_FOUND` 為第二道。
 */
function resolveCorrectTarget(
  detail: AdminOrderDetail,
  correctNoteId: string | null,
): CorrectTarget | null {
  if (correctNoteId === null) return null;
  const index = detail.notes.findIndex((note) => note.id === correctNoteId);
  const note = index === -1 ? undefined : detail.notes[index];
  if (!note || !canCorrectNote(note)) return null;
  const chars = [...note.body];
  return {
    id: note.id,
    seq: index + 1,
    noteType: note.noteType,
    typeLabel: NOTE_TYPE_LABEL[note.noteType],
    excerpt: chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : note.body,
  };
}

/**
 * 片2:標頭的付款狀態 chip(設計稿 §1 那顆紅色 `[未收齊]`)。
 *
 * 🔴🔴 **字面用既有的 `PAYMENT_STATUS_LABEL`,【不是】設計稿的「未收齊」—— 這是刻意的偏離。**
 *    設計稿寫「未收齊」,而 `partiallyPaid` 這一格的字面 **Sean 2026-08-18 才剛拍板過**
 *    (`Q3` = 「已收訂金」,`order-list-view.ts:170-176` 逐字記著理由:
 *     ~~付款確認中~~ 讀起來像「錢在路上」⇒ 員工不會去催尾款)。
 *    ⇒ 在**同一張畫面**上,標頭寫「未收齊」而下方付款卡寫「已收訂金」= 兩個詞指同一件事,
 *      那正是他抱怨過的「同一張單畫面講三句相反的話」。
 *    ⇒ **本片不引入第六個詞。** 要不要改成「未收齊」是 Sean 的題(已回報主視窗),
 *      改的話是**一行**的事,而且要**兩處一起改**。
 *
 * 🔴 **顏色的判準是「還欠不欠錢」,不是 enum 名字**:`unpaid` 與 `partiallyPaid` 都還欠錢 ⇒ 紅;
 *    其餘(含 `refunded` / `partiallyRefunded`)不紅 —— 退款單不該掛一顆催款色的 chip。
 *    ⚠️ 這個判準與 `order-edit-pay-axis.ts` 的三值軸**同語意但不共用**:那支服務改單矩陣、
 *       本處只決定一個顏色。**不要把顏色接到那支上去**,它的 `refunded ⇒ paid` 是為了
 *       「別讓改單以為這張單沒收過錢」,拿來決定顏色會是巧合對、不是同一個問題。
 */
function OrderHeadChip({ detail }: { detail: AdminOrderDetail }) {
  const owing = detail.paymentStatus === 'unpaid' || detail.paymentStatus === 'partiallyPaid';
  return (
    <span
      // 🔴 `shrink-0`(`W6-019` M1):它在標頭那一列裡,而**沒有它的東西會被【安靜壓扁】而不是溢出**。
      //    壓扁不像壞掉、像設計 ⇒ 連「拿去真瀏覽器給人看」那道驗證都騙得過去。
      className={`inline-flex shrink-0 rounded-md px-2.5 py-0.5 text-xs font-medium ${
        owing ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      }`}
    >
      {PAYMENT_STATUS_LABEL[detail.paymentStatus]}
    </span>
  );
}

export function OrderDetail({
  detail,
  returnTo,
  correctNoteId = null,
  suppliers = [],
  suppliersFailed = false,
  refundEnabled = false,
  refunds = [],
  refundsFailed = false,
  refundsTruncated = false,
  refundUnregisteredAmount = null,
  refundUnregisteredFailed = false,
  cancelFormsAllowed = false,
  customerHref = null,
  payments,
}: {
  detail: AdminOrderDetail;
  /**
   * #350d C1:這個視圖自己的網址,逐支表單當 `return_to` hidden 欄位送出。
   * 🔴 **必填、無預設**:給預設值等於「忘了接就靜默回整頁版」——面板裡的動作會把面板關掉,
   *    而那個症狀在測試裡看起來完全正常(頁面是對的、只是視圖換了)。逐條理由見 `order-return-to.ts`。
   */
  returnTo: string;
  /** A10a-3:`?correct` searchParam(頁層過 uuid 閘後下傳) */
  correctNoteId?: string | null;
  /** A10b:S3a 供應商選單(啟用中、zh-TW 排序) */
  suppliers?: readonly SupplierOption[];
  /** A10b:供應商清單載入失敗(不靜默;見 item-procurement-section) */
  suppliersFailed?: boolean;
  /** M-3 RW2d:退款入口旗標(頁層讀 `isRefundUiEnabled()` 下傳;預設 off)。 */
  refundEnabled?: boolean;
  /** M-3 RW3:退款帳本列(頁層讀;顯示不吃旗標 —— 既成事實必須可見)。 */
  refunds?: readonly OrderRefundRow[];
  /** M-3 RW3:帳本讀取失敗(區塊顯警告 + 發起入口 fail-closed,codex MF2)。 */
  refundsFailed?: boolean;
  /** M-3 RW3:帳本列被上限截斷(codex MF1)。 */
  refundsTruncated?: boolean;
  /** M-3 RW3:`pcm_order_refundable_remaining`(措辭鐵律=「帳本未登記額」)。 */
  refundUnregisteredAmount?: number | null;
  /** M-3 RW3:未登記額讀取失敗(顯錯誤態≠查無 + 發起入口 fail-closed,codex MF2)。 */
  refundUnregisteredFailed?: boolean;
  /** A13b D6-a:這一次渲染准不准出現取消表單。**預設 fail-closed**,逐條理由見 `OrderCancelBlock`。 */
  cancelFormsAllowed?: boolean;
  /**
   * OD 片 3b:標題列「客人明細」入口的連結;**`null` = 不渲染入口**(需求檔 §0-J J-4)。
   *
   * 🔴 **由呼叫端決定連去哪**,本元件不知道自己在面板還整頁版裡(它同時被兩邊渲染):
   *    面板版 = `?panel=<單>&customer=<客>`(客人卡蓋上來);整頁版 = `/customers/<客>`。
   * 🔴 **`null` 必須真的不渲染**(fail-closed):`AdminOrderDetail.customerUserId` 在投影退版時
   *    是 `null`,而拼網址的決定點在 `order-detail-view.ts` 的 `customerDetailHref()` ——
   *    拼不出來就回 `null`,這裡照著不畫。**不得 `?? ''`、不得畫一個連到 `/customers/null` 的連結。**
   */
  customerHref?: string | null;
  /**
   * #15-B2-c 片1a:收款明細三態(頁層讀 `listOrderPayments` 折出來)。
   *
   * 🔴 **必填、無預設**(同 `returnTo` 的立場):給預設值等於「忘了接就靜默顯示成某一態」——
   *    而這裡任何一個預設都會說謊:`ok/[]` 說「沒收過款」(員工照著再登一次 ⇒ 重複入帳)、
   *    `unreadable` 說「讀取失敗」(對一個其實讀得到的頁面亂報錯)。忘了接**必須編不過**。
   */
  payments: PaymentListData;
}) {
  const cancelled = detail.cancelledAt !== null;
  const correctTarget = resolveCorrectTarget(detail, correctNoteId);

  /**
   * 片12:退款帳本處於**對帳異常**態 ⇒ 那一塊不准收起來(codex K2 finding 3)。
   *
   * 🔴 判準用的是**與 `shouldShowRefundEntry` 那道 fail-closed 閘同一組輸入**
   *    (帳本讀不到 / 未登記額讀不到 / 未登記額為負),**不另立第二套語意** ——
   *    兩套會各自漂,而畫面上「入口消失」與「有沒有警告」就會對不起來。
   * 🔴 **刻意不含 `refundEnabled`**:旗標關著只是「這功能還沒開放」,不是「對帳出事」;
   *    把它算進來會讓每一張單都掛上紅字異常。
   */
  const refundLedgerAbnormal =
    refundsFailed ||
    refundUnregisteredFailed ||
    (refundUnregisteredAmount !== null && refundUnregisteredAmount < 0);

  return (
    <div className='space-y-4'>
      {/* ═══ 片2 標頭列 —— **單列**(逐字搬設計稿 `.hdr`)═══════════════════════
          **來源**:OD 專案 `pcm-admin-order-ui` / `overview-desktop.html`
          (`/Users/sean_1/Library/Application Support/Open Design/namespaces/release-stable/
            data/projects/pcm-admin-order-ui/overview-desktop.html`,**mtime 2026-08-13 16:16**)。
          ⚠️ **可能存在更新的一版而我們沒找到** —— Sean 提過有一份「昨天改過」的 artifact,
             主視窗已去問他;**在他回答之前照這一份做**。搬的是哪一份、哪一天,寫在這裡不寫在別處。

          **設計稿逐字(`:1105-1118`)**,由左到右:
            單號 · 付款 chip · 客人入口 · **金額** · 下單時間 · (彈性空白) · 狀態 chip · ⋯ · ✕
          **版面(`:219`)**:`height:38px; flex:0 0 38px; display:flex; align-items:center; gap:9px; padding:0 12px`

          🔴🔴 **上一版我把它做成【兩列】,那是錯的,而根因值得留**:
             我照的是 `MAIN-057 §1` 的 **ASCII 轉錄**,那張圖長兩行 ⇒ 我把它讀成設計。
             **而 ASCII 轉錄天生表達不了「這是換行」還是「這只是排不下才折」。**
             設計稿真正有 `flex-wrap:wrap` 的那一版在 `:553` 的 `@container (max-width:520px)`,
             而那個 media query 上方註解逐字「**手機 ≤520:標題列合併**」
             ⇒ **我把手機版的形狀套到桌機了**;面板固定 720 ⇒ **永遠不會命中 ≤520**。
             (Sean `A2` 拍板「員工用電腦」⇒ 桌機那一列才算數。)

          ✅ **裝得下,是量到的不是推的**:直接把設計稿當成能跑的 HTML 起 server 渲染,
             量它自己的 `.hdr` ⇒ **設計稿自己的面板是 674px(比我們鎖的 720 還窄)**、
             `flex-wrap: nowrap`、實測高 36px、**不換行**;
             餵最壞資料(長客名 + 七位數金額 + 長狀態)⇒ **彈性空白仍剩 120px**。
             ⚠️ 量具自檢:我第一把尺 `scrollWidth - clientWidth` 是**瞎的** ——
                flex 子元素預設 `flex-shrink:1` ⇒ 它們互相壓縮、不產生溢出 ⇒ 兩個世界印同一個 0。
                改量**彈性空白**才會動(荒謬長字 ⇒ 0 / 正常 ⇒ 119)。

          🔴 **`✕` 不在本元件**:關閉是**面板才有**的動作,而本元件同時被整頁版渲染。
             關閉連結由 `order-detail-route.tsx` 的 `BackLink` 畫、文案由各呼叫端傳。
             ⚠️ 已知偏離:設計稿的 `✕` 在**同一列最右**,而 `BackLink` 是**上方自成一行**。
             要同列得讓本元件收 `closeSlot` prop、兩個呼叫端各傳一份 ⇒ 跨元件手術,不屬本片。

          🔴 **設計稿有、本片【刻意不做】的一顆**:`:1116` 的 `⋯ 更多操作`。
             理由:**它是一個沒有行為的入口,做了會是死按鈕。**
             (與 Sean 2026-08-19 對包裹卡那四顆鈕拍「甲 = 不做」同一個理由。)
             ⚠️ **不寫成 TODO** —— TODO 讀起來像「快做了」,而它其實在等一個功能決定。

          🔴 **本片【拿掉】了上一版自己加的「發票」那一格**:設計稿標頭沒有它,
             而它與兩列標頭**同一個根因**(從 ASCII 推的)。鐵則 1:不反向遷就。
             ⚠️ 「標頭要不要顯示發票狀態」已列進 Sean 的肉眼題清單,**不是消失**。
             📎 而背景要一起帶:正式庫 19 張單**零張有發票**、三個欄位全空、零流程在填
                ⇒ **發票是【流程的缺口】,不是【標頭少一格】。不要用一個欄位替一個不存在的流程作代表。**

          🔴🔴 **本片改的是【兩個視圖共用】的標頭 ⇒ 整頁版 `/orders/[id]` 也跟著變,
             而【沒有人看過整頁版的畫面】** —— 已列進交件檔「需肉眼驗」清單,不要當成已驗。 */}
      {/* 逐字搬 `:219`:`gap:9px` / `height:38px` / `align-items:center` / **`nowrap`**。
          **不換算成 Tailwind 級距**(鐵則 1 禁翻譯)⇒ 用 `gap-[9px]` / `h-[38px]`。
          `min-w-0` 給下面的客人入口截字用:沒有它,長名字會把整列撐開而不是自己截。

          🔴🔴 **這一列每一顆都要 `shrink-0`,唯一的例外是客人名(`W6-019` M1)**:
             flex 子元素**預設 `flex-shrink:1`** ⇒ 空間不足時它們**安靜地互相壓扁,而不是溢出**。
             · 而 spacer 的 `flex-basis` 是 0 ⇒ **它本來就沒東西可縮** ⇒ 壓力全落到別人身上。
             · 更糟的是 **spacer 量到 0 之後【飽和】** ⇒ 分不出「剛好到邊」與「chip 和按鈕已經被壓爛」
               ⇒ **我用來判斷『裝不裝得下』的那把尺,在最需要它的時候失去判別力。**
             🔴 **而它會連下一道驗證一起騙過去**:我把長相交給「真瀏覽器 + Sean 的眼睛」,
                而**一列安靜壓縮的版面,在瀏覽器裡看起來就是「裝得下」——壓扁不像壞掉,像設計。**
             ⇒ 修完之後唯一可縮的只剩客人名(它 `truncate` 是設計好的),再不夠就**看得見地溢出**。 */}
      <div className='flex h-[38px] flex-nowrap items-center gap-[9px]'>
        <h1 className='shrink-0 text-2xl font-semibold'>{detail.displayId}</h1>
        <OrderHeadChip detail={detail} />
        {/* 🔴 入口位置照 OD `overview-desktop.html:1109-1112` 逐字:「客人明細的入口。
            **做在標題列的名字上**,因為那是『這張單是誰的』唯一會被讀的位置,
            員工要查電話/地址時眼睛本來就落在這裡。一下就開,不用先跳到客戶頁再搜尋。」
            ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
               這一句退場文案是**我自己決定的**,OD 沒有畫這個狀態。 */}
        {/* A9w1:整單九碼彙總 badge 退場。付款軸(三軸的訂單層)在下方「付款」卡的付款狀態,
            訂貨/到貨在品項列 —— 不另補一顆彙總 badge,那正是九碼被退場的東西。 */}
        {/* 🔴 `rounded-md` 不是 `rounded-full`:Sean 2026-08-16 拍板「狀態膠囊改方角,
            全站統一、沒有例外要記」(memory `project_0816-sean-morning-13-rulings.md:22` Q5、
            `project_0816-evening-five-rulings.md:33` 再確認)。
            ⚠️ **這一顆是漏網的** —— 列表那邊 08-16 已改(`orders-table.tsx` 的 `rounded-full` 現為 0),
               而本檔這顆沒跟上,且 `design-tokens.test.ts` **沒有任何一條在管 `rounded-full`**
               (STATUS.md Blocker 欄逐字記著這件事)⇒ 它不是被放行,是**根本沒有那道門**。
               本片只改我正在動的這一顆,**不順手掃全樹的 18 處**(那是另一片、要自己的分母)。 */}
        {/* 🔴 客人入口 —— OD `:1110-1111` 逐字:「客人明細的入口。**做在標題列的名字上**,
            因為那是『這張單是誰的』唯一會被讀的位置,員工要查電話/地址時眼睛本來就落在這裡。」
            設計稿的形狀是 `<button class="cus cuslink">${o.cus}<span class="ci">›</span></button>`(`:1112`)。
            ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
               **這句退場文案是我自己決定的,OD 沒有畫這個狀態。**
            🔴 `truncate` + `min-w-0`:長名字自己截,不要把整列撐開(`.cuslink` 在設計稿裡也不吃固定寬)。 */}
        {customerHref !== null && (
          <Link
            href={customerHref}
            className='text-primary hover:bg-muted inline-flex min-w-0 shrink items-center gap-0.5 truncate rounded-md px-1.5 py-0.5 text-[13px]'
          >
            <span className='truncate'>{detail.customer.name ?? '客人明細'}</span>
            <span aria-hidden='true' className='text-muted-foreground shrink-0'>
              ›
            </span>
          </Link>
        )}
        {/* 🔴 金額 —— 設計稿 `:1113` 逐字 `<span class="amt">NT$ ${money(tot)}</span>`。
            **上一版沒做也沒揭露**(`W4-004` 判「這是漏,不是偏離」)。
            ⚠️ **這裡帶 `NT$`,而頭條那三格不帶** —— 那**不是不一致**:
               Sean 2026-08-16 拍過「頭條速覽不用 NT」而「明細表底部的總計是正式金額、帶 NT$」
               (`Q-A216-F4` 拍乙「留著」);**而設計稿這一格自己就寫著 `NT$`** ⇒ 兩個來源同向。 */}
        <span className='shrink-0 text-[13px] tabular-nums'>
          NT$ {formatOrderAmount(detail.total.amount)}
        </span>
        {/* 下單時間 —— 設計稿 `:1114` `<span class="dt">${o.d} 14:05</span>`。 */}
        <span className='text-muted-foreground shrink-0 text-[13px]'>
          {formatOrderDateTime(detail.createdAt)}
        </span>
        {/* 🔴 彈性空白 —— 設計稿 `:1115` `<span class="sp"></span>`,它把右邊那組推到最右。
            **它就是我用來量「裝不裝得下」的那一格**:它的寬度 >0 代表還有餘裕、=0 代表擠到底了。 */}
        <span className='flex-1' />
        {cancelled && (
          <span className='bg-destructive/10 text-destructive inline-flex shrink-0 rounded-md px-2.5 py-0.5 text-xs font-medium'>
            已取消
          </span>
        )}
        {/* #10 片1:揀貨單入口。**開新分頁**(`target='_blank'`)—— 員工按了列印之後要回到這張單
            繼續做事,把工作面換掉再叫他按上一頁是多一步。
            🔴 `rel='noopener'`:`target='_blank'` 預設會把 `window.opener` 交給新分頁。
               這裡兩邊同源、風險低,但這是**寫一次就不用再想**的東西。
            🔴 **已取消就不給入口**(R1 must-fix 3)。第一版我無條件渲染,而 `:312` 的「已取消」
               badge 明明就守著同一顆 `cancelled` —— 同一列裡一個守、一個不守。
            ⚠️ **但這裡只是 UX,不是守門**:網址可以被貼、被書籤、或分頁開著時訂單才被取消,
               那些路徑全部繞過這顆鈕。真正的守門在 `components/print/picking-doc.tsx`
               (已取消 ⇒ 不印品項表)。**兩層都要,少了下面那層這顆鈕等於零。**
            📍 位置在 `ml-auto` 的日期**之前**(nit-12):放後面會被推到整列最尾端、
               與 `:300` 的客人入口分兩側,員工要找兩個地方。 */}
        {!cancelled && (
          <Link
            href={`/print/orders/${detail.id}/picking`}
            target='_blank'
            rel='noopener'
            className='border-border bg-card hover:bg-muted text-foreground inline-flex shrink-0 items-center rounded-md border px-2.5 py-1 text-sm'
          >
            列印揀貨單
          </Link>
        )}
      </div>


      {/* 🔴 片4b:`payments` 是頭條「已收」的來源 —— 傳的是**原始 `PaymentListData`**,
          不是算好的金額。理由:元件內部要吃 `toPaymentSummary()`(與付款卡同一支函式),
          `unknown` 那態才畫得出「未知」而不是一個假的 0。 */}
      <OrderSummaryCards detail={detail} payments={payments} />

      {/* A10a-2/-3:備註時間軸 + 表單。
          🔴 位置 = **發票卡下方**(OD 第十二輪定案 `overview-desktop.html:1171-1173` 逐字
          「既有的『訂單備註 / 聯絡紀錄』整塊搬到發票下方(原本在頁面最底)」;
          主視窗 MAIN-902-A 裁 Q1=A)。發票是上面那個 grid 的最後一張卡 ⇒ 這裡 = 緊接 grid 之後,
          DOM 順序上在發票之後,OD 那支驗證器(`:1656-1662` 用 compareDocumentPosition 比 DOM 順序)認的就是這個。
          ⚠️ 已知代價(主視窗接受、待 Sean 肉眼驗):視覺上橫跨全寬,不是貼在發票那一格正下方——
          要做到後者得把發票卡拆出 grid(Q1 的 B 案),那是版面改動、本輪不做。
          token 在本 server component 渲染期產(Q2=C;頁層 force-dynamic、此處零快取層 ——
          契約債①的「不得落快取層」就是指這一行)。
          key 綁更正目標:進出更正模式必 remount ⇒ noteType 初值恆新鮮(MF1)。 */}
      <NotesTimeline detail={detail} orderId={detail.id} />
      <NoteComposeForm
        key={correctTarget?.id ?? 'compose-new'}
        orderId={detail.id}
        returnTo={returnTo}
        serverToken={generateNoteRequestToken()}
        correctTarget={correctTarget}
        correctionMissing={correctNoteId !== null && correctTarget === null}
      />

      {cancelled && (
        <div className='border-destructive/30 bg-destructive/5 rounded-lg border p-4 text-sm'>
          <span className='text-destructive font-medium'>
            已取消({detail.cancelledAt ? formatOrderDateTime(detail.cancelledAt) : '—'})
          </span>
          {detail.cancelledReason && (
            <span className='text-muted-foreground ml-2'>原因:{detail.cancelledReason}</span>
          )}
        </div>
      )}

      {/* 🔴🔴 **這裡沒有條件包裹,是 Sean 2026-08-15 拍板的結果,不是漏做。**
          (`Q-13-2 = 丙`、`Q-13-3 = 乙`;完整矩陣見
           `docs/specs/2026-08-15-e10-13-order-edit-matrix-order-level.md` §3-4。)

          **已取消 / 已退款 / 已出貨的單,這張表單一律照常出現、四欄一律可改。理由**:
          · **已取消 / 已退款** → 那張單**可能正需要作廢發票**。開票狀態、發票號碼、發票金額
            都是「單沒了之後還要處理的事」⇒ **鎖掉會讓員工無路可走。**
          · **已出貨** → 實際走的物流可能與當初填的不同(換快遞、改自取)
            ⇒ **要能補登真實情況**;鎖掉等於強迫紀錄與事實不符。

          ⚠️ **在加任何 `detail.cancelledAt === null && …` 之前,先去讀上面那份矩陣。**
          🔴 **這段註解存在的理由**:拍板之前,這裡的「沒有守門」與「決定要開放」
             **在畫面上、在程式碼裡都長得一模一樣** —— 而現在它是後者。 */}
      <OrderEditForm detail={detail} returnTo={returnTo} />

      <ItemsTable detail={detail} payments={payments} />

      {/* A10b:採購區塊(逐品項清單 + upsert 表單)。🔴 內部資料、admin-only。 */}
      <ItemProcurementSection
        detail={detail}
        returnTo={returnTo}
        suppliers={suppliers}
        suppliersFailed={suppliersFailed}
      />

      {/* #15-B2-c:已登錄的收款明細 + 登錄表單(片2a 起同一張卡,Sean 拍板 Q-D2=A)。
          🔴 位置 = 採購與到貨【之後】、出貨之前(2026-08-18 Sean 逐字 `09 收款區搬到到貨之後 = 甲`;
          出處 memory `project_0818-sean-eleven-rulings-noon.md:19`,plan
          `docs/specs/2026-08-18-m4b-order-detail-payment-block-order-plan.md`)。
          🔴 這個位置推翻了原本寫在這裡的一個理由,而**那個理由不是錯的** —— 兩個都成立:
            看單  打開這張單想知道現況 ⇒ 付款狀態 → 錢收了哪幾筆   ← 原安排(收款緊跟付款/發票那一組)
            做事  要把這張單往前推一步 ⇒ …到貨了 → 收尾款 → 出貨   ← Sean 09=甲 拍的是這個
          搬**之前**量到的病(過去式,不是現況):收尾款得捲回頁面上方 ↑2,578 px
          (5 品項單;真後台真資料 viewport 1728×1117、**拋棄式庫非正式站**)。
          搬之後那一步是 ↓569。⚠️ **折返沒有消失,只是換了位置** —— 收訂金現在也在採購下面,
          第 1→2 步變成 ↑2,322。Sean 的五步裡收款出現兩次,線性頁面在其中一次會折返。
          (所以不要寫「唯一的折返」——那句在改前改後都不成立。)
          **留著這段是為了不讓下一個人照「看單」那個理由把它搬回去。**
          ⚠️ 只動渲染順序:零 props、零查詢、零業務邏輯改動。
          🔴 **但不要寫成「什麼行為都沒變」** —— DOM 順序就是鍵盤 Tab 與螢幕閱讀器的朗讀順序,
          它跟著一起變了(codex 對抗審查 2026-08-18 抓到)。這是**這片本來就要的效果**、不是副作用,
          但它是行為。「已取消」橫幅留在原地(訂單層狀態、不屬收款)。
          退款相關的兩塊刻意留在頁尾(危險操作沉底,見 `RefundSection` 那段),不與收款混在一起。 */}
      {/* 🔴 `detail.total.amount` 與 `order_payments.amount` **同單位(整數元、非分)**:
          前者見 `order-list-view.ts:675` 逐字引 migration `20260604120000`「金額一律 integer 元位」,
          後者見 `order_payments.amount` 欄 COMMENT 逐字「整數元、非零」⇒ 彙總行直接相減、零換算。 */}
      <PaymentSection
        orderId={detail.id}
        returnTo={returnTo}
        payments={payments}
        amountDue={detail.total.amount}
      />

      {/* 2c:出貨卡。**查看與補救用,不是主要建箱動線**(建箱走訂單總覽勾單、Sean 拍 S1=A)。
          位置 = 採購與到貨 → 收款 → **出貨**,收在頁面主流程的最後一步
          (2026-08-18 收款搬位後更新這一行;~~原寫「放在採購之後、備註之前」~~ 兩半都已不成立:
           備註 2026-08-13 搬到發票卡下方、收款 2026-08-18 插進採購與出貨之間)。 */}
      {/* 🔴 片9:`payments` 傳的是**原始 `PaymentListData`**,不是算好的尾款 ——
          出貨區內部要吃 `toPaymentSummary()`(與付款卡、頭條同一支),
          在這裡先算好等於在第三個地方複製一份「尾款」的定義。 */}
      <ShipmentSection detail={detail} payments={payments} />

      {/* 🔴 備註時間軸 + 表單原本在這裡(頁尾、退款帳本之前),2026-08-13 OD 片 1 已搬到發票卡下方。
          搬走的是**同兩個元件**、不是複製一份 —— 這裡不得再渲染第二份(重複的 NoteComposeForm
          會產第二顆 token、兩張表單同時存在)。 */}

      {/* ═══ 危險操作沉底:取消 / 退款 ═════════════════════════════════════════════
          🔴🔴 **鈕上不得出現「退貨」二字**(2026-08-19,W1)——
             **退貨整條功能在本 repo 一行程式碼都沒有**,而這顆鈕原本寫著「退貨 / 退款」
             ⇒ 那是一顆通往不存在功能的入口。
             權威 = **Aug-17 18:39「720 側邊欄確認稿」**(`<title>` 逐字;
             `~/.claude/projects/-Users-sean-1-pcm-website-v2/07788b5a-.../tool-results/
              artifact-c3c6cc94-1786959567-bf41.html`,另見 `globals.css:1460` /
              `order-detail-items-table.tsx:228` 兩處也指著它):
               `:429` 區塊標題逐字「取消 / 退款」、`:431` 鈕逐字「線上退款(TapPay)」
               `:432` 逐字「🔴 退貨 —— 整條功能後台沒有。畫面已經改成講明
                            『退貨功能目前還沒有』,不會叫你去走。」
             ⚠️ **這覆蓋了 Aug-13 稿的「退貨 / 退款」**,而片12 當時照的是 Aug-13
                (經由二手轉述 `MAIN-057`)⇒ **不是兩份稿打架,是後者明文處理了前者沒處理的問題。**
             📎 同族的另一處早就改對了:`cancel-review-section.tsx:142` 逐字
                「而退貨功能目前還沒有」(2026-08-14 止血)⇒ 本次是把**最後一處**補齊。
          🔴 **取消從第 ④ 位(夾在收款與品項中間)移到這裡**(2026-08-16)。
          **兩個獨立來源都說墊底,而【當時的】現況兩邊都不符** ⇒ 這是**缺陷不是選項**,不需要拍板。
          (2026-08-18 修字面:那句原本是現在式,而它描述的是 08-16 改**之前**;現在已經墊底了。)
            · Sean 逐字(`docs/specs/2026-08-12-admin-order-ui-design-brief.md` 搜
              `回去採購等於說跟國外下單`,同段末):「最難的大概就是取消,**所以放最下面沒問題**」
            · OD 定案主稿 `overview-desktop.html` 搜 `危險操作沉底` —— 同一句話的設計版
          ⚠️ **只動渲染順序,零 props / 零查詢 / 零業務邏輯改動**:`OrderCancelBlock` 的 props、
             `cancelFormsAllowed` 的算法、它自己的判斷全部一個字沒動。
             🔴 **這裡原本還寫了一句「什麼行為都沒變」,2026-08-18 撤回**(codex R2 抓到,
             與收款搬位那段同一個病):搬動含互動元件的區塊會改變**鍵盤 Tab 與螢幕閱讀器的朗讀順序**
             —— 那也是行為。(撤回句刻意不留原字面:留著的話字面掃描會一直命中一句已經作廢的話。)
          📎 **與 OD 的最後一塊對齊**:OD `more` 區塊 = 取消 → 退貨/退款面板(同一塊、取消在前)
             ⇒ 我方擺成 取消 → 退款帳本 → 退款入口,是同一個順序。
          🔴 **這片可能會被之後的版面重排吸收掉**(`~/pcm-mailbox/A-218-demo-brief.md`
             那一輪若改掉整個面板編排)—— **那不是白做**:它**現在**就是缺陷,
             而 demo 那一輪還要好幾天。 */}
      {/* 🔴 片12(2026-08-19):設計稿區塊⑥ —— 面板最底是**一列兩顆鈕**:
             `[退款]                            [申請取消整張單(紅)]`
             (~~原寫 `[退貨 / 退款]`~~ —— 那是 Aug-13 稿的字面,已被確認稿覆蓋,見上一段。)
          ⇒ 三大塊(複核 / 退款帳本 / 退款入口)收進兩顆鈕底下。
          🔴 **DOM 順序 = 設計稿的左右順序(退款在前、取消在後),沒有 `order-*`**。
             ⚠️ **我第一版用 `order-1/2` 把視覺左右對調、DOM 維持「取消在前」,理由寫「朗讀順序跟 DOM」**
                —— 那個理由本身沒錯,**但它換來的是【視覺順序與鍵盤焦點順序打架】**
                (codex K2 2026-08-19 抓到:畫面左邊是退款,而 Tab 先跳到右邊的取消)。
             ⇒ 兩害相權:設計稿自己就把退款排左邊 ⇒ **照它排 DOM,三個順序(視覺/Tab/朗讀)一致。**
                (先前那句「與 OD `more` 同序」講的是**舊的直排版**,那個版面已經不存在了。)
          ⚠️ **零 props / 零查詢 / 零閘改動**:`shouldShowRefundEntry(…)` 那道顯示閘、
             `cancelFormsAllowed`、各元件自己的判斷,一個字沒動 —— 它們只是換了位置。
          🔴 **而「換位置」本身就是行為**(codex R2 在收款搬位那次抓過同款):
             Tab 與朗讀順序會變,且**收起來的內容報讀器預設讀不到**
             ⇒ 這不是純視覺,不要寫成零風險。 */}
      <div className='flex flex-wrap items-start justify-between gap-3'>
        {/* 🔴🔴 **對帳異常時這一塊【自己打開】,而且鈕上就寫著異常**(codex K2 2026-08-19 finding 3)。
            我第一版把帳本無條件收進鈕底下,而帳本裡有「帳本讀不到 / 未登記額為負 ⇒ 勿再發起退款」
            這種**警告** —— 那類警告存在的唯一理由就是要員工看到它。
            收起來 ⇒ 員工看到的是一顆平平無奇的「退款」鈕,退款入口消失了他也**不知道為什麼**
            ⇒ **那是把一個 fail-closed 的安全設計,退化成一個沉默的安全設計。**
            ⇒ 判準用的是**與那道閘同一組輸入**(讀取失敗 / 未登記額為負),不另立第二套語意。 */}
        <DangerZoneDetails
          className='min-w-0 flex-1'
          defaultOpen={refundLedgerAbnormal}
          summary={
            <span
              className={`inline-flex rounded-md border px-3 py-1.5 text-sm ${
                refundLedgerAbnormal
                  ? 'border-destructive/40 text-destructive bg-destructive/5'
                  : 'hover:bg-muted'
              }`}
            >
              {refundLedgerAbnormal ? '退款(對帳異常)' : '退款'}
            </span>
          }
        >
          {/* M-3 RW3:退款帳本呈現(唯讀、不吃旗標;零列且未失敗時區塊自回 null)。
              nowMs 在 server render 期取 —— 列級「滯留逾閾」判定的現在時刻。 */}
          <RefundLedgerSection
            rows={refunds}
            unregisteredAmount={refundUnregisteredAmount}
            unregisteredFailed={refundUnregisteredFailed}
            rowsTruncated={refundsTruncated}
            loadFailed={refundsFailed}
            nowMs={Date.now()}
          />

          {/* M-3 RW2d:退款入口(危險操作沉底)。旗標 && 顯示層狀態閘 && tappay 管道才渲染;
              token 同備註片慣例 = server component 渲染期產(頁層 force-dynamic、零快取層)。
              channel 閘(R1 N5)=顯示層:轉帳/現金單不該看到「線上退款(TapPay)」紅框;
              已知代價 = 若歷史資料 channel 記錯而 rec_trade_id 其實存在,入口會隱藏(fail-closed,
              修資料即恢復)—— 真權威仍是 action 步 ④ 的 rec_trade_id 檢查與 RPC。
              🔴 帳本健康閘(codex MF2 + R2/opus R2b 負值補格):帳本列或未登記額讀不到、
              或未登記額為**負**(帳本登記已超過訂單總額=對帳異常,區塊明寫「勿再發起」)
              ⇒ 入口 fail-closed —— 同一頁「文字叫你別按、按鈕還亮著」就是自打嘴巴。
              負值下錢仍安全(S5 single-flight 擋下一發),關的是矛盾畫面。
              🔴 **片12 沒有動這道閘**:它照舊決定「渲不渲染」,片12 只決定「渲出來的東西收在哪」。 */}
          {shouldShowRefundEntry({
            refundEnabled,
            refundsFailed,
            refundUnregisteredFailed,
            refundUnregisteredAmount,
            paymentChannel: detail.paymentChannel,
            paymentStatus: detail.paymentStatus,
          }) && (
              <RefundSection
                orderId={detail.id}
                returnTo={returnTo}
                serverToken={generateRefundRequestToken()}
              />
            )}
        </DangerZoneDetails>

        {/* A13b D6-a:取消區塊(複核 + 兩支表單)。判斷全部收在該檔內,見鐵則 6 的抽檔理由。
            🔴 `anchorId='cancel'` 是**承重的**:列表那兩條 `#cancel` 深連結的目的地
               (`id='cancel'`)住在這一塊裡面 ⇒ 收起來就等於連過去看到空白。
               為什麼不能只靠瀏覽器自動展開,量測與射程見 `danger-zone-details.tsx` 檔頭。 */}
        {/* 🔴🔴 `key={detail.id}` 是**承重的**(codex K2 2026-08-19 finding 2):
            面板已經開著、員工再點**另一張單**的 `#cancel` 連結時,那是 Next 的 client-side 導航
            ⇒ 網址換了但**不一定發出 `hashchange`**,而 `anchorId` 一直是 `'cancel'` 沒變
            ⇒ effect 不會重跑 ⇒ **連過去是收起來的**。
            換單就換 key ⇒ 強制重新掛載 ⇒ effect 一定重跑一次讀 hash。 */}
        <DangerZoneDetails
          key={detail.id}
          anchorId='cancel'
          className='min-w-0 flex-1'
          summary={
            <span className='border-destructive/40 text-destructive hover:bg-destructive/5 inline-flex rounded-md border px-3 py-1.5 text-sm'>
              申請取消整張單
            </span>
          }
        >
          <OrderCancelBlock detail={detail} returnTo={returnTo} formsAllowed={cancelFormsAllowed} />
        </DangerZoneDetails>
      </div>
    </div>
  );
}
