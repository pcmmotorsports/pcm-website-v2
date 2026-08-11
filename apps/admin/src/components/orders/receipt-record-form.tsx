'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { ORDER_RETURN_TO_FIELD } from '../../lib/orders/order-return-to';
import { recordItemReceiptAction } from '../../lib/orders/receipt-actions';
import {
  RCPT_NOTE_FIELD,
  RCPT_ORDER_ID_FIELD,
  RCPT_ORDER_ITEM_ID_FIELD,
  RCPT_PROCUREMENT_ID_FIELD,
  RCPT_QUANTITY_FIELD,
  RCPT_RECEIVED_AT_LOCAL_FIELD,
  RCPT_REQUEST_ID_FIELD,
  RCPT_SURPLUS_FIELD,
  type ReceiptActionState,
  type ReceiptFormValues,
} from '../../lib/orders/receipt-action-state';
import { toTaipeiInputValue } from '../../lib/orders/procurement-view';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// M-4b E10 #352-b:單筆採購的「登錄到貨」小視窗。
// 🔴 中文字面全部暫定、待 Sean 肉眼定稿(結構鎖、字不鎖)。
//
// 🔴 **操作直覺化**(Sean 2026-08-11 常設指令:「系統成不成功、好不好用就看這一塊」):
//    欄位順序照員工心智模型 —— 先「到貨幾件」(預設就是還沒到的那些)、再「什麼時候到的」,
//    溢收與備註是少數情況才碰的東西 ⇒ 收在後面、且用一句話講清楚它是幹嘛的。
//
// 🔴 **`request_id` 是冪等鍵,掛載時產生一次、之後不再變**(plan §5.1 逐字):
//    每次 render 重產會讓「重送」變成新請求、冪等失效 —— 員工手滑按兩次就記兩筆到貨。
//    形狀必須通過 RPC `20260811010000:101-103`(可列印 ASCII、無空白、**全小寫**、≤200):
//    形狀由 `mintRequestId()` 保證(全小寫十六進位加連字號)。
//
// 🔴 **未 hydrate 時送不出去,而且這是刻意的**:`request_id` 由本元件在 client 產生
//    ⇒ SSR 的 HTML 裡那個 hidden 是空的、action 解析會回 `invalid`。
//    ⇒ 送出鈕在 `requestId === ''` 時停用,讓員工看到的是「還在載入」而不是一顆按了會失敗的鈕。

/**
 * 冪等鍵。🔴 **非 secure context(真機 LAN http)沒有 `crypto.randomUUID`** ——
 * 直接呼叫會 throw 在 `useEffect` 裡,`requestId` 永遠停在空字串 ⇒ 送出鈕永遠是「載入中…」,
 * 而且畫面上看不出任何錯誤。逐字沿用備註線 `note-compose-form.tsx:69-78` 的處置
 * (該處 R1 N4 的原話:token 是冪等鍵、非安全值 ⇒ `Math.random` 版可接受)。
 * 產出恆為小寫十六進位 + 連字號 ⇒ 滿足 RPC `20260811010000:101-103` 的形狀限制。
 */
function mintRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function ReceiptRecordForm({
  orderId,
  orderItemId,
  procurementId,
  returnTo,
  /** 這筆採購還沒到的件數(= `allocated − received`)—— 預設值,不是上限守門(守門在 RPC)。 */
  remaining,
}: {
  orderId: string;
  orderItemId: string;
  procurementId: string;
  returnTo: string;
  remaining: number;
}) {
  const [state, formAction] = useActionState<ReceiptActionState, FormData>(
    recordItemReceiptAction,
    { status: 'idle' },
  );
  const [requestId, setRequestId] = useState('');
  // 🔴 **四個欄位全部受控**(R1 Important 6)。原本 quantity / surplus / note 走 `defaultValue`,
  //    而 `defaultValue` 只在**掛載那一次**寫進 DOM —— 失敗回來時 `state.values` 根本不會被
  //    任何一次 render 消費 ⇒ 「保留員工輸入」是空頭支票(姊妹片 `item-procurement-form.tsx:57-59`
  //    的關卡2 finding 2 逐字記著同一件事,修法就是受控 + effect 明確套用)。
  const [values, setValues] = useState<ReceiptFormValues>({
    quantity: String(remaining),
    surplusQuantity: '0',
    receivedAtLocal: '',
    note: '',
  });
  const panelId = useId();

  // 🔴 只在掛載時產生一次;`state` 變動(失敗回來)**不重產** —— 重產會讓員工「再按一次」
  //    變成一筆全新的登錄,而他以為自己是在重試同一筆。
  useEffect(() => {
    setRequestId(mintRequestId());
    // 🔴 **用現成的 `toTaipeiInputValue`,不要自己算偏移**(R1 must-fix 1):
    //    我原本寫 `now.getTime() + (8*60 + getTimezoneOffset()) * 60_000` —— 在**台北機器上**
    //    `getTimezoneOffset()` 是 -480,兩者相加恰好是 0 ⇒ 產出的是 UTC 牆鐘、**少 8 小時**。
    //    而且它**沒有症狀**:早 8 小時仍在範圍內、也不是未來 ⇒ 三道守門全部放行,
    //    員工不改就送 = 靜默把到貨時間寫錯。TZ=Asia/Taipei 實跑複現:10:22 → 02:22。
    setValues((v) => ({ ...v, receivedAtLocal: toTaipeiInputValue(new Date().toISOString()) }));
  }, []);

  // 🔴 **`null` 也算本表單的失敗**(R2 nit,與 must-fix ① 同根)。
  //    `denied` 拿不到 procurementId —— 授權閘刻意排在**讀任何欄位之前**(不對未授權者洩漏表單規則),
  //    所以它只能帶 null。若這裡堅持 `=== procurementId`,session 過期的員工按下去會**完全沒有反應**。
  //    這樣放寬是安全的:`useActionState` 的 state **是每個表單實例各自的**,
  //    別份表單的失敗根本進不到這個 state ⇒ 不會出現「一份失敗、全頁都跳紅字」。
  //    (具名 procurementId 的比對仍然留著 —— 它擋的是帶了**別筆**採購 id 的回傳,那才是真的錯位。)
  const failed =
    state.status === 'failed' &&
    (state.procurementId === procurementId || state.procurementId === null);

  // 🔴 失敗回來時把員工打的四欄**寫回 state**,不是在 `value=` 上三元切換 ——
  //    三元的話輸入框會被 `state.values` 釘死、`onChange` 改不動它(受控值來自一個不會因打字
  //    而變的來源)⇒ 員工修不了輸入、只能重整。以 `state` 為相依:同一次失敗只同步一次,之後打字照常。
  useEffect(() => {
    if (state.status === 'failed' && state.procurementId === procurementId) {
      setValues(state.values);
    }
  }, [state, procurementId]);

  const set = (patch: Partial<ReceiptFormValues>) => setValues((v) => ({ ...v, ...patch }));

  return (
    <details className='mt-2'>
      <summary aria-controls={panelId} className='cursor-pointer text-sm font-medium select-none'>
        登錄到貨
      </summary>
      <form action={formAction} className='mt-2 space-y-3 rounded-md border p-3' id={panelId}>
        <input type='hidden' name={RCPT_ORDER_ID_FIELD} value={orderId} />
        <input type='hidden' name={RCPT_ORDER_ITEM_ID_FIELD} value={orderItemId} />
        <input type='hidden' name={RCPT_PROCUREMENT_ID_FIELD} value={procurementId} />
        <input type='hidden' name={RCPT_REQUEST_ID_FIELD} value={requestId} />
        <input type='hidden' name={ORDER_RETURN_TO_FIELD} value={returnTo} />

        {failed && (
          <p
            role='alert'
            className='border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-2.5 text-xs whitespace-pre-line'
          >
            {state.message}
          </p>
        )}

        <AdminFormField label='到貨幾件'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={RCPT_QUANTITY_FIELD}
            type='number'
            /* 🔴 `min=0` 不是筆誤:`到貨 0 件 / 溢收 N 件` 是「這張單已收滿或已取消、但貨還是到了」
                  的正式登記方式(a1 `20260810230000:82`)。設成 min=1 會讓那條路在畫面上直接死掉。 */
            min={0}
            step={1}
            value={values.quantity}
            onChange={(e) => set({ quantity: e.target.value })}
          />
        </AdminFormField>

        <AdminFormField label='什麼時候到的'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={RCPT_RECEIVED_AT_LOCAL_FIELD}
            type='datetime-local'
            value={values.receivedAtLocal}
            onChange={(e) => set({ receivedAtLocal: e.target.value })}
          />
        </AdminFormField>

        <AdminFormField label='溢收幾件(供應商多送的,不掛回這張單)'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={RCPT_SURPLUS_FIELD}
            type='number'
            min={0}
            step={1}
            value={values.surplusQuantity}
            onChange={(e) => set({ surplusQuantity: e.target.value })}
          />
        </AdminFormField>

        <AdminFormField label='備註(選填)'>
          <input
            className={ADMIN_INPUT_CLASS}
            name={RCPT_NOTE_FIELD}
            type='text'
            maxLength={500}
            value={values.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </AdminFormField>

        <button
          type='submit'
          disabled={requestId === ''}
          className='bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm disabled:opacity-50'
        >
          {requestId === '' ? '載入中…' : '登錄到貨'}
        </button>
      </form>
    </details>
  );
}
