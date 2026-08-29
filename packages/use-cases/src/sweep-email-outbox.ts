import type {
  ClaimedEmailJob,
  IEmailOutbox,
  IEmailSender,
  IIneligibleOrderEmailScanner,
  IShippedEmailContext,
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
};

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
function buildEmailText(job: ClaimedEmailJob): string {
  switch (job.eventType) {
    case 'order_created':
      return buildOrderCreatedText(job);
    case 'order_shipped':
      throw new Error('sweepEmailOutbox:order_shipped 模板未定義(E4 未落地)、fail-closed 不寄');
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
    try {
      const outcome = await sender.send({
        to: job.recipientEmail,
        subject: job.subject,
        text: buildEmailText(job),
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
