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
import { INVOICE_STATUS_LABEL, PAYMENT_STATUS_LABEL } from '../../lib/orders/order-list-view';
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
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
      className={`inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium ${
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

  return (
    <div className='space-y-4'>
      {/* ═══ 片2 標頭列(設計稿 §1「標頭」)═════════════════════════════════════
          設計稿要的是兩行:
            第一行  單號 + 狀態 chip                        (右側 ✕ 在路由層,見下)
            第二行  客戶 X ， 下單 08/10   發票 未開
          🔴 **`✕` 不在本元件** —— 關閉是**面板才有**的動作,而本元件同時被整頁版渲染
             (`customerHref` 那段 docstring 逐字「它同時被兩邊渲染」)。
             關閉連結由 `order-detail-route.tsx` 的 `BackLink` 畫、文案由各呼叫端傳
             ⇒ 只改面板那一邊的 `back.label` 就好,整頁版不受影響。
          🔴🔴 **本片改的是【兩個視圖共用】的標頭 ⇒ 整頁版 `/orders/[id]` 的標頭外觀也跟著變了,
             而【沒有人看過整頁版的畫面】。**(`W4-004` F2:這件事原本只活在我給審查者的一封訊息裡,
             而**訊息會消失,它不是載體**。)
             · 功能面 W4 已核**無回歸**:`ml-auto` 只掛在被刪掉的那個 span 上、`列印揀貨單` 本來就靠左;
               既有測試零格斷言標頭字面。
             · **仍未驗的是【長相】** —— 已列進交件檔的「需肉眼驗」清單,不要當成已驗。
          ⚠️ **已知偏離,待 Sean 肉眼裁**:設計稿把 `✕` 畫在單號**同一行的最右邊**,
             而 `BackLink` 是**單號上方自成一行**。要做到同一行得讓本元件收一個
             `closeSlot` prop、兩個呼叫端各傳一份 —— 那是跨元件手術,不屬本片體積。
             **先照現有結構做,他看了不滿意再開一片。** */}
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{detail.displayId}</h1>
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
        {cancelled && (
          <span className='bg-destructive/10 text-destructive inline-flex rounded-md px-2.5 py-0.5 text-xs font-medium'>
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
            className='border-border bg-card hover:bg-muted text-foreground inline-flex items-center rounded-md border px-2.5 py-1 text-sm'
          >
            列印揀貨單
          </Link>
        )}
      </div>

      {/* 第二行:客戶 ， 下單   發票 —— 設計稿 §1 逐字「客戶 沈佑霖 ， 下單 08/10   發票 未開」。
          🔴 **客人明細的入口跟著名字走到這一行,入口本身沒有消失**:OD `overview-desktop.html:1109-1112`
             逐字要求「做在標題列的**名字**上,因為那是『這張單是誰的』唯一會被讀的位置」
             ⇒ 綁的是**名字**不是**第一行** ⇒ 搬行不違反那條,拿掉入口才會。
          ⚠️ 名字可能是 null(join 缺)⇒ 文案退成「客人明細」,退場文案沿用原本那句、一字未改。
          🔴 **發票這一格與下方發票卡是同一支 `INVOICE_STATUS_LABEL`**,不另寫字面 ——
             兩處各寫一份的話,哪天改詞會只改到一邊,而畫面上兩個詞都合理、沒有人會發現。 */}
      <p className='text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
        <span>
          客戶{' '}
          {customerHref !== null ? (
            <Link href={customerHref} className='text-foreground underline underline-offset-2'>
              {detail.customer.name ?? '客人明細'}
            </Link>
          ) : (
            (detail.customer.name ?? '—')
          )}
        </span>
        <span>下單 {formatOrderDateTime(detail.createdAt)}</span>
        <span>發票 {INVOICE_STATUS_LABEL[detail.invoiceStatus]}</span>
      </p>

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
      <ShipmentSection detail={detail} />

      {/* 🔴 備註時間軸 + 表單原本在這裡(頁尾、退款帳本之前),2026-08-13 OD 片 1 已搬到發票卡下方。
          搬走的是**同兩個元件**、不是複製一份 —— 這裡不得再渲染第二份(重複的 NoteComposeForm
          會產第二顆 token、兩張表單同時存在)。 */}

      {/* ═══ 危險操作沉底:取消 / 退貨 / 退款 ═══════════════════════════════════════
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
      {/* A13b D6-a:取消區塊(複核 + 兩支表單)。判斷全部收在該檔內,見鐵則 6 的抽檔理由。 */}
      <OrderCancelBlock detail={detail} returnTo={returnTo} formsAllowed={cancelFormsAllowed} />

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
          負值下錢仍安全(S5 single-flight 擋下一發),關的是矛盾畫面。 */}
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
    </div>
  );
}
