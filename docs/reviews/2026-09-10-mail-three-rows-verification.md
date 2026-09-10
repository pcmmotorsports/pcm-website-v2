# 信件三列複量(2026-09-10 · 線【SEO/GEO】窗 D)

> 全唯讀(`scripts/readonly-prod-sql.sh`)· 零寄信 · 零改碼。
> 🛑 `docs/launch-todo.md` 只加末尾標記那一行,**本檔不是板子的更新**,是它指過去的證據。

---

## §1 ⟦mail-SKIPKEYNORETIRE⟧ —— 判別句沒成立,不做

那一列自己寫了轉可派的判別句(逐字):

> `email_outbox` 出現**第一筆** `last_error_code` 屬第三族、且 `status IN (pending, failed)` 的列
> ⇒ 本列從「不值得做」變成「該排期」。

**跑了。0 命中。**

```
status IN ('pending','failed')
  AND last_error_code IN ('order_ineligible','order_ineligible_at_send','before_send_cutoff')
⇒ 0

全表 6 列 · sent 6 · pending 0 · failed 0 · last_error_code 非 null 0
最舊 2026-09-02 02:55 · 最新 2026-09-07 15:45
```

### 🟢 順手關掉這一列自己標的尺的缺口

它逐字寫著:「**這一發沒有示範那把尺對 `last_error_code` 印得出非零**(它只在別的欄位示範過)⇒ 不得拿它去說『不會發生』。」

補上了:

| 對照 | 式子 | 讀數 |
|---|---|---|
| 🟢 正 · 這一欄判得出來 | `coalesce(last_error_code,'SENTINEL')='SENTINEL'` | **6** |
| 🟢 正 · `IN` 子句會命中 | `status IN ('sent','pending','failed')` | **6** |
| 🔵 負 · 現造碼 | `last_error_code = 'zzz_never_a_real_code_20260910'` | **0** |

⇒ 📌 **那個 0 現在是「真的沒有」,不是「尺沒接上那一欄」。**

---

## §2 ⟦mail-DEADMAILREQUEUE⟧(a) —— 它自己寫的自我測試,三天後真的被跑了

那一列逐字寫過:

> 本列現在指向的也是一個板上撈不到的錨 —— **我知道我在做同一件事, 而我選擇標出來而不是不寫**:
> 兩邊收割之後它就在了;**若那時仍撈不到, 那就是這一列自己的實例。**

✅ **撈得到了。**

```
bash scripts/board-row-by-anchor.sh '⟦mail-FAILEDMAXNORESCAN⟧'
⇒ 錨欄命中 :1618(不經整行比對 —— 那支工具最強的那一種答案)
🔵 負對照 現造錨 ⇒ 錨欄 0 · 整行 0;分母 本板 1105 列資料列
```

⇒ 📌 **它不是自己的實例,是「收割慢了」。** 那一列當時就寫了這兩種成因,而**現在確定是後者**。

🎯 這是板上少數**自帶關閉條件、而且那個條件真的被執行過**的列。寫下判準的人與跑那個判準的人不是同一個,而**判準寫得夠具體,所以跑得動**。

---

## §3 ⟦mail-FAILEDMAXNORESCAN⟧ `:1618` 那句寫反了

### 板上原句(逐字)

> 🎯 **真正的修法必須讓那封信【換一把鍵】或【重啟舊列】**:
> **前者是 `admin_requeue_dead_email` 那條路(人按的)**;後者要改 `resolveUniqueViolation` 的語意
> ⇒ 那是動 enqueue 的核心不變式,不是加一支 view migration。

### 量到的三格(2026-09-10 唯讀正式庫)

| 問題 | 讀數 |
|---|---|
| 存不存在 | **在**。`public.admin_requeue_dead_email(p_outbox_id uuid)`,`SECURITY DEFINER`,`SET search_path TO ''` |
| 誰按得動 | `anon`=**f** · `authenticated`=**f** · `service_role`=**t** ⇒ 只有伺服器端(後台)按得動,客人碰不到 |
| 按了做什麼 | 原地 `UPDATE`:`status→pending` · `attempts→0` · `claimed_at→NULL` · `next_retry_at→now()` · `last_error_code→NULL` |

🔴🔴 **而關鍵是這一格:那支函式的定義裡 `dedup_key` 出現 0 次。**

```
函式定義 grep dedup_key   ⇒ 0
🟢 正對照(同一份輸出、同一把 grep)
   status 11 · attempts 12 · claimed_at 4   ⇒ 尺是活的
🔵 負對照 現造字               ⇒ 0
```

### ⇒ 所以歸類反了

`admin_requeue_dead_email` **不換鍵**。它是**重啟舊列**那一半,而且它**根本不經過 `enqueue()`** —— 唯一鍵 `(event_type, dedup_key)` 從頭到尾沒被碰到。

### 🔴 為什麼這不是名詞挑錯 —— 它改變接手的人的【第一步】

```
板上現在的結論   「接手的人第一件事是解【鍵】的問題」
                 ⇒ 他會去改 resolveUniqueViolation 的語意 = 動 enqueue 的核心不變式
量到之後         原地重啟【已經在正式庫跑了】, 而它證明鍵不是障礙
                 真正的障礙是【自動那條路走 view → enqueue】, 而人工那條路不走
⇒ 自動修法【不一定要】動那個共用不變式;
   它可以做 admin_requeue_dead_email 已經在做的事:原地翻, 不重新 enqueue
```

🔵 **而 `20260907060000` 拒絕放行 `failed` 的理由,對它自己是成立的** —— 它逐字說「下一輪 scanner 撈到之後**仍要 `enqueue()`**」,而那是真的(`SupabaseEmailOutboxAdapter.ts` 的 `resolveUniqueViolation` 撞鍵回 `duplicate`、舊列不動)。

⇒ 🛑 **拒絕理由沒錯,錯的是【把人工那條路歸到換鍵那一半】。**

### ⚠️ 這一節證不到什麼

- 我**沒有實跑** `admin_requeue_dead_email`(那會寫入,不在唯讀授權內)。上面「按了做什麼」是**讀它的定義**,不是實測結果。
- 我**沒有量**後台有沒有把那顆按鈕接到畫面上、誰的角色點得到。只量到 DB 層 `service_role` 有 EXECUTE。
- 「自動修法可以原地翻」是**從機制推的**,不是量到的 —— 沒有人寫過那條路。它是 plan 的候選,不是結論。

---

## §4 「三天沒有交易信」是什麼 —— 不是掃描壞了

`email_outbox` 最新一列停在 2026-09-07 15:45,而 `orders` 最新一列是 2026-09-09 13:55 ⇒ **有 2 張單在最後一封信之後才建**。逐張攤開:

| 建立時間 | 來源 | 付款狀態 | outbox 列數 |
|---|---|---|---|
| 2026-09-02 02:53 | web | refunded | 3 |
| 2026-09-05 08:14 | **manual_phone** | unpaid | **0** |
| 2026-09-06 14:46 | web | refunded | 2 |
| 2026-09-06 14:57 | web | **unpaid** | **1** |
| 2026-09-09 13:54 | **manual_phone** | unpaid | **0** |
| 2026-09-09 13:55 | **manual_phone** | unpaid | **0** |

🎯 **零信的三張,正好就是三張手動單。每一張網路單都有信。**

🟢 **而最強的那一格是 `unpaid` 那組**:09-06 那張 **web + unpaid 有 1 封信**,而 09-09 那兩張 **manual + unpaid 是 0 封**。
⇒ 📌 **同樣的付款狀態、不同的來源、相反的結果** ⇒ **「因為還沒付錢所以不寄」這個解釋被排除掉了。**

✅ **⇒ 掃描沒有壞。** 那三天的沉默是 `⟦auth-MANUALORDERLIMITBURN⟧` 本身,而**正式庫最後發生的兩件事就是它**。

### ⚠️ 這一節證不到什麼

3/3 是**相關**不是**因果**。因果那一半是那一列先前讀碼讀出來的機制(掃描面收得進去 → use-case 的 `suppressCustomerEmailFallback` 把它丟掉 → 不寫任何 outbox 列)。
⇒ **兩邊吻合,而我這一發只證了「讀數與那個機制一致」,沒有再獨立驗一次機制。**

---

## §5 ⟦auth-MANUALORDERLIMITBURN⟧ —— 從 1 變 3,而且是 100%

那一列 2026-09-08 量到 **1 筆**,⟨已量 2026-09-09⟩ 說卡在「缺唯讀連線」。**重量了:**

```
order_source | 單數 | notification_email 空 | 有值
manual_phone |  3   |          3            |  0
web          |  3   |          0            |  3
```

🟢 **這張表自己就是正對照** —— `notification_email` **不是恆空**(web 那三張證明它填得進去)
⇒ 📌 **手動單那個 3 不是「這欄沒人用」,是【手動單這條路不寫它】。**

其他對照:`products` 列數 ⇒ **26,425**(列裡逐字建議挑一個有獨立理由相信它有資料的類別);🔵 負對照 現造 `order_source` ⇒ **0**。

✅ **⇒ 09-08 寫的那句預測被證實了**,逐字:

> 不是「今天有 1 個客人被丟掉」,是【**這個形狀是手動單的預設形狀 ⇒ 上線後每一張都會命中**】。

**從 1 到 3、比例 100% ⇒ 那不再是預測。** ⇒ 修法寫在 `docs/plans/2026-09-10-manual-order-recipient-plan.md`。

---

## §6 量的過程中我自己犯的錯(兩次同型)

`scripts/readonly-prod-sql.sh` **刻意沒有 `\set ON_ERROR_STOP on`** ⇒ 中間一格炸掉,**後面照跑、rc 照樣是 0**。

我踩了**兩次**,而且是同一種:SQL 裡用中文當欄位別名沒加引號。

```
第一次  ERROR: syntax error at or near "總數"
第二次  ERROR: syntax error at or near "筆數"   ← 同一種
```

🛑 **兩次的 rc 都是 0。** 我是照那支腳本自己印在輸出裡的提醒去掃 `^psql:.*ERROR|^ERROR:` 才看到的,**不是靠 rc**。
✅ 第二次之後**換路不重試**:別名一律用純英文。最後那一發掃出 **0 個 ERROR**。

📌 **一個 rc=0,底下藏著一格沒跑成功。**
🎯 而那支腳本**自己把騙法印在輸出裡** —— 一個知道自己會騙人的工具,而它把使用說明寫在犯罪現場。
