# plan · ⟦5b-SHIPPEDNUMNOTRECORDED1⟧ 出貨信要記下【實際寄出去的那個號碼】

> 線【出貨】`-ship` 2026-09-05 寫。**片型 = 高風險**(鐵則 12⑤ 對外不可回收的寄信路徑 + ③ schema/migration)⇒ **本檔零 diff, 一行碼都沒寫。**
> 主視窗 2026-09-05 點頭「先 plan 不寫碼, 釘樁② 那格必寫」。

## 0. 一句話

客人手上那封信說了什麼, **今天沒有任何一個地方記得**。而我們用「時間」去猜它, 那個猜法有一個會出錯的窗。

---

## 1. 現況(每格可單發重跑)

| 事實 | 證據 |
|---|---|
| 出貨信 payload **刻意不存**追蹤碼 | `packages/ports/src/IEmailOutbox.ts` `OrderShippedEmailPayload` 註解逐字「追蹤碼不行, 存了會過期」 |
| 更正信 payload **刻意存**追蹤碼 | 同檔 `:277` 逐字「這裡【刻意】把 `tracking_number` 存進 payload …… **那個號碼就是事件本身**」 |
| 更正信整條**已經上線** | `supabase/migrations/20260904220000_…tracking_corrected_event.sql`,`supabase/APPLIED.tsv:378`(Sean 本人貼) |
| 掃描面用**時間比較**當代理 | 同 migration `:411` `AND e0.sent_at < s.tracking_corrected_at` |
| `sent_at` 由 app 寫、不是 DB 時間 | `SupabaseEmailOutboxAdapter.ts:542` `sent_at: new Date().toISOString()` |
| `email_outbox` 今天**沒有**存號碼的欄 | 建表 `20260717020000_m4a_email_outbox.sql:298-313`,16 欄逐欄看過 |

## 2. 缺陷(板列的失效時序,重講一次因為修法要對著它)

```
sweeper 讀 live 追蹤碼 = A
  ⇒ 寄出「您的單號是 A」          ← 客人手上永遠是這封
  ⇒ 【在寫 sent_at 之前】員工把號碼改成 B(觸發器蓋上 tracking_corrected_at)
  ⇒ 最後才寫 sent_at
⇒ sent_at > tracking_corrected_at
⇒ 掃描面判準 `sent_at < tracking_corrected_at` 不成立
⇒ 判成「客人沒收過錯號碼」⇒ 🛑 不寄更正信
```
窗口只有寄送那幾秒, **而後果是永久的且零訊號** —— 沒有任何一列記得這個人拿著 A。

---

## 3. 🔴 修法:板列寫的形狀**不夠** —— 「改回去」那個世界

板列的根治形狀逐字是「判準改成逐字比對(`寄出去的號碼 <> 現在的號碼`)」。
⇒ 我照 memory `feedback_a-rulings-reason-can-be-right-and-narrow` 的**機械判別句**問了一次:

> **「這個值可以【重複出現】嗎?」** ⇒ **可以。追蹤號改回去是合法操作。**

```
寄出貨信帶 A  →  改成 B  →  更正信說「正確的是 B」  →  🔴 又改回 A
判準 =「出貨信寄的號碼 <> 現在的號碼」⇒  A <> A 不成立  ⇒  不寄
🛑 而客人手上【最後一封】說的是 B ⇒ 他拿著錯的, 而系統認為一切正常。
```
🎯 **⇒ 要比的不是「出貨信寄了什麼」, 是【我們最後一次告訴客人的是什麼】。**
✅ **判準應為**:這箱所有 `status='sent'` 的信(`order_shipped` + 每一封 `shipment_tracking_corrected`)裡 `sent_at` **最大**那一封所記的號碼 ⇒ 與 live 值比, **不同才寄**。

📌 **這與那條 memory 是同一個形狀, 只是換了受詞** —— 原拍板的理由(「存了會過期 ⇒ 該讀即時值」)**在它自己那一層完全正確**, 而它講的是 **enqueue 時點的快照**。
⇒ 🔵 **而「寄出去的當下記下寄了什麼」不是快照, 是【出門紀錄】—— 它不會過期, 因為它描述的是一件已經發生的事。**
⇒ ⇒ 所以本片**不推翻**那句拍板, 是**指出它的射程**。

## 4. 落點:新欄, 不是塞進 payload

```
⛔ 塞進 payload      payload 的欄位註解逐字「事件時點不可變」⇒ 那是 enqueue 時點
                    而我要記的是【send 時點】⇒ 塞進去會讓那個契約自相矛盾
✅ 新欄 email_outbox.sent_tracking_number text  （nullable）
   · 只在標 sent 的那一發寫(SupabaseEmailOutboxAdapter.ts:542 同一個 update)
   · 對 order_shipped / shipment_tracking_corrected 以外的事件恆為 NULL
   · 🔴 它是 PII 嗎:貨運單號 —— 我判**不是**(它不指向人), 而**這一格請主視窗覆核**
```

## 5. 🔴🔴 釘樁② —— 貼下去會當場 RAISE(板列沒寫這格)

`20260904220000_…tracking_corrected_event.sql:455-456` 逐字:
```sql
IF pg_catalog.strpos(v_def, 'sent_at < s.tracking_corrected_') = 0 THEN
  RAISE EXCEPTION '釘樁②:view 裡找不到「sent_at < s.tracking_corrected_at」…';
```
🛑 **而本片的修法就是要把那個比較拿掉** ⇒ **新 migration 若只 `CREATE OR REPLACE VIEW`, 下一次任何重貼那支舊 migration 的動作會當場炸。**
✅ **處置(要寫進新 migration 的前置閘)**:新 migration 自己重新釘一根**指向新判準**的樁, 並在註解裡把舊樁的字面**加刪除線留著** ⇒ 搜 `sent_at < s.tracking_corrected_` 的人同一發撞到訂正。
⚠️ **舊 migration 是不可變歷史 ⇒ 不改它。** 修法一定不在那一支裡。

## 6. 三個世界(驗收條件 —— 每個要印**不同**的東西)

| # | 世界 | 期望 |
|---|---|---|
| ① | 寄了 A、改成 B、沒再動 | **寄一封**更正信說 B |
| ② | 寄了 A、改成 B、更正信寄了 B、**再改回 A** | **寄一封**更正信說 A(今天的修法會漏掉這格) |
| ③ | 寄了 A、從沒改過 | **不寄**(負對照:證明它不是無條件寄) |

🔴 **每一格都要在 fixture 造得出來, 而②是本片存在的理由** —— 缺②的話, 修法與不修在①③印同一個綠。
🛑 **突變**:把新判準改成板列原本那句(比出貨信的號碼)⇒ **②必須紅、①③必須綠**。全綠 ⇒ 那個突變沒落在目標上。

## 7. 拆片(每片 ≤45 分鐘)

| 片 | 內容 | 誰驗 |
|---|---|---|
| A | migration:加欄 + 重釘樁 + 換掃描面判準 + 自帶前置/後置斷言 | Sean 貼、各線唯讀驗 |
| B | `SupabaseEmailOutboxAdapter` 標 sent 那一發寫入新欄 | 三綠 + 三個世界的 fixture |
| C | 掃描面測試(含突變) | 同上 |

⚠️ **A 必須先貼、B 才有東西可寫** —— 而 B 未上線之前, 新欄全是 NULL ⇒ **判準要對 NULL 有明確行為**(回落到今天的時間比較, 而不是「NULL 就不寄」)。
🔴 **那是一個會被忘記的過渡期** ⇒ 寫進 migration 註解。

## 8. rollback

純加欄 + 換 view ⇒ `DROP COLUMN` + `CREATE OR REPLACE VIEW` 回舊定義 + 重釘舊樁。
🛑 **而有一格不可逆**:過渡期間已經寄出去的信收不回來。⇒ rollback 只還原判準, 不還原後果。

## 9. 待決(端上去, 不自己拍)

```
Q-範圍:IEmailOutbox.ts:277 逐字記著另一道【還沒裝】的閘 ——
        「寄送當下比對即時值, 不同就跳過」(防 A→B→C 在隊列裡寄出一封宣告自己是對的錯信)。
A: 甲 = 本片一起做（同一條路, 一次改完）
   乙 = 本片只做「記下寄了什麼」, 那道閘另開一片
```
**推薦乙。** 理由:那道閘動的是 **sweeper 的認領路徑**(與 `markSkippedOrderCancelled` 同族), 而本片動的是**標 sent 那一發 + 掃描面**。⇒ 兩者的爆炸半徑不同, 綁在一起會讓鐵則 12⑤ 的審查面變成兩倍, **而它們沒有先後依賴**。

## 9-b. 🔴 **索引 —— 刻意不做, 而觸發條件寫在這裡**(2026-09-05 主視窗裁「乙」)

codex R2 第 6 條:主掃描面對每個 `shipment_item` 列**重跑兩次相同的相關子查詢**,
而**沒有支援 `payload + order_id + sent_seq` 的索引**;量大時可能超時 ⇒ **整輪不寄**。

**判斷 = 現在不加。** 理由不是「它不重要」, 是**加索引本身有代價而現在量不到收益**:
```
加了會付   每一筆 email_outbox 寫入多一份索引維護 · 建索引當下的鎖
現在能量到 ❌ —— 這條路今天【零真實流量】(那個功能還沒有人在用:
           2026-09-05 唯讀實測 有更正紀錄的箱 = 0 / 全站 2 張箱 / 1 張單)
```
🛑 **⇒ 現在加 = 用一個量不到的收益換一個確定的成本, 而且【調錯了也沒有訊號】。**

### ✅ 而「什麼時候該加」寫成一個可以量的條件, 不是一句「日後評估」
```
觸發條件(任一成立就回來做):
  ① 對 pcm_tracking_corrected_email_pending 跑 EXPLAIN (ANALYZE, BUFFERS)
     ⇒ 實際執行時間 > 500 ms
  ② 或 anomaly-alert 那一輪因為這支 view 逾時而落 unknown 一次以上
量法(可直接貼)  EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM public.pcm_tracking_corrected_email_pending;
分母            同一發也記下 email_outbox 的列數與 shipments 的列數 —— 
                📌 一個沒有分母的耗時數字, 下一個人沒辦法判斷它是不是變壞了
```
🔴 **而 500 ms 這個數字是【選的】不是量到的** —— 它來自「告警那條 cron 的 `maxDuration`」那一族的量級感,
**我沒有量過這支 view 在任何資料量下的耗時**。⇒ 📌 **第一次去量的人請把真實讀數寫回這裡, 並把這一句劃掉。**

## 10. 🛑 我沒做什麼

- **一行碼都沒改**, 零 diff。
- **沒有量過那個競態實際發生過幾次** —— 我沒有正式庫寫入權, 而唯讀那條路今天沒跑。⇒ **本片的急迫性我答不出來**, 只答得出後果形狀。
- **沒有複驗 `20260904220000` 在正式庫的 view 定義** —— 我讀的是 repo 裡那支 migration 的字面, 不是 live `pg_get_viewdef`。
