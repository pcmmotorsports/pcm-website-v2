'use client';

// shipment-mark-shipped-button.tsx — 出貨卡上的「填單號並標記出貨」(client island)。
//
// 🔴🔴 **這顆不是「補單號」,是「標記出貨」。**
//    底下 RPC(`20260807190000_m4b_e10_b2_w3c3_mark_shipped.sql:181` 逐字
//    `SET shipped_at = now(), tracking_number = p_tracking_number`)**一定會同時寫 `shipped_at`**
//    ⇒ 按下去等於宣告「貨已經交給貨運了」。
//    **文案刻意不寫「補單號」/「編輯」** —— 那會讓員工以為只是改一個欄位,而它是狀態轉換。
//
// 🔴 **主詞是【這一箱】不是【這張訂單】。**
//    `shipments` 沒有 `order_id`,一箱可含多張訂單(`loadOrderShipments` 是**從品項反查箱**,
//    `lib/shipping/order-shipments.ts:67` 逐字)⇒ **同一箱會出現在每一張含它品項的訂單頁上**,
//    這顆鈕也是。⇒ 文案講箱號,不講「這張訂單出貨了」,否則在另一張單上讀起來是假的。
//    ⚠️ 兩個人在兩張訂單頁各按一次 ⇒ 第二次撞 RPC `:153`「已經寄出了」,那是**對的行為**,
//    不要為了讓它「看起來成功」去吞掉那個錯。
//
// 🔴 **props 只收純量**(同 `shipment-void-button.tsx` 那條紅線):
//    訂單詳情讀模型帶成交價與收件人 PII,整包不得進 client props。
//
// 🔴 **冪等鍵在「按下去」那一刻生成一次,存進 state;重試沿用同一把**(同建箱彈窗與作廢鈕)。
//    每次送出各生一把 ⇒ 連按兩次會是兩個不同的操作,而我們自己把冪等弄丟了。

import { useCallback, useState } from 'react';
import { markShipmentShippedAction } from '../../lib/shipping/shipment-actions';

export function ShipmentMarkShippedButton({
  shipmentId,
  shipmentReference,
  /** `other`(自取/自送)時單號可省 —— DB CHECK `shipments_shipped_needs_tracking` 是這樣寫的。 */
  carrierIsOther,
}: {
  shipmentId: string;
  shipmentReference: string;
  carrierIsOther: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);

  // 🔴 前置擋門與 DB CHECK 對齊、不自己發明:
  //    `shipments_shipped_needs_tracking` 逐字
  //    `shipped_at IS NULL OR carrier_code='other' OR NOT is_blank(tracking_number)`
  //    ⇒ 非 other 而單號空白,在資料層就不合法。這裡先擋是為了把「難懂的 DB 錯誤」
  //    換成「看得懂的前置提示」,**不是**多加一條 DB 沒有的規則。
  const blocker = !carrierIsOther && tracking.trim() === '' ? '請先填貨運單號。' : null;

  const run = useCallback(async () => {
    const k = key ?? crypto.randomUUID();
    setKey(k);
    setBusy(true);
    setError(null);
    const r = await markShipmentShippedAction({
      idempotencyKey: k,
      shipmentId,
      ...(tracking.trim() === '' ? {} : { trackingNumber: tracking.trim() }),
    });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setTracking('');
      setKey(null);
    } else {
      setError(r.message);
    }
  }, [key, shipmentId, tracking]);

  if (!open) {
    return (
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='border-border bg-card hover:bg-muted text-foreground inline-flex items-center rounded-md border px-2.5 py-1 text-xs'
      >
        填單號並標記出貨
      </button>
    );
  }

  return (
    <span className='flex flex-wrap items-center gap-2'>
      <input
        value={tracking}
        onChange={(e) => setTracking(e.target.value)}
        placeholder={carrierIsOther ? '單號(自取/自送可留空)' : '貨運單號'}
        aria-label={`包裹 ${shipmentReference} 的貨運單號`}
        className='border-input bg-background h-7 w-40 rounded border px-2 text-xs'
      />
      <button
        type='button'
        disabled={busy || blocker !== null}
        onClick={() => void run()}
        className='bg-foreground text-background rounded px-2.5 py-1 text-xs font-semibold disabled:opacity-50'
      >
        {busy ? '送出中…' : '標記出貨'}
      </button>
      <button
        type='button'
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className='rounded border px-2.5 py-1 text-xs'
      >
        取消
      </button>
      {/* 🔴 主詞是箱號:同一箱會出現在多張訂單頁上,寫「這張訂單」在別張上是假的。 */}
      {blocker !== null && <span className='text-muted-foreground text-xs'>{blocker}</span>}
      {error !== null && <span className='text-destructive text-xs'>{error}</span>}
    </span>
  );
}
