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

乙  「判準本體在 @pcm/domain, 六支共用一份;在 SQL 重寫一份, 六份會各自漂,
     而漂掉的那一半在 diff 上與【本來就這樣】長得一樣」
    出處:六支 enqueue 的碼裡逐字寫著
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
supabase/migrations/<新>            status CHECK 加一個終態          ← 鐵則 12③
packages/adapters/.../SupabaseEmailOutboxAdapter.ts   落那一列的分支    ← 共用 port, 鐵則 8
packages/domain/src/order/notification-fallback.ts    判準不動, 只被多一個呼叫端用
packages/use-cases/src/enqueue-*.ts(六支)            noRecipient 那一格改成照樣 enqueue
  ⚠️ 六支要一起, 漏一支 = 那個事件型別繼續燒名額, 而它在 diff 上看不出來
+ 對應測試
```

🔴 **六支一起改是這一片最大的風險**,而**漏改一支不會紅** —— 那正是這一列自己抱怨的形狀。
⇒ ✅ **驗收要有一發「六支都走到」的守門**,不是六支各自的單測。

---

## 5. 驗收(寫死,做的時候不准改)

```
① 好世界   手動單 + notification_email 空 ⇒ email_outbox 落一列, status = 新終態
           而【沒有任何一封信寄出去】
② 壞世界   把那個分支退掉 ⇒ 必須紅。少了這一發, 上面那條在兩個世界都會過
③ 不回頭   同一張單跑第二輪 ⇒ 掃描面不再撈到它(anti-join 靠既有那一份, 不新寫述詞)
④ 不外洩   admin_requeue_dead_email 對新終態 ⇒ RAISE EXCEPTION(不是「應該會」, 要實測)
⑤ 六支都到 一發守門證明六個事件型別都走得到新分支
```

---

## ⚠️ 這份 plan 證不到什麼

- **我沒有實跑任何一條寄信路徑。** 上面所有機制都是讀碼 + 唯讀查正式庫得到的。
- **`admin_requeue_dead_email` 的行為是讀它的定義,不是實測** —— 實測會寫入,不在唯讀授權內。
- **「六支」這個數字是從既有註解抄的**(碼裡有寫「四支共用一份」也有寫「六支共用一份」⇒ **兩個數字都在碼裡,而我沒有數過**)⇒ 做之前要自己數一次。
- **3/3 是相關不是因果** —— 因果那一半是先前的人讀碼讀出來的機制,我這一發只證了「讀數與那個機制一致」。
