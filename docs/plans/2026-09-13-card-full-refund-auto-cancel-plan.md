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

## 3. 三條路 —— **而其中兩條查過之後【不成立】**

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
        ③ **不寫 order_cancellations** —— 而那**不是取捨, 是唯一走得通的**:
           下面 §3 丙 查出兩個一票否決(標頭沒明細寫不進去 / actor 是 FK 指到 staff),
           而那一節最後那段解釋了**為什麼那道閘擋對了**。

migration  **要**(改一支線上函式的定義)⇒ 排貼板 138 + 前置閘 + 事後閘 + Fable 二審。
```

### 乙 ⛔ 放寬 `admin_cancel_order` 的閘,讓匯流點去呼它
```
🛑 **不建議**:那兩道閘守的是「員工不可以取消刷過卡的單」。放寬它 = 一個
   遠比本片大的權限改動, 而 Sean 沒有拍過。⇒ 本 plan 不展開。
```

### 丙 ⛔ 甲 + 另外補寫一列 `order_cancellations` —— **查過了:寫不進去**

交辦檔 §③ 的驗收寫「`order_cancellations` 恰一列」。主視窗 2026-09-13 另提一個中間選項:
**只寫標頭(`order_cancellations`)、不寫明細(`order_cancellation_items`)** ——
那樣稽核鏈保住、effective 金額零影響、待退款那一列的 `cancellation_id` 有值。

🔴🔴 **不成立。兩個各自獨立的一票否決,而兩個都是唯讀實查出來的(2026-09-13)。**

**否決① — 資料庫有一道閘, 標頭沒有明細【寫不進去】**
```
`order_cancellations_items_presence_ac` 是一支
  AFTER INSERT OR UPDATE ON public.order_cancellations
  DEFERRABLE INITIALLY DEFERRED  ⇒ 在 COMMIT 那一刻檢查
綁 `pcm_assert_cancellation_has_items()`(`20260730140000`), 本體逐字:
  SELECT count(*) INTO v_cnt FROM public.order_cancellation_items WHERE cancellation_id = v_x;
  IF v_cnt = 0 THEN RAISE EXCEPTION '… 沒有任何品項明細;拒繼續'
⇒ 📌 **不是「不建議」, 是 COMMIT 整筆炸掉。**

🟢 而它在正式庫【真的開著】(唯讀實查 pg_trigger, 不是讀 repo):
   tgname = order_cancellations_items_presence_ac · tgenabled = 'O' · deferrable/initdeferred = t/t
```

**否決② — `actor` 是 FK 指到 `staff`, 而「系統」不是一個 staff**
```
建表(`20260730130000:68-` 逐字):
  actor  text  NOT NULL  REFERENCES public.staff(id) ON DELETE RESTRICT

正式庫 staff 實查只有六列:op4_backfill(停用)/ payment_confirmer(停用)/
sean / staff_1 / staff_2 / test_01(停用)。
⇒ 要填就得**挑一個真人的 slug 去記一件他沒做的事**, 或**新增一列假 staff**。

🔴🔴 而那一欄自己的 COMMENT 逐字寫著:「**本欄不得當責任歸屬的證據**」
⇒ 📌 **一個已經自陳不可靠的欄位, 再往裡面塞假資料** ——
  那不只是「字面大於事實」, 那是**在一個已知不可信的地方製造一筆看起來可信的紀錄**。
  🛑 **比單純的空白糟得多。**(主視窗 2026-09-13 逐字。)
```

**另外兩欄也填不「實」**
| 欄 | 約束 | 實況 |
|---|---|---|
| `payload_hash` | `NOT NULL` + CHECK `^[0-9a-f]{64}$` | 它的 COMMENT 逐字說「**真的是 canonical payload 的 sha256** 在 schema 層物理上無法強制」⇒ 我們只能塞一串**形狀對而語意假**的雜湊 |
| `reason_code` | `NOT NULL` + **七值白名單** | 七值是 customer_request / out_of_stock / long_leadtime / price_change / duplicate_order / internal_error / other ——**沒有一個是「刷卡全額退款」**。只能用 `other`,而 `other` **強制** `reason_detail` 非空白(單一雙向 CHECK)⇒ **被迫編一段手寫理由**。 |
| `idempotency_key` | `uuid NOT NULL` | ✅ 這一欄能如實填(算一把決定性的 uuid) |

🔵 順帶(唯讀實查):`reason_code` 今天實際用過的值只有 `internal_error`(3)與 `customer_request`(1)。

---

### 🎯🎯 而這個「不成立」比它成立更有用 —— **本節是本 plan 最該讀的一段**

```
📌 **`order_cancellations` 不是記「一張單被退光了錢」的地方,
   它是記「哪幾樣被取消了」的地方。**
   (主視窗 2026-09-13 逐字:「我當初想的是【怎麼把一列塞進去】,
    而正確的問題是【這件事該記在哪張表】。」)

⇒ 品項明細是零, 是因為**品項沒有被取消 —— 被退的是【付款】**。那是兩件事。
⇒ 🛑 **所以那道「標頭必有明細」的閘擋住我們, 是【擋對了】。**

📌 而 `reason_code` 那個白名單是同一件事的第二個訊號:
   **一個白名單擠不進你要記的事, 通常是在說【你要記的不是那件事】。**
```

---

## 🔴🔴 3-bis. 那條稽核鏈要落在哪 —— **未查, 而它是上線之後唯一的線索**

```
🛑 **「自動標取消」上線之後, 一張單上會出現一個【沒有人按過】的已取消狀態。**
   而 `order_cancellations` 零列(見上面 §3 丙)⇒ 📌 **那張表回答不了「這張單為什麼被標取消」。**

⇒ 那條稽核鏈本來就該落在**退款那一側**:`order_refunds` / `admin_audit_log`。
🔴 **而那一側今天有沒有記、記得夠不夠 —— 我【沒有查】。**
   (主視窗 2026-09-13 裁:不要現在查 —— 它是**另一片**(退款側的稽核完整性),
    而且它會變成 Sean 的一題「要不要補」。今晚不擴張。)

🔵 **而它擺在這裡是刻意的**:
   如果退款那一側也沒記 ⇒ 📌 **那就是一個看不出來的洞** ——
   單子顯示已取消、而系統裡沒有任何一列說得出是誰、什麼時候、為什麼。
   ⇒ 🛑 **實作前要先回答這一條**, 它與 §4 那一格同一個層級。
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
✅ **Q3 已裁(主視窗 2026-09-13, 不是 Sean 的題)**:
   交辦檔 §③ 的驗收「order_cancellations 恰一列」**改掉** —— 改成 **零列**。
   理由不是「省事」, 是 §3 丙 那兩個一票否決 + 那一段「這件事該記在哪張表」。
```

---

## 8. 🛑 這份 plan 證不到什麼(誠實寫)

```
· **§4 那一格我沒量** —— 「已退完的單會不會被開出一列待退款」是本片最壞的失敗方向,
  而我今天只讀到 INSERT 吃的是 `pcm_pending_refund_amounts`, **沒有去看那支函式的 body**,
  也沒有對正式庫量。⇒ 📌 **那是【未確認】, 不是【安全】。**
· **§3-bis 那條稽核鏈我沒查**(主視窗 2026-09-13 明文裁「不要現在查」)——
  而它是上線之後**唯一**還能回答「這張單為什麼被標取消」的東西。
  ⇒ 📌 **它與 §4 同一個層級的硬前提, 不是待辦而已。**
· 我**沒有**驗證「標成已取消之後, 前台那張單的每一處顯示都正確」——
  交辦檔說狀態膠囊會變,而我沒有實際開瀏覽器看過。
  ⇒ 照 CLAUDE.md:**做完的定義是 Sean 自己開瀏覽器從頭走到尾**, 而那在實作之後。
· 券被呼兩次的冪等我是**讀註解**得知的(Sean 2026-09-11 Q2 甲逐字), **沒有實測**。
  ⇒ 實作時要在事後閘裡證一次, 不要沿用這句。
```
