'use client';

import { useEffect, useState } from 'react';
import { MEMBER_TIER_LABEL, MEMBER_TIER_VALUES } from '../../lib/orders/order-list-view';
import {
  MANUAL_ORDER_CUSTOMER_FIELD,
  MANUAL_ORDER_TIER_FIELD,
  MANUAL_ORDER_TIERS,
  type ManualOrderTier,
} from '../../lib/orders/manual-order-form';
import { MANUAL_FIELD_INPUT, MANUAL_FIELD_LABEL } from './manual-order-field-classes';

// manual-order-tier-select.tsx — 手動建單那格「會員等級」(T2, 2026-09-14;Sean 逐字「手動建立訂單的時候可以選擇車行會員還是經銷的選項才對」)。
//
// 🔴 **預設 = 客人現在的等級**(plan §1-b):值從被選起來那顆客人 radio 的 `data-customer-tier` 讀(`manual-customer-picker.tsx`),
//    與「同上」讀 `data-customer-name` 是同一條不變式 —— 跨元件共享的東西放在原生控制項身上, 不另開一份真相。
// 🔴 **沒選客人 ⇒ disabled**(disabled 的 select 不進 FormData ⇒ server 端那道「沒有選客人」先擋, 輪不到等級那道)。
// 🔴 **換客人 ⇒ 跟著換成那位的等級**;員工改過的選擇在換客人時被蓋掉是刻意的 —— 等級是「這位客人的」預設, 換了人就是另一個預設。
// 🔴 送出的是這顆 select 的值(一律帶, 不靠 RPC NULL 繼承)—— 畫面上看到什麼就存什麼(plan §1-b)。
// ⚠️ 只改這張單的 `tier_at_checkout`;客人帳號的等級只有客戶頁 `tier-edit-form.tsx` 能改(零交集)。

/** 選中的客人 = 誰 + 他的等級。🔴 兩個都要(codex R1 MF1):只記等級的話, 甲乙同級 ⇒ 換人時 `key` 沒變 ⇒ 替甲改的選擇會沿用到乙。 */
type Picked = { id: string; tier: ManualOrderTier };

function readPicked(form: HTMLFormElement | null): Picked | null {
  const picked = form?.querySelector(`input[name="${MANUAL_ORDER_CUSTOMER_FIELD}"]:checked`);
  if (!(picked instanceof HTMLInputElement)) return null;
  const raw = picked.dataset.customerTier;
  // 不認得的值(舊候選沒帶 / 被改過的 DOM)⇒ 倒向 general, 不倒向「不給選」:選不了會擋住建單。
  const tier = raw !== undefined && (MANUAL_ORDER_TIERS as readonly string[]).includes(raw) ? (raw as ManualOrderTier) : 'general';
  return { id: picked.value, tier };
}

export function ManualOrderTierSelect() {
  const [host, setHost] = useState<HTMLSelectElement | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    const form = host?.form ?? null;
    if (form === null) return;
    // 同一位客人 ⇒ 回同一個物件參照, 不觸發重掛(員工在這位底下改的選擇要留著)。
    const sync = () =>
      setPicked((prev) => {
        const next = readPicked(form);
        return prev !== null && next !== null && prev.id === next.id && prev.tier === next.tier ? prev : next;
      });
    sync();
    // 客人那顆 radio 的 change 會冒泡到 form;剛建好的客人是 `defaultChecked`(不發 change)⇒ 用 MutationObserver 補看 DOM 變動。
    form.addEventListener('change', sync);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(sync);
    mo?.observe(form, { subtree: true, childList: true, attributes: true, attributeFilter: ['checked'] });
    return () => {
      form.removeEventListener('change', sync);
      mo?.disconnect();
    };
  }, [host]);

  // 🔴 `key` = 客人 id + 等級:換客人(哪怕同級)⇒ 整顆 select 重掛、`defaultValue` 重新生效 = 重設成那位的等級;
  //    同一位客人底下員工改的選擇不受影響(key 沒變)。
  return (
    <label className={MANUAL_FIELD_LABEL}>
      會員等級
      <select
        key={picked === null ? 'none' : `${picked.id}:${picked.tier}`}
        ref={setHost}
        autoComplete='off'
        name={MANUAL_ORDER_TIER_FIELD}
        defaultValue={picked?.tier ?? 'general'}
        disabled={picked === null}
        title={picked === null ? '先選客人' : undefined}
        className={MANUAL_FIELD_INPUT}
        data-testid='manual-order-tier'
      >
        {MEMBER_TIER_VALUES.map((t) => (
          <option key={t} value={t}>
            {MEMBER_TIER_LABEL[t]}
          </option>
        ))}
      </select>
    </label>
  );
}
