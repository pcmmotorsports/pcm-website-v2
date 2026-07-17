/**
 * IEmailOutbox:交易性 email outbox port(M-4a Email 通知片 E1b;plan v3.1 §3.4/§3.5/§5)。
 *
 * 對應表 `public.email_outbox`(migration `20260717020000`;16 欄/10 CHECK/6 態,已 apply)。
 * 送達保證來自本狀態機 + Resend Idempotency-Key(at-least-once、非 exactly-once=Sean S3 明示認可),
 * 不是排程準時;寄信失敗絕不影響下單扣款(寫入在訂單交易外、不改 create_order)。
 *
 * 🔴 REQUIRED-E1b 邊界設計(codex 關卡2 R1 must-fix 後收緊):enqueue **不收** payload/subject/
 * dedup_key —— 只收事件專屬來源欄位,三者一律由落表邊界(adapter)以固定模板+顯式 allowlist
 * 重組;呼叫端**物理上無法**把任意物件/字串寫進表(繞過組裝層的路被拔掉,不是約定不繞)。
 *
 * 🔴 狀態機合約(migration §③/§⑦/§⑧;實作漏做會撞 DB 雙向 CHECK 或造成重複寄信):
 * - 認領(claim)= CAS `pending|failed → sending`,必寫 `claimed_at`、必含 `attempts < max_attempts`
 *   guard(CAS 才是原子決策點;due 掃描只是最佳化)。
 * - **attempts 於認領時 +1**(鎖住 crash-loop 毒信;dead-man 訊號 2 已依此語意含 `pending@max`
 *   隱形死列)。markFailed **不再**遞增。認領後的 `attempts` 值同時是**所有權世代 token**(見下)。
 * - 每一句離開 `sending` 的 UPDATE(markSent / markFailed / markSkippedOrderIneligible)必同時
 *   `claimed_at = NULL`(雙向 CHECK `(status='sending') = (claimed_at IS NOT NULL)`),且**必帶
 *   本次認領的 `claimedAttempts` 世代柵欄**——否則 lease 回收 + 他人再認領後,舊持有者延遲到達的
 *   標記會覆寫別人的在途列(ABA;codex 關卡2 R1 must-fix)。
 * - `skipped_no_real_email` = 可翻轉態(Q1 獨立線受控翻回 pending);`skipped_order_ineligible` =
 *   不可翻轉終態(S3=A 落點、轉入必寫 `last_error_code='order_ineligible'`)。
 */

export type EmailOutboxEventType = 'order_created' | 'order_shipped';

/**
 * 有限錯誤碼 allowlist(對齊 DB CHECK `^[a-z0-9_]{1,64}$`;E2a 依此決定退避/告警)。
 * 定義放本檔=它是 outbox `last_error_code` 欄的值域;sender(IEmailSender)產出、outbox 消費。
 * 新增碼 = 改本 union + adapter 映射表與 runtime allowlist,不得動態產生。
 */
export type EmailSendErrorCode =
  | 'http_400'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_408'
  | 'http_409'
  | 'http_422'
  | 'http_429'
  | 'http_500'
  | 'http_502'
  | 'http_503'
  | 'http_504'
  /** transport 層失敗(fetch reject / 逾時);與 HTTP 狀態碼互斥。 */
  | 'network_error'
  /** 兜底:非 allowlist 內的 HTTP 狀態、畸形回應、或無法歸類的 provider 失敗。 */
  | 'provider_error';

/**
 * payload = 事件時點不可變、非 PII 的最小集(migration §⑤):品項/金額/地址寄信時即時查主表,
 * 可後台改的欄(如 shipping_method)刻意不存。由 adapter 內部經 `buildOrderCreatedPayload`
 * 顯式逐欄組裝,不在 port API 露出寫入口。
 */
export type OrderCreatedEmailPayload = {
  event_version: 1;
  display_id: string;
  /** 付款完成時間(ISO 8601;事件時點快照、非寄送時點)。 */
  paid_at: string;
};

/**
 * enqueue 入參 = 事件專屬**來源欄位**(非落表形狀)。
 * 🔴 目前只開放 `order_created`(codex 關卡2 R1:過早開放 order_shipped 會讓「出貨事件+付款
 * payload」在型別上合法、且錯占唯一鍵 → E4 正確事件被當 duplicate 吞掉)。E4 定案 payload 與
 * dedup_key 算法後,以 discriminated union 增員(事件⇔payload 綁定、不共用自由欄)。
 */
export type EnqueueEmailInput = {
  eventType: 'order_created';
  orderId: string;
  /** 訂單顯示編號(subject 模板唯一動態欄 + payload.display_id 來源)。 */
  displayId: string;
  /** 付款完成時間(ISO 8601)。 */
  paidAt: string;
  recipientEmail: string;
  /** correlation id(repo 既有 request_id 基建);sweeper 補寄路徑無來源 → null。 */
  requestId?: string | null;
};

export type EnqueueEmailResult =
  /** 已入列(status=pending、寫入即到期,可被立即認領)。 */
  | { kind: 'enqueued'; id: string }
  /** 合成假信箱(LINE cohort):落表佔位但不進 due、不呼 Resend(plan §3.4 gate)。 */
  | { kind: 'skipped_no_real_email'; id: string }
  /** 同 (event_type, dedup_key) 且同 order 的事件已存在 → 冪等成功、不重寫。 */
  | { kind: 'duplicate' };

/**
 * 認領成功後回傳的工作單。`attempts`(已含本次 +1)= 本次所有權的**世代 token**,
 * 之後對本列的每一個 mark* 呼叫都必須原樣帶回(claimedAttempts)。
 */
export type ClaimedEmailJob = {
  id: string;
  eventType: EmailOutboxEventType;
  orderId: string;
  dedupKey: string;
  recipientEmail: string;
  subject: string;
  payload: unknown;
  /** 已含本次認領的 +1;= mark* 的 claimedAttempts 世代柵欄。 */
  attempts: number;
  maxAttempts: number;
  requestId: string | null;
};

export interface IEmailOutbox {
  /**
   * 寫入一筆待寄事件(訂單交易外、confirm 成功後)。payload/subject/dedup_key 由本邊界內部
   * 重組(REQUIRED-E1b);合成假信箱在**寫入前** gate(單一常數來源比對+正規化、禁 MX 查詢);
   * 撞唯一鍵且確認同事件 → `duplicate` 不 throw。
   * ⚠️ throw 來源不只 DB 錯誤:組裝層 runtime 驗證(displayId/paidAt 非空字串)失敗也會 throw
   * (訊息一律零 PII)→ 🔴 E3 呼叫端必須 catch **全部** enqueue rejection(寄信失敗絕不影響
   * 付款結果;付款已成功、enqueue 掛掉 → 交由對帳補寄/dead-man 訊號 4 兜)。
   */
  enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailResult>;

  /**
   * due 掃描 + 逐列 CAS 認領(E2a sweeper 主路徑)。回傳恰為搶到所有權的列(輸家靜默略過);
   * limit = 認領上限、非掃描上限(死列不佔窗口)。
   * 述詞 = `status IN (pending,failed) AND next_retry_at <= now() AND attempts < max_attempts`。
   */
  claimDue(limit: number): Promise<ClaimedEmailJob[]>;

  /** 對指定列 CAS 認領(E3 after() 立即嘗試路徑)。非 due / 搶輸 / 已達上限 → null。 */
  claimById(id: string): Promise<ClaimedEmailJob | null>;

  /**
   * `sending → sent`(寫 sent_at、清 claimed_at)。claimedAttempts = 認領時拿到的世代 token;
   * false = 所有權已失(lease 被回收/他人接手),**不得**重試覆寫。
   */
  markSent(id: string, claimedAttempts: number): Promise<boolean>;

  /**
   * `sending → failed`(可重試態、非終態):寫錯誤碼 + 下次重試時間(退避策略由 caller 算)、
   * 清 claimed_at。errorCode 於落表前過 runtime allowlist(非 allowlist → provider_error)。
   */
  markFailed(
    id: string,
    claimedAttempts: number,
    errorCode: EmailSendErrorCode,
    nextRetryAt: Date,
  ): Promise<boolean>;

  /**
   * `sending → skipped_order_ineligible`(S3=A 寄送前 gate:訂單已退款/取消 → 抑制)。
   * 🔴 不可翻轉終態、零訊號零對帳補救 → 必寫 `last_error_code='order_ineligible'` 供稽核
   * (migration §⑧);「哪些訂單狀態算 ineligible」= E2a 定案、gate 正確性是 E2a 的責任。
   */
  markSkippedOrderIneligible(id: string, claimedAttempts: number): Promise<boolean>;
}
