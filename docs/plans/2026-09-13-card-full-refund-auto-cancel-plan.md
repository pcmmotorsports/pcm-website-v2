# 刷卡全額退款成功 ⇒ 自動標「已取消」· 實作 plan(鐵則 8)

> **狀態:🔴 零實作。** 本檔只寫「改什麼 / 為什麼 / 影響 / rollback」,等 Sean 批。
> **來源**:`~/pcm-mailbox/0912-後台UX/交辦-會員等級字面統一.md` §③(Sean 2026-09-12 拍板要排)。
> **貼板下一號 = 139**(137 與 138 都已於 2026-09-13 貼進正式庫)。
> ⛔ ~~本行原本寫「下一號 = 138」~~ —— 那在 138 貼掉的那一刻就過期了。
> 🛑 **而貼板編號本來就是一個【會過期的讀數】** ⇒ 📌 **實作那一天要重問一次, 不要照這一行。**
>   (本專案的規矩:代貼授權的單位是「那一個編號」⇒ 編號寫錯 = 授權對不上。)
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
supabase/migrations/20260910210000_m4b_coupon_revert_wiring.sql:**223-244**(⛔ 原寫 222-246)
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

### 甲 ⚠️ 在匯流點上 `UPDATE orders SET cancelled_at` —— **🔴 已被 §3-ter 取代, 不要照本節做**

> ⛔ **本節寫於「撤銷還存在、而掛載點打算放匯流點」那一代**(2026-09-13 較早)。
> 🔴 §3-ter 定案丙 之後它有**兩處直接打架**,而二輪審抓到了:
>   ① 它標「✅(推薦)」—— 而現在的定案是丙
>   ② 它寫「改什麼:`public.pcm_sync_order_refund_payment_status`」
>      —— 而 §3-ter-1 逐字「🛑 **不能掛在匯流點內部**」(它是四條路共用的)
> ⇒ 📌 **本節保留是為了留痕(它記著「為什麼不寫 order_cancellations」那個仍然有效的結論),
>   而它的【掛載點與推薦標籤】已經作廢。**
> 🔴 **讀的人請直接看 §3-quater**(⛔ 原本寫「看 §3-ter」—— 那也是舊代了,
>   本 plan 共四代:§3 甲 ⇒ §3-ter ⇒ **§3-quater 是現行**)。

```
改什麼  public.pcm_sync_order_refund_payment_status —— 在它算出 v_target = 'refunded'
        (= 全額退完)並 UPDATE payment_status 之後, 同一個交易裡多一發:
          UPDATE public.orders
             SET cancelled_at = now(), cancelled_reason = <對客中性字面>, updated_at = now()
           WHERE id = p_order_id AND cancelled_at IS NULL;   ← 🔴 冪等靠這個 WHERE
        🔵 ⛔ ~~位置與 `20260910210000:215` 那一行同一段~~ —— **引的是第 6 代**(二輪審 should-fix 7)。
           匯流點共 7 代,**現行是 `20260911170000`**,那一行在 `:235`(`RETURN v_ps` 在 `:237`)。
           🛑 而本節的掛載點本身已作廢(見上面那個警告框)⇒ 這一格只是留痕。

為什麼  ① 那兩條接線(待退款 / 退券)掛在【欄位】上 ⇒ 這一發自動觸發它們(§1)
        ② 不必碰 admin_cancel_order 的權限閘(§2)
        ③ **不寫 order_cancellations** —— 而那**不是取捨, 是唯一走得通的**:
           下面 §3 丙 查出兩個一票否決(標頭沒明細寫不進去 / actor 是 FK 指到 staff),
           而那一節最後那段解釋了**為什麼那道閘擋對了**。

migration  **要**(改一支線上函式的定義)⇒ 排貼板(**編號實作那天重問**, 2026-09-13 當下是 139)
           + 前置閘 + 事後閘 + 二審。
           🔵 二審 = `adversarial-reviewer` + Fable 兩路 —— **codex 那一路先拿掉**
              (Sean 2026-09-13 逐字「codex 等解封, 先用其他方式」;
               成因是 `gpt-6-astra` 被 ChatGPT 帳號拒絕, **不是額度** ⇒ 09-15 不會自己好)。
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

> 🔵 **2026-09-13 丙 定案之後的狀態:本節【仍然成立】, 而射程縮小了。**
>   丙 底下只有「線上發起的刷卡全額退款」會被自動標 ⇒ 會出現「沒有人按過的已取消」的單
>   **變少**(今天實查的射程是 **1 張**),而**那個問題本身沒有消失**。
> 🛑 而**丙 讓它稍微好一點**:那張單的 `order_refunds` 上有一列 `status='confirmed'`、
>   `backfilled_source IS NULL` 的退款 ⇒ 📌 **那一列本身就說得出「為什麼被標取消」。**
>   ⚠️ 而那是**推論**(我沒查那一列夠不夠回答「誰、什麼時候」)⇒ 本節的「未查」照舊。

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

## ⛔ 3-ter. **已被 §3-quater 取代 —— 本節為留痕, 不要照它做**

> 🛑 **本節寫於「自己寫一段判斷 + 自己 UPDATE orders」那一代。**
> 而 §3-quater 之後題目變了:**去呼那支已經存在的 `admin_mark_order_cancelled`**
> ⇒ 📌 **本節的掛載點、負對照、cancelled_reason 那幾格【框架已經換掉】**:
> ```
> · 3-ter-1「掛載點這一格現在沒有答案」⇒ ✅ 現在有:①函式內 或 ③cron, 兩條都保留 RPC 的四道閘
> · 3-ter-3「必須同時寫 cancelled_reason」⇒ ✅ 走 RPC 之後【它一定寫】, 不再是一條要記得做的事
> · 3-ter-4 那道 fail-open 的閘 ⇒ ✅ 沒有撤銷段了, 整個不適用
> ```
> 🔵 **而本節【仍然有效】的兩格**:
> ① 那道「只動補登列」的閘(`20260907030000:182-186`)—— 它是「刷卡退款能不能作廢」的答案
> ② §3-ter-2 混軌那條的**機制**(`pcm_pending_refund_amounts` 只算 bank_transfer + cash)
>    —— 它搬到 §3-quater ⑦ 繼續活著
>
> **(以下為作廢原文)**

## 🔴🔴 3-ter(原文). **2026-09-13 定案 —— 只對【線上發起的刷卡全額退款】自動標**

> 🛑🛑 **命名警告 —— 而這一格自己也被抓過一次, 照實寫。**
> ⛔ ~~本檔裡「丙」出現過【兩次, 指兩件不同的事】~~ ⇒ 🔴 **那個數字是錯的**
> (二輪審·字面 must-fix ③, 2026-09-13 實數):`L228` 之後「丙」**仍出現 20 次**,
> 而它今天指 **至少四件事**:
> ```
> ① §3 丙       = 甲 + 補寫一列 order_cancellations   ⇒ 本檔自己查證「寫不進去」, 已否決
> ② 本節         = 只對線上發起的刷卡那一條自動標      ⇒ **Sean 定案的那個**
> ③ §3-ter-2 丙 = 本片不上線直到混軌那條被解掉        ⇒ 已被 §3-quater ⑦-bis 刪掉
> ④ §3-quater ③ 丙 = 放棄①改走③(cron)              ⇒ 已裁, 就是今天的做法
> ```
> ⛔ ~~下面一律不再用「丙」這個字 —— 而 §5 / §7 裡舊的「丙」字樣也一併改掉~~
> 🔴 **那句承諾【沒有做到】, 而說它做到了比沒做更糟。**
> ⇒ ✅ **現行規矩**:本檔**不再清掉**已經寫下的「丙」字(清一遍會動到四節的留痕),
>   而 **上面這張對照表就是唯一的解法** —— 讀到「丙」先回來對一次。
>   📌 **新寫的字一律用全名**(「§3-ter-2 丙」而不是「丙」)。
> ⚠️ 讀到別處(板列 / 對話紀錄)寫「Sean 定案丙」時,**指的是本節**, 不是 §3 丙。

> **Sean 逐字「依照建議」**,而主視窗給的建議是**丙**。
> ⇒ **只有 `admin_finalize_order_refund` 寫出來的那條刷卡退款會自動標已取消。**
> 其他三條路(補登刷卡 / 匯款現金 / 判定更正)**不標**。

### 🔴 這推翻了他同一天早上答的 Q6 乙 —— **兩次答覆都記, 不只記結論**

```
2026-09-13 早上  Q6 乙 = 匯款 / 現金的人工退款【也要】自動標(不分付款管道)
2026-09-13 稍後  丙    = 只對線上發起的刷卡那一條

🔬 中間發生什麼:查證發現**四條退款路裡有三條可以被作廢**, 而唯一沒有反向路的
   正是【線上發起的刷卡】那一條。⇒ 不分管道 = 要蓋住三條可被作廢的路
   ⇒ 連帶整片撤銷機制(12 條 must-fix / 兩個方向的錢錯 / 一封收不回的信)。
   主視窗把**代價逐字**端給他(匯款/現金全退之後**員工還是要自己按取消**), 他看過之後選丙。

🛑 **這一格非記不可**:板上會留著一條「Q6 乙 = 不分管道」, 而碼裡只做刷卡
   ⇒ 📌 **下一個人看到那個矛盾時, 這裡是唯一說得出為什麼的地方。**
```

### 🔴🔴 為什麼這一片**沒有**撤銷路徑 —— **這是一個【前提】, 不是一段歷史**

```
`admin_finalize_order_refund` 寫的那條退款(status → 'confirmed',`20260823010000:356` 起)
**今天沒有任何一條路可以把它作廢或更正**, 而擋住它的是一道具體的閘:

  supabase/migrations/20260907030000_m4b_tappaydirect_a2_void_backfill.sql:**182-186** 逐字
  (⛔ 我原本寫 177-181 —— 那五行是 TOCTOU 註解 + `SELECT ... INTO v_src`。
   🛑 **本片的安全性整個掛在這道閘上, 這是最不能錯的一個座標**, 而我錯了五行。)
    IF v_src IS NULL THEN
      RAISE EXCEPTION 'admin_void_backfilled_refund: 退款 % 不是【補登】的, 不能用這條路作廢。
                       這是一筆我們自己發起的退款 —— 要更正它請走既有的更正入口'
        USING ERRCODE = 'P7C30';
    END IF;
  (`v_src` = `r.backfilled_source`;`admin_correct_backfilled_refund` 同款閘)

🟢 全 repo 會 UPDATE `order_refunds.status` 的只有四支, 而那兩支「作廢 / 更正」的
   **都只動 `backfilled_source` 非 NULL 的列** ⇒ 線上發起的那條被擋死。

🛑🛑 **⇒ 本片的安全性【掛在那道閘上】。**
   哪天有人放寬它(例如「讓客服也能作廢我們自己發起的退款」)⇒ **這一片當場破**:
   那張單會被標成已取消, 而退款被作廢之後沒有任何東西會把它撤回來
   ⇒ 📌 **一張「未退款而已取消」的單, 而沒有東西會叫。**
   ⇒ 🔴 **實作時要有一道事後閘釘住那個前提**(例如斷言 a2/a3 的 body 仍含 `backfilled_source IS NULL`
     那道 RAISE), 讓「放寬那道閘」這件事在 apply 時就撞牆, 而不是在客人身上發現。
```

**⇒ 連帶消掉的**(它們的前提都是「會被撤銷」):券反扣 / 待退款收回 / 取消信收不回 /
撤銷的冪等 / 路1 MF3(分不出誰標的)/ 路1 MF4 的撤銷那一半 / 路2 M1 / 路2 M2。
🔵 **而路1 MF4 的另一半仍然有效**(見 §3-ter-3),路1 MF1 也仍然有效(見 §3-ter-4)。

### 🔴 3-ter-1. 掛載點:**掛在哪才只蓋到那一條** —— 本節是新 plan 最難的一格

```
🛑 **不能掛在匯流點 `pcm_sync_order_refund_payment_status` 內部。**
   它是**四條路共用**的, 而且不只共用:
     admin_finalize_order_refund        :402(20260823010000)
     admin_record_manual_refund         :478(20260823020000)/ :313(20260912040000)
     admin_void_manual_refund           **:395 與 :458 兩發**(20260912040000)
     admin_correct_order_refund_verdict :625 / :699(20260905440000)
     admin_void_backfilled_refund       :197 · admin_correct_backfilled_refund :224
     admin_backfill_tappay_console_refund :228 / :343
   ⇒ 📌 掛在裡面 = 蓋到全部, **那不是丙。**
   ⚠️ 而 `admin_void_manual_refund:395` 那一發是**冪等重放**路徑
     ⇒ 一次「什麼都沒發生的重放」也會走一次掛載點。

🔴🔴 **⛔ 本節第一版提的掛法【被二輪審打穿了】, 兩根支柱倒了一根半 —— 留痕在下面。**

⛔ ~~本 plan 提:掛在 `admin_finalize_order_refund` 裡、在它 `PERFORM 匯流點` 那一行之後,
   判斷式 `IF v_ps = 'refunded' THEN ...`;而三發負對照「結構上就滿足」,
   因為補登族 / 匯款現金 / 判定更正**根本走不到那一行**。~~

**🔴 為什麼倒了(二輪 `adversarial-reviewer` opus,我逐字複核過每一條)**

```
① **字面錯**:那一行不是 `PERFORM`, 是 `v_ps := public.pcm_sync_order_refund_payment_status(...)`
   (`20260823010000:402`)—— 它**拿得到回傳值**。這一格是我寫錯,結論方向不變。

② 🔴🔴 **`v_ps` 在五條分支裡有四條是【步 4 讀到的舊值】**(逐字核過):
     :325  SELECT o.payment_status::text INTO v_ps FROM orders ... FOR NO KEY UPDATE   ← 步 4
     :402  v_ps := pcm_sync_...(v_order_id);   ← **只在 `IF v_after.status = 'confirmed'` 裡面**
   ⇒ `deferred` / `rejected_out_of_range` / `not_sent` / `manual_failed` 那幾條
     **一毛錢都沒退**的出口, `v_ps` 仍是步 4 那個舊值。
   🎯 **可達的失敗情境**:卡單開了一張 processing 退款列 ⇒ 期間員工用
     `admin_record_manual_refund` 把匯款那邊全退 ⇒ `payment_status='refunded'`
     ⇒ 員工回頭把卡那列結成 `not_sent` ⇒ 步 4 讀到 `'refunded'` ⇒ **自動標照樣觸發。**
   ⇒ 🛑 **那正是「非卡那條路把單標掉」** —— 而我那句「它們走不到那一行」對它**無效**:
     📌 **它們走不到那一行, 卻【餵了那一行要讀的值】。**

③ 🔴🔴 **匯流點的 `refunded` 是【跨軌合算】的**(逐字核 `20260911170000` 的 `pcm_order_money_moved`):
     v_moved = order_refunds(卡)+ order_manual_refunds(匯款/現金)+ 第三段
   ⇒ 卡退 6000 + 匯款退 4000 = 總額 ⇒ 在 finalize 裡回 `'refunded'` ⇒ 自動標。
   ⇒ 🛑 **而把兩發的先後對調(先卡後匯款), 同樣的事實就【不標】。**
   ⇒ 📌 **丙 的定義是「只對線上刷卡全額退款」, 而這個述詞實際說的是
     「全軌合計退完, 而最後一發剛好是卡」—— 兩者不等價, 且結果取決於順序。**

④ ⇒ 三發負對照那句「結構上就滿足」**整段作廢** ——
   📌 **負對照守不住的不是【呼叫圖】, 是【述詞的輸入】。**
```

**🔵 而二輪那條 must-fix 裡有一半我核出是【引錯代】, 照實寫**
```
它說「匯流點是 ratchet:v_ps='refunded' 之後任何重算都不再下修」,引 `20260905010000:310`。
🔬 那是**舊代**。最新代 `20260911170000:218-219` 逐字
   (⛔ ~~本行原本寫 `:82-83`~~ —— 那裡是 `coupon_revert_on_full_refund` 的 `prosecdef` 斷言;
    二輪審·字面 should-fix ⑨ 抓到, 我複核屬實):
   「🔴 **`v_ps <> 'refunded'` 那一半拿掉了** —— 它就是『只升不降』。」
   IF v_ps <> v_target THEN UPDATE ... ⇒ **今天會下修。**
⇒ 📌 所以它那條 must-fix 的**後半(卡在 refunded、單子維持已取消)不成立**,
  而**前半(v_moved 含可作廢的人工退款)成立**, 且它與 ③ 是同一件事。
⇒ 🛑 **我不因為它引錯一個座標就丟掉整條** —— 對的那一半要留著。
```

**🔴 ⇒ 掛載點這一格【現在沒有答案】, 而那是這份 plan 要 Sean 知道的第一件事**
```
要滿足丙(只對線上發起的刷卡全額退款), 述詞必須同時答出兩件:
  ① 這一發是【線上發起的刷卡結案】 ⇒ 掛在 admin_finalize_order_refund 裡就答得出 ✅
  ② 而「全額退完」這件事**是那筆卡退造成的**, 不是跨軌合計湊出來的 ⇒ 🔴 **今天答不出**
     —— 因為 `pcm_order_money_moved` 不分軌, 而 `v_ps` 又可能是舊值。
⇒ 可能的方向(**都還沒查、不是建議**):在 finalize 裡自己算「卡上退了多少 vs 訂單總額」,
  不吃匯流點的結論;或加一道「這張單有沒有非卡收款 / 非卡退款」的前置閘(與 §3-ter-2 甲 同族)。
🛑 **我不在這份 plan 裡挑一條** —— 它要先查, 而查完可能發現丙 本身要重新定義。
```

### 🔴🔴 3-ter-2. 混軌多退 —— **本片會【打開】一條今天走不到的錢錯**

```
🔬 路1 MF2 的情境(我複核過它引的檔):
   單 10000 = 卡 6000 + 匯款 4000;客人全額退款走卡上多退 10000
   ⚠️ **而「跨軌合法」那個拍板我讀寬了**(二輪審 should-fix 8):Sean 2026-09-02 的逐字是
   「**客人用匯款付的錢, 可以用現金退給他**」= 兩條**非卡**軌之間。
   ⇒ 📌 **卡軌沒有被明文涵蓋** —— 方向相容, 而不是逐字授權。這一格要標成「吻合但未拍板」。
   ⇒ `pcm_order_money_moved` 不分軌 ⇒ v_moved = 10000 ⇒ payment_status → refunded
   ⇒ **本片的自動標取消觸發** ⇒ trigger 開待退款 ⇒ `pcm_pending_refund_amounts`
     **只算 bank_transfer + cash 兩軌、看不見卡** ⇒ 算出 bank 淨額 4000
   ⇒ 🔴 **開出一列 4000 待退款 ⇒ 後台叫員工再退 4000 ⇒ 多退 4000, 零告警。**

🛑 **而它今天走不到, 只因為 `admin_cancel_order` 擋刷卡單(本檔 §2)——
   而本片是【直接寫 cancelled_at】、不走那支** ⇒ 📌 **本片正是把那條路打開的東西。**

🔬 **射程(2026-09-13 正式庫唯讀實測)**:
```
| 量 | 值 |
|---|---|
| 混軌單(同一張單同時有 card 與非 card 收款) | **0 張** |
| 🟢 負對照(尺會動) | card 2 張 · cash 1 張 |
| 已退款而未標取消的舊單 | 2 張 |
| 其中【線上發起的刷卡退款】= 本片真正的射程 | **1 張** |
```
```
⇒ 🟢 **今天零曝險** —— 而 ⚪ **尺是活的**(各軌分別讀得到 2 / 1 張)⇒ 那個 0 不是查不到東西。
🛑 **而那是一個讀數, 讀數會過期** —— 混軌單的產生條件(一張單收兩種錢)今天沒有被任何東西禁止。

⇒ **本 plan 的建議(⛔ ~~要主視窗或 Sean 裁~~ —— 🟢 **已裁 = 甲**, 見 §3-quater ⑦-bis;
  以下三選項留痕)**:
   甲 = **本片照做, 而加一道前置閘**:自動標之前先問「這張單有沒有非卡的收款?」
        有 ⇒ **不標**(fail-closed), 並留一列稽核。
        🔵 代價:混軌單全退之後員工還是要自己按取消 —— 而那與丙 對匯款/現金的代價一致。
        🟢 而它把那條路**關在本片之外**, 不必等另一片。
   乙 = 本片照做, 混軌那條開列追(代價:那個 0 變成非 0 的那一天沒有訊號)
   丙 = **本片不上線直到混軌那條被解掉**(代價:一張今天就存在的單等不到修)
⇒ 我傾向**甲** —— 它是本片內可以做到的、fail-closed 的、而且與丙 已經接受的代價同款。
   🛑 而那多一個判斷式, 要 Sean 知道「混軌單不會自動標」。
🟢 **2026-09-13 定案 = 甲, 而且不是「傾向」是【必要條件】** —— codex 二輪給了一個
   乙 追不到的反例(退款順序可以讓卡上還欠 4,000 而每張表都正常)⇒ 逐字在 §3-quater ⑦-bis。
```

### 🔴 3-ter-3. `cancelled_reason` —— **只寫 `cancelled_at` 會讓那張單算不出金額**

```
🔬 路1 MF4(我複核過):`20260907170000:225-227` 的結算前提 p2 =
   `cancelled_at IS NULL AND cancelled_reason IS NULL AND canc.n = 0`
   ⇒ p2 假 ⇒ `all_ok` 假 ⇒ `receivable` / `net` 回 NULL、verdict 恆 `needs_human`。
🛑 **而在丙 底下這一條比在甲 底下更重要** —— 沒有撤銷路徑 ⇒ **那張單會【永久】停在那個狀態。**
⇒ 📌 **自動標的時候必須同時寫 `cancelled_reason`。**

⛔ ~~🔵 而那句話**客人看得到** ⇒ Sean 已答 Q7 乙 = 由我們先寫一版給他過目
⇒ 🛑 本 plan 不定字面。待核文案寫成檔、給主視窗、他端 Sean、點頭才接線(照 A3 先例)。~~

🔴🔴 **訂正(2026-09-13, 二輪審·字面 must-fix ④)**:**「客人看得到」那句話不精確。**
  🔬 實查結論逐字在 **§3-quater ⑤**:`cancelled_reason` 是 **RLS 讀得到、而 UI 與信件今天都不印**
  (信件白名單 `CUSTOMER_FACING_CANCEL_REASONS` 只放行五句;storefront 零處 render 它)。
  ⇒ 🟢 **所以沿用手動那句時, Q7 乙那道文案閘【不必開】。**
  ⚠️ **而若改用保留字(§7 Q4 乙)**, 那是另一回事 —— 見 §3-quater ⑤ 的連帶那一格。

🔬 **而有一件唯讀實查出來的事要放進那份文案的參考**:
   正式庫今天 `cancelled_reason` 的值域裡**已經有一句人手打的**:
     「款項已全額退還,收尾把訂單標記為取消」(1 筆)
   其餘:「訂單已取消,詳情請洽客服」(3)/「payment_expired」(1)/「依您要求取消」(1)
   ⇒ 📌 **員工今天已經在手動做這件事, 而他自己打了一句話。**
     那句話是寫給 Sean 看的最好的起點 —— **它是真實使用者在真實情境下選的字。**
```

### 🔴 3-ter-4. 那道 fail-open 的閘 —— **拿掉, 不要留**

```
路1 MF1 / 路2 M3(兩路獨立打到, 我自己也重核過):
  `order_pending_refunds` 的 `voided_at` / `settled_at` 兩欄**確實存在**(`20260901080000:216,218`),
  而 **全 repo 零處 UPDATE 那張表**(🟢 正對照:INSERT 有 **3** 處 ⇒ 尺會動 —— ⛔ 我原本寫 4,
   第 4 個命中是 `20260905070000:558` 的 `strpos(v_src, 'INSERT INTO ...')` **自檢字串**。
   結論不受影響,而**拿來當「尺會動」的正對照, 數字不能錯**。),
  且 `:317` COMMENT 逐字「**今天零寫入端**」。
⇒ 🔴 我原本寫的「`settled_at IS NOT NULL` ⇒ 拒絕撤銷」**掛在一個沒有人會填的欄位上**
  ⇒ 📌 **它永遠不會叫 —— 那是 fail-open。**
⇒ 🛑 **而 fail-open 的閘比沒有閘糟:它讓讀的人以為有東西在守。**
✅ 丙 底下沒有撤銷 ⇒ 那道閘連存在的理由都沒有了 ⇒ **整段拿掉**, 而這一節留著當紀錄。
📌 教訓一句:**欄位存在 ≠ 機制存在。** 我讀到兩個欄位名就寫「機制已經存在」, 而沒有去問「誰會寫它」。
```

## 🟢🟢 3-quater. **2026-09-13 最終定案 —— 而題目比前三輪小得多**

> **Sean 逐字**:Q1 甲「知道會寄信,而且那樣就對」· Q2 甲「知道那顆手動鈕在線上,而我要的就是把手動變自動」
> · actor 那格答 **甲 = 建一列系統身分(停用、標「(系統)」)+ 把那道閘改成具名例外**
> · 時序:「**做好後**」⇒ 📌 **排在訂單列表改版之後, 不是現在實作。**(plan 現在寫,實作等那片。)
>
> 🎯 **題目重新定義**:「自動標取消」**不是**寫一段自己判斷、自己 `UPDATE orders` 的碼,
> 而是**找一個觸發點去呼那支已經存在的 `admin_mark_order_cancelled`**。
> ⇒ 🟡 **前三輪卡死的那個病【消失了一半, 不是全部】** ——
>   ⛔ ~~我原本寫「完全不碰匯流點的 `v_moved` ⇒ 那個病在這條路上不存在」~~
>   🔴 **那句只對一半**(三輪審 `code-reviewer` opus 抓到, 我開檔複核屬實):
> ```
> 那支 RPC 步5 判的是 `orders.payment_status = 'refunded'`(`20260903093000:734`)
> —— 而**那個欄的值正是匯流點用【跨軌總額】寫進去的**:
>   `20260911170000:178`  v_moved := public.pcm_order_money_moved(p_order_id);
>   `:192`                v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded' …
>   `:220`                UPDATE public.orders SET payment_status = v_target
>   而 `pcm_order_money_moved` 的 body 含 `order_manual_refunds`(非卡)。
> ```
> ⇒ 📌 **消失的只有「取決於退款順序」那一半**(RPC 讀的是一個**已落地的欄**,
>   不是在交易中途算);**「跨軌合算」原封不動。**
> ⇒ 🛑 **所以 ⑦ 那條混軌路仍然是開的** —— 而 ⑦ 自己也是這樣寫的
>   (「若它是 tappay 而同時收過匯款 ⇒ 那張單會被標」)⇒ 兩句原本直接打架, 現在對齊。

### ① 那一列系統身分 —— **完全照既有先例, 不發明**

```
🔬 這個系統對「非人的 actor」已經有一套完整的既定做法(開檔核的):
  20260810160000:329  VALUES ('payment_confirmer', 'TapPay 付款確認(系統)', false, false);
  20260811050000:76   VALUES ('op4_backfill',      'OP4 歷史回填(系統)',    false, false);

而它的四條紀律(逐字):
  ① **每一種系統動作【另立一列】, 不共用** —— 主視窗 2026-08-11 裁 Q2=A 逐字:
     「借用付款確認的身分會讓稽核時『這筆是當時刷的、還是後來補的』**永久分不出來**。
      代價只有一列 seed。」
  ② `label` 明寫「(系統)」
  ③ `is_active = false` —— 🔴 **功能性的, 不是裝飾**:`listActiveStaff()` 逐字 filter 掉它
     (`staff.ts:57`)⇒ **不出現在首頁那顆身分 picker(`app/page.tsx:175`)
     與稽核頁篩選(`settings/audit/page.tsx:92`)**
     ⚠️ **而更要緊的是它同時 filter 掉【寫入端】**:`resolveStaff` / `resolveActiveStaffById`
     都吃同一份名單 ⇒ 📌 **那才是它承重的地方, 不是畫面。**
  ④ 而在「設定 → 員工」頁**看得見**(刪除線)—— 逐字:「**系統身分不該是隱形的**,
     Sean 拍板時明白選的」
  🔵 `staff_id_format` CHECK = `^[a-z0-9_]{1,64}$`;裸 INSERT 不用 ON CONFLICT
     (撞名代表有人先手動加過、值不見得對 ⇒ 該當場紅)

✅ **本片照抄**:新增一列(id 建議 `refund_closeout`,`label` = 「退款收尾自動取消(系統)」,
   `is_active = false`)。
🔬 正式庫實查(2026-09-13)staff 現有六列, **零撞名**:
   op4_backfill / payment_confirmer(兩個系統身分, 停用)· sean / staff_1 / staff_2(在職)· test_01(停用)
```

### ② 🔴🔴 那道具名例外 —— **本 plan 最重要的一格, 而它是這片唯一的安全問題**

**那道閘當初為什麼加(開檔核的)**
```
20260812150000:115-121 逐字(這一族最早寫出理由的那一支):
  -- 🔴 FK 只擋「不存在」, 擋不住「已停用」⇒ 這道問的是 `is_active`
  RAISE '經手人 [%] 不存在或已停用 ⇒ 拒絕登錄收款。
         這是人員設定問題、不是訂單問題'
⇒ 📌 **它守的是「離職 / 停用的員工不能再動手」。**
⇒ 而全 repo 掃過:**十幾支同族 RPC 都判它**(admin_cancel_order / admin_record_manual_refund /
  admin_void_manual_refund / admin_create_manual_order / 四支 saved_order_view / …)
  ⇒ 🛑 **那不是某一支自己加的, 是這一族的共同慣例** ⇒ **沒有「抄一個不判它的先例」這條路。**
```

**🔴🔴 而開這個例外的爆炸半徑 —— ⛔ 我第一版的結論【方向是錯的】, 二審打回, 留痕**

```
⛔ ~~我原本寫:`p_actor` 的來源有三層, 第 3 層是使用者自選未驗證
   ⇒ 「員工能不能把 p_actor 塞成系統身分」的答案是「在第 3 層那個世界裡他可以」
   ⇒ 而正式站今天走哪一層【我沒查】, 那是實作前必查的硬前提。~~

🔴 **那個結論方向錯了**(2026-09-13 `adversarial-reviewer` opus M1, 我開檔複核屬實):
   `p_actor` 進 RPC 之前**一定先過 `resolveStaff()`**
   (`apps/admin/src/lib/staff.ts:68-74`), 而它逐字:
     export async function resolveStaff(id) { if (!id) return null;
       return pickStaff(await listActiveStaff(), id); }
   而 `listActiveStaff()`(`:53-58`)逐字 `.filter((row) => row.is_active)`。
⇒ 📌 **票上的 staff_id(第 1 層)與自選 cookie(第 3 層)【走同一支】**,
  而 `refund_closeout` 是 `is_active = false` ⇒ **兩條都解析成 null** ⇒ 那一發寫入送不出去。
⇒ 🎯 **所以「正式站今天走哪一層」對這個例外【不改變結論】** ——
  我把力氣放在一個不影響答案的問題上, 還把它標成硬前提。
```

**🔴🔴 而真正承重的那一行, 我沒點名 —— 它今天【沒有任何東西在守】**
```
開例外之後, `staff.ts:57` 那個 `.filter((row) => row.is_active)`
**從「UI 方便」變成【唯一】阻止員工把 p_actor 送成系統身分的安全邊界。**
🛑 而同一支檔的檔頭 `:4-5` 逐字寫著:「**🔴 這不是登入 / 授權邊界。**」
⇒ 📌 **我們會把整片的安全性, 押在一行自陳不是安全邊界的碼上。**

🎯 具體失敗情境 —— ⚠️ **而它原本寫得太寬, 訂正在下面**(二輪審·字面 should-fix ⑩):
  ⛔ ~~下一個人把某個操作者來源從 `listActiveStaff()` 換成 `listStaffRows()`(全表)
  ⇒ 任何能開後台的人在下拉選「退款收尾自動取消(系統)」⇒ 以系統身分取消訂單並觸發寄信~~
  🔴 **那一步走不到**:寫入端兩層(`actor.ts:138` 與 `:165`)**都經 `resolveStaff`
    → `listActiveStaff`** ⇒ 只換「下拉要列誰」那一處, 選了仍然解析成 `null`, **寫不出去**。
  ✅ **真正一步到位的那條路是 ②-bis 那顆「啟用」鈕**(本檔自己在 ②-bis 就是這樣寫的)。
  ✅ **而換來源這條若要成立, 要換的是【寫入端那兩支】**:`staff.ts` 的 `resolveStaff`
    與 `resolveActiveStaffById` —— 📌 **那才是承重的位置, 不是下拉。**
  🛑 **而不論哪一條, typecheck / lint / build 全綠, plan 那三道配套一道都不會叫。**
```

**🔴 而配套③「斷言那一列 is_active = false」被一顆按鈕繞過**
```
`admin_staff_set_active`(`20260912050000:292-298`)只驗**呼叫者**是在職 manager,
**對【目標列】零限制**(我開檔核過:它只 `SELECT s.is_manager ... WHERE s.id = p_actor AND s.is_active`)。
而 app 層唯一的保護是 `staff-actions.ts:45,257` 的 `BREAK_GLASS_STAFF_ID = 'sean'`,
逐字「**任何請求都不得停用 sean**」⇒ 📌 **它只擋【停用 sean】, 不擋【啟用任何人】。**
而設定→員工頁本來就列停用者 ⇒ **那一列旁邊有一顆可按的「啟用」。**
⇒ 🛑 任一 manager 按下去 ⇒ ① 該列進 `listActiveStaff` ⇒ 出現在操作者下拉
  ② DB 那道閘的 `s.is_active` 那半邊也直接成立 ⇒ **兩層同時失守, 而且是一顆按鈕。**
⇒ 🔴 **而我寫的「事後閘」是 migration 裡執行一次的 assert** ⇒ 它只證明**貼下去那一刻**是對的,
  之後永遠不會再叫。📌 **那道配套的射程被我寫寬了** —— 又一次「看起來在守、實際守不到」。
```

**🔵 而有一格是好消息, 二審替我查了, 要寫下來免得下一個人重查**
```
「有沒有【只判存在不判 is_active】的路會因此被打開?」⇒ **有一支, 而它打不開**:
  `confirm_order_payment`(`20260810160000:485` / `20260906700000:667`)逐字
  `WHERE s.id = session_user` ⇒ 📌 **它 key 的是 DB role 名, 不是 `p_actor`**
  ⇒ 新增一列 staff 打不開它(除非有人另建一個同名的 DB role)。
其餘同族十幾支全帶 `AND s.is_active`(admin_cancel_order / record_manual_payment /
record_manual_refund / void_manual_refund / create_manual_order / 四支 saved_order_view …)。
⇒ 🟢 **這一格是乾淨的。**
```

**⚠️ 而「系統身分不該隱形」那句背書, 在【唯一一頁真的拿來查誰做的畫面】上不成立**
```
`audit-list-view.ts:122-124` 逐字 `staff.find((s) => s.id === actor)?.label ?? actor`,
而名單來自 `settings/audit/page.tsx:90-92` 的 `listActiveStaff()`
⇒ 📌 **停用列查不到 label ⇒ 稽核頁印的是裸 id `refund_closeout`, 那個「(系統)」標籤一個字都不會出現。**
(`payment_confirmer` 今天就是這樣顯示的。)
⇒ 🔵 **所以它靠的是【id 自己夠白話】, 不是那個 label。** ⇒ id 的命名因此是承重的, 不是風格。
```

✅ **例外要怎麼寫得「只此一支、只此一個 id」**(本 plan 提, 要審):
```
IF NOT EXISTS (SELECT 1 FROM public.staff s
                WHERE s.id = p_actor
                  AND (s.is_active OR s.id = 'refund_closeout')) THEN
```
🔴 **而三道配套, 一道都不能省**:
  · **id 寫死字面, 不吃參數、不讀設定** ⇒ 它不可能被「設定成別的」
  · **只改這一支** ⇒ 其餘十幾支一個字不動;而事後閘要斷言**那十幾支仍然沒有這個例外**
    (否則下一個人會以為「別支也可以開」)
  · **一道事後閘斷言那一列的 `is_active = false`** ⇒ 📌 若哪天有人把它設成在職,
    它會出現在操作者下拉裡 ⇒ **員工可以「用系統的身分」操作**, 而那正是先例③要防的。
```

### 🔴🔴 ②-bis. **甲 的風險 —— 而 Sean 是【在知道這些之後】選的**

> **Sean 2026-09-13 逐字重申**:「A: 甲 = 你原本選的 —— 建那列(停用)+ 開一個具名例外」。
> 🛑 **而那是在主視窗把下面三條逐字端給他之後選的** ⇒ 📌 **這一節不是在質疑那個決定,
> 是讓下一個讀到這個風險的人看得到「這已經被端過、他選了」, 而不是以為沒人想過。**

**攻擊路徑(逐字, 全部開檔核過)**
```
① **誰能按**:任一在職的 manager。
   🔬 **數字要綁時點**(二輪審·權限 should-fix 5;⛔ ~~原本寫「今天:sean / staff_1 / staff_2
     之中的 manager」~~ —— 那比既有讀數鬆):`staff-actions.ts:32` 逐字
     「**2026-08-28 量:正式庫 is_manager AND is_active = 1**,後台 2 人在用」
     ⇒ 📌 **引那個數字, 而它綁在 2026-08-28 那個時點** —— 之後有沒有變, 本 plan 沒量。
② **按什麼**:設定 → 員工頁那一列旁邊的「啟用」
   🔬 `admin_staff_set_active`(`20260912050000:292-298`)**只驗【呼叫者】是在職 manager,
     對【目標列】零限制**;app 層唯一的保護是 `staff-actions.ts:45,257` 的
     `BREAK_GLASS_STAFF_ID = 'sean'`, 而它逐字只擋「**停用 sean**」、**不擋「啟用任何人」**。
     ⚠️ **同檔還有第二道 break-glass**(`staff-actions.ts:186`, 二輪審兩路都點到):
       擋「**拿掉 sean 的 manager**」—— 也一樣**不擋「給誰 manager」**。
       ⇒ 📌 兩道都是「保住 sean」, **一道都不是「保住系統身分」**。
③ **按了會怎樣** —— 🔴🔴 **這一格要分【兩個世界】寫, 而本節原本只寫了其中一個**
   (二輪審·權限 must-fix 1, 2026-09-13;座標我全部開檔複核過):
```
   🟢 **今天的正式站(`ADMIN_REQUIRE_REAL_IDENTITY=1`, 2026-08-25 起 —— `authorize.ts:89`)**
     ⇒ 走的是**第 1 層**:票 `v:2` + `sub.kind='user'`
       ⇒ actor = `resolveStaff(session.sub.staff_id)`(`actor.ts:138`)
     ⇒ 📌 **首頁那顆下拉【選了不生效】** —— `actor.ts:104-108` 自己逐字寫著這句;
       `:135` 那道 `if (requireRealIdentity()) return { actor: null, source: 'stale-ticket' }`
       在讀 `ACTOR_COOKIE` **之前**就回去了。
     ⇒ 🛑 **所以在今天的世界, 「按啟用 ⇒ 有人在下拉選它」那條路【到不了寫入】。**
     🔴 **而今天的世界有【另一條】入口, 而本節原本沒寫**:要讓 actor 真的變成
       `refund_closeout`, 需要**上游 SSO 送出 `sub.staff_id='refund_closeout'`**
       (`app/api/sso/callback/route.ts:193-201` 的 `planStaffGate` + `resolveActiveStaffById`)。
       ⇒ 🛑 **那條路 repo 答不出來**(報價站那邊有沒有這個帳號 / 對應表長什麼樣)
         ⇒ 📌 **列為實作前的硬前提**:動手之前要先確認上游發不出這個 sub。

   🔴 **旗標關著的世界(第 3 層, `actor.ts:164`)** ⇒ 才是原本寫的那條:
     actor = `resolveStaff(ACTOR_COOKIE)` ⇒ 下拉選了**會**生效 ⇒ 一顆按鈕兩層同時失守。
```
   ⚠️ **為什麼兩個都要寫**(失敗方向是雙向的):
     · 只寫第 3 層 ⇒ 讀的人以為「一顆按鈕就失守」, 跑去在下拉那側補黑名單,
       而真破口若在上游對應表, **那個黑名單一個字都攔不到**。
     · 只寫第 1 層 ⇒ 讀的人以為「今天按不到, 沒事」, 而旗標是可以被關掉的。
   🔵 **順帶一格(同一路核出來的)**:取消那條路的 actor **一律取自 session**
     (`cancel-actions.ts:241,254,274,384` 都用 `authorization.actorId`)⇒ **表單送什麼值都不看**
     ⇒ 📌 這一格是好消息, 它把「偽造表單欄位」那條路關著。
④ **同時, DB 那道閘的 `s.is_active` 那半邊也直接成立** ⇒ 兩層同時失守。
⇒ 🛑 **整條路徑 = 一顆按鈕 + (今天)一個上游對應表。不需要改任何一行碼。**

🟢 **而有一格讓爆炸半徑窄一格(二輪審給的好消息, 我核過)**:
  `admin_mark_order_cancelled` 對 PUBLIC / anon / authenticated **三道 REVOKE**、
  只 `GRANT EXECUTE … TO service_role`(`20260902140000:459-461` 逐字)
  ⇒ 📌 **這支 RPC 從瀏覽器叫不動** —— 那道具名例外**只在 server 端可達**。
```

**🔴 而它還順手拿到另一條路的一半條件 —— `is_manager = false` 是【承重的】**
```
🔬 開檔核的:`settings/mail/page.tsx:50`   canManage = me?.is_active === true && me.is_manager === true
            `settings/staff/page.tsx:62`  canManage = me && me.is_active && me.is_manager
⇒ 📌 那一列一旦被啟用, 它**同時滿足了「能管理員工 / 信件設定」那條路的一半條件**。
⇒ 🛑 **今天唯一擋著它的, 是 seed 裡的 `is_manager = false`。**

🔴🔴 **⇒ 所以那個 false 是承重的, 而它今天沒有任何東西宣告它承重。**
   📌 **一個承重的 false, 如果沒有東西說它承重, 下一個人會為了方便把它設成 true。**
   ✅ **兩件要做**:
     ① 那一列 seed 的**旁邊寫死這句**(不是寫在 plan 裡, 是寫在 migration 的註解裡 ——
        📌 改它的人會開那支檔, 不會開這份 plan)
     ② 列成一條**不得更動**:`refund_closeout` 的 `is_manager` **永遠是 false**;
        而若哪天要放寬 `is_active`, 那是**另一個決定**, 要重新端 Sean。

🔴🔴 **⇒ 而上面那兩件【都是註解】, 而註解擋不住任何一次 UPDATE**
   (二輪審·權限 must-fix 2, 2026-09-13;座標我開檔複核過)。
```
🔬 **改它的是【第二顆按鈕】, 而本節原本只寫了「啟用」那一顆**:
  · `admin_staff_update_profile`(`20260912050000:220-222` 只驗呼叫者是在職 manager;
    `:236` 逐字 `SET label = p_label, is_manager = coalesce(p_is_manager, false)`)
    ⇒ **對目標列零限制** —— 與「啟用」那支同一個形狀。
  · app 層唯一保護 `staff-actions.ts:186` 只擋「**拿掉 sean 的 manager**」, 不擋「給誰 manager」。
  · UI 那個勾選框 `components/settings/staff-edit-row.tsx:82-85` **對每一列都在**。
⇒ 🛑 **完整路徑 = 先按「啟用」, 再勾「管理者」** ⇒ 兩顆鈕, 而
  `settings/staff:62` / `settings/mail:50` 的 `canManage`、server 端 `isActiveManager`
  (`staff.ts:200`)、DB 那道閘(`20260912050000:294-295`)**三層會同時對它放行**。

✅ **而有一個【機制】可以釘住它, 本 plan 原本沒評估**:表級 CHECK
```
CONSTRAINT staff_refund_closeout_locked
  CHECK (id <> 'refund_closeout' OR (is_manager = false AND is_active = false))
```
  🟢 它是 **role-independent** ⇒ 連拿 `service_role` 直寫也擋(見下面〈半徑〉那節為什麼要緊);
  🟢 而且它會讓那顆「啟用」鈕**當場 RAISE** ⇒ **②-bis 整條路徑關掉**;
  🟢 先例現成:staff 表已經有三個 CHECK(`20260726120000:20-23`)。
  🔴 **而它有一個副作用, 一起寫**:同檔 `:191-197` 有一道斷言逐字
    「應恰有 3 個 CHECK」⇒ 加第 4 個之後, **那支 migration 重新 baseline 會紅**
    (已 apply 的不會重跑 ⇒ 今天不會紅)。
  ⇒ 📌 **本 plan 的立場:採 CHECK。** 若最後決定只留註解, **plan 必須明標
    「那是註解, 不是機制, 擋不住任何一次 UPDATE」** —— 不能讓它讀起來像一道閘。
```

**🔴 而有一個結構事實 —— 而它被兩路審【給了相反的答案】, 原樣留痕**
```
⛔ ~~原文:今天有【兩個地方】在決定「誰出現在操作者下拉」, 而它們沒有共用:
   · `staff.ts:53-58` listActiveStaff() ⇒ .filter(row => row.is_active)
   · `manual-order-view.tsx:59-61` 自己拿全表再濾一次 ⇒ 它不呼 listActiveStaff
   ⇒ 那是「兩張並排的字典」, 任何防護要同時加在兩處, 少一個不會有東西叫。~~

🛑🛑 **2026-09-13 二輪審 —— 兩路對這一格的判定【直接相反】, 逐字並列, 不合併**:
```
· 【字面 vs 事實】那一路:「甲′ 兩處全對。`staff.ts:53-58`(filter 在 `:57`)、
  `manual-order-view.tsx:59-61` 自己 `listStaffRows()` 再濾 ⇒ 兩張並排的字典屬實 ✅」
· 【權限】那一路 must-fix 3:「〈甲′〉的『兩處下拉』點錯了, 修法會落在沒有效力的地方。
  `manual-order-view.tsx:56-63` 的 `activeStaff` **不是下拉**:
  `manual-order-form-body.tsx:142-147` 逐字『這裡刻意【沒有】經手人下拉』,
  `:90` 它只被 `noStaff` 當『名單空了就整張表單停用』用。」
```
🔬 **我自己開檔核過(不採信任一路)**:
  · `manual-order-form-body.tsx:142-147` 確實逐字寫著「這裡刻意【沒有】經手人下拉」;
  · `activeStaff` 在該檔的**唯一**用途是 `:90` `const noStaff = activeStaff.length === 0;`
    ⇒ 它是一個**長度檢查**, 不是一份會被選的名單。
⇒ 🟢 **兩路其實在講兩件事, 而只有一件成立**:
  · 「有兩處各自算了一份在職名單」**成立**(字面路對);
  · 「有兩處下拉」**不成立**(權限路對)⇒ 📌 **而甲′ 的修法是掛在【下拉】上的
    ⇒ 所以權限路那條 must-fix 是對的:照原文改, 會改到一個不是下拉的地方。**

✅ **訂正後的真座標(我核過, 三處)**:
```
① `app/page.tsx:175`              首頁身分 picker ⇒ 走 listActiveStaff()   ← 真的是下拉
② `app/settings/audit/page.tsx:92` 稽核篩選 + label ⇒ 走 listActiveStaff()  ← 真的是下拉
③ 🔴🔴 `lib/staff.ts:69-73` `resolveStaff` 與 `:136` `resolveActiveStaffById`
   ⇒ **寫入端**, 層1(SSO 簽票, `api/sso/callback/route.ts:194`)與層3 共用
   ⇒ 📌 **這一處才是承重的, 而本 plan 原本【沒有點名它】。**
```
🛑 **⇒ 甲′ 若只改下拉, 它擋不住任何一次寫入** —— 有人把 `is_active` 設成 true 且上游
  發得出那個 sub, 票走層1 `resolveStaff` 直接解析成功, **黑名單在下拉那側一個字都沒攔到**。
```

---

### 📁 已評估未採用:**甲′(把下拉的排除與 `is_active` 解耦)**

> 🔵 **留著不刪, 而理由很實際**:📌 **哪天那顆「啟用」鈕真的被按了, 甲′ 就是現成的修法**,
> 不必重新查一輪。

```
甲′ = ① 那道閘的例外【不綁 is_active】(與甲 相同)
      ② 而**下拉的排除改成按 id**, 不是按 is_active:
         上面那【兩處】各加一份「系統身分 id 黑名單」
      ⇒ 🟢 那一列的 is_active 被誰設成 true 都**不會**讓它出現在下拉
      ⇒ 🟢 「一顆按鈕、兩層同時失守」那條路**斷了**

🔬 **它買到的是**:攻擊路徑從「按一顆鈕」變成「**改碼**」
  ⇒ 📌 而那是一個**可被發現的時刻**(code review / diff 看得到), 按鈕不是。

🔴 **而它的代價(為什麼沒採用)** —— ⚠️ **第一條已被上面那格訂正推翻**:
  · ⛔ ~~要改兩處下拉, 而那兩處是後台每天在用的畫面 ⇒ 改壞了員工當場看得到~~
    🟢 **訂正(二輪審·權限 must-fix 3)**:黑名單加在 **`resolveStaff` / `resolveActiveStaffById`
    這兩支**, 比改兩張每天在用的畫面**小**, 而且那才是有效力的位置。
    ⇒ 📌 **所以「代價=要改兩處畫面」這條理由【不成立】** —— 甲′ 沒採用的理由只剩下面那一條。
  · 既有兩列系統身分(`payment_confirmer` / `op4_backfill`)今天靠 `is_active=false` 被排除
    ⇒ 做了 id 清單, 它們**要不要一起納管**?(我傾向要 —— 那樣「系統身分」這個概念
      第一次有一個明確的名單, 而不是靠一個欄位的副作用)⇒ 而那**又擴大一格射程**
  ⇒ 📌 **本片會從「碰一支 RPC」變成「碰後台畫面 + 立一個新概念」。**

🔵 **而 `is_active` 被當成【第三件事】用這一格, 對甲′ 是好消息**:
  它同時是「能不能管理員工 / 信件設定」的權限判準(見上面 ②-bis),
  而甲′ **只動「下拉要不要列你」, 不動 `is_active` 本身** ⇒ 那條權限判準一個字不變。
```

---

### 🔬 `service_role` 的半徑 —— **一個可引用的數字**

> 🔵 為什麼放在這裡:**甲 / 甲′ / 第四條(已撤回)的最後一道防線都是「要有 DB 憑證」**
> ⇒ 那把鑰匙的半徑是三條路共同的底線。
> 🔴🔴 **訂正(2026-09-13 二輪審·權限 should-fix 4)**:那句話**只在 `staff` 以外的表成立**。
> `service_role` 對 `staff` 有欄級 UPDATE(`is_manager` / `is_active`), 而**後台自己就拿著
> 這把鑰匙在跑** ⇒ 📌 **對我們自己寫的下一支碼, 這道「防線」是 0。** 細節在本節末。

```
🛑 **射程先講**:查詢連線是 `pcm_readonly`(非 superuser、非 service_role 成員)。
🔴 **而第一發我得到一個假的 0** —— `information_schema.role_table_grants` 對 service_role
   回 **0 列 / 0 張表**, 而那**不是「它沒有權限」, 是「這條連線看不到」**
   (那張 view 只列出「當前角色是 grantor / grantee / 其成員」的授權)。
   ⇒ 📌 **與 2026-09-13 稍早那次 F4 同一個陷阱, 而這次是量測當下就避開的。**
✅ 改用 `has_table_privilege` / `has_function_privilege` 實測(不受可見性限制):
```
| 量 | 值 |
|---|---|
| public 底下 `service_role` **SELECT 得到**的關聯 | **83** |
| 其中它**還能寫**(INSERT)的 | **21** |
| 🟢 負對照:同一把尺量 `anon` | **10** ⇒ **尺會動** |
| `service_role` **叫得動的 public function** | **93 / 227** |
| `rolbypassrls` | ⚠️ **未確認** —— 查詢只回了 `authenticated` 一列(f);service_role / anon 那兩列這條連線讀不到 |
```
⇒ 📌 **它能讀 83 張、寫 21 張、叫 93 支函式** —— 大, 而**不是無限大**。
⚠️ 而 `rolbypassrls` 那格**未確認**, 它決定 RLS 對它有沒有效 ⇒ **那是半徑的另一半, 我沒量到。**
⇒ 🛑 **不要把上面那幾個數字讀成「service_role 的完整半徑」** —— 它是**表與函式**那一半。
⚠️ **而這幾個也是讀數, 讀數會過期**(與 §3-ter-2 那張表同一句話)—— 量的時點 = 2026-09-13。

🔴🔴 **而「大而不是無限大」這句話, 被用在一個它撐不住的地方**(二輪審·權限 should-fix 4):
```
① **「還能寫的 21」是用 INSERT 量的** ⇒ 📌 **只有欄級 UPDATE 的表【量不到】**
   ⇒ 它是一個**下界**, 不是「能寫的全部」。
② 🛑 **而本片最相關的那張表正好就在那個盲區裡**:`20260726120000:71-72` 逐字
   `GRANT SELECT, INSERT ON TABLE public.staff TO service_role;` 與
   `GRANT UPDATE (label, is_manager, is_active) ON TABLE public.staff TO service_role;`
   ⇒ **`service_role` 改得動 `staff` 的 `is_manager` 與 `is_active`。**
③ 🔴🔴 **所以「最後一道防線 = 要有 DB 憑證」在 staff 這一格【形同虛設】**:
   **後台自己就是拿 `service_role` 在跑的**(`lib/staff-repository.ts:2`
   `createSupabaseServiceClient`)⇒ 📌 對「我們自己寫的下一支腳本 / 下一個 server action」
   而言, 那道防線是 **0**。
⇒ ✅ **兩件跟著改**:
   · 量法要補 **UPDATE / DELETE 與 `has_column_privilege`**, 不能只量 INSERT
   · 本節開頭那句「最後一道防線是要有 DB 憑證」**改寫**(見下面那行訂正)
⇒ 🟢 **而這正是 ②-bis 那道【表級 CHECK】的價值**:CHECK 是 role-independent
  ⇒ 📌 **連拿 service_role 直寫也擋** —— 而註解、app 層守衛、GRANT 全都擋不到它。
```

---

### ③ 觸發點 —— ✅ **已裁 = cron, 不是掛在 finalize 裡**

> **主視窗 2026-09-13 裁,理由逐字**(⛔ ~~不必端 Sean~~ —— 🔴 **訂正**,
> 二輪審·字面 should-fix ⑫:③ 要**新 cron job + route + 白名單** ⇒ 碰 `vercel.json` / CI,
> 而 CLAUDE.md 鐵則 8 明列那一類**要先端 Sean**。⇒ 📌 **掛載點的技術理由是主視窗裁的,
> 而【動 vercel.json 這件事】仍要 Sean 點頭** —— 兩件事不同, 原本寫成一件):
> 📌 **「① 把一個【錢已經動了】的交易, 綁上一個【純記帳】的動作」** ——
> 一個記帳失敗不該讓已受理的退款結不了案。
> 🔬 依據是 codex 那一路查到的:TapPay **先受理**才呼 finalize(`refund-actions.ts:577`),
> 而 finalize **整支零 EXCEPTION handler**(當場數 `grep -c 'EXCEPTION WHEN'` ⇒ **0**)
> ⇒ 自動標取消任一發失敗 ⇒ **那筆已被受理的退款, 本地結案與證據一起回滾、帳本留 `processing`。**
> 🟢 而 ③ 結構上沒有那個問題(它在交易外、失敗就下一輪)⇒ **代價明顯低。**
>
> ⛔ **以下兩欄比較留著當留痕, 而【選擇已經定了】。**

| | ① 掛在 `admin_finalize_order_refund` 內 | ③ 一支 cron 撈了再呼 |
|---|---|---|
| 射程 | 🟢 那支只被線上刷卡結案呼叫(我查過呼叫端) | 🟢 述詞 = RPC 那兩道閘的鏡像 |
| 時機 | **即時**(退款結案的同一個交易) | **延遲**(一輪的間隔) |
| 新 migration | 要(改那支函式) | 🔴 **要**(二輪審·字面 should-fix ⑥ 訂正:⛔ ~~可能不用改既有 SQL~~)—— 那道具名例外必須 `CREATE OR REPLACE admin_mark_order_cancelled`(§②、§⑧);**另外**要新 cron job + route + 白名單 |
| 失敗方向 | RPC 拒 ⇒ **會不會讓退款結案整筆回滾?** 🔴 **未查, 這一格是①的硬前提** | 撈到而 RPC 拒 ⇒ 下一輪再試 / 計 error(既有形狀) |
| 冪等 | 同一交易一次 | 每輪重跑 ⇒ 靠 RPC 自己的兩道 |
⛔ ~~🛑 **我不挑** —— ① 的即時性是它的賣點~~ ✅ **已裁 ③**(見本節開頭)。
而「RPC 拒會不會拖垮退款結案」**不再是未知**, 那正是裁 ③ 的理由:

**🔴🔴 ①的那個未知【被 codex 答掉了, 而答案是它會拖垮】(2026-09-13 codex `gpt-6-astra`, 我複核過)**
```
🔬 真相鏈(開檔核的):
  · **TapPay 先受理, 之後才呼 finalize**(`apps/admin/src/lib/payment/refund-actions.ts:577`
    逐字:`if (refundResult.status === 'accepted') { … finalizeOrderRefund(…) }`)
  · 而 `admin_finalize_order_refund` **整支零 EXCEPTION handler**
    (我當場數的:`grep -c 'EXCEPTION WHEN'` ⇒ **0**)
⇒ 📌 **掛在它裡面的任何一發失敗(鎖逾時 / 稽核寫入撞到 / RPC 的任一道閘 RAISE), 會讓
  【那筆已經被 TapPay 受理的退款】的本地結案與證據【一起回滾】** ——
  帳本留在 `processing`, 而錢在外面已經退出去了。
⇒ 🛑 **而那不是「重複退」, 是【已受理的退款無法正確入帳】** —— codex 的原話,我認同這個區分。
⚠️ 而「恢復結案」那條路若必經同一個失敗點 ⇒ **它也收不了尾。**

⇒ 🔴 **所以 ① 若要走, plan 必須先定明一件事(本 plan 現在【沒有】答案)**:
```
Q:自動標取消失敗的時候, 要不要拖垮退款結案?
  甲 = **不拖** —— 取消段自己包一個 EXCEPTION handler(失敗只記 log / 計數, 不往外拋)
       代價:退款結案成功而單子沒被標 ⇒ **那張單留給人工處理**(而那正是今天的現況)
  乙 = **獨立交易** —— 取消不在 finalize 的交易裡(例:排一個事件, 由別的路消化)
       代價:多一條路、多一個失敗面
  丙 = 放棄 ①, 改走 ③(cron)⇒ 📌 **那個問題結構上不存在**:cron 跑失敗只是那一輪沒做,
       退款結案早就 commit 了。
🛑 **我不推薦** —— 而要指出一件事實:**丙 就是 ③, 而 ③ 本來就在選項裡。**
  ⇒ 📌 這一格可能不是「①要怎麼補」, 而是「**①的代價比 ③ 高**」——
    而那讓 Sean 的選擇變簡單。
```
```

### ④ 冪等鍵 —— **本 plan 提一個決定性的做法**

```
UI 那條是 server 渲染期鑄的 token(一次互動一把)。自動觸發**沒有「一次互動」**。
✅ 提:`p_idempotency_key` = **由 order_id 派生的決定性 uuid**
   (例:`uuid_generate_v5(<固定命名空間>, 'refund_closeout:' || order_id)`,或等價做法)
🔵 **為什麼它冪等**:同一張單永遠算出同一把鍵
   ⇒ 第二次呼叫命中 RPC 的重放路徑(`20260903093000` **步4 `:682-721`** —— ⛔ 我原本寫 `:92-112`, 而那是 `admin_cancel_order`
     的簽章與 DECLARE, **與冪等無關**;`admin_mark_order_cancelled` 從 `:604` 才開始。
     內容是對的:查 admin_audit_log 同 target + action + request_id ⇒ 比對 actor / source_app / reason
     都相同 ⇒ `:721` 回 `'idempotent', true`;不符即 fail-loud)
   ⇒ 而即使沒走到那裡, `cancelled_at 非 NULL` 那道(**步5 `:726-728`**)也會擋。**兩道。**
🔴 **而要證不要推**:實作時要有一發測試跑兩次、斷言第二次不新增任何一列。
🔴🔴 **而「不新增任何一列」【不夠】**(codex 2026-09-13 should-fix, 我核過):
  `pcm_pending_refund_open_for` 的 INSERT 帶 `ON CONFLICT … DO UPDATE SET amount_at_cancel = …`
  (`20260905070000:239`)⇒ 📌 **重跑可能【不新增列而改掉既有那一列的金額】**
  (例:把待退 400 改成 1000);退券那發也是 UPDATE。
  ⇒ ✅ 斷言要**同時比對前後值**:`order_pending_refunds.amount_at_cancel`、
    `coupon_redemptions.reverted_at`、以及退款帳本 —— **不是只數列數。**
  ⇒ 🎯 **形狀**:一個「沒有新增列」的斷言, 在一個 **UPSERT** 的世界裡是恆真而無資訊的。
⚠️ 那個「固定命名空間」要寫死在碼裡、不吃設定 —— 它一變, 同一張單就算出另一把鍵。
```

### ⑤ 痕跡:`cancelled_reason` 要填什麼 —— **而這裡有一個既有慣例**

```
🔬 `expire_unpaid_orders`(系統自動取消那條, 今天在跑)的痕跡做法:
   cancelled_reason = 'payment_expired'  ← **一個保留字**
   而 `admin_mark_order_cancelled` **明文拒絕員工填那個字**(`20260903093000` **`:662-665`** 那道 RAISE
   —— ⛔ 我原本寫 `:50`, 而那是 `strpos` 的語法眉角註解。`admin_cancel_order` 版在 `:168`)
⇒ 📌 **這個系統已經有「用 reason 的保留字標示【這是系統做的】」的做法。**

🔵 **而本片走那支 RPC ⇒ 它會用 app 傳的 `reason_detail`**, 而手動那條傳的是
   `cancel-actions.ts:383` 的「款項已全額退還,收尾把訂單標記為取消」。
⇒ **本 plan 提:自動那條沿用同一句**, 理由:
   ① 那不是新字 ⇒ Q7 乙那道閘(新的對客字面要 Sean 過目)**不必開**
   ② 客人看到的東西不因為「誰按的」而不同 —— 那是對的
🔴 **而要不要改用保留字(像 payment_expired 那樣)⇒ 這一格我列成待裁**:
```
Q:自動觸發的 cancelled_reason 要不要用一個保留字(而非沿用手動那句)?
  甲 = 沿用手動那句(客人看到的一樣;而稽核靠 actor = refund_closeout 分辨)← 本 plan 傾向
  乙 = 用保留字(例 'refund_closeout')⇒ 🔴 **而那要一併加進「員工不准填」那份拒絕清單**
       📌 不加的話, **員工可以手打一個看起來像系統做的理由**。
```
⚠️ 🔴 **而「客人看得到」這句話要精確化**(三輪審抓到本 plan 三處自相矛盾):
```
🔬 實查:
  · **信件**:`CUSTOMER_FACING_CANCEL_REASONS` 白名單只放行五句 ⇒ **`other` 那句不印**
    —— 而那句「款項已全額退還,收尾把訂單標記為取消」**正是 09-12 白名單要擋的那一句**
      (`order-email-copy.ts:319-325` 逐字點名它與 NVB42Z)
  · **顧客站 UI**:storefront **零處 render `cancelled_reason`**(只在測試檔出現)
  · **而 RLS 讀得到**:`20260712203000:89` 逐字「會員看得到自己單的 cancelled_reason」
⇒ 📌 **正確的說法是:【RLS 讀得到, 而 UI 與信件今天都不印】** —— 不是「客人看得到」。
⇒ 🟢 **所以沿用手動那句, Q7 乙那道閘【不必開】**(它擋的是「新的對客字面」,
  而這一句今天到不了客人眼前)。§3-ter-3 與 §7 Q2 那兩處寫「客人看得到 ⇒ 要開閘」**已過期**。
  🔴 ⛔ ~~本行原本寫「見那兩節的訂正」~~ —— **而那兩節當時【沒有】訂正**
  (二輪審·字面 must-fix ④ 抓到:宣稱存在的訂正不存在)⇒ **2026-09-13 已補上**, 現在真的在那兩節裡。
```
⚠️ **而乙(改用保留字)有一個連帶**:`cancelled_reason` 這個欄
  ⇒ 保留字若沒被 `CUSTOMER_FACING_CANCEL_REASONS` 白名單擋住, 會印進信裡。
  🔵 而今天那個白名單只放行 DB 映射的五句 ⇒ 保留字**不在裡面** ⇒ 不會印。**已驗。**
```

### ⑥ 寄信 —— ✅ **已答, 不再是待答**

```
🟢 **Sean 2026-09-13 逐字答甲:「知道會寄信, 而且那樣就對」**(單子真的取消了, 客人該收到通知)。
🔬 機制(開檔核的):標 `cancelled_at` ⇒ 那張單進 `pcm_cancelled_email_pending`
   (`20260912020000` 的述詞第一分支:`payment_method='tappay'` + `payment_status IN
    ('refunded','partiallyRefunded')` + 無未作廢的人工退款)⇒ cron 排信。
🔵 而那封信**今天就在寄**(手動那顆鈕按下去就會)⇒ 本片不改變那件事, 只改變「誰觸發」。
⚠️ 而 09-12 那次內容出過事(NVB42Z 那封印出了內部用語)已經修掉:
   `CUSTOMER_FACING_CANCEL_REASONS` 白名單只放行 DB 映射的五句。
```

### ⑦ 🔴 混軌那格 —— **查完了, 而那條路【沒有】關上**

> ⛔ ~~本節標題原本寫「而答案讓混軌那條路關上了」~~ —— 🔴 **那句話不成立**
> (codex 二輪 must-fix + 收尾 grep 一起抓到):本節自己的內文就寫著「若它是 tappay 而
> 同時收過匯款 ⇒ 那張單會被標」, §3-quater 開頭 `:449` 也逐字寫著「⑦ 那條混軌路仍然是開的」。
> ⇒ 📌 **關上它的不是那個 0 張, 是 ⑦-bis 那道閘 —— 而那道閘還沒做。**

```
🔬 正式庫唯讀實查(2026-09-13):
  · `payment_method` 的值域只有兩種:**NULL(7 張)/ tappay(2 張)**
  · 🔴 **`payment_method='tappay'` 而同時收過非卡的單 = 0 張**
  · 🟢 負對照:tappay 單共 2 張, 其中有收款紀錄的 2 張 ⇒ **尺會動**

⇒ 📌 **而更要緊的是【機制】不是讀數**:那支 RPC 判的是 `orders.payment_method = 'tappay'`
  —— 一張混軌單的 `payment_method` 是**實際怎麼收的那一個值**(`20260712203000:87` 的
  COMMENT 逐字:`payment_method` 是事實軸、`payment_channel` 是預期軸)。
  ⇒ 🔵 **若混軌單的 payment_method 不是 'tappay' ⇒ 它根本進不了這支 RPC ⇒ 自動標不到它。**
  ⚠️ **而若它【是】 'tappay' 而同時收過匯款** ⇒ 那張單會被標,
    而 §3-ter-2 那條「多退 4000」的路就會被打開。
⇒ 🛑 **所以這一格的結論是:今天 0 張, 而【那不是機制上的保證】。**
  ✅ **本 plan 提一道前置閘**(與 §3-ter-2 甲 同族):自動觸發前問一句
    「這張單有沒有非卡的收款?」有 ⇒ **不標**(fail-closed)+ 留稽核。
  🔵 它問得到:`order_payments.rail`(值域含 card)。
  🔴 而**手動那顆鈕今天沒有這道閘** ⇒ 📌 若要加, 那是一個**改變既有行為**的決定, 要 Sean 知道。
```

#### 🔴🔴 ⑦-bis. **這道閘是【本片的必要條件】, 不是一個選項**(codex 二輪 must-fix, 2026-09-13)

```
🛑 **裁定(plan 層, 不是 Sean 的題)**:上面那道前置閘 **列為本片實作的必要條件** ——
   自動標那一段碼**不得在沒有這道閘的情況下上線**。
   ⇒ 📌 原本 §7 Q3 的「甲/乙/丙 三選一」**降為只剩甲**;乙(照做+開列追)與丙(不上線)都被下面
     這個反例刪掉 —— 乙 追不到(見下), 丙 過度(閘做得出來)。

🔬 **反例(codex 二輪逐字, 我已唯讀複核兩處出處)**:
```
訂單總額 10,000。卡收 10,000、另外又收匯款 4,000(總收 14,000)。
先退匯款 4,000, 再退卡 6,000 ⇒ 跨軌退款合計 10,000。
```
   ① **`payment_status` 會變成 `refunded`**:`v_moved >= v_total` 就成立
      —— 而 `v_moved` 是**跨軌加總**, 不分軌
      (`20260911170000:178,192` 逐字 `v_moved := public.pcm_order_money_moved(p_order_id);`
       與 `CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'`)。
   ② ⇒ cron 的候選述詞(`refunded` + `tappay` + 未取消)**放行**, 取消 RPC 也放行。
   ③ 🔴 **而卡上實際還有 4,000 沒退。**
   ④ 🔴🔴 **而【沒有任何東西會把這 4,000 列出來】**:待退款算式只跑 `bank_transfer` 與 `cash`
      兩軌(`20260902030000:83` 逐字 `FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)`)
      ⇒ 匯款那軌淨額 = 4,000 收 − 4,000 退 = **0** ⇒ 開不出列;卡那軌**根本不在算式裡**。
   ⇒ 🛑 **結論:訂單被自動結案, 而客人卡上少拿 4,000, 而系統的每一張表都顯示正常。**

📌 **為什麼這推翻「今天 0 張就夠了」**:那 0 張講的是**現在的存量**,
   而這個反例講的是**一條隨時走得到的路** —— 一張 `payment_method='tappay'` 的單
   只要有人補收一筆匯款, 它就成立, 而**沒有任何閘擋著那個補收**。
🔵 **誠實寫**:退款狀態那個缺口(`refunded` 不代表卡全退)**是本片之前就存在的**。
   本片不製造它 —— 本片把它**從「狀態標錯」升級成「自動結案」**。
   ⇒ 而那正是為什麼閘要在本片做:本片是那個缺口第一次會**自己動手**的地方。
```

### ⑧ Rollback(分段)

```
🔴 順序:**先退觸發點, 再退例外, 最後才是那一列 seed。**
  ① 觸發點(①或③)⇒ CREATE OR REPLACE 回不含觸發段的定義 / 停掉 cron job
  ② 那道具名例外 ⇒ CREATE OR REPLACE `admin_mark_order_cancelled` 回**不含例外**的定義
     🔴 **必須在 ① 之後** —— 反過來做, 觸發點還在而例外沒了 ⇒ 每一發都被閘拒、計 error
  ③ 那一列 staff seed ⇒ 🛑 **不刪。** 它被 `admin_audit_log.actor` 引用過
     (而那張表 append-only)⇒ 刪它會讓已經寫下的稽核列指向一個不存在的身分。
     ⇒ 📌 **回捲只讓它不再被使用, 不刪它。**
🛑 **已經被自動標成取消的單一律不回捲** —— 那是真的發生過的事(而且信已經寄了)。
🔴 回捲檔必須**內含完整的舊定義**(Sean 2026-09-11 Q4 甲)。

🔴🔴 **而停掉 cron【不等於】副作用停了**(codex 二輪 should-fix, 2026-09-13):
  被自動標成取消的單, `cancelled_at IS NOT NULL` ⇒ 它就進了**既有那支待退款補開 cron** 的
  掃描範圍(`20260905180000:163-165` 逐字 `WHERE o.cancelled_at IS NOT NULL`)。
  ⇒ 📌 那支每 10 分鐘跑一次, 只要**非卡淨額為正而缺活列**, 它就會**補開一列待退款**
    —— 而那列會變成員工看得到的待辦, 有人會照著它**再匯一次錢**。
  🔵 它自己有一道保護:那張單上**有任何作廢列 ⇒ 整張跳過**(同檔 `:167-170`)
    ⇒ 人工作廢掉的列不會原地復活。
  ⇒ ✅ **回捲清單要多一步 ④**:把本片期間被自動標取消的單撈出來,
    **逐張核對 `order_pending_refunds` 有沒有被那支 sweep 補開列**;有而且是錯的 ⇒ 作廢它
    (走既有作廢路徑, 不是 DELETE)。**先作廢再停 cron 是錯的順序** —— 停之前它還會再開一次。
  🟢 **而 ⑦-bis 那道閘正是把這條路關上的東西**:純卡單的非卡淨額恆為 0
    ⇒ 那支 sweep 掃到也開不出列。
    ⇒ 📌 **所以這一條的曝險大小 = ⑦-bis 那道閘有沒有做** —— 兩條 finding 是同一件事的兩端。
```

### ⑨ 本片完成後的總審

```
🔵 **Sean 2026-09-13 逐字**:「所有改動做完之後, 請 codex 全面盤點設計一次,
   看有沒有更優化的方式」⇒ 📌 那是一次**收尾的總審**, 不是逐片審。
⇒ **本片完成後納入那次總審的範圍。** 排程由主視窗決定。
```

---

## 4. 🔴 最要緊的一格 —— **先量再寫**

```
🔴 **`pcm_pending_refund_open_for` 會不會對一張【錢已經全退回去】的單開出一列待退款?**

它的 INSERT(`20260905070000:115-119`)吃的是 `pcm_pending_refund_amounts(p_order_id)`。
· 若那支函式**有把已退的錢扣掉** ⇒ 回 0 列 ⇒ INSERT 不插任何東西 ⇒ 🟢 安全。
· 若**沒有扣掉** ⇒ 📌 **我們會對一張已經退完錢的單開出一筆「還要退」** ⇒ 帳面憑空多一筆負債,
  而後台會叫員工再退一次。🛑 **那是本片最壞的失敗方向, 比不做還糟。**

🟢 **2026-09-13:這一格【被答掉一半了】**(路1 MF2 逐行看過 `pcm_pending_refund_amounts`,
   我複核過它引的檔):
```
· 它只算 bank_transfer + cash 兩軌(`20260902030000:81,87`), **整支看不見卡上的退款**
⇒ **純卡單 / 純匯款單全額退完 ⇒ 回 0 列 ⇒ 不會被開出待退款。** 本格的恐懼在那兩種單上不成立 ✅
🔴 **而混軌單會** —— 那條路整段搬到 §3-ter-2, 因為它需要的不只是量, 是一個決定。
```
⚠️ **仍然沒量的**:正式庫那一發唯讀量測(那支函式對 `payment_status='refunded'` 的單各回幾列)
—— 路1 全程只讀 repo、零正式庫查詢。⇒ 動手前仍要:
   ① 開 `pcm_pending_refund_amounts` 的最新一代逐行看它有沒有扣掉 `order_refunds` / 卡上已退
   ② 正式庫唯讀量一發:`payment_status='refunded'` 的單, 那支函式各回幾列
      (走 `bash scripts/readonly-prod-sql.sh`)
⇒ 兩者對不上就停下回報, 不寫碼。
```

另外三格也要在同一發唯讀查裡量:
```
✅ ~~② 已退款而沒標取消的舊單~~ / ~~③ 其中幾張是刷卡~~ —— **2026-09-13 已經量完了**
   (§3-ter-2 那張表:**2 張 / 其中線上刷卡 1 張**)⇒ 二輪審 should-fix 10 抓到這一格是殘留。
④ ⛔ **整格作廢**(二輪審·字面 must-fix ②, 2026-09-13)—— ~~以下原文留痕~~
   🔴 **理由**:掛載點裁成 **cron** 之後, 本片**完全不動** `admin_finalize_order_refund`
   ⇒ 📌 **對一支本片不碰的函式下 body 指紋前置閘, 守的是一個不會變的東西。**
   🛑 **而這個錯與上一輪 must-fix 5 抓到的是【同一個形狀】** —— 那次是指紋對象寫成
   `pcm_sync_order_refund_payment_status`(匯流點那一代的殘留), 修法是「換對象」;
   而換完之後**掛載點又變了**, 於是它第二次過期。
   ⇒ ✅ **正確的前置閘對象 = `admin_mark_order_cancelled`**(本片唯一要 CREATE OR REPLACE 的),
     而那一格已經在 §3-quater ⑧ 的回捲順序裡。
   ⛔ ~~④ 🔴 `admin_finalize_order_refund` 的現行 body 指紋(md5)⇒ 前置閘要斷言它。~~
   ⛔ ~~本行原本寫 `pcm_sync_order_refund_payment_status`~~ —— 那是掛載點還在匯流點那一代的殘留
   (二輪審 must-fix 5)。本節定案掛在 `admin_finalize_order_refund` ⇒ **斷言的對象要跟著換**,
   否則前置閘守的是一支本片根本不動的函式。
```

---

## 5. 影響

| 誰 | 看到什麼 |
|---|---|
| **客人** | 訂單頁狀態膠囊從「已退款」變成「**已取消**」(灰虛線框)。⚠️ 那是**對客可見的新行為**。 |
| **員工** | 後台列表與明細同步變已取消。少了「退完錢還要自己按一次取消」那一步。 |
| **券** | `coupon_revert_on_full_refund` 會被呼**兩次**(匯流點原本那一發 + 欄位 trigger 那一發)⇒ 🔵 它自己冪等(Sean 2026-09-11 Q2 甲逐字「無條件呼, 由退券函式自己判夠不夠格」)⇒ 安全, 而**要在事後閘證一次**。 |
| **待退款** | 見 §4 —— ⛔ ~~未量, 是本片最大的未知~~ 🟢 **已答掉大半**(二輪審·字面 should-fix ⑧):算式只跑 `bank_transfer` + `cash` ⇒ **純卡單開不出待退款**。🔴 剩下的是**混軌**那條 ⇒ 已由 §3-quater ⑦-bis 的 fail-closed 閘關上。⚠️ 仍沒做的只有正式庫那一發唯讀量測。 |
| **舊單** | 🔴 **不回頭補**(交辦檔明文)。已經 `refunded` 而 `cancelled_at IS NULL` 的舊單維持原樣 —— 批次補標會憑空產生券的還名額與待退款列。 |

**射程(哪些【不】做)**
```
· 部分退款(partiallyRefunded)⇒ 不標取消
· 退款失敗 / 需人工(refund-recovery-actions.ts 那條線)⇒ 不標取消, 維持現狀
· 已經是已取消的單再退款 ⇒ 冪等(靠 `WHERE cancelled_at IS NULL`), 不重複寫
· 🔴 **非刷卡(匯款 / 現金)的人工退款 ⇒ 【不標】**(Sean 2026-09-13 定案丙)——
  ⛔ ~~本行原本寫「見 §7 待答」~~ 而那在 §3-ter 落地之後就過期了(路3 #5 抓到本 plan
  對同一題給了兩個相反狀態)。⇒ 代價:匯款 / 現金全退之後**員工還是要自己按取消**。
· 🔴 **補登的刷卡退款 / 判定更正 ⇒ 也【不標】**(同上,它們都有反向路)。
· 🔴 **混軌單(同時有卡與非卡收款)⇒ 也【不標】** —— ⛔ ~~本行原本寫「建議甲…待裁」~~
  ✅ 已升為**本片必要條件**(codex 二輪 must-fix)⇒ 反例與裁定逐字在 **§3-quater ⑦-bis**。
```

---

## 6. Rollback —— 🔴 **整節作廢, 看 §3-quater ⑧**

> ⛔ **本節寫於「掛載點打算放匯流點 / 後來放 admin_finalize_order_refund」那兩代**,
> ⛔ ~~而 §3-quater ③ 的掛載點**還沒挑**(①函式內 / ③cron)~~ —— 🔴 **那句話過期了**
> (二輪審·字面 must-fix ①, 2026-09-13):**已裁 = ③ cron**(§3-quater ③)。
> ⇒ 本節作廢的理由改成:**它的回捲目標是【函式內掛載】那一代的**, 而現在掛載點是 cron。
> 🔴 而它逐字寫「本片零 TS 改動(全部在一支 SQL 函式裡)」—— **在 ③ 那條下那是假的**
> (③ 要新 cron job + route + 白名單)。
> 🛑 它也完全沒有 ⑧ 的第②段(撤掉具名例外)與第③段(seed 不刪),而 ⑧ 明寫順序反了會「每一發都被閘拒」。
> ⇒ 📌 **兩份回捲並存而互不相容, 是 Sean 一讀就會拿到錯結論的那一種** ⇒ **以 §3-quater ⑧ 為準。**
> 🔵 本節原文留下當留痕, 不要照它做。

### ⛔ 以下為作廢原文

```
🔴 **順序:先退 DB, 再退 app** —— 與 view 那一族相反, 理由不同:
   本片零 TS 改動(全部在一支 SQL 函式裡)⇒ 沒有「前台 select 不存在的欄」那個問題,
   而 DB 那一發【每多跑一次就多標一張單】⇒ 要先讓它停下來。

回捲檔 supabase/rollbacks/<版本>-rollback.sql:
  🔴 ⛔ ~~CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(...)~~
  **那是【丙 定案之前】的寫法, 現在錯了** —— 丙 把那一段掛在
  `admin_finalize_order_refund` 裡(§3-ter-1), **不動匯流點。**
  ✅ 回捲的目標是:
    CREATE OR REPLACE FUNCTION public.admin_finalize_order_refund(...)   ← 🔴 **內含完整的舊定義**
  (Sean 2026-09-11 Q4 甲:回捲檔必須自足, 不可以只寫「把那一段刪掉」)
  ⚠️ 而**簽章要在實作那天重抄**(`bash scripts/latest-definition-of.sh admin_finalize_order_refund`)
    —— 那支函式有多代, 抄錯代等於回捲到別人的版本。

🛑 **已經被標成取消的單【不回捲】** —— 那是真的發生過的事:
   · cancelled_at 不清回 NULL(清了會讓待退款 / 退券那兩條接線的因果斷掉)
     🔴 **而在丙 底下這一條更硬**:全 repo 零處把 cancelled_at 改回 NULL(§3-ter 查證)
     ⇒ 📌 **回捲腳本不可以是【第一支這樣做的碼】** —— 那等於在回捲裡開一條新路。
   · 已開的待退款列不刪(append-only, 那是錢的紀錄)
   ⇒ 📌 回捲只讓它**不再繼續標**, 不撤銷已經標的。而那要在回捲檔頭寫死。
⚠️ 要撤銷某一張單 ⇒ 那是一次人工操作, 不是回捲腳本的事。
```

---

## 7. 🔴 未決項

> 🛑 **二輪審 must-fix 6**:本節原本三格全標「✅ 已答 / 已裁」,而 **§3-ter-2 的混軌那格
> 是一個【未裁的決定】, 而且它會改變碼**(甲 = 加前置閘 fail-closed 不標 / 乙 = 開列追 /
> 丙 = 不上線直到解掉)。⇒ 📌 **「這份 plan 沒有未決項」那句話本身不成立。**
> ⇒ 現在列在下面 Q3。

```
🟢 **Q3 已不是三選一了**(codex 二輪 must-fix, 2026-09-13)——
   ⛔ ~~甲 / 乙 / 丙 三選一, 本 plan 傾向甲~~
   ✅ **只剩甲, 而且升級成【本片的必要條件】**:自動標之前加一道前置閘,
     有非卡收款 ⇒ **不標**(fail-closed)+ 留稽核。理由與反例逐字在 **§3-quater ⑦-bis**。
   🔵 今天實查混軌單 = 0 張 —— 而那是讀數, 不是不變式, ⇒ **不能拿來取代閘**。

🔴 **Q3′(這一格才是要 Sean 的)**:**手動那顆鈕**要不要也加同一道閘?
   甲 = 加 —— 兩條路一致, 而那是**改變既有行為**(今天員工按得下去)
   乙 = 不加 —— 手動那條維持現狀, 只有自動這條有閘 ← 本 plan 傾向
     理由:手動是**人看著按的**, 而自動沒有人看;閘是為了補上那個「沒有人看」。
```

```
🔴 **Q4(未裁 —— 二輪審·字面 must-fix ⑤ 抓到它【只寫了傾向、沒進未決項】)**:
   自動觸發的 `cancelled_reason` 要不要用一個**保留字**(而非沿用員工手打那句)?
   甲 = 沿用手動那句 ← 本 plan 傾向(客人那側今天不印它;稽核靠 `actor` 分辨)
   乙 = 保留字(例 `refund_closeout`)⇒ 🔴 **要一併加進「員工不准填」那份拒絕清單**,
        不加的話員工可以手打一個看起來像系統做的理由。
   🔵 完整討論(含白名單實查)在 §3-quater ⑤。
```

### 已答的(留痕)

```
✅ **Q1 已答兩次, 而第二次推翻第一次 —— 逐字都在 §3-ter 開頭那一節。**
    2026-09-13 早上 Q6 乙 = 不分管道都標 ⇒ 稍後改 **丙 = 只對線上發起的刷卡**。
    ⛔ ~~本格原本還列著兩個選項與「沒答之前不寫那一段碼」~~ —— 那在丙 落地之後就過期了。

Q2: 那個 `cancelled_reason` 要寫什麼字?⛔ ~~它**會被客人看到**~~
    🔴🔴 **訂正(2026-09-13, 二輪審·字面 must-fix ④ —— 而這一格就是它說「訂正不存在」的那一處)**:
       **那句話不精確。** 實查逐字在 §3-quater ⑤:`cancelled_reason` 是
       **RLS 讀得到, 而 UI 與信件今天都不印**(信件白名單只放行五句;storefront 零處 render)。
    ⇒ 🟢 **所以沿用手動那句時, Q7 乙那道文案閘【不必開】** —— 它擋的是「新的對客字面」,
       而這一句今天到不了客人眼前。
    ⚠️ **而若改用保留字(§7 Q4 乙)**, 白名單那一格要重看 —— 見 §3-quater ⑤ 的連帶。
    🔵 **Sean 2026-09-13 答 Q7 乙 = 由我們先寫一版給他過目** 這件事本身沒有作廢;
       改變的只是**它是不是【必要】**:今天不是。要不要仍然端給他看, 是主視窗的判斷。
    🔬 而**起點應該是員工自己打的那一句**(§3-ter-3 實查):
       正式庫今天已經有一筆手打的「款項已全額退還,收尾把訂單標記為取消」
       ⇒ 📌 **那是真實使用者在真實情境下選的字**, 比我編一句好。
```

```
✅ **Q3 已裁(主視窗 2026-09-13, 不是 Sean 的題)**:
   交辦檔 §③ 的驗收「order_cancellations 恰一列」**改掉** —— 改成 **零列**。
   理由不是「省事」, 是 §3 丙 那兩個一票否決 + 那一段「這件事該記在哪張表」。
```

---

## 8. 🛑 這份 plan 證不到什麼(誠實寫)

```
· ⛔ ~~**§4 那一格我沒量** …「沒有去看那支函式的 body」~~
  🟢 **那句話過期了**(二輪審 must-fix 4):§4 已經更新 —— 二輪路1 逐行看過
  `pcm_pending_refund_amounts`,而我複核過:它**只算 bank_transfer + cash 兩軌**
  (`20260902030000:87` 逐字 `FROM (VALUES ('bank_transfer'), ('cash')) AS r(rail)`)
  ⇒ **純卡 / 純匯款單全額退完不會被開出待退款** ✅;**而混軌會** ⇒ 整條搬到 §3-ter-2。
  ⚠️ **仍然沒做的**:正式庫那一發唯讀量測(那支函式對 refunded 的單各回幾列)。
· ⛔ ~~**§3-bis 那條稽核鏈我沒查** … 它是上線之後**唯一**還能回答「為什麼被標取消」的東西~~
  🟢 **那句【過度悲觀】, 而新方案順手補掉了那個缺口**(三輪審抓到, 我核過):
  `admin_mark_order_cancelled` 步9(`20260903093000:804-810`)**會寫一列 `admin_audit_log`**,
  `action = 'order.mark_cancelled'`、`actor` = 那個系統身分
  ⇒ 📌 **稽核鏈的主要缺口被【走既有 RPC】這個決定順手解掉了。**
  ⚠️ 而 §3-bis 仍有一半成立:`order_cancellations` 照舊零列(那張表不是記這件事的地方)。

· 🔴 **§3-quater 新增的、我沒查 / 未裁的**(三輪審點名, 照實列):
  ① **正式站今天走 actor 的第幾層** —— repo 與 memory 都說第 1 層(`actor.ts:25-35` 逐字
     「2026-08-25 起 `ADMIN_REQUIRE_REAL_IDENTITY` 已設為 1 並重新部署 ⇒ 第 3 層走不到」),
     🛑 **而那是【紀錄】不是 env 現值**(同檔 `:37-40` 自陳讀不到線上的值)。
     ⇒ 📌 誠實的寫法是「紀錄說走第 1 層」,不是「我沒查」也不是「已確認」。
     🔵 而 §② M1 已經證明:**這一格【不改變那個例外的結論】**(兩層都被 `resolveStaff` 濾掉)。
  ② **③(cron)那條的 RPC 拒絕會不會拖垮什麼** —— ① 那條已經由 codex 答掉(會拖垮退款結案),
     而 ③ 那條**結構上不會**(退款早就 commit)。⇒ 這一格其實是答掉的, 留著當對照。
  ③ ✅ **Q3 已裁 = 加閘, 而且是必要條件**(codex 二輪 must-fix, §3-quater ⑦-bis)——
     ⛔ ~~本行原本寫「仍未裁」~~。🔴 **而剩下的是 Q3′:手動那顆鈕要不要也加**(見 §7)。
  ④ ✅ **掛載點已裁 = ③ cron**(主視窗 2026-09-13,理由在 §3-quater ③)——
     ⛔ ~~本行原本寫「仍未挑」~~, 那在裁完那一刻就過期了。
     🔬 **而這一條是【收尾掃描】抓到的, 不是讀出來的** ——
     我改完 plan 之後對每一個改動主題全檔 grep(掛載點 / is_manager / 甲′ / service_role /
     listActiveStaff / 具名例外), 而「掛載點」那一發撈到這裡。
     ⇒ 📌 **那正是主視窗要我把「檢查」做成【一個動作】而不是【一個提醒】的理由**:
       前三次打架都長得跟現行結論一模一樣 ⇒ **讀一遍抓不到, grep 一次抓得到。**
  ⑤ 🔴🔴 **上游 SSO 對應表 —— 本 plan 答不出來, 而它是【實作前的硬前提】**
     (二輪審·權限 must-fix 1, 2026-09-13):今天走第 1 層 ⇒ 要讓 actor 真的變成
     `refund_closeout`, 需要**上游送出 `sub.staff_id='refund_closeout'`**
     (`api/sso/callback/route.ts:193-201`)。⇒ 📌 **報價站那邊有沒有這個帳號、對應表長什麼樣,
     repo 一個字都答不出來** ⇒ **動手之前要先確認上游發不出這個 sub。**
  ⑥ 🔴 **那道表級 CHECK 要不要做, 本 plan 表態了而沒人裁**(§②-bis):
     本 plan 立場 = **做**(它是唯一 role-independent 的機制)。
     ⚠️ 副作用已寫:`20260726120000:191-197` 那道「應恰有 3 個 CHECK」的斷言,
     重新 baseline 會紅(已 apply 的不會重跑)。⇒ 要主視窗或 Sean 點頭。
  ⑦ ⚠️ **`service_role` 那張表的量法【不完整】**(二輪審·權限 should-fix 4):
     「能寫的 21」只量 INSERT ⇒ **欄級 UPDATE 量不到** ⇒ 它是下界。**沒有重量。**
  ⑧ ⚠️ **`confirm_order_payment` 那一格**(plan 說二審查過)—— 二輪審·權限那一路
     **沒有重查** ⇒ 標**未複驗**。
· 我**沒有**驗證「標成已取消之後, 前台那張單的每一處顯示都正確」——
  交辦檔說狀態膠囊會變,而我沒有實際開瀏覽器看過。
  ⇒ 照 CLAUDE.md:**做完的定義是 Sean 自己開瀏覽器從頭走到尾**, 而那在實作之後。
· 券被呼兩次的冪等我是**讀註解**得知的(Sean 2026-09-11 Q2 甲逐字), **沒有實測**。
  ⇒ 實作時要在事後閘裡證一次, 不要沿用這句。
```
