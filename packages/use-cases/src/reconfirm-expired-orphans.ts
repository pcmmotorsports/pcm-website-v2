import type { ExpiredOrphanAttempt } from '@pcm/domain';
import { settleCharge, type SettleChargeDeps } from './settle-charge';

/**
 * reconfirmExpiredOrphans:M-3 3DS 乙路 B1b — 12h 孤兒「專用人工列再確認路徑」use-case(canonical §8;master plan v5 §2)。
 *
 * 客人放棄付款、沒重刷 → 留 `pending` 未付款孤兒;現行 sweeper(3DS-4a-2 `claim_stuck_unsettled_attempts`)
 * 重試 8x 後把孤兒轉 `needs_manual_review=true` → **退出一般掃描**(claim_stuck 濾 needs_manual_review=false)。
 * 若無 B1 → 孤兒永遠卡 manual queue 無人再確認。本 use-case 走 B1a 專用 claim(繞 ceiling/manual、自有 6h throttle)
 * 定期低頻再確認,杜絕「孤兒永遠卡 manual queue 無人再確認」與「B1 誤殺已付款/查不到的單」。
 *
 * ```
 * claimExpiredPendingAttempts(limit)(B1a 原子 claim + 蓋 throttle)
 *   → 逐筆 settleCharge(orderId)(**複用對帳脊椎**、Record API 唯一權威):
 *       paid(含 order 已 paid 短路)/ failed(-1·5→guarded markFailed〔R1b2 order-paid guard〕)/ no_attempt → settled(已收斂)
 *       pending(Record 4 / unreachable / unverified)→ pending(維持、不 markSettleRetry、靠 B1 throttle 下輪重來)
 *   → 結構化告警(零 PII counts only)
 * ```
 *
 * 🔴 與 sweepSettlements 的關鍵差異(canonical §8):
 * - claim 來源 = `claim_expired_pending_attempts`(涵蓋 manual=true、繞 ceiling),**非** claim_stuck。
 * - throttle = B1a claim 已蓋的 `last_expired_settle_at`(6h);**本 use-case 不呼 `markSettleRetry`**
 *   (不碰 sweeper 的 next_settle_at / ceiling、與之分軌);pending 結果僅靠 B1 throttle 到期下輪重來。
 * - **不清 `needs_manual_review`**:settleCharge 的 pending 路徑天然不動 manual flag(canonical §8「B1 不清 manual」)。
 *
 * 安全 / 信任邊界(鐵則 12):
 * - 不採信任何外部輸入:orderId 全 from DB(B1a claim RPC 回);無 client 參數。
 * - settleCharge 冪等 + Record 唯一權威 + 金額整數 + **order-paid 短路**(settle-charge.ts:order paid → 回 paid
 *   idempotent、不打 Record)→ 即使 B1a 的 claim-then-paid TOCTOU 窄窗交出一筆剛 paid 的孤兒,亦不雙扣/不偽 paid。
 * - 不以年齡判 failed(只 Record final-failed/cancel 才 markFailed,且過 R1b2 order-paid guard)。
 * - 單筆 throw → try/catch + continue(fail-closed、不中斷整批);claim 失敗 → 本輪空、下輪 throttle 未蓋可重領。
 * - log 零 PII(僅 counts)。deps = getSettleChargeDeps()(cookieless、主軌-only)。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §8 / §9 B1b / §14 步 33
 * @see supabase/migrations/20260627120000_m3_3ds_b1a_claim_expired_pending_attempts.sql
 */
export type ReconfirmExpiredOrphansDeps = SettleChargeDeps;

/**
 * ReconfirmExpiredOrphansOptions:批次/節流參數(由後續 cron route 顯式注入)。
 * - `limit`:每輪 claim 上限(Record 節流;B1a RPC 端 clamp [1,1000])。
 * - `concurrency`:有界並發度(預設 1=嚴格順序;連線預算、避 N×pg Client 撞 pooler;可 2-3)。
 */
export type ReconfirmExpiredOrphansOptions = {
  limit: number;
  concurrency?: number;
};

/** ReconfirmExpiredOrphansResult:結構化摘要(零 PII、counts only)。 */
export type ReconfirmExpiredOrphansResult = {
  /** B1a 本輪 claim 到的孤兒數。 */
  claimed: number;
  /** settleCharge 收斂(paid / failed)筆數。 */
  settled: number;
  /** settleCharge 回 no_attempt(claim 後 attempt 已非 active、罕見並發如他路徑 markFailed)筆數 — 非經本輪收斂、單列觀察。 */
  noAttempt: number;
  /** settleCharge 維持 pending(Record 4 / unreachable / unverified)筆數 — 靠 B1 throttle 下輪重來。 */
  pending: number;
  /** 單筆 throw(fail-closed、不中斷整批)+ claim 失敗計數。 */
  errors: number;
};

export async function reconfirmExpiredOrphans(
  deps: ReconfirmExpiredOrphansDeps,
  opts: ReconfirmExpiredOrphansOptions,
): Promise<ReconfirmExpiredOrphansResult> {
  const { attempts } = deps;
  // concurrency fail-safe(對齊 sweepSettlements):非有限 / 非 ≥1 → 1(順序);取整防 0-worker 靜默不處理。
  const concurrency =
    Number.isFinite(opts.concurrency) && (opts.concurrency as number) >= 1
      ? Math.floor(opts.concurrency as number)
      : 1;

  const result: ReconfirmExpiredOrphansResult = {
    claimed: 0,
    settled: 0,
    noAttempt: 0,
    pending: 0,
    errors: 0,
  };

  let orphans: ExpiredOrphanAttempt[] = [];
  try {
    orphans = await attempts.claimExpiredPendingAttempts(opts.limit);
  } catch {
    // claim 失敗 → 本輪空、下輪重來(throttle 未蓋=可重領);fail-closed、不 throw 中斷 cron。
    result.errors++;
    return result;
  }
  result.claimed = orphans.length;

  await runBounded(orphans, concurrency, async (o) => {
    try {
      // 🔴 複用 settleCharge:Record→markCharged(paid)/ -1·5→guarded markFailed / 4·unreachable→pending /
      //    order 已 paid→短路 paid 不打 Record。**不呼 markSettleRetry**(B1 throttle 分軌);manual 不清(settleCharge 不動)。
      const outcome = await settleCharge(deps, { orderId: o.orderId });
      if (outcome.kind === 'pending') {
        result.pending++;
      } else if (outcome.kind === 'no_attempt') {
        // claim 後 attempt 已非 active(罕見並發、如他路徑 markFailed / 已收斂)→ 單列觀察、不混入 settled。
        result.noAttempt++;
      } else {
        // paid / failed → settleCharge 已改 status 收斂。
        result.settled++;
      }
    } catch {
      result.errors++; // 🔴 fail-closed:單筆 throw 不中斷整批
    }
  });

  // 結構化告警(零 PII counts only;單筆失敗 > 0 = 需關注;durable 旗仍在 needs_manual_review)。
  if (result.errors > 0) {
    console.error(
      '[reconfirmExpiredOrphans] 🔴 12h 孤兒再確認單筆失敗(fail-closed、下輪 throttle 到期重來;durable 旗見 needs_manual_review)',
      { ...result },
    );
  }

  return result;
}

/**
 * 有界並發 runner(concurrency=1 → 嚴格順序;連線預算、避 N×per-request pg Client 撞 session pooler ceiling)。
 * 小型純函式、與 sweep-settlements 同形;刻意複製避免跨 use-case 耦合(兩者各自演進)。每筆 `fn` 已自帶 try/catch。
 */
async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
