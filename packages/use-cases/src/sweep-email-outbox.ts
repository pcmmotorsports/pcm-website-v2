import type {
  ClaimedEmailJob,
  IEmailOutbox,
  IEmailSender,
  IIneligibleOrderEmailScanner,
  IPaidEmailContext,
  IShippedEmailContext,
  LoadPaidContextResult,
  LoadShippedContextResult,
  PaidEmailContext,
  SendEmailInput,
  ShippedEmailContext,
} from '@pcm/ports';
import { SUPPRESS_WHEN_ORDER_INELIGIBLE } from '@pcm/ports';
import {
  subtotalLabelOf,
  PCM_REMITTANCE_BANK_NAME,
  PCM_REMITTANCE_BRANCH,
  PCM_REMITTANCE_ACCOUNT_NAME,
  PCM_REMITTANCE_ACCOUNT_NO,
  PCM_REMITTANCE_MEMO_INSTRUCTION,
  remittanceDeadlineSentence,
} from '@pcm/domain';
import {
  assertPdfClaimMatchesAttachments,
  paidEmailOrderUrl,
  renderPaidEmailHtml,
} from './paid-email-html';
import {
  formatOrderAmount,
  orderAmountsBalance,
  ORDER_CANCELLED_HEADLINE_NO_ID,
  ORDER_LINE_TITLE_MISSING,
  ORDER_CANCELLED_HEADLINE_WITH_ID,
  ORDER_CANCELLED_REFUNDED_SENTENCE,
  ORDER_CONTACT_LEAD,
  ORDER_MEMBER_CENTER_SENTENCE,
  ORDER_PAID_NEXT_STEP_SENTENCE,
  ORDER_UNPAID_CANCELLED_NO_CHARGE_SENTENCE,
  PCM_COMPANY_ADDRESS,
  PCM_COMPANY_LINE,
  PCM_LINE_ID,
  PCM_LINE_URL,
  sanitizeCustomerFacingReason,
} from './order-email-copy';
import {
  computeEmailBackoff,
  LEASE_RECLAIM_RETRY_DELAY_MS,
  type EmailBackoffRandom,
  isQuotaExhaustionCode,
} from './email-backoff';

/**
 * sweepEmailOutbox:交易信 outbox sweeper use-case(M-4a Email 片 E2a-b;plan v3.3 §3.5/§3.6/§5)。
 *
 * 週期觸發(E2a-c route → E2b pg_cron 每 5 分鐘;🔴 不走 Vercel cron)→ 三段固定順序:
 * ```
 * ① lease 回收(claim 前必跑;migration §⑩):stale sending → failed + 'lease_reclaimed'
 * ② claimDue(CAS 認領、attempts < max guard 在 port 內建)
 * ③ 逐封順序寄送 → sent → markSent / failed → markFailed(退避 = email-backoff:§⑨ 三列+plan §5 兜底)
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - 🔴 **零告警**(Sean Q13=A):五訊號全歸 E2a-2 獨立管道 —— sweeper 死時它發的告警一起死,
 *   自我監看=沒有監看。本 use-case 只回 counts,判讀交給獨立 cron。
 * - 🔴 **at-least-once、不宣稱不重複**(E2a-a codex 擊破「擊不破」後的正確定性):Resend
 *   Idempotency-Key 只保 24h → 「已送出未 markSent → 回收 → 停擺 >24h → 重送」的第二封會真的
 *   寄出 = 極窄非零重複率(Sean S3 認可)。
 * - 🔴 lease 下界 = **物理擋**(E2a-a 義務;codex 關卡2 R1 must-fix 後收緊):單一常數門檻
 *   證明不了 port 要求的「lease > 單輪最長執行時間 + 時鐘偏差」→ caller 必須申告
 *   `maxRunSeconds`(= 執行環境的硬性 kill 上界,E2a-c 即 route `maxDuration`;單輪真正的
 *   物理上界是**平台 kill**,不是本迴圈自己)並通過 `leaseSeconds ≥ max(3600,
 *   maxRunSeconds + 時鐘偏差餘裕)` 驗證,違反直接 throw;迴圈另設時間預算(**比
 *   `maxRunSeconds` 早 `SEND_TAIL_ALLOWANCE_SECONDS` 秒**就停止寄送、剩餘已認領列計
 *   `deferred`;⟦b4-SWEEPBUDGET1⟧ 2026-08-30 改 —— ~~原字面「超過 `maxRunSeconds` 停止寄送」~~
 *   已不是現況)= 對「平台沒殺」情境的縱深,
 *   ⚠️ 但**擋不住單一 await 懸掛**(懸掛只能靠平台 kill 收拾 → 列卡 sending → 下輪回收)。
 *   太短的 lease 會把在途列判 stale → 原持有者仍寄出 → 重複寄信。
 * - 單封 fail-closed(鏡像 `sweepSettlements`):sender 合約不 throw,若仍 throw(合約違反)或
 *   mark* DB 錯 → 計 error、**不補救不重標**,列留 sending 由下輪 ① 回收 = 安全可恢復。
 * - 順序寄送(concurrency 固定 1):量級 10-30 封/日、Resend 限流保守值 5 req/s → 無並發需求;
 *   維持順序天然不撞限流,也免掉 `sweepSettlements` 的 runBounded 複雜度。
 * - 零 PII:result counts-only;`recipientEmail` 只進 `sender.send` 的 `to`,不進 log/result/錯誤
 *   訊息;內文只用 payload 內非 PII 欄(display_id)。
 *
 * @see supabase/migrations/20260717020000_m4a_email_outbox.sql §⑦/§⑨/§⑩
 * @see docs/specs/2026-07-16-m4a-email-notify-plan.md §3.5/§3.6/§5
 */
export type SweepEmailOutboxDeps = {
  outbox: IEmailOutbox;
  sender: IEmailSender;
  /**
   * 出貨通知信的**寄送時讀取**(M-4b E4-b;`IShippedEmailContext`)。
   *
   * 🔴 **選用,而「不給」是一個【有意義的狀態】,不是尚未接線的預設值**:
   * 不給 ⇒ `order_shipped` 維持今天的 fail-closed(`buildEmailText` 對它 throw)⇒ **一封都不寄**。
   * ⇒ 這一欄存在**不會讓任何東西被寄出去**;真正打開那道閘的是 `buildEmailText` 的 case(片3)。
   *
   * 🔴 **為什麼是 port 不是把資料塞進 payload**(那支 port 的檔頭有完整理由,這裡只留判別句):
   * 追蹤碼與品項是**可後台改的欄** ⇒ 入列當下凍住的值,員工改過之後就是舊的,
   * 而**信寄出去收不回來**。⇒ 寄送當下才查主表。
   */
  shippedContext?: IShippedEmailContext;
  /**
   * 🔴🔴 **寄送前的合格性讀取(Sean 2026-08-30 拍「Q2 取消信縫 = 甲 搬」)。**
   *
   * **為什麼是必填、不是選用**:這是一道「不該寄的別寄」的閘。選用 ⇒ 忘了注入時
   * 它會**安靜地全部放行**,而那個世界與「全部都合格」在 counts 上長得一模一樣。
   * ⇒ 一道 fail-open 的閘,比沒有閘更糟:它會讓人以為裝上了。
   *
   * **它取代了什麼**:`applyOrderIneligibleGate` 那支獨立 cron 只**縮小**窗口、沒有關閉它
   * (那支 route 的檔頭自己逐字寫著「不得宣稱本片堵住了這個洞」)——
   * 兩支各自獨立的排程之間沒有誰先誰後的保證。
   * ⇒ 搬進來之後,讀合格性與寄送在**同一個 process、同一輪迴圈**裡。
   *
   * ⚠️ **而它把窗口關到毫秒級,不是關到零**:讀完到 `sender.send` 之間仍有間隔。
   *    ⇒ 不得宣稱「這個洞補起來了」。那支獨立 cron **留著**(它擋的是還沒被認領的列)。
   */
  ineligibleScanner: IIneligibleOrderEmailScanner;
  /**
   * 付款成功通知信的**寄送時讀取**(M-4b 片2;`IPaidEmailContext`)。
   *
   * 🔴 **選用,而「不給」是一個【有意義的狀態】,不是尚未接線的預設值**:
   * 不給 ⇒ `order_created` 維持**今天的行為** —— 寄那封 6 行純文字信,POST body 逐位元不變。
   * ⇒ 這一欄不會讓任何一封信【停寄】;真正會停寄的是它給了之後的 `unavailable` 那一態。
   *
   * 🔴🔴 **而給了它之後,一些今天收得到信的單會從此收不到** —— 那是 port 明文要的行為:
   * 撈不到金額 ⇒ fail-closed 不寄、計 error(理由:一封金額是 0 的付款確認信,
   * 客人看不出是系統壞了還是他被多收了)。
   * ⇒ 📌 **而那個代價只有在信裡真的有金額時才划算** ⇒ 所以本片把「拿資料」與「放進信裡」
   *   放在同一顆 commit。只做前半的話,那些單會從「收得到純文字」變成「一封都收不到」。
   *
   * 🔴 **為什麼是 port 不是把資料塞進 payload** —— 而原句要照原文,不要自己收斂:
   * `IEmailOutbox.ts` 那段引 `order-email-assembly.ts:12` 的設計意圖,逐字是
   * 「品項/金額/地址等渲染資料**寄信時即時查主表**」+「**可後台改的欄**(如 `shipping_method`)刻意不存」。
   * ⛔ ~~我第一版寫成「金額與品項是可後台改的欄(`IEmailOutbox.ts:134` 逐字)」~~ ——
   *   **兩處都錯**(code-reviewer 2026-09-01):`:134` 是 `| 'provider_error';`,原文在 `:153`;
   *   而原文**沒有**「金額與品項是可後台改的欄」這一句 —— 那是我把兩句併成一句。
   * ⇒ 📌 而併句子的代價在這裡具體是:原文的例子是 `shipping_method`,而我把它改成了金額,
   *   **下一個人會去找「金額在哪裡可以被後台改」而找不到**。
   * ⇒ 不論如何,結論不變:入列當下凍住的值在員工改過之後就是舊的,而**信寄出去收不回來**。
   */
  paidContext?: IPaidEmailContext;
};

/**
 * 參數由 route(E2a-c)顯式注入(鏡像 `sweepSettlements` 慣例、不設預設值)。
 * - `claimLimit`:每輪認領上限(port `claimDue` 語意=認領上限、死列不佔窗)。
 * - `maxRunSeconds`:單輪執行時間的**硬性上界申告**(E2a-c = route `maxDuration` 字面;平台在
 *   此時限 kill function = 單輪最長執行時間的物理保證來源)。兼作迴圈時間預算(見檔頭)。
 * - `leaseSeconds`:lease 長度(秒)。🔴 硬下界 = **max(3600, maxRunSeconds + 時鐘偏差餘裕 300)**
 *   (plan §3.5-4「lease ≥1h」+ port「> 單輪最長執行 + 跨 instance 偏差」;違反 = throw)。
 * - `now` / `random`:測試注入縫(production 省略 = 系統鐘 + Math.random)。
 */
export type SweepEmailOutboxOptions = {
  /**
   * 顧客站網址(給信裡「會員中心」那句附連結用;Sean 2026-09-03 勾 A4)。
   *
   * 🔴 **選填, 而【缺了就不印連結】不是印一個壞的** —— 一顆連到空網址的按鈕比沒有按鈕糟。
   * ⚠️ 本 use-case **不讀 env** —— 值由 route 那側 `resolveSiteUrl()` 傳進來,
   *    否則這支純函式就得知道自己跑在哪個 app 裡。
   */
  siteUrl?: string;
  /**
   * 🔴🔴 **出貨通知信這條線【上膛了沒】**(codex 2026-08-30 R1 must-fix 1)。
   *
   * **它擋的是什麼**:`SHIPPED_EMAIL_CUTOFF` 只擋得住 **enqueue**(排信那一半)——
   * 而 outbox 裡若**已經有** `order_shipped` 的 `pending` / `failed` 列
   * (上一次有設過 env、手動 DB 寫入、或任何我們沒想到的路),
   * **sweeper 每五分鐘照樣把它們寄出去,而 env 現在是關的。**
   * ⇒ 📌 我原本寫的「env 沒設 ⇒ 一封都不寄」**是假的** —— 它只對「還沒排進去的」成立。
   *
   * 🔴 **為什麼是必填、不是 `?: boolean`**:
   * ```
   * 選用而預設 true  ⇒ fail-open：忘了傳就開始寄，而那正是這一欄要防的
   * 選用而預設 false ⇒ fail-closed 而【安靜】：忘了傳就永遠不寄，counts 全 0，沒有東西會吵
   * ```
   * ⇒ **兩種預設都有一個安靜的錯法** ⇒ 讓型別逼每個呼叫端自己答一次
   *   (同 `ineligibleScanner` 必填的理由)。
   *
   * `false` ⇒ `order_shipped` 走**片3b 之前的那條路**:不寄、計 error、列留 sending。
   * ⚠️ 而**計 error 是刻意的**:線關著而佇列裡有列 = 有事情不對,應該吵。
   */
  allowOrderShipped: boolean;
  claimLimit: number;
  /**
   * 🔴🔴 **這一輪【平台的碼表】是什麼時候按下去的**(`⟦b4-SWEEPBUDGET1⟧`,2026-08-30)。
   *
   * **要修的是什麼**:時間預算原本從 `sweepEmailOutbox` **自己**開始起算,而 route 在它前面
   * 已經跑了兩段 enqueue(訂單成立 + 出貨)⇒ 這個迴圈以為自己還有滿滿 `maxRunSeconds`,
   * 實際上平台的 60 秒已經被吃掉一部分。
   * ⇒ 平台可能在 `sender.send` 已被 Resend 接受、`markSent` 還沒寫下去的那一格 kill
   * ⇒ 列留 `sending` ⇒ 下輪回收 ⇒ ⛔ ~~**重寄**(Resend 的 Idempotency-Key 只保 24h)~~
   *
   * 🔴🔴 **[2026-08-30 深夜 自我更正:上面那個「重寄」【寫得太重】]**
   *    套用「這一輪跑完之後那一列處在哪個狀態?下一輪還撿不撿得到它?」這把尺:
   *    ```
   *    列停在 sending ⇒ claimDue 只收 ['pending','failed'] ⇒ 下一輪【撿不到它】
   *    要等回收，而回收條件是 claimed_at < now − LEASE_SECONDS(3600) ⇒ 一小時
   *    回收後 next_retry +5 分鐘 ⇒ 重新送出大約在【65 分鐘後】
   *    而 Resend 的 Idempotency-Key 保【24 小時】⇒ 那一發會被 provider 去重
   *    ```
   *    ⇒ ✅ **正確字面:真正的傷害是【燒掉一次 attempt】+【那一列一小時內不會再被處理】,
   *      而「客人收到兩封」只有在 sweeper 停擺【超過 24 小時】時才成立**
   *      —— 本檔檔頭 `:31` 逐字早就寫著那個條件,而我寫這一段時沒有把它接上。
   *    📌 **⇒ 同一支檔裡有一句正確的限定,而我在另一段重新描述同一件事時沒有引用它。**
   *    🛑 **而這一格【不改變本片要不要做】**:燒 attempt 與卡一小時都還在,
   *      只是「重寄」那個最嚇人的說法要收窄。
   *
   * 🔴 **為什麼不直接改 `maxRunSeconds`**:那一顆的語意是「申告平台的硬性 kill 上界」,
   * 而 lease 的硬下界是**從它推出來的**(`max(3600, maxRunSeconds + 300)`)
   * ⇒ 動它會同時動掉一個安全計算的輸入。**兩件事分兩顆參數,不共用一顆。**
   *
   * 🔴 **為什麼必填**:同 `allowOrderShipped` / `ineligibleScanner` 的理由 ——
   * 選用而預設「現在」⇒ 忘了傳就退化成本次要修掉的那個行為,而**它不會紅**。
   *
   * 單位=毫秒 epoch(`Date.now()`)。⚠️ **它與 `now()` 注入縫共用同一支時鐘**。
   * 🔴 **傳錯不會 throw,會【降級】**:值若晚於本輪時鐘快照(呼叫端傳錯、或兩次讀之間被校時),
   * 預算基準自動退回 `sweepStartedAt` = 本片之前的行為 —— 理由見函式內 `budgetBaseMs` 那段
   * (throw 會讓一次 1ms 的正常校時炸掉整輪,比它要防的問題嚴重)。
   * ⚠️ **代價照實寫**:呼叫端傳一個荒謬的未來值 ⇒ 這一格會安靜地退回舊行為,沒有訊號。
   */
  runStartedAtMs: number;
  maxRunSeconds: number;
  leaseSeconds: number;
  now?: () => Date;
  random?: EmailBackoffRandom;
};

/** SweepEmailOutboxResult:結構化摘要(零 PII、counts only;E2a-c route log/回應用)。 */
export type SweepEmailOutboxResult = {
  /** ① 回收的 stale sending 列數(→ failed + 'lease_reclaimed';正常恆 0、>0 = 上輪有非正常死亡)。 */
  reclaimed: number;
  /** ② 本輪認領到的列數。 */
  claimed: number;
  /**
   * 🔴 **本輪【因為預算已用盡而根本沒去認領】**(⟦b4-SWEEPBUDGET1⟧;codex R3 must-fix)。
   *
   * **為什麼需要這一欄**:沒有它,「預算被前面兩段 enqueue 吃光」與「`claimDue` 自己掛了」
   * 在儀表上**印一模一樣的三個數字**(`errors=1 / claimed=0 / sent=0`)
   * ⇒ 凌晨三點的人分不出該去查 enqueue 的耗時、還是去查 DB。
   * 📌 **兩個病共用一個訊號 = 那個訊號答不出「我該往哪裡看」。**
   *
   * 值域 0 或 1(一輪最多發生一次)。>0 時 `errors` 也會 +1 ⇒ 503 那一格由 `errors` 帶,
   * 這一欄只負責**指路**,不重複判。
   */
  budgetExhaustedBeforeClaim: number;
  /**
   * ③ provider 裁決 = 接受的封數(sender 回 `sent` 當下遞增、**不含**後續 markSent 是否落表:
   * mark DB 錯 → `errors`、柵欄 no-op → `staleMarks`;codex 關卡2 R1 must-fix 後的精確語意)。
   */
  sent: number;
  /** ③ provider 裁決 = 失敗的封數(sender 回 `failed` 當下遞增;markFailed 落表狀況同上)。 */
  failed: number;
  /**
   * ③ 時間預算耗盡而未嘗試寄送的已認領列數(留在 sending、由下輪 ① 回收;代價 = 各燒 1 次
   * attempts + 延遲一個 lease 週期。>0 = claimLimit 相對 maxRunSeconds 太大,應調參)。
   */
  deferred: number;
  /**
   * mark* 世代柵欄 no-op 筆數(false:lease 已被回收/他人接手 → 不得覆寫)。**非錯誤**,
   * 僅供「DB 實寫 < 裁決計數」可見度(鏡像 `sweepSettlements.staleMarks`)。
   */
  staleMarks: number;
  /** 單封 throw / 段級(回收、claim、合格性讀取)throw 計數(fail-closed 不中斷整批;>0 → route 503)。 */
  errors: number;
  /**
   * 🔴 **本輪有幾封是因為【訂單已不合格】而沒寄**(已退款 / 已取消;Sean 2026-08-30 拍「甲 搬」)。
   *
   * 它與 `failed` 分開,理由與 `quotaFailed` 同族:**這不是失敗,是正確地不寄**。
   * 混進 `failed` ⇒ 一個運作正常的系統會讓失敗計數天天不為零 ⇒ 那個數字就沒有人看了。
   *
   * ⚠️ **>0 不代表有問題,=0 也不代表閘有裝上** —— 「沒有人取消訂單」與「閘沒接線」
   * 在這個數字上長得一樣。閘有沒有裝上由型別擋(這支 dep 是必填),不由這個數字證明。
   */
  skippedIneligible: number;
  /**
   * 🔴 **合格性【讀不到】而沒寄的封數**(codex 2026-08-30 must-fix 換來的獨立欄)。
   *
   * ⚠️ **不併進 `deferred`**:`deferred` 的定義是「時間預算耗盡」,借用它會讓營運端
   * **判讀出錯誤的原因** —— 看到 `deferred` 的人會去調 `claimLimit`,而真正的病在 DB。
   * ⚠️ **也不併進 `skippedIneligible`**:那一欄的意思是「**確定不合格**所以正確地不寄」,
   * 而這一欄是「**不知道合不合格**所以保守地不寄」。**確定與不知道是兩個世界。**
   *
   * 同一封同時計 `errors`(⇒ route 回 503,因為 DB 真的有問題要有人看)。
   */
  eligibilityUnknown: number;
  /**
   * 🔴 **本輪有幾封是撞到【額度用盡】而失敗的。**
   *
   * **分母 = `isQuotaExhaustionCode`(由 `email-backoff.ts` 的 `POLICY_BY_CODE` 推導)**,
   * 今天等於 `quota_daily_exceeded` / `quota_monthly_exceeded` / **`http_429`** 三碼 ——
   * 🔴 `http_429` **不是順手加的**:`IEmailOutbox.ts` 的 `http_429` JSDoc 逐字寫著
   * 「若實際不含 `name` → **所有 429 都落本格**」⇒ **在那個世界裡額度爆掉長的就是 `http_429`**,
   * 而第一版手寫兩碼會漏掉它(code-reviewer F1)。**這裡不重抄碼名,免得兩份名單分岔。**
   *
   * **為什麼要與 `failed` 分開**(2026-08-29 線D):`failed` 混了**單封偶發**的失敗
   * (某一封的收件地址壞掉之類)—— 而額度用盡是**整批性**的:**這一輪一封都寄不出去**。
   * ⇒ 若拿 `failed > 0` 去翻紅,偶發失敗會讓告警天天叫,而
   *   **一個天天叫的告警等於沒有告警**(同族字面見 `heartbeat.ts` 檔頭與 `#296`)。
   *
   * 🔴 **它存在的直接理由**:在本欄之前,額度爆掉時 `failed` 一直爬而 `errors` 恆 0
   * ⇒ route 的 503 條件(只看 `errors`)不成立 ⇒ **回 200 `ok:true`** ⇒ 心跳前進
   * ⇒ **一封信都沒寄出去,而所有監控都說一切正常。**
   * 📌 那不是「監控沒接上」,是**監控接上了而它量錯東西** ——
   *    外部死人開關問的是「這一輪有沒有跑」,而**額度爆掉的那一輪【真的跑了】**。
   *
   * ⚠️ **本欄【只解掉第一格】** —— 額度持續爆 ⇒ 每日重試、燒 5 次 `attempts` ⇒
   *    **第 5 天永久死信**,而**目前無死信重送工具**(`IEmailOutbox.ts` 逐字、backlog `#286`)。
   *    那一格是另一片,見 `~/pcm-mailbox/等Sean決策-20260829.md` 的 `Q-死信怎麼辦`。
   */
  quotaFailed: number;
  /**
   * 🔴 **本輪有幾封是因為【這一箱已被作廢】而沒寄**(M-4b E4 片3b 接線)。
   *
   * 它與 `errors` 分開的理由與 `skippedIneligible` 同族:**箱被作廢是正常業務動作**
   * (裝箱數量打錯的唯一補救就是整箱作廢重開;`20260805170200` COMMENT、Sean `Q-a`=C)。
   * 併進 `errors` ⇒ route 回 503 ⇒ **有人半夜起來查一個正常的業務動作**
   * (`IShippedEmailContext` 檔頭把這條失敗鏈整條寫出來了)。
   *
   * ⚠️ **>0 不代表有問題,=0 也不代表這條路接上了** —— 「沒有人作廢箱子」與
   * 「`shippedContext` 沒注入」在這個數字上長得一樣。
   */
  skippedShipmentVoided: number;
  /**
   * 🔴 寄送當下發現那個單號**已經被更新過了** ⇒ 跳過, 沒有寄(⟦5b-TRACKNUMGAP1⟧ 片 C)。
   * 🛑 **這個數字非零 = 有人在五分鐘內改了兩次單號** —— 而它是**好消息**:
   *    客人沒有收到一封被我們背書過的錯號碼。⇒ 📌 **它要被看得見, 不是靜默跳過。**
   */
  skippedTrackingSuperseded: number;
};

/**
 * 從 payload 撈 `shipment_id`(組裝層 allowlist 四欄之一;`order-email-assembly.ts:93`)。
 *
 * 🔴 **撈不到回 `null`,不 throw** —— 呼叫端把它與「沒注入 dep」走同一條 fail-closed。
 * ⚠️ **不驗 uuid 形狀**:那道驗證在**寫入端**(`buildOrderShippedPayload` 的 `requireUuid`),
 *    在這裡再驗一次會長出第二套判準;而形狀錯的值送下去的症狀是 `unavailable`,已經 fail-closed。
 */
function readShipmentId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('shipment_id' in payload)) return null;
  const v = (payload as { shipment_id: unknown }).shipment_id;
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * 從 payload 讀更正後的貨運單號(⟦5b-TRACKNUMGAP1⟧ 片 C)。
 *
 * ⚠️ **與 `readShipmentId` 【不是】逐格一致 —— 我寫註解時說是, 而它不是。**
 *    差在這裡多一個 `.trim()`:`readShipmentId` 判的是 `v !== ''`。
 * 🔵 **而這個差是刻意留著的**:一個「全是空白」的單號印在信上是一格空白,
 *    而那封信的全部內容就是那個號碼 ⇒ **它該被當成沒有**。
 *    ⇒ 📌 兩邊都是 fail-closed 方向(拿不到 ⇒ 不寄), 所以嚴的那一邊不會產生假寄。
 */
/**
 * 把 DB 回的 ISO 時間字串轉成 SQL 側那把鑰匙的**同一個 20 位數形狀**(`YYYYMMDDHH24MISSUS`, UTC)。
 *
 * 🔴🔴 **為什麼不是「兩邊各自轉成毫秒再比」**(codex R2 must-fix #3/#4/#5 —— 上一版就是那樣):
 *    · **毫秒截斷**:SQL 那把鑰匙到**微秒**, 截成毫秒之後**同一毫秒內的兩次更正身分相同**
 *      ⇒ A→B→C→B 若發生在同一毫秒, 舊的 B 與最新的 B 會**兩封都寄**。
 *    · **方向**:上一版寫 `live > job` 才算過期 ⇒ **live 比 job 舊**(時鐘回撥 / 讀到舊快照)
 *      而號碼又剛好相同 ⇒ **照樣寄**。⇒ 身分「不相等」就不該放行, 不分方向。
 *    ⇒ ✅ 改成**逐字比對同一個 20 位數字串**, 精度不掉、方向不用管。
 *
 * 🛑 **只收 UTC**(`Z` / `+00:00` / `+00`)。收到帶其他偏移的字串 ⇒ 回 `null` ⇒ 呼叫端 fail-closed。
 *    📌 **那是刻意的**:我可以寫時區換算, 而**一個算錯的時區會安靜地寄出一封過期的更正信**;
 *      一個 `null` 會吵。⇒ 今天 DB 是 UTC, 而**「今天是」不等於「永遠是」** —— 所以擋在這裡, 不是假設。
 * 🔴 形狀不符一律 `null`。**不要猜。**
 */
function isoToCorrectedKey(iso: string): string | null {
  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|\+00:00|\+00)$/.exec(iso);
  if (m === null) return null;
  const frac = (m[7] ?? '').padEnd(6, '0');
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${frac}`;
}

function readTrackingCorrectedKey(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>).tracking_corrected_key;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function readTrackingNumber(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as Record<string, unknown>).tracking_number;
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** lease 硬下界(秒)= plan §3.5-4「lease ≥ 1 小時」字面(物理擋、非約定)。 */
const MIN_LEASE_SECONDS = 3600;

/**
 * 跨 instance app 時鐘偏差餘裕(秒;E2a-a 關卡2 Fable F2:`claimed_at` 由認領方 app 鐘寫、
 * `staleBefore` 由回收方 app 鐘算)。5 分鐘遠大於 NTP 常態偏差量級 = 保守值。
 */
const CLOCK_SKEW_ALLOWANCE_SECONDS = 300;

/**
 * 收尾餘裕(秒):**停止寄送**的時點要比平台 kill 早這麼多(`⟦b4-SWEEPBUDGET1⟧`)。
 * 留給「`sender.send` 回來 → `markSent` 落表」那一段;沒有它,一次在 `maxRunSeconds - 1ms`
 * 通過的檢查後面仍可能跟著一發跨過 kill 線的 `send` ⇒ 列留 `sending` ⇒ 回收 ⇒ ⛔ ~~**重寄**~~
 * ⇒ ✅ **燒掉一次 attempt + 卡一小時**(「重寄」要停擺 >24h 才成立, 見 `SweepEmailOutboxOptions`
 *   的 `runStartedAtMs` 那段自我更正)。
 */
const SEND_TAIL_ALLOWANCE_SECONDS = 5;

/**
 * 依 eventType 窮舉分派內文模板(codex 關卡2 R1 must-fix:DB CHECK 與 `ClaimedEmailJob` 型別
 * 都合法允許 `order_shipped` 列存在 —— enqueue 現況雖只開 order_created,手動 DB 寫入即可造出
 * → 不做分派會把出貨列寄成「付款成功」信)。
 * 🔴 `order_shipped` = E4 未落地、無模板 → **寄送前 fail-closed throw**(零 PII;由呼叫端
 * per-job catch 計 error、列留 sending → 回收 → 耗盡 attempts → 訊號 2 可見,不靜默吞)。
 * E4 增員 union 時本 switch 少 case → typecheck 必紅(`satisfies never` 窮舉)。
 */
function buildEmailText(
  job: ClaimedEmailJob,
  shipped: ShippedEmailContext | null,
  paid: PaidEmailContext | null,
  siteUrl: string | undefined,
): string {
  switch (job.eventType) {
    case 'order_cancelled':
      // 🔴 **刷卡且已全額退款**(Q10)。與 `order_unpaid_cancelled` 互斥 —— 那條是「沒付過錢」。
      //    ⚠️ 它**不吃 `paid`**:付款脈絡查的是「這張單現在能不能寄付款信」,而這封信要講的是
      //    **已經退回去的錢**,兩者不是同一件事。金額從 payload 帶(enqueue 當下的快照)。
      return buildOrderCancelledText(job, siteUrl);
    case 'order_created':
      return buildOrderCreatedText(job, paid, siteUrl);
    case 'bank_order_created':
      // 🔴 ⟦b4-BANKNOEMAIL⟧:匯款單成立信。**只吃 `job.payload`**(R3-C1 採納, 主視窗 2026-09-06 裁)——
      //    與 order_cancelled 同形。⇒ 沒有第二次查詢 ⇒ 📌 **「表頭舊版 + 明細新版」那個混版問題不存在**,
      //    而不是「被解掉了」。
      //    ⚠️ 而快照是【下單當下】的 ⇒ 客人隔天匯了一半, 快照仍是舊的
      //    ⇒ 🔴 **寄送前那道 `balanceDue` 重驗非留不可**(它在 claim 之後、send 之前)。
      return buildBankOrderCreatedText(job, siteUrl);
    case 'order_unpaid_cancelled':
      // 🔵 **不需要 `shipped` 之類的第二來源** —— 這封信要的東西全在 `payload` 裡
      //    (訂單編號 + 對客的取消原因),而那是刻意的:**它是一封「事情不會再發生了」的信**,
      //    不需要品項、不需要金額、不需要箱號。
      return buildOrderUnpaidCancelledText(job);
    case 'order_shipped':
      // 🔴 **到得了這裡 ⇒ 呼叫端【已經】拿到 `kind:'ok'` 的 context**(三態的另外兩態、
      //    `linesTruncated`、空品項,全部在迴圈裡就 `continue` 掉了,不會走到本行)。
      //    ⇒ 這一格因此不是「順手防呆」,它是**最後一道**:少了它,一個未來把
      //    `shippedContext` 拿掉的改動會讓出貨信變成一封沒有箱號沒有品項的通用信,
      //    而**那正是 DB COLUMN COMMENT 明文禁止的東西**(`20260805170000` 逐字)。
      if (shipped === null) {
        throw new Error('sweepEmailOutbox:order_shipped 少了寄送時脈絡、fail-closed 不寄');
      }
      return buildOrderShippedText(shipped);
    case 'shipment_tracking_corrected':
      // 🔵 **不需要 `shipped` 脈絡** —— 這封信要的東西全在 payload 裡(單號 + 箱號 + 訂單編號),
      //    與 `order_unpaid_cancelled` 同一個理由:它是一封「那個號碼換了」的信,
      //    不需要品項、不需要金額。
      // 🛑 **而它【不能】重用 `order_shipped` 的模板**:那封說的是「有一批商品已出貨」,
      //    而客人這時候需要知道的是「你手上那個號碼是錯的」。
      return buildTrackingCorrectedText(job);
    default:
      // 🔴🔴 **這裡原本是 `return job.eventType satisfies never;`**(Fable 2026-08-22 R2 F7)。
      //    `satisfies` 在編譯後**整個消失** ⇒ 執行期它就是 `return job.eventType`
      //    ⇒ 一個型別上不該存在的 event_type 真的出現時,
      //    **那個字串會被當成信件內文寄給真客人**(例:客人收到一封內容只有 `order_refunded` 的信)。
      //    ⚠️ 今天它不可達,是**因為 DB CHECK 擋著**,不是因為這行安全 ——
      //    而「DB 先加了新 event_type、code 還沒跟上」是這個 repo 明文預期會發生的順序
      //    (`IEmailOutbox` 的 `EmailOutboxEventType` 是手抄的 union)。
      // ⇒ 改成 throw:失敗方向從「寄出垃圾」翻成「計 error、列留 sending、不寄」。
      //    🔴 **窮舉的型別保證沒有被拿掉** —— 下面那行仍然讓「少一個 case」在 typecheck 當場紅。
      job.eventType satisfies never;
      throw new Error('sweepEmailOutbox:未知 event_type、fail-closed 不寄');
  }
}

/**
 * 由 job 組純文字內文(L2 佔位字面;🔴 文案由 E3 定案、寄出前給 Sean 過目 —— 與
 * `orderCreatedSubject` 同一約定)。只取 payload 中非 PII 的 `display_id`(組裝層 allowlist
 * 三欄之一);payload 形狀異常(理論上不可達,組裝層 runtime 驗過)→ 退回不含編號的通用文案,
 * **不因文案缺欄位就不寄**(付款成功通知的存在比編號重要)。
 */
/**
 * ⟦b4-BANKNOEMAIL⟧ 匯款單成立信的純文字內文。
 *
 * 🔴🔴 **字面的來源是【Sean 核可的那一份】, 不是我寫的** ——
 *   canonical 在 `docs/specs/2026-09-06-bank-order-created-email-copy.md`
 *   (那支檔是**程式從端給他的那份逐字抄的**, 不是重打的)。
 *   Sean 2026-09-06 03:2x 逐字答「甲 = 可以」。
 *   ⇒ `sweep-email-outbox.test.ts` 有一發**讀那支 spec、把佔位詞換掉、與本函式輸出整串比對** ——
 *     📌 **那不是「測我寫對了」, 是把【他核可的字】與【寄出去的字】綁在一起。**
 *
 * 🔴 **標點是半形逗號, 而那是刻意的**:本 repo 已知兩種標點並存(出貨信那段逐字記著
 *   「全站有兩種標點, 而那是已知且刻意的, 不是漏改」)。判準照那段立的先例 ——
 *   **碼的字面要與他核可的那一份完全相同, 不是與鄰居一致。**
 *
 * 🛑 **三件缺了就【整段不印】, 不是印一半**:
 *   ① `display_id` 缺 ⇒ 訂單編號、備註那一行、訂單頁連結都指不到單 ⇒ 這封信沒有意義
 *   ② 三個金額任一缺 / 不是安全整數 ⇒ 🔴 **印一個可能錯的數字叫客人匯錢, 比不印糟**
 *   ③ `siteUrl` 缺 ⇒ **連結那兩行整段不印**(既有做法逐字「缺 siteUrl 就只印句子, 不印半個連結」,
 *      route 那側逐字「死入口比沒入口糟」)—— 而**信的其餘部分照印**, 因為帳號與期限才是主體。
 *   ⇒ ①② 回 `null`, 由呼叫端 fail-closed 不寄(R3-MF2 那條規則的碼側對應)。
 */
function buildBankOrderCreatedText(job: ClaimedEmailJob, siteUrl: string | undefined): string {
  const payload = job.payload;
  const readStr = (key: string): string | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  // 🔴 金額只認**有限整數**(與隔壁同一把尺):NaN / Infinity / 字串數字一律當缺。
  //    ⚠️ 而這裡 `>= 0` 不是 `> 0` —— 「已收」合法地可以是 0(他一毛都還沒匯)。
  //    🛑 而「應付餘額」那一格的 `> 0` 由**掃描面**與**寄送前重驗**負責, 不在模板層重複判斷:
  //       📌 模板層再判一次 = 同一條規則兩份, 而兩份會漂。
  const readAmount = (key: string): number | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  };

  const rawDisplayId = readStr('display_id');
  const displayId = rawDisplayId === null ? null : sanitizeCustomerFacingReason(rawDisplayId);
  const total = readAmount('total');
  const balanceDue = readAmount('balance_due');
  const createdAt = readStr('created_at');
  // 🔴 呼叫端(`sweepEmailOutbox`)在 claim 之後會先做重驗;走到這裡仍缺 ⇒ 丟, 讓它計 error 不靜默寄半封。
  if (displayId === null || total === null || balanceDue === null || createdAt === null) {
    throw new Error('buildBankOrderCreatedText:payload 缺必要欄位 ⇒ fail-closed 不寄');
  }
  const paidSoFar = total - balanceDue;

  const orderUrl = paidEmailOrderUrl(siteUrl, displayId);
  const lines: string[] = [
    '您好,',
    '',
    `您的訂單 ${displayId} 已成立,目前尚未付款。`,
    '請依下列資訊完成轉帳,我們收到款項後會再通知您。',
    '',
    `訂單金額  NT$ ${formatOrderAmount(total)}`,
    `已收      NT$ ${formatOrderAmount(paidSoFar)}`,
    `應付餘額  NT$ ${formatOrderAmount(balanceDue)}`,
    '',
    '匯款資訊',
    `銀行      ${PCM_REMITTANCE_BANK_NAME}(${PCM_REMITTANCE_BRANCH})`,
    `戶名      ${PCM_REMITTANCE_ACCOUNT_NAME}`,
    `帳號      ${PCM_REMITTANCE_ACCOUNT_NO}`,
    `${PCM_REMITTANCE_MEMO_INSTRUCTION} ${displayId}`,
    '',
    remittanceDeadlineSentence(createdAt),
  ];
  // 🔴 缺 siteUrl ⇒ **這兩行整段不印**(不是印一個壞連結)。
  if (orderUrl !== undefined) {
    lines.push('', '訂單內容與匯款資訊也可以在這裡查看:', orderUrl);
  }
  lines.push('', `${ORDER_CONTACT_LEAD} ${PCM_LINE_ID}`, PCM_LINE_URL);
  return lines.join('\n');
}

function buildOrderCreatedText(
  job: ClaimedEmailJob,
  paid: PaidEmailContext | null,
  siteUrl: string | undefined,
): string {
  const payload = job.payload;
  const displayId =
    typeof payload === 'object' &&
    payload !== null &&
    'display_id' in payload &&
    typeof (payload as { display_id: unknown }).display_id === 'string'
      ? (payload as { display_id: string }).display_id
      : null;
  const orderLine = displayId === null ? '您的訂單已付款成功。' : `您的訂單 ${displayId} 已付款成功。`;
  // 🔴🔴 **金額與品項那一段(Sean 2026-09-03 勾 A1)** —— 而病灶要寫在這裡, 不是只寫做了什麼:
  //    這封信寄出去是**兩份**(本份純文字 + `renderPaidEmailHtml` 有排版那份), 兩份都送,
  //    **而客人看到哪一份是他的收信軟體決定的, 不是我們。**
  //    ⛔ 而在本片之前:排版那份有整張明細表, **本份一個數字都沒有**,
  //      而排版那份開頭逐字說「這封信是這筆交易的明細」
  //      ⇒ 🎯 **有一半機率, 客人收到的是一封宣稱自己是明細、而看不到買了什麼付了多少的信。**
  //    ⚠️ **`paid === null` 時整段不印** —— 那是「沒注入 paidContext」的環境, 行為與本片之前逐字相同。
  const detail: string[] = [];
  // 🔴 **加不起來就不印明細**(codex 對抗審查 must-fix):DB 的等式含 `tax_total`,
  //    而這裡 ⛔ ~~只列 小計/運費/折扣~~ ⇒ 有稅的那一天客人會收到一張【兜不攏的帳】。
  //    ✅ **2026-09-04 第 7 步訂正:稅額那一列已經加上了**(見下方)⇒ 本句講的是**本片之前**的狀態。
  //    🔵 而這道判斷**留著** —— 它防的是**下一個被加進 `total` 而沒人記得印的欄位**。
  //    ⇒ 判準問「加不加得起來」而不是「有沒有稅」—— 後者只擋得住我今天想得到的那一欄。
  if (paid !== null && orderAmountsBalance(paid)) {
    detail.push('', '訂單明細');
    for (const l of paid.lines) {
      // 🔴 品名從缺時的字面**與排版那份同一句**(`(品名未記錄)`)—— 兩份不可以各講各的。
      const title = l.title === null ? ORDER_LINE_TITLE_MISSING : l.title;
      const sku = l.variantSku === null ? '' : ` (${l.variantSku})`;
      detail.push(`· ${title}${sku} x ${l.quantity}  NT$ ${formatOrderAmount(l.lineTotal)}`);
    }
    // 🛑 **`linesTruncated` 在這裡【到不了】—— 而註解要照實說, 不要宣稱它在保護客人**
    //    (code-reviewer R1 nit):上游 `:978` 已經 `linesTruncated ⇒ errors++ / continue`(不寄)
    //    ⇒ 走到本行時它**恆為 false**。⛔ ~~我原本寫「少了它客人會以為我們漏算了」~~ ——
    //    **那個世界到不了這一行。**
    //    ✅ **留著的理由是【第二道】**:上游那道若哪天被放寬(例如改成「截斷也照寄」),
    //    這一行讓客人**至少看得到自己看的是部分**, 而不是靜靜地少幾項。
    //    ⇒ 📌 而它今天**沒有任何一發測試跑得到** —— 那一格是已知的, 不是漏掉的。
    // 🔵 **兩邊都保留**(2026-09-05 解衝突):我這半只動【標點】(A7 半形逗號 ⇒ 全形),
    //    origin/dev 那半動的是【稅額標籤】—— 兩者不是同一件事, 沒有一邊該被丟掉。
    // 🔴 2026-09-05:⛔ ~~「;完整明細請至會員中心查看」~~ **拿掉那半**。
    //    理由與 `ORDER_MEMBER_CENTER_SENTENCE` 同一條(手動單的佔位帳號登不進去),
    //    而**這裡不加條件句是因為【同一封信下面那句已經帶著條件了】** ⇒ 重複兩次反而更吵。
    //    🔵 「僅列出部分」那半留著 —— 它是這一行存在的理由(讓客人知道自己看的是部分)。
    if (paid.linesTruncated) detail.push('(品項過多，此處僅列出部分)');
    // 🔴 有稅時小計是【未稅】的 ⇒ 標籤要說得出來(`⟦b4-TAXSURFACES⟧`, Sean 2026-09-04 拍甲)。
    //    共用 `subtotalLabelOf` 而不在這裡寫死 —— 五個面要逐字相同, 而抄五份時
    //    下一個人只會改他打開的那一份。
    detail.push('', `${subtotalLabelOf('小計', paid.taxTotal)}  NT$ ${formatOrderAmount(paid.subtotal)}`);
    // 🔴 折扣 0 不印(印「折扣 −0」會讓客人以為有一筆他沒看到的折抵);
    //    而**運費 0 照印**(「免運」是他想確認的事)—— 兩條【規則】與排版那份逐條相同。
    // 🛑 **而【順序】也對齊了**(code-reviewer R1 nit):排版那份是 小計 → 運費 → 折扣 → 訂單金額
    //    (`shippingRow` 排在 `discountRow` 之前), 而我第一版寫成 小計 → 折扣 → 運費。
    //    ⇒ 📌 **數字沒錯, 而本片的整個論點就是【兩份不該漂】** —— 順序也是那個「兩份」的一部分。
    detail.push(`運費  NT$ ${formatOrderAmount(paid.shippingFee)}`);
    if (paid.discountTotal > 0) detail.push(`折扣  −NT$ ${formatOrderAmount(paid.discountTotal)}`);
    // 🔴 稅額:**有稅才印**(2026-09-04 `⟦b4-INVOICE5PCT⟧` 第 7 步)——
    //    與【折扣】同族、與【運費】不同族。稅 0 不印的理由:今天每一張單的稅都是 0(價格含稅),
    //    印一列「稅額 0」會讓客人以為**這筆交易沒有被課稅**, 而那是錯的:稅**內含在售價裡**。
    //    🛑 **位置與排版那份逐字對齊**:小計 → 運費 → 折扣 → **稅額** → 訂單金額。
    //       ⇒ 📌 兩份不該漂, 而順序也是那個「兩份」的一部分(上面那條 nit 的同一句)。
    if (paid.taxTotal > 0) detail.push(`稅額  NT$ ${formatOrderAmount(paid.taxTotal)}`);
    detail.push(`訂單金額  NT$ ${formatOrderAmount(paid.total)}`);
  }

  // 🔴 會員中心那句附網址(Sean 勾 A4)。**缺 siteUrl 就只印句子, 不印半個連結。**
  const orderUrl =
    paid === null ? undefined : paidEmailOrderUrl(siteUrl, paid.orderDisplayId);
  const memberCenter =
    orderUrl === undefined
      ? ORDER_MEMBER_CENTER_SENTENCE
      : `${ORDER_MEMBER_CENTER_SENTENCE}\n${orderUrl}`;

  return [
    '您好，',
    '',
    orderLine,
    // 🛑🛑 **2026-09-02:這一句【提出過改法, 而最後【沒有改】】—— 而不改是刻意的, 全文在這裡。**
    //
    // 提案:`~/pcm-mailbox/擬稿-付款成功信文案-20260902.md:84` 建議改成
    //   「我們會盡快為您出貨, 出貨時會再寄一封通知信給您。」(理由:舊句只給承諾而沒有下一步
    //    ⇒ 客人會打電話問「多快」)。
    //
    // 🔴 **而它【沒有被拍板】, 兩個獨立審查者同時抓到**(2026-09-02):
    //   · 該擬稿的甲乙丙(`:63-71`)**只問排程**;文案那一格自己逐字寫「**不影響上面那題**」(`:80`)
    //     且**沒有自己的 `A:`** ⇒ **Sean 從未對這一句回過一個字。**
    //   · 而 codex 把它推到更重的一格:**那不是敘述問題, 是【cron 會直接把這句話寄給客人】** ——
    //     每 5 分鐘一次, 而中間沒有人會再看一眼。
    //
    // 🔴🔴 **而第二個理由更硬, 它推翻了「改期望值可以」那個判斷**:
    //   `sweep-email-outbox.test.ts` 的 `EXPECTED_ORDER_CREATED_BODY` 是一個**整串 `toBe`**
    //   ⇒ 它的**副作用**就是「這串對外文案不得無聲改變」—— 而那正是這一族需要的那道閘。
    //   ⇒ ⇒ 📌 **改那個期望值 = 把那道鎖重設了, 而重設一道鎖需要授權, 而授權不存在。**
    //   🔵 而判別句要修正一格:問「這格【原本在擋什麼】」問的是**意圖**;
    //      要問的是「**它現在鎖住什麼**」—— 對一道守門而言, 後者才算數。
    //
    // ✅ **⇒ 所以本片【一個字都不改文案】, 只接線(那三步是 Sean 拍的甲)。**
    // 🛑 **而代價明寫**:那句「沒有時間的承諾」仍然留著 ⇒ **已知而未修**,
    //    而它會跟著【文案全套等 Sean 過目】一起處理(板上另開一列)。
    // 🔵 而 `:355` 那句 docstring(「L2 佔位字面、寄出前給 Sean 過目」)**仍然成立** —— 它就是在等這件事。
    // 🟢 **2026-09-02 20:5x:把這一句從【佔位】換成【定稿】。而三段各有各的依據, 逐段寫在這裡。**
    //
    // ⛔ ~~'我們將盡快為您安排出貨;訂單明細與最新狀態請至 PCM 會員中心查看。'~~
    //
    // 🔵 **① 中段(換掉的那一句)⇒ 依據是【稿】, 不是誰覺得比較順**:
    //    OD `pcm-524f/email-order-paid-A.html`(252 行 · sha256 `43d40270781b0eb3…`)
    //    —— **Sean 2026-08-23 拍 A 版**。而 HTML 那一份(`paid-email-html.ts`)與稿**逐字相同**,
    //    而本函式的 docstring 自己寫著「**L2 佔位字面;文案由 E3 定案、寄出前給 Sean 過目**」
    //    ⇒ 📌 **這一份自己宣告它是暫時的 ⇒ 換成定稿不是「選一句話」, 是把佔位換成正本。**
    //    🛑 而字面是**程式化從稿抽出來的**, 不是我重打的 —— 我第一版寫成「為您出貨」而稿是
    //      「為您**安排**出貨」⇒ 📌 **我差一點把自己的舊擬稿當成稿, 而兩個字在複誦時消失、句子照樣通順。**
    //
    // 🔴 **② 而稿那一句的【前半】刻意不抄**:稿是「**這封信是這筆交易的明細。**我們會盡快…」
    //    ⇒ 而**本函式沒有明細**(量的:函式體 grep `subtotal|total|lines|品項|金額|小計` ⇒ **0**;
    //      🟢 正對照 同一把尺對 `paid-email-html.ts` ⇒ **8** ⇒ 尺會動)
    //    ⇒ ⇒ 🛑 **照稿逐字抄, 這封信會對客人說一句它自己做不到的話。**
    //    📌 **⇒ 所以「照稿」在這裡不是最高原則, 【不說假話】才是。**
    //
    // 🟢 **③ 而下一句「訂單明細與最新狀態請至 PCM 會員中心查看。」【保留】** ——
    //    稿裡**沒有**它, 而「稿裡沒有」不等於「Sean 決定不要」:稿是 HTML 版的定稿,
    //    而**出貨信裡同一句是他 2026-08-30 看過全文並逐字答「可以」的**。
    //    ⇒ 📌 **換掉一個自稱佔位的東西 = 執行拍板;刪掉一個他批准過的東西 = 新決定。**
    //      **兩者在同一段文字裡, 而授權層級不同。**
    //
    // ⛔ ~~**④ 標點用半形** —— 稿那一句用全形, 而**那是 HTML 那個載體的**;
    //    他對【純文字這個載體】表達過偏好的那一次(出貨信, 8/30 答「可以」)⇒ **20 個半形、零全形**,
    //    而本檔 `:441` 的紀律也逐字要求半形。⇒ **不跨載體套用標點。**~~
    // 🔴🔴 **2026-09-03:上面那一段【與現在的碼相反】了,原句留著不刪,而衝突要看得見。**
    //    Sean 2026-09-03 02:5x 拍甲「一份定義, 兩邊各自取用」⇒ 兩份共用**同一個字串**
    //    ⇒ **一個載體的標點必然要讓給另一個** ⇒ 我照鐵則 1 讓給**稿**(全形 `U+FF0C`)。
    //    🛑 **而我端了一題出去,因為這兩個依據不是同一個人在同一件事上說的**:
    //      · 上面那條的依據是【出貨信】8/30 那次,是**推出來的偏好**,不是他對本信說的
    //      · 拍甲那次的選項字面只寫「代價:要動到付款信那一對的結構」—— **沒有提到標點會變**
    //    ⇒ 📌 **他可能不知道拍甲會把純文字的逗號一起換掉。** ⇒ 照 R3:確認、不假設。
    //    ⇒ **在他回答之前,現況 = 全形(本次改動),而這一段就是那個問題的落點。**
    // 🔴 **從 `order-email-copy.ts` 取,不在這裡打第二份** —— Sean 2026-09-03 拍甲。
    //    ⛔ ~~原本這裡是一份手打的字面,而它的逗號是 `U+002C`(半形)~~
    //    而 HTML 那一份與稿一樣是 `U+FF0C`(全形)⇒ **同一封信的兩份,標點是不同的字元**。
    //    ⇒ 統一的方向是【純文字向稿對齊】(鐵則 1),所以會變的是這一半。
    ORDER_PAID_NEXT_STEP_SENTENCE,
    ...detail,
    '',
    memberCenter,
    // 🔴 **聯絡資訊(Sean 勾 A2)** —— 字面全部取自共用來源, 與排版那份同一份。
    //    ⛔ 本片之前純文字這半 **一個聯絡方式都沒有**(lin.ee / 派達 / 統編 三項全 0,
    //      而排版那份三項全有)⇒ 收到純文字版的客人, 想問事情時找不到我們。
    '',
    // 🔴🔴 **這裡【刻意】不含「回覆這封信」那半句**(codex 對抗審查 must-fix)。
    //    ⛔ ~~我第一版照抄排版那份的整句, 含「有任何問題,回覆這封信或加入官方 LINE」~~
    //    🛑 **A2 授權的是「補聯絡方式」;而「回覆這封信」是一個【關於某個信箱的承諾】,**
    //      **而那個信箱有沒有人收 = A3, 是 Sean 【沒答】的格。**
    //    ⇒ 📌 **照抄那一整句 = 把一個未決的承諾, 從一份真實信件擴散到第二份。**
    //      而 A2 的字面涵蓋得到它,不代表它就該被涵蓋 —— **兩件事被綁在同一句話裡, 而只有一半被批准。**
    //    ✅ ⇒ 純文字只給【找得到我們的方式】(LINE + 公司), 不給那個承諾。
    //    🔵 而 A3 答了之後:答「有人收」⇒ 這裡可以補上;答「沒人收」⇒ 排版那份要拿掉。
    //      **兩個答案都只要改一處, 而那正是不擴散換來的。**
    `加入官方 LINE ${PCM_LINE_ID}`,
    PCM_LINE_URL,
    '',
    'PCM重機零件販售',
    PCM_COMPANY_LINE,
    PCM_COMPANY_ADDRESS,
  ].join('\n');
}

/**
 * 出貨通知信的純文字內文(M-4b E4 片3b)。
 *
 * 🔴 **內容分級 = L2**(鐵則 9;與隔壁 `buildOrderCreatedText` 同級)。
 * 判準:這封信的措辭**季度改個一兩次**(換文案、加一句、改稱呼),不是週週改
 * ⇒ 不到 L3(必須後台 CRUD),但也不是 L1(年 0-1 次)。
 * ⇒ 依鐵則 9,L2 = **hardcode + TODO + backlog**:
 *   TODO(L2):信件文案搬進後台可編輯 —— `docs/launch-todo.md` 的 `⟦b4-MAILCOPY1⟧`。
 * ⚠️ **與隔壁不同的一格**:`buildOrderCreatedText` 自標「L2 佔位字面、寄出前給 Sean 過目」,
 *    而**本函式的字面 Sean 已經看過全文並逐字答「可以」(2026-08-30)** ⇒ 它不是佔位。
 *    ⇒ **要改這裡的字,是改一個他拍過的東西 —— 那不是實作者可以自己拍的板。**
 *
 * ── 🔴 Sean 2026-08-30 拍板 `q3: C`,而**他拍的是「放哪三段」,不是「那三段怎麼寫」** ──
 * 他看到的選項字面(逐字,`-48` 轉;沒有重打):
 * ```
 * A  最短版
 * B  A ＋「這張訂單可能分批出貨，其餘商品出貨時會另外通知您」
 * C  B ＋ 沒有追蹤碼那幾批寫「本批為自取／自送，無追蹤碼」〔我們建議 C〕
 * ```
 * ⚠️ **⇒ 所以下面這些字他【沒有看過】。交件時必須把全文貼給他一次,**
 * **不是回報「已照 C 實作」**(同族前科:`buildOrderCreatedText` 自己標著「L2 佔位字面」)。
 *
 * ── 三段各自的**條件**(而條件才是這一片真正在做的事)──────────────────────
 * ```
 * ① 最短版                          ⇒ 每一封都有
 * ② 「這張訂單可能分批出貨…」        ⇒ ctx.orderHasUnshippedItems === true
 * ③ 「本批為自取／自送,無追蹤碼」    ⇒ ctx.trackingNumber === null
 * ```
 * 📌 他讀到的理由逐字:「**那兩句只在該出現的那一批出現, 不是每封信都變長**」
 * ⇒ ⇒ **把三段無條件塞進每一封 = 沒有照拍板做,即使字面全在。**
 *
 * ── 🛑 **本信【刻意不印任何時間】** ────────────────────────────────────
 * `shipped_at` 在 payload 裡拿得到,而**它沒有被印出來**。理由:Sean 那一板
 * (`時區 = 甲 台北時間(+08:00)`)講的是 `SHIPPED_EMAIL_CUTOFF` **那個 env 怎麼解讀**,
 * 不是「信裡要印一個時間」。⇒ 印一個他沒有拍過的欄位 = 自己加文案。
 * ⚠️ **要加的話請連時區一起拍板** —— 印一個沒有偏移的時刻,客人看到的會是 UTC。
 *
 * 🔴 **標點用半形逗號**。⛔ ~~與隔壁 `buildOrderCreatedText` 一致~~
 * **2026-09-03 起那句話不再成立** —— `buildOrderCreatedText` 那一句已改用全形(見該處說明),
 * 而**出貨信這一支沒有跟著改**(它不在 Sean 那次拍板的射程裡:他拍的是【付款信那一對】)。
 * ⇒ 🛑 **所以現在全站有兩種標點,而那是【已知且刻意】的,不是漏改。**
 * ⇒ 而它同時是那一題的一部分:若 Sean 回「純文字一律半形」,要改的是付款信那半、不是這一支。
 * ⛔ ~~⇒ 兩者只差標點、字沒有改,這一格在交件時要跟他講一聲。~~
 * ✅ **已複驗(2026-08-30 夜):不需要告知 —— 碼的字面與他核可的那一份【完全相同】。**
 *    **落點(去這裡看,不要只信這一句)**:
 *    `~/pcm-mailbox/給Sean-出貨通知信實際措辭-20260830.md`
 *      `:23` 「## 信長這樣」= 他實際看到的那封信全文
 *      `:42` 這張訂單可能分批出貨,…      ⇒ **半形 `,`**
 *      `:56` 本批為自取／自送,無追蹤碼。 ⇒ **半形 `,`**
 *      `:72` 「信的措辭就照【上面那樣】?」⇒ 他答「可以」
 *    ⇒ 全形只出現在 `:15-16` 的**選項摘要**,而那一題問的是「放哪三段」不是「怎麼寫」
 *      —— **那份檔自己在 `:9` 就寫了。**
 *
 * 🔴🔴 **而這一格是怎麼被抓到的,留著 —— 它比那個標點值錢**:
 *    我拿【碼】去比【選項摘要】,得到「我們偏離了他核可的字面」這個結論,
 *    而它一路轉手到準備端給 Sean,**中間零個人回過原件**。
 *    📌 **那兩種字面在【同一支檔裡】** ⇒ 我 grep 它、撞到全形,
 *    **而那個命中【不是錯的】—— 它只是沒有在回答我的問題。**
 *    ⇒ **一個真的命中,比一個假的命中難發現**:零命中至少會讓人問「我的尺對不對」,
 *      而一個真實存在的命中**沒有任何訊號**告訴你「這一個屬於另一個世界」。
 *
 * 🛑 **而原註解那句「要跟他講一聲」的教訓【仍然成立】,不要跟上面一起劃掉**:
 *    它要講的那件事複驗後不需要講了;**而「它從來沒有被講出去」這件事是真的** ——
 *    量法:本線在 `~/pcm-mailbox/` 的 58 支檔 `grep 只差標點` ⇒ **0**
 *    (正對照:同 58 支含「出貨」⇒ **58**)。
 *    📌 **一句寫在碼裡的待辦,沒有任何東西會叫醒它 —— 它與一句寫完就完成了的註解,
 *      在檔案上長得一模一樣。**
 */
/**
 * 取消通知信(`order_unpaid_cancelled`)——「**未付款**的單被【員工】取消」。
 *
 * 🔴 **射程(Sean 2026-09-03 拍乙)**:只涵蓋**員工在後台按下取消**。
 *    `expire_unpaid_orders`(pg_cron 自動逾時,一次上限 500 張)**不寄**
 *    —— 而那件事**不是靠這支函式擋的**,它靠 `scripts/expire-unpaid-orders-no-email.test.ts`
 *    (那條路一次可取消 500 張單 ⇒ 接上寄信 = 一次寄出上百封,而信收不回來)。
 *
 * 🔴 **「為什麼取消」那一句【不由本檔造】** —— 它由 `payload.cancelled_reason` 帶進來,
 *    而那個欄位的字面來自 `admin_cancel_order` 的七值映射表
 *    (`20260830020000` 錨 `WHEN 'customer_request' THEN '依您要求取消'`),
 *    **那些字本來就是寫給客人看的、今天就在 `orders.cancelled_reason` 裡** ⇒ **零新造文案。**
 *    🛑 **而 `other` 那一格是員工自己打的字**(沒有審稿的對外字面)⇒ 已端 Sean;
 *      **在他回答之前,enqueue 那一片有責任決定要不要把 `other` 的原文放進 payload。**
 *      ⇒ 📌 本函式**只印它拿到的東西**,不替那個決定背書。
 *
 * 🔵 **只做純文字** —— 出貨信今天就是純文字,HTML 那條路只服務付款成功信(規格 §11)。
 *
 * ⚠️ **缺欄位時的行為是刻意的**:
 *    · 沒有 `display_id` ⇒ 走不含編號的那一句 —— **不印 `undefined`、不印空白**(那會直接到客人眼前)
 *    · 沒有 `cancelled_reason` ⇒ **整段不印**,而不是印一行空的「取消原因:」
 *      ⇒ 📌 **少一句話,好過一句沒有內容的話。**
 */
function buildOrderUnpaidCancelledText(job: ClaimedEmailJob): string {
  const payload = job.payload;
  const readStr = (key: string): string | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  // 🔴 `display_id` 同樣可能是字面 "undefined"(上游 String(undefined))⇒ 走退化句而不是印它
  const rawDisplayId = readStr('display_id');
  const displayId =
    rawDisplayId === null ? null : sanitizeCustomerFacingReason(rawDisplayId);
  // 🔴 **員工打的那段字要先整形** —— 它是自由文字, 而它會原封進到客人眼前(codex 三條 must-fix)。
  //    ⚠️ 而整形只管【形狀】不管【語意】:它擋不住「退款將於三日內完成」這種內容上錯的句子。
  const rawReason = readStr('cancelled_reason');
  const reason = rawReason === null ? null : sanitizeCustomerFacingReason(rawReason);

  const lines: string[] = [
    '您好，',
    '',
    displayId === null
      ? ORDER_CANCELLED_HEADLINE_NO_ID
      : ORDER_CANCELLED_HEADLINE_WITH_ID(displayId),
  ];
  if (reason !== null) lines.push('', reason);
  lines.push('', ORDER_UNPAID_CANCELLED_NO_CHARGE_SENTENCE);
  lines.push('', ORDER_MEMBER_CENTER_SENTENCE, '', 'PCM重機零件販售');
  return lines.join('\n');
}

/**
 * 🔴🔴 **刷卡且【已全額退款】的取消信**(Q10;Sean 2026-09-03 拍甲)。
 *
 * **這封信要解的事**:今天這種單的客人**什麼都收不到**,而**錢已經退回去了** ——
 * 我們動了他的錢,而沒有告訴他。
 *
 * 🛑 **三格刻意的限制,少一格這封信就會出事**:
 * 1. **不寫「X 個工作天到帳」** —— 到帳時間由發卡行決定,不由我們。
 *    寫了就是一個我們控制不了的承諾(同族:「回覆這封信」「請稍後再試」)。
 * 2. **不假設他收過付款成功信** —— 量到的:那封信在寄出前會再查一次訂單,查到 `cancelled`
 *    就整封不寄,而掃描每 5 分鐘一輪 ⇒ **有一半的人沒收到過**。
 *    ⇒ 開頭不回溯「您先前付款成功後…」,對那一半的人那句話是憑空冒出來的。
 * 3. **金額缺了就不印那一行** —— 印一個猜的金額比不印糟。而那一行是**選填**:
 *    `ORDER_CANCELLED_REFUNDED_SENTENCE` 本身不含數字,少了金額它仍然是一句完整而正確的話。
 *
 * ⚠️ **員工填的原因一律過 `sanitizeCustomerFacingReason`** —— 它是自由文字而會原封進客人眼前
 *    (整形只管形狀不管語意:它擋不住「退款將於三日內完成」這種內容上錯的句子)。
 */
function buildOrderCancelledText(job: ClaimedEmailJob, siteUrl: string | undefined): string {
  const payload = job.payload;
  const readStr = (key: string): string | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  // 🔴 金額只認**有限整數**:`NaN` / `Infinity` / 字串數字一律當缺 ⇒ 不印那一行。
  const readAmount = (key: string): number | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
  };

  const rawDisplayId = readStr('display_id');
  const displayId = rawDisplayId === null ? null : sanitizeCustomerFacingReason(rawDisplayId);
  const rawReason = readStr('cancelled_reason');
  const reason = rawReason === null ? null : sanitizeCustomerFacingReason(rawReason);
  const refunded = readAmount('refunded_amount');

  const lines: string[] = [
    '您好，',
    '',
    displayId === null
      ? ORDER_CANCELLED_HEADLINE_NO_ID
      : ORDER_CANCELLED_HEADLINE_WITH_ID(displayId),
  ];
  if (reason !== null) lines.push('', reason);
  // 🔴🔴 **「全額退回」那句是【有條件】的 —— 而它原本無條件印**(code-reviewer R1 must-fix)。
  //    ⛔ ~~`lines.push('', ORDER_CANCELLED_REFUNDED_SENTENCE)` 不看任何欄位~~
  //    🛑 **失敗情境是具體的**:寫入端(片 B)只要有一次把**部分退款**排進來,
  //      客人就會收到一封說「全額退回」的信 —— 而**模板結構上擋不住**。
  //    ⇒ 📌 而部分退款要不要寄,**Sean 沒拍過**(判準碰巧排除它 ≠ 那是個決定)
  //      ⇒ 在他拍之前, 這裡要 **fail-closed**:不是 `'full'` ⇒ **那句與那行都不印。**
  //    ✅ 方向與上面「金額缺了就不印」一致:**印一個可能是假的說法, 比不印糟。**
  //    ⚠️ 而這是一個**對寫入端的契約**:payload 要帶 `refund_kind`。片 B 要照著填。
  const refundKind = readStr('refund_kind');
  if (refundKind === 'full') {
    lines.push('', ORDER_CANCELLED_REFUNDED_SENTENCE);
    if (refunded !== null) lines.push(`退款金額  NT$ ${formatOrderAmount(refunded)}`);
  }

  const orderUrl = displayId === null ? undefined : paidEmailOrderUrl(siteUrl, displayId);
  lines.push('', ORDER_MEMBER_CENTER_SENTENCE);
  if (orderUrl !== undefined) lines.push(orderUrl);
  // 🔴 聯絡資訊與付款信同一份來源(A2 的理由在這裡更強:**他的錢剛被動過**, 而他要找得到我們)。
  //    🛑 而**不含「回覆這封信」** —— 那個信箱沒有人收(Sean 2026-09-03 答 A3;板列 ⟦b4-REPLYTO1⟧)。
  lines.push('', `${ORDER_CONTACT_LEAD} ${PCM_LINE_ID}`, PCM_LINE_URL);
  lines.push('', 'PCM重機零件販售', PCM_COMPANY_LINE, PCM_COMPANY_ADDRESS);
  return lines.join('\n');
}

function buildOrderShippedText(ctx: ShippedEmailContext): string {
  const lines: string[] = [
  // 🔴🔴 **本函式的半形逗號【刻意不改】—— 而它現在是全站唯一的一族, 請不要順手統一掉。**
  //    2026-09-05 A7「標點跟稿走全形」把其餘 6 處對外句改成了全形(付款/取消/未付款取消/
  //    追蹤更正/三封共用句), **而這裡的三處(`:您好` · `本批為自取／自送` · `分批出貨`)沒動。**
  //    🛑 理由不是遺漏:**本函式的字面 Sean 2026-08-30 看過全文並逐字答「可以」**
  //      ⇒ 改它的標點 = 改一個他拍過的東西, 而 A7 那份端給他的清單
  //      **沒有告訴他 A7 會動到這三句** ⇒ 📌 他同意的是「這類問題你們決定」,
  //      不是「改我拍過的那三句」。
  //    ⚠️ **而代價明寫**:出貨信因此成為**唯一還用半形逗號的一封** ——
  //      A7 原本要解的就是不一致, 而這個切法**把不一致從「多對一」變成「一對多」**。
  //    ⏰ **什麼時候可以統一**:下一次 Sean 本人看這封信的全文時, 一併問他一句。
    '您好,',
    '',
    `您的訂單 ${ctx.orderDisplayId} 有一批商品已出貨。`,
    '',
    `箱號:${ctx.shipmentReference}`,
  ];

  // ③ 沒有追蹤碼 ⇒ 那一句;有碼 ⇒ 印貨運商與碼。
  // 🔴 判準是 `trackingNumber === null`,**不是 `carrierName === null`** ——
  //    客人要拿去查的是碼;而一個「有貨運商、碼還沒填」的箱子也該走「無追蹤碼」那一句。
  if (ctx.trackingNumber === null) {
    lines.push('本批為自取／自送,無追蹤碼。');
  } else {
    if (ctx.carrierName !== null) lines.push(`貨運:${ctx.carrierName}`);
    lines.push(`追蹤碼:${ctx.trackingNumber}`);
  }

  lines.push('', '本批出貨內容:');
  for (const line of ctx.lines) {
    // 🔴 品名從缺**照樣印那一列**(port 的「防禦容缺」)—— 少印一列的話,
    //    客人手上的清單會比箱子裡少一項,**而他不會知道要問**。
    lines.push(`· ${line.title ?? '(品名從缺)'} × ${line.quantity}`);
  }

  // ② 這張訂單還有沒出的東西。
  if (ctx.orderHasUnshippedItems) {
    lines.push('', '這張訂單可能分批出貨,其餘商品出貨時會另外通知您。');
  }

  lines.push('', ORDER_MEMBER_CENTER_SENTENCE, '', 'PCM重機零件販售');
  return lines.join('\n');
}

export async function sweepEmailOutbox(
  deps: SweepEmailOutboxDeps,
  opts: SweepEmailOutboxOptions,
): Promise<SweepEmailOutboxResult> {
  const { outbox, sender, ineligibleScanner } = deps;
  // 🔴 lease 下界物理擋(fail-closed 大聲炸,不靜默降級:太短的 lease = 系統性重複寄信)。
  if (!Number.isFinite(opts.maxRunSeconds) || opts.maxRunSeconds < 1) {
    throw new Error(`sweepEmailOutbox:maxRunSeconds 必須是 ≥1 的有限數(收到 ${opts.maxRunSeconds})`);
  }
  // 🔴 `runStartedAtMs` 同樣 fail-loud:傳錯 ⇒ 預算算錯 ⇒ 在 send 途中被 kill
  //    ⇒ 燒 attempt + 卡一小時(⛔ ~~而重寄是收不回來的~~ —— 「重寄」要停擺 >24h,見上方自我更正)。
  if (!Number.isFinite(opts.runStartedAtMs)) {
    throw new Error(
      `sweepEmailOutbox:runStartedAtMs 必須是有限數(毫秒 epoch;收到 ${opts.runStartedAtMs})`,
    );
  }
  const minLease = Math.max(MIN_LEASE_SECONDS, opts.maxRunSeconds + CLOCK_SKEW_ALLOWANCE_SECONDS);
  if (!Number.isFinite(opts.leaseSeconds) || opts.leaseSeconds < minLease) {
    throw new Error(
      `sweepEmailOutbox:leaseSeconds 必須 ≥ ${minLease}(= max(${MIN_LEASE_SECONDS}, maxRunSeconds + ${CLOCK_SKEW_ALLOWANCE_SECONDS});plan §3.5-4 + port staleBefore 安全下界;收到 ${opts.leaseSeconds})`,
    );
  }
  const now = opts.now ?? (() => new Date());
  const random = opts.random ?? Math.random;

  const result: SweepEmailOutboxResult = {
    reclaimed: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    deferred: 0,
    staleMarks: 0,
    errors: 0,
    budgetExhaustedBeforeClaim: 0,
    skippedIneligible: 0,
    eligibilityUnknown: 0,
    quotaFailed: 0,
    skippedShipmentVoided: 0,
    skippedTrackingSuperseded: 0,
  };

  // 🔴 單一時鐘快照:staleBefore / nextRetryAt 由此導出(兩次 now() 之間的間隔會憑空吃掉
  //    lease 餘裕)。⚠️ **時間預算的基準不是它** —— 見下方 `budgetBaseMs`(⟦b4-SWEEPBUDGET1⟧)。
  const sweepStartedAt = now();

  // ── ① lease 回收(claim 前必跑;§⑩:落 failed + 'lease_reclaimed'、attempts 不動)────────
  //    fail-closed:throw → 計 error + 續(回收失敗只是 stale 列本輪不回收,下輪重來;
  //    不阻斷 ② 的正常寄送)。
  try {
    result.reclaimed = await outbox.reclaimStaleLeases(
      new Date(sweepStartedAt.getTime() - opts.leaseSeconds * 1000),
      new Date(sweepStartedAt.getTime() + LEASE_RECLAIM_RETRY_DELAY_MS),
    );
  } catch {
    result.errors++;
  }

  // ── 時間預算(`⟦b4-SWEEPBUDGET1⟧`;codex 2026-08-30 R1 三條 must-fix 折入)────────────
  //
  // 🔴 **基準取【兩個起點裡較早的那一個】**,不是單看 `opts.runStartedAtMs`:
  //    · 正常情況 = route 進來那一刻(比 `sweepStartedAt` 早)⇒ 本片要修的那件事成立:
  //      前面兩段 enqueue 花掉的時間**也是平台碼表的一部分**,要被扣掉。
  //    · 而 `runStartedAtMs` 若**晚於**本輪快照(呼叫端傳錯、或系統鐘在兩次讀之間被回撥),
  //      取 min ⇒ 自動退回 `sweepStartedAt` = **本片之前的行為**。
  //    🔴 **為什麼不 throw**(codex R1 must-fix 2):一次 1ms 的正常校時就會讓整輪炸掉 ——
  //      回收、認領、寄送**全都不跑**、route 503,而那**比它要防的問題嚴重**。
  //      ⇒ 這一格的正確反應是「退回舊的、比較保守的基準」,不是「停掉整條線」。
  const budgetBaseMs = Math.min(opts.runStartedAtMs, sweepStartedAt.getTime());
  //
  // 🔴 **收尾餘裕**(codex R1 must-fix 3):預算若正好等於 `maxRunSeconds`,
  //    一次在 59.999s 通過的檢查後面還跟著一整發 `sender.send` ⇒ Resend 在 60.01s 收下、
  //    平台當場 kill、`markSent` 沒寫下去 ⇒ 回收 ⇒ ⛔ ~~**重寄**~~
  //    ⇒ ✅ **燒 attempt + 卡一小時**(「重寄」要停擺 >24h;見上方自我更正)。
  //    ⇒ 停止寄送的時點要**早於**平台 kill,把最後這段留給收尾。
  //    ⚠️ 這一格是**縱深不是保證** —— 擋不住一發自己就超過餘裕的 `send`(那是逾時設定的事)。
  //    `Math.max(1000, …)` = 防呆:`maxRunSeconds` 若小於餘裕,預算不得變成 0 或負
  //    (那會是「永遠不寄、而且安靜」)。
  const budgetMs = Math.max(1000, (opts.maxRunSeconds - SEND_TAIL_ALLOWANCE_SECONDS) * 1000);
  //
  //
  // 🛑 **已知殘餘,而我【沒有修】**(codex R1 must-fix 1;界線經 R2 收窄過,見下)。
  //    這道閘讀的是**牆鐘**。系統鐘若在本輪中途被回撥 Δ,已用時間就少算 Δ
  //    ⇒ **預算等於被延長 Δ**;Δ 大於「到目前為止真正花掉的時間」時 elapsed 才會變負。
  //    ⚠️ **我第一版把這句寫成「預算等於不存在」= 寫過頭了**(codex R2 must-fix)——
  //      小幅回撥只是等量延後,不是把閘整個關掉。**一句誇大的殘餘描述,會讓下一個人
  //      把力氣放在錯的地方。**
  //    🔴 **我也加過一段「已用時間高水位 ratchet」想擋它,而它【改變不了任何結果】**:
  //      這道閘一旦回 true,呼叫它的那四個點就不會再問第二次
  //      (認領前 = 不認領、迴圈直接沒得跑;迴圈頭 / 合格性讀完 / 脈絡讀完 = `break`)
  //      ⇒ ratchet 只可能在「還沒超出而被回撥」時改到那個變數的**數值**,
  //        **永遠改不到最終那個布林**。⚠️ 措辭經 R2 修正:~~「不可達的死碼」~~ 不精確
  //        —— 它跑得到,只是**跑了也沒有用**。
  //      📌 而它在測試上是綠的 —— 把它拿掉,一格都不會紅。
  //    ⇒ 留下的是界線,不是一段看起來有在防的碼:
  //      · 傷害**有上界**:單輪最多 `claimLimit` 封(= 一個健康輪次本來就寄得掉的量);
  //        超出的部分由平台 kill ⇒ 列留 sending ⇒ 下輪回收
  //        ⇒ 落回本系統**已申告且 Sean 明示認可的 at-least-once**(見檔頭)。
  //      · 它**在本片之前就存在**(舊基準 `sweepStartedAt` 同樣是牆鐘)⇒ 不是本片新開的洞。
  //      · 真正的解 = 預算改用**單調時鐘**(`performance.now()`),而那要換掉 `now` 這個
  //        注入縫的語意(它同時餵 staleBefore / nextRetryAt,那兩個必須是牆鐘)
  //        ⇒ 是另一片的體積,不在這裡順手做。
  /**
   * 時間預算已用盡?(單一來源)。**五個問點**:認領前 / 迴圈頭 / 合格性讀完之後 /
   * **付款脈絡讀完之後**(2026-09-01 片2 新增)/ 出貨脈絡讀完之後
   * —— ⚠️ 第四個(出貨那個)原本漏在這段註解外(codex R2 nit),而它正是
   * `order_shipped` 那條線唯一的那一道。
   * ⛔ ~~原本寫「四個問點」~~ ⇒ 片2 加了第五個而我沒改這句(code-reviewer 2026-09-01 抓到)。
   * 📌 **而這段註解正是下一個人拿來【數】的東西** —— 它少一個,下一個人就會以為沒有那一道。
   */
  const outOfBudget = (): boolean => now().getTime() - budgetBaseMs >= budgetMs;

  // ── ② claim due(CAS 認領;輸家/死列由 port 述詞處理)──────────────────────────────
  let jobs: ClaimedEmailJob[] = [];
  // 🔴🔴 **預算已經用完就【不要認領】**(`⟦b4-SWEEPBUDGET1⟧` 的第二半)。
  //    認領當下 `attempts` 就 +1 ⇒ 認領了卻一封都寄不出去 = 白燒一次重試額度,
  //    而那些列還會留在 `sending` 等下輪回收。**這條路在本片之前不存在**
  //    (預算從本函式自己起算 ⇒ 進來時必然還有滿滿的額度),是把基準換成 route 碼表之後
  //    才變得可達的 ⇒ 所以它跟預算基準同一片修,不另開一列。
  // 🔴 **計 error 是刻意的**:一輪連認領都排不進去 = 前面那兩段 enqueue 吃掉了整個預算,
  //    那是設定或量級不對,應該吵(route `errors > 0` ⇒ 503 ⇒ 心跳掉 ⇒ 儀表變紅)。
  //    ⚠️ 不用 `deferred` —— 那一顆的語意是「**已認領**而來不及寄」,這裡一列都沒認領。
  if (outOfBudget()) {
    result.errors++;
    // 🔴 與「claimDue 自己 throw」分家的那一格(codex R3 must-fix)——
    //    兩者的 errors/claimed/sent 完全相同,只有這一欄說得出是哪一種。
    result.budgetExhaustedBeforeClaim = 1;
  } else {
    try {
      /**
       * ⟦b4-SHIPGATE1⟧ 2026-09-01:**線關著時,連認領都不要認領。**
       *
       * 🔴 舊行為:認領 ⇒ `attempts` +1、落 `sending` ⇒ 走到 `:750` 那道閘被擋 ⇒ `continue`
       *    ⇒ 不呼叫任何 `mark*` ⇒ **留在 `sending`,而 `sending` 不可再認領**
       *    ⇒ 每【回來一次】要等一輪租約回收(route 端 3600 秒)+ 一次退避(5 分)= 1h05m
       *    🔴 **而【attempts 用完】與【進死信】是兩個時點, 不要合成一句**(codex R2):
       *       `t≈4h20m` 第 5 次認領 = attempts 用完 · `t≈5h20m` 再等最後一次回收才成 `failed@max`。
       *       ⇒ 全文推導在 `:750` 那道閘旁邊(單一來源, 這裡不重複第二份)。
       * 🛑 而 `:750` 那道閘**留著** —— 不認領是省成本,不寄是保正確。
       *    ⛔ ~~「旗標讀取壞掉時第二道還在」~~ **假的**(codex 2026-09-01):
       *    **兩道同一顆 `allowOrderShipped`** ⇒ 旗標錯的世界裡兩道一起錯。
       *    ✅ 第二道守的是**實作違約**(adapter 忽略 opts / 換一個沒實作它的 port)。
       */
      jobs = await outbox.claimDue(
        opts.claimLimit,
        // 🔴 **⟦5b-TRACKNUMGAP1⟧ 片 C 一起進來**(codex 對抗審查 must-fix):
        //    更正信是**出貨線的下游** —— 它的前提就是「客人收過出貨信」。
        //    ⇒ 🎯 「設了 env、看到不對、把它拿掉」的意思是【整條出貨線停下來】,
        //      而少了這一格, **已經入隊的更正信照樣被認領、照樣寄出去**, 而信收不回來。
        //    🛑 我在 route 那一層擋了 enqueue, 而**那只擋得住還沒進佇列的**。
        opts.allowOrderShipped
          ? undefined
          : { excludeEventTypes: ['order_shipped', 'shipment_tracking_corrected'] },
      );
    } catch {
      result.errors++;
    }
  }
  result.claimed = jobs.length;

  // ── ③ 逐封順序寄送 → mark(世代柵欄 = job.attempts 原樣帶回)─────────────────────
  for (let i = 0; i < jobs.length; i++) {
    // 時間預算(縱深、擋不住單一 await 懸掛=檔頭誠實揭示):超過申告上界即停寄,
    // 剩餘已認領列留 sending 交下輪 ① 回收。
    if (outOfBudget()) {
      result.deferred = jobs.length - i;
      break;
    }
    const job = jobs[i]!;

    // ── 寄送前合格性閘(Sean 2026-08-30 拍「Q2 取消信縫 = 甲 搬」)────────────────
    // 🔴 **逐封讀,不在迴圈前讀一次批次快照**(codex 2026-08-30 must-fix):
    //    批次快照的話,第 50 封寄出去時那份快照已經是 49 封之前的 ——
    //    ⇒ 窗口是【單輪的長度】(claimLimit=50、順序寄送 ⇒ 最多約 60 秒),不是毫秒級。
    //    📌 而註解當時寫的是「毫秒級」⇒ **那句話會讓下一個人以為這個洞比實際上小一個量級。**
    //    ⇒ 改成逐封:量級是每日 10-30 封、單輪上限 50 ⇒ 最多 50 次小查詢,成本可忽略,
    //      而它把窗口真的收到【這一封的讀取與 send 之間】。
    let ineligible: boolean;
    try {
      // 🔴🔴 **取消信【不問這道閘】—— 而那不是例外, 是規則的形狀**(Q10 前置;R1 C2)。
      //    那道閘擋的是「已取消/已退款的單, 不要再寄通知」;
      //    🎯 **而取消通知本身正是那條規則的例外** —— 擋它 = 擋掉我們唯一要說的那句話。
      //    ⛔ ~~原本無條件問~~ ⇒ 每一封取消信 100% 被標 `skipped_order_ineligible`,
      //      **而那是終態、不計 error、【沒有自動告警在看】**(⚠️ 不是「查不到」——後台 `email-log-view.ts` 逐單看得到,而那要有人去查;codex nit 2 訂正我原本過度絕對的字面) ⇒ 一整條做完的線看起來像做完了, 而一封都沒寄。
      //    ✅ 判斷來自 `SUPPRESS_WHEN_ORDER_INELIGIBLE`(窮舉 `Record`)⇒ **加新 event_type
      //      而沒標那一格 ⇒ typecheck 當場紅**(實測:`Property 'zzq_fake_event' is missing`)。
      //    ⚠️ 而**既有兩封信的行為逐字不變** —— 它們兩個都標 `true`。
      //    🛑 **未知 event_type ⇒ 當成【該擋】**(`!== false`)—— 而我第一版寫成 `[…] ?` 是 **fail-open**,
      //      它就寫在下面那段「讀不到 ⇒ fail-closed」的正上方(code-reviewer N6 / codex nit 3)。
      //      ⚠️ DB 先加值而 code 還沒跟上是本 repo **明文預期**的順序(見 `IEmailOutbox` 檔頭)
      //      ⇒ 那一刻不該讓它悄悄溜過這道閘。
      ineligible = SUPPRESS_WHEN_ORDER_INELIGIBLE[job.eventType] !== false
        ? (await ineligibleScanner.listIneligibleAmong([job.orderId])).length > 0
        : false;
    } catch {
      // 🔴 **讀不到 ⇒ 這一封不寄(fail-closed)**,而不是「當作合格」:
      //    這道閘唯一的用途就是攔住不該寄的信 —— 讀失敗時放行,等於它在最需要它的那一刻消失。
      //    ⚠️ **而爆炸半徑只有這一封**(先前的批次寫法會讓一次抖動把整輪 50 列全留在 sending)。
      //    列留 sending ⇒ 下輪 ① 回收。⚠️ **已知邊界(codex 抓、不藏)**:若這一列此刻
      //    `attempts` 已達上限,回收會讓它直接進死信 —— **一封從未交給 provider 的信就這樣死掉**。
      //    ⇒ 那是既有回收機制的性質,不是本閘造成的;而本閘讓它多了一條抵達路徑,所以寫出來。
      result.errors++;
      result.eligibilityUnknown++;
      continue;
    }

    // 🔴 codex R2 must-fix:**合格性那一發 `await` 本身會穿越 deadline** ——
    //    它可能在 59.9 秒開始、60 秒之後才回來,而迴圈頭那一問是【它開始之前】問的。
    //    ⇒ 讀完之後【再問一次】才呼叫 Resend。少了這一格:平台在 send 途中 kill
    //      ⇒ 列留 sending、白燒一次 attempt,而**外觀與正常的 deferred 分不出來**。
    //    📌 判別句:**每一個會等的 await,都可能讓它前面那一次時間檢查過期。**
    if (outOfBudget()) {
      result.deferred = jobs.length - i;
      break;
    }

    // 不合格 ⇒ 不寄,標 skipped(CAS 世代柵欄;柵欄沒對上 = 別人接手了,非錯誤)。
    if (ineligible) {
      try {
        const owned = await outbox.markSkippedOrderIneligible(job.id, job.attempts);
        if (owned) result.skippedIneligible++;
        else result.staleMarks++;
      } catch {
        result.errors++;
      }
      continue;
    }

    // ── 出貨通知信的【寄送當下讀取】(M-4b E4 片3b;`IShippedEmailContext`)──────────
    // 🔴 **為什麼在寄送當下才查、不從 payload 讀**:追蹤碼與品項都是**後台可改的欄**,
    //    入列當下凍住的值在員工改過之後就是舊的,而**信寄出去收不回來**(port 檔頭全文)。
    // 🔴 **這一段就是把那個「建構了、注入了、一次都沒有被呼叫」的依賴接上** ——
    //    在本片之前 `shippedContext` 是一個 **建構後閒置** 的 dep(`IShippedEmailContext` 檔頭
    //    把那個狀態拆成三行寫著)。
    // ── 付款成功通知信的【寄送當下讀取】(M-4b 片2;`IPaidEmailContext`)────────────
    // 🔴 **這一段把第二個「建構了、匯出了、一次都沒有被呼叫」的依賴接上** ——
    //    `IPaidEmailContext` 檔頭把那個狀態拆成三行寫著,而 ③ 那一格逐字是
    //    「**沒有** —— 零 `loadPaidContext` 呼叫端」。本片就是那一格。
    //
    // 🔴🔴 **而接上它會讓一些【今天收得到信】的單從此收不到** —— 那是 port 明文要的:
    //    `kind:'unavailable'` 逐字「呼叫端**必須 fail-closed:不寄、計 error**」,
    //    而它禁止退化(「不得退化成『就把撈到的印上去』—— 一封金額是 0 的付款確認信,
    //    客人看不出是系統壞了還是他被多收了」)。
    //    ⇒ 📌 **而那個代價只有在【信裡真的有金額】時才划算** ——
    //      所以本片把「拿資料」與「把資料放進信裡」放在**同一顆 commit**:
    //      🛑 若只做前半,那些單會從「收得到純文字」變成「一封都收不到」,而信的內容一個字沒變。
    let paid: PaidEmailContext | null = null;
    if (job.eventType === 'order_created' && deps.paidContext !== undefined) {
      // 🔵 **沒注入 dep ⇒ 維持今天的行為**(純文字、照寄)—— 與 `shippedContext` 那一欄同款:
      //    「不給」是一個有意義的狀態,而它在這裡的意思是**還沒接線**,不是「不寄」。
      let loadedPaid: LoadPaidContextResult;
      try {
        loadedPaid = await deps.paidContext.loadPaidContext({ orderId: job.orderId });
      } catch {
        result.errors++;
        continue;
      }
      if (loadedPaid.kind === 'cancelled') {
        // 🔴🔴 **這一格是【已知偏離 port 合約】,而它是刻意的 —— 全文寫在這裡,不要當疏漏。**
        //
        // port(`IPaidEmailContext.ts` 的 `cancelled` 那一段)要的是:
        //   不寄 + 標終態 + `last_error_code = 'order_ineligible_at_send'`,
        //   而它逐字寫著「**為什麼不沿用既有的 `order_ineligible`**(主視窗 2026-08-24 裁【乙】):
        //   沿用會讓上游那道閘變成**看不見的** —— 補完之後沒有人知道它還有沒有在做事。」
        //
        // ⛔ ~~我第一版呼 `markSkippedOrderIneligible`~~ —— 而那支 adapter **內部寫死**
        //    `last_error_code: 'order_ineligible'` ⇒ **正好是那個乙禁止的合併**
        //    ⇒ 兩層落同一個碼 ⇒ port 要的那個【比值】永遠算不出來。(code-reviewer 2026-09-01 抓到。)
        //
        // 🛑 **而合規的做法要開一支新的 outbox 方法**(`markSkippedOrderCancelled`)——
        //    那是動 `IEmailOutbox` 這個**金流鄰居的 port** ⇒ 鐵則 8,要 plan + 批准,
        //    而本片沒有那個批准。⇒ **所以這一格【不寫那段碼】,而不是寫一段違反拍板的碼。**
        //
        // ⛔ ~~⇒ 現況:與 `unavailable` 同路(計 error、不寄、不標記)。**而它的代價要明寫**:
        //    一列持續 `cancelled` 的單會每輪燒一次 attempt、約 5 輪進死信 —— 而那正是 port
        //    警告的那個坑。⚠️ **今天不可達**:①`paidContext` 還沒有人注入(`composition.ts` 未建構)
        //    ②上游逐封閘 `listIneligibleAmong` 的述詞已含 `cancelled_at IS NOT NULL`
        //    ⇒ 這條只吃得到兩次讀取之間那幾毫秒。~~
        // 🔴 **而「今天不可達」不是理由,是【期限】** —— 誰把 `paidContext` 接進 composition,
        //    誰就要先把那支新方法開出來。落點:`⟦b4-MAILCANCEL1⟧`(要開)。
        //
        // ✅ **2026-09-02:那個期限到了, 而批准也有了 ⇒ 本格改成合約要的樣子。**
        //    · Sean 11:0x 拍【乙 = 現在做 HTML 付款信】⇒ 而那一片的硬前置就是本格
        //    · 上面那句「本片沒有那個批准」⇒ **今天有了** ⇒ 舊字面留著加刪除線, 不刪
        //    🔴 **而它現在標的是【終態】不是 error**:
        //      `markSkippedOrderCancelled` ⇒ status `skipped_order_ineligible`
        //      + `last_error_code = 'order_ineligible_at_send'`(態沿用 ⇒ 零 migration;
        //        而**分得開的是碼不是態** —— 全文在 `IEmailOutbox` 那支的 docstring)
        //    ⇒ ⇒ 那一列**離開 due 集合** ⇒ 不再每輪 attempts+1 ⇒ **不會進死信**
        //    🛑 **而它【不計 error】** —— 一張被取消的單不寄信是【正常的業務動作】,
        //      計 error ⇒ `errors>0` ⇒ route 回 503 ⇒ 有人半夜起來查一件正常的事
        //      (`IEmailOutbox.ts:344-345` 逐字警告過同一個坑)。
        //    ⚠️ 而 `unavailable`(系統壞了)那一格**照舊計 error** —— 兩者刻意分開,
        //      合併它們正是這一刀最容易犯的錯。
        //    🔵 形狀逐字照抄同檔 `:676-682` 那一格(`markSkippedOrderIneligible`),
        //      而**三件事都要跟著抄, 少一件就不是同一個保護**:
        //      ①`try/catch` —— 標記本身失敗要計 error(那是真的壞了)
        //      ②**CAS 世代柵欄**:回 `false` = 別人接手了 ⇒ `staleMarks++`, **不是** error
        //      ③計數落在 `skippedIneligible` —— 態相同 ⇒ 同一個計數欄, 而分得開的是 `last_error_code`
        try {
          const owned = await outbox.markSkippedOrderCancelled(job.id, job.attempts);
          if (owned) result.skippedIneligible++;
          else result.staleMarks++;
        } catch {
          result.errors++;
        }
        continue;
      }
      if (loadedPaid.kind === 'unavailable') {
        // 🔴 「讀不到」**應該吵** —— 它與 `cancelled` 分開,正是因為
        //    「系統壞了」與「這張單本來就被取消了」不可以在呼叫端變成同一件事。
        result.errors++;
        continue;
      }
      // 🔴 **載不完 ⇒ 不寄**(`paid-email-html.ts` 的 `renderPaidEmailHtml` 檔頭逐字把這道
      //    fail-closed 推回呼叫端:「一封少了兩項的信,與一封正常的信,在這裡長得一模一樣」)。
      //    ⚠️ 空品項 port 說會走 `unavailable`,而那是**它的**保證不是我們的 ⇒ 一併擋。
      if (loadedPaid.context.linesTruncated || loadedPaid.context.lines.length === 0) {
        result.errors++;
        continue;
      }
      paid = loadedPaid.context;
      // 🔴 同下方 shipped 那一格的理由:**上面那一發 `await` 可能穿越 deadline**。
      if (outOfBudget()) {
        result.deferred = jobs.length - i;
        break;
      }
    }

    // 🔴🔴 **更正信共用同一支剎車**(codex 對抗審查 must-fix;⟦5b-TRACKNUMGAP1⟧ 片 C)。
    //    與 order_shipped 那道同形、同理由:**不認領是省成本, 不寄是保正確。**
    //    🔴 **它必須排在【比對即時值】那道之前** —— 那一道會 `loadShippedContext()` 去查主表,
    //      而線關著的時候**不該去查這一封信要用的那幾張表**(這一格是測試逼出來的:我第一版放在它後面,
    //      ⚠️ ⛔ ~~「連查主表都不該發生」~~ **那句太寬**(codex R2 nit #10):本閘在 **ineligible scan 之後**
    //      ⇒ 那一發 DB 查詢照樣發生。📌 精確的宣稱是「不查這一封的那幾張表」, 不是「不碰 DB」。
    //      斷言「不該查主表」當場紅)。
    //    上面 `claimDue` 已經把它排除掉了 ⇒ 正常情況下這一格不會被走到;
    //    ⇒ 📌 **它守的是【實作違約】** —— adapter 忽略 `excludeEventTypes`、
    //      或換一個沒實作它的 port。⇒ 兩道一起錯的世界只有「旗標本身讀錯」那一種。
    if (job.eventType === 'shipment_tracking_corrected' && !opts.allowOrderShipped) {
      result.errors++;
      continue;
    }

    // 🔴🔴 **更正單號那封信:寄送當下比對即時值**(⟦5b-TRACKNUMGAP1⟧ 片 C;主視窗 2026-09-04 拍甲)。
    //
    //    掃描器是 cron ⇒ enqueue 到寄出之間有一段時間。員工在那段時間裡又改了一次(A→B→C):
    //    B 那一列的 payload 帶著 B ⇒ 它會寄一封說「正確的貨運單號:B」——**而那時候正確的是 C**,
    //    🛑 **而那封信裡還寫著「請以這一封為準」** ⇒ 客人拿到一個**被我們背書過的錯號碼**, 收不回來。
    //
    // 🔵 **為什麼放在這裡而不是排信那一端**:排信那端**看不到未來**——
    //    它入隊的那一刻 B 就是對的。⇒ 📌 **唯一知道「它已經不對了」的時刻是【寄出的前一秒】。**
    if (job.eventType === 'shipment_tracking_corrected') {
      const shipmentId = readShipmentId(job.payload);
      const enqueuedTracking = readTrackingNumber(job.payload);
      const enqueuedKey = readTrackingCorrectedKey(job.payload);
      if (
        deps.shippedContext === undefined ||
        shipmentId === null ||
        enqueuedTracking === null ||
        enqueuedKey === null
      ) {
        // 🔴 拿不到比對的兩端 ⇒ **不寄**(fail-closed)。少了任何一端, 我們就不知道它是不是還對。
        result.errors++;
        continue;
      }
      let live: LoadShippedContextResult;
      try {
        live = await deps.shippedContext.loadShippedContext({ orderId: job.orderId, shipmentId });
      } catch {
        result.errors++;
        continue;
      }
      // 🔵 箱作廢了 ⇒ 走既有那條(它的單號不會再被任何人看到)。
      if (live.kind === 'voided') {
        try {
          const owned = await outbox.markSkippedShipmentVoided(job.id, job.attempts, job.dedupKey);
          if (owned) result.skippedShipmentVoided++;
          else result.staleMarks++;
        } catch {
          result.errors++;
        }
        continue;
      }
      if (live.kind !== 'ok') {
        result.errors++;
        continue;
      }
      // 🔴🔴 **比的是【這一次更正的身分】, 不是號碼**(主視窗 2026-09-04 拍 Q1 甲的另一半)。
      //    ⛔ ~~原本比 `live.context.trackingNumber !== enqueuedTracking`~~ —— 那個比法
      //      在 **A→B、B→C、再改回 B** 之下會**寄兩封**:第一封與第三封的號碼相同,
      //      而它們是**兩次不同的更正**。⇒ 拍板要的是「只寄最後對的那封」。
      //    ✅ 改成:庫裡的最後一次更正時點 **晚於** 這份工作單的那一次 ⇒ 它被取代了。
      // 🛑 **兩端拿不到就 fail-closed** —— 少了任何一端我們就不知道它還是不是最新的,
      //    而寄一封過期的更正信 = 我們親手背書一個錯號碼。
      const liveKey =
        live.context.trackingCorrectedAt === null
          ? null
          : isoToCorrectedKey(live.context.trackingCorrectedAt);
      if (liveKey === null) {
        // 🔴 拿不到庫裡那一次更正的身分 ⇒ 我們不知道這份工作單還算不算數 ⇒ 不寄。
        result.errors++;
        continue;
      }
      // 🔴 **不相等就不放行, 不分方向**(codex R2 must-fix #5):
      //    上一版只擋 `live 比較新`, 而 **live 比較舊**(時鐘回撥 / 讀到舊快照)+ 號碼剛好相同
      //    ⇒ 照樣寄。而「不確定它是不是最新的」與「它確定是舊的」對客人是同一件事。
      if (liveKey !== enqueuedKey) {
        // 🔴 **被更新的號碼取代** —— 跳過, 而**留下一筆看得見的紀錄**(主視窗明文要求:不是靜默跳)。
        try {
          const owned = await outbox.markSkippedTrackingSuperseded(
            job.id,
            job.attempts,
            job.dedupKey,
          );
          if (owned) result.skippedTrackingSuperseded++;
          else result.staleMarks++;
        } catch {
          result.errors++;
        }
        continue;
      }

      // 🔴🔴 **第二道:號碼本身也要對得上**(測試逼出來的回歸)。
      //    上面那道改成比【時點】之後, 「庫裡根本沒有號碼」這個世界就漏掉了 ——
      //    ⛔ 舊的比號碼版本靠 `null !== 'B-0002'` 順手擋住它, 而**那是副作用不是設計**。
      //    ⇒ 📌 這封信的內容就是那個號碼;庫裡是空的而我們寄出「正確的單號是 B」,
      //      等於我們**替一個已經不存在的值背書**。⇒ fail-closed, 不寄。
      // 🔵 而它與上面那道的差別要講清楚:
      //    · 上面 = **預期中的狀態**(有更新的更正)⇒ 落 skipped、留紀錄、不計 error
      //    · 這裡 = **對不上的狀態**(不該發生)⇒ 計 error、讓它吵
      if (live.context.trackingNumber !== enqueuedTracking) {
        result.errors++;
        continue;
      }
    }

    let shipped: ShippedEmailContext | null = null;
    if (job.eventType === 'order_shipped') {
      // 🔴🔴 **這條線沒上膛 ⇒ 不寄**(codex R1 must-fix 1;見 `allowOrderShipped` 的 JSDoc)。
      //    **在讀任何東西之前就擋** —— 線關著的時候連查主表都不該發生。
      //    ⇒ 這一格讓「env 沒設 ⇒ 一封都不寄」從**只對排信那一半成立**變成**對整條線成立**。
      if (!opts.allowOrderShipped) {
        result.errors++;
        continue;
        // 🛑🛑 **已知代價,codex 2026-08-30 R2 抓出,而我【沒有修】—— 理由在下面** 🛑🛑
        //
        // ✅✅ **2026-09-01 `⟦b4-SHIPGATE1⟧` 已修:`claimDue` 現在收 `excludeEventTypes`**
        //    ⇒ 線關著時**根本不認領** `order_shipped` ⇒ 下面這一段描述的是【修之前】的行為。
        //    🛑 而這道閘**留著**:不認領是省成本,不寄是保正確。這裡忘了傳時第二道還在。
        //
        // **這道閘在 `claimDue` 【之後】才擋** ⇒ 線關著的期間,佇列裡的 `order_shipped` 列
        // 每一輪都會被認領一次(`attempts` 在認領當下就 +1)、被這裡擋下、留在 `sending`、
        // 下一輪被回收 ⇒
        // ⛔ ~~**約 25 分鐘後燒完 5 次 attempts ⇒ 進死信**~~
        // 🔴🔴 **那個 25 分鐘是錯的,而它低估了約 10 倍**(2026-09-01 逐行推導):
        //    `continue` **不呼叫任何 `mark*`** ⇒ 那一列留在 `sending`;
        //    而 5 分鐘那個退避是 `markFailed` **之後**才套的 ⇒ **這條路走不到它**;
        //    而 `sending` **不在** `CLAIMABLE_STATUSES`(`['pending','failed']`)⇒ 下一輪撿不到
        //    ⇒ 唯一出路是 `reclaimStaleLeases`(`claimed_at < now − LEASE_SECONDS`)
        //    ⇒ **每【回來一次】≈ `LEASE_SECONDS` + 退避(route 端 3600 秒 + 5 分 = 1h05m)**
        //
        //    🔴🔴 **而【三個時點要分開,不要合成一句】**(codex 2026-09-01 must-fix ——
        //       而它指的正是我上一版的錯:**我把「attempts 用完」與「進死信」合成同一刻**):
        //       ```
        //       t=0       第 1 次認領(attempts 1)—— 它本來就 due, 不用等回收
        //       t≈1h05m   第 2 次 … 每次 = 一輪租約回收 + 一次退避
        //       t≈4h20m   **第 5 次認領 = attempts 用完**(4 × 1h05m)
        //       t≈5h20m   **再等最後一次回收, 它才變成 failed@max ⇒ 進死信**
        //       ```
        //    ⚠️ **⇒ 「attempts 用完」與「進死信」差【一整輪回收】** —— 而它們在
        //       「約 5 小時」這句話底下長得一樣。
        //    📌 **⇒ 而我上一版就是這樣寫的。⇒ 同一個病:兩個時點被一句話合併。**
        //       ⇒ **⇒ 而我上一版正是在【修同一種病】(舊註解的「25 分鐘」)的時候犯的。**
        //    📌 **⇒ 而舊那個數字的傷害不是不準 —— 是它會【讓人決定不做】。**
        //       一個沒有數字的描述會讓人去算;而看到「25 分鐘」的人不會。
        // ⚠️ 另一半:它們**佔著 `claimLimit` 的格子** ⇒ 線關著時會延遲 `order_created` 的信。
        //
        // ⛔⛔ **2026-09-02 就地訂正:下面那段【今天是假的】—— 而舊字面不刪,見最後一段。**
        //    ✅ **`claimDue` 現在【有】那個參數,而三層都接上了**(`-c7` 逐格開檔複驗,非轉述):
        //      · `packages/ports/src/IEmailOutbox.ts:279` —— `claimDue(limit, /* ⟦b4-SHIPGATE1⟧ …
        //        **不要認領這些事件型別。** */)`
        //      · 本檔 `:622-625` —— `opts.allowOrderShipped ? undefined : { excludeEventTypes: ['order_shipped'] }`
        //      · `packages/adapters/src/email/SupabaseEmailOutboxAdapter.ts:397` —— `q.neq('event_type', exclude[0])`
        //    ⇒ 📌 **所以「正解是不要認領它們」那句仍然對, 而「還沒做」那句已經不對。**
        //
        // 🔴🔴 **而它為什麼會變假, 那一格比訂正本身值錢**:
        //    這段話當初**完全正確**。它變假的那一刻,是【**另一個人把它修好**】的那一刻 ——
        //    而修好它的人**不知道這段話存在**。
        //    ⇒ 📌 **一句「我沒有做 X」的話, 會在【別人做了 X】的那一刻靜靜變成假的,**
        //      **而那個人沒有理由來改它。**
        //    🛑 **⇒ 而這一段的位置讓它更貴**:它就在**修好它的那段碼下面約 180 行** ——
        //      一個人打開這支檔查「這件做了沒」, 這裡會直接回答他【沒做】,
        //      **而他不會再往上翻 180 行。**⇒ `-0e` 差一點照著它把已經做完的事再做一次。
        //    ✅ **⇒ 所以舊字面【加刪除線留著、不刪】** —— 搜舊句的人要在同一發撞到這段訂正。
        //
        // ⛔ ~~**為什麼沒有在這一片修**:正解是【不要認領它們】,而 `claimDue(limit)` 沒有~~
        // ⛔ ~~事件型別參數 ⇒ 要改 `IEmailOutbox` 這個 port(鐵則 8:動 API / 共用契約)。~~
        // ⛔ ~~在一個 codex 迴圈裡順手改一個金流鄰居的 port,正是 R4 換路訊號說的那種事。~~
        //    🔵 **而那個判斷在當時是對的** —— 它沒有順手改 port, 而是把它記下來、留給有批准的人做。
        //      ⇒ **訂正的是「現在做完了沒」, 不是「當初該不該做」。**
        // ⚠️ **而它【不是靜默的】**:每一輪 `errors > 0` ⇒ route 回 503 ⇒ 心跳掉
        //    ⇒ 後台儀表 `pcm-email-sweep` 變紅。**看得到,只是救不回那幾列。**
        // 📌 **⇒ 觸發條件是「線開過、又關掉」** —— 從未開過就不會有列,所以今天不可達;
        //    而**第一次開了又關的那個人會踩到它**。
        // ⇒ 落點:`docs/launch-todo.md` 的 `⟦b4-SHIPGATE1⟧`。
      }
      const shipmentId = readShipmentId(job.payload);
      // 🔴 沒注入 dep、或 payload 撈不到 shipment_id ⇒ **fail-closed**(不寄、計 error)。
      //    ⚠️ 不得退化成「寄一封沒有箱號沒有品項的通用信」——
      //    那是 `20260805170000` 的 COLUMN COMMENT 逐字禁止的。
      if (deps.shippedContext === undefined || shipmentId === null) {
        result.errors++;
        continue;
      }
      let loaded: LoadShippedContextResult;
      try {
        loaded = await deps.shippedContext.loadShippedContext({ orderId: job.orderId, shipmentId });
      } catch {
        result.errors++;
        continue;
      }
      if (loaded.kind === 'voided') {
        // 🔴 **箱被作廢 = 正常業務動作,不計 error** —— 落一列痕跡就好。
        //    合併進 error 的話,route 會 503、死人開關會叫,而**有人半夜起來查一個
        //    員工按了「作廢重開」的箱子**(`IShippedEmailContext` 檔頭推的那條失敗鏈)。
        //    ⚠️ 而**不可以靜默丟掉**:少了痕跡,「這封信為什麼沒寄」日後查不到任何東西。
        //
        // 🛑🛑 **而落下那個痕跡本身有一個已知代價(codex 2026-08-30 R2;本片【沒有修】)**:
        //    箱被 `admin_unvoid_shipment` 用**同一個 id** 復原之後,出貨信掃描 view 的
        //    anti-join **不分 status** ⇒ **這一列會永久佔住去重鍵** ⇒ 不會有新的一列被排進去
        //    ⇒ **那位客人永遠收不到出貨信,而狀態是「跳過」不是「失敗」⇒ 沒有任何 dead-man 訊號會命中。**
        // 🔴 **而「復原做不到」是一個過期的印象**:Sean 2026-08-14 曾拍
        //    `Q-452-換路 = C`(只做作廢、不做取消作廢)—— 而今天
        //    `apps/admin/src/components/orders/shipment-void-button.tsx:43` 就在呼叫
        //    `unvoidShipmentAction` ⇒ **員工在畫面上按得到。這不是理論上的洞。**
        // ⇒ 追蹤落點 `docs/launch-todo.md` 的 `⟦b4-SHIPUNVOID1⟧`。
        //    ⚠️ 那一列是 2026-08-30 才建的 —— migration `20260830060000:142` 的 COMMENT
        //    逐字寫著「單獨開一列追蹤」,而查證當下**那一列並不存在**。
        //    📌 **一句「已另外追蹤」會讓讀到它的人停止追蹤。**
        try {
          // 🔴 `job.dedupKey` 要傳進去 —— 實作會把它退休(⟦b4-SHIPUNVOID1⟧)。
            //    少了它,那位客人的出貨信會永遠不排,而**沒有任何東西會叫**。
            const owned = await outbox.markSkippedShipmentVoided(
              job.id,
              job.attempts,
              job.dedupKey,
            );
          if (owned) result.skippedShipmentVoided++;
          else result.staleMarks++;
        } catch {
          result.errors++;
        }
        continue;
      }
      if (loaded.kind === 'unavailable') {
        // 🔴 「讀不到」**應該吵** —— 它與上面那個 `voided` 分開,正是因為
        //    「系統壞了」與「這箱本來就作廢了」不可以在呼叫端變成同一件事。
        result.errors++;
        continue;
      }
      // 🔴 **載不完 ⇒ 不寄**(port 檔頭:`linesTruncated` 為 true 時呼叫端必須 fail-closed)。
      //    **少列幾項的信與正常的信長得一模一樣** —— 客人照著清單對,少的那一項他不會知道要問。
      // 🔴 **空品項一併擋**:port 說「這張單在這箱 0 項」會走 `unavailable`,而那是**它的**保證,
      //    不是我們的 —— 真的漏過來的話,客人會收到一封「本批出貨內容:」底下什麼都沒有的信。
      if (loaded.context.linesTruncated || loaded.context.lines.length === 0) {
        result.errors++;
        continue;
      }
      shipped = loaded.context;

      // 🔴 同 codex R2 那一格的理由:**上面那一發 `await` 可能穿越 deadline**。
      //    每一個會等的 await,都可能讓它前面那一次時間檢查過期。
      if (outOfBudget()) {
        result.deferred = jobs.length - i;
        break;
      }
    }

    // 🔴🔴 **在 try 之外組 HTML**(code-reviewer 2026-09-01 must-fix)——
    //    我第一版把 `renderPaidEmailHtml(paid)` 寫在 `sender.send({...})` 的參數裡,
    //    而那整段在 `try` **裡面** ⇒ **模板 throw 會落進下面那個 catch**,
    //    而那個 catch 的語意是「寄送失敗」⇒ 它與 provider 故障在計數上**同形**,
    //    列留 `sending`、每輪重燒 attempts ⇒ 📌 **一個模板 bug 會長得像 Resend 掛了。**
    //    ⇒ 提出來之後:模板 throw 會往上冒到 per-job catch 之外 —— 那是對的,
    //      因為它是**程式錯誤**,不是可重試的寄送失敗。
    // 🔴🔴 **`logoUrl: ''` 是【明確不印】, 不是「沒給」**(`-7a` 2026-09-01 補)——
    //    ⚠️ 下面那段「三格全部不給」的註解**寫的當下是真的**, 而它後來被我(`-7a`)弄假了:
    //    `002105c4` 給 `PaidEmailChrome.logoUrl` 加了**預設值** `PCM_EMAIL_LOGO_URL`
    //    ⇒ **`renderPaidEmailHtml(paid)` 不給 chrome 會拿到那個預設 ⇒ 圖會印出去。**
    //    ⇒ 實測(照這條路一模一樣的呼叫):`<img>` 出現 **1** 次、logo 網址 **1** 次
    //      (而付款時間 0 · CTA 0 ⇒ 那兩格如原註解所述, 只有 LOGO 那一格變了)。
    //    🛑 **⇒ 而它推翻的是這一顆明說的設計:「只讓變數有【一個】」** ——
    //      多一張外連圖 = 第二個對外變數, 而沒有人同意過它。
    //    ✅ 所以這裡**明確傳空字串**, 讓那句話重新成立。
    //      🔴 用 `''` 不是 `undefined` —— 物件解構的預設只認 `undefined`,
    //        傳 `undefined` 會拿到預設值(模板檔頭有寫, 這裡重述是因為**這裡是踩得到的地方**)。
    //    ⇒ 📌 而下一顆要開圖:把 `logoUrl: ''` 拿掉即可, **一行**。
    //
    //    🔴🔴 **而這一格的形狀值得記,因為它不是任何一個人做錯**:
    //      `-a0` 收窄變數讓第一次上線可歸因 —— 對。
    //      `-7a` 給預設讓呼叫端不必知道網址 —— 也對。
    //      ⇒ **而兩個對的決定合起來, 推翻了其中一個明說的前提。**
    //      🛑 而兩邊的測試**各自全綠**:那一邊驗「html 欄有沒有送出去」(不驗裡面有什麼)、
    //        這一邊驗「不給 logoUrl ⇒ 用預設」(那正是它要的行為)。
    //      ⇒ ⇒ 📌 **一個跨檔的假設, 沒有任何一支測試守得住它 ——**
    //         **因為每一支測試的分母都是【自己那支檔】。**
    //      ✅ ⇒ 所以本片補了一格**驗這個呼叫點的產物**的測試(見 `sweep-email-outbox.test.ts`)。
    // 🔵🔵 **2026-09-03 Sean 勾 A4 + A5 ⇒ 這兩格【他點頭了】, 上面那段「不給」的理由到期。**
    //    ⛔ ~~`{ logoUrl: '' }`(明確不印 LOGO)~~ ⇒ ✅ **不再傳 `logoUrl` ⇒ 吃預設 ⇒ LOGO 印出來。**
    //      (原因不是那個決定錯了 —— 它當時是對的:第一顆刻意只讓對外變數有一個。**是它被批准了。**)
    //    ⛔ ~~`orderUrl` 不給, 因為「加一個連結進客人的信是新的對外面, 他還沒點頭」~~
    //      ⇒ ✅ **他點頭了(A4)** ⇒ 給 `orderUrl` ⇒ 「到會員中心查看訂單」那顆按鈕會印。
    //    🛑 **而 `paidAtText` 那一格【仍然不給】** —— 它不在 A1~A6 裡, 而 Sean 2026-08-30 逐字
    //      「沒有那個欄位就不要印, 不要拿成立時間頂替」⇒ **不夾帶。**
    //    🔴 **而 `orderUrl` 缺 `siteUrl` 時是 `undefined` ⇒ 那顆按鈕整塊不印**,
    //      **不是印一顆連到空網址的按鈕** —— 死入口比沒入口糟。
    const html =
      paid !== null
        ? renderPaidEmailHtml(paid, {
            orderUrl: paidEmailOrderUrl(opts.siteUrl, paid.orderDisplayId),
          })
        : null;

    try {
      // 🔴 **先把 send input 組成一個物件, 守門讀【同一個物件】, 再送出去。**
      //    ⛔ ~~原本寫 `assertPdfClaimMatchesAttachments(html, undefined)`~~ ——
      //    🔴🔴 **code-reviewer 2026-09-03 R1 must-fix:那樣寫會【反向失效】, 不是靜靜失效。**
      //      未來有人加 `attachments: [pdf]` 並翻開旗標 ⇒ 守門讀到寫死的 `undefined`
      //      ⇒ **每一封付款信都 throw**、落下面的 `catch`、列卡 `sending`、約 5h20m 進死信,
      //      而它的外觀與平台 kill **印同一個錯誤碼**。
      //    📌 **⇒ 病灶是「加附件的那個字面」與「守門看到的那個字面」是兩份。** 組成一個物件
      //      之後它們是同一份 ⇒ **加附件的人不必知道這道守門存在, 也不可能繞過它。**
      //    ⚠️ 這正是 repo 已立閘的同型病(`.husky/undefined-assert-gate.sh`:寫死 `undefined`
      //      讓斷言在兩個世界都通過)—— 而**那道閘只掃測試斷言, 掃不到 production 這一行**。
      //    🔵 **標成 `SendEmailInput` 是這個修法的一半** —— 少了它, TS 會把物件收窄成
      //      「今天有的那幾個 key」, 而 `sendInput.attachments` 當場不存在(實測 TS2339)。
      //      ⇒ 📌 標了型別之後,**未來加附件的人在這裡加一行就會被守門看到**, 不必知道它存在。
      const sendInput: SendEmailInput = {
        to: job.recipientEmail,
        // 🔴 **主旨一個字都不動**(片2 第一顆刻意保守):`paidEmailSubject(ctx)` 存在而**沒有用**。
        //    主旨是客人在信箱列表看到的那一行 ⇒ 改它 = 又一個對外可見的變數。
        //    ⇒ 📌 這一顆只讓變數有【一個】:內文從純文字變成 HTML。出事時知道是哪一格。
        subject: job.subject,
        // 🔴 `text` 是退化路徑(收信端不顯示 HTML 時讀的那一份)。
        // ⛔ ~~「一個字都沒動」~~ **2026-09-03 起不成立**:純文字那一句的逗號由半形改成全形
        //    (Sean 拍「一份定義兩邊取用」+ 鐵則 1 讓給稿)⇒ **動了一個字元。**
        //    ⇒ 下面那句「逐位元與今天相同」講的是**沒注入 `paidContext` 時 html 這個 key 不存在**,
        //      那一格仍然成立;而**它不涵蓋 `text` 的內容**。兩件事不要合起來讀。
        text: buildEmailText(job, shipped, paid, opts.siteUrl),
        // 🔴 **有 context 才給 html**(選填欄;不給時 POST body 不出現這個 key —— 片1 已釘住)
        //    ⇒ 沒注入 `paidContext` 的環境,寄出去的東西**逐位元與今天相同**。
        // ⚠️ 而 `chrome` 三格**全部不給**,理由逐條:
        //    · `logoUrl`   —— ⛔ ~~那個網址今天是 404,等 Sean 加 Vercel Domain~~ **已假**
        //      (code-reviewer 2026-09-01 抓到:`⟦b4-MAILLOGO1⟧` 那一列態已是 `done`,
        //       `https://www.pcmmotorsports.com/pcm-logo.png` ⇒ **200 · 66,739 bytes**)。
        //      ⇒ 🔵 **不放它的理由換成真的**:第一顆刻意只讓變數有一個(內文變 HTML)。
        //        多一張圖是另一個變數 —— 而它可以下一顆再開,不必混進這一顆。
        //    · `orderUrl`  —— 加一個連結進客人的信是**新的對外面**,他還沒點頭
        //    · `paidAtText`—— 稿要求用**真的付款完成時間**(Sean 逐字「沒有那個欄位就不要印,
        //      不要拿成立時間頂替」),而那一格本片沒查 ⇒ 不給 = 不印,而不是印一個頂替的
        //    ⇒ 🔵 三格不給 ⇒ 模板那幾段不印(`-7a` 做成 optional)⇒ **不造假值**。
        ...(html !== null ? { html } : {}),
        idempotency: { eventType: job.eventType, outboxId: job.id },
      };
      // 🔴 **送出去之前的最後一道**:信裡說了「PDF 已附在這封信裡」而附件裡沒有 PDF ⇒ throw。
      //    走下面既有的 `catch`:**計 errors、列留 `sending`、不寄** —— 與 `order_shipped`
      //    的 fail-closed 同一條路(刻意選同一條, 不新開行為;可歸因性差一格:`catch` 不 bind err
      //    ⇒ 這則訊息到不了 log。那是既有形狀, 本片不動它)。
      //    🛑 **它今天恆不會 throw**(那句話今天不會印)⇒ **效度不能靠「今天沒紅」證明**,
      //      由 `paid-email-html.test.ts` 的兩個世界證(說了謊 ⇒ 紅 / 真的附了 ⇒ 綠)。
      assertPdfClaimMatchesAttachments(sendInput.html ?? null, sendInput.attachments);

      // 🔴🔴 **`Q-更正信範圍 = 甲` 那道閘【不在這裡】, 它在認領路徑上**(本檔 `:1265` 與 `:1300`)。
      //    ⛔ ~~我原本在這裡又加了一道「payload 號碼 vs live 號碼」~~ —— **它是死碼**:
      //      · 上面那段「比的是【這一次更正的身分】」已用**更正的時點**比過一次
      //        (被取代 ⇒ `markSkippedTrackingSuperseded`)
      //      · 緊接著的「**第二道:號碼本身也要對得上**」已用**號碼**比過一次(對不上 ⇒ `errors`)
      //      🔵 這裡**刻意不寫行號** —— 行號會被別人的 diff 推走, 而那兩段的標題不會(codex R1 nit)
      //      · 而 `shipped` 只在 `order_shipped` 才載入 ⇒ 對更正信恆為 `null`
      //        ⇒ 🛑 **我那個條件恆假, 一次都不會成立。**
      //    ⇒ 🎯 **它會全綠, 因為它什麼都沒做** —— 而多出來的那個計數欄位是唯一叫出來的訊號
      //      (`result 鍵恰為 counts allowlist` 那一格)。📌 **一道擋不到東西的閘, 只有清單會發現。**
      // 🔴 **這一封實際印在紙上的號碼** —— 交給 `markSent` 與 `sent_at` 同一發落表。
      //    · 更正信 ⇒ payload 那個(而上面那道閘已保證它 === live)
      //    · 出貨信 ⇒ 即時值(它的信裡印的就是這個;沒有號碼時是 null, 那是合法狀態)
      //    · 其餘事件 ⇒ null(它們的信裡沒有號碼)
      const sentTrackingNumber: string | null =
        job.eventType === 'shipment_tracking_corrected'
          ? (((job.payload as { tracking_number?: unknown }).tracking_number ?? null) as
              | string
              | null)
          : job.eventType === 'order_shipped'
            ? (shipped?.trackingNumber ?? null)
            : null;

      const outcome = await sender.send(sendInput);
      // 🔴 計數 = provider 裁決當下(mark 落表前;codex 關卡2 R1 must-fix:mark throw 不得
      //    讓「Resend 已接受」從計數上消失)。
      if (outcome.kind === 'sent') {
        result.sent++;
        const owned = await outbox.markSent(job.id, job.attempts, sentTrackingNumber);
        if (!owned) result.staleMarks++; // 柵欄 no-op:所有權已失、不得覆寫(非錯誤)
      } else {
        result.failed++;
        // 🔴 額度用盡與單封偶發失敗分開計 —— 理由見型別上的 JSDoc。
        //    **分母問 `isQuotaExhaustionCode`,不在這裡手寫碼名** —— 手寫會漏掉 `http_429`,
        //    而 provider 日後新增的 quota 碼也不會自動進來(code-reviewer F1/F2 換來的)。
        if (isQuotaExhaustionCode(outcome.errorCode)) result.quotaFailed++;
        const failedAt = now();
        const owned = await outbox.markFailed(
          job.id,
          job.attempts,
          outcome.errorCode,
          computeEmailBackoff(outcome.errorCode, job.attempts, failedAt, random),
        );
        if (!owned) result.staleMarks++;
      }
    } catch {
      // sender 合約不 throw(可預期失敗走 failed 結果)→ 此處 = 合約違反、order_shipped
      // fail-closed(buildEmailText throw)或 mark* DB 錯。不補標不重試:列留 sending、
      // lease 到期由下輪 ① 回收(at-least-once、fail-closed)。
      result.errors++;
    }
  }

  return result;
}

/**
 * 更正貨運單號的信(⟦5b-TRACKNUMGAP1⟧ 片 C;Sean 2026-09-04 逐字
 * 「甲 = 做, 改完自動再寄一封對的信給客人」)。
 *
 * 🔴🔴 **客人手上會有【兩封】, 而他要分得出哪一封對** ——
 *    所以這封信的每一句都在回答「**我該用哪一個號碼**」, 而不是「發生了什麼事」。
 *
 * 🔵 **「先前那個號碼查不到是正常的」那句是承重的**(主視窗 2026-09-04 過稿):
 *    少了它, 客人拿舊碼去貨運網站查不到 ⇒ **他會以為貨出問題了 ⇒ 然後打電話。**
 *
 * 🔴 **讀 payload 的形狀抄 `buildOrderUnpaidCancelledText`**(防禦容缺:缺一格照樣寄,
 *    而缺的那一格用一句話說出來)—— **不自己發明**。
 *    ⚠️ 而**單號那一格缺了就【不該寄】** —— 一封「正確的單號是(空白)」比不寄糟。
 *    那道閘在呼叫端(`buildEmailText` 的 `order_shipped` 那格是同一個形狀:fail-closed throw)。
 */
function buildTrackingCorrectedText(job: ClaimedEmailJob): string {
  const payload = job.payload;
  const readStr = (key: string): string | null => {
    if (typeof payload !== 'object' || payload === null || !(key in payload)) return null;
    const v = (payload as Record<string, unknown>)[key];
    return typeof v === 'string' && v.trim() !== '' ? v : null;
  };
  const displayId = readStr('display_id');
  const shipmentReference = readStr('shipment_reference');
  const trackingNumber = readStr('tracking_number');

  // 🔴 **單號缺了就不寄** —— 這封信的全部內容就是那個號碼。
  //    fail-closed:計 error、列留 sending、不寄(與 `order_shipped` 那格同一條)。
  if (trackingNumber === null) {
    throw new Error(
      'sweepEmailOutbox:shipment_tracking_corrected 的 payload 缺 tracking_number、fail-closed 不寄' +
        ' —— 一封「正確的單號是(空白)」比不寄糟',
    );
  }

  const lines: string[] = [
    '您好，',
    '',
    displayId === null
      ? '您先前那封出貨通知上的貨運單號有誤。'
      : `您的訂單 ${displayId} 先前那封出貨通知上的貨運單號有誤。`,
    '',
  ];
  // 🔵 箱號缺了照樣寄 —— 它幫客人分辨「哪一箱」, 而少了它那封信仍然回答得了主要問題。
  if (shipmentReference !== null) lines.push(`箱號:${shipmentReference}`);
  lines.push(
    `正確的貨運單號:${trackingNumber}`,
    '',
    '請以這一封為準;先前那個號碼查不到是正常的。',
    '',
    ORDER_MEMBER_CENTER_SENTENCE,
    '',
    'PCM重機零件販售',
  );
  return lines.join('\n');
}
