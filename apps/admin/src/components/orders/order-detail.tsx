import type { AdminOrderDetail, AdminOrderItemQuantitySummary } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
} from '../../lib/orders/order-list-view';
import {
  INVOICE_STATUS_LABEL,
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
import { RefundSection } from './refund-section';
import { RefundLedgerSection } from './refund-ledger-section';
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
// 這裡只決定「入口值不值得渲染」,判錯的後果 = 員工按了拿到 action 的具名失敗訊息,不是繞過。
// 型別釘 enum(R1 N4):日後 payment status 改名時這裡編譯紅,而不是入口靜默消失。
const REFUND_ENTRY_STATUSES: readonly AdminOrderDetail['paymentStatus'][] = [
  'paid',
  'partiallyRefunded',
];

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
 * A9w1:品項列的三軸顯示(取代九碼 `ItemWorkflowStatusCell`)。
 *
 * 資料源 = A9g-1 的 `quantitySummary`(`order_item_quantity_summary` 衍生快取,A4a trigger 維護)。
 * 🔴 `null` 的意思是「不知道」,**不是**「都是 0」(`packages/domain/src/order/types.ts:477-501` 逐字:
 *    品項從未被採購也從未被取消時根本沒有那一列)⇒ 這裡顯示「數量資料尚未就緒」、**不補 0**。
 *    純顯示補 0 的最壞後果只是少顯示資訊,但同一個 `?? 0` 一旦被抄進取消流程就會放行超量取消
 *    ⇒ 這一格從一開始就不留那個寫法可抄。
 * 🔴 **出貨軸本片不畫**:`shipped_quantity` 目前不存在,是第 2 批包裹模型的契約債
 *    (`types.ts:530-532` 逐字「現況 `shipped` 欄不存在 ⇒ 完整式**退化**」)⇒ 畫一個恆為
 *    em-dash 的出貨欄等於假裝有這個軸。母 plan `:426` row 60(A11b)才是出貨軸唯讀灰的去處。
 */
function ItemAxisCell({ summary }: { summary: AdminOrderItemQuantitySummary | null }) {
  // 型別是 `| null`,但這裡刻意用 falsy 判斷:投影退版時這一欄會是 `undefined`,
  // 而「讀不到就 fail-closed」的立場對兩種缺值都成立(補 0 才是要防的那個寫法)。
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
  correctNoteId = null,
  suppliers = [],
  suppliersFailed = false,
  refundEnabled = false,
  refunds = [],
  refundsFailed = false,
  refundsTruncated = false,
  refundUnregisteredAmount = null,
  refundUnregisteredFailed = false,
}: {
  detail: AdminOrderDetail;
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
}) {
  const cancelled = detail.cancelledAt !== null;
  const correctTarget = resolveCorrectTarget(detail, correctNoteId);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{detail.displayId}</h1>
        {/* A9w1:整單九碼彙總 badge 退場。付款軸(三軸的訂單層)在下方「付款」卡的付款狀態,
            訂貨/到貨在品項列 —— 不另補一顆彙總 badge,那正是九碼被退場的東西。 */}
        {cancelled && (
          <span className='bg-destructive/10 text-destructive inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium'>
            已取消
          </span>
        )}
        <span className='text-muted-foreground ml-auto text-sm'>
          下單 {formatOrderDateTime(detail.createdAt)}
        </span>
      </div>

      <div className='grid gap-4 md:grid-cols-2 xl:grid-cols-4'>
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
          <Field label='出貨狀態' value={FULFILLMENT_STATUS_LABEL[detail.fulfillmentStatus]} />
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

      <OrderEditForm detail={detail} />

      <ItemsTable detail={detail} />

      {/* A10b:採購區塊(逐品項清單 + upsert 表單)。🔴 內部資料、admin-only。 */}
      <ItemProcurementSection
        detail={detail}
        suppliers={suppliers}
        suppliersFailed={suppliersFailed}
      />

      {/* A10a-2/-3:備註時間軸 + 表單。token 在本 server component 渲染期產(Q2=C;
          頁層 force-dynamic、此處零快取層 —— 契約債①的「不得落快取層」就是指這一行)。
          key 綁更正目標:進出更正模式必 remount ⇒ noteType 初值恆新鮮(MF1)。 */}
      <NotesTimeline detail={detail} orderId={detail.id} />
      <NoteComposeForm
        key={correctTarget?.id ?? 'compose-new'}
        orderId={detail.id}
        serverToken={generateNoteRequestToken()}
        correctTarget={correctTarget}
        correctionMissing={correctNoteId !== null && correctTarget === null}
      />

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
      {refundEnabled &&
        !refundsFailed &&
        !refundUnregisteredFailed &&
        !(refundUnregisteredAmount !== null && refundUnregisteredAmount < 0) &&
        detail.paymentChannel === 'tappay' &&
        REFUND_ENTRY_STATUSES.includes(detail.paymentStatus) && (
          <RefundSection orderId={detail.id} serverToken={generateRefundRequestToken()} />
        )}
    </div>
  );
}
