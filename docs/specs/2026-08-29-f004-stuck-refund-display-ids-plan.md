# 片級 plan — F-004「客人的退款卡住」那一類**帶單號**(2026-08-29,線C)

> **鐵則 8**(新 migration)⇒ **需 Sean 批准**,且 apply 是他的動作。
> **鐵則 12 ③DB** ⇒ 高風險片:plan 過關卡1、diff 過關卡2。
> **狀態:⏳ 未批准、未開工。零 code、零 apply。**
> **一句話:那封每天寄的信說「有 N 筆客人的錢卡住」,而【不說是哪幾筆】。這片讓它說。**

---

## 1. ① 改什麼

**一支 migration,`CREATE OR REPLACE` 一支既有函式,加兩個 key。**

| 項 | 內容 |
|---|---|
| 動的函式 | `public.get_order_refunds_stuck_summary()`(`20260824040000` 建,**單一代定義**) |
| 加的 key | `order_refunds_stuck_display_ids`、`order_refunds_stuck_overnight_display_ids` |
| 來源 | `public.order_refunds` JOIN `public.orders` 取 `display_id`(`order_refunds.order_id` → `orders.id`) |
| 既有 key | **一個字不動**(`order_refunds_stuck_count` / `_overnight_count` / `order_refunds_manual_failed_count`) |
| 應用層 | `PgAnomalyAlertReaderAdapter`(解析新 key)+ `check-anomaly-alerts.ts` 那個 block 的 `section(...)` 第三引數由**寫死的 `[]`** 改成新欄位 |
| ACL / owner / COMMENT | `CREATE OR REPLACE` **保留** ACL 與 owner;**COMMENT 要重下**(現行 COMMENT 逐字寫著「零 id」,見 §3) |

### 🔴 1a. 為什麼 `CREATE OR REPLACE` 可行(而它與 `#957` / `42P13` **不同族**)
```
它是 RETURNS jsonb ⇒ **多加一個 key 不改回傳型別** ⇒ 不需要 DROP + 重建
⇒ 不會發生「ACL / owner / COMMENT 全部被帶走」那組還原步驟
🔴 而 42P13 那條是【RETURNS TABLE 加寬】才會撞（母 plan 2a 走 DROP 就是被它逼的）
✅ 而它【只有一代定義】（`grep -rln 'FUNCTION public.get_order_refunds_stuck_summary' supabase/migrations/` ⇒ 1 支）
   ⇒ 不會踩 20260819130000 COMMENT 警告的那個坑（「那支有四代定義分散在四支 migration，重貼整支會安靜倒退兩代」）
```

## 🔴 2. 選這條路的理由 —— **而另一條看起來更省,它才是陷阱**

| | 做法 | 判 |
|---|---|---|
| **甲** | `CREATE OR REPLACE` **`get_payment_anomaly_alert_display_ids`**,加第 6 組 | ❌ **否決** |
| **✅乙** | `CREATE OR REPLACE` **`get_order_refunds_stuck_summary`**,id 與 count 同一支 | ✅ **選這條** |

**甲為什麼否決(而它技術上完全可行:那支也是 `RETURNS jsonb`、也只有一代)**:
> 那支的 COMMENT 自己寫著:「**五組 WHERE 與 `get_payment_anomaly_alert_summary` 的對應計數【逐字同源】,apply 期有交叉斷言比對;改任一邊必須同時改另一邊。**」
> 🔴 而第 6 組的**對應計數在另一支函式、另一張表** ⇒ **它進不了那個「同源」的框架**,交叉斷言也對不上它。
> 🔴 而更重的理由:那支函式的分母是 `payment_double_charge_anomalies` 那一族。把 `order_refunds` 的查詢塞進去,**正是 `20260824040000:162` 逐字警告的那件事**:
> 「**名字比分母寬,不要混用。**」

📌 **⇒ 乙的好處不是省事, 是【id 與 count 出自同一支函式、同一個 `WHERE`】** ——
**「同源」變成【結構上成立】, 而不是【靠一道斷言去維持】。**

---

## 3. 🔴 隱私那一格:**這片【改變一個刻意的設計】, 不是補一個漏掉的東西**

`get_order_refunds_stuck_summary` 現行 COMMENT 逐字:
> 「payment_confirmer cron 唯讀讀**聚合計數**,**零 PII / 零金額 / 零 id**」

⇒ **那是作者刻意寫下的。本片要打開它 ⇒ 必須正面寫,不得繞過。**

### ✅ 而它有先例, 而先例是 Sean 本人拍的
`20260819130000` COMMENT 逐字:
> 🔴 這是【**刻意打開的隱私閘**】:原設計零 id(**LINE 訊息會被轉發截圖**),
> **2026-08-19 Sean 本人在知道該代價的情況下拍板打開,理由「沒單號我查不到」**;
> 要關回去要**再問他**,不是修 bug。

📌 **⇒ 他 08-19 為【另外五類】做過同樣的取捨。本片是把同一個取捨套到第六類。**
🔴 **⇒ 而這一類正是【唯一一類已經確定卡住的】** —— 信自己寫著「這一類是已經確定卡住的,不是『可能』」。
🔴 **⇒ 也就是說:他 08-19 拍板要解決的那個痛(「沒單號我查不到」),在 08-24 新加的這一類上原封不動地回來了。**

⚠️ **代價照抄, 不弱化**:那封信會被轉發、被截圖 ⇒ **多印的是訂單編號**(不是姓名/金額/卡號)。
⚠️ **而本片不重問他** —— 08-19 那次拍的是**這件事的原則**;若他要**只對這一類關著**,那要他一句話,而**本片預設照先例打開**。

---

## 4. ② 為什麼現在做

```
🔴 Sean 2026-08-29 逐字（回主視窗）：**每天都有**
⇒ 而那封信說「N 筆客人的錢卡住、其中 N 筆超過一天」，**而不說是哪幾筆**
⇒ ⇒ **他每天要自己開那一頁找一次。**
```
⚠️ **而「超過一天」那個數字要跟著範圍走**(端他時要帶):
它是從 `order_refunds.created_at` 起算 = **我們按下退款那一刻**,**不是客人要求退款那一刻** ⇒ **可能低估**。

---

## 5. ③ 預期影響面

| 面 | 影響 |
|---|---|
| 新表 / 新欄 / backfill | **無** |
| 既有 key | **零改動** ⇒ 舊的呼叫端(若有)不會壞 |
| ACL / owner | `CREATE OR REPLACE` 保留 ⇒ **不需要重新 GRANT**。⚠️ **而仍要在 apply 時斷言一次**(不假設保留為真) |
| 對外可見 | 🔴 **那封信會多印訂單編號** ⇒ 這是唯一對外可見的改動 |
| 呼叫端 | 目前只有 `PgAnomalyAlertReaderAdapter:123`(`grep` 命中 1 處;⚠️ **那是我的檢查,不是全稱**) |

---

## 6. ④ Rollback

```
BEGIN;
  CREATE OR REPLACE FUNCTION public.get_order_refunds_stuck_summary()  -- 貼回 20260824040000 的本體
  …
  COMMENT ON FUNCTION … IS <20260824040000 的原字面>;
COMMIT;
```
✅ **它不動任何既有欄位、不寫任何資料** ⇒ **回退不留殘留**。
🔴 **而【應用層要先退】**:`check-anomaly-alerts.ts` 若已改成讀新 key 而函式退回舊版 ⇒ 解析會拿不到那兩個 key。
⇒ **回退序 = 應用層 → 函式**,而那要寫進本片檔尾 rollback 段本身,不只寫在這裡。
⚠️ **而 adapter 對缺 key 的行為本檔【未查】** —— 它可能 throw、可能給空陣列。**那決定回退序是不是硬的。**

---

## 7. 🛑 批准前要定稿的(**這一格是 2g 那片的教訓**)

```
① 兩個新 key 的**確切名字**（本檔提的是候選）
② `LIMIT` 護欄的值 —— 20260819130000 每發 LIMIT 100，理由「payload 護欄」，
   且釘了不變式「100 >= 顯示上限（應用層 30）」⇒ **本片要照同一個不變式，並寫出來**
③ 排序鍵 —— 20260819130000 用 `ORDER BY refund_claimed_at, display_id`（帶唯一鍵）
   ⇒ 本片對應的是 `order_refunds.created_at`，**排序要帶唯一鍵**（照 pagination-loop-review 那條）
④ adapter 對缺 key 的行為（決定回退序）
```

## 8. 誠實邊界

```
· §1a「單一代定義」「RETURNS jsonb」= grep + 開檔讀，附行號
· §5 呼叫端「只有 1 處」= **我的 grep 命中**，不是「全 repo 只有一處」的全稱句
🔴 · §6 adapter 缺 key 的行為 **未查** —— 缺的那道檢查已寫在該節
🔴 · 本檔**尚未過關卡1**。鐵則 12 要求它，而那是批准後、動手前要跑的
· 我**沒有**讀 `20260819130000` 的全文（207 行），只讀了它的 COMMENT、簽章、ACL 段與
  refunding_stuck 那一組的 SQL ⇒ **它可能還有本片該照抄的形制（apply 期交叉斷言的寫法）**
· 「他每天要自己開那一頁找一次」= 從「信不印單號」+ Sean「每天都有」推的 ⇒ **吻合但未證實**
  （他實際上怎麼處理，只有他知道）
```
