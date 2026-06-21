import type { OrderId } from '@pcm/domain';

/**
 * IPollSettleThrottle:會員輪詢端點主動 settleCharge 的 **durable per-order Record 限流** port(M-3 3DS-S2b)。
 *
 * 背景(plan §5.1):輪詢端點 `GET /api/orders/[orderId]/payment-status` 在 own-only 歸屬閘後、訂單仍 unpaid 時
 * 主動呼一次 `settleCharge`(三路共呼模型第四路 caller);settleCharge step3 `recordQuery` 每次打 TapPay Record →
 * 會員多分頁/狂重整可 spam 打爆 Record 查詢額度。本 throttle 把「同一 orderId 在窗內最多放行一次 settle」durable
 * (DB)落地、防放大(serverless 多實例 → in-memory 不可靠、必 DB)。
 *
 * 🔴 **獨立窄 port(非加進 IChargeAttemptStore)**:throttle 與 charge 簿記語意正交;IChargeAttemptStore 有 2 impl +
 * 多 mock,加方法 = 全部被迫實作。獨立 port 最小爆炸半徑。實作 = `PgPollSettleThrottleAdapter`(@pcm/adapters/server、
 * payment_confirmer 窄權直連、呼 `claim_order_poll_settle` RPC)。
 *
 * @see supabase/migrations/20260621120000_m3_3ds_s2b_poll_settle_throttle.sql
 * @see docs/specs/2026-06-21-m3-3ds-s2b-poll-settle-throttle-plan.md §6.2
 */
export interface IPollSettleThrottle {
  /**
   * 原子 per-order throttle claim。
   *
   * 放行(窗內未放行過 + RPC 端閘全過:order unpaid + 非 manual + settle_attempt_count<8)→ DB set
   * `last_poll_settle_at=now()`、回 **true**(caller 可呼 settleCharge);否則(窗內已放行 / 非 unpaid / manual /
   * 達 ceiling / 無 active attempt / `throttleSeconds<0`)→ 回 **false**(caller skip settleCharge、只讀狀態回)。
   *
   * 並發安全(多分頁同時打同單):RPC 內 UPDATE row lock 序列化 + EvalPlanQual 重評 → 窗內只一個回 true、不雙放行。
   * throttle = 「省 Record 呼叫」非「保結算正確」(正確性 100% 在 settleCharge〔Record 權威〕+ 冪等);不得因
   * throttle 誤鎖住正常結算(窗內 false 只是該輪 skip、下輪窗外即可再放行)。
   */
  claimPollSettle(orderId: OrderId, throttleSeconds: number): Promise<boolean>;
}
