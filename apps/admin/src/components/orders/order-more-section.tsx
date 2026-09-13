import Link from 'next/link';
import type { AdminOrderDetail } from '@pcm/domain';
import { ItemAmountForm } from './item-amount-form';
import { EmailLogSection, type EmailLogData } from './email-log-section';
import type { PaymentListData } from './payment-list';
import { resolveAmountEditBlock } from './order-detail-items-support';
import type { OrderShipmentGroup } from '../../lib/shipping/order-shipments';
import { formatOrderAmount } from '../../lib/orders/order-list-view';
import { MANUAL_SMALL_BUTTON } from './manual-order-field-classes';

// order-more-section.tsx — 🆕 v22 展開標題列 ④「更多」彈窗的內容(2026-09-13, 主視窗派工;稿彈窗 6 是彈窗不是下拉)。
//
// 三塊, 全部復用既有的東西、零新寫入路:
//   ① 列印兩顆(開新分頁):訂單明細 `/print/orders/<id>/picking`(已取消不給, 同 order-detail-header 那顆的理由)、
//      出貨明細單 `/print/orders/<id>/shipping/<shipmentId>`(每一箱一顆;**沒箱 ⇒ disabled + 一句為什麼**, 稿逐字)。
//   ② 改品項金額(單價):每一樣一列 + 明細頁那支 `ItemAmountForm`(同一支 action;改 0 元原因必填住在表單裡);
//      `resolveAmountEditBlock` 同一支閘(已收款 / 折扣 / 讀不到 ⇒ 整表一句理由, 不出表單)。
//   ③ 通知信:明細頁那張 `EmailLogSection` 原封。⚠️ 稿有「重寄」鈕 —— 系統今天**沒有重寄那條路**(全樹零 resend action)⇒ 不畫。
// 🔴 這支是 server component(ItemAmountForm 自己是 client);字級 / 欄位走 manual-order-field-classes 那組 token。

export function OrderMoreSection({
  detail,
  payments,
  emailLog,
  shipmentGroups,
  returnTo,
}: {
  detail: AdminOrderDetail;
  payments: PaymentListData;
  emailLog: EmailLogData;
  shipmentGroups: readonly OrderShipmentGroup[] | null;
  returnTo: string;
}) {
  const cancelled = detail.cancelledAt !== null;
  const boxes = (shipmentGroups ?? []).filter((g) => g.shipment.voidedAt === null);
  const amountBlock = resolveAmountEditBlock(detail, payments);
  const TH = 'text-muted-foreground border-border border-b px-2 py-[2px] text-left text-xs leading-[1.4] font-semibold';
  const TD = 'border-border border-b px-2 py-[5px] align-top text-sm leading-[1.4]';
  return (
    <div data-testid='order-detail-section-more' className='space-y-5'>
      <section>
        <h3 className='text-muted-foreground mb-2 text-xs leading-[1.4] font-semibold'>列印(開新分頁)</h3>
        <div className='flex flex-wrap gap-2'>
          {cancelled ? (
            <button type='button' disabled title='已取消的單沒有明細可印' className={MANUAL_SMALL_BUTTON}>
              訂單明細
            </button>
          ) : (
            <Link href={`/print/orders/${detail.id}/picking`} target='_blank' rel='noopener' className={MANUAL_SMALL_BUTTON}>
              訂單明細
            </Link>
          )}
          {boxes.length === 0 ? (
            <button
              type='button'
              disabled
              title={shipmentGroups === null ? '出貨資料讀不到, 先重新整理' : '還沒建箱, 先建箱才印得出來'}
              className={MANUAL_SMALL_BUTTON}
              data-testid='print-shipping-disabled'
            >
              出貨明細單
            </button>
          ) : (
            boxes.map((g, i) => (
              <Link
                key={g.shipment.id}
                href={`/print/orders/${detail.id}/shipping/${g.shipment.id}`}
                target='_blank'
                rel='noopener'
                className={MANUAL_SMALL_BUTTON}
              >
                出貨明細單{boxes.length > 1 ? `(箱 ${i + 1})` : ''}
              </Link>
            ))
          )}
        </div>
      </section>

      <section>
        <h3 className='text-muted-foreground mb-2 text-xs leading-[1.4] font-semibold'>改品項金額(單價)</h3>
        {amountBlock !== null ? (
          <p className='text-muted-foreground text-sm leading-[1.4]' data-testid='amount-edit-blocked'>
            {amountBlock}
          </p>
        ) : (
          <table className='border-border w-full border-collapse border text-sm leading-[1.4]'>
            <thead>
              <tr>
                <th className={TH}>廠牌</th>
                <th className={TH}>料號</th>
                <th className={TH}>物品名稱</th>
                <th className={`${TH} text-right`}>現在</th>
                <th className={TH}>改成</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} data-more-item={item.id}>
                  <td className={`${TD} text-(--fg-2) whitespace-nowrap`}>{item.brand ?? '—'}</td>
                  <td className={`${TD} font-mono text-[13px] whitespace-nowrap`}>{item.variantSku}</td>
                  <td className={`${TD} text-foreground`}>{item.title ?? '—'}</td>
                  <td className={`${TD} text-right tabular-nums whitespace-nowrap`}>{formatOrderAmount(item.unitPrice.amount)}</td>
                  <td className={`${TD} w-[220px]`}>
                    <ItemAmountForm
                      orderId={detail.id}
                      expectedVersion={detail.version}
                      orderItemId={item.id}
                      currentUnitPrice={item.unitPrice.amount}
                      returnTo={returnTo}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <EmailLogSection data={emailLog} />
    </div>
  );
}
