# 刷卡全額退款成功 ⇒ 自動標「已取消」· 實作 plan(鐵則 8)

> **狀態:🔴 零實作。** 本檔只寫「改什麼 / 為什麼 / 影響 / rollback」,等 Sean 批。
> **來源**:`~/pcm-mailbox/0912-後台UX/交辦-會員等級字面統一.md` §③(Sean 2026-09-12 拍板要排)。
> **貼板下一號 = 138**(137 已於 2026-09-13 貼進正式庫)。
> 🛑 **本片碰錢 + 碰 migration** ⇒ commit 前走鐵則 12 二審(codex 09-15 才回 ⇒ Fable 5.1)。

---

## 0. 🧑 一句話

客人刷卡買了東西、後來我們把錢**全部退回去**了 —— 而那張單在系統裡**還是「有效」的**,
狀態只寫「已退款」,沒寫「已取消」。Sean 要的是:**錢全退回去 ⇒ 系統自己把單標成已取消。**

---

## 1. 🔴🔴 交辦檔有一句是假的 —— 而它正好是最關鍵的那一句

交辦檔 §③ 逐字建議:
> 「建議做成**取消是走既有那條路**而不是直接 `UPDATE orders SET cancelled_at`:理由 ——
> 取消目前會一併寫 `order_cancellations(_items)`、觸發 `pcm_pending_refund_on_cancel` 與
> `coupon_revert_on_full_refund`。**直接寫欄位會繞過券還名額與待退款那兩條接線**。」

🔴 **「直接寫欄位會繞過那兩條接線」是假的。開檔核過:**

```
supabase/migrations/20260910210000_m4b_coupon_revert_wiring.sql:222-246
  public.pcm_pending_refund_on_cancel() 是一支 **AFTER UPDATE OF cancelled_at** 的 trigger,
  它的 body 裡逐字做兩件事:
    PERFORM public.pcm_pending_refund_open_for(NEW.id);
    PERFORM public.coupon_revert_on_full_refund(NEW.id);

而同一段的註解逐字寫著(Sean 2026-09-11 Q1 甲):
  「落點掛在【這個路口】而不是 admin_cancel_order / admin_mark_order_cancelled 各掛一次 ——
    因為本函式掛在 AFTER UPDATE OF cancelled_at, 它蓋得住**每一條**把 cancelled_at
    從 NULL 改成有值的路, **含還沒被寫出來的那一條**。」
```
⇒ 📌 **那兩條接線掛在【欄位】上, 不是掛在 RPC 上。**
⇒ 🎯 **所以「直接寫欄位」不但不會繞過它們, 它正是 Sean 09-11 拍板時【預期的那條還沒被寫出來的路】。**

---

## 2. 🔴🔴 而交辦檔建議的那條路 **走不通** —— 兩道獨立的閘都會擋

`admin_cancel_order` 最新一代(`20260908060000_m4b_partpaid_cancel_gate.sql:485-504`)的閘:

```
IF (payment_status <> 'unpaid'
     AND NOT (partiallyPaid 且【零 card 收款】)
     AND NOT (paid 且【零 card 收款】))
   OR EXISTS (payment_charge_attempts WHERE status <> 'failed')
THEN RAISE  -- 通用拒絕訊息
```

一張**刷卡付款、後來全額退款**的單:
| 閘 | 它會怎樣 |
|---|---|
| 第一條 | 那時 `payment_status = 'refunded'` ⇒ 不是 unpaid、不是那兩個 `NOT (...)` 的任何一個 ⇒ **擋** |
| 第二條 | 它**有一筆成功的刷卡 attempt**(`status <> 'failed'`)⇒ **擋** |

⇒ 🛑 **兩道各自獨立就足以拒絕, 而它們是刻意的**:那兩道守的是「員工不可以取消一張刷過卡的單」。
⇒ 📌 **要走那條路, 就得放寬那兩道閘 —— 而放寬之後【員工手動】也能取消刷卡單了。**
   那是一個遠比本片大的權限改動,而 Sean 沒有拍過。**本 plan 不走那條。**

---

## 3. 三條路 · 我推薦哪一條

### 甲 ✅ 在匯流點上 `UPDATE orders SET cancelled_at`,**不寫 `order_cancellations`**(推薦)

```
改什麼  public.pcm_sync_order_refund_payment_status —— 在它算出 v_target = 'refunded'
        (= 全額退完)並 UPDATE payment_status 之後, 同一個交易裡多一發:
          UPDATE public.orders
             SET cancelled_at = now(), cancelled_reason = <對客中性字面>, updated_at = now()
           WHERE id = p_order_id AND cancelled_at IS NULL;   ← 🔴 冪等靠這個 WHERE
        🔵 位置與既有那一行 `PERFORM coupon_revert_on_full_refund(p_order_id)` 同一段
           (`20260910210000:215` 那個「所有 RETURN 之前」的位置)。

為什麼  ① 那兩條接線(待退款 / 退券)掛在【欄位】上 ⇒ 這一發自動觸發它們(§1)
        ② 不必碰 admin_cancel_order 的權限閘(§2)
        ③ **不寫 order_cancellations** ⇒ 不憑空生出一筆「員工取消」的紀錄
           (那張表的 actor / idempotency_key / reason_code / payload_hash 全 NOT NULL,
            而這件事沒有 actor —— 它是系統做的)

migration  **要**(改一支線上函式的定義)⇒ 排貼板 138 + 前置閘 + 事後閘 + Fable 二審。
```

### 乙 ⛔ 放寬 `admin_cancel_order` 的閘,讓匯流點去呼它
```
🛑 **不建議**:那兩道閘守的是「員工不可以取消刷過卡的單」。放寬它 = 一個
   遠比本片大的權限改動, 而 Sean 沒有拍過。⇒ 本 plan 不展開。
```

### 丙 ⚪ 甲 + 另外補寫一列 `order_cancellations`(交辦檔驗收裡寫的那個)
```
交辦檔 §③ 的驗收寫「order_cancellations 恰一列」。
🔴 **而那需要憑空造 actor / idempotency_key / reason_code / payload_hash 四個 NOT NULL 欄**,
   還要過 20260730140000 那兩支 DEFERRED CONSTRAINT TRIGGER(「有 header 必有明細」)
   ⇒ 連帶要寫 order_cancellation_items ⇒ 那會改變 pcm_order_effective_amounts_v 的算出來的金額。
🔵 **而不寫它的代價已經查過, 很小**:`pcm_pending_refund_open_for`
   (`20260905070000:93-102`)在找不到對應取消單時**只是把 cancellation_id 留 NULL**,
   `v_n = 0` 那條路**連 WARNING 都不發**(只有 v_n > 1 才發)。
⇒ 📌 **代價 = 那一列待退款(如果有的話)的 `cancellation_id` 是 NULL**, 沒有別的。
⇒ 我建議**不寫**, 而把交辦檔那條驗收改掉。⚠️ **那是一條要 Sean / 主視窗點頭的修改**(§7)。
```

---

## 4. 🔴 最要緊的一格 —— **先量再寫**

```
🔴 **`pcm_pending_refund_open_for` 會不會對一張【錢已經全退回去】的單開出一列待退款?**

它的 INSERT(`20260905070000:115-119`)吃的是 `pcm_pending_refund_amounts(p_order_id)`。
· 若那支函式**有把已退的錢扣掉** ⇒ 回 0 列 ⇒ INSERT 不插任何東西 ⇒ 🟢 安全。
· 若**沒有扣掉** ⇒ 📌 **我們會對一張已經退完錢的單開出一筆「還要退」** ⇒ 帳面憑空多一筆負債,
  而後台會叫員工再退一次。🛑 **那是本片最壞的失敗方向, 比不做還糟。**

⇒ 🛑 **我【沒有量】這一格。** 動手前必須:
   ① 開 `pcm_pending_refund_amounts` 的最新一代逐行看它有沒有扣掉 `order_refunds` / 卡上已退
   ② 正式庫唯讀量一發:`payment_status='refunded'` 的單, 那支函式各回幾列
      (走 `bash scripts/readonly-prod-sql.sh`)
⇒ 兩者對不上就停下回報, 不寫碼。
```

另外三格也要在同一發唯讀查裡量:
```
② 今天有幾張「已退款而沒標取消」的舊單:
   SELECT count(*) FROM orders WHERE payment_status='refunded' AND cancelled_at IS NULL
   ⇒ 📌 那是【不回頭補】的分母(§5), 而它同時是「這個洞今天有多大」的讀數。
③ 那些單裡有幾張是【刷卡】的(order_payments.rail = 'card')⇒ 本片真正的射程。
④ `pcm_sync_order_refund_payment_status` 的現行 body 指紋(md5)⇒ 前置閘要斷言它。
```

---

## 5. 影響

| 誰 | 看到什麼 |
|---|---|
| **客人** | 訂單頁狀態膠囊從「已退款」變成「**已取消**」(灰虛線框)。⚠️ 那是**對客可見的新行為**。 |
| **員工** | 後台列表與明細同步變已取消。少了「退完錢還要自己按一次取消」那一步。 |
| **券** | `coupon_revert_on_full_refund` 會被呼**兩次**(匯流點原本那一發 + 欄位 trigger 那一發)⇒ 🔵 它自己冪等(Sean 2026-09-11 Q2 甲逐字「無條件呼, 由退券函式自己判夠不夠格」)⇒ 安全, 而**要在事後閘證一次**。 |
| **待退款** | 見 §4 —— **未量, 是本片最大的未知。** |
| **舊單** | 🔴 **不回頭補**(交辦檔明文)。已經 `refunded` 而 `cancelled_at IS NULL` 的舊單維持原樣 —— 批次補標會憑空產生券的還名額與待退款列。 |

**射程(哪些【不】做)**
```
· 部分退款(partiallyRefunded)⇒ 不標取消
· 退款失敗 / 需人工(refund-recovery-actions.ts 那條線)⇒ 不標取消, 維持現狀
· 已經是已取消的單再退款 ⇒ 冪等(靠 `WHERE cancelled_at IS NULL`), 不重複寫
· 非刷卡(匯款 / 現金)的人工退款 ⇒ **見 §7 待答**
```

---

## 6. Rollback

```
🔴 **順序:先退 DB, 再退 app** —— 與 view 那一族相反, 理由不同:
   本片零 TS 改動(全部在一支 SQL 函式裡)⇒ 沒有「前台 select 不存在的欄」那個問題,
   而 DB 那一發【每多跑一次就多標一張單】⇒ 要先讓它停下來。

回捲檔 supabase/rollbacks/<版本>-rollback.sql:
  CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(...)  ← 🔴 **內含完整的舊定義**
  (Sean 2026-09-11 Q4 甲:回捲檔必須自足, 不可以只寫「把那一段刪掉」)

🛑 **已經被標成取消的單【不回捲】** —— 那是真的發生過的事:
   · cancelled_at 不清回 NULL(清了會讓待退款 / 退券那兩條接線的因果斷掉)
   · 已開的待退款列不刪(append-only, 那是錢的紀錄)
   ⇒ 📌 回捲只讓它**不再繼續標**, 不撤銷已經標的。而那要在回捲檔頭寫死。
⚠️ 要撤銷某一張單 ⇒ 那是一次人工操作, 不是回捲腳本的事。
```

---

## 7. 🔴 要 Sean 答的(**今晚不問** —— 他 2026-09-13 深夜去休息了)

```
Q1: 非刷卡(匯款 / 現金)的人工退款全額退完 ⇒ 要不要也自動標已取消?
    甲 = 要(一致:錢全退回去就是取消, 不管走哪條軌)
    乙 = 不要, 只有刷卡自動(他 2026-09-12 的原話只提刷卡, 匯款現金仍由員工自己按整單取消)
    🛑 **我沒有推薦** —— 這一格是他的營運判斷, 不是技術題。
    ⚠️ 而它會改變 §3 甲 那一發 UPDATE 的觸發條件, 所以**沒答之前不寫那一段碼**。

Q2: 那個 `cancelled_reason` 要寫什麼字?它**會被客人看到**。
    (提案:「已全額退款」——中性、不含員工自由文字。)
    🔴 而「客人看得到的新句子」在本專案要 Sean 過目(A3 那條先例)。
```

```
要主視窗裁(不是 Sean 的題):
Q3: 交辦檔 §③ 的驗收寫「order_cancellations 恰一列」, 而 §3 丙 說明了那要憑空造四個
    NOT NULL 欄 + 連帶寫明細 + 動到 effective 金額, 而不寫它的代價只有
    「待退款那一列的 cancellation_id 是 NULL」。
    甲 = 改掉那條驗收, 不寫 order_cancellations(我推薦)
    乙 = 照交辦檔寫, 連 items 一起造
```

---

## 8. 🛑 這份 plan 證不到什麼(誠實寫)

```
· **§4 那一格我沒量** —— 「已退完的單會不會被開出一列待退款」是本片最壞的失敗方向,
  而我今天只讀到 INSERT 吃的是 `pcm_pending_refund_amounts`, **沒有去看那支函式的 body**,
  也沒有對正式庫量。⇒ 📌 **那是【未確認】, 不是【安全】。**
· 我**沒有**驗證「標成已取消之後, 前台那張單的每一處顯示都正確」——
  交辦檔說狀態膠囊會變,而我沒有實際開瀏覽器看過。
  ⇒ 照 CLAUDE.md:**做完的定義是 Sean 自己開瀏覽器從頭走到尾**, 而那在實作之後。
· 券被呼兩次的冪等我是**讀註解**得知的(Sean 2026-09-11 Q2 甲逐字), **沒有實測**。
  ⇒ 實作時要在事後閘裡證一次, 不要沿用這句。
```
