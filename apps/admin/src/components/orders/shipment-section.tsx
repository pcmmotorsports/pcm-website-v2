// shipment-section.tsx — 訂單詳情頁的「出貨」卡(片 2c)。**server component**。
//
// 🔴 **這張卡的定位是查看與補救,不是主要建箱動線**(Sean 拍 S1=A C 版:建箱走訂單總覽勾單)。
//    這裡回答的是「這單的東西裝在哪幾箱、寄了沒、單號多少、按錯了怎麼救」。
//
// 🔴 **必然的怪處,已明寫在畫面上**:箱子掛**客人**、沒有 order_id ⇒ 同一箱可能還裝著別單的東西,
//    同一個箱號會同時出現在兩張訂單的詳情頁。本卡**只列本單的品項**,整箱要點箱號才看得到。
//    ⇒ 顯示的件數是「本單在這箱裡的件數」,**不是整箱件數**。
//
// 🔴 **作廢的箱照樣列出來**:作廢 = 那些品項回到可出貨池,不是消失。
//    過濾掉的話,員工會以為貨憑空不見了。

import type { AdminOrderDetail } from '@pcm/domain';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
import { OrderShipButton } from './shipment-launcher';
import { ShipmentVoidButton } from './shipment-void-button';

const CARRIER_LABEL: Record<string, string> = {
  hct: '新竹物流',
  sf: '順豐',
  other: '其他',
};

export async function ShipmentSection({ detail }: { detail: AdminOrderDetail }) {
  // 🔴 只取 id 與 title 兩欄餵下去 —— 不把整包 detail(帶成交價)交給資料層或 client。
  const titleByItemId = new Map(detail.items.map((it) => [it.id, it.title]));
  const groups = await loadOrderShipments(titleByItemId);

  return (
    <section className='rounded-lg border bg-card p-4'>
      {/* 🔴 2026-08-09 Sean 實測後追加:出貨卡要能**直接出貨**,不必先回列表勾單。
          等於單張訂單版的勾單流程(預選 = 本單全部還能出的品項),
          走的是**同一個** `useShipmentLauncher` 與同一個彈窗 —— 不是第二份實作。 */}
      <div className='mb-3 flex flex-wrap items-start justify-between gap-2'>
        <h2 className='font-semibold'>出貨</h2>
        <OrderShipButton orderId={detail.id} />
      </div>

      {groups.length === 0 ? (
        <p className='text-muted-foreground text-sm'>
          這張訂單還沒有任何包裹。按右上角<b>建立包裹</b>直接出這一單;要和這位客人的其他訂單裝同一箱,
          請到<b>訂單列表</b>勾選那幾張單、按「出貨」。
        </p>
      ) : (
        <ul className='space-y-3'>
          {groups.map(({ shipment, lines }) => {
            const voided = shipment.voidedAt !== null;
            const shipped = shipment.shippedAt !== null;
            return (
              <li key={shipment.id} className='rounded border'>
                <div className='flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2'>
                  <span className='flex items-center gap-2 text-sm'>
                    <b className='font-mono'>{shipment.shipmentReference}</b>
                    <span
                      className={
                        voided
                          ? 'text-muted-foreground line-through'
                          : shipped
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                      }
                    >
                      {voided ? '已作廢' : shipped ? '已出貨' : '未出貨'}
                    </span>
                  </span>
                  <ShipmentVoidButton
                    shipmentId={shipment.id}
                    shipmentReference={shipment.shipmentReference}
                    voided={voided}
                  />
                </div>

                <div className='px-3 py-2 text-sm'>
                  <ul className='mb-2 space-y-1'>
                    {lines.map((l) => (
                      <li key={l.orderItemId} className='flex justify-between gap-3'>
                        <span className='min-w-0 truncate'>{l.title ?? '—'}</span>
                        <span className='text-muted-foreground shrink-0 tabular-nums'>×{l.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  <p className='text-muted-foreground text-xs'>
                    {CARRIER_LABEL[shipment.carrierCode] ?? shipment.carrierCode}
                    {shipment.carrierNote !== null && `(${shipment.carrierNote})`}
                    {' · '}
                    單號 {shipment.trackingNumber ?? '—'}
                  </p>
                  {voided && shipment.voidReason !== null && (
                    <p className='text-muted-foreground text-xs'>作廢原因:{shipment.voidReason}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* 🔴 這句話是必要的,不是贅字:同一箱可能還裝著別單的東西,而本卡只列本單的。 */}
      {groups.length > 0 && (
        <p className='text-muted-foreground mt-3 text-xs'>
          這裡只列<b>這張訂單</b>在各箱裡的品項。同一箱可能還裝著這位客人其他訂單的東西。
        </p>
      )}
    </section>
  );
}
