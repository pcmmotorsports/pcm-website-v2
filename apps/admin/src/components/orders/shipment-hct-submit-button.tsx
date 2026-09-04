'use client';

// shipment-hct-submit-button.tsx — ⟦ship-HCTAPI⟧ 步驟②(Sean 2026-09-05 拍甲批准)
//
// 🔴🔴 **關著的時候【灰掉 + 一句話】, 不是消失。**
//    消失時,「還沒開通」/「這張單不能送」/「我沒權限」**印同一個畫面**
//    ⇒ 📌 而那三種要做的事完全不同, 員工卻分不出來。
//
// 🛑 **本元件不讀任何 env** —— `hct-client.ts` 檔頭那道 eslint 閘的理由逐字:
//    「Next.js 不 inline → client bundle 取 undefined → runtime throw」。
//    ⇒ 開沒開由 **server action 回 `kind: 'disabled'`** 說了算,而那是**按下去才知道**。
//    ⇒ 🔵 所以初始狀態是「可以按」,按完若是 disabled 就**留在畫面上顯示那句話**。
//      ⚠️ 這是刻意的取捨:另一條路(先問一次 server)要多一次往返,
//      而那一次往返在 99% 的情況下(開關長期關著)只是為了把鈕畫灰。

import { useCallback, useState } from 'react';
import {
  submitShipmentToHctAction,
  type HctSubmitActionResult,
} from '../../lib/shipping/shipment-actions';

/** 送出後【不可以再按】的那幾種 —— 只有 `failed` 例外(新竹回失敗 ⇒ 可以重試)。 */
const LOCKED: readonly HctSubmitActionResult['kind'][] = [
  'submitted',
  'recovered',
  'unknown',
  'refused',
];

// 🔴🔴 **本元件【不吃 hct_status】—— 而那是一個刻意的取捨, 不是漏掉。**
//    要吃它就得把 `hct_status` 加進 `SHIPMENT_ROW_SELECT`, 而那個常數**同時餵
//    `listShipmentsByCustomer`(顧客站那條路)** ⇒ 📌 **為了畫一顆鈕, 往客人讀得到的投影加一欄。**
//    ⇒ ✅ 改由 server 當唯一權威:已送過的箱按下去會拿到 `refused`,
//      而 `decideSubmit` 給的理由**本來就是寫給人看的**(「這張單已經送成功過了…」)。
//    ⚠️ **代價明寫**:已送過的箱在按之前**看起來還是可以按的**。
//      按下去不會送出去(`decideSubmit` 在送出之前就擋),所以代價是一次白按, 不是一次重送。
export function ShipmentHctSubmitButton({
  shipmentId,
  shipmentReference,
}: {
  shipmentId: string;
  shipmentReference: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HctSubmitActionResult | null>(null);

  const locked = result !== null && LOCKED.includes(result.kind);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      setResult(await submitShipmentToHctAction({ shipmentId }));
    } finally {
      setBusy(false);
    }
  }, [shipmentId]);

  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        disabled={busy || locked}
        onClick={() => void run()}
        aria-label={`送新竹 ${shipmentReference}`}
        className='rounded-md border-input border px-2 py-1 text-xs disabled:opacity-50'
      >
        {busy ? '送出中…' : '送新竹'}
      </button>
      {result === null ? null : (
        <span
          className={
            result.ok
              ? 'text-xs text-green-700'
              : result.kind === 'unknown'
                ? 'text-xs font-bold text-orange-600'
                : result.kind === 'disabled'
                  ? 'text-muted-foreground text-xs'
                  : 'text-destructive text-xs'
          }
        >
          {result.ok
            ? `已送出 ${result.requestId === null ? '(新竹貨號待補)' : result.requestId}`
            : result.kind === 'disabled'
              ? '新竹未開通'
              : result.message}
        </span>
      )}
    </div>
  );
}
