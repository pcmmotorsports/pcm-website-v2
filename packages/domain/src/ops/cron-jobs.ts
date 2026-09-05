// @pcm/domain/ops/cron-jobs — 八支排程的白名單與門檻【唯一來源】
//
// 🔴🔴 **這支檔存在的唯一理由:那幾個門檻只能有一份。**
//    它原本住在 `apps/admin/src/lib/dashboard/cron-heartbeat-read.ts`(儀表板那一側),
//    2026-08-31 搬到這裡, 因為**告警器那一側也要用同一份**
//    (`packages/use-cases/src/check-anomaly-alerts.ts`, 走 `apps/storefront`)。
//
// 🛑 **為什麼不是各寫一份(主視窗 `-24` 2026-08-31 裁 `Q1=甲`, 理由是量出來的)**:
//    兩份門檻會漂, 而**漂開的時候兩邊都不會紅** ——
//    儀表板說正常、告警器說異常(或反過來), 而**沒有任何測試同時看得到兩邊**。
//    📌 ⇒ 那是一個【沒有訊號的】不一致, 而它比一個會紅的錯貴一個量級。
//
// 🔴 **改這裡的任何一個 `staleMinutes` ⇒ 儀表板側與告警側【兩邊都要動】。**
//    若你改了而只有一邊變 ⇒ 📌 **那就是「兩份門檻」, 只是穿著「一份」的衣服。**
//    守這件事的是那一發突變測試(見 `cron-jobs.mutation.test.ts` 的意圖說明)。
//
// ⚠️ **搬移紀律(鐵則 6)**:下面那兩段註解是**跟著它們解釋的碼一起搬**的, 不是重寫的。
//    原檔那 81 行(`:38-:118`)在本檔逐字保留 —— **裡面住著拍板紀錄, 壓縮它等於刪掉來源。**

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
  // 🔴 `wiredAt` 帶【憑證】不帶【狀態形容詞】——「已落地」與「未落地」都會過期,而 commit hash 不會。
  //    自己數:`git merge-base --is-ancestor 02c30044 origin/dev`(rc=0 ⇒ 在遠端分支上)
  //    ⚠️ 而「在 dev 上」≠「已 apply 到正式庫」:後者查 `supabase/APPLIED.tsv`,
  //       而那本帳 2026-08-25 起停更 ⇒ **缺一列讀不出是「還沒 apply」還是「帳停更」**
  //       (兩個世界印同一個空格;見 `docs/patterns/guard-and-instrument-traps.md` ⑩-l)
  { jobName: 'pcm-expire-unpaid-orders', label: '逾期未付款自動取消', schedule: '0 * * * *', staleMinutes: 180, wiredAt: '片2 02c30044 / 20260828060000_m4b_b4cron6_expire_unpaid_orders_heartbeat.sql' },
  { jobName: 'pcm-order-ineligible-gate', label: '訂單不可售閘', schedule: '*/2 * * * *', staleMinutes: 6, wiredAt: '片1' },
  { jobName: 'pcm-settle-sweep', label: '結帳掃描', schedule: '*/2 * * * *', staleMinutes: 6, wiredAt: '片1' },
  // 🔵 2026-09-05 加(⟦b9-ACLDRIFT5⟧ 片一 `20260905140000` 建的)。
  //    `staleMinutes` = **2880(兩天)** ——【推的, 沒有人拍過】,理由寫在這裡:
  //    它每天 00:00 跑一次 ⇒ 週期 1440。若照別支那樣「週期 × 3」= 4320(三天),
  //    一支壞掉的排程要**三天**才會叫;而權限漂移這件事三天太久。
  //    ⇒ 取 **連漏兩天才叫**:一次沒跑到不吵(那可能是 DB 維護),兩次就是真的壞了。
  //    🔴 而它與別支不同族:別支一天跑幾十次, 少一次沒訊號;**這支一天只有一次機會**。
  { jobName: 'pcm-acl-digest', label: '權限快照', schedule: '0 0 * * *', staleMinutes: 2 * 24 * 60, wiredAt: '片1' },
  // 🔵 2026-09-05 加(⟦b4-SETTLERETRYNEVER⟧ `20260905220000` 建的)。
  //    `staleMinutes = 30` = 週期 10 × 3, **與 `pcm-capture-recheck` 同一族同一個數**
  //    ——它們做的是同一種事(把一張卡住的單再推一次)。
  { jobName: 'pcm-settle-retry', label: '匯款單重算補跑', schedule: '*/10 * * * *', staleMinutes: 30, wiredAt: '片1' },
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
 *
 * 🔴 **而「拋錯」不是唯一那條路,還有一條連 plpgsql 都攔不住的**:
 * `EXCEPTION WHEN OTHERS` **抓不到 `57014`(查詢被取消 / statement_timeout)** ——
 * 那不是一個可以被 handler 接住的例外,它直接中止整個交易。
 * ⇒ 所以就算把心跳寫進 `EXCEPTION` 區塊,逾時那條路一樣寫不出東西。
 *
 * ⇒ ⇒ **這一支的判別力只剩一個方向:它只會因為【太久沒成功】紅,不會因為【失敗】紅。**
 *    對外報 `null`(見 {@link FAILURE_COUNT_MEANINGLESS})而不是 0 ——
 *    📌 **報 0 等於宣稱「量過了,零失敗」;報 `null` 是宣稱「這一格我量不到」。**
 *    這兩句在畫面上必須長不一樣,否則儀表會替一個量不到的世界背書。
 */
// 🔵 2026-09-05 加 `pcm-acl-digest`:它也是**純 SQL**(`SELECT public.pcm_acl_digest_record();`)
//    ⇒ 同一個物理限制 —— 函式拋錯 ⇒ 同交易寫的失敗心跳一起回捲 ⇒ 失敗計數永遠是 0。
//    📌 而它與 `pcm-expire-unpaid-orders` 的差別只有一個:**這支不碰錢**。
//       ⇒ 後果比較輕, 而**量不到這件事是一樣的** ⇒ 一樣報 `null` 不報 0。
export const FAILURE_COUNT_MEANINGLESS: ReadonlySet<string> = new Set([
  'pcm-expire-unpaid-orders',
  'pcm-acl-digest',
  // 🔵 2026-09-05 加 `pcm-settle-retry`:同一個物理限制(純 SQL, 同交易的失敗心跳會被回捲)。
  //    🔴 而它與 expire 那支一樣**碰錢**(它推的是已經收了款的單)⇒ 後果不比 expire 輕。
  //       ⇒ 報 `null` 不報 0 在這一支更重要:報 0 等於宣稱「量過了, 零失敗」。
  'pcm-settle-retry',
]);
