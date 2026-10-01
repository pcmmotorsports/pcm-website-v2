'use client';

import { useEffect, useState } from 'react';
import {
  MANUAL_ORDER_SHOPEE_ORDER_NO_FIELD,
  MANUAL_ORDER_SHOPEE_USERNAME_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL } from './manual-order-field-classes';

// manual-order-shopee-fields.tsx — 手動建單的「蝦皮帳號」「蝦皮訂單編號」兩格(貼板 261;Sean 2026-10-01 蝦皮帳號 Q1–Q4 甲)。
//
// 🔴 只有來源選「蝦皮」才出現, 位置在收件電話正上方(`ManualOrderShipTo` 的 `beforePhone`)。
//    來源值從同一張表單的原生 select 讀(同 manual-order-notification-email.tsx), 不另開一份真相。
// 🔴 不是蝦皮就整個不畫 ⇒ 不送這兩格 ⇒ 解析端當沒填(它本來就只收蝦皮單的值, 見 `parseManualOrderForm`)。
// 🔴 2026-10-01:兩格各有看得到的欄位名(原本只有 placeholder, 填了字就分不出哪格是哪格)。
// 🔵 兩格都選填。帳號送出時若還沒記在客人身上, 建單函式會自動加上去;記在別的客人身上會擋下並說明。

export function ManualOrderShopeeFields() {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  const [shopee, setShopee] = useState(false);

  useEffect(() => {
    const form = host?.closest('form') ?? null;
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
    <>
      <span ref={setHost} hidden />
      {shopee && (
        <>
          <label className={MANUAL_FIELD_LABEL}>
            蝦皮帳號（選填）
            <input
              name={MANUAL_ORDER_SHOPEE_USERNAME_FIELD}
              autoComplete='off'
              aria-label='蝦皮帳號'
              maxLength={64}
              className={MANUAL_FIELD_INPUT}
            />
          </label>
          <label className={MANUAL_FIELD_LABEL}>
            蝦皮訂單編號（選填）
            <input
              name={MANUAL_ORDER_SHOPEE_ORDER_NO_FIELD}
              autoComplete='off'
              aria-label='蝦皮訂單編號'
              maxLength={40}
              className={MANUAL_FIELD_INPUT}
            />
          </label>
        </>
      )}
    </>
  );
}
