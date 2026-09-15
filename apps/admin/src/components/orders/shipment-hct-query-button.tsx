'use client';

// shipment-hct-query-button.tsx — 卡住的箱「向新竹查詢貨號」(只查不送)。
// plan:docs/plans/2026-09-15-hct-carrier-replied-exit-plan.md 片 A。判斷全在 server action。

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { queryHctUnknownAction, type HctQueryActionResult } from '../../lib/shipping/shipment-hct-query-action';

export function ShipmentHctQueryButton({
  shipmentId,
  shipmentReference,
}: {
  shipmentId: string;
  shipmentReference: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HctQueryActionResult | null>(null);
  const router = useRouter();

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const r = await queryHctUnknownAction({ shipmentId });
      setResult(r);
      // 查到 ⇒ 這一箱已經是 submitted, 同卡的「放回草稿」等舊鈕要跟著消失(R1 F5)
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }, [shipmentId, router]);

  if (result?.ok) {
    return (
      <p className='mt-1 text-xs text-emerald-700' role='status'>
        新竹有這張單(貨號 {result.edelno}),已記成已送出 —— 不要重送。標籤:同一天請在訂單明細頁按「重新取得標籤」;隔天救回的箱 ⇒ 把這一箱作廢、重新開一箱再送新竹(舊的新竹單可以打電話請新竹取消,不取消也沒關係)。
      </p>
    );
  }

  return (
    <div className='mt-1 space-y-1'>
      <button
        type='button'
        className='border-input rounded-md border px-2 py-1 text-xs disabled:opacity-50'
        disabled={busy}
        onClick={() => void run()}
        aria-label={`向新竹查詢貨號 ${shipmentReference}`}
      >
        {busy ? '查詢中…' : '向新竹查詢貨號'}
      </button>
      {result !== null && !result.ok && (
        <p className='text-destructive text-xs' role='status'>
          {result.message}
        </p>
      )}
    </div>
  );
}
