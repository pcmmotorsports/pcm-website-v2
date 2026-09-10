# plan · 金流那兩支排程掛掉,10 分鐘內要有人知道

> 窗D 2026-09-10 寫。**本片只有 plan,一行碼都沒改。**
> 拍板出處:Sean「Q2 排程掛掉最壞 26 小時才有人知道 ⇒ **修好**」= **甲**
> 甲 = 只縮**金流那兩支**(`pcm-settle-retry` · `pcm-expire-unpaid-orders`),加一支每 10 分的輕檢查。
>
> 標籤:**【量的】**(命令 + 讀數)/ **【推的】** / **【證不到】**

---

## 〇、先把「26 小時」拆開 —— 它不是門檻,是**看的人多久來一次**【量的】

`packages/domain/src/ops/cron-jobs.ts` 的登記表(逐字):

| 排程 | schedule | staleMinutes |
|---|---|---|
| `pcm-anomaly-alert`(**唯一在看的人**) | `0 1 * * *` | 26×60 |
| `pcm-settle-retry` | `*/10 * * * *` | 30 |
| `pcm-expire-unpaid-orders` | `0 * * * *` | 180 |
| `pcm-capture-recheck` | `*/10 * * * *` | 30 |

🎯 **⇒ 兩支金流排程的「過期」判準本來就是 30 / 180 分,而【沒有人在那個時間點看】** ——
唯一會呼叫心跳檢查的是 `pcm-anomaly-alert`,**它一天只跑一次**。

```
今天最壞    staleMinutes  +  最多 24 小時(等下一次 anomaly-alert)
本片之後    staleMinutes  +  最多 10 分鐘
⇒ settle-retry        30 分 + 24 小時  ⇒  30 分 + 10 分
⇒ expire-unpaid-orders 180 分 + 24 小時  ⇒ 180 分 + 10 分
```
🛑 **而 `staleMinutes` 那一半【本片不動】** —— 180 分就是 180 分。
📌 **⇒ 要對 Sean 講清楚的一句**:這一片把「多久有人來看」從一天縮到 10 分鐘,
**沒有**把「多久算掛了」從 180 分縮短。**要縮那個是另一件事、另一個拍板**
(登記表 `:20` 逐字警告:改 `staleMinutes` ⇒ 儀表板側與告警側兩邊都要動)。

---

## 一、Q1 現有的函式夠不夠?⇒ **夠。不寫新的 DB 碼。**【量的】

```
定義   supabase/migrations/20260831170000_m4b_sweepdead_heartbeat_stale_counts.sql:58
簽章   public.get_cron_heartbeat_stale_counts(p_jobs jsonb) RETURNS jsonb
       VOLATILE · SECURITY DEFINER · SET search_path = ''
代數   scripts/latest-definition-of.sh ⇒ 共 1 代 / 1 個定義點(沒有多代要挑)
現有呼叫端  packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:539
```

它吃的就是一個白名單陣列,每筆三鍵:`job_name` / `stale_minutes` / `failures_meaningful`。
✅ **⇒ 餵那兩支進去就好,函式一個字都不用改。**

🟢 **而它的 fail-closed 三道剛好是我們要的**(檔內逐字):`p_jobs` 為 `NULL` / 不是陣列 / 空陣列 ⇒ **一律 `RAISE`**。
理由檔內寫死:「回 0 = 沒有排程過期 = 不告警 ⇒ **壞掉的輸入與健康的世界印同一個東西**」。
📌 **⇒ 一個只餵兩支的呼叫,最怕的就是白名單被弄空而靜默回 0,而那一格它自己擋了。**

⚠️ `failures_meaningful` **必填、不預設**(檔內 codex R1 F3 must-fix)。**值查出來了**【量的】:
```
PgAnomalyAlertReaderAdapter.ts:533  failures_meaningful: !FAILURE_COUNT_MEANINGLESS.has(w.jobName)
cron-jobs.ts:144-167  FAILURE_COUNT_MEANINGLESS 含 pcm-expire-unpaid-orders 與 pcm-settle-retry
⇒ 🔴 這兩支【都是 false】。
```
🔴🔴 **而那一格比「填什麼」重要 —— 它決定這個檢查只有【一個】訊號可用。**
`cron-jobs.ts` 逐字:這兩支是**純 SQL** 排程,pg_cron 跑在自己一個交易裡
⇒ 函式拋錯 ⇒ **同交易寫的失敗心跳一起被回捲** ⇒ `consecutive_failures` **永遠是 0**,
「而那與『一直很健康』長得一樣」。
⇒ 📌 **所以對這兩支,唯一量得到的是「距離上次【成功】多久」**(= `staleMinutes` 那條路)。
✅ **好消息:那正是本片要縮的那一條。** 🛑 **而要寫給讀的人**:這個檢查**不會**因為「它失敗了」而叫,
只會因為「它太久沒成功」而叫 —— **兩者在這兩支上是同一件事,而在別的排程上不是。**

---

### 🔴🔴 Q1 的第二格:**Sean 的「只餵那兩支」與現有碼裡一句明文的保護【對衝】**

`PgAnomalyAlertReaderAdapter.ts:527-528` 逐字:
> 🔴 **`jobsPayload` 直接 map 白名單全部, 這裡不篩不排除** ——
> 片2 那支函式**證明不了我有沒有少送**, 所以**這一行就是那個保護本身**。

🎯 **⇒ 現有那個呼叫端刻意【不做篩選】,因為「少送一支」與「那支很健康」在回傳值上同形。**
🛑 **而甲要的正是一個【只送兩支】的呼叫端** ⇒ **那個保護在新的呼叫端不存在。**

⇒ ✅ **建議的處置(而它便宜)**:那兩支的名單**不要手打字串**,而是從 `CRON_JOB_WHITELIST`
**依名字挑出來,並且斷言「挑到 2 筆」** —— 挑不到 2 筆就 `throw`。
📌 **理由**:一個手打的 `['pcm-settle-retry', 'pcm-expire-unpaid-orders']` 在有人改名之後
會**靜默變成挑到 1 筆或 0 筆**,而 0 筆會被那支函式的 fail-closed 擋下(好),
**1 筆不會** —— 那就是「少送一支而看起來正常」。

⚠️ **而動 `cron-jobs.ts` 有一條既有的不變式要小心**(檔內 `:161-166` 2026-09-08 R2 訂正):
`FAILURE_COUNT_MEANINGLESS` 的**插入序**要與 `CRON_JOB_WHITELIST` 的**相對序**一致
(`PgAnomalyAlertReaderAdapter.test.ts:1411-1412` 釘著)。
⛔ 那裡還記了一句**已被劃掉**的舊規則「新增一律 append」——📌 **不要照劃掉那句做。**

---

## 一之二、🔴🔴 **訂正:Q1 那句「不寫新碼」只在 DB 層成立,在 app 層【不成立】**

> 2026-09-10 動手前查證時發現。**我上面那一節只驗了 DB 那一層,就寫下了「不寫新碼」** ——
> 📌 **那正是今晚一直在抓的形狀:驗了一層,推了另一層。**

三件實測:

**① 那個 reader port【沒有】單獨的心跳方法**【量的】
`packages/ports/src/IAnomalyAlertReader.ts` 全部方法:`getAlertSummary` / `getManualCustomerSearchSummary` /
`getSearchLogHealth` / `getSupplierSyncStaleCounts` / `getStuckBankOrdersHealth` / `getFitmentSyncFreshness`。
⇒ **心跳是算在 `getAlertSummary` 裡面的**,而那支吃 7 個參數、把所有偵測跑一遍
⇒ 🛑 **每 10 分呼叫它 = 每 10 分把整套異常偵測跑一遍**,那不是「輕檢查」。

**② 那支 DB 函式【沒有授給 `service_role`】**【量的 · 唯讀正式庫】
```
public.get_cron_heartbeat_stale_counts(jsonb) 的 ACL
  postgres=X/postgres | payment_confirmer=X/postgres
```
migration `20260831170000:236-239` 逐字:`REVOKE ALL … FROM payment_confirmer` 之後只 `GRANT EXECUTE … TO payment_confirmer`。
⇒ 🛑 **前台的 `createSupabaseServiceClient`(service_role)叫不動它。** 要叫 ⇒ **一次 GRANT ⇒ 一支 migration。**
⚠️ **而我這一發的「正對照」標錯了**:我把 `get_supplier_sync_stale_counts` 標成「一支確定 service_role 叫得動的」,
而它的 ACL **一模一樣** ⇒ 📌 **那個對照沒有證明我標的那件事。**(結論不受影響 —— ① 那一格是直接讀出來的字面。)

**③ 「算過期」今天已經有【兩份】實作,不是一份**【量的】
```
DB 側    get_cron_heartbeat_stale_counts(jsonb)      ← anomaly-alert 走 payment_confirmer 叫
admin 側 apps/admin/src/lib/dashboard/cron-heartbeat-read.ts:228  const stale = minutesAgo > w.staleMinutes
共用的只有【資料】 packages/domain/src/ops/cron-jobs.ts 的白名單與 FAILURE_COUNT_MEANINGLESS
⇒ 🛑 domain 層【沒有】共用的「算過期」函式(搜 packages/domain/src/ops 只有 cron-jobs.ts 與它的測試)
```
📌 **⇒ 而 `cron-jobs.ts:20` 逐字警告過這件事**:「改這裡的任何一個 `staleMinutes` ⇒ **儀表板側與告警側兩邊都要動**」。
**那句話存在,正是因為今天已經有兩份。**

### ⇒ 🛑 三條路,而【每一條都命中鐵則 8】—— 所以本片停在這裡等批

| | 做法 | 代價 | 鐵則 8 命中什麼 |
|---|---|---|---|
| **甲** | 新增 port 方法 `getCronHeartbeatStaleCounts(jobs)` + adapter 實作,走既有的 `payment_confirmer` 連線 | 分層最乾淨;**不新增第三份判斷邏輯**(仍然是那支 DB 函式在算) | **共用元件**(`packages/ports`) |
| **乙** | 前台直接讀 `sweeper_heartbeat` 表(照 admin 的形狀),自己比時間 | 零 DB 改動、零 port 改動,今天做得完 | **不命中**——而它讓「算過期」變成**第三份**實作 |
| **丙** | 補一次 `GRANT EXECUTE … TO service_role`,前台用 service client 直接 `.rpc()` | 不新增邏輯、不動 port | **權限 + migration**(要 Sean 貼) |

🔵 **我的推薦:甲。而理由不是分層漂亮,是【乙會製造第三個會說相反話的地方】。**
本 repo 已經為「兩邊各自算而說相反的話」付過帳(`cron-jobs.ts:85` 那段 codex R1 F3 逐字記著
「A 說異常而 B 說正常」)⇒ 📌 **在一個已經有兩份的地方加第三份,是把已知的病再犯一次。**

🛑 **而甲要動 `packages/ports` ⇒ 我不自己動。** 這一片停在這裡。

---

## 二、Q2 掛在哪裡?⇒ **搭 `pcm-capture-recheck` 的順風車,而代價寫在下面。**

### 甲(推薦)搭順風車
```
改   apps/storefront/src/app/api/cron/capture-recheck/route.ts(171 行, 已有 requireCronSecret / maxDuration 60)
不改 vercel.json · 不新增 /api/cron/ 路由 · 不新增 migration
```
✅ **最省的理由不是「少寫碼」,是【不動 vercel.json】**:
`vercel.json` 今天的頂層鍵只有 `$schema / framework / installCommand / regions` —— **沒有 `crons`**【量的】。
⇒ 排程全部是 pg_cron(`cron.schedule`,見 `20260820070000_m4b_capture_recheck_pgcron.sql:58`)。
⇒ 📌 **不新增路由 = 不碰 WAF 那一面 = 那兩支閘這一片是 no-op**(仍然要跑,見第四節)。

🔴🔴 **而搭順風車有一格【位置錯了就整片無效】,實作時最容易踩**【量的】:
`capture-recheck/route.ts:125-148` 有一道**上膛閘** —— `CAPTURE_RECHECK_CUTOFF_DAYS` 沒設 ⇒
**整段不跑、回 200、而且刻意【不寫心跳】**(檔內逐字:「這條路仍然不寫心跳 ⇒ 儀表板照舊會把它標成過期」)。
⇒ 🛑 **檢查若放在那道閘【之後】,只要那顆 env 沒設,它就一輪都不會跑,而回應仍然是 200。**
⇒ ✅ **必須放在【認證 + 限流之後、上膛閘之前】。**
⚠️ **而「那顆 env 今天設了沒」我【證不到】** —— 那是 Vercel 環境變數,不在 repo 裡。
📌 **⇒ 這一格要在驗收裡釘死**:`CUTOFF_DAYS` 未設的世界,那個心跳檢查**照樣要跑、照樣要能叫**。

🛑 **代價,明寫**:**`pcm-capture-recheck` 自己掛掉 ⇒ 這個檢查跟著啞。**
而它啞掉之後,誰會發現?—— **只有一天一次的 `pcm-anomaly-alert`。**
⇒ 🔴 **⇒ 那等於:capture-recheck 掛掉的那 24 小時裡,兩支金流排程回到【沒有人看】的狀態,而畫面上什麼都不會變。**
🛑 **而這個盲點【從裡面關不掉】** —— 把 `pcm-capture-recheck` 也放進白名單沒有用:
它自己跑得起來才會回報,**跑不起來的時候沒有人替它說話**。

### 乙 新開一支每 10 分的 cron
```
要   一支新的 /api/cron/<name> 路由 + 一支 migration 做 cron.schedule(⇒ 鐵則 8 · 要 Sean 貼)
換到 獨立於 capture-recheck ⇒ 甲的盲點消失
代價 多一支排程 ⇒ 多一個會掛的東西, 而【它自己掛了誰看】仍然只有每天那一次
```
📌 **⇒ 乙沒有消滅那個問題,它把問題往上推了一層。** 任何「觀察者」都有這一格。

### ⇒ 建議 **甲**,理由三句
1. 今天的痛是「一天才看一次」,甲把它變成 10 分鐘 —— **主要的收益甲就拿到了**。
2. 甲**不動 schema、不動 vercel.json、不需要 Sean 貼任何東西** ⇒ 今天做得完。
3. 甲的盲點(capture-recheck 掛掉)**乙也沒有真的解決**,而乙多一支要維護的排程。

---

## 三、Q3 告警海嘯 ⇒ **先不節流,而把上界寫出來**

🔴 **先講一件量到的事**:**這條告警路徑上【沒有任何節流或去重】**【量的】。
我在 `anomaly-alert/route.ts` 搜 `throttl|cooldown|suppress|dedup` ⇒ **零命中**
(🟢 正對照:同一把尺搜 `anomaly` ⇒ **77** 命中 ⇒ 尺會咬)。
而檔裡那個 `86400` 是 **`ALERT_REFUNDING_STUCK_SECONDS`** = **偵測門檻**,不是告警間隔。

🎯 **⇒ 所以「每天只跑一次」本身就是今天的節流。這一片會把它拿掉。**

三個做法:
| | 做法 | 代價 |
|---|---|---|
| **甲(推薦)** | 不節流,壞掉時每 10 分叫一次 | 上界 **6 則/小時**、144 則/天 |
| 乙 | 只在【狀態翻轉】時叫(正常 ⇒ 異常) | 要一份**狀態**存在哪裡 ⇒ 新 schema 或新 KV ⇒ 鐵則 8 |
| 丙 | 固定冷卻窗(例如 1 小時內只叫一次) | 同樣要存「上次叫的時間」⇒ 同乙 |

⇒ **建議甲**,理由:
· 一支**金流**排程掛了,**吵是對的** —— 而修好它的時間窗以小時計,不是以天計。
· 乙/丙都要新增持久狀態 ⇒ **本片就從「不動 schema」變成「動 schema」** ⇒ 要 plan + Sean 批 + codex。
· 📌 **而甲有一個誠實的上界可以先講:6 則/小時。** 如果真的吵到了,再做丙 —— **那時我們會有一個真實的數字,不是現在猜。**

🛑 **而甲有一格要 Sean 知道**:LINE 與 Email 兩個管道都會收到
(`LineAlertNotifierAdapter` / `EmailAlertNotifierAdapter`)⇒ **6 則/小時是【每個管道】。**

---

## 四、Q4 會動哪幾個檔 · 兩支閘

### 甲(搭順風車)會動的:
```
apps/storefront/src/app/api/cron/capture-recheck/route.ts      改(加檢查與告警)
apps/storefront/src/app/api/cron/capture-recheck/route.test.ts 改(加守門)
packages/domain/src/ops/cron-jobs.ts                           可能改(匯出那兩支的子集常數)
```
🟢 **不會動**:`vercel.json` · `supabase/migrations/**` · `supabase/rollbacks/**` · 任何 schema。

### 兩支閘
```
scripts/vercel-json-waf-cron-gate.py        看 repo:vercel.json 有沒有 WAF 規則會擋到 /api/cron/
scripts/vercel-firewall-cron-order-check.py 看 live:線上防火牆規則的順序
```
🔵 **本片(甲)不動 `vercel.json`、不新增 `/api/cron/` 路徑 ⇒ 兩支【預期都是 no-op】。**
🛑 **而仍然要跑兩支** —— 理由:**「我沒動它」與「它現在是好的」是兩件事**,而閘是唯一會說話的那個。
⇒ 📌 若跑出紅,那是**既有的紅**,要先分清楚是不是我造成的(做法:`git stash` 我的改動再跑一次)。

### 乙(新開 cron)額外要動的:
```
apps/storefront/src/app/api/cron/<新名>/route.ts     新增
supabase/migrations/<新版本號>_*.sql                  新增(cron.schedule)⇒ 🔴 鐵則 8 · Sean 貼
supabase/rollbacks/<同版本號>_down.sql                新增
packages/domain/src/ops/cron-jobs.ts                 必改(新排程要進登記表, 否則它自己沒人看)
```

---

## 五、驗收(yes / no)

```
① 把兩支的 job 從 cron.job 上停掉一支(拋棄式 PG, 不碰正式庫)⇒ 10 分鐘內那個檢查【要叫】
② 兩支都健康 ⇒ 那個檢查【不准叫】          ← 🔴 沒有這一格, ① 過了也不算數
③ 白名單被弄成空陣列 ⇒ 函式 RAISE, 而 route 要把它當【故障】不是【正常】
   (那是本片最毒的一格:回 0 = 不告警 = 與健康的世界同形)
④ capture-recheck 那條路原本的行為【一個字都沒變】—— 現有測試全綠
⑤ 三綠 + 全套 vitest(不是只跑三綠)
```

🔴 **① 與 ② 一定要成對** —— 一把只驗過「該叫的時候會叫」的尺,分不出「守住了」與「它恆叫」。

---

## 六、🛑 我證不到什麼 / 沒查完的

- ✅ ~~現有白名單那兩支的 `failures_meaningful` 我沒讀出來~~ ⇒ **查掉了,兩支都是 `false`**(見第一節)。
- **【證不到】那兩支的 `staleMinutes`(30 / 180)今天合不合適** —— 我只確認它們是登記表上的值,**沒有量過它們實際跑多久**。
- **【證不到】6 則/小時會不會真的吵到 Sean** —— 那是體感,要他看過才知道。
- **【證不到】`pcm-capture-recheck` 自己的可靠度** —— 我沒有它的歷史失敗率;甲的盲點有多大,**今天沒有數字**。
- **沒有實跑任何一格** —— 本片是讀碼與讀正式庫元資料,零執行。
- **`staleMinutes` 那一半沒碰**,而 `pcm-anomaly-alert` 的 26 小時**是 Sean 拍的**(登記表 `:58` 逐字「改它之前要回去問」)⇒ 本片不碰。

---

## 七、⚠️ 實作時會踩到的一格(先寫下來)

`packages/domain/src/ops/cron-jobs.ts` 與 `anomaly-alert/route.ts` 都記過:
**cron 字面裡的 `*` 加斜線連在一起,會把 TypeScript 的區塊註解關掉。**
2026-08-31 當場踩過,`typecheck` 報 `TS1109: Expression expected` 三行,**而那三行看起來與註解無關**。
⇒ 📌 寫註解提到 `*/10` 那種排程時要拆開寫。
