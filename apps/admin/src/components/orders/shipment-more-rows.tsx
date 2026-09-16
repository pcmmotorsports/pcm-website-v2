import Link from 'next/link';
import { carrierLabelOf } from '../../lib/shipping/carrier-label';
import { loadOrderShipments } from '../../lib/shipping/order-shipments';
// 🔴 單號優先序只住那一支(理由同 `order-inline-head.tsx`):走新竹時號碼在 `hct_request_id`。
import { shipmentListTracking } from '../../lib/shipping/shipment-list-view';
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

/**
 * 🔴🔴 **「登錯到貨」的回頭路**(2026-09-16, Sean 拍 乙′)。
 *
 * 🔬 他的原話逐字：「我有做登陸到貨, 但是如果今天要取消, 我找不到入口取消到貨這一件,
 *    因為可能我登記錯商品, 要回頭取消到貨登記用」。
 * 🔴 **根因不是「藏起來」, 是【那扇門不見了】** —— `orderNextStep()`
 *    (`order-status-axes.ts:665`)只回**一個**動作：登記到貨 ⇒ 貨品軸 ordered→instock
 *    ⇒ 列表那一格的字從「到貨登記」變「出貨」 ⇒ **再也生不出 `?do=receipt` 這條連結**。
 *    ⇒ 📌 這不是一個捷徑, 是**把他剛剛走過的那扇門補回來**。
 *
 * 🎯 **為什麼是連結, 而不是把撤銷 UI 搬進出貨彈窗**(Sean 原本拍的是搬進來):
 *    `shipment-launcher.tsx:194/:227` —— 出貨彈窗的「可出幾件」是 **`useState` 存的、
 *    開窗那一刻的快照**, `:294` 只有「建了箱」才 `router.refresh()`
 *    ⇒ 在這個彈窗裡撤掉到貨, 畫面上的數量**不會跟著變** ⇒ 他接著按確認會吃一個
 *    DB 拒絕（資料不會壞, 但那是一條死路）。**換頁沒有這個問題。**
 * 🔵 而它讓到貨彈窗那一片真的生效：落地之後「已登的到貨 N 筆(撤銷在這裡)」
 *    **已經是展開的**, 撤完就地重登 —— 那正是他的情境。
 * 🛑 **三個分支都要有它**：讀不到 / 還沒建箱 / 有箱。
 *    尤其是「還沒建箱」—— **那正是他最常在的狀態**(剛到貨、正要出貨才發現登錯)。
 */
function BackToReceipt({ href }: { href: string | undefined }) {
  if (href === undefined) return null;
  return (
    <Row label='到貨登錯了'>
      <Link
        href={href}
        className='border-border bg-card text-foreground inline-flex min-h-[26px] items-center rounded-lg border px-2 text-[12px] leading-[1.4]'
        data-testid='shipment-more-back-to-receipt'
      >
        回到貨登記(可以撤銷)
      </Link>
    </Row>
  );
}

export async function ShipmentMoreRows({
  orderId,
  backToReceiptHref,
}: {
  orderId: string;
  /** 沒給 = 不畫那一列（與區分「沒人傳」和「傳了空字串」）。 */
  backToReceiptHref?: string;
}) {
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
      <>
        <Row label='這張單的箱'>
          <span className='text-destructive'>讀不到(稍後再開一次)</span>
        </Row>
        <BackToReceipt href={backToReceiptHref} />
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        <Row label='這張單的箱'>
          <span className='text-muted-foreground'>還沒建箱</span>
        </Row>
        <BackToReceipt href={backToReceiptHref} />
      </>
    );
  }
  return (
    <div data-testid='shipment-more-rows'>
      {rows.map(({ shipment, hctStatus, hctPlaceholderStuck, hctRequestId }, i) => {
        const voided = shipment.voidedAt !== null;
        const shipped = shipment.shippedAt !== null;
        const isHct = shipment.carrierCode === 'hct';
        // 🔵 2026-09-16:這一列原本只讀 `shipment.trackingNumber` ⇒ 走新竹時整個號碼不見。
        const trk = shipmentListTracking({ trackingNumber: shipment.trackingNumber, hctRequestId });
        return (
          <div key={shipment.id} className={i > 0 ? 'mt-3 border-t pt-2' : ''} data-shipment-id={shipment.id}>
            <Row label='這張單的箱'>
              <span className='text-foreground'>
                箱 {i + 1} <b>{carrierLabelOf(shipment.carrierCode)}</b>
                {trk.text === '尚未取得' ? null : (
                  <span className='font-mono'>
                    {' · '}
                    {trk.text}
                    {trk.note !== null ? <span className='text-muted-foreground'>({trk.note})</span> : null}
                  </span>
                )}{' '}
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
                {/* 片 A(2026-09-15):卡在「送出結果未知」的箱不再給「送新竹」, 出口是上面提示裡的查詢鈕。 */}
                {hctStatus !== 'unknown' && (
                  // 🔴🔴 **2026-09-16:這個標籤原本寫「跟新竹物流叫車」, 而它底下掛的是【要號碼】那顆鈕。**
                  //    ⇒ 員工按完會以為**車叫好了**, 實際只是拿到一個託運單號 ——
                  //      📌 Sean 2026-09-16 真後台就是這樣:他以為出貨走完了, **而車根本還沒叫**。
                  //    ⇒ 🎯 那不是「名字不準」, 是**一句錯的標籤讓人以為一件沒做的事做完了**。
                  //    🔵 真的叫車在**出貨清單頁右上角**那顆「新竹物流叫車」(`shipment-pick.tsx:99`),
                  //      那顆維持原名 —— 它做的真的是叫車。
                  <Row label='跟新竹要託運單號'>
                    <ShipmentHctSubmitButton
                      shipmentId={shipment.id}
                      shipmentReference={shipment.shipmentReference}
                      shipped={shipped}
                      // 🔵 2026-09-16:同 `shipment-section.tsx` —— 只決定要不要印「還沒叫車」那一句。
                      hctStatus={hctStatus}
                    />
                  </Row>
                )}
              </>
            )}
            {!voided && !shipped && (
              <Row label='貨已經被收走了'>
                <ShipmentMarkShippedButton
                  shipmentId={shipment.id}
                  shipmentReference={shipment.shipmentReference}
                  carrierCode={shipment.carrierCode}
                  // 🔵 2026-09-16:同 `shipment-section.tsx` —— 這一箱自己的號碼,不跨箱。
                  defaultTracking={hctRequestId}
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
      {/* 🔵 有箱的時候也要給 —— 建完箱才發現登錯也是常有的事。放在最後：它不是【這幾箱】的動作。 */}
      <BackToReceipt href={backToReceiptHref} />
    </div>
  );
}
