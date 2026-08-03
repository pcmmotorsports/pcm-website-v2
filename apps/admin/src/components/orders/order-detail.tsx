import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  workflowStatusBadge,
  indexOrderStatusOptions,
  summarizeOrderItemWorkflow,
} from '../../lib/orders/order-list-view';
import {
  INVOICE_STATUS_LABEL,
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';
import { generateNoteRequestToken } from '../../lib/orders/note-action-state';
import { NOTE_TYPE_LABEL, canCorrectNote } from '../../lib/orders/note-timeline';
import { WorkflowStatusBadge } from './workflow-status-badge';
import { ItemWorkflowStatusCell } from './item-workflow-status-cell';
import { OrderEditForm } from './order-edit-form';
import { NotesTimeline } from './notes-timeline';
import { NoteComposeForm, type CorrectTarget } from './note-compose-form';
import { ItemProcurementSection } from './item-procurement-section';
import type { SupplierOption } from '../../lib/orders/procurement-suppliers';

// M-4a Slice B:訂單明細(server-render、唯讀;狀態/出貨/發票的「改」= Slice C 寫入片)。
// D-2:狀態=per-item(品項表逐列 ItemWorkflowStatusCell 改;header badge=items 彙總、
// 全同→該色/混合→多狀態;orders.workflow_status 停寫不讀)。
// 🔴 PII 邊界:本頁顯示客人姓名/電話/email+收件快照(admin-only、service_role、明細專用白名單);
// 仍零成本/經銷價(品項單價=該單成交價)、零 tappay_rec_trade_id。

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

function ItemsTable({
  detail,
  optionsByCode,
  activeOptions,
}: {
  detail: AdminOrderDetail;
  optionsByCode: ReadonlyMap<string, OrderStatusOption>;
  activeOptions: OrderStatusOption[];
}) {
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
            <th className={TH}>商品狀態</th>
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
              {/* D-2:per-item 狀態逐列改(item 層樂觀鎖;PRG 回明細頁) */}
              <td className={`${TD} whitespace-nowrap`}>
                <ItemWorkflowStatusCell
                  itemId={item.id}
                  workflowStatus={item.workflowStatus}
                  version={item.version}
                  returnTo={`/orders/${detail.id}`}
                  optionsByCode={optionsByCode}
                  activeOptions={activeOptions}
                  paymentStatus={detail.paymentStatus}
                />
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
  statusOptions,
  correctNoteId = null,
  suppliers = [],
  suppliersFailed = false,
}: {
  detail: AdminOrderDetail;
  statusOptions: OrderStatusOption[];
  /** A10a-3:`?correct` searchParam(頁層過 uuid 閘後下傳) */
  correctNoteId?: string | null;
  /** A10b:S3a 供應商選單(啟用中、zh-TW 排序) */
  suppliers?: readonly SupplierOption[];
  /** A10b:供應商清單載入失敗(不靜默;見 item-procurement-section) */
  suppliersFailed?: boolean;
}) {
  const optionsByCode = indexOrderStatusOptions(statusOptions);
  const activeOptions = statusOptions.filter((o) => o.isActive);
  const cancelled = detail.cancelledAt !== null;
  // D-2:header 整單狀態=items 彙總(全同→該色、混合→「多狀態」;orders.workflow_status 停寫不讀)。
  const summary = summarizeOrderItemWorkflow(detail.items.map((i) => i.workflowStatus));
  const correctTarget = resolveCorrectTarget(detail, correctNoteId);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{detail.displayId}</h1>
        {summary.kind === 'mixed' ? (
          <span className='bg-muted text-muted-foreground inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium'>
            多狀態
          </span>
        ) : (
          <WorkflowStatusBadge badge={workflowStatusBadge(summary.code, optionsByCode)} />
        )}
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

      <ItemsTable detail={detail} optionsByCode={optionsByCode} activeOptions={activeOptions} />

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
    </div>
  );
}
