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
 * - 每一句離開 `sending` 的 UPDATE **無條件**必同時 `claimed_at = NULL`
 *   (雙向 CHECK `(status='sending') = (claimed_at IS NOT NULL)`)。
 * - 🔴 **離開 `sending` 有兩條路,所有權判定方式不同(E2a-a 更正:前版寫「每一句…必帶世代柵欄」,
 *   在 `reclaimStaleLeases` 落地後即成假 —— 它也離開 sending、卻不可能帶柵欄)**:
 *   · **持有者路徑**(markSent / markFailed / markSkippedOrderIneligible /
 *     **markSkippedShipmentVoided**(2026-08-30 E4 片3a 新增)/
 *     **markSkippedOrderCancelled**(2026-09-02 ⟦b4-MAILCANCEL1⟧ 新增;codex R2 nit 抓到漏列))
 *     = **必帶本次認領的
 *     `claimedAttempts` 世代柵欄**;否則 lease 回收 + 他人再認領後,舊持有者延遲到達的標記會覆寫
 *     別人的在途列(ABA;codex 關卡2 R1 must-fix)。
 *   · **回收器路徑**(`reclaimStaleLeases`)= 非持有者、**無柵欄可帶**,改以 CAS 述詞
 *     `status='sending' AND claimed_at < staleBefore` 自身作為所有權判定(詳見該方法 JSDoc)。
 * - `skipped_no_real_email` = 可翻轉態(Q1 獨立線受控翻回 pending);`skipped_order_ineligible` =
 *   不可翻轉終態(S3=A 落點)。
 *   🔴 **而【轉入時寫哪個碼】有兩個, 不是一個**(2026-09-02 ⟦b4-MAILCANCEL1⟧;codex must-fix):
 *   ⛔ ~~轉入必寫 `last_error_code='order_ineligible'`~~ —— 那句在本片之後**不完整**。
 *     · `order_ineligible`         ← 上游逐封閘(`markSkippedOrderIneligible`)
 *     · `order_ineligible_at_send` ← 寄送當下才發現已取消(`markSkippedOrderCancelled`)
 *   ⇒ 📌 **態相同而碼不同是刻意的** —— 合併它們會讓上游那道閘變成看不見的
 *     (主視窗 2026-08-24 拍【乙】,全文在 `markSkippedOrderCancelled` 的 JSDoc)。
 *
 *   🛑🛑 **而有一份【更權威而且改不動】的檔仍然寫著舊的那一句 —— 這一段就是給撞到它的人看的**:
 *     `supabase/migrations/20260717020000_m4a_email_outbox.sql:153` 逐字
 *     「①轉入本態**必寫** `last_error_code = 'order_ineligible'`」。
 *     🔴 **那句話在 2026-09-02 之後【不完整】, 而它【不能改】** ——
 *       已 apply 的 migration **連註解都不可改**(`APPLIED.tsv` 記 sha256, 改一個字就撞閘;
 *       memory `reference_applied-migrations-are-immutable-even-in-comments`)。
 *     ⇒ 📌 **所以那一行會永遠是舊的, 而【本檔是活的那一份】。**
 *     ⇒ ⇒ 兩邊衝突時以本檔為準;而那不是「migration 錯了」——
 *       它在寫下的那一天是對的, 而它沒有辦法知道自己過期了。
 *   🔵 **這一格是 codex 2026-09-02 R2 抓的 must-fix, 而它的處方(去改那支 migration)撞到上面那條硬規矩**
 *     ⇒ 處置改成「不改它, 而把矛盾寫在讀得到的地方」。
 */

/**
 * 🔴🔴 **這個 union 是【手抄的】,而 DB 的 CHECK 才是值域的權威。**
 *    ⇒ 兩者分岔是本 repo **明文預期會發生**的順序(`20260902120000` 逐字:
 *      「『DB 先加了新 event_type、code 還沒跟上』是這個 repo 明文預期會發生的順序」)。
 *
 * 🔵🔵 **2026-09-03 稍晚:下面那段【已經被做掉了一半】—— Q10 Sean 拍甲「補一封信」。**
 *    `order_cancelled` **已進本 union**,而它的模板與 `buildEmailText` 的 case 同一顆 commit 落地。
 *    ⛔ ~~「那條線的模板還沒有人做」~~ ⇒ ✅ **做了**;而**寫入端(掃描式 enqueue)是下一片** ——
 *    📌 **順序是刻意的:模板必須先於寫入端**,否則信會卡進死信而客人一樣收不到,只是多一批死信
 *    (那條順序約束本檔下面自己就寫著)。
 *
 * ⚠️ **2026-09-03 早上量到的分岔 —— 下面【整段】今天已為假,舊字面逐句劃掉不刪**
 *    (code-reviewer R1 抓到:我原本只在上面新增一段,而**被訂正的這幾行仍是平直的現在式斷言**
 *     ⇒ 冷讀的人讀到的是一句今天為假的話,**而標題向他保證了那裡有刪除線**):
 *    ⛔ ~~DB 的 CHECK 自 2026-09-02 起含 `order_cancelled`,而本 union **沒有它**~~
 *      (⛔ ~~那個量法今天跑會**命中**,不再是 0~~)
 *    ⛔ ~~**那不是漏改,是【那條線的模板還沒有人做】** —— 它的文案沒有稿、沒有拍板 ⇒ 本片不發明它~~
 *      ⇒ ✅ **Sean 2026-09-03 拍甲「補一封信」⇒ 文案有了、模板有了、case 有了。**
 *    ✅ **而【仍然成立】的只有這一句(它是規律不是現況)**:加進 union **必須**同時補
 *      `buildEmailText` 的 case(`satisfies never` 會逼你),而補 case 需要文案
 *      ⇒ **順序是:先有文案,再進 union。**(本片就是照這個順序走的。)
 *
 * 🔵 而在它進來之前,失敗方向是安全的:`buildEmailText` 的 `default` 是 `throw`
 *    ⇒ 計 error、列留 sending、**不寄**,而不是把 event_type 字串當內文寄出去。
 */
/**
 * 🔴🔴 **訂單失效(已取消/已退款)時,這一種信【該不該被擋下來】。**
 *
 * **為什麼這一格存在**(2026-09-03,Q10 片 B 前置;code-reviewer R1 C2 抓到):
 * 寄送前有一道閘 —— 「已取消/已退款的單,不要再寄通知」。它**不分 event_type**,
 * 而**取消通知本身正是那條規則的例外** ⇒ 沒有這一格的話,
 * **每一封取消信都會被標成 `skipped_order_ineligible`** ——
 * 🛑 **而那是終態、不計 error、【沒有自動告警在看】**(⚠️ 不是「查不到」——後台 `email-log-view.ts` 逐單看得到,而那要有人去查;codex nit 2 訂正我原本過度絕對的字面) ⇒ **一整條做完的線看起來像做完了,而一封都沒寄。**
 *
 * 🎯 **判別句(加新 event_type 時照這句填)**:
 * ```
 * 這封信講的是「這張單【還會發生什麼】」⇒ true (單失效了 ⇒ 那句話變成假的 ⇒ 該擋)
 * 這封信講的是「這張單【的終局本身】」  ⇒ false(單失效【就是】我們要說的那件事 ⇒ 擋它 = 擋掉唯一要說的話)
 * ```
 *
 * 🔵 **為什麼是 `Record<EmailOutboxEventType, …>` 而不是一份清單**:
 * `Record` 對 union 是**窮舉**的 ⇒ **加一個新 event_type 而沒標這一格 ⇒ typecheck 當場紅。**
 * ⇒ 📌 從「下一個人要記得去改一份清單」變成「**不標就編不過**」。
 * ⚠️ 而**這一格只管【被閘擋不擋】** —— 它不決定要不要寄、也不決定內容。
 */
export const SUPPRESS_WHEN_ORDER_INELIGIBLE: Record<EmailOutboxEventType, boolean> = {
  // 這張單被取消了 ⇒ 那正是這封信要講的事
  order_cancelled: false,
  // 「付款成功」在單被取消之後是假的 ⇒ 該擋
  order_created: true,
  // 「已出貨」在單被取消之後是假的 ⇒ 該擋
  order_shipped: true,
  // 同 order_cancelled:取消本身就是內容
  order_unpaid_cancelled: false,
  // 🔴 **同 order_shipped ⇒ 擋。** 而理由不是「照抄旁邊那一格」:
  //    單被取消之後, 客人**從來沒收到過**那封出貨通知(它自己就被擋掉了)
  //    ⇒ 這時候寄一封「先前那個號碼有誤」= 講一封他沒收過的信 ⇒ 純困惑。
  shipment_tracking_corrected: true,
  // 🔴 **true(該擋)** —— 照上面那句判別句填, 不是照抄旁邊:
  //    這封信講的是「請你在期限內匯這筆錢」= **這張單【還會發生什麼】**
  //    ⇒ 單被取消或退款之後那句話變成假的 ⇒ 🛑 **繼續寄 = 叫一個沒有義務付錢的人付錢。**
  //    ⚠️ 而它與 order_cancelled / order_unpaid_cancelled 的 false 不衝突:那兩封講的是【終局本身】。
  //    🔵 R3 對抗審查獨立確認過這一格, 並指出它順手接住一條 race:
  //       客人改刷卡 ⇒ begin_charge_attempt 就地取消未付款匯款單(20260904050000)
  //       ⇒ 這道閘擋下那封本來會寄出去的催款信。
  bank_order_created: true,
};

export type EmailOutboxEventType =
  | 'order_cancelled'
  | 'order_created'
  | 'order_shipped'
  | 'order_unpaid_cancelled'
  // 🔴 ⟦5b-TRACKNUMGAP1⟧ 片 C(2026-09-04):已出貨的箱【更正貨運單號】之後的更正信。
  //    Sean 逐字「甲 = 做, 改完自動再寄一封對的信給客人」。
  //    ⚠️ **這個 union 是手抄的** —— DB CHECK 那半在 `20260904220000`, 兩邊要同一次改,
  //    而 `sweep-email-outbox.ts` 的 `satisfies never` 會在少一邊時當場紅(那是它做對了)。
  //    🔴🔴 **而這一段註解【不可以出現半形分號】** —— 2026-09-04 實撞兩次:
  //    `scripts/email-event-type-union-vs-db.test.ts` 用一個**非貪婪到第一個分號為止**的
  //    regex 抓這個 union ⇒ **註解裡一個分號就把下面的值整個切掉**,
  //    而那把尺回報的是「DB 有而 TS 沒有」——
  //    📌 **一個看起來像「我漏加了」的錯, 其實是我的【註解】打斷了別人的解析器。**
  //    🎯 **而第二次是:我寫這段【解釋分號】的註解時, 把那個 regex 抄了進來 ——**
  //    **那行 regex 自己就含一個分號。**⇒ 所以這裡只用散文描述它, 不貼原式。
  | 'shipment_tracking_corrected'
  // 🔴 ⟦b4-BANKNOEMAIL⟧(2026-09-06):顧客站選【匯款】而尚未付款的單, 告訴客人匯去哪、匯多少、幾天內。
  //    Sean 2026-09-06 逐字答「甲 = 可以」定案文案。DB 那半在 20260906140000, 兩邊同一次改。
  //    🛑 它與 order_created 是【兩封不同的信】, 不是同一封的兩個狀態 ——
  //    匯款單成立時寄本封, 客人真的匯進來翻 paid 之後才寄 order_created。
  //    ⚠️ 本段註解同樣不可以出現半形分號, 理由見上面那一段。
  | 'bank_order_created';

/**
 * 有限錯誤碼 allowlist(對齊 DB CHECK `^[a-z0-9_]{1,64}$`;E2a 依此決定退避/告警)。
 * 定義放本檔=它是 **sender 產出的失敗碼**值域(sender〔IEmailSender〕產出、outbox 消費);
 * 新增碼 = 改本 union + adapter 映射表與 runtime allowlist,不得動態產生。
 *
 * ⚠️ **本 union ≠ `last_error_code` 欄的完整值域**(前版此字面已作廢):該欄另有 **adapter 內部寫死、
 * 刻意不入本 union 的稽核碼** —— `order_ineligible`(S3=A 抑制終態)、
 * **`order_ineligible_at_send`**(2026-09-02 ⟦b4-MAILCANCEL1⟧;寄送當下才發現單已取消)、
 * `lease_reclaimed`(E2a-a 回收;見 `reclaimStaleLeases`)與 **`shipment_voided`**
 * (2026-08-30 E4 片3a;箱被作廢)。
 * 四者描述的都**不是「Resend 寄送失敗」**,故不經本 union 與
 * `markFailed`(會被其 runtime allowlist 改寫成 `provider_error`)。欄的真實值域 =
 * 本 union ∪ {`order_ineligible`, `order_ineligible_at_send`, `lease_reclaimed`, `shipment_voided`};
 * DB 只以 regex 約束格式、不列舉。
 * 🔴 **這一行漏掉新碼會怎樣**(codex R2 抓到我漏了):它是唯一一份寫得出「這個欄可能有什麼」的清單
 * ⇒ 漏一個 ⇒ 下一個做稽核報表的人會把那些列當成髒資料。
 * 🛑 **而 2026-09-02 它【又被漏了一次】(codex must-fix 再抓)** —— 同一支檔、同一行、同一個病。
 *    ⇒ 📌 而那說明這段警語**擋不住它自己警告的事** ——
 *      加新碼的人改的是 adapter 與 use-case, 而**這一行在另一支檔的另一段**。
 *    ⇒ ⇒ 要機制的話, 那是一支「adapter 裡寫死的碼 vs 本行清單」的比對測試, 而它今天不存在。
 *
 * 🔴 **命名 provider 中立**(E1c;關卡1 codex+Fable 兩審皆判「對的抽象」):port 是抽象層、不綁
 * Resend 字面(provider 專屬 enum 只活在 adapter 映射表=正確位置);未來 provider 語意不等價時
 * 仍可回 `provider_error` → port 未被綁死。
 *
 * 🔴 **重試政策是本 union 語意的一部分**(codex 關卡1 N1:真抽象來自 adapter 邊界與語意定義,
 * 不只是把單字順序改掉)。逐碼退避合約見下方逐碼 JSDoc。
 *
 * 🔴 **權威落點 = migration `20260717020000` 頭註 §⑨**(E1c-2 已落地;**本 JSDoc 與 §⑨ 並存,
 * 漂移以 §⑨ 為準**)。⚠️ **是 §⑨、不是 §⑦** —— §⑦ 管的是 attempts/CAS 述詞與 dead-man 訊號、
 * **零逐碼退避內容**;§⑨ 才是 E1c 的退避三列 + 訊號 5 + 訊號 1 述詞修正。
 * (歷史:E1c-1 前版曾寫「權威 = §⑦」= **引用不存在的權威**〔關卡2 code-reviewer + codex 雙命中〕;
 * E1c-1 改寫後又留下「本 JSDoc = 唯一定義處 / E1c-2 未落地前勿宣稱 migration 已是權威」——
 * 該字面在 E1c-2 落地當下即成假、且與 §⑨ 形成**閉環矛盾**〔兩處互指對方「還沒好」→ 訊號 5 照樣被丟棄〕,
 * 為 E1c-2 關卡2 must-fix、**已於同 commit 逐條銷案**。)
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
   * ⛔ ~~🔴 **誠實揭示:目前無「死信人工重送」工具**(Sean 已知悉此缺口才拍;backlog **#286**)。~~
   * 🟢 **2026-09-04 這句已經不成立 —— 那個工具做好了, 而且在正式站上活著**:
   *   · UI `apps/admin/src/app/settings/mail/page.tsx:131` 一個 `<form action={requeueDeadEmailAction}>`
   *   · Action `lib/mail/dead-letter-actions.ts:44` —— **管理者專用閘**、稽核**先寫**、
   *     `status ∈ {pending, failed}` 且 `attempts >= maxAttempts` 才收
   *   · RPC `admin_requeue_dead_email(p_outbox_id uuid)` —— 🔬 **正式庫唯讀實查存在**
   *     (2026-09-03 20:06 UTC;落點 `20260831040000`, `APPLIED.tsv` 有記)
   *   · 首頁那格死信計數 `app/page.tsx:374` **連得過去**
   * 📌 **而舊字面留著加刪除線是刻意的** —— 我 2026-09-04 自己引用過這一句去寫一份報告,
   *    而**它當時已經假了三天**。⇒ 🎯 **一句誠實揭示過期之後, 讀起來與它還成立時一模一樣。**
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
 * 出貨通知信的 payload(M-4b E4-a)。
 *
 * 🔴 **這裡【沒有】追蹤碼,也【沒有】品項 —— 那是刻意的,不是漏掉。**
 * `order-email-assembly.ts:12` 的設計意圖逐字:「品項/金額/地址等渲染資料**寄信時即時查主表**,
 * 不進 payload(**可後台改的欄存了會過期**)」。追蹤碼正是「可後台改」的那種:
 * 員工改過之後,payload 裡凍住的是舊碼 ⇒ 客人拿舊碼去查 ⇒ 查無 ⇒ **而信已經寄出去、收不回來**。
 * ⇒ 寄送當下的讀取走 `IShippedEmailContext`(那支 port 就是為這件事存在的)。
 *
 * ⚠️ 這裡放的兩個欄都是**事件時點就凍住、之後不會變**的:
 *   `shipment_reference` = 產號(`shipments_reference_unique`,一經產生不改)
 *   `shipped_at`         = 出貨那一刻的時戳
 */
/**
 * 更正單號那封信的 payload(⟦5b-TRACKNUMGAP1⟧ 片 C)。
 *
 * 🔴🔴 **這裡【刻意】把 `tracking_number` 存進 payload —— 而它違反 `OrderShippedEmailPayload`
 *    那一格逐字寫的「追蹤碼不行,存了會過期」。理由與代價都寫在這裡,不要只讀那一句。**
 *
 * ✅ **為什麼可以**:對 `order_shipped` 而言追蹤碼是**附帶資訊**(信的主體是「出貨了」)
 *    ⇒ 存了會過期 ⇒ 該讀即時值。
 *    而對本事件, **那個號碼【就是事件本身】** —— 這封信的主體是「**那個值換了**」。
 *    ⇒ 它不是快照過期的問題, 它是**事件的內容**。
 *
 * 🔴🔴 **而代價是真的, 我寫出來**:enqueue 到寄出之間有一個窗(掃描器是 cron)。
 *    若員工在那個窗裡**又改了一次**(A→B→C):
 *    · B 的列已入隊、payload 帶 B ⇒ 它會寄出一封說「正確的是 B」——**而那時候正確的是 C**。
 *    ⇒ 🛑 **客人收到一封【主動宣告自己是對的】而其實是錯的信, 而信收不回來。**
 *    ⇒ 📌 **這一格需要一道「寄送當下比對即時值, 不同就跳過」的閘** —— 而那不在本型別裡,
 *      它在 sweeper 的認領路徑上(與 `markSkippedOrderCancelled` 同一族)。
 *    ⚠️ **本註解是那道閘還沒裝的證據** —— 裝好之前, 這一段不要刪。
 */
export type ShipmentTrackingCorrectedEmailPayload = {
  event_version: 1;
  display_id: string;
  /** 箱 uuid(同 `OrderShippedEmailPayload` 那一格:不可變, 而寄送時要拿它去比即時值)。 */
  shipment_id: string;
  /** 箱號(給客人分辨哪一箱)。 */
  shipment_reference: string;
  /** 🔴 **更正當下**的貨運單號 —— 它是這封信的**內容**。⛔ ~~也是 `dedup_key` 的後半~~ 已不是。 */
  tracking_number: string;
  /**
   * 這一次更正的**身分**(SQL 算的 20 位數時點字串)。`dedup_key` 的後半。
   * 🔴 **寄送當下靠它判「這份工作單還是不是最新那一次更正」** ——
   *    ⇒ 📌 **不能拿號碼去判**:A→B、B→C、再改回 B, 第一封與第三封的**號碼相同而它們是兩件事**,
   *      拿號碼比會**兩封都寄**(而主視窗 2026-09-04 拍的是「只寄最後對的那封」)。
   * 🛑 它**不進信件內文** —— 客人看不到它;它存在的唯一理由是那道比對。
   */
  tracking_corrected_key: string;
};

export type OrderShippedEmailPayload = {
  event_version: 1;
  display_id: string;
  /**
   * 🔴 **箱 uuid。這一欄是【寄送時讀取】那條路的唯一安全接點**(2026-08-22 codex R1 ④ 之後補)。
   *
   * `IShippedEmailContext.loadShippedContext` 要 `shipmentId`,而 sweeper 手上的
   * `ClaimedEmailJob` 原本**只有** `orderId` 與**無結構的** `dedupKey`。
   * ⇒ 唯一的取得方式會變成「**解析 dedup_key 這個自由文字**」,
   *   而 `email_outbox.dedup_key` 在 DB 層**沒有任何格式 CHECK**(migration `:301` 逐字
   *   「dedup_key 是通用 text、不加格式 CHECK」)⇒ 那條路沒有任何東西保證它解得出來。
   * ⇒ 改成**顯式一欄**:型別擋、組裝層 runtime 驗 uuid 形狀、消費端不必解析字串。
   *
   * ⚠️ **它可以進 payload,而追蹤碼不行 —— 判別的是【可不可變】不是【是不是 id】**:
   *   箱 uuid 一經產生永不改;追蹤碼**後台可改**,存了會過期。
   */
  shipment_id: string;
  /** 箱號。🔴 同一張訂單分批出貨會寄多封,這是收信人分辨「哪一箱」的唯一依據。 */
  shipment_reference: string;
  /** 標記出貨的時點(ISO 8601;事件時點快照、非寄送時點)。 */
  shipped_at: string;
};

/** 兩個事件共用的來源欄位。**不含任何事件專屬欄** —— 那是 union 各分支的事。 */
type EnqueueEmailInputBase = {
  orderId: string;
  /** 訂單顯示編號(subject 模板唯一動態欄 + payload.display_id 來源)。 */
  displayId: string;
  recipientEmail: string;
  /** correlation id(repo 既有 request_id 基建);sweeper 補寄路徑無來源 → null。 */
  requestId?: string | null;
};

export type EnqueueOrderCreatedEmailInput = EnqueueEmailInputBase & {
  eventType: 'order_created';
  /** 付款完成時間(ISO 8601)。 */
  paidAt: string;
};

/**
 * 🔴 `shipmentId` 是**本分支存在的理由**:`dedup_key` 是 `{shipment_id}:{order_id}`,
 * 而唯一鍵 `(event_type, dedup_key)` **不含 order_id**(`20260717020000:377`)
 * ⇒ `:350` 明文要求 dedup_key 在同一 event_type 內**全域唯一**。
 * 只用 order_id 的話,**同一張單的第二箱會被當成 duplicate 吞掉 = 漏一封信**,而且不報錯。
 */
export type EnqueueOrderShippedEmailInput = EnqueueEmailInputBase & {
  eventType: 'order_shipped';
  /**
   * 箱 uuid。**dedup_key 的前半,而且【也進 payload】**。
   *
   * 🔴 ~~原本寫「不進 payload」~~ **2026-08-22 R1 ④ 之後不成立**(Fable R2 F1 抓到:
   * 這句與同一支檔 `OrderShippedEmailPayload.shipment_id` **直接矛盾**)。
   * ⇒ 它進 payload,因為寄送時要拿它去主表撈脈絡;而它**可以**進 payload,
   *   理由是**不可變**(判準是可不可變,不是是不是 id)。
   * ⚠️ 讀到舊字面而回頭去解析 `dedup_key` 的人:**那條路是被刻意堵死的**,
   *   `dedup_key` 在 DB 層沒有任何格式 CHECK。
   */
  shipmentId: string;
  /** 箱號(進 payload,收信人用它分辨哪一箱)。 */
  shipmentReference: string;
  /** 標記出貨的時點(ISO 8601)。 */
  shippedAt: string;
};

/**
 * enqueue 入參 = 事件專屬**來源欄位**(非落表形狀)。
 *
 * 🔴 **2026-08-22 E4-a:改成 discriminated union,`order_shipped` 開放。**
 * ~~「目前只開放 `order_created`」~~ 已作廢 —— 原句的理由逐字是「過早開放 order_shipped 會讓
 * 『出貨事件+付款 payload』在型別上合法、且錯占唯一鍵 → E4 正確事件被當 duplicate 吞掉」。
 * 那個顧慮**由 union 本身解掉**:事件⇔payload 綁定在型別上,兩個分支不共用自由欄,
 * 而 dedup_key 由落表邊界依 `eventType` 分派(呼叫端碰不到)。
 */
/**
 * 🔴🔴 **未付款被【員工】取消的通知信**(Sean 2026-09-03 拍甲;理由逐字「那是客人唯一一封信」)。
 *
 * 🛑 **射程只涵蓋【員工按取消】那一批,不含逾時自動取消。**
 *    ⇒ 判準與它的脆弱點寫在 `IUnpaidCancelledOrderScanner` 檔頭(**一處全文,這裡只留指標**)。
 *
 * 🛑🛑 **而那不是待決事項 —— Sean 2026-09-03 拍過乙**,逐字(已寫進正式庫 COMMENT,
 *    `20260903040000_...:100-102`):「`expire_unpaid_orders`(一次上限 **500 張**)【不涵蓋】——
 *    **不寄, 只有員工按下取消才寄**」。
 *    ⛔ ~~我原本在這裡寫「Sean 未拍板(題 2)」+「他若答要寄:改法是一處, 拿掉那道閘」~~
 *    🔴 **兩句都假,而第二句指向一個會傷到客人的動作**:照它做 ⇒ 一輪寄出上百封不可回收的信。
 */
/**
 * 🔴🔴 **取消信(`order_cancelled`)—— 刷卡且【已全額退款】的整單取消。**
 *
 * 🛑 **它與下面那支 `EnqueueOrderUnpaidCancelledEmailInput` 是【兩支】, 而欄位逐格相同**:
 * ```
 * order_cancelled         = 刷卡 + payment_status='refunded' + 整單取消   ← 本支
 * order_unpaid_cancelled  = 未付款的單被取消                              ← 下面那支
 * ```
 * ⇒ 📌 **eventType 是唯一分得出它們的欄位, 而它是字面** —— 打錯一個字,
 *    型別會叫(discriminated union), **而【import 錯 use-case】不會叫。**
 *
 * 🔵 射程是 Sean 2026-09-02 拍甲(`20260903040000:96-98` 記著):**不涵蓋匯款/現金的單,
 *    也不涵蓋部分退款**(`partiallyRefunded` 是另一個值)。
 *    掃描面 = `public.pcm_cancelled_email_pending`(`20260905310000`), 述詞逐條在那支 view 的 COMMENT。
 */
export type EnqueueOrderCancelledEmailInput = EnqueueEmailInputBase & {
  eventType: 'order_cancelled';
  /** 取消時刻(事件時點快照)。 */
  cancelledAt: string;
  /** 🔴 退款金額(enqueue 當下的快照)—— 與 `payment_status` 判定同源, 見 view 的 COMMENT。 */
  refundedAmount: number;
  /** 🔴 `'full'` | `'partial'`;算出來的。`sweep` 只在 `'full'` 時印退款那一段。 */
  refundKind: string;
  /**
   * 取消理由。🔴 **它會原封進到客人眼前** ⇒ 落表邊界一律過 `sanitizeCustomerFacingReason`。
   * 🔵 `null` = 沒有理由 ⇒ 信裡那一段不印。
   */
  cancelledReason: string | null;
};

export type EnqueueOrderUnpaidCancelledEmailInput = EnqueueEmailInputBase & {
  eventType: 'order_unpaid_cancelled';
  /** 取消時刻(事件時點快照)。 */
  cancelledAt: string;
  /**
   * 員工選的理由(七值之一;`other` 時是他打的自由文字)。
   * 🔴 **它會原封進到客人眼前** ⇒ 落表邊界一律過 `sanitizeCustomerFacingReason`(整形只管形狀不管語意)。
   * 🔵 `null` = 沒有理由 ⇒ 信裡那一段不印(而不是印一個空白或 `null`)。
   */
  cancelledReason: string | null;
};

/**
 * 🔴🔴 **更正貨運單號的通知信**(⟦5b-TRACKNUMGAP1⟧ 片 C;Sean 2026-09-04 拍甲)。
 *
 * 🔴 **`dedup_key` = 箱 + 單號** —— 而那是拍板的形狀不是實作方便:
 *    主視窗 2026-09-04 拍【乙】, 理由逐字 **「客人要的是【哪一個號碼是對的】, 不是【你改過幾次】」**
 *    ⇒ 同一個單號值只寄一次;連改兩次(A→B→C)**只寄到 C**。
 *    ⚠️ 而它與 `order_shipped` 用 `shipment_id` 當前半**不同** —— 那條是「一箱一封」,
 *    本條是「一個值一封」。**兩者不可互抄。**
 *
 * 🛑 **上線第一秒的陷阱**(`ITrackingCorrectedScanner` 檔頭全文):更正信歷史上一封都沒寄過
 *    ⇒ 差集的「已排過」那一半恆為空 ⇒ **每一箱都長得像該寄** ⇒ **`cutoff` 是必填。**
 */
export type EnqueueShipmentTrackingCorrectedEmailInput = EnqueueEmailInputBase & {
  eventType: 'shipment_tracking_corrected';
  /** 箱 uuid。`dedup_key` 的前半, **也進 payload**(理由同 `order_shipped` 那一格:它不可變)。 */
  shipmentId: string;
  /** 箱號(進 payload;收信人分辨「哪一箱」的唯一依據)。 */
  shipmentReference: string;
  /**
   * **更正後**的貨運單號 —— 這封信的**全部內容**(進 payload)。
   * ⛔ ~~「`dedup_key` 的後半」~~ **2026-09-04 起不是了**, 見下面那一欄。
   */
  trackingNumber: string;
  /**
   * **這一次更正的時點**, 由 SQL 算成一個 20 位數字串(UTC、到微秒、零分隔符)。
   *
   * 🔴🔴 **它是 `dedup_key` 的後半, 而【號碼】不是**(主視窗 2026-09-04 拍 Q1 甲)。
   *    ⛔ 舊做法用號碼當鍵, 而 codex 對抗審查抓到它的漏:
   *      A→B(寄過)、B→C(寄過)、**再改回 B** ⇒ 舊的 B 鍵還在 ⇒ 最新那封永遠不寄,
   *      而客人手上那封說的是 C。
   *    ⇒ 原拍板的理由「客人要的是哪一個號碼是對的」在 A→B→C 完全成立 ——
   *      **它沒涵蓋【改回去】。**
   *
   * 🛑🛑 **這個字串一定要原樣從掃描面帶過來, 不准在 TS 這邊由時間算出來。**
   *    SQL 與 TS 各格式化一次是最容易漂的做法(時區 / 小數位 / T 或空白 / 偏移寫法),
   *    而漂掉的症狀是**同一封信寄兩次**, 不是報錯。
   *    ⇒ 所以只有 SQL 格式化:`pcm_tracking_corrected_at_key(timestamptz)`,
   *      view 把它當成一欄(`corrected_at_key`)回出來, 這裡只負責接。
   */
  trackingCorrectedKey: string;
};

export type EnqueueEmailInput =
  | EnqueueOrderCreatedEmailInput
  | EnqueueOrderShippedEmailInput
  | EnqueueOrderCancelledEmailInput
  | EnqueueOrderUnpaidCancelledEmailInput
  | EnqueueShipmentTrackingCorrectedEmailInput;

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
  claimDue(
    limit: number,
    /**
     * ⟦b4-SHIPGATE1⟧ 2026-09-01:**不要認領這些事件型別。**
     *
     * 🔴 **為什麼要在【認領】這一層擋,而不是認領完再判**:
     *    `sweep-email-outbox.ts:750` 那道 `allowOrderShipped` 閘擋在 `claimDue` **之後** ⇒
     *    線關著的期間,佇列裡的 `order_shipped` 列**每一輪都被認領一次**
     *    (`attempts` 在認領當下就 +1、狀態落 `sending`;`SupabaseEmailOutboxAdapter.ts:395`),
     *    被擋下、`continue`(不呼叫任何 `mark*`)⇒ **留在 `sending`**。
     *    而 `sending` **不在** `CLAIMABLE_STATUSES`(`['pending','failed']`)⇒ 下一輪撿不到
     *    ⇒ 唯一出路是 `reclaimStaleLeases`(`claimed_at < now − LEASE_SECONDS`,route 端 3600 秒)
     *    ⇒ **每【回來一次】≈ 1h05m(租約 3600 秒 + 退避 5 分)**
     *    🔴 **而【attempts 用完】與【進死信】差一整輪回收, 不要合成一句**(codex R2 2026-09-01):
     *       `t≈4h20m` 第 5 次認領 = attempts 用完 · `t≈5h20m` 才成 `failed@max` ⇒ 進死信。
     *       ⇒ 全文推導在 `sweep-email-outbox.ts` 的 `allowOrderShipped` 那道閘旁邊。
     *    ⚠️ 另一半:它們**佔著 `claimLimit` 的格子**(route 端 50)⇒ 拖慢 `order_created`。
     *
     * 🛑 **選擇性 —— 而那是承重的**:既有呼叫端一個字都沒改,
     *    **未給 / 空陣列 ⇒ 送出的查詢與改動前逐位元相同**(不得多一個空的 `not in`)。
     *
     * 🔵 **而它【不取代】`:750` 那道閘** —— 不認領是**省成本**,不寄是**保正確**。
     * 🛑🛑 **而我第一版寫「旗標讀取邏輯壞掉時第二道還在」—— 那句是【假的】**(codex 2026-09-01):
     *    **兩道都由同一顆 `allowOrderShipped` 驅動** ⇒ 旗標讀錯的那個世界裡,**兩道一起錯**。
     *    ✅ 正確字面:第二道守的是「**實作違約**」——
     *    adapter 忽略這個 opts、或有人換一個沒實作它的 `IEmailOutbox`。
     *    ⇒ **⇒ 它不是「同一個輸入的第二次判斷」(那才是重複),是【另一個失效來源】。**
     */
    opts?: { readonly excludeEventTypes?: readonly EmailOutboxEventType[] },
  ): Promise<ClaimedEmailJob[]>;

  /** 對指定列 CAS 認領(E3 after() 立即嘗試路徑)。非 due / 搶輸 / 已達上限 → null。 */
  claimById(id: string): Promise<ClaimedEmailJob | null>;

  /**
   * `sending → sent`(寫 sent_at、清 claimed_at)。claimedAttempts = 認領時拿到的世代 token;
   * false = 所有權已失(lease 被回收/他人接手),**不得**重試覆寫。
   */
  /**
   * 🔴🔴 **第三個參數 `sentTrackingNumber` —— ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 片 B-1。**
   *    它是**這一封信實際印在紙上的那個號碼**, 由呼叫端在**寄出的那一刻**交進來。
   *
   *    ⚠️ **為什麼不是「寄完再另發一次 update」**:那中間有一個窗, 而
   *    📌 **一個修競態的修法自己帶一個競態, 是本片最不該做的事。**
   *    ⇒ 它與 `sent_at` **同一發 update** 落表。
   *
   *    ⚠️ **為什麼不放 payload**:payload 是 **enqueue 時點**的快照(那一格的註解逐字
   *    「事件時點不可變」), 而這個值是 **send 時點**的事實 —— **兩個時點不是同一件事**。
   *
   *    🔵 **`null` 的意思是「這一封沒有帶號碼」** —— 不是「不知道」。
   *    對 `order_shipped` / `shipment_tracking_corrected` 以外的事件恆為 `null`;
   *    而出貨信在**那一箱還沒有號碼**時也是 `null`(那是合法狀態, 見 `IShippedEmailContext` 的
   *    「沒有碼走 `trackingNumber: null`, 不是 `unavailable`」)。
   *    🛑 **⇒ 讀它的人要分得出「null = 沒帶號碼」與「這一列還沒被寫過」** ——
   *      後者在 DB 上也是 NULL, 而**過渡期(欄剛加、寫入端還沒上)整張表都是後者**。
   */
  markSent(
    id: string,
    claimedAttempts: number,
    sentTrackingNumber: string | null,
  ): Promise<boolean>;

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
   * (migration §⑧);「哪些訂單狀態算 ineligible」= E2a-2 定案、gate 正確性是該片的責任。
   */
  markSkippedOrderIneligible(id: string, claimedAttempts: number): Promise<boolean>;

  /**
   * `sending → skipped_order_ineligible`,而 `last_error_code = 'order_ineligible_at_send'`
   * (⟦b4-MAILCANCEL1⟧;付款信在**寄送當下**去撈脈絡,發現**這張單已經被取消**)。
   *
   * 🔴 **為何是新方法、不是複用 `markSkippedOrderIneligible`(= 擴充 port,不是繞過 port)**:
   *    那支 adapter **內部寫死** `last_error_code: 'order_ineligible'`,而
   *    `IPaidEmailContext.ts:213-216` 逐字裁過(主視窗 2026-08-24 拍【乙】):
   *    「沿用會讓上游那道閘變成**看不見的** —— 我們正要在它下游補一層,
   *      補完之後沒有人知道**它還有沒有在做事**。那是把問題換個地方藏。」
   *    ⇒ 兩層落同一個碼 ⇒ port 要的那個**比值**永遠算不出來。
   *
   * 🔵 **狀態值沿用 `skipped_order_ineligible` 是刻意的, 而它零 migration**
   *    (`IPaidEmailContext.ts:208-211` 逐字:DB 六態 CHECK 白名單已含它、
   *     而 `last_error_code` 是 pattern `^[a-z0-9_]{1,64}$` 不是 enum)。
   *    ⇒ 📌 **分得開的是【碼】不是【態】** —— 要算那個比值請查 `last_error_code`。
   *
   * ⚠️ **而這個碼存在的理由是【比例】不是【單筆】, 而那筆欠帳是明寫的**
   *    (`IPaidEmailContext.ts:218-223`):`order_ineligible_at_send` 與
   *    `order_ineligible` 的**比值上升** ⇒ 上游那道閘落後了 / 那道 race 常常輸。
   *    🔴 **而今天沒有人在看這個比值** —— 那是欠帳, 不是漏做。
   */
  markSkippedOrderCancelled(id: string, claimedAttempts: number): Promise<boolean>;

  /**
   * `sending → skipped_shipment_voided`(M-4b E4 片3a:出貨通知信在寄送當下去主表撈脈絡,
   * 發現**這一箱已被作廢**)。
   *
   * 🔴 **`voided` 是【正常業務動作】,不是錯誤** —— 裝箱**數量**打錯的唯一補救就是整箱作廢重開
   * (`20260805170200` COMMENT、Sean `Q-a`=C)⇒ 不罕見。
   * ⇒ 呼叫端:**不寄、落這一態當痕跡、不計 error**。
   * ⚠️ 計成 error 的話,`errors>0` ⇒ route 回 503 ⇒ 燒 attempts 進死信 ⇒ 訊號 2 每日告警
   * ⇒ **有人半夜起來查一件正常的業務動作**(`IShippedEmailContext` 檔頭的失敗鏈全文)。
   *
   * 🔴 **為何是新方法、不是複用 `markSkippedOrderIneligible`(= 擴充 port,不是繞過 port)**:
   * 那一態的意思是「**訂單**已退款/取消」,而本態是「**這一箱**被作廢,訂單好好的」。
   * 合併之後,稽核時「這封為什麼沒寄」會得到一個**錯的答案**,而那個答案讀起來完全合理。
   * ⚠️ 而它也不能塞進 `markFailed`:那支的 runtime allowlist 會把碼改寫成 `provider_error`
   * ⇒ 稽核碼被靜默吃掉(同 `lease_reclaimed` 的理由,見下)。
   *
   * 必寫 `last_error_code='shipment_voided'` 供稽核(碼由 adapter 內部寫死,
   * 不經 `EmailSendErrorCode` union —— 它不是一次「寄送失敗」)。
   * 🔴 **不進 due、不被任何 dead-man 訊號命中 = 預期內的正確靜默**(五訊號皆正向列舉
   * `pending`/`failed`/`sending`,2026-08-30 實查;覆蓋驗證見
   * `scripts/email-outbox-state-coverage.sh`)。
   *
   * ── 🔴🔴 **它是【可翻轉態】,不是不可翻轉終態 —— 而這句是被 codex 打掉重寫的** ──────
   * ~~原文:「🔴 不可翻轉終態」+「⚠️ 它不影響同一張訂單的其他箱:dedup_key =
   * `{shipment_id}:{order_id}` ⇒ 作廢後重開的新箱是新的 shipment_id = 新的一列」~~
   * ⇒ **那兩句【各自都是真的】,而它們合起來支持的那個結論是假的。**
   *
   * **反例(2026-08-30 codex 抓、作者逐格複核)**:
   * ```
   * ① 20260807210000_..._unvoid_shipment.sql:151-152 逐字
   *      UPDATE public.shipments SET deleted_at = NULL, void_reason = NULL
   *    ⇒ 作廢是【可以復原的】, 而復原的是**同一列、同一個 shipment_id** ⇒ 同一個 dedup_key
   * ② 20260822010000_..._shipped_email_scan_view.sql:260 逐字(那支檔自己寫的)
   *      「🔴🔴 這個 anti-join 只看『那一列存不存在』, 【不分 status】」
   *      :290「一列 failed 也會讓那個 (箱,單) 被永久排除」
   * ⇒ 箱作廢 → 落這一列 → 員工復原箱 → **那一列永遠擋著 enqueue**
   *   ⇒ 那位客人【永遠收不到出貨信, 而沒有任何一格會紅】
   * ```
   * 📌 **而原文那句「不影響同一張訂單的其他箱」是對的 —— 它回答的是【別的箱】;
   *    真正會出事的是【同一箱被復原】,而作者沒有問那個問題。**
   * 🔴 **這一次的形狀更毒**:那段話**讀起來像是作者已經考慮過鄰近風險了**
   *    ⇒ **它會讓下一個審查的人跳過那一格。**
   *
   * ⇒ **正確的分類:可翻轉態,與 `skipped_no_real_email` 同一類。** 而 repo 裡**早就有一份答案**,
   *   住在那個相鄰的態上(`email_outbox.status` 的 COMMENT 逐字):
   *   「它佔住唯一鍵…須以**受控 UPDATE 原地翻回 pending**、不可新 INSERT(會撞唯一鍵 =
   *   **該 cohort 永久漏信**);且不得自動回灌。」
   *
   * 🛑🛑 **而【誰去翻它】今天沒有人做 ⇒ 這是一個【已知的漏信面】,不是留白**:
   *   `admin_unvoid_shipment` 那條路今天**完全不碰 `email_outbox`**(跨邊界)。
   *   ⇒ 在那條路接上之前:**箱被作廢過再復原的那一批,出貨信不會補寄。**
   *   ⇒ 那一格要**單獨開一列**追蹤,不吞進本片(本片只負責讓這個狀態【有地方落】)。
   *   🔴 **而那一列【今天還不在板上】**(codex R2 抓到:搜 `STATUS.md` 與全部 `docs/` 找不到它)——
   *     擬好的字面已交 `-b9`(板子的單一寫者):`~/pcm-mailbox/線D-給b9-新增一列-unvoid補寄-20260830.md`。
   *   📌 **在它真的上板之前,這裡不得寫成「已追蹤」** —— 那句話的作用是**關掉下一個人的尋找動作**,
   *     而現在能被找到的只有那份交件檔。(同族:本片作者今天已經在「已列進待決」上犯過一次。)
   */
  /**
   * 🔴 **`currentDedupKey` 是 2026-08-31 ⟦b4-SHIPUNVOID1⟧ 加的,而它承重**:
   *    實作要在**標記 skip 的同一發 UPDATE 裡**把這把鍵退休(加後綴),否則會有一個
   *    **沒有任何東西會叫**的漏信:箱作廢 ⇒ 這一列以正規鍵落地 ⇒ 員工用同一個
   *    shipment id 復原 ⇒ 掃描 view 的 anti-join(`20260822010000:275`)**不分 status**
   *    ⇒ 那一列永久佔住鍵 ⇒ **那位客人的出貨信永遠不會排進去**,而狀態是「跳過」不是
   *    「失敗」⇒ 不進 due、不被任何 dead-man 命中。
   * 🔴 **為什麼一定要在【同一發】裡**:分成兩步(先標 skip、再退休)的話,
   *    「先 unvoid 後 skip」那個交錯順序會讓退休撲空 —— 而那個順序**實測可達**
   *    (`scripts/shipunvoid1-apply-probe.sh` 的 W4,負對照 W4b 印不同的值)。
   *    ⇒ 📌 **原子性是免費的:那一發 UPDATE 本來就存在,只是多帶一個欄位。**
   */
  markSkippedShipmentVoided(
    id: string,
    claimedAttempts: number,
    currentDedupKey: string,
  ): Promise<boolean>;

  /**
   * 🔴🔴 **寄送當下發現那個單號【已經被更新過了】⇒ 跳過, 而不是寄一封錯的更正信。**
   *    (⟦5b-TRACKNUMGAP1⟧ 片 C;主視窗 2026-09-04 拍【甲】。)
   *
   * ══ 它防的是什麼 ═══════════════════════════════════
   * 掃描器是 cron ⇒ enqueue 到寄出之間有一段時間。員工在那段時間裡又改了一次(A→B→C):
   * B 那一列的 payload 帶著 B ⇒ 它會寄出一封說「正確的貨運單號:B」——**而那時候正確的是 C**。
   * 🛑 **那封信裡還寫著「請以這一封為準」** ⇒ 客人拿到一個**被我們背書過的錯號碼**, 而信收不回來。
   *
   * 🔴 **而它【不是靜默跳過】**(主視窗同一則補的):跳過本身要留一筆看得見的紀錄,
   *    否則只是把靜默從「客人那端」搬到「我們這端」—— **客人不會收到錯的信了, 而我們一樣不知道發生過。**
   *
   * 🔵 **為什麼不新增一個 status**:`email_outbox_status_check` 是 DB 白名單(改它要一支 migration),
   *    而 `markSkippedOrderCancelled` 已經立過先例 —— **status 是分類桶, 真相住在 `last_error_code`**
   *    (它只有格式 CHECK `^[a-z0-9_]{1,64}$`, 沒有值域白名單)。⇒ 照抄那個形狀, 不多開一支 migration。
   *
   * 🔴 **而 `dedup_key` 要退休** —— 理由與 `markSkippedShipmentVoided` 那一格**不同**:
   *    那條是「這一箱作廢了」;本條是「A→B→C→**又改回 B**」那個交錯 ——
   *    不退休的話 B 那把鍵永久佔住 ⇒ **改回 B 時那封信排不進去, 而沒有任何東西會叫。**
   */
  markSkippedTrackingSuperseded(
    id: string,
    claimedAttempts: number,
    currentDedupKey: string,
  ): Promise<boolean>;

  /**
   * lease 回收:把「認領後程序才死」而卡在 `sending` 的列翻回**可重試的 `failed`**
   * (Sean 2026-07-17 拍 **Q2=A**:落 `failed`、非 `pending`)。回傳實際回收的列數。
   *
   * 🔴 **為何是新方法、不是複用 `markFailed`(= 擴充 port,不是繞過 port)**:
   * - 回收器**不是 lease 持有者**、手上沒有 `claimedAttempts` → 上面三個 mark* 的世代柵欄
   *   `.eq('attempts', claimedAttempts)` 在此**無值可帶**,簽章物理上接不上。
   * - `lease_reclaimed` **不是 `EmailSendErrorCode` 成員**(它不是「寄送失敗」、是「本地程序死」)
   *   → 硬塞進 `markFailed` 會被其 runtime allowlist **改寫成 `provider_error`**,Q2=A 要的稽核碼
   *   被靜默吃掉。故該碼由 adapter **內部寫死**(形同 `markSkippedOrderIneligible` 的
   *   `order_ineligible`),不經本 union。
   *
   * 🔴 **所有權判定 = CAS 述詞本身**(`status='sending' AND claimed_at < staleBefore`),不需世代
   * 柵欄:述詞一旦不成立(列已被原持有者標記完成/已被別的回收器搶先)→ 0 列 = 沒回收到。
   *
   * 🔴 **`attempts` 一律不動**(認領時已 +1、單調遞增是世代 token 的前提)。故回收後可能是
   * `failed@max` = 死信 → 由 dead-man **訊號 2**(`status IN ('pending','failed') AND
   * attempts >= max_attempts`)命中,零盲區。⚠️ **Fable 實測的「第四種死法 `pending@max` 隱形死列」
   * 在 Q2=A 下不可達**——它的前提是回收翻回 `pending`。
   * 🔴 **權威落點 = migration `20260717020000` 頭註 §⑩**(§⑦ 那條「E2a 定案回收落點時必須回頭過
   * 訊號表」義務的履行處;漂移以 §⑩ 為準)。⚠️ 本段是**摘要、不是權威** —— 前版寫「此即回頭結論」
   * 而未回寫 migration = 假字面(關卡2 code-reviewer + Fable 雙審獨立命中):plan §3.6 自寫「漂移以
   * migration 為準」→ 結論只寫 TS JSDoc 會被下一片實作者依仲裁序丟棄,照 §⑦「回收翻回 pending」的舊字面實作
   * 「回收翻 pending」→ 重開本方法要關的洞。
   *
   * 🔴 **`staleBefore` 的安全下界是 caller 的責任**(lease 長度不由本 port 決定):必須**大於
   * sweeper 單輪最長可能執行時間**,否則會把**還在途**的列判成 stale → 原持有者仍會寄出、列已被
   * 翻回 failed → 再次認領 → **重複寄信**(只剩 Resend 24h Idempotency-Key 兜)。
   * ⚠️ 另須含**跨 instance app 時鐘偏差**餘裕(關卡2 Fable F2):`claimed_at` 由**認領方的 app 鐘**寫
   * (adapter 內 `new Date()`)、`staleBefore` 由**回收方的 app 鐘**算 → 兩者非同一台機器時,偏差直接
   * 吃掉 lease 餘裕。plan §3.6 的 lease ≥1h 量級下實害趨零,但取值不得逼近 route `maxDuration`。
   *
   * @param staleBefore `claimed_at` 早於此刻的 `sending` 列才回收(= now - lease)。
   * @param nextRetryAt 回收後的下次重試時間(退避策略由 caller 算,與 `markFailed` 同慣例)。
   */
  reclaimStaleLeases(staleBefore: Date, nextRetryAt: Date): Promise<number>;
}
