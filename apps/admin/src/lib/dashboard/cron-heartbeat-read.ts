import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';

// cron-heartbeat-read.ts — 後台首頁「六支排程各自多久沒成功了」。
//
// 🔴🔴 **天花板(先讀這兩句,不要讀到檔頭深處才發現)**:
//    ① **白名單是手寫的,而沒有任何東西會在它跟真排程漂開時說話。**
//    ② **而讀不到真排程的原因是【三道權限】,不是我們沒去讀** ——
//       否則下一個人會以為是漏做,然後花一輪重新撞那三道(三道逐條在 CRON_JOB_WHITELIST 的說明)。
//    ③ 🔴 **旗標關掉(`enabled:false`)與 route 死掉,本檔印【同一句】「已經 N 分沒成功」。**
//       片1 的 `heartbeat.ts` 檔頭逐字寫「由讀取端的白名單 + 漂移偵測處理(片3)」—— **而 3a 沒接這一格**
//       (R1 I3 抓到:片1 說片3 會接,而片3 沒接也沒說)。方向是**假陽性**(叫比不叫好),
//       ⚠️ 而代價要明寫:`CRON_SWEEPER_ENABLED=false` 或 `ANOMALY_ALERT_ENABLED=false` 期間,
//       **那一列會天天紅** —— 而片1 自己寫過「**天天叫的告警等於沒有告警**」。
//       ⇒ 真正的修法要讀得到那三顆 env(它們在 Vercel 那側,後台讀不到)⇒ **留給 3b,本片不做。**
//
// 授權:Sean 2026-08-28 `q6: 甲`(第二批;原話在 `~/pcm-mailbox/pending-questions-20260827.md` 檔尾)。
//      拆成 3a/3b 是主視窗 2026-08-28 裁的(`Q-片3-拆法 = 甲`)。
//
// 🔴🔴 **這一片不是「監控做好了」,它是「有一個地方看得到」。沒人登入後台就沒人看見。**
//    (主視窗指定這句當板子那一列的標題,理由逐字:「標題是唯一會被掃到的部分」。)
//    真正會**主動叫**的告警是 3b,而 3b 卡在一個結構問題:寄信告警需要「有東西定時去看」
//    ⇒ 那就是第 7 支排程 ⇒ 它自己也走 `pcm_cron.invoke_cron_route`
//    ⇒ **一片修監控的東西,會把自己變成下一個要被監控的東西**(⟦b4-CRON6b⟧)。
//
// 🔴🔴 **拿 `cron.job_run_details` 來交叉驗證這個儀表的人,先讀這一段**(2026-08-28 量):
//    那張表最後一筆結束於 **1.3 分鐘前**、總列 **32,333**、而 `status <> 'succeeded'` 的計數 = **0**。
//    ⚠️ **那個 0 幾乎沒有判別力** —— 對 http 型 job,`pcm_cron.invoke_cron_route` 用 `net.http_get`
//    丟出請求就 RETURN(fire-and-forget)⇒ **route 回 503 也照樣記 succeeded**。
//    📌 **「32,333 筆零失敗」不是健康的證據,是【這把尺量不到失敗】的證據。**
//    📌 而 **32,333 那個大分母,正是讓那個 0 看起來可信的東西** —— 分母越大,那個 0 越像結論。
//    ⇒ 本檔存在的理由就是這個:**心跳由 route 自己寫,只有它知道這一輪真的做了什麼。**
//
// 🔴 寫入端是片1 `aeadd43a`(5 支 HTTP route)+ 片2(第 6 支純 SQL,等 Sean 批鐵則 8)。
//    ⇒ **片2 落地之前,`pcm-expire-unpaid-orders` 這一列會永遠是「從來沒寫過心跳」**,
//      那不是壞掉,是還沒接。這一格由 {@link CRON_JOB_WHITELIST} 的 `wiredAt` 說明。

/**
 * 白名單 —— 而它是**手寫的**,這件事本身是本檔最大的弱點。
 *
 * 🔴🔴 **三邊對帳只做得到兩邊,而讀不到的那一邊正好是權威那邊。**
 *    主視窗指定 `cron.job`(真的會跑的那份)當權威,而 2026-08-28 對正式庫量到**後台讀不到它**,
 *    三道各自單獨就足以擋死:
 *      ① `has_schema_privilege('service_role','cron','USAGE')` ⇒ **false**
 *         (⚠️ 陷阱:`has_table_privilege('service_role','cron.job','SELECT')` ⇒ **true**
 *          ⇒ 只查後面那一格的人會寫「讀得到」,而實際上進不去 schema)
 *      ② `cron.job` 有 RLS,policy 只有一條 `cron_job_policy / ALL / TO public / (username = CURRENT_USER)`
 *         ⇒ 六支全是 `postgres` ⇒ service_role 就算進得去也只看到 **0 列**
 *         📌 而「排程一支都沒有」與「我沒有權限看」**印同一個 0**。
 *      ③ PostgREST 只暴露 `public` 那組 schema,`cron` 不在裡面。
 *    ⇒ **本檔答不出「有排程在跑而沒有人在看」** —— 那一格要 migration 才做得到(鐵則 8 + 12②)。
 *    🔴 而上面那個負對照(`public.zzz_nope_20260828` ⇒ `42P01` 直接報錯)保護的是**這件事**
 *       (`-c8` 2026-08-28 獨立複跑時講得比我準,照收):`has_table_privilege` 對**打錯字的表名會 raise**,
 *       ⇒ **「我打錯表名」與「我真的沒權限」印不同的東西**。
 *       📌 一把「查不到就回 false」的尺,會把這兩件事印成**同一個字** —— 而那正是這一格最容易錯的方向。
 *    ⇒ 那一格是板上的 `⟦b4-CRON6c⟧`(`docs/launch-todo.md`,`-c8` 2026-08-28 開)。
 *    🔴 **而這句話的第一版是「已上板」,而當時板上命中 0**(R1 MF1)——
 *       **「已上板」正是關掉下一個人尋找動作的那種句子**:它不需要任何人回應,而錯了沒有回饋路徑。
 *    ⇒ **自己數,不要相信這一句**:`grep -c 'b4-CRON6c' docs/launch-todo.md` ⇒ 期望 **≥1**;
 *       正對照 同尺換 `b4-CRON6b` ⇒ **2**(尺是活的)。
 *    ⚠️ **而負對照要挑字面**:我第一發用 `zzz-bogus-20260828` ⇒ 回 **1**,那把尺當場失效 ——
 *       因為**隔壁那一列的正文裡就寫著它自己的負對照字面**。
 *       📌 **在一份會把負對照寫進正文的檔案上,負對照字面會被那份檔案自己汙染。**
 *       改用 `b4-CRON9z-20260828-D69` ⇒ **0**,尺才成立。
 *
 * 🔴 `staleMinutes` **這六個數字有【兩種身分】,不要當成同一種**
 *    (`Q36`,線D 內部代號 `Q-片3-門檻`;Sean 2026-08-28 拍 **乙**,原字面在
 *     `~/pcm-mailbox/pending-questions-20260827.md` 檔尾):
 *    · **`pcm-anomaly-alert` 的 26 小時 = Sean 拍的** ⇒ **改它之前要回去問。**
 *      (為什麼特別處理:它每天只跑一次 ⇒ 週期 × 3 要壞滿三天才叫,而它自己就是告警器
 *       ⇒ **最需要早點知道的那一支,會是最晚被發現的那一支**。)
 *    · **其餘五個 = 週期 × 3,仍是【推的】、沒有人拍過** ⇒ **你可以改**,而改完要說一聲。
 *    📌 **這兩句刻意分開寫**:拍板前我寫的是「六個全部是推的」,而 Sean 拍乙之後那句有一半不成立了
 *       —— 🔴 **「還沒有人拍板」與「拍了而剛好跟我猜的一樣」印同一張表,
 *          而它們對下一個想改它的人意義【相反】**(前者是「你可以改」,後者是「改之前要問」)。
 *    🔴 **兩套題號一起寫也是刻意的**(R1 MF2):我內部叫 `Q-片3-門檻`,而主視窗端出去時改叫 `Q36`
 *    ⇒ 只寫一套的話,下一個人拿去 grep **會查無**,而註解會變成「叫人去找一個解析不出來的題號」。
 *
 * ⚠️ `schedule` 那一欄是 2026-08-28 對正式庫 `cron.job` 唯讀撈的**當時值**,六支同一發、總數 6
 *    ⇒ 分母是全部不是抽樣。而**它會漂,而本檔不會知道** —— 那正是上面那條(`⟦b4-CRON6c⟧`,
 *      **上不上得了板自己 grep**,見上面那段)。
 */
export const CRON_JOB_WHITELIST = [
  { jobName: 'pcm-anomaly-alert', label: '異常告警', schedule: '0 1 * * *', staleMinutes: 26 * 60, wiredAt: '片1' },
  { jobName: 'pcm-capture-recheck', label: '請款重查', schedule: '*/10 * * * *', staleMinutes: 30, wiredAt: '片1' },
  { jobName: 'pcm-email-sweep', label: '寄信佇列', schedule: '*/5 * * * *', staleMinutes: 15, wiredAt: '片1' },
  { jobName: 'pcm-expire-unpaid-orders', label: '逾期未付款自動取消', schedule: '0 * * * *', staleMinutes: 180, wiredAt: '片2(未落地)' },
  { jobName: 'pcm-order-ineligible-gate', label: '訂單不可售閘', schedule: '*/2 * * * *', staleMinutes: 6, wiredAt: '片1' },
  { jobName: 'pcm-settle-sweep', label: '結帳掃描', schedule: '*/2 * * * *', staleMinutes: 6, wiredAt: '片1' },
] as const;

/**
 * 🔴🔴 **這一支只准看 staleness,不准看失敗計數。**
 *
 * `pcm-expire-unpaid-orders` 是純 SQL,pg_cron 把它跑在**自己一個交易**裡
 * ⇒ 函式拋錯 ⇒ **同一交易裡寫的失敗心跳一起被回捲** ⇒ 它在物理上寫不出失敗心跳
 * ⇒ 它的 `last_failure_at` 永遠是 NULL、`consecutive_failures` **永遠是 0**。
 *
 * 📌 **而一個永遠是 0 的失敗計數,在儀表上跟「一直很健康」長得一模一樣**,
 *    而它正好是唯一一支**碰錢**(訂單自動取消)的。
 * (完整論證與被否決的兩條替代路:`~/pcm-mailbox/線D-plan-片2-expire心跳-20260828.md` §3。)
 */
export const FAILURE_COUNT_MEANINGLESS: ReadonlySet<string> = new Set(['pcm-expire-unpaid-orders']);

export type CronJobHealth = {
  jobName: string;
  label: string;
  /** 距離最後一次成功幾分鐘;**`null` = 沒有值**(從來沒寫過心跳 / 時間戳解不出來)。絕不得兜成 0。 */
  minutesAgo: number | null;
  /**
   * 連續失敗次數;`null` = **這一支的失敗計數沒有意義**(見 {@link FAILURE_COUNT_MEANINGLESS})。
   * 🔴 `null` **不再兼任「我讀到的不是數字」**(R1 I2):那兩件事一個是設計、一個是壞掉,
   *    共用一個通道就分不出來 ⇒ 壞掉那件改由 {@link consecutiveFailuresUnreadable} 說。
   */
  consecutiveFailures: number | null;
  /**
   * 這一列的 `consecutive_failures` 讀到的**不是數字**(欄位型別漂了 / 回傳被改形狀)。
   * 🔴 它**算異常**(R1 I2):本檔對「時間戳壞掉」的處置是亮紅,對「失敗計數壞掉」原本是**當沒事**
   *    ⇒ **同一支檔兩把尺方向相反**,而方向相反的那一把會靜靜地把一支壞掉的排程印成健康。
   */
  consecutiveFailuresUnreadable: boolean;
  /** 🔴 **「這一列該不該亮」的唯一判準** —— 顯示端只准讀這一格,不准自己再組一次。 */
  abnormal: boolean;
  /** 一句人看得懂的話。兩個世界印不同的東西,而**兩邊都會印**。 */
  note: string;
};

export type CronHeartbeatReport = {
  jobs: CronJobHealth[];
  /**
   * 白名單有、表裡沒有那一列的 job 名字。**印名字不只印計數** —— 要行動的人需要的是名字。
   * 🔴 顯示端要附**該怎麼辦**:「去看它接線了沒(片1 的五支 / 片2 的第六支)」。
   *    📌 一個告警若不附該怎麼辦,看到的人會先花五分鐘重新推導一次。
   */
  neverBeat: string[];
  /**
   * 表裡有、白名單沒有 ⇒ 有東西在寫我們沒在看的心跳。
   * 🔴 該怎麼辦:**白名單過期了,補進去**(連同它的 `staleMinutes`,否則它會安靜地沒有門檻)。
   */
  unknownJobs: string[];
  /** `null` = 讀得到。非 null ⇒ 整份讀不到,顯示端要印出來、**不准留白**。 */
  unreadableReason: string | null;
};

export function unreadableReport(reason: string): CronHeartbeatReport {
  return { jobs: [], neverBeat: [], unknownJobs: [], unreadableReason: reason };
}

type HeartbeatRowRead = {
  job_name?: unknown;
  last_success_at?: unknown;
  consecutive_failures?: unknown;
};

function minutesSince(raw: unknown, now: Date): number | null {
  if (typeof raw !== 'string') return null;
  const ms = new Date(raw).getTime();
  // `Invalid Date` ⇒ NaN,而 NaN 一路算下去不會拋、不會紅,只會印出一個 NaN。
  if (!Number.isFinite(ms)) return null;
  const mins = (now.getTime() - ms) / 60_000;
  return Number.isFinite(mins) ? mins : null;
}

/**
 * 六支排程的健康狀態。**本函式不拋** —— 首頁的失敗隔離靠 `Promise.allSettled`,
 * 而少一個會拋的來源就少一條「這一格壞掉把別格一起帶走」的路。
 */
export async function loadCronHeartbeats(now: Date = new Date()): Promise<CronHeartbeatReport> {
  // `.then(ok, err)`:網路斷 / DNS 失敗 / fetch abort 是真的 reject,不會進 `{ error }`。
  // 形狀抄隔壁 `freshness-read.ts`,不自創第二種寫法。
  const res = await createSupabaseServiceClient()
    .from('sweeper_heartbeat')
    .select('job_name, last_success_at, consecutive_failures')
    .then(
      (v) => v as { data: HeartbeatRowRead[] | null; error: unknown },
      (error: unknown) => ({ data: null, error }),
    );

  if (res.error) {
    console.error('[cron-heartbeat-read] 排程心跳讀取失敗', res.error);
    return unreadableReport('查詢失敗');
  }

  const rows = new Map<string, HeartbeatRowRead>();
  for (const r of res.data ?? []) {
    if (typeof r?.job_name === 'string') rows.set(r.job_name, r);
  }

  const jobs: CronJobHealth[] = [];
  const neverBeat: string[] = [];

  for (const w of CRON_JOB_WHITELIST) {
    const row = rows.get(w.jobName);
    if (row === undefined) {
      // 🔴 「從來沒寫過心跳」與「寫過但很久沒動」是**兩種病**,印不同的句子。
      neverBeat.push(w.jobName);
      jobs.push({
        jobName: w.jobName,
        label: w.label,
        minutesAgo: null,
        consecutiveFailures: null,
        consecutiveFailuresUnreadable: false,
        abnormal: true,
        note: `從來沒寫過心跳(接線落點:${w.wiredAt})`,
      });
      continue;
    }

    const rawSuccess = row.last_success_at;
    // 🔴 R1 I1:「從來沒有成功過」與「時間戳壞掉」是**兩件事**,而它們都讓 `minutesSince` 回 `null`。
    //    `NULL` 是**正常**的:`recordHeartbeatFailure` 刻意不碰 `last_success_at`
    //    ⇒ 一支 route 上線後第一輪就失敗,這一欄就是 `NULL`。
    //    📌 而審查實跑到的形狀是:**`consecutive_failures = 47` 而畫面印「最後成功時間讀不出來」**
    //    ⇒ 47 次連續失敗被印成一句型別問題。**顏色對、指向錯** —— 而指錯方向的紅字,
    //      會讓看的人去查一個不存在的資料問題,而真正的病(它一直在失敗)沒有人看到。
    const neverSucceeded = rawSuccess === null || rawSuccess === undefined;
    const minutesAgo = neverSucceeded ? null : minutesSince(rawSuccess, now);

    const rawFailures = row.consecutive_failures;
    const meaningless = FAILURE_COUNT_MEANINGLESS.has(w.jobName);
    // 🔴 R1 I2:設計上沒有意義 vs 讀到的不是數字 —— 兩件事,兩個欄位,不共用 `null`。
    const failuresUnreadable = !meaningless && typeof rawFailures !== 'number';
    const failures = meaningless || failuresUnreadable ? null : (rawFailures as number);
    const failing = failures !== null && failures > 0;

    if (neverSucceeded) {
      jobs.push({
        jobName: w.jobName,
        label: w.label,
        minutesAgo: null,
        consecutiveFailures: failures,
        consecutiveFailuresUnreadable: failuresUnreadable,
        abnormal: true,
        note: failing
          ? `從來沒有成功過,而已連續失敗 ${failures} 次`
          : failuresUnreadable
            ? '從來沒有成功過,而失敗計數也讀不出來'
            : '從來沒有成功過(有這一列,而成功時間是空的)',
      });
      continue;
    }

    if (minutesAgo === null) {
      jobs.push({
        jobName: w.jobName,
        label: w.label,
        minutesAgo: null,
        consecutiveFailures: failures,
        consecutiveFailuresUnreadable: failuresUnreadable,
        abnormal: true,
        note: '有這一列,而最後成功時間讀不出來',
      });
      continue;
    }

    const stale = minutesAgo > w.staleMinutes;
    // 🔴 未來時間戳(負數)**不是** stale,而它一樣要亮 —— 它是唯一確定「有東西寫錯了」的世界。
    //    照實印、不夾成 0:夾掉它會把那件事藏起來(同 `freshness-read.ts` 被審查抓到的那一格)。
    const future = minutesAgo < 0;
    jobs.push({
      jobName: w.jobName,
      label: w.label,
      minutesAgo,
      consecutiveFailures: failures,
      consecutiveFailuresUnreadable: failuresUnreadable,
      // 🔴 `failuresUnreadable` 進判準 = R1 I2 的修法本體:兩把尺方向要一致。
      abnormal: stale || future || failing || failuresUnreadable,
      note: future
        ? `最後成功時間在未來(${minutesAgo.toFixed(1)} 分)`
        : stale
          ? `已經 ${Math.floor(minutesAgo)} 分沒成功(門檻 ${w.staleMinutes} 分)`
          : failing
            ? `最近一次成功在 ${Math.floor(minutesAgo)} 分前,而連續失敗 ${failures} 次`
            : failuresUnreadable
              ? `${Math.floor(minutesAgo)} 分前成功,而失敗計數讀不出來(欄位型別漂了?)`
              : `${Math.floor(minutesAgo)} 分前成功`,
    });
  }

  // `as const` 讓 jobName 是窄字面聯集 ⇒ `Set<那個聯集>.has(string)` 過不了型別。
  // 這裡要問的是「這個名字在不在白名單裡」,對象本來就是任意字串 ⇒ 顯式放寬成 Set<string>。
  const known: ReadonlySet<string> = new Set<string>(CRON_JOB_WHITELIST.map((w) => w.jobName));
  const unknownJobs = [...rows.keys()].filter((n) => !known.has(n));

  return { jobs, neverBeat, unknownJobs, unreadableReason: null };
}
