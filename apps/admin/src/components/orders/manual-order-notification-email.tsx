'use client';

import { useEffect, useState } from 'react';
import {
  MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL } from './manual-order-field-classes';

// manual-order-notification-email.tsx — 手動建單那格「通知 email」(從 manual-order-form-body.tsx 搬出來, 2026-10-01)。
//
// 🔴 選「蝦皮」⇒ 清空並鎖住、旁邊寫「蝦皮訂單不寄通知信」;換回其他來源 ⇒ 恢復可填(Sean 2026-10-01, 貼板 260 Q16 甲)。
//    來源值從同一張表單的原生 select 讀(同 manual-order-tier-select 讀客人 radio 的做法), 不另開一份真相。
// 🔴 鎖住用 readOnly 不用 disabled:disabled 的欄位不進 FormData, 而解析端(`parseManualOrderForm` 的 `readSingle`)
//    把【缺欄】當錯 ⇒ 每一張蝦皮單都會被擋。readOnly 照樣送出一個空值 = 留白 = 不寄。
// 🔴 清空靠換 `key` 重掛(defaultValue=''), 不靠程式寫 value —— 表單送出值一律來自原生控制項。
// 🛑 這一格只是第一層:送出時解析端還會擋(蝦皮 + 有填 ⇒ 拒), DB 約束 orders_shopee_no_notification_email 是最後一層。

export const SHOPEE_NO_EMAIL_NOTE = '蝦皮訂單不寄通知信';

export function ManualOrderNotificationEmail() {
  const [host, setHost] = useState<HTMLInputElement | null>(null);
  const [shopee, setShopee] = useState(false);

  useEffect(() => {
    const form = host?.form ?? null;
    if (form === null) return;
    const sync = () => {
      const source = form.querySelector(`select[name="${MANUAL_ORDER_SOURCE_FIELD}"]`);
      setShopee(source instanceof HTMLSelectElement && source.value === 'manual_shopee');
    };
    sync();
    form.addEventListener('change', sync);
    return () => form.removeEventListener('change', sync);
  }, [host]);

  return (
    <label className={MANUAL_FIELD_LABEL}>
      <span className='mb-1 block'>通知 email(留白 = 不寄)</span>
      <input
        key={shopee ? 'shopee' : 'normal'}
        ref={setHost}
        type='email'
        autoComplete='off'
        name={MANUAL_ORDER_NOTIFICATION_EMAIL_FIELD}
        placeholder={shopee ? '' : 'email'}
        defaultValue=''
        readOnly={shopee}
        aria-disabled={shopee ? true : undefined}
        tabIndex={shopee ? -1 : undefined}
        className={shopee ? `${MANUAL_FIELD_INPUT} bg-muted cursor-not-allowed opacity-60` : MANUAL_FIELD_INPUT}
      />
      {shopee && <span className='mt-1 block text-xs text-(--fg-2)'>{SHOPEE_NO_EMAIL_NOTE}</span>}
    </label>
  );
}
