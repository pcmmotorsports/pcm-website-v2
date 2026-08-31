# Plan:把心跳接進告警器 —— 而門檻【不可以抄第二份】

> 線【出貨】`-1e` · 板上落點 `⟦b4-SWEEPDEAD1⟧`(`launch-todo.md:382`)
> Sean 2026-08-30 已拍 **`q4: 甲`** = 現在做(結算程式死掉時寄信通知他)
> 量測 @ **2026-08-31 17:3x** · HEAD `04ab0e16` · 工作樹 **0**
> 🛑 **本檔是提案,一行碼都沒動。標 L1 / 高風險片(鐵則 12 ②權限 + ③DB 結構)⇒ commit 前跑 codex。**

## 0. 那一列還成不成立 ⇒ **成立, 而我重量過, 沒有照抄板上的數字**

```
告警器 packages/use-cases/src/check-anomaly-alerts.ts 提及:
  heartbeat ⇒ 0    心跳 ⇒ 0    sweeper_heartbeat ⇒ 0
🟢 正對照 同尺打 alert ⇒ 49(尺是活的)   🟢 負對照 現造字面 ⇒ 0(尺不亂報)
```
📌 板上那一格是 02:1x 量的,**我沒有引用它, 重量了一次** —— 值一樣, 而那是兩個量測不是一個。

## 1. 🔴 那個「要 Sean 貼 SQL」的前提 —— 我去驗了, **它是真的, 而理由跟板上寫的不一樣**

板上寫「它要新增一支 DB 函式 ⇒ 要他多貼一次 SQL」。**我本來以為這句是錯的**:
儀表板那一側 `cron-heartbeat-read.ts:187` 是 `.from('sweeper_heartbeat').select(...)` —— **直接讀表, 沒有 RPC**
⇒ 那告警器照做不就好了?

🛑 **而告警器走的是另一個角色, 我在正式庫上量了(唯讀)**:
```
告警器 = PgAnomalyAlertReaderAdapter, 連線字串 PAYMENT_CONFIRMER_DB_URL
        (composition.ts:215;不是 service_role)
A. payment_confirmer 直接有 SELECT 的【表】 ⇒ **0**
B. payment_confirmer 有 EXECUTE 的【函式】 ⇒ **30**
D. 它繼承任何角色嗎 ⇒ **沒有**
🟢 正對照 service_role 直接有 SELECT 的表 ⇒ **65**(尺會動)
🟢 負對照 現造角色 ⇒ **0**(尺不亂報)
```
✅ **⇒ `payment_confirmer` 是【只能呼叫函式】的角色, 這是設計不是漏。**
⇒ 📌 **所以【任何】新資料要進告警器, 都必然要一支新函式 + 一次 GRANT ⇒ 都必然要 Sean 貼一次。**
**⇒ 這不是本片的特例, 是那個角色的形狀。板上那一列只說了結論, 這裡補上理由。**

🔴🔴 **而我第一發差點下錯結論, 過程要留著**:
```
我先查「payment_confirmer 有沒有 SELECT on sweeper_heartbeat」⇒ 沒有 ⇒ 看起來就是答案
🟢 而我的正對照【燒了】:它連 orders 都沒有 SELECT
⇒ 那個「沒有」在【權限被漏掉】與【這個角色本來就不讀表】兩個世界印同一句話
⇒ 換成 A/B/D 三格才分得開。
```
📌 **⇒ 一個「查無」在說出它之前, 要先證明這把尺在【該有的時候】會說有。**

## 2. 🔴 這一片最重要的設計判斷:**門檻只能有一份**

現況:每支排程的過期門檻寫在 **TS 白名單**裡(`cron-heartbeat-read.ts:83` `CRON_JOB_WHITELIST`),
六支各有自己的 `staleMinutes`(26h / 30 / 15 / 180 / 6 / 6 分)。

```
⛔ ~~在 SQL 函式裡再寫一份門檻~~
🔴 兩份門檻會漂, 而漂開時【兩邊都不會紅】:
   儀表板說正常、告警器說異常(或反過來)—— 而沒有任何測試同時看得到兩邊。
📌 ⇒ 這正是本 repo 一直在記的那一族:同一個事實兩個載體, 而只有下一手才看得出來。
```
✅ **做法:門檻【從 TS 傳進 SQL】** —— 函式簽名吃一個 `jsonb`(`[{job_name, stale_minutes}]`),
SQL 只負責「照這份清單去比 `last_success_at`」,**不自己知道任何門檻**。
⇒ 📌 **SQL 變成純粹的述詞執行者, 而唯一的門檻來源仍然是那份白名單。**

⚠️ **而白名單現在住在 `apps/admin`, 告警器在 `apps/storefront`** ⇒ 要搬到共用套件。
```
提案:packages/domain/src/cron/job-whitelist.ts(純資料 + 型別, 零相依)
     apps/admin 那支改成 re-export ⇒ 現有 21 格測試與 page.tsx 不必改
🛑 而這一步【動共用套件】⇒ 鐵則 12⑥ 也命中 ⇒ 本片無論如何都要 codex。
```

## 3. 分片

```
片1 · packages/domain 新增白名單(純搬移)+ apps/admin 改 re-export
     驗收:admin 那 21 格測試不改一個字而全綠(它是現成的迴歸網)
片2 · migration:get_cron_heartbeat_stale_counts(jsonb) SECDEF, search_path 釘空,
     只 GRANT EXECUTE TO payment_confirmer(白名單, 不用 blanket)
     回傳:過期的支數 + 哪幾支(名字), 而【不回傳門檻】—— 門檻是呼叫端給的
片3 · 接線五層:IAnomalyAlertReader / PgAnomalyAlertReaderAdapter /
     check-anomaly-alerts / anomaly-alert route(照今天訊號4 那條路, 形狀已知)
片4 · 交一支 SQL 檔給 Sean 貼 + 貼完我用唯讀七格複驗(含 prosrc 逐字比)
```

## 4. 🛑 這一片答不出什麼(不要讀太寬)

```
· 🔴 **「整組 cron 一起死」這一格【本片不關】** —— 告警器自己也是一支 cron,
  它與它要監控的排程走同一條線, 那條線壞掉兩個一起停。
  ⇒ 板上那一列已經寫了這句, 本片不得被讀成關掉了它。
· 本片也不管「沒有人登入後台就沒人看見」—— 那是儀表板那一側的天花板, 與本片無關。
· `ANOMALY_ALERT_ENABLED` 今天是什麼值【沒有人重量過】(板上 ⟦b4-ALERTENV⟧,
  最後一次行為量到是 2026-08-21)⇒ 🔴 **本片做完之後, 它會不會真的寄出去, 取決於那顆 env。**
  ⇒ 📌 **本片交付的是「判準接上了」, 不是「他會收到信」。那是兩件事。**
```

## 5. 要拍板的

```
Q1: 白名單搬到 packages/domain(admin 改 re-export)⇒ 動共用套件, 要不要這樣做?
A: 甲 搬(我推薦 —— 唯一能讓門檻只有一份的做法)
   乙 不搬, SQL 那側自己寫一份門檻(⚠️ 代價:兩份會漂, 而漂開時兩邊都不紅)

Q2: 過期判準要不要與儀表板【逐格相同】?
A: 甲 相同(我推薦 —— 否則同一支排程在兩個畫面上狀態不一樣, 而那會讓人不信任兩個)
   乙 告警用更寬的門檻(少吵), 而要明寫「儀表板紅了而告警不叫」是預期
```
🔵 **Q1 我推薦甲, 而它命中鐵則 12⑥(共用元件)⇒ 本片本來就要 codex, 不因此變貴。**
