import type { AdminOrderDetail, OrderStatusOption } from '@pcm/domain';
import {
  PAYMENT_STATUS_LABEL,
  FULFILLMENT_STATUS_LABEL,
  ORDER_SOURCE_LABEL,
  PAYMENT_CHANNEL_LABEL,
  formatOrderAmount,
  workflowStatusBadge,
  indexOrderStatusOptions,
} from '../../lib/orders/order-list-view';
import {
  INVOICE_STATUS_LABEL,
  invoiceTypeLabel,
  shippingMethodLabel,
  formatOrderDateTime,
} from '../../lib/orders/order-detail-view';
import { WorkflowStatusBadge } from './workflow-status-badge';
import { OrderEditForm } from './order-edit-form';

// M-4a Slice B:訂單明細(server-render、唯讀;狀態/出貨/發票的「改」= Slice C 寫入片)。
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
          </tr>
        </thead>
        <tbody>
          {detail.items.map((item, i) => (
            <tr key={`${item.variantSku}-${i}`} className='border-t'>
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
          </tr>
          <tr>
            <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
              運費
            </td>
            <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.shippingFee.amount)}
            </td>
          </tr>
          {detail.discountTotal.amount > 0 && (
            <tr>
              <td colSpan={4} className='text-muted-foreground px-3 py-1.5 text-right'>
                折扣
              </td>
              <td className='px-3 py-1.5 text-right tabular-nums whitespace-nowrap'>
                −NT$ {formatOrderAmount(detail.discountTotal.amount)}
              </td>
            </tr>
          )}
          <tr className='border-t font-medium'>
            <td colSpan={4} className='px-3 py-2 text-right'>
              總計
            </td>
            <td className='px-3 py-2 text-right tabular-nums whitespace-nowrap'>
              NT$ {formatOrderAmount(detail.total.amount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function OrderDetail({
  detail,
  statusOptions,
}: {
  detail: AdminOrderDetail;
  statusOptions: OrderStatusOption[];
}) {
  const optionsByCode = indexOrderStatusOptions(statusOptions);
  const activeOptions = statusOptions.filter((o) => o.isActive);
  const cancelled = detail.cancelledAt !== null;

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='text-2xl font-semibold'>{detail.displayId}</h1>
        <WorkflowStatusBadge badge={workflowStatusBadge(detail.workflowStatus, optionsByCode)} />
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

      <OrderEditForm detail={detail} activeOptions={activeOptions} />

      <ItemsTable detail={detail} />
    </div>
  );
}
