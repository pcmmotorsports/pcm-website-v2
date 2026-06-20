'use client';

// PollOrderStatus.tsx — 3DS callback「處理中」背景輪詢訂單付款狀態(M-3 3DS-S2)
//
// 為什麼:3DS callback 完成頁首次 settleCharge 常因 Record API 同步延遲(設計包 §5.1 實測 callback 當下 queryStatus=2
//   查無)落 pending → 顯「處理中」。背景(webhook after / sweeper cron)把訂單推成立後,本元件輪詢讀到 paid →
//   router.refresh() 重跑 callback server component → settleCharge step2「order 已 paid → 短路 paid」(廉價、不重打
//   Record)→ 渲染 paid 變體 + ClearCartOnSuccess。客人無感、不必手動刷新。
//
// 🔴 安全/正確性(plan §⑤/§⑥ 步驟2):
//   - **fail-closed**:只在端點明確回 `{status:'paid'}` 才 router.refresh();401/404(無歸屬/未登入)→ 停、不 refresh;
//     500/網路錯 → 計入次數續試;次數用盡 → 停、維持「處理中」文案(不偽 paid 不偽 failed)。
//   - **有界**:POLL_DELAYS_MS 退避序列(前密後疏)、13 次封頂(≈51.5s);不無限輪詢。
//   - **取消安全**:每次 await 後 + 排程前檢查 stopped;AbortError(unmount/成立)不續排;cleanup abort + clearTimeout
//     → StrictMode double-mount / late callback 不誤動作。
//   - orderId 由 callback page server 端歸屬讀後傳入(本就在 URL `?order=`、非新洩漏);端點再做 own-only 縱深。
//
// ⚠️ 已知極罕見邊角(codex 關卡2 consider、評估後不修):paid→router.refresh() 後若 callback 重跑 settleCharge 因瞬間
//    連線錯誤 throw 落 pending,callback **pending 分支會重新渲染一個 PollOrderStatus**(新樹)→ 多數情況重新輪詢;
//    僅當 React 於同位置同 props 保留本 instance(effect 不重跑、本 instance 已 stopped)時會卡處理中。orders.payment_status
//    paid 為終態(confirm 交易性、不回 unpaid)、refresh 後 step2 短路 paid 幾近必然 → 機率極低,且 fail-closed(顯安撫
//    文案 + email、客人重整即恢復);加 safety retry 反引入 refresh-loop 風險(stopped 是防無限 refresh 的必要旗標),不值。
//
// 不渲染視覺(return null);文案由 callback page 的 CheckoutSuccess processing 變體顯。
//
// @see docs/specs/2026-06-21-m3-3ds-s2-callback-polling-plan.md §⑥ 步驟2
// @see apps/storefront/src/app/api/orders/[orderId]/payment-status/route.ts(輪詢端點)

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** 退避序列(ms):前密抓快速同步、後疏省資源保耐心;13 次、總 ≈ 51.5s(plan Q2/Q3 default、待 Sean 微調)。 */
const POLL_DELAYS_MS = [1000, 1500, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000, 5000, 5000, 5000];

export function PollOrderStatus({ orderId }: { orderId: string }) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    function scheduleNext(index: number): void {
      if (stopped || index >= POLL_DELAYS_MS.length) return; // 用盡 → 停(超時、維持處理中文案)
      timer = setTimeout(() => {
        void poll(index);
      }, POLL_DELAYS_MS[index]);
    }

    async function poll(index: number): Promise<void> {
      if (stopped) return;
      let res: Response;
      try {
        res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/payment-status`, {
          signal: controller.signal,
          cache: 'no-store',
        });
      } catch (err) {
        // AbortError(unmount/成立)或已 stopped → 不續排;其他網路錯 → 計入次數續試。
        if (stopped || (err as { name?: string }).name === 'AbortError') return;
        scheduleNext(index + 1);
        return;
      }
      if (stopped) return;

      // fail-closed 終止(400 形狀錯/401 未登入/404 無歸屬)→ 停、不 refresh(皆 terminal、續試無收益;
      //   400 在 server UUID gate 後正常不可達,納入終止語意更完整;codex 關卡2 nit)。
      if (res.status === 400 || res.status === 401 || res.status === 404) return;

      // 成立:只在明確 paid 才 refresh。
      if (res.ok) {
        let status: string | undefined;
        try {
          status = ((await res.json()) as { status?: string }).status;
        } catch {
          status = undefined; // 解析失敗 → 當未確定、續試。
        }
        if (stopped) return;
        if (status === 'paid') {
          stopped = true;
          router.refresh();
          return;
        }
      }

      // pending / 500 / 解析失敗 → 續排下一次(有界)。
      scheduleNext(index + 1);
    }

    scheduleNext(0);

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [orderId, router]);

  return null;
}
