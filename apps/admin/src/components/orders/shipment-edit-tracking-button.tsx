'use client';

// shipment-edit-tracking-button.tsx — 已出貨包裹的「更正單號」(client island)。
//
// 🔴🔴 **這顆與旁邊那顆「填單號並標記出貨」是【兩個動作】, 不是同一個的兩種模式。**
//    · 標記出貨   = 一件事**第一次發生**(而且客人會收到一封信)
//    · 更正單號   = **修一個已經發生的事實**, 而客人手上那封信【已經寄出去了】
//    ⇒ 📌 所以文案是「更正」不是「編輯」—— 員工按下去之前要知道他在修一個**已經對外的東西**。
//
// 🔴 **它只在【已出貨 且 未作廢】的箱上出現**(`shipment-section.tsx` 的 `shipped && !voided`):
//    · 未出貨 ⇒ 旁邊那顆就是填單號的地方 ⇒ 給兩個入口會讓員工不知道該按哪一個
//    · 已作廢 ⇒ 那個單號不會再被任何人看到 ⇒ 更正它沒有意義
//    ⚠️ **而 UI 這一層只是不要讓他白按** —— 真守門在 RPC(`admin_update_shipment_tracking`
//    的四道:找不到 / 已作廢 / 還沒出貨 / 不得清空), 兩層都要有。
//
// 🔴 **主詞是【這一箱】不是【這張訂單】** —— 同一箱會出現在每一張含它品項的訂單頁上
//    (同旁邊那顆的檔頭第二段, 理由逐字相同)。
//
// 🔴 **props 只收純量**;**冪等鍵在按下去那一刻生成一次、重試沿用同一把**(同上)。

import { useCallback, useState } from 'react';
import { updateShipmentTrackingAction } from '../../lib/shipping/shipment-actions';
import { trackingNumberIssue } from '../../lib/shipping/tracking-number';

export function ShipmentEditTrackingButton({
  shipmentId,
  shipmentReference,
  carrierCode,
  currentTrackingNumber,
}: {
  shipmentId: string;
  shipmentReference: string;
  /** 🔴 收代碼不收布林 —— 單號格式檢查要知道【是哪一家】(同旁邊那顆的 R1 MF1)。 */
  carrierCode: string;
  /** 現在的單號。🔵 預先填進輸入框 —— 更正通常是改一兩碼, 不是重打。 */
  currentTrackingNumber: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(currentTrackingNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);

  // 🔴🔴 **參數順序是 `(carrierCode, trackingNumber, settled)`** —— codex R1 #5 抓到我傳反了。
  //    🛑 **兩個參數都是 `string` ⇒ typecheck 全綠、lint 全綠、測試也全綠** ——
  //    而症狀是「貨運商」被當成單號去檢查格式 ⇒ **那三條規則靜靜地全部失效**。
  //    📌 而第三個參數 `settled` 本來就在函式裡做我手寫的那件事(還在打字就不回問題)
  //       ⇒ 我原本外面包一層 `settled ? … : null` 是**重複做了它已經做的事**。
  const issue = trackingNumberIssue(carrierCode, tracking, settled);
  // 🔴 **已出貨的箱不得把單號清空** —— DB CHECK `shipments_shipped_needs_tracking` 會擋,
  //    而在這裡先擋是為了讓他【在鍵盤前面】就知道, 不是按了才看到。
  //    ⚠️ `other`(自取/自送)沒有這條限制:它本來就可以沒有單號。
  const blocker =
    carrierCode !== 'other' && tracking.trim() === ''
      ? '已出貨的箱不能把單號清空。要改成沒有單號請作廢這一箱。'
      : tracking.trim() === (currentTrackingNumber ?? '')
        ? // 🔵 沒有變化就不要送 —— 送了 RPC 會回 changed:false(不寄信、不寫稽核),
          //    而員工看到「成功」卻什麼都沒發生會更困惑。
          '單號沒有變。'
        : issue?.level === 'block'
          ? issue.message
          : null;

  const run = useCallback(async () => {
    const k = key ?? crypto.randomUUID();
    setKey(k);
    setBusy(true);
    setError(null);
    const r = await updateShipmentTrackingAction({
      idempotencyKey: k,
      shipmentId,
      trackingNumber: tracking.trim(),
    });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
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
        更正單號
      </button>
    );
  }

  return (
    <span className='flex flex-wrap items-center gap-2'>
      <input
        value={tracking}
        onChange={(e) => {
          setTracking(e.target.value);
          setSettled(false);
        }}
        onBlur={() => setSettled(true)}
        placeholder='貨運單號'
        aria-label={`包裹 ${shipmentReference} 的貨運單號(更正)`}
        className='border-input bg-background h-7 w-40 rounded-md border px-2 text-xs'
      />
      <button
        type='button'
        disabled={busy || blocker !== null}
        onClick={() => void run()}
        className='bg-foreground text-background rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50'
      >
        {busy ? '送出中…' : '更正'}
      </button>
      <button
        type='button'
        disabled={busy}
        onClick={() => {
          setOpen(false);
          setError(null);
          setTracking(currentTrackingNumber ?? '');
        }}
        className='rounded-md border px-2.5 py-1 text-xs'
      >
        取消
      </button>
      {/* 🔴 擋比警告顯眼(同旁邊那顆的 R2 F-E2)。 */}
      {blocker !== null && <span className='text-xs font-semibold text-red-700'>{blocker}</span>}
      {blocker === null && issue?.level === 'warn' && (
        <span className='text-xs font-medium text-amber-700'>{issue.message}</span>
      )}
      {error !== null && <span className='text-destructive text-xs'>{error}</span>}
    </span>
  );
}
