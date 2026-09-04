import 'server-only';
// 🔴 **本檔【不】import `@pcm/adapters/server`** —— service_role 那道門在隔壁 `composition.ts`,
//    出處、射程、以及「Sean 沒有拍這一板」那一格全部寫在那支檔頭。
//    本檔只吃注入的窄通道 ⇒ 它是純邏輯 ⇒ **測試不用 mock 任何 adapter**。
import { getHeartbeatStore, type HeartbeatStore } from './composition';

// heartbeat.ts — 排程存活心跳的**寫入端**(⟦b4-CRON6⟧ 片1)
//
// 🔴 授權:Sean 2026-08-28 **`q6: 甲`(第二批,21:3x 端出)**——逐字在
//    `~/pcm-mailbox/pending-questions-20260827.md`。
//    ⚠️ **不要引早批那個 `q2: 甲`**:同一份 mailbox 有**兩個** `q2: 甲`,而 `:806` 那個是
//    **線A 的報價單帶入題**(逐字「q2 = 甲(網站商品庫)」)⇒ 引它會指到別條線。
//    早批的 `q2` 對本片**已作廢** —— 他拍那一板時,「心跳只蓋 5/6」與 fire-and-forget 都還沒被量到。
//    規格 `~/pcm-mailbox/線D-規格-心跳接線-b4CRON6-20260828.md`。
//    表 `public.sweeper_heartbeat` 2026-08-17 就建好了(`20260817070000_m4b_231_3_sweeper_heartbeat.sql`),
//    而在本片之前**寫入 0 處、讀取 0 處** —— 一個專門用來偵測安靜停止的東西,自己安靜地沒上線。
//
// ══ 🔴🔴 為什麼心跳【不】寫在 `pcm_cron.invoke_cron_route` 裡(這是本片最重要的一個決定)══
//
// 那支共用函式 2026-08-28 對正式庫 `pg_get_functiondef` 撈過。**以下是節選,不是逐字全文** ——
// ⚠️ 這個標籤是被審查逼出來的:我第一版把節選標成「逐字」,而**節選剛好漏掉了下面②那道閘**,
//    足以把病灶診斷成另一種。📌 **「逐字」是唯一一種下游驗不了的宣稱** ⇒ 要標逐字就整段貼。
//
// 它有**兩種**失敗,而它們**不是同一種**,不要合成「都很安靜」:
//   ① **HTTP 回應層 = 真的靜默**(節選):
//        SELECT net.http_get(url := ..., timeout_milliseconds := 70000) INTO v_req;
//        RETURN v_req;
//      `net.http_get` 回的是 **request id,不是回應** ⇒ 函式在「請求交給 `pg_net`」那一刻就 RETURN
//      ⇒ route 回 500、Vercel 掛掉、部署根本不存在、DNS 壞掉 —— **它全部照樣「成功」**。
//   ② **vault secret 缺失 = 它會叫**(節選,就在①上面幾行):
//        IF v_base IS NULL OR v_token IS NULL THEN
//          RAISE EXCEPTION 'pcm_cron.invoke_cron_route:缺 vault secret(...);拒送出';
//        END IF;
//      ⇒ **secret 掛掉不是安靜的。** 而【raise 之後誰會知道】= **未確認**
//        (`cron.job_run_details` 的 status 對 http 型 job 恆 `succeeded`,而
//         「從來沒失敗過」與「這欄顯示不出失敗」印同一個 0 ⇒ 那個 0 不能當證據)。
// 📌 **病灶診斷錯會導向錯的修法**:以為②也是靜默 ⇒ 會去補一層 secret 探針,
//    而**它已經自己會叫了** —— 要補的是「它叫了之後有沒有人聽見」,那是另一件事。
// 📌 **⇒ 寫在那裡的心跳,提供的資訊 ≈ `cron.job_run_details` 已經在說的那句,而那一欄對 http 型 job
//    恆 `succeeded`(503 也寫 succeeded)** ⇒ 等於把一個已知沒有判別力的東西複製一份。
// ⇒ **所以寫在【route 自己】** —— 只有它知道這一輪真的做了什麼。
//
// ══ 🔴 三態,不是兩態(規格 §2)══════════════════════════════════════════════
//
//   200 + ok:true + enabled !== false  ⇒ 真的做完一輪   ⇒ recordHeartbeatSuccess()
//   200 + enabled:false(no-op 那三支)  ⇒ 活著而沒在做事 ⇒ 🔴 **兩支都不呼叫,三欄都不寫**
//   503 / 500 / throw                   ⇒ 失敗          ⇒ recordHeartbeatFailure()
//
// 🔴 **`enabled:false` 為什麼不寫成功**:寫了 ⇒ 旗標被關掉的期間心跳**恆綠**
//    ⇒「被關掉」與「健康」在儀表上同色 ⇒ **那正是本片要修的病,只是換一層皮。**
// 🔴 **也不能寫成失敗** —— 關掉是人為的,寫 failure 會讓告警天天叫,而**天天叫的告警等於沒有告警**。
// ⚠️ **代價明寫**:讀取端因此在「旗標關著」與「route 死了」之間分不出來
//    ⇒ 由讀取端的白名單 + 漂移偵測處理(片3;主視窗 2026-08-28 裁乙)。**本檔不假裝這格解了。**
//
// ⚠️ **而「今天旗標是 true」不是省掉這段的理由**(Sean 2026-08-28 貼回:
//    `CRON_SWEEPER_ENABLED= true` / `ANOMALY_ALERT_ENABLED= true`):
//    📌 **「今天走不到那條路」與「那條路不存在」不是同一件事** —— 省掉它的人,是在今天的值上蓋房子。
//
// ══ 🔴🔴 哪幾條路【不寫】心跳 —— 而理由是安全,不是省事 ═══════════════════════
//
//   401(Bearer 不符)   ⇒ **不寫**
//   429(限流)          ⇒ **不寫**
//   500(CRON_SECRET 未設/強度不足)⇒ **不寫**
//
// 🔴 **因為這三條【未經認證的人也走得到】** —— 尤其 `500` 那條是在**認證之前**就 return
//    (`requireCronSecret()` throw ⇒ 500,而它跑在驗 Bearer 之前)。
// ⇒ 若這三條會寫 `consecutive_failures`,**任何路人都能對著端點狂打、把失敗計數灌上去**
//    ⇒ 告警被灌爆 ⇒ **而一個天天叫的告警等於沒有告警** ⇒ 那是一條「用垃圾流量關掉監控」的路。
// ⇒ **心跳只在【認證通過之後】寫。**
// ⚠️ **代價明寫**:「Vercel cron 的 secret 輪替了、合法排程一直 401」這種情況,
//    本檔**一格都不會記**。而它**不是不可見** —— `last_success_at` 會停止前進 ⇒ 告警照樣會叫。
//    ⇒ 我們失去的是「為什麼」,不是「有沒有」。而「為什麼」在 Vercel 的 log 裡,不在這張表裡。
//
// ══ 🔴 寫失敗一律不往上拋(而失敗形狀是【假警報】不是【假綠燈】)═════════════════
//
// 心跳寫入掛掉**不得**讓 sweeper 那一輪跟著失敗 —— 監控把被監控的弄死是最糟的一種。
// ⇒ catch 住、`console.error` 留痕、照常回原本的 Response。
//
// 🔴🔴 **而「catch 住」擋不住【平台把整個函式砍掉】那一種**(R1 I1)。
//    五支 route 的預算是滿的:`email-sweep/route.ts` 把 `maxRunSeconds: maxDuration`(60)**整份**
//    交給 sweep;`settle-sweep/route.ts:69-71` 自陳「單輪最壞 ≈50s / 真餘量 ~10s」
//    (⚠️ 原本寫 `:66` —— codex R2 實查那一行是空的,行號錯,已改)。
//    ⇒ 心跳排在**最後一步**,而**平台 kill 不可 catch**
//    ⇒ **一輪真的做完了、而心跳沒寫進去** ⇒ 讀取端報「沒心跳」⇒ **假陽性告警**。
//    📌 那正是 `#231` migration 檔頭稱為**「自我擊敗」**的那一格:一個為了消除假陰性而建的東西,
//       變成假陽性的來源。**今晚已經擋掉它的一種形態(預設參數),這是第二種。**
//    ⇒ 處置:{@link HEARTBEAT_MAX_MS} 硬上界(形狀抄 `settle-sweep/route.ts:216-233` 的
//      `Promise.race` + budget,不自創第二種寫法;⚠️ 原寫 `:216-233`,而 timer 那段到 `:237` 才結束)。
//    ⚠️ **上界只縮小窗口,不消滅它** —— route 在心跳【開始之前】就被 kill 的那一段,本檔照樣看不到。
//      **這句不得在下游被讀成「已解決」。**
// ✅ **而靜默 catch 在這裡是可以接受的,理由要寫出來**:寫不進去 ⇒ 那一列不會前進
//    ⇒ 讀取端會看到「N 分鐘沒有心跳」⇒ **告警會叫**。
//    ⇒ **失敗方向是【多叫一次】,不是【安靜地綠】。** 這兩個方向的代價不對稱,而我們選會叫的那邊。

/**
 * 🔴🔴 **字面必須與線上 `cron.job.jobname` 逐字相同。**
 *
 * 對不上的後果**不是報錯,是永遠報「沒心跳」** —— 讀取端查一個永遠沒有列的名字,
 * 而那是**假陽性**:告警天天叫、而排程其實好好的 ⇒ 比不做更糟(叫久了沒人看)。
 *
 * 2026-08-28 對正式庫撈過兩次、兩個窗各一次、逐格相同
 * (`select jobname, schedule, active, command from cron.job where jobname like 'pcm-%'`
 *  ⇒ 6 支;`cron.job` 總數同一發撈 ⇒ 也是 6 ⇒ 分母 = 全部,沒有第七支在名單外;
 *  負對照 `jobname = 'pcm-zzz-bogus-20260828'` ⇒ 查無)。
 *
 * ⚠️ **這份名單會漂**(有人在 DB 改名 / 加第七支,repo 這邊零訊號)⇒ 片3 的讀取端要有
 *    「白名單 vs 實際 `cron.job`」的漂移偵測,而**那道自己也要有負對照**。
 */
/**
 * 心跳寫入的硬上界(毫秒)。
 *
 * 🔴 **它防的不是「寫得慢」,是【route 的預算被吃光】**(R1 I1):心跳排在最後一步,
 *    而平台 kill **不可 catch** ⇒ 一輪真的做完了而心跳沒寫進去 ⇒ 假陽性告警。
 * ⚠️ **2000 是我定的,沒有量測依據** —— 同檔那幾支 route 的門檻(`RECONFIRM_MIN_BUDGET_MS` 12s)
 *    也自陳是估的。要改先去量一次 upsert 的真實耗時,不要憑感覺調。
 */
export const HEARTBEAT_MAX_MS = 2_000;

/**
 * 🔴🔴 **DB 與外部訊號【各自的】預算,加起來仍是 `HEARTBEAT_MAX_MS`**
 * (2026-08-28 R1 code-reviewer MF1 —— 它讓這一片失去了存在的理由,所以這段寫長)。
 *
 * **原本兩發共用同一個 `deadlineAt`。實測**:`store.write` 永不 resolve
 * ⇒ 逾時之後 ping 拿到 `ms = 0` ⇒ **被那道「預算用完就不送」整發跳過**。
 * 🔴 **⇒ 而「我們自己的 DB 掛了」正是外部這一側【唯一真正要工作】的那個世界**
 *    ⇒ **它在那一天是啞的。**
 * 📌 **一個為了不吃掉別人預算而做的共用,讓兩個訊號在同一個世界裡一起沉默** ——
 *    而共用的**收益**(最壞不變兩倍)當時寫進了註解,**代價沒有**(R1 nit 7)。
 *
 * ⛔ ~~**兩個數字都沒有量測依據**…**那個 round trip 沒有人量過**(R1 nit 11)。要調先去量,不要憑感覺。~~
 * ✅ **2026-09-04 量了, 而它說預算切反了**(⟦b4-EXTPINGTIMEOUT1⟧;主視窗同日批)。
 *    舊字面留刪除線 —— 搜「沒有量測依據」的人要在同一發撞到這裡。
 *
 * ── 🔬 讀數(帶著它的環境走, 照 §6-b:數字離開量測現場就得帶著環境)──────────────
 *    **來源**:Vercel runtime log 原始行, production, deployment `dpl_6q2eomSTNGVVZXLf7vM28hmLz8bW`,
 *    2026-09-04 14:30-14:55 UTC 那 25 分鐘, 四支 cron 全收。
 *      ping 成功樣本 **n = 22** ⇒ 🔴 **雙峰**:257-286ms **7 筆** · 732-774ms **15 筆**
 *                                    ⇒ **400-700 之間一筆都沒有**
 *      db  樣本 **n = 26** ⇒ max **474ms**(第二大 260ms)
 *    ⇒ 🛑 **ping 的最大值 774ms 離舊預算 800ms 只剩 26 毫秒**, 而 db 離它的 1200ms 還剩 726 毫秒。
 *    ⇒ 📌 **那 26 毫秒就是那 15% 逾時的全部成因** —— 不是網路壞掉, 是**預算切在錯的地方**。
 *      (同窗實測 `外部存活訊號送出失敗` email-sweep 11 次 / 總輪數 72;
 *       負對照:同一把尺查 `(TypeError)` 回空 ⇒ 失敗**全部**是 `TimeoutError`。)
 *
 * ── 🔴 而這一刀【沒有】讓 cron 的最壞情況變長 ────────────────────────────────
 *    `HEARTBEAT_MAX_MS` **維持 2000**, 只是把餘裕從不需要的那一半搬到需要的那一半。
 *    新的餘裕:db 800 − 474 = **326ms** · ping 1200 − 774 = **426ms**。
 *
 * ⚠️ **那個雙峰的【成因】沒有查**(看起來像冷連線 / DNS, 而我沒有證據)。
 *    ⇒ 而這一刀**不依賴**知道成因:兩個峰都遠在 1200 以下。
 * ⚠️ **樣本是 25 分鐘的一個窗** —— 它答不出「一天之內會不會有更慢的時段」。
 *    ⇒ 判別訊號:部署之後回去重跑同一個查詢, 失敗數應該從 11/72 掉到接近 0。**沒掉就是這一刀錯了。**
 */
export const HEARTBEAT_DB_MS = 800;
export const HEARTBEAT_PING_MS = HEARTBEAT_MAX_MS - HEARTBEAT_DB_MS; // 1200

/**
 * 給一個 promise 套硬上界。逾時回 `'timeout'`,而**底下那發並不會被取消**(JS 沒有那個東西)。
 *
 * 🔴 `.catch()` 掛在原 promise 上是承重的:逾時之後我們不再 await 它,
 *    它若稍後 reject 就是一個 **unhandled rejection** ⇒ 在 Node 會把整個 process 拉下來。
 */
async function withCap<T>(
  p: Promise<T>,
  deadlineAt: number,
  onLateError: (e: unknown) => void,
): Promise<T | 'timeout'> {
  p.catch(onLateError);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<'timeout'>((r) => {
        // 🔴 **吃的是【共用的截止時刻】不是「每一發各給 2 秒」**(codex R1 finding 3):
        //    失敗那一支要先讀再寫 ⇒ 各給 2 秒 ⇒ 最壞 **4 秒**,而 route 可能已經逼近平台上限。
        //    ⇒ 兩發共用同一個 deadline,整支函式的最壞是 HEARTBEAT_MAX_MS,不是它的倍數。
        timer = setTimeout(() => r('timeout'), Math.max(0, deadlineAt - Date.now()));
      }),
    ]);
  } finally {
    // 🔴 **`finally` 不是 `race` 之後**(codex R1 finding 5):`p` 若**提前 reject**,
    //    `await` 直接往外拋 ⇒ 那一行 `clearTimeout` **跑不到** ⇒ 大量即時 DB 失敗會累積 timer。
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const CRON_JOB_NAME = {
  anomalyAlert: 'pcm-anomaly-alert',
  captureRecheck: 'pcm-capture-recheck',
  emailSweep: 'pcm-email-sweep',
  orderIneligibleGate: 'pcm-order-ineligible-gate',
  settleSweep: 'pcm-settle-sweep',
  /** 🔴 這一支**不走本檔** —— 它是純 SQL、不經 HTTP,心跳在函式自己裡面寫(片2)。列在這裡只為讓名單完整。 */
  expireUnpaidOrders: 'pcm-expire-unpaid-orders',
} as const;

export type CronJobName = (typeof CRON_JOB_NAME)[keyof typeof CRON_JOB_NAME];

// ══ 🔴 外部存活訊號(healthchecks.io)—— ⟦b4-CRON6⟧ 片3 ══
//
// **為什麼要有第二個地方**:`sweeper_heartbeat` 是**寫進我們自己的 DB**,
// ⇒ 它答得出「這一輪跑完了」,**答不出「整個站掛了」** —— 站掛了的時候,沒有人去讀那張表。
// ⇒ healthchecks 那一側是**死人開關**(dead man's switch):**它靠的是我們【不再說話】**。
//
// 🔴 **這一片的設計判準:失敗要有一個【人看得到的落點】,而那個落點不在 code 裡。**
// ```
// env 沒設 / URL 打錯 / 網路不通 ⇒ 那支 check 停在 'new'
// 而 'new' 【不會告警】（線D 2026-08-28 用 canary1 量到：從沒被 ping 的 check 永遠不掉下去）
// ⇒ 【監控沒接上】與【剛建好還沒開始】印同一個字
// ```
// ⇒ **所以落點是【上線後的驗收】,不是一行 console.error**:
//    **部署完當場量五支的 `status`,五支都要從 `'new'` 翻成 `'up'`。**
// 🔴 **而那道驗收只需要做一次** —— 第一發 ping 成功之後,任何**後來**的失聯
//    (env 被刪、這一行被拿掉、route 壞掉)都會讓 check 從 `'up'` 掉成 `'down'` ⇒ **它自己會叫**。
//    ⇒ **唯一的盲窗是「建好」到「第一發 ping」之間,而那一段正好是那道驗收蓋住的。**
// 📌 **⇒ 一個「還沒開始」的監控與一個「壞掉」的監控,只有在第一發訊號之前分不開。**
//
// ⚠️ **刻意不做的**:失敗時打 `/fail` 端點。理由:route 若一直失敗,成功 ping 就不會送出
//    ⇒ check 照樣會在 grace 之後掉下去 ⇒ **`/fail` 只讓它【更快】,不讓它【變得可能】。**
//    ⇒ 收益是分鐘級的提前,代價是多一條路要維護 ⇒ 本片不做,明寫在這裡。

/**
 * 那支 job 的 ping URL:**環境變數名(字面)** 與**當下的值**。
 *
 * 🔴🔴 **為什麼是一個字面 `switch`,而不是 `process.env[推導出來的名字]`**
 *    (2026-08-28:第一版就是動態索引,`pnpm lint` 當場紅 `no-restricted-syntax`):
 *    ⚠️ **那道規則自己的 message 講的是另一件事**(`eslint.config.js:120-128`:Next 不 inline
 *       ⇒ client bundle 拿到 `undefined` ⇒ runtime throw)—— **結論相同、理由不同**,
 *       而下一個人會引這段註解、不會去讀規則(R1 nit 8)⇒ 兩個理由都寫出來。
 *    **本檔採用的理由**是「**靜態掃描看不出到底讀了哪些 env**」——
 *    ⇒ 而「哪些 env 是必要的」正是這一片要交給 Sean 的那張清單。
 *    📌 **那道規則與本片的產出是同一件事的兩面:它逼我把 env 名字寫成字面,
 *       而寫成字面之後,【那張清單自己就長在這裡】。**
 *    ⚠️ 明文不繞過(不 `eslint-disable`)—— 繞過的話清單就回到「散在推導裡」那個狀態。
 *
 * 🔴 **`switch` 而不是物件字面**:`CronJobName` 是 union ⇒ 少寫一支**編不過**(exhaustive check)。
 *    物件字面漏一支只會是 `undefined` ⇒ **靜默跳過 ⇒ 那支永遠停在 `'new'`**。
 *    ⇒ 這一格把一個【靜默的漏】換成一個【編譯期的紅】。
 *
 * ⚠️ **在函式裡讀 `process.env`,不是模組層** —— 模組層會在 import 當下定死,
 *    測試的 `vi.stubEnv` 就改不動它了(而那會讓下面那些格子失去對象)。
 */
export function pingTarget(jobName: CronJobName): {
  envName: string;
  url: string | undefined;
  /** 🔴 這一支**設計上就沒有** ping(純 SQL)—— 與「忘了設 env」是兩件事,不可印同一句話(R1 nit 6)。 */
  notApplicable?: true;
} {
  switch (jobName) {
    case 'pcm-anomaly-alert':
      return { envName: 'HEALTHCHECKS_PING_URL_PCM_ANOMALY_ALERT', url: process.env.HEALTHCHECKS_PING_URL_PCM_ANOMALY_ALERT };
    case 'pcm-capture-recheck':
      return { envName: 'HEALTHCHECKS_PING_URL_PCM_CAPTURE_RECHECK', url: process.env.HEALTHCHECKS_PING_URL_PCM_CAPTURE_RECHECK };
    case 'pcm-email-sweep':
      return { envName: 'HEALTHCHECKS_PING_URL_PCM_EMAIL_SWEEP', url: process.env.HEALTHCHECKS_PING_URL_PCM_EMAIL_SWEEP };
    case 'pcm-order-ineligible-gate':
      return { envName: 'HEALTHCHECKS_PING_URL_PCM_ORDER_INELIGIBLE_GATE', url: process.env.HEALTHCHECKS_PING_URL_PCM_ORDER_INELIGIBLE_GATE };
    case 'pcm-settle-sweep':
      return { envName: 'HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP', url: process.env.HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP };
    case 'pcm-expire-unpaid-orders':
      // 🔴 這一支**不走本檔**(純 SQL,見 `CRON_JOB_NAME` 那段)⇒ 沒有 env,也不該有。
      // ⛔ ~~「它的 ping 要走 `pcm_cron.invoke_cron_route` 那個形狀」~~ **已作廢**(codex 2026-08-28):
      //    那支 job 的 migration 逐字寫「本 job 是純 SQL、不經 HTTP ⇒ **不需要**
      //    `pcm_cron.invoke_cron_route` 那層 wrapper、也不依賴 Vault secret」
      //    (`20260809170000_m4b_lifecycle_l3b_expire_unpaid_orders_schedule.sql:17`)
      //    ⇒ **我那句與 repo 事實直接相反**,而它是一句【下一個人會照著做】的設計處方。
      //    ⇒ 只留事實:**這一支現在不 ping,而它要不要 ping 是另一片的題目。**
      return { envName: '(不適用:純 SQL job)', url: undefined, notApplicable: true };
  }
}

/** ping URL 只接受這個前綴。**env 是可以被改的東西,而這一行讓它改不成「叫我方伺服器去打任意網址」。** */
const PING_URL_PREFIX = 'https://hc-ping.com/';

/**
 * 送一發「我還活著」。**永不拋、永不讓 route 紅** —— 它是監控,不是工作。
 *
 * 🔴 吃**同一個** `deadlineAt`(不是另外給 2 秒)⇒ 整支 `recordHeartbeatSuccess` 的最壞
 *    仍然是 `HEARTBEAT_MAX_MS`,不是它的倍數。理由同 `withCap` 那段(codex R1 finding 3)。
 * ⚠️ ping URL 是**那支 check 的寫入憑證** —— 拿到的人可以送假的「我還活著」,而面板上看不出差別
 *    ⇒ 只進 env、**不進 log、不進 commit body、不進任何訊息**(下面只印變數名,不印值)。
 */
export async function pingExternalHeartbeat(
  jobName: CronJobName,
  deadlineAt: number,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    const { envName, url, notApplicable } = pingTarget(jobName);
    if (notApplicable) {
      // 🔴 **不出聲** —— 這一支本來就不該有 ping。印「未設」會是一句**永遠為假的告警**(R1 nit 6),
      //    而一句永遠為假的告警會讓下一個人去「補上」那個 env ⇒ 做出一支永遠不會說話的 check。
      return;
    }
    if (!url) {
      // 🔴 只印【變數名】不印值;而這一行不是那個「落點」—— 落點是上線後那道驗收(見上)。
      console.error(`[heartbeat] ${jobName} 外部存活訊號未接上:${envName} 未設 ⇒ 該 check 會停在 new`);
      return;
    }
    if (!url.startsWith(PING_URL_PREFIX)) {
      console.error(`[heartbeat] ${jobName} 的 ${envName} 不是 ${PING_URL_PREFIX} 開頭 ⇒ 拒送出`);
      return;
    }
    const ms = Math.max(0, deadlineAt - Date.now());
    if (ms === 0) {
      console.error(`[heartbeat] ${jobName} 外部存活訊號:預算已用完,這一輪不送`);
      return;
    }
    const res = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(ms) });
    // 🔴 **非 2xx 也要出聲** —— 否則「送出去了」與「送到一個 404」印同一個安靜。
    if (!res.ok) console.error(`[heartbeat] ${jobName} 外部存活訊號回 ${res.status}`);
  } catch (err) {
    // 逾時 / DNS / 網路 —— 全部吃掉。**監控不得把被監控的弄死。**
    // 🔴🔴 **不得把原始 `err` 交出去**(codex 2026-08-28 must-fix):`fetch` 拋的錯
    //    **可能在 message / cause 裡夾帶完整的 request URL**,而那個 URL 就是那支 check 的
    //    **寫入憑證**(拿到的人可以送假的「我還活著」)。
    //    ⇒ `console.error(msg, err)` 是把整顆物件交給平台序列化 ⇒ 憑證進 log。
    //    📌 **一個為了好除錯而印出來的錯誤物件,與一次憑證外洩,長得一模一樣。**
    //    ⇒ 只印**分類名**(`err.name`),不印 message、不印 cause、不印整顆物件。
    const kind = err instanceof Error ? err.name : typeof err;
    console.error(`[heartbeat] ${jobName} 外部存活訊號送出失敗(${kind})`);
  }
}

/** 這一輪真的做完了。`last_success_at` 前進、失敗計數歸零。 */
export async function recordHeartbeatSuccess(
  jobName: CronJobName,
  store?: HeartbeatStore,
  pingImpl: typeof pingExternalHeartbeat = pingExternalHeartbeat,
  /**
   * 🔴🔴 **整輪的起點**(⟦b4-CRON60SDOGPILE⟧ 2026-09-04)—— 給了就在下面那行 log 多印一格
   * `round=<整輪毫秒>ms`。**沒給就一個字都不多印**, 既有呼叫端那一行**逐位元不變**。
   *
   * 🎯 **為什麼掛在這裡而不是新開一行 log**:那一行**本來就會印**(它已經印 `db=` 與 `ping=`)
   *    ⇒ 多一個欄位**零新增音量**。而板上否決過的是「新增一條無條件印的 log」, 不是這個。
   *
   * 🔴 **它解掉的是一個【量不到】的問題, 不是一個效能問題**:
   *    `maxDuration = 60` 的那支 cron, 被平台 kill 的那一發**不回 503、不寫心跳**
   *    ⇒ 而 Vercel runtime log **沒有耗時欄位**(2026-09-04 我自己讀原始行確認過)
   *    ⇒ 📌 **今天只答得出「這一輪跑完了沒」, 答不出「離 60 秒還有多遠」。**
   *    ⇒ 而那個差別是:**撞到之前完全沒有預警。**
   *
   * ⚠️ 它量的是**從 route 進來到這一行**的 wall-clock, **不含**平台的冷啟動與回應寫出。
   *    ⇒ 它是**下界**, 不是平台那把碼表。兩者的差沒有人量過。
   */
  roundStartedAtMs?: number,
): Promise<void> {
  // 🔴🔴 **整支函式的起點,而它是【總預算】的錨**(codex R2 must-fix 3):
  //    上一版把 ping 的截止寫成 `Date.now() + HEARTBEAT_PING_MS`(在 DB 之後才算)
  //    ⇒ **註解說「最壞仍 2000ms」而實作不保證** —— timer 延遲時整支的 wall-clock 會超過。
  //    ⇒ 改成 `min(startedAt + 總預算, 現在 + ping 預算)`:**兩個上界同時成立**。
  const startedAt = Date.now();
  // 🔵 ⟦b4-CRON6⟧:這兩個在 try 【外面】宣告 —— DB 那半自己一個 try 是刻意的控制流隔離
  //    (本檔 :317-322 記過理由)⇒ 我不動那個隔離, 只把讀數帶出來。
  //    🔴 而預設值要分得出「沒跑到」與「跑了而是 0」⇒ 用 -1 當「這一半沒走到」。
  let dbMs = -1;
  let dbResult: 'ok' | 'timeout' | 'write_error' | 'threw' = 'threw';
  // 🔴 **起點在 try 【外面】**(codex must-fix 1):`s.write()` 直接 reject 時,
  //    try 裡那行 `dbMs = …` **跑不到** ⇒ 那一筆停在 `-1`
  //    ⇒ 📌 **而 reject 正是我們最想量的那一類**(「它多快就爆掉」也是資料)。
  const dbStartedAt = Date.now();

  // ══ 🔴🔴 DB 那一半【自己一個 try】—— 它的任何失敗都不得跳過下面那發 ping ══
  //    (codex R2 must-fix 1):上一版兩件事在同一個 try 裡,而 `store.write()` **直接 reject**
  //    (DNS / 連線中斷)⇒ `await` 往外拋 ⇒ **跳過 ping** ⇒ **DB 與外部監控同時沉默**。
  //    📌 那與 R1 MF1 是**同一個病的第二條路**:R1 那條是【逾時】,這條是【立刻 reject】——
  //       而我上一版只把逾時那條修好了,**因為我補的測試只餵了不 resolve 的那種**。
  //    ⇒ **控制流隔離**才是修法,不是再補一個 catch。
  try {
    // 🔴 `new Date().toISOString()` **在 try 裡面**(codex R1 finding 6):它會拋
    //    (`RangeError: Invalid time value`,或有人替換掉 `Date`)⇒ 放在外面就繞過了本函式的 catch
    //    ⇒ 例外冒到 route ⇒ 又是一次「監控把被監控的弄死」。
    const nowIso = new Date().toISOString();
    // 🔴 DB 那發吃【自己的】預算(R1 MF1)。
    //    ⚠️ 失敗那一支(`recordHeartbeatFailure`)【不動】—— 它不 ping,沒有理由縮它的預算。
    const deadlineAt = startedAt + HEARTBEAT_DB_MS;
    // 🔴🔴 **`getHeartbeatStore()` 必須在 try 【裡面】呼叫,不能寫成預設參數。**
    //    預設參數在**函式本體之前**求值 ⇒ 它拋的時候 **`catch` 接不到** ⇒ 例外冒到 route,
    //    而那幾支 route 的 catch 會把它變成 **503** ⇒ **一輪明明做完了的 sweeper 被心跳弄成失敗。**
    //    ⚠️ 這不是理論:第一版就是寫成預設參數,**既有 route 測試當場 57 格轉紅**
    //    (`deps_or_unexpected_throw`),因為測試環境沒有 service_role 的 env。
    //    📌 而它在正式站的形狀一樣:env 掉了 ⇒ **監控把被監控的弄死** —— 正是檔頭那句話要防的事。
    const s = store ?? getHeartbeatStore();
    // 🔴 成功那一發**不碰** `last_failure_at` —— 碰了會把上一次真的失敗抹掉。
    // 🔵 ⟦b4-CRON6⟧ 耗時量測(Sean 2026-09-03 批「先量再調」):量【DB 那半】的 wall-clock。
    const r = await withCap(
      s.write({ job_name: jobName, last_success_at: nowIso, consecutive_failures: 0, updated_at: nowIso }),
      deadlineAt,
      (e) => console.error(`[heartbeat] ${jobName} 成功心跳逾時後才失敗`, e),
    );
    dbMs = Date.now() - dbStartedAt;
    // 🔴 印的是【DB 那一半的預算】不是總預算(codex nit):印 2000 會讓事故判讀誤認 DB 吃光了整體。
    // 🔴 **`{ error }` 不得標成 `ok`**(codex must-fix 2):`store.write` 契約是
    //    「**不拋** —— 錯誤用回傳值表達」(`composition.ts:80`)⇒ 寫入失敗時 `r.error` 有值。
    //    ⇒ 📌 標成 `ok` 會**把寫入失敗混進成功樣本**, 而這一片的全部價值就在
    //      「成功側才是有資訊的那一側」⇒ **汙染成功側等於毀掉這次量測。**
    dbResult = r === 'timeout' ? 'timeout' : r.error ? 'write_error' : 'ok';
    if (r === 'timeout') console.error(`[heartbeat] ${jobName} 成功心跳寫入逾時(${HEARTBEAT_DB_MS}ms)`);
    else if (r.error) console.error(`[heartbeat] ${jobName} 成功心跳寫入失敗`, r.error);
  } catch (err) {
    // 🔴 codex must-fix 1:走到這裡代表 `write()` 直接 reject(或建 store 就炸)
    //    ⇒ 把耗時補上, 否則這一類樣本永遠是 `-1`。
    if (dbMs < 0) dbMs = Date.now() - dbStartedAt;
    // transport 層 reject(網路斷 / DNS)也吃掉 —— 見檔頭「不往上拋」。
    console.error(`[heartbeat] ${jobName} 成功心跳寫入拋錯`, err);
  }

  // ══ 🔴🔴 外部訊號:**不管上面發生什麼都會跑到這裡** ══
  //    DB 那一發答「這一輪的結果有沒有記下來」;這一發答「這一輪有沒有跑」。
  //    ⇒ DB 掛掉而 route 有跑 ⇒ 兩邊會**不一致**,而那個不一致本身就是資訊,不是要被抹平的東西。
  //    ⚠️ 三種 DB 結局(成功 / 回錯 / 逾時)**加上第四種:直接 reject** —— 四種都會走到這裡。
  //       上一版把它放在同一個 try 的末行 ⇒ 第四種會跳過它(codex R2)。
  try {
    // 🔴 **兩個上界同時成立**:總預算不得超過 `HEARTBEAT_MAX_MS`,
    //    而 ping 自己也不吃超過 `HEARTBEAT_PING_MS`(DB 快的時候不因此變寬)。
    // 🔵 ⟦b4-CRON6⟧ 量【ping 那半】的 wall-clock。**在這裡量而不是在 ping 裡面**:
    //    `pingImpl` 是可注入的(`heartbeat.test.ts` 用 spy 注入)⇒ 改它的回傳型別會動到那些 spy。
    //    ⇒ 📌 在呼叫端量, 拿得到同一個數字而**不動任何既有簽章**。
    const pingStartedAt = Date.now();
    await pingImpl(jobName, Math.min(startedAt + HEARTBEAT_MAX_MS, Date.now() + HEARTBEAT_PING_MS));
    const pingMs = Date.now() - pingStartedAt;

    // ══ 🔴🔴 這一行的用途, 以及它【答不出】什麼 ══════════════════════════════
    //  Sean 2026-09-03 批「先讓它印出那一發花了多久, 收幾輪真數字再調」。
    //
    //  🛑 **成功那一發也印** —— 而理由不是完整性:
    //     ping 是 `AbortSignal.timeout(HEARTBEAT_PING_MS)` ⇒ **逾時那些量到的 ≈ 800**
    //     ⇒ 🎯 那不是它真正要花的時間, **是我們把它砍斷的位置**
    //     ⇒ 📌 **失敗側是被截斷的分佈** ⇒ **成功側才是有資訊的那一側**。
    //
    //  🎯 **所以這一行答的不是「該設多少」, 是【該不該用拉大值來修】**:
    //     · 成功側集中在 100-300ms 而失敗率高 ⇒ 🔴 **雙峰**(冷啟動那一類)⇒ 拉大值可能沒用
    //     · 成功側集中在 600-790ms          ⇒ 🟢 就是太趕 ⇒ 拉大值直接有效
    //
    //  🛑 **零 URL、零 err.message、零 err.cause** —— 本行只有兩個數字與一個既有的分類名。
    //     理由見本檔 `pingExternalHeartbeat` 的 catch:
    //     「一個為了好除錯而印出來的錯誤物件, 與一次憑證外洩, 長得一模一樣。」
    //     ⚠️ 而 ping URL 那一串 uuid **就是那支 check 的寫入憑證** —— 拿到的人可以冒充排程
    //     說「我還活著」⇒ **真的掛掉那天面板仍然是綠的**。
    //
    //  🔵 收樣停止條件(判準寫在數字之前):成功側連續兩批(每批 10)p95 差 < 50ms,
    //     且四支各至少 20 筆成功樣本。**不寫「要涵蓋一次冷啟動」—— 我們證不到某一輪是不是冷啟。**
    // ═══════════════════════════════════════════════════════════════════
    // 🔵 `round=` 只在呼叫端給了起點時才出現 ⇒ 沒給的呼叫端那一行**逐位元不變**
    //    (而那是承重的:板上那個「數完成輪數」的量法就是 grep 這一行的 `db=`)。
    const round =
      roundStartedAtMs === undefined ? '' : ` round=${Date.now() - roundStartedAtMs}ms`;
    console.error(
      `[heartbeat] ${jobName} db=${dbMs}ms ping=${pingMs}ms db_result=${dbResult}${round}`,
    );
  } catch (err) {
    // `pingExternalHeartbeat` 自己永不拋;但**注入的替身可能拋** ⇒ 這一層是給測試與未來的呼叫端的。
    const kind = err instanceof Error ? err.name : typeof err;
    console.error(`[heartbeat] ${jobName} 外部存活訊號那一層自己拋了(${kind})`);
  }
}

/**
 * 這一輪失敗了。`last_failure_at` 前進、`consecutive_failures` +1。
 *
 * ⚠️ **`consecutive_failures` 不準,而它【兩個方向都會偏】** —— 三個獨立成因,三個都不修:
 *   ① **低報:真正的 crash 寫不到** —— `503` 那幾條是 `return`(走得到),而 process 掛掉那種走不到。
 *   ② **低報:讀-算-寫不是原子的** —— 同一支 job 兩輪重疊時,後寫的會蓋掉前一次的 +1。
 *      要原子就得開 RPC ⇒ migration ⇒ 鐵則 12③ ⇒ **本片範圍外**,而收益只是一個計數更準。
 *   ③ 🔴 **高報:同一輪可能被記兩次**(R1 N3 指出;~~本檔上一版寫「天生會低報」是錯的~~)——
 *      route 裡 `recordHeartbeatFailure(...)` 與它下一行的 `Response.json(...)` **在同一個 `try` 內**
 *      ⇒ 後者若拋(序列化失敗之類),外層 `catch` 會**再記一次**。
 *      ⇒ **方向與①②相反**,所以不能講成「它只會偏小」。
 * 🔴 **⇒ 這一欄不是【總數】,也不是乾淨的【下限】。**
 *    **告警的主判準是 `last_success_at` 多久沒動,不是這一欄。**
 *    把它當總數用的人會誤判嚴重度 —— 而**兩個方向都會誤判**,所以這句話寫在這裡不是寫在 backlog。
 */
export async function recordHeartbeatFailure(
  jobName: CronJobName,
  store?: HeartbeatStore,
): Promise<void> {
  try {
    // 🔴 `new Date().toISOString()` **在 try 裡面**(codex R1 finding 6):它會拋
    //    (`RangeError: Invalid time value`,或有人替換掉 `Date`)⇒ 放在外面就繞過了本函式的 catch
    //    ⇒ 例外冒到 route ⇒ 又是一次「監控把被監控的弄死」。
    const nowIso = new Date().toISOString();
    // 🔴 **整支函式共用一個截止時刻**(finding 3):不是每一發各給 HEARTBEAT_MAX_MS。
    const deadlineAt = Date.now() + HEARTBEAT_MAX_MS;
    // 🔴🔴 **`getHeartbeatStore()` 必須在 try 【裡面】呼叫,不能寫成預設參數。**
    //    預設參數在**函式本體之前**求值 ⇒ 它拋的時候 **`catch` 接不到** ⇒ 例外冒到 route,
    //    而那幾支 route 的 catch 會把它變成 **503** ⇒ **一輪明明做完了的 sweeper 被心跳弄成失敗。**
    //    ⚠️ 這不是理論:第一版就是寫成預設參數,**既有 route 測試當場 57 格轉紅**
    //    (`deps_or_unexpected_throw`),因為測試環境沒有 service_role 的 env。
    //    📌 而它在正式站的形狀一樣:env 掉了 ⇒ **監控把被監控的弄死** —— 正是檔頭那句話要防的事。
    const s = store ?? getHeartbeatStore();
    // 🔴 讀不到就從 0 起算 —— **而這不是「兜一個預設值」**:讀不到時我們確實不知道之前失敗過幾次,
    //    而從 0 起算會**低估**。低估的方向與檔頭那兩個成因一致(都是低報),不會造出一個假的高數字。
    const read = await withCap(
      s.readFailureCount(jobName),
      deadlineAt,
      (e) => console.error(`[heartbeat] ${jobName} 讀取失敗計數逾時後才失敗`, e),
    );
    // 逾時 ⇒ 當 null ⇒ 從 0 起算 ⇒ **低報**,與檔頭那幾個成因同方向。
    const prev = (read === 'timeout' ? null : read) ?? 0;

    // 🔴 失敗那一發**不碰** `last_success_at` —— 碰了就是把「上次成功是什麼時候」洗掉,
    //    而那正是告警的主判準。
    const r = await withCap(
      s.write({ job_name: jobName, last_failure_at: nowIso, consecutive_failures: prev + 1, updated_at: nowIso }),
      deadlineAt,
      (e) => console.error(`[heartbeat] ${jobName} 失敗心跳逾時後才失敗`, e),
    );
    if (r === 'timeout') console.error(`[heartbeat] ${jobName} 失敗心跳寫入逾時(${HEARTBEAT_MAX_MS}ms)`);
    else if (r.error) console.error(`[heartbeat] ${jobName} 失敗心跳寫入失敗`, r.error);
  } catch (err) {
    console.error(`[heartbeat] ${jobName} 失敗心跳寫入拋錯`, err);
  }
}
