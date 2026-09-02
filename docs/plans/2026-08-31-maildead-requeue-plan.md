# Plan:被放棄的信怎麼重排 —— 而【第一件事是不要把歷史一次寄出去】

> 線【出貨】`-1e` · 樹 `/Users/sean_1/pcm-wt-ship` · 板上落點 `⟦b4-MAILDEAD⟧`
> 量測 @ **2026-08-31 14:34** · HEAD `75ddbdb1` · 工作樹 **0** 項未 commit
> Sean 批「做重排」· 🛑 **本檔是提案,一行碼都沒動。標 L1 / 高風險片(鐵則 12⑤ 對外寄信 + ③DB)。**

## 🔴🔴 先讀這一段 —— 這是今天第三次同一個形狀

```
早上 SHIPPED_EMAIL_CUTOFF 設早 ⇒ 把歷史箱一次全寄出去   ← 碼裡 EARLIEST_SANE 擋住了
中午 訊號4 判準寫 scanned>0    ⇒ 把歷史缺口一次全叫出來  ← 我在 plan 裡擋掉了
現在 重排                      ⇒ 把【已經放棄很久】的信一次全寄出去
```
🛑 **⇒ 而這一次與前兩次不同:前兩次最壞是【叫】,這一次是【真的寄出去,而信收不回來】。**
✅ **⇒ 所以本 plan 先答那一格,再談怎麼做。**

## 0. 那一列還成不成立(接手第一步,不是形式)

```
指令 bash scripts/is-this-still-true.sh "b4-MAILDEAD"    (2026-08-31 14:34)
① 有人 commit 修掉了嗎 ⇒ 四顆相關 commit **全是 docs**(bd527ebc / 12cafe47 / 040f3577 / e6544b6c)
② 板上態 ⇒ `open`(:556)
③ 那個字面在碼裡 ⇒ 零命中(它是板錨,不是識別字 —— 預期)
④ 就地訂正 ⇒ 無人推翻
```
✅ **機制我自己複驗過,不是採信板子**:
```
排信側 anti-join **只看那一列存不存在**、不看 status
  `SupabasePaidOrderScannerAdapter.ts:29-31` 逐字 `email_outbox!left(order_id)` + `event_type=eq.…` + `email_outbox=is.null`
寄送側 due 述詞**必須**含 `attempts < max_attempts`
  `20260830060000…sql:178` 逐字「任何掃描 due 列的述詞都必須含 `attempts < max_attempts`(REQUIRED-E2a)」
⇒ 交集:燒完 attempts 的那一列**還在** ⇒ 那張單再也不會被撈到 ⇒ **兩邊都沒有壞。**
```
📌 **⇒ 本列成立。而它是【兩個各自正確的機制的交集】,不是任何一邊的 bug。**

## 1. 🔵 今天的分母:**0**

```
量測 2026-08-31 14:3x · 網站庫正式庫 · 唯讀 pcm_readonly
email_outbox 全表 ⇒ **2 列**,皆 `order_created` / `sent` / attempts=1 max=5
死信(attempts >= max_attempts 且 status <> 'sent')⇒ **0**
```
✅ **⇒ 今天做這一片,重排的分子是 0 —— 它不會寄出任何一封。**
🔴 **而「今天 0」不是「不會發生」**:`order_created` 那條線**已經接上排程在跑**
(`email-sweep/route.ts:291` 逐字 `await enqueueOrderCreatedEmails(`)⇒ 死信隨時可能長出來。
📌 **⇒ 所以【現在】做是最便宜的時機:機制裝上去的時候它一封都不會寄。**

## 2. 🛑 而怎麼做已經有【既有立場】,不是從零設計

`20260830060000…sql:178` 對同族的 `skipped_no_real_email` 逐字寫過:
> 它是「**可翻轉態**」非不可逆終態:它佔住唯一鍵,補到真實 email 時
> **須以受控 UPDATE 原地翻回 `pending`、不可新 INSERT**(會撞唯一鍵 = 該 cohort 永久漏信);
> **且不得自動回灌。**

✅ **⇒ 三件事直接套用到死信**:
```
① 原地 UPDATE, 不 DELETE、不新 INSERT
   理由是機械的:`email_outbox_event_uniq (event_type, dedup_key)`(`:377`)擋著,
   新 INSERT 會 unique_violation ⇒ 那張單永久漏信。
② **不得自動回灌** —— 那正是本 plan §0 那一格。
③ 而「翻回去」翻的是 attempts,不只是 status(status 已是 failed/pending;卡住的是 attempts)
```

## 3. 分片(順序寫死;每片 15-45 分鐘、可中斷)

### 片 1 · 一支受控的重排 RPC(migration)
`admin_requeue_dead_email(p_outbox_id uuid)` — SECDEF、只授後台角色、**一次一列**。
```
述詞:那一列必須 `attempts >= max_attempts` 且 `status <> 'sent'` ⇒ 否則 RAISE
動作:attempts 歸 0、status 設 pending、next_retry_at 設 now()
🔴 **一次一列是刻意的** —— 沒有「全部重排」那顆按鈕。§0 那個災難需要一個【批次入口】才做得到,
   而不提供那個入口, 就是最便宜的防線。
```
🛑 **它【不含】任何自動觸發** —— 不掛 cron、不掛 trigger。

### 片 2 · 後台入口(一顆按鈕,一次一封)
🛑 **而這一片要先確認一件事,我沒查**:後台現在**有沒有任何** `email_outbox` 的畫面?
```
指令 git grep -c 'email_outbox' -- 'apps/admin/**'  ⇒ **零命中**(2026-08-31 本窗)
⇒ 📌 **後台今天看不到那張表** ⇒ 「一顆按鈕」要先有一個【看得到死信的地方】。
⇒ 那可能是另一片。**本 plan 不假設它便宜。**
```

### 片 3 · 告警接上(讓死信會叫)
✅ **這一格【已經做完了】,不是待辦** —— 板上那一列自己寫著,而我複驗:
```
`check-anomaly-alerts.ts:95` `emailDeadLetterCount` · `:544` emailPush「🔴 已經放棄、【永遠不會再寄】的信」
```
⇒ **所以本片不做它。** 而它的存在改變了片 2 的急迫性:**有人會被通知,只是還不能按。**

## 4. Rollback

| 片 | 能不能單獨 revert | 備註 |
|---|---|---|
| 1 | ✅ 能 | `DROP FUNCTION`;沒有任何自動觸發 ⇒ revert 零外部影響 |
| 2 | ✅ 能 | 拿掉入口 = 回到今天(沒有人按得到) |
| 3 | — | 已完成,不在本片 |

🔴 **revert 不回來的只有一格:一封已經被重排而且寄出去的信。**
✅ 而「一次一列 + 沒有批次入口 + 沒有自動觸發」三條就是為了讓那一格**每次只有一封**。

## 5. 🛑 這份 plan 答不出什麼

```
· 🔴 **後台有沒有看得到 `email_outbox` 的地方 ⇒ 零命中, 而我沒有再往下查
  (可能有別的名字的畫面)。片 2 的成本【未估】。**
· 🛑 重排之後那封信【內容】是不是還正確 —— payload 是當時組好的,
  若訂單後來改過(取消/退款/改地址),重寄可能寄出一封過期的信。**未查, 而它是真的風險。**
  ⇒ 而 route 那一側已有 ineligible gate(`order-ineligible-gate`)—— **它擋不擋得住這一種, 未驗。**
· 🛑 `max_attempts` 現值 5(正式庫實測)。重排後再燒完會不會無限循環 ⇒ 靠「一次一列、人工按」擋,
  **而沒有機制上限。** 若日後加批次入口, 這一格會變成真的問題。
· 🛑 我沒有量過死信在正式庫的【歷史】—— 今天 0, 而過去有沒有出現過查不到
  (那張表沒有刪除紀錄, 但也沒有人在追)。
```

## 6. 要拍板的

```
Q1: 片 2(後台入口)先確認成本再排, 還是本片只做片 1(RPC)?  A: 只做片1 | 兩片一起
Q2: 重排後的「內容可能過期」那一格 ⇒ 本片處理 | 另開一列
Q3: 片 1 的 RPC 授給誰?(後台角色名我沒查, 需要確認)      A: 待查後再定
```
