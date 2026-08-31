# Plan:訊號 4「信根本沒被建出來」怎麼叫 —— 而【計數的主詞】比門檻重要

> 線【出貨】`-1e` · 樹 `/Users/sean_1/pcm-wt-ship` · 分支 `agent/line-ship` · HEAD `f3fd135f`
> 寫於 **2026-08-31 13:0x CST** · `origin/dev` **7b9e5862** · 未推 **27**
> 板上落點 `⟦b4-EMAILEMPTY⟧` / `⟦b4-EMAIL-SIG4⟧` · Sean 2026-08-31 答 5️⃣ **甲「有一封就叫」**
> 🛑 **本檔是提案,一行碼都沒動。標 L1 / 高風險片(鐵則 12⑤ 對外發送;鐵則 8 跨 3+ 檔)。**

## 🔴🔴 先讀這一句 —— 它決定這一片的形狀

```
scanner 每 5 分鐘掃「已付款而沒有信」的單, 然後【當輪就把它們排進去】。
⇒ `scanned > 0` 本身是【正常】的:新訂單進來被數到一次, 下一輪就沒了。
```
📌 **⇒ 拿 `scanned > 0` 當判準 = 有生意就叫。那不是告警。**

🛑 **而 Sean 答的兩個選項(甲 一封就叫 / 乙 連續兩輪才叫)【都預設主詞是 `scanned`】**
⇒ **兩個選項共用一個沒有被檢查的前提,而選哪一個都不會讓那個前提現形。**
✅ **本 plan 不推翻他的拍板** —— 他答的是「門檻」;**本檔要定的是【那個計數的主詞】**,
那是他**沒有被問到**的一格。定完之後,他的「甲」仍然直接適用(見 §1)。

---

## 1. 判準的【主詞】—— 逐桶寫清楚(碼上讀的,不是註解上讀的)

`enqueue-order-created-emails.ts:95-124` 的迴圈,每一列**恰好**落一個桶:

| 桶 | 它代表什麼 | 會不會自己好 | 該不該叫 |
|---|---|---|---|
| `enqueued` | 成功排進佇列 | — | ❌ 正常 |
| `duplicate` | 那一列已經存在 | — | ❌ 正常(重掃/競態) |
| `skippedNoRealEmail` | 合成假信箱 ⇒ adapter **落一列有痕跡** | 不會,而**是刻意的** | ⚠️ 見下 |
| `noRecipient` | **兩個信箱都空** ⇒ 根本沒 enqueue | 🔴 **永遠不會** | ✅ **叫** |
| `errors` | enqueue 丟例外 | ✅ **會**(檔內 `:122` 逐字「下一輪會再撈到這一筆」) | ⚠️ 見下 |

🔴 **⇒ Sean 的「有一封就叫」有一個【正好對得上】的主詞:`noRecipient`。**
它**永遠不會自己好**(那張單沒有信箱),所以「一封就叫」不會變成噪音 —— **叫一次就是一件真的待辦。**

### 兩個要分開處理的
```
`errors`  一輪 > 0 ⇒ **不叫**(它下一輪會重試)。要叫的是【持續】——
          而「持續」需要跨輪狀態, 而本片沒有那個狀態 ⇒ 見 §5「答不出什麼」。
`skippedNoRealEmail`  它有痕跡、是刻意的 ⇒ **不叫**, 但**值得進信尾那一行**(counts 摘要)。
```

### 🔴 而 `truncated` 是一個獨立的訊號,不要漏
```
`ENQUEUE_LIMIT = 50`(`email-sweep/route.ts:174`)⇒ `scanned` = **min(真缺口, 50)**
⇒ 缺口 5,000 封時它印 **50**, 而 50 看起來像一個正常的小數字。
✅ 同一支 use-case 已有 `truncated`(`:56` 逐字「這一輪沒有掃完」)與 `scannedPages`。
⇒ 📌 **要判「有沒有更多」看 `truncated`, 不是看那個數字。**
```
(這一格是 2026-08-31 02:0x `code-reviewer` 的 F3,板上已記;本 plan 把它接進判準。)

---

## 2. 起始線:那 7 筆要不要進分母 ⇒ **不要**

```
量測 2026-08-31 13:0x · 網站庫正式庫 · 唯讀 pcm_readonly
已付款而【沒有】order_created 那一列 ⇒ **7 筆**(06-23 / 07-25 / 07-30 / 07-31 / 08-18 ×3)
email_outbox 全表 ⇒ order_created / sent / **2 封**(08-22、08-30)
dedup_key 格式查碼不猜:`SupabaseEmailOutboxAdapter.ts:237` 逐字 `dedupKey: input.orderId`
```

🛑 **理由要寫對,因為兩個理由今天都成立,而只有一個在上線後仍然成立:**
```
✅ 會留下來的理由:**scanner 結構上撿不起它們**
   `SupabasePaidOrderScannerAdapter.ts:199-200` 逐字 `.gte('paid_at', cutoff)` **且** `.gte('created_at', cutoff)`
   ⇒ 起始線之前的單不在它的分母裡 ⇒ **叫了沒有人關得掉。**
⛔ 會過期的理由:~~它們是測試單~~ —— 今天成立(memory
   `project_0831-site-not-live-yet-all-prod-data-is-test`),**而上線後就不成立了**。
```
📌 **⇒ 判準要用第一個理由寫:分母 = scanner 掃得到的那一段。**
⇒ 具體:**本告警的分母【就是 scanner 那一輪的結果】**,不另開一支查全表的 SQL。
✅ 附帶好處:**不需要新的起始線 env** —— 它自動繼承 `B4_DEPLOY_CUTOFF`。

---

## 3. `B4_DEPLOY_CUTOFF` 現值 ⇒ 🛑 **未確認**

```
我沒有 Vercel 專案設定的讀取權。
資料指向它落在 08-18 與 08-22 之間(那 7 筆最晚 08-18;已寄的兩封是 08-22 / 08-30)
🛑 **而那是【推的】不是量的。** 主視窗端給 Sean 一起問(他要開 Vercel 面板)。
```
⚠️ **這一格不擋本片** —— §2 的設計刻意不依賴那個值(分母跟著 scanner 走)。
**它擋的是「那 7 筆要不要補」那一題**,而那是另一件事。

---

## 4. 爆炸半徑(鐵則 8:跨 3+ 檔)

```
packages/domain/src/payment/anomaly-alert.ts        新增三個欄位到 summary 型別
packages/ports/src/IAnomalyAlertReader.ts           介面加欄位
packages/adapters/src/email/…                       把 enqueue 結果帶出來(見下)
packages/use-cases/src/check-anomaly-alerts.ts      進 shouldAlert + 信尾那一行
apps/storefront/src/app/api/cron/email-sweep/route.ts  counts 落 log
```
🔴🔴 **而有一格是【結構問題】,不是加欄位**:
```
那些數字產生在 **email-sweep** 那條 cron(每 5 分鐘), 而告警在 **anomaly-alert** 那條(每天 01:00)。
⇒ 兩條 cron、兩個行程 ⇒ **anomaly-alert 讀不到 email-sweep 那一輪的記憶體變數。**
```
⇒ **三條路,而我推薦丙:**
```
甲 email-sweep 自己叫(它每 5 分鐘, 一天 288 次)⇒ 🔴 噪音風險最高
乙 把每輪結果寫進一張表, anomaly-alert 讀它     ⇒ 新表 + migration ⇒ **本片變大一倍**
丙 anomaly-alert 自己跑一次【同樣的 anti-join】, 只 count 不 enqueue  ← **我推薦**
   ⇒ 零新表、零跨行程狀態;而它與 scanner 用同一個 cutoff ⇒ 分母一致
   ⚠️ 代價:那是**第二份**同樣的查詢 ⇒ 兩份會漂。
   ✅ 緩解:做成一支 SQL 函式, TS 與告警都呼叫它(照 `get_shipped_email_gap_counts` 的成例)
```
🛑 **丙要新增一支 migration ⇒ 鐵則 12③ ⇒ 那一顆要單獨走對抗審查。**

---

## 5. 🛑 這份 plan 答不出什麼

```
· 🔴 `errors` 的「持續兩輪」我做不到 —— 本片沒有跨輪狀態, 而加它就等於走乙(新表)。
  ⇒ **本片先只叫 `noRecipient`(永不自癒那一桶)**;`errors` 留在 counts 摘要裡, 不進 shouldAlert。
  ⚠️ **代價要寫明:一個【每輪都失敗】的 enqueue, 本片不會叫。** 那是已知缺口, 不是被忽略。
· 🛑 `B4_DEPLOY_CUTOFF` 現值 **未確認**(無 Vercel 讀取權)。
· 🛑 `noRecipient` 今天的實況 = **0**(9 張已付款單全部有信箱可用)
  數法 count(*) from orders o left join customers c … where payment_status='paid'
       and 兩個信箱都空 ⇒ **0**;正對照 count(*) from orders ⇒ **23**;
       負對照 display_id='ZZQ-NOSUCH-8831' ⇒ **0** ⇒ 尺會動。
  ⇒ 📌 **所以這道告警上線第一天會是靜默的 —— 而那是【對的】, 不是沒接上。**
  🔴 **而「今天 0」不是「不會發生」**:手動建單那條路可以造出無信箱的單
    (`enqueue-order-created-emails.ts:64` 逐字「B-4 之後理論上不該發生(**手動建單那條路除外**)」)。
· 🛑 我**沒有**量過 `errors` / `duplicate` / `skippedNoRealEmail` 在正式庫的歷史值 ——
  那些只落在回應 body, 沒有進表。**未數, 而且事後查不到。**
· 🛑 本片**不碰**那 7 筆歷史缺口。要不要補是另一題(且要先知道 cutoff)。
```

## 6. 要拍板的

```
Q1: §4 的三條路 ⇒ 甲 email-sweep 自己叫 | 乙 新表 | 丙 告警端自己 count(我推薦)
Q2: 丙 要新增一支 SQL 函式 ⇒ 那一顆單獨走 codex 對抗審查, 批不批
Q3: `errors` 持續才叫 這一格先不做(留缺口) ⇒ 接受 | 要一起做(那就走乙)
```
