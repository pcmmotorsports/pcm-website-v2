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
        新竹已確認有這張託運單（貨號 {result.edelno}），系統已更新為已送出，請勿重送。
        若託運單是在今天建立，請到訂單明細按「重新取得標籤」。
        若是前一天或更早建立，請作廢這一箱，重新建箱並申請新竹託運單號。
        原託運單可致電新竹取消；未取消也不影響重新申請。
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
