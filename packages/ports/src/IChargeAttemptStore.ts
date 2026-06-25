import type {
  ActiveChargeAttempt,
  BeginChargeAttemptResult,
  MarkChargeAttemptChargedInput,
  MarkChargeAttemptFailedInput,
  OrderId,
  StuckChargeAttempt,
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
  /**
   * 依 orderId 反查 active(pending|charged)attempt 對帳鍵 + order 對帳欄(M-3 3DS-1b settleCharge)。
   *
   * 🔴 **主軌-only**(`get_active_charge_attempt` RPC、payment_confirmer 窄權):對帳讀不需雙軌韌性
   * (讀失敗 → settleCharge 回 pending、sweeper 重來,無漏寫風險);且備軌需 user JWT、webhook/sweeper 無。
   * 無單 / 無 active attempt → `null`(1b 映 no_attempt)。
   */
  findActiveByOrderId(orderId: OrderId): Promise<ActiveChargeAttempt | null>;

  // ── M-3 3DS-5b initiate:把 bank_txn / rec_trade_id 寫進仍 pending 的 attempt(record_charge_bank_txn / record_charge_pending_rec RPC)──
  // 🔴 全主軌-only(對齊 findActiveByOrderId):3DS 對帳路徑無 user JWT〔備軌需 auth.uid()〕;寫失敗語意見各方法。

  /**
   * 🔴 3DS charge **前**把 caller 自產 `bankTxn`(`^[A-Z0-9]{1,19}$`)durable 寫進仍 pending 的 attempt
   * (master plan §1:回應遺失本機仍有可查鍵)。
   *
   * 🔴 **RPC 回 false(未 durable:異值不覆寫 / 非 pending / 查無)即 throw**(codex 關卡1 #3:不可在 bank_txn
   * 未落地時讓 use-case 送 TapPay → init_failed、零 charge);連線/parse 失敗亦 throw。同值冪等回 true(no-op、不 throw)。
   */
  recordInitiationBankTxn(attemptId: string, orderId: OrderId, bankTxn: string): Promise<void>;

  /**
   * 🔴 3DS charge **後**把回傳 `recTradeId` durable 寫進仍 pending 的 attempt(維持 pending、≠ markCharged)。
   *
   * best-effort 語意(charge 後、bank_txn 已可對帳):RPC 回 false(未 durable)亦 throw、連線/parse 失敗亦 throw
   * → use-case catch→log 後仍 redirect(bank_txn 已是對帳鍵、rec 缺失不阻跳轉)。同值冪等回 true(不 throw)。
   */
  recordInitiationRec(attemptId: string, orderId: OrderId, recTradeId: string): Promise<void>;

  // ── M-3 3DS 乙路 R2a:released failure observation(canonical §3/§5 + §4 R1b3;三參數雙鍵)──
  // 🔴 主軌-only(對齊 findActiveByOrderId / 5b initiate):對帳路徑無 user JWT〔備軌需 auth.uid()〕。

  /**
   * 🔴 **released** attempt 讀 Record -1/5(明確失敗觀察)→ 呼窄權 RPC `record_released_failure_observation`
   * (payment_confirmer only)write-once 雙鍵標記 `failure_observed_at`/`failure_observed_status`、**不改 status**
   * (released 續低頻對帳直到 terminal、§2.5/§2.6)。三參數 = 雙鍵(attemptId+orderId)+ observedStatus。
   *
   * 🔴 **fail-closed**:RPC 對 observedStatus∉{-1,5} / 雙鍵不符 / 非 released / order 已付款 一律 RAISE
   * (R1b3 §4)→ adapter throw 傳出;settleCharge released branch(R2b)catch→回 `record_unreachable`
   * (不靜默吞、不誤標 failed)。重放冪等(COALESCE write-once、不覆寫第一次觀察)。
   */
  recordReleasedFailureObservation(
    attemptId: string,
    orderId: OrderId,
    observedStatus: number,
  ): Promise<void>;

  // ── M-3 3DS-4 sweeper(expire_stuck_attempts_at_ceiling / claim_stuck_unsettled_attempts / mark_attempt_settle_retry / flag_non_unpaid_active_attempts、3DS-4a-2)──
  // 🔴 全主軌-only(同 findActiveByOrderId):對帳路徑無 user JWT〔備軌需 auth.uid()〕、且讀/標失敗→sweeper 下輪重來無漏寫風險。

  /**
   * 🔴 ceiling-expirer(claim **前置**、防孤兒;3DS-4a-2)。達 ceiling 且 lease 到期、仍 active 且 order unpaid →
   * 轉 needs_manual_review。回轉換筆數(>0 sweeper 告警)。**sweepSettlements 每輪 claim 前必呼**(plan §5.2③)。
   */
  expireStuckAtCeiling(): Promise<number>;

  /**
   * 🔴 原子 lease claim stuck unsettled attempt(FOR UPDATE OF a SKIP LOCKED + LIMIT;3DS-4a-2)。
   *
   * 濾 status IN(pending,charged) AND order unpaid(含 charged-unpaid 群1)AND 非 manual AND settle_attempt_count<ceiling
   * AND lease 到期 AND created_at < now()-ageSeconds(`ageSeconds`<0 → 整批空、fail-closed)。settle_attempt_count++(claim token)
   * + 5min lease。回 `StuckChargeAttempt[]`(空=本輪無 due)。
   */
  claimStuckUnsettled(ageSeconds: number, limit: number): Promise<StuckChargeAttempt[]>;

  /**
   * pending outcome 退避 retry;🔴 token guard(`settle_attempt_count=claimedCount AND 非 manual AND order unpaid`)。
   *
   * 退避 next_settle_at + 達 ceiling→needs_manual_review;`reasonCode` 寫 last_settle_error(RPC 端 allowlist、零 PII)。
   * 回 affected(`1`=已退避 / `0`=stale/late mark/平行已付款單 = no-op)。不 ++(遞增唯一在 claim)。
   */
  markSettleRetry(attemptId: string, claimedCount: number, reasonCode: string): Promise<number>;

  /**
   * 標 active(pending|charged)但 order payment_status NOT IN(unpaid,paid)(refunded/partiallyPaid 殘留、confirm 永不收斂)
   * → needs_manual_review。**唯一回收路徑**(claim/expirer/mark 皆濾 unpaid);回標記筆數(>0 sweeper 告警)。
   */
  flagNonUnpaidActive(limit: number): Promise<number>;
}
