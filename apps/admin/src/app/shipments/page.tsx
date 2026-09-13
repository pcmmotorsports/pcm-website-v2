import Link from 'next/link';
import { ShipmentDispatchAllButton, ShipmentPickBox, ShipmentPickProvider } from '@/components/shipments/shipment-pick';
import { AutoApplySubmit } from '@/components/shared/auto-apply-submit';
import { dispatchButton } from '@/lib/shipping/hct-dispatch-flow';
import { listShipmentsByDay, SHIPMENT_LIST_LIMIT } from '../../lib/shipping/shipment-list-read';
import { STATUS_CAPSULE, formatOrderListDate } from '../../lib/orders/order-list-view';
import {
  canPrintLabel,
  isVoided,
  printOrderId,
  shipmentListDate,
  shipmentListOrders,
  shipmentListStatus,
  shipmentListTracking,
} from '../../lib/shipping/shipment-list-view';

// app/shipments/page.tsx —— 出貨清單(唯讀)。
//
// ══ 為什麼有這一頁 ═════════════════════════════════════════════════════════
// Sean 2026-09-10,第一箱新竹貨送出之後逐字:
//   「有貨號,但是沒有辦法列印單據、或者看今天、昨天、之前清單紀錄」
// 🔵 **列印他猜錯了** —— 三種單(訂單明細 / 出貨明細單 / 託運標籤)本來就都有。
// 🔴 **而清單那半他是對的**:`apps/admin/src/app` 底下**沒有任何 shipments 路由**,
//    只能一張訂單一張訂單點進去。**這一頁就是那一半。**
//
// ══ 規格 = Sean 逐字 ═══════════════════════════════════════════════════════
//   「甲 = 現在做一頁最陽春的 —— 一個列表:日期 / 箱號 / 訂單 / 客人 / 貨號 / 狀態,
//     可以挑日期,每一列可以直接點去印。上線前做得完。」
// 🛑 **六欄,不加第七欄。** 不做批次動作(勾選 / 批次列印)。**只讀,不碰任何寫入。**
//
// ══ 🔴 鐵則 1:稿裡沒有這一頁(量過的,出處在 `shipment-list-view.ts` 檔頭)═══
// ⇒ **樣式沿用後台既有的陽春表** `app/orders/refund-exceptions/page.tsx:126-127` 的
//   `TH` / `TD` 兩個字串與 `overflow-x-auto rounded-lg border bg-card` 那層外框。
// 🛑 **刻意【不】沿用訂單列表那張**(`components/orders/orders-table.tsx`, 803 行):
//    它綁著 `.orders-grid` 的密度系統(`--od-fs` / `--od-row-h`)與手機卡片 CSS
//    (`td:empty{display:none}` 那一整套)⇒ 抄它 = 把一台機器搬進一頁「最陽春的」清單。
//    ⇒ 📌 **「沿用既有樣式」是沿用那個視覺語言, 不是沿用最複雜的那個實作。**
//
// ══ 🔴🔴 三顆列印鈕都開新分頁 ═══════════════════════════════════════════════
// Sean 2026-08-23 逐字(`orders-admin-v2.html:6123` / `HANDOFF-orders-ui.md:2254` FIX-66):
//   「列印單據都是跳新視窗,不是在訂單頁開啟」
// ⚠️ 而**託運標籤不在那句話的列舉裡**(那句列的是「明細單、出貨單」)——
//    ⇒ 它照同一條規矩走,理由是**同一類東西沿用同一條規矩**,不是「那句話點名了它」。
//    (這個分寸逐字抄自 `shipment-section.tsx:339-345`。)
//
// ══ 🔴 作廢的箱:列出來,而不給列印入口 ═════════════════════════════════════
// 既有立場在 `shipment-section.tsx:296-300`,理由是「讓員工看得到貨回到可出貨池」。
// ✅ **而我確認過那個理由在【清單頁】也成立,不是照抄結論** ——
//    這一頁要答的是「今天、昨天、之前的紀錄」,而**作廢的箱就是紀錄的一部分**。
//    🔬 而它更強:正式庫今天 4 箱裡 **3 箱是作廢的** ⇒ 藏起來的話這一頁只剩 1 列,
//       而 Sean 打開會以為他之前做的事全部不見了。
// ⚠️ **而不給入口只是 UX,不是守門** —— 網址可貼、可書籤 ⇒ 真守門在
//    `components/print/shipping-doc.tsx` 的 `shippingDocBlocker()`。**兩層都要。**

export const dynamic = 'force-dynamic';

const TH = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap';
const TD = 'px-3 py-2 text-sm align-middle';
/* 稿 v22 `.ib`(列印那兩顆小鈕):border 1 --line / radius 7(⇒ token rounded-lg 8)/ padding 2 8 / 12px / --fg2 字。 */
const PRINT_LINK =
  'pcm-ib border-border bg-card hover:bg-muted inline-flex items-center rounded-lg border px-2 py-0.5 text-[12px] leading-[1.4] whitespace-nowrap text-(--fg-2)';
const PRINT_LINK_OFF = 'border-border bg-card text-muted-foreground inline-flex items-center rounded-lg border px-2 py-0.5 text-[12px] leading-[1.4] whitespace-nowrap opacity-50';

/** 台北時區的今天(`YYYY-MM-DD`)。 */
function todayInTaipei(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
}

/**
 * `YYYY-MM-DD`(台北)⇒ 那一天的 UTC 起訖。
 *
 * 🔴 **台北固定 UTC+8、沒有日光節約** ⇒ 直接減 8 小時是對的,不需要時區函式庫。
 *    ⚠️ 而這一句是**這一頁能不能挑對日期的全部** —— 用 `new Date(day)` 會被當 UTC 午夜,
 *    ⇒ 台北的早上 8 點以前那些箱會掉到前一天。
 */
function taipeiDayRange(day: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const start = new Date(`${day}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const sp = await searchParams;
  const requested = typeof sp.day === 'string' ? sp.day : '';
  const range = taipeiDayRange(requested);
  // 🔵 沒給日期 / 給了看不懂的 ⇒ 退回今天。**不空著** —— 一頁空白的清單與「那天沒有箱」長一樣。
  const day = range === null ? todayInTaipei() : requested;
  const effective = range ?? taipeiDayRange(day)!;

  const { rows, truncated } = await listShipmentsByDay(effective.start, effective.end);

  /* 🎨 對稿 v22 §4(2026-09-14,主視窗派 C3):`.pcm-plist` 那層幾何(設計窗 a910635a3)包整頁 ——
     頂列 h1 + 「挑日期」date + `.pcm-sp` + 右上角「新竹物流叫車」藍鈕;表 8 欄(勾 / 日期 / 箱號 / 訂單 / 客人 / 貨運單號 / 狀態 cap / 列印 兩顆小鈕),列高 38。
     🔴 叫車:每列那顆鈕退場,改成「勾幾箱 → 右上角一顆」,而它逐箱呼叫的仍是既有 `dispatchShipmentAction`(零新寫入路;`shipment-pick.tsx` 檔頭)。
     🔴 列印只留兩顆(稿):「明細單」= 出貨明細單、「標籤」= 託運標籤(不能印時灰掉不藏,稿上第二列的「標籤」就是灰的);
        「訂單明細」那張紙從這一頁退場 —— 它在明細頁的入口還在(`order-detail-header.tsx`),這一頁是出貨工作台。
     🔴 日期欄兩行(日期 + 那句 note)在稿上是一行 ⇒ note 改成同行小字。 */
  return (
    <ShipmentPickProvider>
      <div className='pcm-plist mx-auto space-y-3'>
        <div className='pcm-head'>
          <h1>出貨清單</h1>
          {/* 🔵 原生 `<form method='get'>` + `<input type='date'>`,零 JS 也能用;`AutoApplySubmit` 選了日期就送、沒 JS 時留一顆鈕。 */}
          <form method='get' className='pcm-filt flex items-center gap-2'>
            <label className='flex items-center gap-1'>
              <span className='text-muted-foreground'>挑日期</span>
              <input type='date' name='day' defaultValue={day} className='border-border bg-card rounded-md border' />
            </label>
            <AutoApplySubmit label='查這一天' className='border-border bg-card hover:bg-muted rounded-md border' />
          </form>
          <span className='pcm-sp' />
          <ShipmentDispatchAllButton />
        </div>

        {truncated && (
          <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-3 text-sm'>
            這一天的箱子超過 {SHIPMENT_LIST_LIMIT} 個,下面只列了前 {SHIPMENT_LIST_LIMIT} 個。
            要看完整紀錄請縮小日期範圍或找工程處理。
          </div>
        )}

        {rows.length === 0 ? (
          <div className='bg-card text-muted-foreground rounded-lg border p-6 text-sm'>{day} 沒有建立任何箱子。</div>
        ) : (
          <div className='overflow-x-auto rounded-lg border bg-card'>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className={TH} aria-label='勾選' />
                  <th className={TH}>日期</th>
                  <th className={TH}>箱號</th>
                  <th className={TH}>訂單</th>
                  <th className={TH}>客人</th>
                  <th className={TH}>貨運單號</th>
                  <th className={TH}>狀態</th>
                  <th className={TH}>列印</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const date = shipmentListDate(row);
                  const tracking = shipmentListTracking(row);
                  const { first, moreCount } = shipmentListOrders(row);
                  const orderId = printOrderId(row);
                  const voided = isVoided(row);
                  const dispatch = dispatchButton(row, new Date());
                  const printable = orderId !== null && !voided;
                  return (
                    <tr key={row.shipmentId} className='border-t'>
                      <td className={TD}>
                        <ShipmentPickBox
                          shipmentId={row.shipmentId}
                          enabled={dispatch.show && dispatch.enabled}
                          why={dispatch.show ? (dispatch.enabled ? null : dispatch.why) : '這一箱不是新竹物流'}
                        />
                      </td>
                      {/* 稿 09/13 一格 104 寬 ⇒ 用列表同一支 `formatOrderListDate`(今年只印 月/日);「還沒標記出貨」那句縮成「建箱」小字,
                          時分不印 —— 這一頁是「哪一天」的工作台,時分在明細頁。 */}
                      <td className={`${TD} whitespace-nowrap`}>
                        {formatOrderListDate(date.text)}
                        {date.note !== null && <span className='text-muted-foreground ml-1 text-[11.5px]'>建箱</span>}
                      </td>
                      <td className={`${TD} font-medium whitespace-nowrap`}>{row.shipmentReference}</td>
                      <td className={`${TD} whitespace-nowrap`}>
                        {first === null ? (
                          <span className='text-muted-foreground'>查無訂單</span>
                        ) : (
                          <>
                            <Link href={`/orders/${first.orderId}`} className='font-medium underline'>
                              {first.displayId}
                            </Link>
                            {moreCount > 0 && (
                              <span className='text-muted-foreground ml-2 text-xs whitespace-nowrap'>還有 {moreCount} 張</span>
                            )}
                          </>
                        )}
                      </td>
                      <td className={TD}>{row.recipientName ?? <span className='text-muted-foreground'>未記錄</span>}</td>
                      <td className={`${TD} tabular-nums whitespace-nowrap`}>
                        {tracking.text}
                        {tracking.note !== null && <span className='text-muted-foreground ml-1 text-[11.5px]'>{tracking.note}</span>}
                      </td>
                      <td className={`${TD} whitespace-nowrap`}>
                        <span className={`${STATUS_CAPSULE} cap-n`}>{shipmentListStatus(row)}</span>
                      </td>
                      <td className={`${TD} space-x-1 whitespace-nowrap`}>
                        {printable ? (
                          <Link href={`/print/orders/${orderId}/shipping/${row.shipmentId}`} target='_blank' rel='noopener' className={PRINT_LINK}>
                            明細單
                          </Link>
                        ) : (
                          <span className={PRINT_LINK_OFF} aria-disabled='true'>明細單</span>
                        )}
                        {printable && canPrintLabel(row) ? (
                          <Link href={`/print/orders/${orderId}/shipping/${row.shipmentId}/label.pdf`} target='_blank' rel='noopener' className={PRINT_LINK}>
                            標籤
                          </Link>
                        ) : (
                          <span className={PRINT_LINK_OFF} aria-disabled='true'>標籤</span>
                        )}
                        {!printable && <span className='text-muted-foreground ml-1 text-[11.5px]'>{voided ? '作廢不印' : '無訂單可印'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className='pcm-note2'>這一頁是出貨當天的工作台,按箱看。要按訂單看去「訂單」那一頁。</p>
      </div>
    </ShipmentPickProvider>
  );
}
