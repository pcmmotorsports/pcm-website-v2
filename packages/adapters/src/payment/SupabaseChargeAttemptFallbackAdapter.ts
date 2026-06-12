/**
 * @module @pcm/adapters/payment/SupabaseChargeAttemptFallbackAdapter — PF-X1 麵包屑備軌(M-3 ②-③b)
 *
 * **第二 transport**(Sean「完整修好」、plan v6 §3):主軌 pg pooler TCP 與 Supabase PostgREST HTTPS
 * 為獨立通道(②-②b 實測過「一死一活」分歧)→ 主軌 markCharged 重試後仍敗時切本備軌,
 * 單一通道故障不再丟 rec_trade_id 麵包屑。
 *
 * **markCharged-only**(永不佔鎖/釋鎖/標 failed — ②-③a fallback RPC 字面僅 pending→charged 緊縮轉移);
 * 呼 `mark_charge_attempt_charged_fallback`(token 三重護欄:hash 比對 + auth.uid() 歸屬 + 狀態機)。
 *
 * **🔴 request-scoped(round4 MF1)**:需使用者 cookie JWT 的 authenticated client
 * (`createServerSupabaseClient()`)— 否則 auth.uid()=null 備軌永敗 = 靜默退化單軌;
 * 由 composition `getChargeAttemptStore()`(async)注入。
 *
 * 🔴 token 只作 RPC 參數透傳;錯誤訊息僅含 PostgREST error code(零 token/PII)。
 *
 * @see supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql(RPC 4)
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IChargeAttemptStore } from '@pcm/ports';
import type { MarkChargeAttemptChargedInput } from '@pcm/domain';
import { PG_BUSINESS_REJECT, type ChargeAttemptError } from './PgChargeAttemptAdapter';

/** 備軌介面 = port 的 markCharged 子集(型別層保證備軌無 begin/markFailed 路徑)。 */
export type ChargeAttemptFallbackRail = Pick<IChargeAttemptStore, 'markCharged'>;

export class SupabaseChargeAttemptFallbackAdapter implements ChargeAttemptFallbackRail {
  constructor(private readonly supabase: SupabaseClient) {}

  async markCharged(input: MarkChargeAttemptChargedInput): Promise<void> {
    const { error } = await this.supabase.rpc('mark_charge_attempt_charged_fallback', {
      p_attempt_id: input.attemptId,
      p_order_id: input.orderId,
      p_rec_trade_id: input.recTradeId,
      p_fallback_token: input.fallbackToken,
    });
    if (error) {
      // PostgREST 把 SQLSTATE 放 error.code(RPC RAISE → P0001);訊息通用、零 token/原文。
      const e: ChargeAttemptError = new Error(
        `charge 簿記備軌失敗(${error.code ?? 'transport'})`,
      );
      if (error.code === PG_BUSINESS_REJECT) {
        e.code = PG_BUSINESS_REJECT;
      }
      throw e;
    }
  }
}
