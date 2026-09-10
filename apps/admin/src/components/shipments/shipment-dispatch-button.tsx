'use client';

import { useState, useTransition } from 'react';
import {
  dispatchShipmentAction,
  type DispatchActionResult,
} from '@/lib/shipping/shipment-dispatch-hct-action';

// shipment-dispatch-button.tsx — 「叫車」那顆鈕(⟦ship-DISPATCHORDER⟧ 片五)。
//
// 🔴🔴 **這一片是【疊在】出貨清單頁上的, 那一頁維持只讀** —— plan §8 逐字。
//    ⇒ 本檔一個字都不改窗 D 那支 `page.tsx` 的資料流:它只吃已經算好的判準。
//
// 🛑 **不做二次確認對話框** —— 而那是刻意的:
//    真正不可回收的那一發被**三道**擋著(env 閘預設關 · claim 的原子 UPDATE · 30 天與狀態判準),
//    而多一個「你確定嗎」只會訓練人一直按確定。
//    📌 **會擋住的是那三道, 不是那個對話框。**

export type ShipmentDispatchButtonProps = {
  readonly shipmentId: string;
  /** 由 server 端 `dispatchButton()` 算好 —— 🔴 client 這一層**不重算**, 免得兩邊漂開。 */
  readonly enabled: boolean;
  /** 不給按的時候要說的那句話。 */
  readonly why: string | null;
};

export function ShipmentDispatchButton({ shipmentId, enabled, why }: ShipmentDispatchButtonProps) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DispatchActionResult | null>(null);

  if (!enabled) {
    return <span className='text-muted-foreground text-xs'>{why ?? '不能叫車'}</span>;
  }

  return (
    <span className='inline-flex flex-col items-start gap-0.5'>
      <button
        type='button'
        disabled={pending || result?.ok === true}
        onClick={() => {
          start(async () => {
            setResult(await dispatchShipmentAction({ shipmentId }));
          });
        }}
        // 🔴 **刻意沒有圓角類別** —— 這個後台的圓角四階寫死 0(BMW M design token),
        //    而 `app/design-tokens.test.ts` 有一格禁它。它抓到我【兩次】:
        //    第一次是這一行真的寫了那個類別, 第二次是我把它寫進【這句註解裡】
        //    ⇒ 📌 那道尺逐行讀檔, **它分不出碼與註解** —— 同一族的第 N 次。
        className='border px-2 py-0.5 text-xs disabled:opacity-50'
      >
        {pending ? '叫車中…' : '叫車'}
      </button>
      {result !== null && (
        // 🔴 **成功與「不確定」印【不同顏色】** —— 而那不是裝飾:
        //    `needs_human` 的意思是「車可能已經在路上而我們不知道」,
        //    📌 它與「失敗了, 沒事」長得一樣的話, 沒有人會去看那一箱。
        <span
          className={`text-xs ${
            result.ok
              ? 'text-green-700'
              : result.kind === 'needs_human'
                ? 'font-medium text-orange-700'
                : 'text-muted-foreground'
          }`}
        >
          {result.ok ? `叫到車了(${result.edelno})` : result.message}
        </span>
      )}
    </span>
  );
}
