# Plan · ⟦mail-FAILEDMAXNORESCAN⟧ —— 付款信燒完重試之後再也不會被重排

> 產出 Tue Sep  8 01:38:19 CST 2026 · 線 `-db` · 板列 `docs/launch-todo.md:1539` · 🔴 **鐵則 8:等批准才動碼**
> 🔬 **對抗審查三輪:R1/R2 = codex `gpt-6-astra`(12 must-fix)· R3 = Fable(9 must-fix,FAIL)**
> **全文轉錄** → `~/pcm-mailbox/量測-db-20260908/R3-Fable-maildead-plan-findings.md`
> 🛑 **本檔是【第二個框架】。第一個框架被 R3 整個拆掉,拆的過程留在 §0,不要刪。**

## 四個約束(主視窗 2026-09-08 裁,重寫的前提)
```
① 零 schema · view 不動 · TS 插入端(resolveUniqueViolation)不動
② 核心 = 列級重排 + max_attempts += k + last_error_code 分區
③ 🔴 冷卻不得跨 24h —— 它在這裡不是成本旋鈕, 是【安全旋鈕】
④ F9 那題不在本 plan 裡答 —— 標「等 Sean」, 而 plan 其餘部分不依賴它
```

---

## 0. 三輪各推翻了什麼(留著 —— 這一節比修法本身有用)

| 輪 | 我當時寫的 | 被推翻成 |
|---|---|---|
| R1 | 「修法重心在**插入端**,不在 view」 | ❌ 兩邊都要(當時的理解) |
| R1 | 「每輪撞 23505 → 每輪 **throw**」 | ❌ `Adapter:585` 回 `duplicate`,**安靜** |
| R2 | 「`attempts` 不得歸零」+ 認領又濾 `attempts` | ❌ 兩者交集是空 ⇒ 我當時推論「必須拆兩個欄 ⇒ 要 migration」 |
| **R3** | **「必須拆兩個欄」** | 🔴 **第二個欄【已經在】** —— `max_attempts` 是逐列欄 |
| **R3** | **「兩邊都要動」** | 🔴 **假二分** —— 第三條路是**列級 UPDATE**,而它整晚在我手上 |
| **R3** | 「答不出真沒寄 vs markSent 失敗」 | 🔴 **碼裡有答案** —— 24h 冪等窗 + `last_error_code` 分區 |

### 🎯 R3 的三句總結(值得單獨記)
1. **前兩輪沒有把框架打完** —— R1+R2 共 12 條 must-fix,**零條質疑框架**。
2. **換模型的價值是量到的**,不是比喻:同模型往框架內挖更細,換模型才質疑框架本身。
3. **R3 讓這片【變小】** —— 拿掉了一支 migration。我們一般預期審查會加需求。

### 🔴 而 F1/F2 是同一個病,名字要寫出來
> **我引用了一個東西,而沒有問它做了什麼。**
我整晚拿 `admin_requeue_dead_email` 當「另一條路」引用,**卻沒看出它就是第三條路的存在證明**
—— 它今天做的就是列級 UPDATE。⇒ 📌 **這一族的射程比我們原本寫的寬:不只別人的描述,連我親手引用的【碼】也可能只被讀了名字。**

---

## 1. 病是什麼

`supabase/migrations/20260822010000_m4b_e4a_shipped_email_scan_view.sql:271-276` 的 anti-join
只問「那一列存不存在」,不分 `status` ⇒ 燒完 `attempts` 之後 `status='failed'`,
**而那一列仍然存在** ⇒ 掃描面永遠不會再吐出它。

🔵 **而「客人永遠收不到」不精確** —— 見 §7:人工那條路今天**有按鈕**。真實情況是「**直到有人按**」。

---

## 2. 修法(第二個框架)

### 2-1 為什麼 view 不動
死列**已經存在**。重啟不是「發現」它,是**改它** ⇒ 一次**列級 UPDATE**,與
`admin_requeue_dead_email`(`supabase/migrations/20260831040000_m4b_maildead_requeue_rpc.sql`)、
`reclaimStaleLeases` 同型。
⇒ ✅ **不經掃描面 ⇒ 沒有重撈、沒有 23505 ⇒ 45f 那個病無從重開。**
⇒ ✅ **`resolveUniqueViolation` 不動**(它只在 insert 撞鍵時走到,而這條路不 insert)。

### 2-2 為什麼零 schema:`max_attempts` 已經是第二個欄
`supabase/migrations/20260717020000_m4a_email_outbox.sql:307` 逐字:
`max_attempts    int         NOT NULL DEFAULT 5,`
🔬 **全 repo 非註解的 `max_attempts =` 賦值 ⇒ 0 命中**(⚪ 正對照:同一把尺量 `attempts = 0` ⇒ **4** ⇒ 尺是活的)。
⇒ 所有額度判斷都是**列對列比**(`Adapter:681` `row.attempts < row.max_attempts`、`:732` `.lt('attempts', row.max_attempts)`)。

✅ **重啟 = `max_attempts = max_attempts + k`**:
- `attempts` **照舊單調遞增** ⇒ `Adapter:1141-1142` 的所有權柵欄**不動**
- 額度重開 ⇒ 那一列重新可認領
- 🎯 **§3 要的「重啟上限」就是 `max_attempts` 的天花板** —— 不必另立一個概念

🛑 **⇒ 而人工那條路(`RPC:138` 的 `attempts = 0,`)照這個框架的修法是【一行】**:
換成 `max_attempts = max_attempts + k`,且**不清 `last_error_code`**。
⇒ 那同時把 §7 的 `⟦mail-REQUEUERESETSGEN⟧` 一起關掉。

### 2-3 🔴 重啟條件的真正軸是 `last_error_code`,不是 `status`

| 分類 | 碼 | 可不可以重啟 |
|---|---|---|
| **證明沒寄** | `prepare_failed`(送 provider 前就 throw)· `quota_*` · `http_4xx` | ✅ 可 |
| **不知道** | `network_error` · `http_5xx` · `lease_reclaimed` · `provider_error` | ⚠️ 只在 24h 窗內可(見 §3) |
| 🔴 **多半已送達** | `idempotency_payload_mismatch` | ⛔ **不可** |

🔬 最後一列的依據 `packages/ports/src/IEmailOutbox.ts:192-198` 逐字:
「同一把 key 24h 內用過**而 body 被改了**」⇒ **那把鍵已經被收過一次** ⇒ 重啟正好重寄最可能寄過的那些列。

### 2-4 ⛔ 不得「刪了重插」(這一格是關的,不是開放題)
`packages/adapters/src/email/ResendEmailSenderAdapter.ts:298` 逐字:
`const idempotencyKey = ` + '`${input.idempotency.eventType}/${input.idempotency.outboxId}`' + `;`
⇒ **重插 = 新 `outbox_id` = 新冪等鍵 = 把現存唯一一道防重寄的網丟掉。**

---

## 3. 🔴 冷卻是【安全旋鈕】,不是成本旋鈕

`packages/adapters/src/email/ResendEmailSenderAdapter.ts:405-410` 逐字兩句:
> 冪等鍵 `<event_type>/<outbox_id>` **跨重試穩定**, Resend 保留 24h。
> …人手重排若已超過 24 小時, 去重窗已經過期 ⇒ 客人**會**收到第二封。

⇒ 📌 **那不是「分辨不出來」,是一條時間線:24h 內安全,之後不安全。**
⇒ 🛑 **任何把重啟推到距上次嘗試 > 24h 的冷卻,【保證】去重窗已過期。**
   **重寄暴露面隨冷卻變長而變大** ⇒ 端給 Sean 的題要把這個方向寫在選項裡(§7)。

---

## 4. 留痕與開關(R3 F6;半夜做得到才算數)

🔴 **重啟必須留痕** —— plan 第一版沒要求,而人工路徑之所以先寫 audit `before`
(`apps/admin/src/lib/mail/dead-letter-actions.ts:54-77`)正是因為 RPC 會抹掉 `last_error_code`。
✅ 要求:**重啟寫一個可辨識標記,且保留原本的 `last_error_code`**(不清)。
   ⇒ 沒有它,出事那天沒有人數得出「哪些列被自動重啟過」。

🔴 **自動重排自帶 env 旗標,預設 OFF。**
⇒ 半夜回滾 = **翻旗標**,不是貼板。
🛑 因為「關 view」= 貼 migration、「停 sweep」= 貼 SQL,**兩者都要 Sean 在場**
(`docs/runbooks/email-sweep-kill-switch.md` 逐字「Sean 說貼才貼」)。

---

## 5. Rollback(半夜版)

1. **翻旗標**(§4)⇒ 停止**新的**重啟。**一個人自己做得到,不需要 Sean、不需要 DB 寫入。**
2. ⚠️ **而已經被重啟成 `pending` 的列還在**:停排程只暫停不撤銷,排程開回來就全寄
   (runbook 逐字「信會累積不丟」)⇒ 要停那些,只能連 sweep 一起停(**那就要 Sean**)。
3. **清理分三類**(靠 §4 的標記才數得出來):① 未寄 ② 已寄(**收不回來**)
   ③ 結果不明 ⇒ 🔴 **③ 不能用「收回/補寄」交代完畢。**

---

## 6. 受詞(七個,每一個要說得出會不會被重啟)

六種 event_type(`order_created` / `order_cancelled` / `order_unpaid_cancelled` /
`order_shipped` / `shipment_tracking_corrected` / `bank_order_created`;TS 與 DB 各 6,
⚪ 負對照現造 `order_zzz_fake` ⇒ 0)+ 人工救援 `admin_requeue_dead_email`。

🔵 **走本框架之後,人工與自動用【同一個動作】(`max_attempts += k`)** ⇒ 並發不再是兩套語意打架,
而是同一個 UPDATE 跑兩次。**而仍要寫成 CAS(條件寫在 `WHERE` 裡),不可先讀再寫。**

---

## 7. ⏳ 等 Sean(F9;本 plan 不答,其餘部分不依賴它)

**題**:死信之後要不要**自動**重排 —— 而人工那條路**今天就在**。
- 🔬 `apps/admin/src/app/settings/mail/page.tsx` 有重排按鈕(檔內自陳它是那支 RPC 的**第一個**呼叫端)
- 🔬 `packages/use-cases/src/check-anomaly-alerts.ts:2224` 每日死信告警行
- 🔬 **反方向的先前紀錄**:`20260717020000:34`「不得自動回灌」、`20260831040000:57`「靠人工一次一列」

⇒ 🛑 **「要不要自動」是 Sean 的板,不是 plan 內部推得出來的。**
⇒ 🔴 **而「永遠收不到」這個板列字面,實際是「直到有人按」** —— 板列由 ship 改,本線不動。

---

## 8. 未量 / 未答(不假裝有答案)

- 🔴 **「紅燈亮了有人按」的率:未量。** 今天死信 **0** ⇒ 沒有分母。
- 🔴 **本 plan 零實跑。** 缺的那一道 = 造一列真死信,跑一次重啟,看它真的被寄出去。
- `skipped_no_real_email` 該不該可重啟(它與 `pending` 可互轉,`20260717020000:35`)
- `k` 該是多少、`max_attempts` 的天花板該是多少(與 §7 一起端)
- ⚠️ **R3 的 F2/F6/F7/F8 我沒有逐條再驗**(F2 的存在證明是那支 RPC,我認;其餘三條是關於本 plan 自己的形狀)
