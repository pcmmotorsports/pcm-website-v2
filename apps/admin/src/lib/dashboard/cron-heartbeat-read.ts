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

// 🔴🔴 **那六個門檻與失敗計數白名單【已經不住在這裡了】**(2026-08-31 搬走)。
//    唯一來源 = `packages/domain/src/ops/cron-jobs.ts`。
//    ⇒ **搬走的理由不是整潔**:告警器那一側(`check-anomaly-alerts.ts`,走 `apps/storefront`)
//      要用**同一份**門檻;各寫一份的話兩邊會漂, 而**漂開時兩邊都不會紅**
//      (儀表板說正常、告警器說異常, 而沒有任何測試同時看得到兩邊)。
//    主視窗 `-24` 2026-08-31 裁 `Q1=甲` / `Q2=甲`(判準與儀表板逐格相同)。
//
// 🛑 **這裡是 re-export, 不是第二份定義** —— 改門檻請去 `@pcm/domain`,
//    改這裡改不到告警器, 而**那正是本次搬移要消滅的那個世界**。
import { CRON_JOB_WHITELIST, FAILURE_COUNT_MEANINGLESS } from '@pcm/domain';
// 🔵 兩行都要:`export … from` 只轉出去、**不會把名字帶進本檔作用域**,
//    而本檔下面 `:136` / `:164` / `:226` 三處在用它們。
export { CRON_JOB_WHITELIST, FAILURE_COUNT_MEANINGLESS };

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
