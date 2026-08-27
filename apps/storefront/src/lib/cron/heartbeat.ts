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
//    交給 sweep;`settle-sweep/route.ts:66` 自陳「單輪最壞 ≈50s / 真餘量 ~10s」。
//    ⇒ 心跳排在**最後一步**,而**平台 kill 不可 catch**
//    ⇒ **一輪真的做完了、而心跳沒寫進去** ⇒ 讀取端報「沒心跳」⇒ **假陽性告警**。
//    📌 那正是 `#231` migration 檔頭稱為**「自我擊敗」**的那一格:一個為了消除假陰性而建的東西,
//       變成假陽性的來源。**今晚已經擋掉它的一種形態(預設參數),這是第二種。**
//    ⇒ 處置:{@link HEARTBEAT_MAX_MS} 硬上界(形狀抄 `settle-sweep/route.ts:216-233` 的
//      `Promise.race` + budget,不自創第二種寫法)。
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

/** 這一輪真的做完了。`last_success_at` 前進、失敗計數歸零。 */
export async function recordHeartbeatSuccess(
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
    // 🔴 成功那一發**不碰** `last_failure_at` —— 碰了會把上一次真的失敗抹掉。
    const r = await withCap(
      s.write({ job_name: jobName, last_success_at: nowIso, consecutive_failures: 0, updated_at: nowIso }),
      deadlineAt,
      (e) => console.error(`[heartbeat] ${jobName} 成功心跳逾時後才失敗`, e),
    );
    if (r === 'timeout') console.error(`[heartbeat] ${jobName} 成功心跳寫入逾時(${HEARTBEAT_MAX_MS}ms)`);
    else if (r.error) console.error(`[heartbeat] ${jobName} 成功心跳寫入失敗`, r.error);
  } catch (err) {
    // transport 層 reject(網路斷 / DNS)也吃掉 —— 見檔頭「不往上拋」。
    console.error(`[heartbeat] ${jobName} 成功心跳寫入拋錯`, err);
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
