'use client';

import { useCallback, useState } from 'react';
import { refetchHctLabelAction } from '../../lib/shipping/shipment-submit-hct-action';

/**
 * ⟦ship-HCTLABEL⟧ 乙型救回的箱「重新取得標籤」(2026-09-14)。
 * 🔴 只在 `submitted`、raw 沒有標籤圖、而且【今天】送到新竹時由出貨卡渲染(`hctLabelRefetchable`);按下去 = 同日同單號向新竹更正一次拿 image。
 * 🛑 真守門在 action + RPC(狀態 / 貨號 / 有圖 / 不是今天 ⇒ 都拒);這裡只是入口。
 */
export function ShipmentHctLabelRefetchButton({ shipmentId, shipmentReference }: { shipmentId: string; shipmentReference: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const onClick = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    const out = await refetchHctLabelAction({ shipmentId });
    setBusy(false);
    if (out.ok) {
      setDone(true);
      setMessage(`已從新竹拿回標籤圖(貨號 ${out.requestId})—— 現在可以列印。`);
      return;
    }
    setMessage(out.message);
  }, [shipmentId]);
  if (done) {
    return (
      <p className='text-muted-foreground basis-full text-xs' role='status'>
        {message}
      </p>
    );
  }
  // 🔵 那一排是 flex-wrap ⇒ 鈕自己站在同排, 說明與錯誤各占一整行(basis-full)—— 包成一團會把鈕頂高於同排其他顆。
  return (
    <>
      <button
        type='button'
        className='border-border bg-card hover:bg-muted text-foreground inline-flex items-center rounded-md border px-2.5 py-1 text-xs disabled:opacity-50'
        onClick={onClick}
        disabled={busy}
        aria-label={`重新取得標籤 ${shipmentReference}`}
      >
        {busy ? '向新竹重取中…' : '重新取得標籤'}
      </button>
      <p className='text-muted-foreground basis-full text-xs'>
        這一箱今天已查到新竹貨號，但尚未取得標籤。按下後會以同一貨號向新竹送出更正資料並取得標籤，同一天內不會新增託運單。
      </p>
      {message !== null ? (
        <p className='text-destructive basis-full text-xs' role='alert'>
          {message}
        </p>
      ) : null}
    </>
  );
}
