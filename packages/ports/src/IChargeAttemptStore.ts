import type {
  BeginChargeAttemptResult,
  MarkChargeAttemptChargedInput,
  MarkChargeAttemptFailedInput,
  OrderId,
} from '@pcm/domain';

/**
 * IChargeAttemptStore:charge 簿記 + 防雙扣鎖 port(M-3 ②-③b、plan v6 §2/§6;PF-X1/X2)。
 *
 * 實作 = `ChargeAttemptStoreWithFallback`(複合、@pcm/adapters/server):
 * - `begin` / `markFailed`:**主軌 only**(PgChargeAttemptAdapter、payment_confirmer 窄權直連;
 *   備軌不可佔鎖/釋鎖 — fallback RPC 僅 pending→charged 緊縮轉移)。
 * - `markCharged`:主軌 ×3(退避 100/300ms)→ 備軌 ×2(SupabaseChargeAttemptFallbackAdapter、
 *   authenticated PostgREST 第二 transport + fallbackToken 三重護欄)— PF-X1 麵包屑雙軌(Sean「完整修好」)。
 *
 * 信任模型:`orderId` 為 server action 內 placeOrder 自產(永不收 client orderId);
 * begin RPC 內再驗 order 存在/unpaid + 歸屬從 orders 讀(②-③a 頭註解 ⑦)。
 */
export interface IChargeAttemptStore {
  /** 佔 per-order 鎖 + per-user 10min 閘;`acquired:false` 為預期業務路徑(回 reason、非 throw)。 */
  begin(orderId: OrderId): Promise<BeginChargeAttemptResult>;
  /** charge 成功 → confirm 前補 rec_trade_id(pending→charged;charged 同 rec 冪等 no-op)。 */
  markCharged(input: MarkChargeAttemptChargedInput): Promise<void>;
  /** 卡拒(明確未扣款)釋鎖(pending→failed;failed 冪等 no-op;charged→failed 永拒)。 */
  markFailed(input: MarkChargeAttemptFailedInput): Promise<void>;
}
