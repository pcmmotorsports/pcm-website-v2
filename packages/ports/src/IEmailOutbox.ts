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
 *
 * 🔴 **命名 provider 中立**(E1c;關卡1 codex+Fable 兩審皆判「對的抽象」):port 是抽象層、不綁
 * Resend 字面(provider 專屬 enum 只活在 adapter 映射表=正確位置);未來 provider 語意不等價時
 * 仍可回 `provider_error` → port 未被綁死。
 *
 * 🔴 **重試政策是本 union 語意的一部分**(codex 關卡1 N1:真抽象來自 adapter 邊界與語意定義,
 * 不只是把單字順序改掉)。逐碼退避合約見下方逐碼 JSDoc。
 *
 * 🔴 **權威落點(關卡2 code-reviewer + codex **雙命中** must-fix:前版字面是**不實宣稱**)**:
 * 前版寫「權威 = migration `20260717020000` §⑦ REQUIRED-E2a(兩處漂移以 migration 為準)」——
 * 但**該段實際零逐碼退避內容**(它管的是 attempts/CAS 述詞與 dead-man 訊號),等於把**唯一**寫著
 * 本合約的地方(本 JSDoc)預先判成漂移時的輸家 → E2a 實作者照「權威」去 migration 找 → 查無 →
 * 本片存在的理由(≥24h 退避)失去背書。
 * **現況(E1c-1):本 JSDoc = 逐碼退避合約的唯一定義處。**
 * 🔴 **E1c-2 硬閘(E2a 動工前必完成)**:把逐碼政策 + 未知 429 保守策略 + 可執行驗收寫入 migration
 * §⑦ → 屆時兩處並存、以 migration 為準(plan §3.6 仲裁序)。**E1c-2 未落地前,勿宣稱 migration 已是權威。**
 */
export type EmailSendErrorCode =
  | 'http_400'
  | 'http_401'
  | 'http_403'
  | 'http_404'
  | 'http_408'
  | 'http_409'
  | 'http_422'
  /**
   * 🔴 **無法分辨的 429**(E1c 後的殘餘語意 —— 不再是「所有 429」):body 非 JSON / 無 `name` /
   * `name` 非三個 quota-rate 字面(含原型鏈名如 `toString`)→ 落此碼。典型來源 = 邊緣層(CDN/WAF)
   * 限流回應(無 Resend body);亦涵蓋「429 body 實際無 `name`」的殘餘不確定(見 adapter 的
   * `QUOTA_ERROR_CODE_BY_NAME` 註解:兩官方 SDK 對 429 形狀不一致)。
   *
   * 🔴 **E2a 退避 = 保守長退避(≥24h,比照 `quota_daily_exceeded`)= Sean 2026-07-17 拍 Q11=A。**
   * ⚠️ **修正前版矛盾(codex 關卡2 R1 must-fix)**:前版寫「視同 `rate_limited`」,但 `rate_limited`
   * 是**短**退避 → 未知 429 若實際是日額度,照短退避仍會在幾分鐘內燒完 attempts → 死信 =
   * **重開 E1c 要關的洞**(Fable 關卡1 C1 的原意是「保守」,不是「跟 rate_limited 同一格」)。
   *
   * 🔴 **已知代價(codex 關卡2 R2 must-fix 抓出;Sean 已知悉此代價才拍 Q11=A)**:
   * 若該 429 實際只是**瞬時限流**(CDN/WAF 抖動、Resend 秒級 rate limit)→ 該封信**白等約 24h**
   * 才重試(信仍會寄出、不會消失)。
   * ⚠️ **代價上界取決於一個未確認事實**:429 body 是否必然含 `name`(**兩官方 SDK 不一致**,見
   * adapter 的 `QUOTA_ERROR_CODE_BY_NAME` 註解)。**若實際不含 → 所有 429 都落本格 → 全部 24h 延遲。**
   * → 🔴 故**不得**宣稱本片「零回歸 / 最壞只是無效果」(前版此字面**已作廢**:分類失敗時退避政策
   * 仍生效 = 真實延遲,非「無效果」)。
   * **拍板理由(Sean 已知悉)**:PCM 量級(10-30 單/日、sweeper 每 5 分鐘一輪)距 Resend 限流門檻
   * 數個量級 → 撞 429 幾乎必然是額度耗盡而非打太快 → 「未知即當額度」對本專案是合理預設。
   * **第三選項已記 backlog #285**(解析 `Retry-After` → provider-neutral retry hint;有 hint 用 hint、
   * 無 hint 才長退避)—— codex 正確指出「延遲 24h vs 永久死信」是**假二分法**,本片選 A 是**取捨、
   * 非唯一解**。
   */
  | 'http_429'
  | 'http_500'
  | 'http_502'
  | 'http_503'
  | 'http_504'
  /**
   * 打太快(Resend 官方 `rate_limit_exceeded`)。
   * ⚠️ **官方 rate limit 數值多處不一致 = 未確認**(2026-07-17 查:introduction 頁親讀「5 requests per
   * second per team」;rate-limit 頁 10 req/s;codex 關卡2 另指 Account Quotas 頁)→ 標未確認、不採信
   * 單一值。**非阻擋**:PCM 量級(sweeper 每 5 分鐘一輪、10-30 單/日)遠低於任一數值。
   * **E2a 退避 = 保守短退避**(固定值由 E2a 定)。
   * 🔴 **本片不傳出 header**(codex 關卡2 must-fix):官方雖有 `Retry-After` / `ratelimit-reset`,
   * 但 `SendEmailResult` 與 `ResendFetchLike` **皆未承載 headers** → E2a **拿不到**。
   * 若未來要依 header 精準退避,須擴 `SendEmailResult` 回傳 **provider-neutral retry hint**
   * (由 adapter 解析 + 驗證 + 上限約束,不得透傳原始 header)= **另片、非本片範圍**。
   */
  | 'rate_limited'
  /**
   * 日額度用盡(官方 `daily_quota_exceeded`;Free = 100 封/日):**當下重試不會成功**。
   * ⚠️ **精確敘述(codex 關卡2 nit;前版「明天會成功」是絕對敘述、官方不保證)**:官方只支持
   * 「**最早可在等待 24 小時後恢復**」;恢復後若流量仍超過額度 → **可能再次耗盡**(非一次性)。
   * 🔴 **E2a 退避 = 失敗時點 + ≥24h + jitter;禁指數退避;燒速上限 = 每日 1 次。**
   * (照一般指數退避 → 當天燒完 5 次 attempts → **永久死信,即使隔天額度重置也不補寄** = E1c 存在的理由。)
   * ⚠️ **官方未揭露確切重置邊界,只要求「等待 24 小時」**(codex 關卡2 R2 nit 精確化;2026-07-17
   * 親查 errors 頁:有「等待 24 小時」的建議動作、**無任何重置時刻/時區/是否滾動窗的敘述**)
   * → **用滾動 +24h、不可寫「隔天午夜」**:不依賴時區假設(不管 UTC / 台北 / 滾動窗,+24h 必跨重置點)。
   */
  | 'quota_daily_exceeded'
  /**
   * 月額度用盡(官方 `monthly_quota_exceeded`;Free = 3,000 封/月)。
   * ⚠️ **精確敘述(codex 關卡2 nit;前版「非升級不可、睡多久都沒用」是絕對敘述,且與本檔自己
   * 「每日重試」的政策自相矛盾)**:官方的**即時處置是升級**;否則恢復**取決於帳期重置、
   * 不假設確切時刻**(故仍每日重試 = 帳期若重置即自動成功,無需人工)。
   * **E2a 退避 = 比照 daily(+24h)+ dead-man 訊號 5 每日告警**(Sean 2026-07-17 拍 Q9=A)。
   * 理由:升 Pro 後額度即恢復 → 下次重試自動全寄;5 天緩衝(每日告警)、5 天無處置 → 死信。
   * 🔴 **誠實揭示:目前無「死信人工重送」工具**(Sean 已知悉此缺口才拍;已開 backlog)。
   */
  | 'quota_monthly_exceeded'
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
