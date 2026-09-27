'use client';

// shipment-hct-dispatch-button.tsx — 箱子彈窗裡的「新竹物流叫車」(2026-09-27 出貨流程乙第 1 項)。
// 拿到託運單號的箱, 在同一個彈窗就能叫車, 不用換頁(v22 設計稿原本就把叫車放在出貨彈窗的「更多」)。
// 寫入走既有 dispatchShipmentAction(佔位 → 呼叫新竹 → 記結果 → 標出貨), 本檔不新增寫入路。
// 🔴 叫到車或結果不確定 ⇒ 鈕鎖住:再按一次可能叫來兩台車。只有「沒送出」(閘關著 / 明白被拒以外的錯誤)才可再按。

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchShipmentAction, type DispatchActionResult } from '../../lib/shipping/shipment-dispatch-hct-action';

export function ShipmentHctDispatchButton({ shipmentId, shipmentReference }: { shipmentId: string; shipmentReference: string }) {
  const [result, setResult] = useState<DispatchActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const locked = result !== null && (result.ok || result.kind === 'needs_human' || result.kind === 'rejected');
  return (
    <span className='flex flex-col items-end gap-1'>
      <button
        type='button'
        disabled={busy || locked}
        aria-label={`新竹物流叫車 ${shipmentReference}`}
        onClick={() =>
          start(async () => {
            const r = await dispatchShipmentAction({ shipmentId });
            setResult(r);
            router.refresh();
          })
        }
        className='bg-primary text-primary-foreground rounded-md px-2.5 py-1 text-xs font-semibold disabled:opacity-50'
      >
        {busy ? '叫車中…' : '新竹物流叫車'}
      </button>
      {result !== null && (
        <span
          role='status'
          className={`text-right text-xs ${result.ok ? 'text-emerald-700' : result.kind === 'needs_human' ? 'font-medium text-orange-700' : 'text-muted-foreground'}`}
        >
          {result.ok ? `已叫到車（貨號 ${result.edelno}），系統已標記出貨。` : result.message}
        </span>
      )}
    </span>
  );
}
