# Plan:出貨缺口告警那條線落地 —— 而正式庫上那支函式現在【沒有人呼叫】

> 線【出貨】`-1e` · 樹 `/Users/sean_1/pcm-wt-ship` · 分支 `agent/line-ship` · HEAD `8a60bc5d`
> 寫於 **2026-08-31 11:4x CST** · `origin/dev` **934fa394**(寫的當下)· 未推 **20**
> 🛑 **本檔是提案,尚未實作。標 L1 / 高風險片(鐵則 12 命中 ③DB ④平台設定 ⑤對外發送)。**

## 🔴🔴 先讀這一段 —— 它推翻一個預設,而那個預設會讓人排錯順序

```
pcm-anomaly-alert (0 1 * * *) 是 **pg_cron**, 不是 Vercel cron
來源 supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:12(本窗開檔讀)
⇒ 它【已經每天 01:00 在跑】, 打的是【現在部署的那版】storefront
```
🛑 **⇒ 被推翻的預設**:我們以為片 4 是「把碼放上去, **之後再決定要不要開**」——
**而實際上放上去就是開。** 沒有第二個開關;唯一的第二道閘是那顆 env。

✅ **⇒ 所以片 4 的驗收條件是【部署了而靜默】, 不是【部署了沒事】。**
「沒事」在「靜默」與「它其實根本沒接上」之間分不出來;「靜默」是一個**指定了值**的狀態。

---

## 0. 先講【誰量的】

```
· pg_cron 排程 pcm-anomaly-alert `0 1 * * *`(每日 01:00)
  來源 supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:12(本窗開檔讀)
· 告警管道 = Email + LINE,收件人是【自己人】不是客人
  來源 packages/adapters/src/payment/{EmailAlertNotifierAdapter,LineAlertNotifierAdapter}.ts(檔存在,本窗 ls)
· 新增 env 只有一顆 SHIPPED_EMAIL_CUTOFF
  數法 grep -oE "process\.env\['[A-Z_]+'\]" apps/storefront/src/app/api/cron/anomaly-alert/route.ts | sort -u ⇒ 1 顆
· 那支 RPC Sean 已 apply;正式庫 prosrc md5 = 原始碼 $fn$ 段 md5 = ed51dfbf…(len 2078)
  ⇒ 證據 ~/pcm-mailbox/證據-出貨-正式庫函式複驗-20260831.md
```
🔴 **⇒ 那條 cron【已經每天在跑】,打的是現在部署的那版 storefront。**
**⇒ 所以「部署」就是「上線」,沒有另一個開關。** 唯一的第二道閘是那顆 env。

## 1. 現況與要改什麼

正式庫上有一支 `get_shipped_email_gap_counts`,ACL 只給 `payment_confirmer`,
**而呼叫它的整條線(cron route + packages 四層)都還在 `agent/line-ship`。**
⇒ 📌 **一支沒有人呼叫的函式。** 它不壞事,但下一個人會以為缺口告警已經在跑了。

## 2. 🔴 影響面

```
✅ 客人【不受影響】:本線一封客人的信都不寄, 也不改任何寄信條件。
   route.ts:29 逐字「它**不擋信** —— 本來就要寄的那封照常送出」。
🔴 自己人會收到:告警多兩行(貨出了沒排進佇列 / 兩個信箱都空)。
⚠️ 噪音的代價有前科:板上 `⟦b4-EMAIL2ND⟧` —— 一組會亂叫的告警, 結果是【整組被關掉】。
   ⇒ 這是本 plan 最實際的風險, 不是技術失敗, 是【告警被人關掉】。
🛑 dev 是 pcm-admin 的 production 分支 ⇒ 合進 dev 會觸發重部署。
   ⚠️ 這句是【轉述主視窗】, 本窗未讀過 Vercel 專案設定, **未自行證實**。
```

## 3. 分片(順序寫死,每片 15-45 分鐘、可中斷、獨立有價值)

### 片 1 · `a564eb79` capture-recheck 加一行 log(最小、先走通部署路)
動 `apps/storefront/.../cron/capture-recheck/route.ts` **+17 行:註解 13 行 + 一個 `console.info` 區塊 4 行**。
⚠️ ~~原句寫「16 行註解 + 1 句」~~ —— 本窗實數 `grep -c '^+\s*//'` ⇒ **13**,原句是我目測的。
不改回應碼、不進任何失敗計數。**價值**:那支排程「有沒有上膛」現在在 log 上是一片空白。
**驗收**:部署後隔天 01:xx 的 log 有那一行 / 回應碼仍 200。

### 片 2 · `e0e986ae` + `bbbbba41` 裡那支 migration
🔵 **實際上零改動** —— dev 上已是最終版(`sha256 c72eb1a7…`、213 行,兩側逐字相同,本窗複驗)。
**這一片的動作是「確認不用做」**,不是做。寫成一片是為了讓它有人核對,不是讓它被跳過。

### 片 3 · `ee9e1d45` packages 三層(domain / adapters / use-cases)
純型別與讀取層,**不接上 route** ⇒ 部署後行為零改變。
✅ 本窗查證:`ee9e1d45` 對 adapter 的 diff **零 RPC 呼叫**(`grep '^+' | grep 'rpc\|get_shipped'` ⇒ 0 行)。
**驗收**:`TURBO_FORCE=1 pnpm typecheck` + 該三包的測試綠。

### 片 4 · `bbbbba41` 接上 route + ports(**這一片才會真的上線**)
`route.ts +56` / `IAnomalyAlertReader +8` / 三包 +148。
🛑 **落地後那條 cron 隔天 01:00 就會走新碼。**
🔴 **而「env 沒設就不呼叫 RPC」那道守衛【不在 route】** —— 我第一版寫成 `route.ts:248`,錯了:
那裡只 `console.info` 印一行「還沒上膛」,**然後照樣把 `null` 往下傳**。
✅ 真正的短路點是 `packages/adapters/src/payment/PgAnomalyAlertReaderAdapter.ts:190`
   的 `if (shippedCutoffIso !== null)`(本窗開檔讀)。
⇒ 結論不變(env 沒設 ⇒ 不呼叫 RPC ⇒ 不會 503、不多告警行),**而位置錯會讓下一個人去改錯的檔。**
✅ **而那道守衛與 RPC 呼叫是【同一顆】帶進來的**(`git log -L 188,196` ⇒ `bbbbba41`)
   ⇒ 片 3 不可能出現「有呼叫而沒守衛」的中間狀態。**這是片界成立的理由,不是巧合。**
⇒ **這一片落地時的正確狀態是「部署了而靜默」。**

### 片 5 · 設 `SHIPPED_EMAIL_CUTOFF`(**這一片不是我做的,是 Sean 的手**)
🛑 **順序約束(本體,不是附註)**:必須 **apply 之後**才設。apply 已完成 ⇒ 這一格已解除。
反了 ⇒ 那支 cron 每天 503 一次;**而它不擋信** —— 信照寄,只是那一格印「查不到」。
⚠️ Vercel 設 env 要 redeploy 才生效 ⇒ 設完沒重部署 = 現行 deployment 仍讀不到 = 照舊靜默。

### 片 6 · 🔴 `6741d437` + `scripts/md-table-overflow.py`(**排最後,單獨一顆**)
```
.husky/pre-commit +10 · .husky/md-table-overflow-gate.sh +50 · scripts/md-table-overflow.py +21
```
🛑 **那支 .py 是清單 B 那一支 —— 它與 `.husky` 兩支是同一套的兩半,分開落地就是半套。**
🔴 **它排最後、單獨一顆的理由**:它改的是**每個窗每一次 commit 都會跑的東西**,
而**壞掉時症狀出現在別人的窗** —— 我在自己這棵樹量不到那個症狀。
**⇒ 落地後必須有一個【別的窗】做一顆丟棄式 commit,看 rc 與訊息,才算驗完。**
**驗收**:①那個窗的乾淨 commit rc=0 ②故意 staged 一支壞 `.md` ⇒ rc=1 且理由印 🔴。

## 4. Rollback(逐片,而有一格 revert 不回來)

| 片 | 能不能單獨 revert | 備註 |
|---|---|---|
| 1 | ✅ 能 | 只是少印一行 log |
| 2 | — | 零改動,無可 revert |
| 3 | ✅ 能 | 未接線,revert 零外部影響 |
| 4 | ✅ 能 | revert + 重部署 ⇒ 回到靜默 |
| 5 | ✅ 能 | 移除 env + 重部署;**而 migration 不會被 revert**(也不需要) |
| 6 | ✅ 能 | 但 revert 之前每個窗的 commit 都受影響 |

🔴 **revert 不回來的只有一格:已經送出去的告警(Email / LINE)。**
⇒ 而它的真正代價不是那幾封信,是**收信的人把整組告警關掉**(`⟦b4-EMAIL2ND⟧` 前科)。
⇒ **所以片 5 之後要有人看第一天的實際告警量,而那是人的動作,不是驗收條件寫得出來的。**

## 5. 🛑 這份 plan 答不出什麼

```
· 🔴 正式庫上那支函式的【行為】至今沒有人驗過。
  本窗量到 pcm_readonly 沒有 EXECUTE、也不能 SET ROLE payment_confirmer
  ⇒ 我【無法】在正式庫上呼叫它一次看它回什麼。**那一格是空的,不是驗過的。**
  ⇒ 帳本裡那句未驗保持不動。要關它得有 payment_confirmer / service_role 連線 = Sean 的手。
· 我答不出 SHIPPED_EMAIL_CUTOFF 該設成哪一天 —— 那是營運參數,**Sean 拍**。
  設太早 ⇒ 上線前的舊出貨全部進來 ⇒ 第一天就叫、天天叫(route.ts 自己寫了這一格)。
· 我沒有讀過 Vercel 專案設定 ⇒「dev 會觸發重部署」「env 要 redeploy」兩句都是轉述,未自證。
· 我沒有量過片 6 在【別的窗】的行為 —— 這正是它排最後的理由,不是可以補的缺口。
· 那兩支 view 的 anti-join 不分 status ⇒ 一列 `skipped_shipment_voided` 會永久離開分子
  (板上 `⟦b4-SHIPUNVOID1⟧`)⇒ **本量具在那個漏信面上恆印 0。** 具名盲區,不在本線。
```

## 6. 這份 plan 需要拍板的

```
Q1: 片 1-4 要不要一次走完, 還是一片一 commit 分開審?  A: 一次 | 分開
Q2: SHIPPED_EMAIL_CUTOFF 設哪一天?  ⇒ **見下一節,已備好數字**
Q3: 片 6 落地後由哪一個窗做那顆丟棄式 commit?          A: 主視窗指派
```

---

## 7. 🔴 片 5 那顆 env 的決策資料(端給 Sean 之前先備好,每個選項附一個數字)

> 全部量於 **2026-08-31 12:0x CST**,網站庫正式庫,唯讀 `pcm_readonly`。

### 我怎麼算得出來的(這一格要先講,否則下面的數字沒有來源)

我**讀不到那兩支 view**(`permission denied for function pcm_shipped_email_dedup_key`)。
⇒ 我改成**手動複刻 view 的 SQL**,而那支函式只出現在一個 `NOT EXISTS` 子句裡:
```
NOT EXISTS (select 1 from email_outbox e
            where e.event_type='order_shipped' and e.dedup_key = pcm_shipped_email_dedup_key(s.id,o.id))
數法 select count(*) from public.email_outbox where event_type='order_shipped'  ⇒ **0**
```
🔵 **⇒ 那個子查詢的來源表【一列都沒有】⇒ `NOT EXISTS` 對每一列恆真 ⇒ 拿掉它是【等價】不是【近似】。**
🛑 **而這個等價【有前提】**:等到第一封 `order_shipped` 寄出去,這個複刻就不再等價。
**⇒ 下面的數字有保鮮期,不是永久事實。**

### 現況(三個數,同一發量的)

```
已出貨、未刪的 shipment            3 筆(2026-08-12 / 08-17 / 08-22)
  複刻 pending(有信箱、信沒排進佇列)  **3**
  複刻 unsendable(兩個信箱都空)      **0**
歷史上寄出過的 order_shipped 信      **0 封**
  (對照:order_created 有 2 封 ⇒ 那張表是活的, 不是空表 ⇒ 這個 0 是量到的)
shipments 全表 6 筆:3 筆已刪(2 筆測試清理 / 1 筆 void_reason='123')
```
📌 **⇒ 那 3 筆是【真的缺口】** —— 貨出了、客人有信箱、而通知信一封都沒被排進佇列。
⚠️ **而它們是不是「該補寄」是另一個問題,本量具不回答,本 plan 也不主張。**

### 兩個選項(各附數字)

```
甲 · 起始線設【早】(例如 2026-08-01,涵蓋現有全部)
   ⇒ 第一天分子 = **3**,告警立刻叫,而它會【每天叫】直到那 3 筆被處理掉
     (本 use-case 明文零 per-anomaly 去重 —— check-anomaly-alerts.ts 檔頭那段)
   ⇒ 代價:板上 ⟦b4-EMAIL2ND⟧ 的前科 = 一組每天叫而沒人能結掉的告警, 結果是【整組被關掉】
   ⇒ 而「能不能結掉」這一格我答不出來:補寄那 3 封的入口存不存在, **我沒查**

乙 · 起始線設【上線那天】(例如部署當天)
   ⇒ 第一天分子 = **0**,靜默上線
   ⇒ 代價:那 3 筆**永遠不會被這個量具看到** —— 而它們現在是這條線上唯一已知的真缺口
   ⇒ 📌 一個量具的起始線同時決定了【它永遠看不到什麼】,而那不會有任何訊號
```
**我推薦乙**,而理由不是「風險低」:
**甲的第一天就會產生一個【沒有結束動作】的告警**,而那正是 `⟦b4-EMAIL2ND⟧` 記的那個病。
⇒ 先用乙讓量具活起來、確認它會叫;**那 3 筆單獨開一條「補寄或註記」的線去處理**,
   不要讓一個新裝的量具的第一次發聲,是一件它自己解決不了的事。

🛑 **而「不設」現在就是預設狀態,它的代價要寫出來**:
片 4 部署後 env 不設 ⇒ 那一段恆靜默 ⇒ **與「它壞了」在 log 上分得出來**
(`route.ts:249` 會印一行 `skipped_no_cutoff`)⇒ 這一格是安全的,**但它不會自己結束**——
終結它的動作是「有人去設那顆 env」,而那是人的動作,沒有機制會催。
