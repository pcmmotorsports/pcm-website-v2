'use client';

import { useState } from 'react';

import {
  BACKFILL_AMOUNT_FIELD,
  BACKFILL_ATTESTED_FIELD,
  BACKFILL_DR_CODE_FIELD,
  BACKFILL_OCCURRED_AT_FIELD,
  BACKFILL_ORDER_ID_FIELD,
  BACKFILL_REASON_FIELD,
} from '../../lib/payment/refund-backfill-form';
import { ADMIN_INPUT_CLASS, AdminFormField } from '../shared/admin-form';

// refund-backfill-section.tsx — ⟦b4-TAPPAYDIRECT⟧ 片 B · B3a:
// 「在 TapPay 後台已經退過的款, 事後補登進帳本」的入口。骨架抄 `manual-refund-entry-section.tsx`。
//
// 🔴🔴 **本片【刻意不接線】**(主視窗 B 2026-09-07 04:2x 裁 `B3 = 甲`)——
//    補登 RPC 在片 C(plan v3 §片 C `:83-90`), 片 B 沒有後端可以呼叫。
//    ⇒ 📌 所以這裡**沒有 `action`、沒有 `useActionState`、沒有 server action import**,
//      送出鈕**恆 `disabled`**, 而畫面上明說「還不能用」。
//    🛑 **為什麼不接一個「尚未實作」的假 action**:那會長出一個片 C 必須拆掉的東西,
//      而暫時的東西在這個 repo 的紀錄不好。⇒ 甲比乙少一次拆。
//
// 🔵 **與 `manual-refund-entry-section.tsx` 刻意不同的三處, 都是因為沒有 action**:
//    ① 沒有 `serverToken` / `request_token` 隱藏欄 —— 那是重送保護, 而現在送不出去。
//       ⇒ 📌 片 C 接線時**要補回來**, 別以為漏了。
//    ② 沒有 `pageshow` / `router.refresh()` 那段(它處理的是 bfcache 還原後的舊 token)。
//    ③ 沒有「失敗回來的值要進畫面」那段 effect(沒有 action 就沒有回來的值)。
//
// 🔴 **值域不在本檔** —— 三格的規則住在 `refund-backfill-form.ts`(它抄既有的、沒發明新的),
//    本檔只把欄位名與 `required` / `pattern` 對齊它, **不長第二套規則**。
//    ⚠️ 而 HTML 的 `required` / `pattern` **不是守門**, 只是少讓員工白跑一趟:
//      真正說了算的是解析器與片 C 的 RPC。

/** datetime-local 預設值:當下時刻(本機時區, 精確到分)。逐字抄隔壁那支。 */
function nowLocalInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function RefundBackfillSection({ orderId }: { orderId: string }) {
  const [attested, setAttested] = useState(false);

  return (
    <section className='rounded-lg border border-amber-500/40 bg-amber-500/5 p-4'>
      <h2 className='mb-1 text-sm font-semibold text-amber-700'>
        補登 TapPay 後台的退款(還不能用)
      </h2>
      <p className='text-muted-foreground mb-3 text-xs'>
        有人直接在 TapPay 後台退了款,而我們的帳本不知道。這裡是把那一筆補記進來的入口——
        <strong>它不會去動任何錢</strong>,錢已經在外面退掉了。
      </p>
      <p
        role='note'
        className='mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800'
      >
        🚧 這個功能<strong>還沒開放</strong>——畫面先做好給你看,送出鈕是關著的。
        要能真的補登,還得等後端那一片上線。
      </p>

      <form>
        <fieldset className='min-w-0 space-y-3 border-0'>
          <input type='hidden' name={BACKFILL_ORDER_ID_FIELD} value={orderId} />

          {/* 🔴 必勾:plan v3 §片 C `G0`「p_attested 必須 true」的畫面那一半。
              值刻意是 '1' —— 與解析器同字面(那裡逐字寫著不得放寬成 'true'/'on')。 */}
          <label className='flex items-start gap-2 text-sm'>
            <input
              type='checkbox'
              name={BACKFILL_ATTESTED_FIELD}
              value='1'
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
              className='mt-1'
            />
            <span>
              我已經在 TapPay 後台<strong>看到這筆退款成功</strong>,並且核對過金額與訂單。
            </span>
          </label>

          <div className='grid gap-3 sm:grid-cols-2'>
            <AdminFormField label='TapPay 的退款單號(DR 碼)'>
              <input
                name={BACKFILL_DR_CODE_FIELD}
                required
                maxLength={64}
                autoComplete='off'
                className={ADMIN_INPUT_CLASS}
                placeholder='從 TapPay 後台複製過來'
              />
            </AdminFormField>
            <AdminFormField label='退款金額(元、正整數)'>
              <input
                name={BACKFILL_AMOUNT_FIELD}
                required
                inputMode='numeric'
                pattern='[1-9][0-9]{0,9}'
                maxLength={10}
                autoComplete='off'
                className={ADMIN_INPUT_CLASS}
                placeholder='不含小數、不含逗號'
              />
            </AdminFormField>
          </div>

          <AdminFormField label='TapPay 後台上那筆退款發生的時間'>
            <input
              type='datetime-local'
              name={BACKFILL_OCCURRED_AT_FIELD}
              required
              defaultValue={nowLocalInput()}
              className={ADMIN_INPUT_CLASS}
            />
          </AdminFormField>

          <AdminFormField label='補登原因'>
            <input
              name={BACKFILL_REASON_FIELD}
              required
              maxLength={200}
              className={ADMIN_INPUT_CLASS}
              placeholder='會寫入退款紀錄與稽核,例:客人退貨,已在 TapPay 後台退款'
            />
          </AdminFormField>

          <div className='flex flex-wrap items-center justify-end gap-3'>
            <span className='text-muted-foreground mr-auto text-xs'>
              這是一筆<strong>補登</strong>,不會發起任何退款——錢在 TapPay 那邊已經退掉了。
            </span>
            {/* 🔴 恆 disabled:片 B 沒有後端。片 C 接線時把它改成 `disabled={isPending}`。 */}
            <button
              type='submit'
              disabled
              className='h-9 rounded-md bg-amber-600 px-5 text-sm font-medium text-white disabled:opacity-50'
            >
              補登(尚未開放)
            </button>
          </div>
        </fieldset>
      </form>
    </section>
  );
}
