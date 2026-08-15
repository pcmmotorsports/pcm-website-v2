import Link from 'next/link';
import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  GOODS_AXIS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  INVOICE_STATUS_LABEL, // A11a-5 起共用(原在 order-detail-view.ts,依該檔頭宣告的慣例搬來)
} from '../../lib/orders/order-list-view';
import { orderDetailGoodsAxis, goodsAxisProgressNote } from '../../lib/orders/order-status-axes';
import {
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
import { ItemProcurementSection } from './item-procurement-section';
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
const CARD = 'rounded-lg border bg-card p-4 text-card-foreground';
const CARD_TITLE = 'text-muted-foreground mb-3 text-xs font-medium';
const ROW = 'flex justify-between gap-4 py-1 text-sm';
const ROW_LABEL = 'text-muted-foreground shrink-0';

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={ROW_LABEL}>{label}</span>
      <span className='text-right break-all'>{value ?? '—'}</span>
    </div>
  );
}

/**
 * 「出貨狀態」那格的值 = 軸的中文 + **一行解釋為什麼是這個字的小字**。
 *
 * 🔴 **為什麼要有這行小字**(Sean 2026-08-15 拍板乙):改讀真相之後,`RCPVVJ` 那張單
 *    上方摘要寫「未訂貨」、品項列寫「訂貨 3/6」—— **兩個都對,而放在一起讓人看不懂**
 *    (軸的定義是「該單所有品項都訂滿才算已訂」,3<6 ⇒ 退回前一階)。
 *    ⚠️ 後果不是美觀問題:**員工可能讀成「還沒下單」而重複下單、同一批貨訂兩次。**
 *    需求檔 `docs/specs/2026-08-12-admin-order-ui-design-brief.md:114` 早就要求
 *    「這個定義要在畫面上讓人看得懂」—— `#514` 只做了改讀真相那半,這片補另一半。
 *
 * 🔴 **軸值本身一個字都不動**(`GOODS_AXIS_LABEL` / `ORDER_GOODS_AXIS_VALUES` / 篩選 chip / adapter
 *    全部沒碰)⇒ 這片不中鐵則 8。小字是**加上去的解釋**,不是新的狀態。
 *
 * 規則與它依賴的三條 DB CHECK 寫在 `goodsAxisProgressNote` 的 docstring,**不在這裡重複一份**
 * (兩份會漂;那條規則的正當性屬於算它的地方)。
 */
function GoodsAxisValue({ detail }: { detail: AdminOrderDetail }) {
  const note = goodsAxisProgressNote(detail.items);
  return (
    <>
      {GOODS_AXIS_LABEL[orderDetailGoodsAxis(detail)]}
      {note !== null && <span className='text-muted-foreground block text-xs'>{note}</span>}
    </>
  );
}

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
function ItemAxisCell({ summary }: { summary: AdminOrderItemQuantitySummary | null }) {
  // 型別是 `| null`,但這裡刻意用 falsy 判斷。
  // ⚠️ **2026-08-10 更正**(A13b D6-a R2 codex):原本寫「投影退版時這一欄會是 `undefined`」——
  //    **那句沒有依據**,`mappers/order.ts:542-544` 的 `mapQuantitySummary` 回 `| null`、
  //    產不出 `undefined`。falsy 判斷保留的理由只有「防手寫物件」與「兩種缺值處置相同」,
  //    不是在接住一個已知的產線值。(`cancel-view.ts` 同族註解已同步收窄。)
  if (!summary) {
    return <span className='text-muted-foreground text-xs'>數量資料尚未就緒</span>;
  }
  return (
    <div className='text-xs leading-5'>
      <div>
        訂貨{' '}
        <span className='tabular-nums'>
          {summary.orderedQuantity}/{summary.quantity}
        </span>
      </div>
      <div>
        到貨{' '}
        <span className='tabular-nums'>
          {summary.instockQuantity}/{summary.quantity}
        </span>
      </div>
      {summary.cancelledQuantity > 0 && (
        <div className='text-destructive'>
          已取消 <span className='tabular-nums'>{summary.cancelledQuantity}</span>
        </div>
      )}
    </div>
  );
}

function ItemsTable({ detail }: { detail: AdminOrderDetail }) {
  const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
  const TD = 'px-3 py-2 text-sm align-top';
  return (
    <div className='overflow-x-auto rounded-lg border bg-card'>
      <table className='w-full border-collapse'>
        <thead>
          <tr>
            <th className={TH}>品項</th>
            <th className={TH}>SKU</th>
            <th className={`${TH} text-right`}>數量</th>
            <th className={`${TH} text-right`}>單價</th>
            <th className={`${TH} text-right`}>小計</th>
            {/* 取消那一列只在 >0 時出現(0 件取消是常態、每列印一個 0 是噪音),欄名仍列出來 */}
            <th className={TH}>訂貨 · 到貨 · 取消</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((item) => (
            <tr key={item.id} className='border-t'>
              <td className={TD}>
                <div>{item.title ?? '—'}</div>
                {item.spec && (
                  <div className='text-muted-foreground mt-0.5 text-xs'>
                    {Object.entries(item.spec)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' · ')}
                  </div>
                )}
              </td>
              <td className={`${TD} text-muted-foreground whitespace-nowrap text-xs`}>
                {item.variantSku}
              </td>
              <td className={`${TD} text-right tabular-nums`}>{item.quantity}</td>
              <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                NT$ {formatOrderAmount(item.unitPrice.amount)}
              </td>
              <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>
                NT$ {formatOrderAmount(item.lineTotal.amount)}
              </td>
              {/* A9w1:九碼下拉退場 → 三軸數量(唯讀;訂貨的「改」在下方採購區塊 A10b) */}
              <td className={`${TD} whitespace-nowrap`}>
                <ItemAxisCell summary={item.quantitySummary} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className='border-t text-sm'>
          <tr>
            <td colSpan={4} className='text-muted-foreground px-3 py-1.5 pt-3 text-right'>
              小計
            </td>
            <td className='px-3 py-1.5 pt-3 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.subtotal.amount)}
            </td>
            <td />
          </tr>
          <tr>
            <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
              運費
            </td>
            <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.shippingFee.amount)}
            </td>
            <td />
          </tr>
          {detail.discountTotal.amount > 0 && (
            <tr>
              <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
                折扣
              </td>
              <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
                −NT$ {formatOrderAmount(detail.discountTotal.amount)}
              </td>
              <td />
            </tr>
          )}
          <tr className='border-t font-medium'>
            <td colSpan={4} className='px-3 py-2 text-right'>
              總計
            </td>
            <td className='px-3 py-2 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

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
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{detail.displayId}</h1>
        {/* 🔴 入口位置照 OD `overview-desktop.html:1109-1112` 逐字:「客人明細的入口。
            **做在標題列的名字上**,因為那是『這張單是誰的』唯一會被讀的位置,
            員工要查電話/地址時眼睛本來就落在這裡。一下就開,不用先跳到客戶頁再搜尋。」
            ⚠️ 名字可能是 null(join 缺)⇒ 那時仍要給入口(id 在就開得了),文案退成「客人明細」。
               這一句退場文案是**我自己決定的**,OD 沒有畫這個狀態。 */}
        {customerHref !== null && (
          <Link
            href={customerHref}
            className='border-border bg-card hover:bg-muted text-foreground inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm'
          >
            {detail.customer.name ?? '客人明細'}
            <span aria-hidden='true' className='text-muted-foreground'>
              ›
            </span>
          </Link>
        )}
        {/* A9w1:整單九碼彙總 badge 退場。付款軸(三軸的訂單層)在下方「付款」卡的付款狀態,
            訂貨/到貨在品項列 —— 不另補一顆彙總 badge,那正是九碼被退場的東西。 */}
        {cancelled && (
          <span className='bg-destructive/10 text-destructive inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium'>
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
        <span className='text-muted-foreground ml-auto text-sm'>
          下單 {formatOrderDateTime(detail.createdAt)}
        </span>
      </div>

      {/* #350c:欄數改看**容器寬度**而不是視窗寬度(主視窗 2026-08-10 裁④)。
          🔴 為什麼非改不可:同一份明細現在有兩個容器 —— 整頁版(~72rem)與右側面板(~36rem)。
          用 `md:`/`xl:` 這種 viewport 斷點的話,1920 螢幕上的 576px 面板會**硬排四欄**、每欄擠到不能看。
          容器斷點 `@md`(28rem)/ `@4xl`(56rem)⇒ 面板 2 欄、整頁 4 欄。
          ⚠️ **兩個消費者的外框都必須帶 `@container`**,否則容器斷點沒有參照對象、一律退回 1 欄
          (`order-panel-wiring.test.ts` 有一格把兩邊的 `@container` 釘住)。 */}
      <div className='grid gap-4 @md:grid-cols-2 @4xl:grid-cols-4'>
        <section className={CARD}>
          <h2 className={CARD_TITLE}>客戶資訊</h2>
          <Field label='姓名' value={detail.customer.name} />
          <Field label='電話' value={detail.customer.phone} />
          <Field label='Email' value={detail.customer.email} />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>收件與出貨</h2>
          <Field label='收件人' value={detail.shippingAddress.name} />
          <Field label='電話' value={detail.shippingAddress.phone} />
          <Field label='地址' value={detail.shippingAddress.line} />
          <Field label='出貨方式' value={shippingMethodLabel(detail.shippingMethod)} />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>付款</h2>
          <Field label='付款狀態' value={PAYMENT_STATUS_LABEL[detail.paymentStatus]} />
          {/* 🔴🔴 `#514`:這一格**改讀貨品軸的真相**,不再讀 `orders.fulfillment_status`。
              那一欄的 COLUMN COMMENT 自己寫著「E10 起停止維護、值為 legacy stale、不得當現況真相」
              (`20260729010000_m4b_e10_d0_display_id_expand.sql:88` 逐字),而**全 migrations 零 writer**
              ⇒ 正式庫 13/13 全是 DEFAULT `notOrdered` ⇒ **這一格從來沒有正確過一次**。
              ⚠️ 那條 COMMENT 防的是「有人拿它做判斷」,**沒防「有人把它畫出來」——`render` 不是判斷**。
              🔴 **文案一個字都沒變**:`GOODS_AXIS_LABEL` 與 `FULFILLMENT_STATUS_LABEL` 字面逐字相同
                 (`order-list-view.ts` 兩張表的 docstring 互相記著這件事)⇒ **變的只有資料從哪來**。
              ⚠️ **修完之後多數單仍顯示「未訂貨」,而那是對的** —— 正式庫多數單還沒採購;
                 要證明它真的改讀了,看**有採購紀錄的那張單**(`order-status-axes.test.ts` 釘了那一格)。 */}
          <Field label='出貨狀態' value={<GoodsAxisValue detail={detail} />} />
          <Field
            label='來源 · 管道'
            value={`${ORDER_SOURCE_LABEL[detail.orderSource]} · ${PAYMENT_CHANNEL_LABEL[detail.paymentChannel]}`}
          />
          <Field
            label='付款時間'
            value={detail.paidAt ? formatOrderDateTime(detail.paidAt) : null}
          />
        </section>

        <section className={CARD}>
          <h2 className={CARD_TITLE}>發票</h2>
          <Field label='需求型式' value={invoiceTypeLabel(detail.invoiceRequest.type)} />
          {detail.invoiceRequest.taxId && (
            <Field label='統編 / 抬頭' value={`${detail.invoiceRequest.taxId} ${detail.invoiceRequest.title ?? ''}`} />
          )}
          {detail.invoiceRequest.carrier && (
            <Field label='載具' value={detail.invoiceRequest.carrier} />
          )}
          <Field label='開立狀態' value={INVOICE_STATUS_LABEL[detail.invoiceStatus]} />
          <Field label='發票號碼' value={detail.invoiceNumber} />
          <Field
            label='發票金額'
            value={
              detail.invoiceAmount ? `NT$ ${formatOrderAmount(detail.invoiceAmount.amount)}` : null
            }
          />
        </section>
      </div>

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

      {/* #15-B2-c:已登錄的收款明細 + 登錄表單(片2a 起同一張卡,Sean 拍板 Q-D2=A)。
          🔴 位置 = 收款緊跟在付款狀態與發票這一組之後:員工看完付款狀態,下一個問題就是「錢收了哪幾筆」。
          ⚠️ 2026-08-13 OD 片 1 更正字面:原本寫「緊接『付款』卡之後」,備註搬進中間後那句已不成立
          (現在順序 = grid〔含付款卡、發票卡〕→ 備註 → 收款)。改的是描述、不是位置意圖。
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

      {/* A13b D6-a:取消區塊(複核 + 兩支表單)。判斷全部收在該檔內,見鐵則 6 的抽檔理由。 */}
      <OrderCancelBlock detail={detail} returnTo={returnTo} formsAllowed={cancelFormsAllowed} />

      <OrderEditForm detail={detail} returnTo={returnTo} />

      <ItemsTable detail={detail} />

      {/* A10b:採購區塊(逐品項清單 + upsert 表單)。🔴 內部資料、admin-only。 */}
      <ItemProcurementSection
        detail={detail}
        returnTo={returnTo}
        suppliers={suppliers}
        suppliersFailed={suppliersFailed}
      />

      {/* 2c:出貨卡。**查看與補救用,不是主要建箱動線**(建箱走訂單總覽勾單、Sean 拍 S1=A)。
          放在採購之後、備註之前 —— 採購(進貨)→ 出貨(出貨)是員工的實際時序。 */}
      <ShipmentSection detail={detail} />

      {/* 🔴 備註時間軸 + 表單原本在這裡(頁尾、退款帳本之前),2026-08-13 OD 片 1 已搬到發票卡下方。
          搬走的是**同兩個元件**、不是複製一份 —— 這裡不得再渲染第二份(重複的 NoteComposeForm
          會產第二顆 token、兩張表單同時存在)。 */}

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
