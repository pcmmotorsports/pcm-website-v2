'use client';

// shipment-hct-submit-button.tsx — ⟦ship-HCTAPI⟧ 步驟②(Sean 2026-09-05 拍甲批准)
//
// ⛔ ~~**關著的時候【灰掉 + 一句話】, 不是消失。**~~
// 🔴 **code-reviewer 2026-09-05 nit③ 訂正:那個「灰掉」【從來沒有實作】。**
//    本元件按下去之前**不知道閘開沒開**(它不讀 env, 見下), 所以鈕一直是可以按的;
//    按完拿到 `disabled` 才把那句話印出來, **而鈕仍然可以再按**。
//    ⇒ 📌 **plan 寫的是「灰 + 一句話」, 實作是「可按 + 按完一句話」** ——
//      我在 commit body 裡照 plan 的字面寫, 而那是**用意圖描述結果**。
//    ✅ 保留「可按」是刻意的:Sean 放了 env 之後不必重整頁面。**而那個取捨要寫出來, 不是默默偏離。**
// 🔴 **不變的是那一半:關著的時候鈕【不消失】。**
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
// 🔵 `needs_confirm` **不在這裡** —— 它就是要員工再按一次。
// 🔴 `needs_human` 2026-09-05 補進來(codex nit):plan 逐字寫它「不可再按」,
//    而舊版漏了它 ⇒ 查無 / 要人處理的狀態還可以一直點。
const LOCKED: readonly HctSubmitActionResult['kind'][] = [
  'submitted',
  'recovered',
  'unknown',
  'refused',
  'needs_human',
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

  // 🔴 第一次按遇到 `needs_confirm`(有欄位會被截)⇒ 只顯示, 不送。
  //    員工看過再按一次 ⇒ 帶 `confirmTruncated` 才真的送出去。
  //    📌 那是 `hct-trans-data.ts` 契約要的「**印在員工按下去之前看得到的地方**」——
  //      而「按下去之前」在這裡的實作形狀是「**送出去之前**」。
  const run = useCallback(async () => {
    setBusy(true);
    try {
      // 🔴 把**上一次拿到的 token** 原樣帶回去 —— 它是「我看到的就是你現在算出來的」那個證據。
      //    資料在兩次之間變了 ⇒ token 對不上 ⇒ server 會再攔一次(codex must-fix)。
      const token =
        result !== null && !result.ok && result.kind === 'needs_confirm'
          ? result.confirmToken
          : null;
      setResult(
        await submitShipmentToHctAction(
          token === null ? { shipmentId } : { shipmentId, confirmTruncated: token },
        ),
      );
    } finally {
      setBusy(false);
    }
  }, [shipmentId, result]);

  return (
    <div className='flex flex-col gap-1'>
      <button
        type='button'
        disabled={busy || locked}
        onClick={() => void run()}
        aria-label={`送新竹 ${shipmentReference}`}
        className='rounded-md border-input border px-2 py-1 text-xs disabled:opacity-50'
      >
        {busy
          ? '送出中…'
          : result !== null && !result.ok && result.kind === 'needs_confirm'
            ? '知道了, 還是要送'
            : '送新竹'}
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
            : // 🔵 nit①:**用 server 給的那句**, 不要一律印「新竹未開通」——
              //    `readHctDeps` 那段 docstring 逐字說「缺一顆 env 要給不同訊息」,
              //    而舊版把它蓋掉了 ⇒ 兩種完全不同的原因印同一句話。
              result.message}
        </span>
      )}
    </div>
  );
}
