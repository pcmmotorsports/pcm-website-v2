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

import Link from 'next/link';
import type { AdminOrderDetail } from '@pcm/domain';
import { loadEmptyShipments, loadOrderShipments } from '../../lib/shipping/order-shipments';
import { OrderShipButton } from './shipment-launcher';
import { ShipmentMarkShippedButton } from './shipment-mark-shipped-button';
import { ShipmentVoidButton } from './shipment-void-button';
// 🔴 標籤表已抽到 `lib/shipping/carrier-label.ts`(#10 片3),與出貨單那張紙、建箱彈窗共用同一份。
//    **行為零變更**:`carrierLabelOf` 的回退與抽出前的 `CARRIER_LABEL[code] ?? code` 逐字相同。
import { carrierLabelOf } from '../../lib/shipping/carrier-label';

export async function ShipmentSection({ detail }: { detail: AdminOrderDetail }) {
  // 🔴 只取 id 與 title 兩欄餵下去 —— 不把整包 detail(帶成交價)交給資料層或 client。
  const titleByItemId = new Map(detail.items.map((it) => [it.id, it.title]));
  // 🔴 兩支併發:空箱區與本單包裹清單沒有依賴關係,序列化只是白等一趟。
  const [groups, empties] = await Promise.all([
    loadOrderShipments(titleByItemId),
    // 🔴 只傳訂單 id —— 空箱查詢自己從 `orders` 反查客人,不從帶 PII 的 detail 取。
    loadEmptyShipments(detail.id),
  ]);

  return (
    <section className='rounded-lg border bg-card p-4'>
      {/* 🔴 2026-08-09 Sean 實測後追加:出貨卡要能**直接出貨**,不必先回列表勾單。
          等於單張訂單版的勾單流程(預選 = 本單全部還能出的品項),
          走的是**同一個** `useShipmentLauncher` 與同一個彈窗 —— 不是第二份實作。 */}
      <div className='mb-3 flex flex-wrap items-start justify-between gap-2'>
        <h2 className='font-semibold'>出貨</h2>
        <OrderShipButton orderId={detail.id} />
      </div>

      {/* 🔴🔴 `null` = 本單的箱品項清單**可能不完整**(截斷),不是「沒有箱」
          (2026-08-16 codex 關卡1 ⑧;約定與下方空箱區的 `empties === null` 逐字相同)。
          ⇒ **fail-closed:寧可不列,也不要列一份少了幾箱/幾件的清單** ——
             員工看到少一箱會以為貨不見了、看到少一件會以為已經出完。 */}
      {groups === null ? (
        <p className='text-muted-foreground text-sm'>
          這一單的包裹清單這次<b>沒能完整載入</b>,先不列(寧可不列,也不要列一份少了東西的清單)。
          請重新整理這一頁再看一次;還是一樣請找工程師,<b>不要憑印象出貨或作廢</b>。
        </p>
      ) : groups.length === 0 ? (
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
              <li key={shipment.id} className='rounded-md border'>
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
                  <span className='flex items-center gap-2'>
                    {/* #10 片2b:這一箱的出貨單入口。**開新分頁** —— 員工印完要回到這張單繼續做事。
                        🔴 **作廢的箱不給入口**(同片1 已取消訂單那條):本卡**刻意**仍列出作廢箱
                           (檔頭 `:10-11`:讓員工看得到貨回到可出貨池)⇒ 入口要自己擋。
                        ⚠️ **但這只是 UX,不是守門** —— 網址可貼、可書籤、分頁開著時箱才被作廢,
                           那些路徑全繞過這顆鈕。真守門在 `components/print/shipping-doc.tsx`
                           的 `shippingDocBlocker()`(擋**八種**狀態;原寫六種,2026-08-16 重數更正)。**兩層都要,少了下面那層這顆鈕等於零。** */}
                    {!voided && (
                      <Link
                        href={`/print/orders/${detail.id}/shipping/${shipment.id}`}
                        target='_blank'
                        rel='noopener'
                        className='border-border bg-card hover:bg-muted text-foreground inline-flex items-center rounded-md border px-2.5 py-1 text-xs'
                      >
                        列印出貨單
                      </Link>
                    )}
                    {/* 🔴 「填單號並標記出貨」—— **只在「未作廢且未出貨」時出現**。
                        它不是「補單號」:底下 RPC 一定同時寫 `shipped_at`
                        (`20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql:181`)⇒ 按下去是狀態轉換。
                        🔴 在此之前,員工按了建箱彈窗的「只建箱、先不出貨」就**沒有出口** ——
                           只能作廢重開新箱,而那會換箱號、已印的紙就白印了。
                           (能力本來就在 RPC 與 repository 層,缺的只有 action 與這顆入口。)
                        ⚠️ 已出貨的箱**改**單號這支做不到(RPC `:184` `AND shipped_at IS NULL` 是
                           write-once)—— **不是這裡漏給入口**,詳見 `shipment-actions.ts` 那支的 docstring。 */}
                    {!voided && !shipped && (
                      <ShipmentMarkShippedButton
                        shipmentId={shipment.id}
                        shipmentReference={shipment.shipmentReference}
                        carrierCode={shipment.carrierCode}
                      />
                    )}
                    <ShipmentVoidButton
                      shipmentId={shipment.id}
                      shipmentReference={shipment.shipmentReference}
                      voided={voided}
                    />
                  </span>
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
                    {carrierLabelOf(shipment.carrierCode)}
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
      {groups !== null && groups.length > 0 && (
        <p className='text-muted-foreground mt-3 text-xs'>
          這裡只列<b>這張訂單</b>在各箱裡的品項。同一箱可能還裝著這位客人其他訂單的東西。
        </p>
      )}

      {/* 🔴 #351④ 空箱區。**沒有空箱時整區不出現** —— 常態是沒有,長期掛一個「目前沒有空箱」
          只會佔版面並讓真的出現時不顯眼。
          🔴 這一區是**客人層**,不是本單:`shipments` 沒有 order_id(Sean 08-05 Q1=B 併箱同客人
          ⇒ 本來就不該加),而空箱連品項都沒有、與這張訂單之間一條線都沒有。
          ⇒ 文案必須講實話「可能來自別張訂單」,不可假裝是本單的。
          🔴 這是**可見化不是止血**:空箱會繼續產生(源頭 = #359,建箱與掛品項非原子)。 */}
      {/* 🔴 `null` = 空箱區**算不出來**(查不到客人 / 品項列被截斷),不是「沒有空箱」
          (2026-08-12 codex R1 MF2)。這兩者原本都畫成「整區不出現」= 一模一樣的畫面,
          而建箱彈窗的文案剛叫員工來這裡找那個箱 ⇒ 他會找到一張什麼都沒有的頁面。
          ⇒ fail-closed 的行為不變(絕不列出可能錯的箱),但要**講出來**。
          🔴 文案給的是**下一步**而不是狀態碼:箱號他手上有(彈窗給過),要他別丟。 */}
      {empties === null && (
        <div className='mt-4 border-t pt-3'>
          <h3 className='text-sm font-semibold'>未收尾的空箱</h3>
          <p className='text-muted-foreground mt-1 text-xs'>
            這一區這次<b>沒能算出來</b>,先不列(寧可不列,也不要指錯箱子)。
            如果你正要作廢一個剛建出來的空箱,請把<b>箱號記下來</b>,重新整理這一頁再看一次;
            還是沒有的話請找工程師,不要憑印象作廢別的箱子。
          </p>
        </div>
      )}

      {empties !== null && empties.length > 0 && (
        <div className='mt-4 border-t pt-3'>
          <h3 className='text-sm font-semibold'>
            未收尾的空箱 <span className='text-muted-foreground font-normal'>({empties.length})</span>
          </h3>
          <p className='text-muted-foreground mt-1 text-xs'>
            這些箱子建出來了但<b>一件東西都沒裝</b>(通常是建箱成功、掛品項失敗;
            也可能是<b>此刻有人正在建箱</b>)。它們掛在<b>這位客人</b>名下,
            <b>可能來自他的別張訂單</b>;確定不用了再作廢。
          </p>
          <ul className='mt-2 space-y-2'>
            {empties.map((s) => (
              <li
                key={s.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2'
              >
                <span className='flex items-center gap-2 text-sm'>
                  <b className='font-mono'>{s.shipmentReference}</b>
                  <span className='text-amber-700'>空箱</span>
                </span>
                {/* 🔴 `voided` 從資料算,**不要寫死 `false`** —— 寫死的話它會變成
                    `loadEmptyShipments` 那道「未作廢」過濾條件的第二個真相源,
                    哪天過濾條件放寬,這裡就會對一個已作廢的箱顯示「作廢」鈕。 */}
                <ShipmentVoidButton
                  shipmentId={s.id}
                  shipmentReference={s.shipmentReference}
                  voided={s.voidedAt !== null}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
