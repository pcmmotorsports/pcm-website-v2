import type {
  ClaimedEmailJob,
  IEmailOutbox,
  IEmailSender,
  IIneligibleOrderEmailScanner,
  IShippedEmailContext,
  LoadShippedContextResult,
  ShippedEmailContext,
} from '@pcm/ports';
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
 *   maxRunSeconds + 時鐘偏差餘裕)` 驗證,違反直接 throw;迴圈另設時間預算(超過
 *   `maxRunSeconds` 停止寄送、剩餘已認領列計 `deferred`)= 對「平台沒殺」情境的縱深,
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

/** lease 硬下界(秒)= plan §3.5-4「lease ≥ 1 小時」字面(物理擋、非約定)。 */
const MIN_LEASE_SECONDS = 3600;

/**
 * 跨 instance app 時鐘偏差餘裕(秒;E2a-a 關卡2 Fable F2:`claimed_at` 由認領方 app 鐘寫、
 * `staleBefore` 由回收方 app 鐘算)。5 分鐘遠大於 NTP 常態偏差量級 = 保守值。
 */
const CLOCK_SKEW_ALLOWANCE_SECONDS = 300;

/**
 * 依 eventType 窮舉分派內文模板(codex 關卡2 R1 must-fix:DB CHECK 與 `ClaimedEmailJob` 型別
 * 都合法允許 `order_shipped` 列存在 —— enqueue 現況雖只開 order_created,手動 DB 寫入即可造出
 * → 不做分派會把出貨列寄成「付款成功」信)。
 * 🔴 `order_shipped` = E4 未落地、無模板 → **寄送前 fail-closed throw**(零 PII;由呼叫端
 * per-job catch 計 error、列留 sending → 回收 → 耗盡 attempts → 訊號 2 可見,不靜默吞)。
 * E4 增員 union 時本 switch 少 case → typecheck 必紅(`satisfies never` 窮舉)。
 */
function buildEmailText(job: ClaimedEmailJob, shipped: ShippedEmailContext | null): string {
  switch (job.eventType) {
    case 'order_created':
      return buildOrderCreatedText(job);
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
function buildOrderCreatedText(job: ClaimedEmailJob): string {
  const payload = job.payload;
  const displayId =
    typeof payload === 'object' &&
    payload !== null &&
    'display_id' in payload &&
    typeof (payload as { display_id: unknown }).display_id === 'string'
      ? (payload as { display_id: string }).display_id
      : null;
  const orderLine = displayId === null ? '您的訂單已付款成功。' : `您的訂單 ${displayId} 已付款成功。`;
  return [
    '您好,',
    '',
    orderLine,
    '我們將盡快為您安排出貨;訂單明細與最新狀態請至 PCM 會員中心查看。',
    '',
    'PCM重機零件販售',
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
 * 🔴 **標點用半形逗號**,與隔壁 `buildOrderCreatedText` 一致;而 Sean 看到的選項字面裡
 * 是全形「，」⇒ **兩者只差標點、字沒有改**,這一格在交件時要跟他講一聲。
 */
function buildOrderShippedText(ctx: ShippedEmailContext): string {
  const lines: string[] = [
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

  lines.push('', '訂單明細與最新狀態請至 PCM 會員中心查看。', '', 'PCM重機零件販售');
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
    skippedIneligible: 0,
    eligibilityUnknown: 0,
    quotaFailed: 0,
    skippedShipmentVoided: 0,
  };

  // 🔴 單一時鐘快照:staleBefore / nextRetryAt / 時間預算基準皆由此導出(兩次 now() 之間的
  //    間隔會憑空吃掉 lease 餘裕)。
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

  // ── ② claim due(CAS 認領;輸家/死列由 port 述詞處理)──────────────────────────────
  let jobs: ClaimedEmailJob[] = [];
  try {
    jobs = await outbox.claimDue(opts.claimLimit);
  } catch {
    result.errors++;
  }
  result.claimed = jobs.length;

  /** 時間預算已用盡?(單一來源;迴圈頭與合格性讀取【之後】各問一次)。 */
  const outOfBudget = (): boolean =>
    now().getTime() - sweepStartedAt.getTime() >= opts.maxRunSeconds * 1000;

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
      ineligible = (await ineligibleScanner.listIneligibleAmong([job.orderId])).length > 0;
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
        // **這道閘在 `claimDue` 【之後】才擋** ⇒ 線關著的期間,佇列裡的 `order_shipped` 列
        // 每一輪都會被認領一次(`attempts` 在認領當下就 +1)、被這裡擋下、留在 `sending`、
        // 下一輪被回收 ⇒ **約 25 分鐘後燒完 5 次 attempts ⇒ 進死信,而它一封都沒寄過。**
        // ⚠️ 另一半:它們**佔著 `claimLimit` 的格子** ⇒ 線關著時會延遲 `order_created` 的信。
        //
        // 🔴 **為什麼沒有在這一片修**:正解是【不要認領它們】,而 `claimDue(limit)` 沒有
        //    事件型別參數 ⇒ 要改 `IEmailOutbox` 這個 port(鐵則 8:動 API / 共用契約)。
        //    在一個 codex 迴圈裡順手改一個金流鄰居的 port,正是 R4 換路訊號說的那種事。
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
          const owned = await outbox.markSkippedShipmentVoided(job.id, job.attempts);
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

    try {
      const outcome = await sender.send({
        to: job.recipientEmail,
        subject: job.subject,
        text: buildEmailText(job, shipped),
        idempotency: { eventType: job.eventType, outboxId: job.id },
      });
      // 🔴 計數 = provider 裁決當下(mark 落表前;codex 關卡2 R1 must-fix:mark throw 不得
      //    讓「Resend 已接受」從計數上消失)。
      if (outcome.kind === 'sent') {
        result.sent++;
        const owned = await outbox.markSent(job.id, job.attempts);
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
