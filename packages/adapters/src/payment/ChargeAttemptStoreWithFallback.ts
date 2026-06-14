/**
 * @module @pcm/adapters/payment/ChargeAttemptStoreWithFallback — 簿記雙軌複合(M-3 ②-③b、plan v6 §6)
 *
 * `IChargeAttemptStore` 唯一對 use-case 的實作(單一 port、複合在 adapter 層):
 * - `begin`:主軌 only、**不重試**(失敗 = 零 charge、上拋 → action 通用字面,安全可重試)。
 * - `markFailed`:主軌 only ×3(round5 MF1;**備軌不可釋鎖** — fallback RPC 無此路徑)。
 * - `markCharged`:🔴 主軌 ×3(退避 100/300ms)→ 備軌 ×2(退避 100ms)(Sean「完整修好」雙軌;
 *   次數/退避釘死於常數、tests 計次鎖死、round4 C)。
 *
 * 重試語意:
 * - `P0001`(業務拒絕、deterministic)→ **該軌早停**;主軌 P0001 也不切備軌(同一 DB 狀態機、
 *   備軌必同拒;省 ~500ms 付款延遲)。
 * - 雙軌全敗 → throw 合併訊息(各軌通用訊息 + SQLSTATE;零 token/PII)— use-case 接手
 *   log critical + 續走 confirm(plan v6 §3 不棄已扣款交易)。
 * - 冪等安全:②-③a RPC charged+同 rec / failed→failed 皆 no-op → 「成功後重試」不爆。
 */
import 'server-only';

import type { IChargeAttemptStore } from '@pcm/ports';
import type {
  ActiveChargeAttempt,
  BeginChargeAttemptResult,
  MarkChargeAttemptChargedInput,
  MarkChargeAttemptFailedInput,
  OrderId,
} from '@pcm/domain';
import { PG_BUSINESS_REJECT } from './PgChargeAttemptAdapter';
import type { ChargeAttemptFallbackRail } from './SupabaseChargeAttemptFallbackAdapter';

type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 🔴 釘死(plan v6 §6、round4 C):第 1 次立即、之後退避;主軌 3 次、備軌 2 次。 */
const PRIMARY_BACKOFF_MS = [0, 100, 300] as const;
const FALLBACK_BACKOFF_MS = [0, 100] as const;

export class ChargeAttemptStoreWithFallback implements IChargeAttemptStore {
  constructor(
    private readonly primary: IChargeAttemptStore,
    private readonly fallback: ChargeAttemptFallbackRail,
    private readonly sleep: SleepFn = defaultSleep,
  ) {}

  /** 佔鎖不重試:失敗 = 零 charge(fail-closed 安全),由 action 吞通用字面。 */
  begin(orderId: OrderId): Promise<BeginChargeAttemptResult> {
    return this.primary.begin(orderId);
  }

  /** 對帳讀(3DS-1b)主軌-only:讀失敗 → settleCharge 回 pending、sweeper 重來;備軌需 JWT、webhook/sweeper 無。 */
  findActiveByOrderId(orderId: OrderId): Promise<ActiveChargeAttempt | null> {
    return this.primary.findActiveByOrderId(orderId);
  }

  async markCharged(input: MarkChargeAttemptChargedInput): Promise<void> {
    const primary = await this.tryRail(() => this.primary.markCharged(input), PRIMARY_BACKOFF_MS);
    if (primary.ok) {
      return;
    }
    if (isBusinessReject(primary.err)) {
      throw primary.err; // deterministic 拒絕:備軌必同拒(同一狀態機)、不切
    }
    const fallback = await this.tryRail(
      () => this.fallback.markCharged(input),
      FALLBACK_BACKOFF_MS,
    );
    if (fallback.ok) {
      return;
    }
    // 🔴 不串 rail err.message(防下層萬一未 sanitize 時複合層外洩 token/pg 原文、codex 關卡2):
    //    只輸出安全分類標籤(SQLSTATE/錯誤碼 或 transport/unknown)。
    throw new Error(
      `charge 簿記雙軌全敗(主軌:${errLabel(primary.err)};備軌:${errLabel(fallback.err)})`,
    );
  }

  async markFailed(input: MarkChargeAttemptFailedInput): Promise<void> {
    const res = await this.tryRail(() => this.primary.markFailed(input), PRIMARY_BACKOFF_MS);
    if (!res.ok) {
      throw res.err instanceof Error ? res.err : new Error('charge 簿記主軌失敗(transport)');
    }
  }

  /** 單軌重試:P0001 早停;耗盡回最後錯誤(result object、非 null sentinel — throw null 不被吞)。 */
  private async tryRail(
    op: () => Promise<void>,
    backoffs: readonly number[],
  ): Promise<{ ok: true } | { ok: false; err: unknown }> {
    let last: { ok: false; err: unknown } = { ok: false, err: undefined };
    for (const delay of backoffs) {
      if (delay > 0) {
        await this.sleep(delay);
      }
      try {
        await op();
        return { ok: true };
      } catch (err) {
        last = { ok: false, err };
        if (isBusinessReject(err)) {
          return last; // deterministic、重試無意義
        }
      }
    }
    return last;
  }
}

function isBusinessReject(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === PG_BUSINESS_REJECT;
}

/** 安全分類標籤:只回 code(SQLSTATE/syscall 錯誤碼)或 transport/unknown — 永不取 err.message。 */
function errLabel(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string') {
    return code;
  }
  return err instanceof Error ? 'transport' : 'unknown';
}
