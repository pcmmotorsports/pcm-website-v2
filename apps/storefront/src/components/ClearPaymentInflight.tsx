'use client';

// ClearPaymentInflight.tsx — 付款有結論時清 in-flight 記號(P3、pivot A 另開分頁防呆)。
//
// callback paid / failed / no_attempt 掛(付款已落結論、不再進行中)→ mount 即清記號,避免客人下次
//   結帳被殘留記號誤提醒。pending **不掛**(仍進行中、記號保留到結論或 6 分 TTL 失效)。零 UI(回 null)。

import { useEffect } from 'react';
import { clearPaymentInflight } from '@/lib/payment/inflight-marker';

export function ClearPaymentInflight() {
  useEffect(() => {
    clearPaymentInflight();
  }, []);
  return null;
}
