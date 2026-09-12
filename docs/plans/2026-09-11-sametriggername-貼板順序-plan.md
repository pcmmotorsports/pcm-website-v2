# plan · ⟦db-SAMETRIGGERNAME⟧ 貼板順序 · 2026-09-11 · 窗 C

> 鐵則 8(動 schema ⇒ 先寫 plan 等批)。**本份零寫入、零貼板。**
> Sean 2026-09-11 拍 Q1 甲逐字:「裁順序、改其中一支的名字, 兩支分開貼」。
> 🔴 **而下面第三節會說明:【改名】那一半我建議不要做,而且理由不是風格是錢。**

---

## 一、① 那兩支是誰(逐字)

```
A  supabase/migrations/20260901021000_m4b_coupon_p3b_create_order_redeem.sql
B  supabase/migrations/20260901030000_m4b_zero_total_settle.sql

撞到的 trigger 名(逐字)  trg_coupon_redeem_on_paid
掛在                      public.orders     事件 AFTER UPDATE OF payment_status

A:771  DROP TRIGGER IF EXISTS trg_coupon_redeem_on_paid ON public.orders;
A:772  CREATE TRIGGER trg_coupon_redeem_on_paid
B:764  DROP TRIGGER IF EXISTS trg_coupon_redeem_on_paid ON public.orders;
B:765  CREATE TRIGGER trg_coupon_redeem_on_paid

函式那一半(這才是真的相依):
A:466  CREATE FUNCTION public.coupon_redeem_on_paid()              ← 裸的, 沒有 OR REPLACE
B:455  CREATE OR REPLACE FUNCTION public.coupon_redeem_on_paid()   ← 有 OR REPLACE
```

⚠️ **兩支檔頭自己引用的行號都舊了 3 行**(檔頭寫 `:463` / `:761` / `:762`,實際 `:466` / `:764` / `:765`)。
　 不影響結論,而**下一個人照檔頭去翻會翻到別的地方**。

---

## 二、② 順序:**A 先、B 後**。而理由不是檔名日期

```
🔴 決定順序的是【函式】不是【trigger】:
   A 是裸 CREATE FUNCTION ⇒ 它要求那支函式【當下不存在】
   B 是 CREATE OR REPLACE  ⇒ 它兩種世界都活得下去
   ⇒ A → B  ✅ A 建, B 換掉本體(B 多一段 IF NEW.total = 0 THEN RAISE … P2C01)
   ⇒ B → A  ❌ A 會噴「函式已存在」而整個交易 abort
   ⇒ 📌 只有【一個】順序貼得過, 所以這不是偏好, 是唯一解。

🔵 而 trigger 那一半【與順序無關】:
   兩支的 CREATE TRIGGER 前面各自都有 DROP TRIGGER IF EXISTS(同名)
   ⇒ 後貼的那支會先把前一支的拆掉再建自己的 ⇒ 撞名自己會癒合。
```

---

## 三、🔴 而 Sean 那句「改其中一支的名字」——**我建議不要做,它會開一個錢的洞**

如果把 B 的 trigger 改名(例如 `trg_coupon_redeem_on_paid_v2`),連 B 自己那句 `DROP TRIGGER IF EXISTS` 也要跟著改名,於是:

```
B 的 DROP 不再指向 A 建的那一支 ⇒ A 的 trigger【留著】
⇒ public.orders 上同時有兩支 trigger
   trg_coupon_redeem_on_paid      (A 建)
   trg_coupon_redeem_on_paid_v2   (B 建)
   同一個事件 AFTER UPDATE OF payment_status · 同一個 WHEN · 綁【同一支函式】
⇒ 🔴 一次付款成立, 扣券的函式被叫【兩次】。
```

> 🔴🔴 **2026-09-12 訂正(Fable 唯讀審抓到, `-a2` 複驗成立)**:被叫兩次**不等於扣兩次**。
> `redeem_coupon`(`20260831160000:242-249`)對同一張單同券同人同折抵會**早退、不再 INSERT**,
> 加上 `coupon_redemptions_one_per_order UNIQUE (order_id)`(`20260829150000:182`)⇒ **第二支是 no-op**
> (折抵對不上才丟例外)。⇒ 📌 **「不要改名」的結論不變, 而理由要換**:那個「沒扣兩次」靠的是
> **別支函式的冪等**, 而兩支檔的自檢只用 `tgname` 查自己那一支 ⇒ 多出來的那一支沒有人叫得出來。

🛑 **而沒有任何一道閘會叫**:兩支檔的 fail-closed 自檢(A`:836-900` / B 同段)只問
「**我這一支在不在、綁對函式沒、定義對不對**」,**沒有一句在問「這張表上是不是只有一支」**
(我對兩段各 grep 過 `count` / `唯一` / `<> 1` ⇒ **零命中**)。

> 🎯 **形狀**:「兩支 migration 建同一個 trigger 名」是一個**真的問題陳述**,
> 而「改名」是它字面上的解 —— **它解的是名字,而真正咬人的從來不是名字,是那支裸的 `CREATE FUNCTION`。**
> 📌 改名不但沒解到,還把一個**自己會癒合**的撞名,換成一個**沒有人在守**的重複扣券。

✅ **⇒ 建議:Q1 甲的「裁順序」照做(A → B),「改名」那一半撤掉。**
　 這需要 Sean 或 59 再點一次頭 —— 我不替他改他的拍板。

---

## 四、④ 正式庫今天的樣子(唯讀實量)

`pcm_readonly` @ 正式庫 · `bash scripts/readonly-prod-sql.sh` · **rc=0 · 真錯誤 0 格** · `2026-09-10 16:53:33 UTC`

```
(2)  trg_coupon_redeem_on_paid 在 public.orders 上 ⇒ 0 支      ← 兩支都還沒貼, 吻合
(2b) ⚪ 負對照 現造 trigger 名 ⇒ 0                              ← 尺不亂命中
(3)  coupon_redeem_on_paid()            ⇒ 不在
     coupon_revert_on_full_refund(uuid) ⇒ 不在
     settle_zero_total_order(uuid)      ⇒ 不在
     ⚪ 負對照 zzq_negctl_fn_0911(uuid)  ⇒ 不在
(4)  🟢 正對照 admin_compute_order_settlement(uuid) ⇒ 【在】
     ⇒ 📌 (3) 那把尺不是恆 NULL —— 沒有 (4) 這一格, (3) 的四個空白證不到任何事
```

**(1) 順手關掉板上自標「沒查」的那一格 —— `public.orders` 上現有的 trigger 全表:**
```
order_pending_refund_open_au                pcm_pending_refund_on_cancel()          O
orders_freeze_shipping_snapshot_bi          orders_freeze_shipping_snapshot()       O
pcm_e13_orders_subtotal_guard               pcm_e13_subtotal_guard()                O
pcm_orders_delete_audit_ad                  pcm_log_order_row_delete()              O
zzz_pcm_invoice_requested_false_is_final    pcm_invoice_requested_false_is_final()  A
⇒ 五支, 沒有一支是 AFTER UPDATE OF payment_status ⇒ 【沒有別的 trigger 會跟它搶那個事件】
```
⚠️ 而順手看到、**不是本列的事,交出去不自己動**:那五支裡 **四支 `tgenabled = 'O'`**,
　 而 A/B 兩支檔自己的自檢**要求它那一支必須是 `'A'`**(理由寫在檔裡:`'O'` 在
　 `session_replication_role=replica` 之下整支被跳過)。⇒ 📌 **同一張表上兩套標準,沒有人裁過。**

---

## 五、🔴 而最要緊的一格:**這兩支今天【誰先誰後都貼不下去】**

兩支檔各有一道 fail-closed 前置閘(A`:311-315` / B`:375-379`),它要求
`public.coupon_revert_on_full_refund(pg_catalog.uuid)` **存在且是 function**,否則 `RAISE EXCEPTION`。

```
repo:  grep -rn "coupon_revert_on_full_refund" --include="*.sql" supabase/
       ⇒ 命中 2 檔, 而【兩檔都只是提到它】, 沒有任何一支 CREATE 它
       ⚪ 負對照 現造字串 ⇒ 0 檔   🟢 正對照 coupon_redeem_on_paid ⇒ 6 檔
正式庫: to_regprocedure(...) ⇒ 不在(見上節 (3), 而 (4) 證明那把尺會動)
```
⚠️ **而我第一次跑那個 grep 時忘了替 `--include="*.sql"` 加引號** ⇒ zsh 展不開 ⇒ 印
　 `no matches found` 加「命中 0 檔」⇒ 📌 **一個【設定錯】印成了一個【查無】。** 加引號重跑才有上面的數字。

🎯 **⇒ 所以本列真正的關閉條件不是「排好順序」,是【先有人建那支退券函式】。**
　 排順序這件事今天做完是對的(答案要寫進檔頭,見下節),而**它不會讓那兩支變得貼得下去**。

---

## 六、要改什麼 / 影響 / rollback

**改什麼**(本 plan 批准後才動,而且只動註解):
```
在 A 與 B 兩支的【檔頭】各補一段(關閉條件② 逐字要求「答案要寫進貼板那兩支的檔頭」):
  · 順序 A → B, 唯一解, 理由 = A 是裸 CREATE FUNCTION
  · 撞名自己會癒合(兩支都帶 DROP TRIGGER IF EXISTS)⇒ 🛑 不要改名, 改名會變成兩支 trigger 重複扣券
  · 前置 coupon_revert_on_full_refund(uuid) 今天不存在 ⇒ 兩支都貼不下去
  · 順手訂正檔頭舊了 3 行的那三個行號
  · B 檔頭那句「WHEN 是 OLD.payment_status = 'unpaid' ⇒ partiallyPaid 被排除」6e 09-10 量到已不真
    (實際 IN ('unpaid','partiallyPaid'))而它沒有被劃掉 ⇒ 一併劃掉
```
**影響**:只動 `--` 註解,**零 SQL 語句變動** ⇒ 對正式庫零影響;對「下一個排貼板順序的人」影響最大。
**rollback**:`git revert` 那一顆即可(純註解,無 DB 狀態)。
**風險**:低。而**真正的風險在【不做】** —— 今天沒有任何一個地方寫著「不要改名」。

---

## 七、🛑 我證不到什麼

1. **我沒有實跑過那兩支**(拋棄式 PG 也沒跑)。上面「B → A 會噴函式已存在」是**讀 SQL 語意推的**,不是跑出來的讀數。
2. **「改名會變成兩支 trigger」同樣是推的** —— 依據是兩支檔的 `DROP` 各自指名、且自檢無唯一性斷言(這兩格是實際 grep 到的),**而我沒有真的建兩支 trigger 跑一次付款**。
3. 兩支的**函式本體差異**我沿用 6e 2026-09-10 的靜態比對(582 token 中 202 不同),**我沒有自己重跑**。
4. 讀數是這一發的;`public.orders` 上的 trigger 會被別的 migration 改。
