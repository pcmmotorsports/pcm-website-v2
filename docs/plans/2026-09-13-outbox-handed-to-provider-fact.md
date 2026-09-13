# Plan · `email_outbox` 要記住「這一列交給過 provider 沒有」

> **狀態**:🟡 **等 Sean 批。零實作** —— 本檔不含任何 migration 檔、不含任何 .ts 改動。
> **提出**:B 窗 2026-09-13。**來源**:codex 對抗審查 R2 打掉我兩個版本之後留下的那個洞。
> **鐵則 8** ⇒ 動 schema 先寫 plan。**鐵則 12**:實作那一片碰寄信,commit 前要 codex 審。

---

## 0. 一句話

寄信那張表**記不住「這一封有沒有被交給 Resend 過」**,
而缺了這個事實,有一種取消通知信會**永久寄不出去,且沒有任何東西會叫**。

---

## 1. 病灶(客人那一端會發生什麼)

**情境**:客人用匯款下單、還沒付款,後台取消了部分商品 ⇒ 應付金額變了
⇒ 系統要補寄一封新的信(`bank_order_amount_changed`),印公司帳號與**新的金額**。
🔴 **客人手上已經有一封舊的,帶著舊金額。**

寄之前系統會重驗一次「我手上這份快照還準不準」。不準(例如後台又改了金額)⇒ **不寄**。
那一列被標終態,而**它的去重鍵留著**。

⇒ 📌 掃描面那道 anti-join 只比 `event_type + dedup_key`
(`supabase/migrations/20260913010000_m4b_bank_order_amount_changed_pending.sql:331-335`),
而本型別的鍵 = `{cancellation_id}:{order_id}`,**不含金額指紋**
⇒ 下一輪算出**同一把鍵** ⇒ 那一次取消**再也撈不出來**。

> 🛑 **後果**:客人手上那封錯金額的信**永遠不會被更正**,
> 而 log 全綠、心跳綠、沒有錯誤碼。**沒有人會知道。**

### 為什麼不乾脆「退休那把鍵」就好

因為那會打開另一個洞,而**那個洞已經被實測過**:

```
信 A 已被 Resend 接受 → markSent 落表失敗
  (sweep-email-outbox.ts:2477 送出 · :2486 落表;落表失敗走 :2508 的 catch ⇒ 列留 sending)
→ 租約回收(SupabaseEmailOutboxAdapter.ts:1268 reclaimStaleLeases)
→ 下一輪重新認領 → 這時金額被改過 → 判「快照過期」→ 退休鍵
→ 那一次取消回到掃描面 → 重排一封 → **新的 outbox id = 新的 provider 冪等鍵**
⇒ 🔴 同一次取消【寄出兩封】。金額若又被改回去, 客人收到兩封一模一樣的信。
```
🔬 codex `gpt-6-astra` 2026-09-13 用合成資料實跑到 **送達數 = 2**。

⇒ 📌 **兩個方向都會出事, 而分辨它們需要一個事實:這一列交給過 provider 沒有。**
今天的處置是選了較便宜的那一邊(**不退休鍵 ⇒ 少寄一封**),
並把代價寫在碼裡(`packages/use-cases/src/sweep-email-outbox.ts:2068-2101` 那一段)。
**本 plan 要做的就是把那個抉擇變成不必要。**

---

## 2. 🔴 為什麼這個事實今天不在 DB 上 —— **而它不是「有人忘了加」**

三個看起來像載體的欄位,**逐一驗過都不是**:

| 候選 | 為什麼不行 | 出處(我開檔核過) |
|---|---|---|
| `attempts` | **死信救援會把它歸零** ⇒ 一列已送達的死信被救回來之後,**長得跟全新的一模一樣** | `20260831040000_m4b_maildead_requeue_rpc.sql:136-142` 逐字 `attempts = 0` |
| `last_error_code` | 回收器寫 `lease_reclaimed`(`SupabaseEmailOutboxAdapter.ts:1268-1276`),而**下一次 `markFailed` 會覆寫它**;死信救援也把它設回 `NULL`(同上 `:141`) | 兩處都覆寫 ⇒ 它是**最近一次**的原因,不是歷史 |
| `provider_message_id` | 它由 `markSent` 寫(`SupabaseEmailOutboxAdapter.ts:939, 967`)⇒ **只有成功落表那條路才有** ⇒ 正好在我們要問的那個世界裡是 NULL | 欄本身由 `20260906200000` 新增 |

> 📌 **結論要寫得精確**:`attempts` 從來就**不是**這個事實的載體 —— 它是**退避的依據**
> (`20260717020000_m4a_email_outbox.sql:306` 欄註解逐字「已嘗試次數(退避依據)」)。
> 死信救援把它歸零是**對的**:`claimDue` 的述詞是 `attempts < max_attempts`,不歸零就救不回來。
> ⇒ 🛑 **所以那不是 bug,是我拿錯了東西去問一個它沒被設計來回答的問題。**
> ⇒ 🔴 **下一個人不要再拿 `attempts` 試一次。** 這一段就是為了擋那一次。

🛑 **而本 plan【不碰】`admin_requeue_dead_email` 的歸零行為** —— 那是別人的設計,
要改它是另一題、要端 Sean。本 plan 靠的是**新欄位不在那支 RPC 的 UPDATE 清單裡**
(`20260831040000:136-142` 只寫 `status` / `attempts` / `claimed_at` / `next_retry_at` / `last_error_code`)
⇒ **它天生就會活過一次死信救援**,而那正是我們要的。

---

## 3. 改什麼

### 3.1 DB:一欄

```
ALTER TABLE public.email_outbox
  ADD COLUMN handed_to_provider_at timestamptz;      -- nullable, 無預設
```
形狀照最近一次同款的前例:`20260906200000_m4b_outbox_provider_message_id.sql`
(`SET LOCAL lock_timeout = '5s'` + 前置閘 + 事後閘「本支只准加這一欄」+ 可執行回退)。

**語意(一句,要進 COLUMN COMMENT)**:
> **這一列曾經被交給 provider(呼叫過 `sender.send`),不論結果。**
> 🔴 它**不是**「寄成功了」(那是 `sent_at`)、**不是**「provider 收下了」(那是 `provider_message_id`)。
> 它答的是**「我們有沒有可能已經送出去了」** —— 而那正是「能不能安全地重排一封」要問的問題。

### 3.2 寫入點:**送出之前**,不是之後

`packages/use-cases/src/sweep-email-outbox.ts:2477` 那一發 `sender.send(...)` 的**正上方**。

🔴 **為什麼是之前**:寫在之後,失敗的正好就是我們要抓的那個世界
(送出了而落表失敗)⇒ 📌 **一個只在順利時才記得住的事實,對「不順利」那一格恆為空。**

⚠️ **代價明寫**:寫在之前 ⇒ 它是**過度保守**的 ——
「準備要送」與「真的送出去了」之間仍有 HTTP 沒送出的可能
⇒ 那一列會被標成「交給過」而其實沒有 ⇒ **那一次取消少寄一封**。
🔵 而方向是對的:**少寄一封 < 把一個錯的金額寄兩次**(本族一貫那條)。

🛑 **這一發寫失敗 ⇒ fail-closed,不送。** 理由同上:送了而沒記到,就回到原本的病。

### 3.3 讀取點:那一格抉擇

`sweep-email-outbox.ts:2068-2101` 現在寫著「一律不退休鍵」。改成:

```
handed_to_provider_at IS NULL  ⇒ 退休鍵(它確定沒送過 ⇒ 重排是安全的)
否則                          ⇒ 不退休(可能送過 ⇒ 寧可少寄一封)
```

### 3.4 型別那一層

- `ClaimedEmailJob`(`packages/ports/src/IEmailOutbox.ts:789-803`)加一欄。
- adapter 的 `JOB_SELECT`(`SupabaseEmailOutboxAdapter.ts:168`)要一起加
  —— **漏了 typecheck 不會紅**,那是一個字串常數。
- `markSkippedAmountChangedSnapshotStale`(`ports:1046` / `adapter:1038`)恢復第三個參數。
- 一支新的 outbox 方法把那一欄寫下去(帶世代柵欄 `attempts = claimedAttempts`,同其他 `mark*`)。

### 3.5 🔵 可選:一道 DB 級不變式(**我建議先不做**)

`CHECK (sent_at IS NULL OR handed_to_provider_at IS NOT NULL)` —— 「寄成功了就一定交給過」。
🛑 **而它有 backfill 代價**:今天所有 `sent` 的舊列這一欄都是 NULL ⇒ 直接加會**當場炸**
⇒ 要 `NOT VALID` 或先回填一個假時間,**而回填一個假時間就是把一個猜測寫成事實**。
⇒ 📌 建議:**這一版不加**,留給「這一欄跑滿 30 天之後」再談。

---

## 4. 影響

| | |
|---|---|
| **每封信多一發 DB 寫** | PCM 量級 10-30 封/日(`email-sweep/route.ts:105` 逐字)⇒ 影響為零。⚠️ 量級變了要重算 —— 它進的是同一個 `maxDuration = 60` 的預算 |
| **失敗方向** | 那一發寫失敗 ⇒ 不寄、計 error、列留 `sending`、下一輪回收 —— 與本檔既有的 fail-closed 同形 |
| **既有五族的行為** | **零改變**:退休鍵那個抉擇今天只有 `bank_order_amount_changed` 在用;`markSkippedRecipientStale` 等其它出口本片**不動** |
| **死信救援** | 不改。新欄不在它的 UPDATE 清單裡 ⇒ 自然存活 |
| **ACL** | 與本表其餘欄一致(僅 `service_role`)—— 照 `20260906200000` 事後閘③ 的做法量欄級權限 |
| **PII** | 一個時間戳,零 PII |
| **部署順序** | 🔴 **先貼 migration,再部署碼。** 反序 ⇒ 碼去 select 一個不存在的欄 ⇒ `claimDue` 整個失敗 ⇒ **這一輪一封都不寄**(含付款成功信) |

---

## 5. Rollback

```
✅ 正確的回退單位是【碼】—— 讓 sweep 不再寫、不再讀那一欄, 這一欄留著(零資料損失)。
⛔ ALTER TABLE public.email_outbox DROP COLUMN handed_to_provider_at;  ← 會丟資料
   退掉之後「哪些列可能已經送過」就沒了 ⇒ 那個抉擇退回今天的保守版(一律不退休鍵)。
```
🔵 形狀與理由照 `20260906200000` 檔尾那一段(同一張表、同一種「加一欄」)。

---

## 6. 驗收(每一格都要有負對照)

```
① 一列從沒被認領過 ⇒ handed_to_provider_at IS NULL
   🔬 負對照:認領並走到送出 ⇒ 它不再是 NULL
② 一列在 prepare 階段就失敗(從沒走到 sender.send)⇒ 仍然 IS NULL
   🛑 這一格是承重的:寫錯地方(例如寫在 claimDue 裡)⇒ 它會是 NOT NULL
     ⇒ 📌 退休鍵從此對【每一列】都關掉 ⇒ 這支 plan 等於沒做, 而三綠全綠
③ 快照過期 × handed IS NULL   ⇒ 退休鍵(第三個參數帶 dedup_key)
④ 快照過期 × handed NOT NULL  ⇒ 不退休(第三個參數是 null)
   🔬 ③④ 要用突變驗:把判斷反過來 ⇒ 兩格都要當場紅
⑤ 死信救援之後那一欄【還在】
   🔬 這一格證的是「它活過 attempts 歸零」—— 而那正是本 plan 的理由
⑥ 🔴 JOB_SELECT 漏加那一欄 ⇒ 要有一格會紅
   (那個 select 是字串, typecheck 不會叫 —— 同款前例:adapter 的 `as never` 那一段)
```

---

## 7. 🛑 這支 plan 證不到什麼 / 沒有解掉什麼

- **它不消滅 race**,只把視窗縮小到「寫下那一欄」與「HTTP 真的送出」之間。
  ⇒ 那一段仍然可能「記了而沒送」⇒ **少寄一封**。方向是選的,不是沒想到。
- **它不解 ②(收件地址重驗無條件退休鍵)** ——
  `markSkippedRecipientStale` 對**每一種** event_type 退休鍵,五族靠它
  (它們的鍵不含地址,不退休就永遠插不進去)。
  🔵 **而這支 plan 是 ② 的前置**:有了這個事實,② 才有第三個選項(有條件退休)。
  ⇒ ② 是另一支 plan,**不夾帶**。
- **它不改死信救援**,也不解「重試次數用完之後怎麼辦」那一族。
- **它沒有量過正式庫** —— 本檔引的每個行號都是 repo 內的檔;
  「正式庫的 `email_outbox` 現在有幾列 `sent`」這種數字**本檔一個都沒有**,
  而 §3.5 那個 backfill 判斷要它 ⇒ 📌 **那是實作前要補的一次唯讀實查**,不是現在。

---

## 8. 要 Sean 拍的

```
Q-欄: `email_outbox` 加一欄 `handed_to_provider_at`(時間戳, 寄之前寫), 讓「快照過期的
      取消通知信」能安全地重排一封 —— 今天它永久寄不出去而沒有東西會叫。
A: 甲 = 做(一支 migration + 碼那半, 照上面 §3)
   乙 = 不做, 維持今天的保守版(少寄一封), 而把這個缺口留在板上
   🔵 推薦甲 —— 乙的代價落在客人身上(他手上那封是錯的金額), 而且【沒有人會發現】。

Q-時序: 這一片什麼時候做?
A: 甲 = 現在(它與訂單列表改版不相干, 兩條線不碰同一支檔)
   乙 = 排在訂單列表改版之後
   🔵 推薦甲 —— 它今天就在漏, 而它的射程只有寄信那條線。
```
