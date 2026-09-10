# ⟦auth-MANUALORDERLIMITBURN⟧ —— 手動單每輪重撈,永久佔住名額

> 2026-09-10 · 線【SEO/GEO】窗 D · **只寫不做,等 Sean 批。**
> 讀數與量法在 `docs/reviews/2026-09-10-mail-three-rows-verification.md` §4 §5。
> 🔴 碰寄信路徑 ⇒ 鐵則 8(動共用 port / 跨 3+ 檔)+ 鐵則 12⑤(對外不可回收)⇒ **要 Sean 批 + codex 唯讀審**。

---

## 0. 🔴 這一片真正要解的東西 —— 兩條規矩互相矛盾

**這不是「我還沒決定要怎麼做」,是這一列的內容本身。** 兩條都有實錘:

```
甲  「把永遠不會好的列移出掃描面」
    出處:⟦b4-NORECIPIENTWINDOW⟧ 自己記的修法, 已 done、已驗證有效
    做法:改 SQL 掃描面的述詞

乙  「判準本體在 @pcm/domain, 七支共用一份;在 SQL 重寫一份, 七份會各自漂,
     而漂掉的那一半在 diff 上與【本來就這樣】長得一樣」
    出處:七支 enqueue 的碼裡逐字寫著
    ⚠️ 這句話 2026-09-10 之前碼裡寫的是【四 / 五 / 六】三個不同的數, 真值是七 ⇒ §6
       📌 它警告判準會漂, 而漂掉的是它自己的計數
    ⇒ 照甲做 = 把 domain 判準抄進 SQL = 違反乙
```

🎯 **而這一片的核心主張是:那個矛盾有第三條路,而且那條路【已經在這個 codebase 裡跑著】。**

---

## 1. 白話:Sean 手動建一張單,會發生什麼

```
你在後台建一張電話單, email 欄留白
  ⇒ 系統照你的意思【不寄信】。✅ 這是對的, 是你自己拍板的
      (逐字「可以不填 = 不寄」, packages/domain/src/order/notification-fallback.ts 檔頭)

⇒ 🔴 而錯的是【它沒有把「我看過這張單了」記下來】
  ⇒ 排信程式每一輪都會【再看一次】那張單, 永遠
  ⇒ 而每一輪能處理的封數有上限
  ⇒ 📌 那些單會慢慢把【真的要寄的信】擠出那個上限
```

🛑 **所以這一片不是「讓客人收到信」** —— 客人本來就不該收到,那是你拍的。
✅ **是「讓系統記得它已經看過,不要每輪再看一次」。**

**今天實際的樣子(正式庫,2026-09-10 唯讀)**:

| 建立時間 | 來源 | 付款狀態 | 有沒有信 |
|---|---|---|---|
| 09-02 | 網路單 | 已退款 | 3 封 |
| **09-05** | **電話單** | 未付款 | **0** |
| 09-06 | 網路單 | 已退款 | 2 封 |
| 09-06 | 網路單 | **未付款** | **1 封** |
| **09-09** | **電話單** | 未付款 | **0** |
| **09-09** | **電話單** | 未付款 | **0** |

⇒ **手動單 3 張,3 張都中,100%。** 而網路單 3 張,3 張都有信。
⇒ 🟢 那張「網路單 + 未付款」有 1 封信,證明**不是因為沒付錢才不寄**。

---

## 2. 第三條路:這個 codebase 已經解過同一題

**LINE 客群**(沒有真的 email、系統給一個合成假信箱)走的是這條路:

```
use-case  不自己判、照樣呼叫 enqueue()          ← 判準沒有被複製
adapter   SupabaseEmailOutboxAdapter.ts:564
          落一列 status = 'skipped_no_real_email'  ← 有痕跡, 不是靜默跳過
scanner   既有 anti-join 只問「那一列在不在」⇒ 下一輪自動排除  ← 甲的效果, 零 SQL 改動
```

🔵 而那個設計原則,碼裡逐字寫著(`enqueue-order-shipped-emails.ts:188`):

> 本層若自己先判一次,就長出第二套 LINE 判準。

🎯 **⇒ 手動單今天走的正是它警告的那條路**:在 use-case 層判掉(`suppressCustomerEmailFallback` → `noRecipient += 1` → `return`),**不呼叫 `enqueue()` ⇒ 不留痕**。

⇒ ✅ **修法方向 = 讓手動單走 LINE 客群那條路**:判準**留在** `@pcm/domain`(乙 滿足),痕跡由 adapter 落(甲的效果達成,而**一行 SQL 都不用改**)。

---

## 3. 🔴 而有一道硬牆,它決定這一片的尺寸

正式庫實查 `email_outbox` 的 CHECK:

```
email_outbox_recipient_nonempty  CHECK (recipient_email <> '')
recipient_email                  NOT NULL
email_outbox_status_check        status ∈ {pending, sending, sent, failed,
                                           skipped_no_real_email,
                                           skipped_order_ineligible,
                                           skipped_shipment_voided}
```

🛑 **「這張單沒有收件人」這件事,今天【寫不進那張表】** —— 表自己的約束禁止空的收件人。
⇒ 📌 **這就是為什麼當初的人選擇了「什麼都不寫」** —— 不是疏忽,是牆。

⇒ 所以要選一邊:

```
Q:手動單那一列的痕跡, 怎麼落?
A: 甲 | 乙
```

### 甲 —— 借用 `customers.email` 當收件人,新增一個終態(推薦)

```
recipient_email = customers.email(那一欄是 NOT NULL, 本來就有值)
status          = 新的終態, 例如 skipped_manual_no_recipient
```
- ✅ **不寄**:終態,sweeper 不撿(白名單只認 `pending` / `failed`)。
- ✅ **不會被人工救回來寄出去**:`admin_requeue_dead_email` 逐字只認 `pending` / `failed`,`skipped_*` 一律 `RAISE EXCEPTION` ⇒ **fail-closed,不是靠人記得**。
- ✅ **不會被自動重排**:新終態**不放進** `20260907060000` 的四碼放行清單(它與 `order_ineligible` 同族:那是裁決,不是暫時擋)。
- 🔴 **成本**:動 `status` 的 CHECK ⇒ **migration** ⇒ 鐵則 12③。
- ⚠️ **要一起想的**:那一列存著一個**我們決定不寄的信箱**。它不外洩(`EMAIL_LOG_COLUMNS` 本來就不取 `recipient_email`),但**下一個看到那一列的人會問「為什麼有信箱卻沒寄」** ⇒ 狀態名要自己講得清楚。

### 乙 —— 放寬 CHECK,讓 `recipient_email` 可以是空

- ✅ 語意最誠實:沒有收件人就是沒有收件人。
- 🔴🔴 **而那道 CHECK 是在守別的東西**:它擋的是「排了一封寄不出去的信」。放寬它 ⇒ **所有事件型別都可以寫空收件人**,而今天沒有任何一格在守那件事。
- ⇒ 📌 **為了一種情境放寬一條全表約束,代價落在另外六種事件型別身上。**

### 🔵 我的建議:甲

**理由不是「比較好看」,是【失敗方向】**:甲 走的是既有的終態白名單,而那個白名單**已經有兩個人寫過「新增第八態的人:預設落在不可重排那一側」**(`admin_requeue_dead_email` 檔內逐字)。⇒ **新終態一加進去,兩道閘自動把它擋在寄信之外,不用任何人記得。**
乙 則是**把一道現有的守門拿掉**,而拿掉之後沒有東西補上。

---

## 4. 會動到哪些檔(估,批准後才確認)

```
supabase/migrations/20260910080000_m4b_manual_order_no_recipient_terminal_state.sql   ✅ 片1 已做
supabase/rollbacks/20260910080000_down.sql                                            ✅ 片1 已做
packages/adapters/.../SupabaseEmailOutboxAdapter.ts   落那一列的分支    ← 共用 port, 鐵則 8
packages/domain/src/order/notification-fallback.ts    判準不動, 只被多一個呼叫端用
packages/use-cases/src/enqueue-*.ts(七支, 逐支見 §6)  noRecipient 那一格改成照樣 enqueue
  ⚠️ 七支要一起, 漏一支 = 那個事件型別繼續燒名額, 而它在 diff 上看不出來
+ 對應測試
```

🔴 **七支一起改是這一片最大的風險**,而**漏改一支不會紅** —— 那正是這一列自己抱怨的形狀。
⇒ ✅ **驗收要有一發「七支都走到」的守門**,不是七支各自的單測。

---

## 5. 驗收(寫死,做的時候不准改)

```
① 好世界   手動單 + notification_email 空 ⇒ email_outbox 落一列, status = 新終態
           而【沒有任何一封信寄出去】
② 壞世界   把那個分支退掉 ⇒ 必須紅。少了這一發, 上面那條在兩個世界都會過
③ 不回頭   同一張單跑第二輪 ⇒ 掃描面不再撈到它(anti-join 靠既有那一份, 不新寫述詞)
④ 不外洩   admin_requeue_dead_email 對新終態 ⇒ RAISE EXCEPTION(不是「應該會」, 要實測)
⑤ 七支都到 一發守門證明七個事件型別都走得到新分支(判準見 §6:七支 ↔ 七種 event_type)
```

---

## ⚠️ 這份 plan 證不到什麼

- **我沒有實跑任何一條寄信路徑。** 上面所有機制都是讀碼 + 唯讀查正式庫得到的。
- **`admin_requeue_dead_email` 的行為是讀它的定義,不是實測** —— 實測會寫入,不在唯讀授權內。
- ⛔ ~~「六支」這個數字是從既有註解抄的~~ ⇒ ✅ **2026-09-10 數了,是【七支】** —— 見 §6。
- **3/3 是相關不是因果** —— 因果那一半是先前的人讀碼讀出來的機制,我這一發只證了「讀數與那個機制一致」。


---

## 6. 🔴 那個數字數出來了:不是四,不是六,是**七**

做之前把 `suppressCustomerEmailFallback` 的真實呼叫點數了一次(排除 import / 註解 / 測試):

| 檔 | 行 |
|---|---|
| `packages/use-cases/src/enqueue-order-created-emails.ts` | 107 |
| `packages/use-cases/src/enqueue-order-cancelled-emails.ts` | 94 |
| `packages/use-cases/src/enqueue-order-unpaid-cancelled-emails.ts` | 83 |
| `packages/use-cases/src/enqueue-order-shipped-emails.ts` | 149 |
| `packages/use-cases/src/enqueue-tracking-corrected-emails.ts` | 71 |
| `packages/use-cases/src/enqueue-bank-order-created-emails.ts` | 86 |
| `packages/use-cases/src/enqueue-order-partially-refunded-emails.ts` | 97 |

⇒ **enqueue 七支**,再加寄送當下那一支 `SupabaseOrderCurrentRecipientAdapter.ts:71` = **共 8 處**。

### 🔴 而碼裡宣稱的數字,是三個不同的數

```
四支共用一份  ×5      五支共用一份  ×1      六支共用一份  ×1      真值 7
```

🎯 **每個人都寫了「他加進去的那一刻」的真值,而沒有人回頭改別人那幾支。**
📌 而那句話**本身就在警告判準會漂** —— 而**漂掉的是它自己的計數**。
🛑 **從來沒有任何一格紅過**:一個註解裡的數字,沒有東西守它。
✅ 2026-09-10 七支全部改成「七支」(Sean 拍甲、主視窗批「一起改」)。範圍只有那個數字,沒有動任何別的話。

### 🎯 七支 ↔ 七種 `event_type`,一支對一種

```
order_created · order_shipped · order_cancelled · order_unpaid_cancelled
shipment_tracking_corrected · bank_order_created · order_partially_refunded
```
⇒ **`email_outbox_event_type_check` 正好七種,而 enqueue 正好七支,沒有漏也沒有多。**

🔴 **這個對應本身就是最好的守門判準** —— 片 2 要把它寫成一格**會紅的測試**:
```
斷言:呼叫 enqueue() 的 use-case 支數 === event_type CHECK 的種類數
🔴 兩邊都要從【真的來源】數, 不是寫死 7
   · 左邊:掃 packages/use-cases/src/enqueue-*.ts 的真實呼叫(排除註解與測試)
   · 右邊:從 migration 或 information_schema 讀那個 CHECK
🎯 第八種事件出生的那天那一格會紅 —— 而那正是今天沒有東西會叫的地方
```
⚠️ **而如果那道測試做起來太貴(例如要解析 SQL)⇒ 退回這一節的表格版**,不要硬做。
🛑 **但這個對應關係本身一定要留在這裡** —— 不然下一個人不會知道有這回事。

---

## 7. 驗收的對照組(改完之後要再跑一次同一發)

🔴 **這不只是一個讀數,它就是這一片的驗收長什麼樣。**

```
改之前(2026-09-10 唯讀正式庫)
  09-06  web    + unpaid  ⇒ 1 封信
  09-09  manual + unpaid  ⇒ 0 封信
  🎯 同樣付款狀態、不同來源、相反結果 ⇒ 排除了「因為沒付錢所以不寄」

改之後(拋棄式 PG,🛑 不碰正式庫)
  同樣的手動單 ⇒ 應落一列 status = skipped_manual_no_recipient
                 last_error_code = manual_no_recipient
                 而【一封信都不寄】
  同樣的網路單 ⇒ 行為完全不變(仍照舊寄)
  第二輪再跑   ⇒ 掃描面不再撈到那張手動單
```
🛑 **零寄信不變。**

---

## 8. 接手用(片 1 已做,片 2 未動)

```
我做到哪    片 1/2 = migration + rollback 已寫、已在拋棄式 PG 從零 replay 過(見下)
            七支註解的過期數字已改對
下一步      片 2:port 加一個「這一列是刻意不寄」的意圖欄 → adapter 落新終態
            → 七支 use-case 的 noRecipient 分支改成照樣 enqueue → 測試 → codex R1
🔴 還沒落檔的判斷 = 下面這一格
```

### 🔴 片 2 的一個設計決定,與本 plan §2 原本寫的**不同**

§2 原本說「判準留在 domain,**痕跡由 adapter 落**」,照 LINE 那條路 —— 而 LINE 那條路 adapter 是**自己判**的(`isSyntheticEmail(recipientEmail)`,只看信箱就夠)。
🛑 **手動單這條路 adapter 判不出來** —— 它要 `order_source`,而那不在今天的 `EnqueueEmailInput` 裡。

於是有兩種接法,而**失敗方向相反**:

```
甲 把 order_source 傳下去, adapter 自己呼叫 suppressCustomerEmailFallback
   🔴 fail-open:哪個呼叫端忘了傳 ⇒ undefined ⇒ 那支 domain 函式回 false(「照舊寄」)
      ⇒ 📌 一封【那張單說不要寄】的信會真的寄出去
乙 呼叫端傳一個明確的「這一列是刻意不寄」意圖(用它剛剛呼叫 domain 得到的結果)
   ✅ fail-closed:哪個呼叫端忘了傳 ⇒ 退回今天的行為(不落列、不寄)
      ⇒ 📌 漏接的代價是【這個 bug 還在】, 而不是【多寄一封信】
```

✅ **選乙,理由是鐵則 12⑤**:寄信對外不可回收 ⇒ **漏接的代價要落在「沒修好」那一側,不是「寄錯信」那一側。**
🔵 而**判準本體仍然只有一份**(`@pcm/domain`)—— 傳下去的是**那一次呼叫的結果**,不是第二份判斷。

### 片 1 的驗收讀數(2026-09-10)

```
scripts/migrations-replay-from-zero.sh(拋棄式 PG,從零 apply)
  分母 409(= supabase/migrations/*.sql 的真實檔數, 本發當下重數)
  成功 346 · 失敗 63   ⇒ 346 + 63 = 409
  🟢 我那支【不在 63 支失敗清單裡】, 而它自己的逐支 log 零 ERROR
  🛑 那 63 支是【既有的紅】—— 環境缺件(pg_net 未啟用、前置函式不存在…), 不是本片造成的
  ⚠️ 而 rc=1 —— 那是 view 行為 fixture 沒過, 腳本自己說明「即使 migration 全部 apply 成功也會 rc=1」
```
🔴 **而我一度把「grep 不到我那支」讀成正對照失敗** —— 那份清單**只列失敗**,所以「不在裡面」正是成功。
📌 **一份只印壞消息的報告,對「好消息」與「沒跑到」是同一個沉默。** 分母對得上(409 = 檔數)才是那一格的證據。


---

## 9. 🔴🔴 codex R1(2026-09-10)—— 1 must-fix、3 should-fix、4 nit,而其中兩條推翻我寫的東西

### must-fix ①(已修)`\set ON_ERROR_STOP on` 是 psql 指令,不是 SQL

貼板工具 `scripts/apply-paste-board.sh:530` **白名單式全拒**所有反斜線指令。
🟢 **而我是自己數過才承認的**:repo **409 支 migration 裡有這一行的 = 1 支,就是我這支**。
📌 **我抄錯了地方** —— 抄的是 `supabase/rollbacks/` 那邊的少數寫法(6/37),而**那些不走貼板工具**。
✅ 兩支 SQL 都拿掉了,錯誤中止改由執行端 `psql -v ON_ERROR_STOP=1` 給。

### 🔴🔴 nit ⑦ 才是最重要的那一條 —— 它把本片的病灶從「七條線」縮成「一條」

codex 說「七支都永久重撈」不符合現況。**我去問了正式庫的 `pg_get_viewdef`,它是對的。**

| 掃描面 | 有沒有排除「手動單 + 通知信箱空」 |
|---|---|
| `pcm_order_created_email_pending` | ✅ 有 |
| `pcm_shipped_email_pending` | ✅ 有 |
| `pcm_cancelled_email_pending` | ✅ 有 |
| `pcm_unpaid_cancelled_email_pending` | ✅ 有 |
| `pcm_tracking_corrected_email_pending` | ✅ 有 |
| `pcm_bank_order_created_email_pending` | ✅ 底層 `pcm_bank_order_still_mailable` 是 **web-only**,手動單進不來 |
| **`pcm_partial_refund_email_pending`** | 🔴 **沒有** |

🟢 正對照:同一發問「有沒有提到 `notification_email`」⇒ **七張全 t**(尺讀得到述詞)
🔵 負對照:問一個現造字面 ⇒ **七張全 f**(尺不是恆真)

⇒ ✅ **精確版:今天真正還在每輪重撈的是【部分退款信】那一條,不是七條。**
⇒ 🛑 **而本片仍然要做,理由變了**:
```
不是「七條線都在燒名額」(那是假的)
是   ① 部分退款那一條真的還在燒
     ② 而另外六張用的是【把 domain 判準抄進 SQL】那條路 —— 正是 @pcm/domain 註解警告的乙,
        那份抄本已經在正式庫上, 漂掉的風險已經實現
     ③ 本片給的是【不用抄判準】的那條路
⇒ 📌 急迫性【不是七倍】, 而一致性的理由還在。
```
🔴 **⇒ 這一格要端給 Sean 重看一次** —— 他批甲的時候看到的是「七條線都在燒」。

### 🔴 nit ⑤⑥(已修)兩句機制寫反了

```
⛔ 「已經存在的列不會叫 —— CHECK 只在寫入時驗」
✅ ADD CONSTRAINT 沒有 NOT VALID ⇒ 它【會掃全表驗證既有列】⇒ 少打一個有資料在用的舊值
   ⇒ ADD 當場失敗、交易回捲, 不會靜默留孤兒
   ⇒ 📌 那八格斷言真正補到的是另一種:少打一個【目前沒有資料在用】的舊值

⛔ 「那一列會讓 NOT EXISTS 成立」
✅ 有那麼一列 ⇒ 內層 EXISTS = true ⇒ NOT EXISTS = false ⇒ 訂單被排除
   ⇒ 📌 結論一樣, 而機制那句當初寫反了

⛔ 「四個放行碼」⇒ ✅ 今天是【五個】(recipient_stale_at_send 是 20260907230000 加的)
```

### should-fix ②③④ —— 片 2 開工前必須先解,不要直接寫碼

**② `countNewEvents()` 會把不寄的列算進寄信上限**(`SupabaseEmailOutboxAdapter.ts:494`)
它今天只排除**合成信箱**。20 筆借用真實信箱的不寄事件 + 1 筆正常事件 = 21 > 上限
⇒ use-case 在呼叫任何 `enqueue()` **之前**就 throw ⇒ 🔴 **不寄列留不下終態,正常信也排不進去** ⇒ **正是本片要修的病,換一個地方發作。**
⇒ 片 2 必須讓 `countNewEvents()` 也認得不寄意圖,**並測那個混合批次**。

**③ 我 §8 選乙的「fail-closed」理由不成立**
反例:呼叫端已經把 `continue` 改成借 `customers.email` 建 input,**卻漏傳意圖欄** ⇒ adapter 沿用預設 ⇒ 真實信箱落成 `pending` ⇒ 🔴 **會寄出去**,不是「不落列」。
只有**整支呼叫端完全沒改**時才會保留今天的行為。
🔴 **而還有一格更嚴重**:`suppressCustomerEmailFallback()` **只判來源**。
直接拿它的 `true` 當不寄意圖 ⇒ **手動單已經明填了 `notification_email` 也會被錯誤抑制** ⇒ 那是**真的漏寄**。
⇒ ✅ 判準必須是**兩個條件**(`manual_*` **而且** 通知信箱為空)——
   那正是 `notification-fallback.ts` 檔頭自己寫的「判準是兩個條件,不是一個」,而我在 §8 只用了一個。
⇒ 片 2 要把「寄」與「不寄」做成**兩種不同的輸入**,缺漏或非法意圖在寫入前就拒絕。

**④ 「七支 = 七種 event_type」那道守門抓不到「漏改一支」**
今天七支本來就各有 `enqueue()` 呼叫 ⇒ 片 2 漏改其中一支,**仍是七支七種,數量斷言照樣過**。
🛑 ⇒ **§6 提的那道守門作廢** —— 它守的是「有沒有第八種事件出生」,**不是**「七支都改到了」。
✅ 片 2 要的是:**每一支在目標輸入下真的送出不寄意圖**,逐支驗,不是數呼叫點。

### 🔵 codex 核對過而沒有問題的

`admin_requeue_dead_email` 第 120 行只認 `pending`/`failed`;adapter 的 `claimDue` / `claimById` / `tryClaim` **都有同一份白名單**;租約回收只處理 `sending`;`resolveUniqueViolation` 只查核回 `duplicate`、**不 UPDATE**。
⇒ ✅ **沒有任何一條路會把第八態變回 `pending` 或寄出去。**
⚠️ 而後台 `email-log-view.ts:90` 會把新態顯示成「未知狀態」—— 不會消失也不會誤標已寄出,**片 2 補文案**。

---

## 10. §9 那三條 should-fix 的解法(片 2 開工前先解,2026-09-10)

### 🎯 ②③ 是同一個設計決定解掉的:**不寄的列走一支【不同的 port 方法】**

```ts
// 新增(片 2a)
enqueueManualNoRecipient(input: EnqueueEmailInput): Promise<
  { kind: 'skipped_manual_no_recipient'; id: string } | { kind: 'duplicate' }
>;
```

**② `countNewEvents` 的分母** —— 不寄的列**根本不進 `inputs`**(它們進另一個陣列,走另一支方法)
⇒ `countNewEvents(inputs)` 從頭到尾看不到它們 ⇒ **寄信上限不會被灌水。**
🔵 而它們**排在 cap 閘【之前】寫** —— 因為 cap 會 throw,而 throw 在寫痕跡之前 = 正是要修的病。

**③ 漏傳意圖會怎樣** —— 「借 `customers.email` 當收件人」與「這是不寄的」**綁在同一支方法裡**,
⇒ **表達不出「借了信箱而忘了說不寄」這個狀態**:呼叫端要嘛呼叫那支(留痕、不寄),要嘛不呼叫(退回今天的行為)。
⇒ ✅ **漏接的代價是「這個 bug 還在」,不是「多寄一封信」。**
🛑 ⛔ ~~原 §8 用「加一個 optional 意圖欄」~~ —— **那個寫法就是 codex 的反例**:欄位漏傳 ⇒ 真實信箱落成 `pending` ⇒ **會寄出去**。

**③ 的第二半:判準必須是兩個條件** —— `suppressCustomerEmailFallback()` **只判來源**。
```ts
const suppressed = suppressCustomerEmailFallback(row.orderSource);   // 條件一:manual_*
const recipientEmail = suppressed
  ? firstNonEmpty(row.notificationEmail)
  : firstNonEmpty(row.notificationEmail, row.customerEmail);
if (recipientEmail === null) {
  // 🔴 走到這裡 + suppressed ⇒ 【兩個條件都成立】:manual_* 而且通知信箱為空
  //    ⇒ 這才是「刻意不寄」。單看 suppressed 會把【手動單有填信箱】也抑制掉 ⇒ 真的漏寄。
}
```
📌 **兩個條件的第二個就是 `recipientEmail === null` 這一格** —— 那正是 `notification-fallback.ts` 檔頭
逐字寫的「判準是【兩個條件】,不是一個」,而 §8 只用了一個。

### ④ 逐支驗,不是數數量

```
⛔ 作廢:斷言「呼叫 enqueue 的支數 === event_type 種類數」
   🔴 七支本來就各有一個 enqueue() 呼叫 ⇒ 漏改一支仍是七支七種 ⇒ 那條照樣過
✅ 改成:七支【各一發】,餵一列「manual_* + 通知信箱空 + customerEmail 非空」
   斷言 enqueueManualNoRecipient 被呼叫 1 次、enqueue 被呼叫 0 次
   🔴 而突變驗收:把其中【任一支】退回 continue ⇒ 必須紅【那一支自己那一格】
```

### 🔵 片 2 再拆兩片(鐵則 4:一片 15-45 分鐘)

```
片 2a  port 加那支方法 + adapter 落新終態 + 它自己的測試
       🟢 安全:此時還沒有任何呼叫端 ⇒ 上線也不改變任何行為
片 2b  七支 use-case 接上去 + 逐支測試 + 突變驗收
```

### 🛑 片 2 的驗收(照主視窗指定,寫死)

```
改之前  手動單 3/3 沒有 outbox 列
改之後  同樣的手動單 ⇒ 落一列 status = skipped_manual_no_recipient
                       last_error_code = manual_no_recipient, 而【不寄】
🟢 而那個排除競爭解釋的對照要一起跑:
   09-06 web + unpaid 有信 / 09-09 manual + unpaid 沒信
   ⇒ 改完之後 web 那條【不能變】
🔴 零寄信 · 拋棄式 PG · 不碰正式庫
```
