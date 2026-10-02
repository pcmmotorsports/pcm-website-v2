'use client';

import { useEffect, useState } from 'react';
import {
  MANUAL_ORDER_PAYMENT_CHANNEL_FIELD,
  MANUAL_ORDER_SOURCE_FIELD,
} from '../../lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL } from './manual-order-field-classes';

// manual-order-payment-method.tsx — 手動建單「付款方式」(貼板 262, 報價單Q1 2026-10-01)。
//
// 🔴 選來源「蝦皮」⇒ 付款方式只剩「蝦皮」(Sean Q42 甲);換回其他來源 ⇒ 匯款 / 現金 / 刷卡。
//    來源值從同一張表單的原生 select 讀(同 manual-order-notification-email 的做法), 不另開一份真相。
// 🔵 貼板 263(Sean 2026-10-02):蝦皮進帳金額搬到「收款」區塊(manual-order-payment-received.tsx), 這裡不再有。
// 🛑 這一層只是畫面:解析端(parseManualOrderForm)與 DB(admin_create_manual_order)都會再收斂成蝦皮來源 = 蝦皮付款。

/** 這張表單的來源是不是蝦皮(跟著來源下拉即時更新)。 */
function useShopeeSource(host: HTMLElement | null): boolean {
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
  return shopee;
}

export function ManualOrderPaymentMethod() {
  const [host, setHost] = useState<HTMLLabelElement | null>(null);
  const shopee = useShopeeSource(host);
  return (
    <label ref={setHost} className={MANUAL_FIELD_LABEL}>
      付款方式
      {/* 換來源時用 key 重掛, 讓預設值回到該組的第一個(不靠程式寫 value)。 */}
      <select key={shopee ? 'shopee' : 'normal'} autoComplete='off' name={MANUAL_ORDER_PAYMENT_CHANNEL_FIELD} className={MANUAL_FIELD_INPUT}>
        {shopee ? (
          <option value='shopee'>蝦皮</option>
        ) : (
          <>
            <option value='bank_transfer'>匯款</option>
            <option value='cash'>現金</option>
            <option value='card_terminal'>刷卡</option>
          </>
        )}
      </select>
    </label>
  );
}
