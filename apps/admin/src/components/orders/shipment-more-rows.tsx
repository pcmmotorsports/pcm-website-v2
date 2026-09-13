import Link from 'next/link';
import { carrierLabelOf } from '../../lib/shipping/carrier-label';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
import { getAdminOrderRepository } from '../../lib/orders/order-repository';
import { formatCustomerDate } from '../../lib/customers/customer-list-view';
import { ShipmentHctSubmitButton } from './shipment-hct-submit-button';
import { ShipmentMarkShippedButton } from './shipment-mark-shipped-button';
import { ShipmentEditTrackingButton } from './shipment-edit-tracking-button';
import { ShipmentVoidButton } from './shipment-void-button';
import { ShipmentHctUnknownNotice } from './shipment-hct-unknown-notice';

// shipment-more-rows.tsx — 出貨彈窗「更多」裡,稿(v22 彈窗 9)那六列:一列一句 + 一顆鈕(B13-b,主視窗 2026-09-13)。
//    ① 跟新竹物流叫車 ② 貨已經被收走了 ③ 列印 ④ 這張單的箱 ⑤ 單號打錯了 ⑥ 這箱不算了
//    🔴 **每一顆鈕都是既有元件原樣**(`shipment-section.tsx` 訂單明細出貨卡上那幾顆):零新寫入路,
//       顯示條件逐字照那張卡(`!voided` / `shipped` / `carrierCode === 'hct'` / `hctStatus === 'submitted'`)。
//    🔴 不塞整個 `ShipmentSection`(那是明細頁的卡,520 塞不下);這裡只重排成稿的形狀。
//    🔴 async server component:page.tsx `await` 它、當 children 往 client 端的出貨 body 傳;它自己撈 shipments
//       (`loadOrderShipments` 同明細頁那支),品項標題從 `findAdminOrderDetail` 拿(只在 `?next=&do=ship` 路徑多這一發)。
//    🔴 一張單可能不只一箱 ⇒ 每箱各一組六列;沒箱 ⇒ 只印第 ④ 列「還沒建箱」(另外五列沒有對象,不畫)。

const ROW = 'flex items-center justify-between gap-3 border-t py-2 text-[12.5px] leading-[1.4] first:border-t-0';
const LABEL = 'text-muted-foreground shrink-0';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={ROW}>
      <span className={LABEL}>{label}</span>
      <span className='flex min-w-0 flex-wrap items-center justify-end gap-2'>{children}</span>
    </div>
  );
}

export async function ShipmentMoreRows({ orderId }: { orderId: string }) {
  let rows: Awaited<ReturnType<typeof loadOrderShipments>> = null;
  try {
    const detail = await getAdminOrderRepository().findAdminOrderDetail(orderId);
    if (detail !== null) {
      rows = await loadOrderShipments(new Map(detail.items.map((it) => [it.id, it.title])));
    }
  } catch (e) {
    console.error('[shipment-more-rows] 讀取這張單的箱失敗', e);
  }
  if (rows === null) {
    return (
      <Row label='這張單的箱'>
        <span className='text-destructive'>讀不到(稍後再開一次)</span>
      </Row>
    );
  }
  if (rows.length === 0) {
    return (
      <Row label='這張單的箱'>
        <span className='text-muted-foreground'>還沒建箱</span>
      </Row>
    );
  }
  return (
    <div data-testid='shipment-more-rows'>
      {rows.map(({ shipment, hctStatus, hctPlaceholderStuck }, i) => {
        const voided = shipment.voidedAt !== null;
        const shipped = shipment.shippedAt !== null;
        const isHct = shipment.carrierCode === 'hct';
        return (
          <div key={shipment.id} className={i > 0 ? 'mt-3 border-t pt-2' : ''} data-shipment-id={shipment.id}>
            <Row label='這張單的箱'>
              <span className='text-foreground'>
                箱 {i + 1} <b>{carrierLabelOf(shipment.carrierCode)}</b>
                {shipment.trackingNumber ? <span className='font-mono'> · {shipment.trackingNumber}</span> : null}{' '}
                <span className={voided ? 'text-muted-foreground line-through' : shipped ? 'text-emerald-700' : 'text-amber-700'}>
                  {voided ? '已作廢' : shipped ? `已出貨 ${formatCustomerDate(shipment.shippedAt!).slice(5).replace('-', '/')}` : '未出貨'}
                </span>
              </span>
            </Row>
            {isHct && !voided && (
              <>
                <ShipmentHctUnknownNotice
                  hctStatus={hctStatus}
                  shipmentId={shipment.id}
                  shipmentReference={shipment.shipmentReference}
                  placeholderStuck={hctPlaceholderStuck}
                />
                <Row label='跟新竹物流叫車'>
                  <ShipmentHctSubmitButton
                    shipmentId={shipment.id}
                    shipmentReference={shipment.shipmentReference}
                    shipped={shipped}
                  />
                </Row>
              </>
            )}
            {!voided && !shipped && (
              <Row label='貨已經被收走了'>
                <ShipmentMarkShippedButton
                  shipmentId={shipment.id}
                  shipmentReference={shipment.shipmentReference}
                  carrierCode={shipment.carrierCode}
                />
              </Row>
            )}
            {!voided && (
              <Row label='列印'>
                <Link
                  href={`/print/orders/${orderId}/shipping/${shipment.id}`}
                  target='_blank'
                  rel='noopener'
                  className='text-primary underline underline-offset-2'
                >
                  出貨明細單
                </Link>
                {/* 託運標籤:同明細頁那顆 —— 沒送新竹就沒有圖(route 會 409),所以 submitted 才給連結,否則灰字。 */}
                {isHct && hctStatus === 'submitted' ? (
                  <Link
                    href={`/print/orders/${orderId}/shipping/${shipment.id}/label.pdf`}
                    target='_blank'
                    rel='noopener'
                    className='text-primary underline underline-offset-2'
                  >
                    託運標籤 PDF
                  </Link>
                ) : (
                  <span className='text-muted-foreground' aria-disabled='true' title='送了新竹物流才有託運標籤'>
                    託運標籤 PDF
                  </span>
                )}
              </Row>
            )}
            {shipped && !voided && (
              <Row label='單號打錯了'>
                <ShipmentEditTrackingButton
                  shipmentId={shipment.id}
                  shipmentReference={shipment.shipmentReference}
                  carrierCode={shipment.carrierCode}
                  currentTrackingNumber={shipment.trackingNumber}
                />
              </Row>
            )}
            {!voided && (
              <Row label='這箱不算了'>
                <ShipmentVoidButton
                  shipmentId={shipment.id}
                  shipmentReference={shipment.shipmentReference}
                  voided={voided}
                />
              </Row>
            )}
          </div>
        );
      })}
    </div>
  );
}
