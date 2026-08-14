# `#473(b)` plan v1 —— `manual_failed` 的更正出口

> **狀態:等 Sean 批**(鐵則 8:動 schema)。R 窗 2026-08-14。
> **刻意短。** 本檔不重複 `#473` backlog 條目(`docs/phase-1-backlog.md:12223-12252`)已寫的問題描述與痛點。
> `#473(a)`(文案誠實化 + `revalidatePath`)已收工 = commit `4caf73bb`;**它沒有解掉本條**。

---

## §1 一句話

**`order_refunds` 的人工判定判錯之後,員工要有一個動作能更正它;舊列一個字都不改。**

## §2 為什麼是這個形狀(三條實查,不是推的)

1. **狀態機不能放寬** —— `supabase/migrations/20260803150000_m3_a7c_rw1a_refund_write_rpcs.sql:211-215` 逐字只允許 `processing → confirmed/failed/deferred`,**三終態轉出一律 RAISE**;`:218-219` COMMENT 自我定位「**DB 層硬防線**」。且該函式體**只讀 `status`**、零 `failed_reason` ⇒ 想只放寬 `manual_failed` 做不到,會**連 `rejected_out_of_range` / `not_sent` 一起打開**。
2. **就地改 `failed_reason` 技術上做得到,但那是改帳** —— 同檔 `:391` COMMENT 逐字「**刻意留可變:status / failed_reason / failed_detail(NULL→值)**」⇒ UPDATE 守門不擋改 `failed_reason`。**能改不代表該改**:改掉之後「當初判了什麼、誰改的、為什麼」全部消失。
3. **姊妹帳本已經有現成形狀,抄它** —— `admin_correct_refund_manual_verdict`(`supabase/migrations/20260812140000_m4b_lifecycle_refund_manual_reversal.sql:572` 定義 / `:726` COMMENT):**一交易寫兩列(沖銷 + 新判定)、舊列不動、CAS 防併發、員工面只看到「修改判定」一個動作**。同檔 `:284` 逐字寫著「要改判定請走 `admin_correct_refund_manual_verdict`」。
   ⚠️ **它動的是 `payment_refund_events`,不是 `order_refunds`** —— 抄的是**形狀**,不是那支函式。`payment_refunds` 與訂單退款帳無關已由 `#445` plan `§0-A` 開檔複驗過。

## §3 三個做法(**Q-473-2 要 Sean 拍**)

| | 做法 | 代價 |
|---|---|---|
| **A(R 窗推薦)** | **新開一張小表** `order_refund_manual_corrections`(append-only,一次更正一列,`refund_id` FK + `actor` / `reason` / `corrected_to` / `created_at`,partial unique index 保「至多一筆有效更正」) | `order_refunds` **一個字都不動**(不動狀態機、不動 CHECK、不動既有欄);rollback = `DROP TABLE`。**代價**:多一張表要 join,`#443`「異常清單只讀一本帳」的家族再 +1 |
| **B** | `order_refunds` **加欄**(`corrected_at` / `corrected_to` / `corrected_by` / `corrected_reason`) | 少一張表。**代價**:`ALTER TABLE` 動 live 金流表(要 `lock_timeout`,先例 `20260725130100:68-72`);且一列只能被更正一次,更正的更正無處可放 |
| **C** | 就地 UPDATE `failed_reason` | 最小 diff。**代價**:改帳、無稽核軌跡、且**解不掉「其實錢動過了」那個方向**(那要轉 `confirmed`,狀態機擋死) |

**推薦 A。** 理由:本片的整個存在理由是「人會判錯」,那就必須留下「判錯了、誰改的」;C 把這件事刪掉,B 只留一次。

## §4 片界

| 片 | 內容 | 鐵則 | 估 |
|---|---|---|---|
| `473b-1` | migration:建表 + ACL(REVOKE ALL、只開 `service_role`)+ 更正 RPC(抄姊妹七道守門:隔離閘 / actor / 輸入驗 / 鎖父列 `FOR NO KEY UPDATE` / 鎖後重讀 / **CAS** / 寫入 row_count 守)+ 負測 | **8 + 12①③** | 90-140 分 |
| `473b-2` | 異常清單納入被卡的列(`apps/admin/src/lib/payment/refund-read.ts:126` 逐字 `.eq('status', 'processing')`)+ 列級顯示 | 12① | 35-50 分 |
| `473c` | 後台「修改判定」入口(UI)+ 與退款紀錄區塊的「哪個是現況」顯示 | 12① | 60-90 分 |
| `#445b` 連動 | 守門式的「佔額度」判準要認得更正列 —— **寫進 `445b`,不在本片** | — | 併入 445b |

🔴 **`473b-2` 不能省、也不能排在 `473c` 之後**:出口做出來但**沒有任何畫面會顯示那一列**,等於沒做。今天卡住的列不在任何清單裡(`refund-read.ts:126` 只查 `processing`)。

## §5 驗收(逐條 yes/no)

1. ☐ 更正一列 `manual_failed` 之後,**原列的每一個欄位逐欄比對前後相同**(不是「看起來沒變」,是 `SELECT to_jsonb(r) FROM order_refunds r WHERE id=…` 前後 diff 為空)。
2. ☐ 兩個交易同時更正同一列 ⇒ **後到者失敗**(CAS),不是兩邊都回成功。**負測要真的並發**,不是循序跑兩次。
3. ☐ 同一列更正兩次(序列) ⇒ 依 `Q-473-1` 的語意判 yes/no;partial unique index 的**負測**要能單獨紅。
4. ☐ ACL:`anon` / `authenticated` 呼叫 ⇒ 拒;`service_role` ⇒ 通。**正負各一發。**
5. ☐ **`473b-2`**:被更正過的列與**未被更正但卡住**的列,**都出現在異常清單**,且員工看得出差別。
6. ☐ **`473b-2` 的反向**:一列 `manual_failed` **在做任何更正之前**就要看得見 —— 這格證的是「看得見」不依賴「有出口」。
7. ☐ 三綠(動 `.sql` 走語法守門;動 `.ts` 加 build)。
8. ☐ 兩關審查都跑(鐵則 12① 錢 ⇒ **不降級**):`code-reviewer` + `codex-adversary` 審 diff。

⚠️ **放寬類改動的紀律**:`473b-2` 是「把清單條件放寬」。**放寬會讓格子綠、沒人會發現** ⇒ 改完必須回跑「原本會紅的那幾發」(既有 `refund-read` 相關測試全跑,不只跑新增的)。

## §6 風險與 rollback

- **rollback**:A 案 = `DROP TABLE public.order_refund_manual_corrections` + `DROP FUNCTION`;**`order_refunds` 無任何改動 ⇒ 沒有資料要回填**。這是選 A 的主要理由之一。
- 🔴 **apply 順序**:migration 未 apply 前**應用層不得上線**(memory `feedback_app-layer-must-not-ship-before-migration-apply`,08-07 正式站壞 8 小時)。`473b-2` / `473c` 都在 apply 之後。
- ⚠️ **`#445b` 的硬前置在 apply 之後才解除**,不是 commit 之後。plan v8 `§5-445b-8` 逐字「`#473` 沒有出口之前不得 apply 445b」。

## §7 要 Sean 拍的兩題

```
Q-473-1:更正之後,「有效判定」怎麼認?
A. 最新一筆更正說了算(可以更正的更正)。優點:人再判錯還有救。代價:要顯示「這列被改過 N 次」。
B. 只准更正一次(partial unique index 鎖死)。優點:語意最簡單、畫面只有兩種樣子。代價:改錯了就又卡住,回到今天。
R 窗推薦 = A。理由:本片存在的前提就是「人會判錯」,而 B 假設人只會判錯一次。

Q-473-2:用哪個做法?(細節見 plan §3 表)
A. 新開一張小表,order_refunds 一個字都不動。
B. order_refunds 加四個欄。
C. 就地改 failed_reason(最小,但改帳、無軌跡、解不掉「其實錢動過了」那個方向)。
R 窗推薦 = A。
```

## §8 誠實缺口(**只收構造不出來的**)

1. 🔴 **「員工判錯的方向分布」我沒有資料** —— 本片假設兩個方向(判成沒動錢但其實動了 / 反過來)都要能更正。**這是我推的**,沒有實例。若 Sean 認為只有一個方向會發生,片會小一半。
2. ⚠️ **`Q-473-1` 選 A 時的畫面**(一列被更正多次要長什麼樣)**本檔沒有設計** —— 那是 `473c` 的事,且屬品味題 ⇒ 產圖給 Sean 看,不用文字選項。
3. ✅ **不是缺口的**:並發、ACL、稽核軌跡都在 §5 有可構造的負測 —— **不得拿「誠實缺口」豁免它們**。

---

— R 窗十六代 · `#473(b)` plan v1
