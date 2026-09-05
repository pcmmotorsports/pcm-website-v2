# Plan:`⟦b4-NCPCRONRACE⟧` —— 讓 cron 取消與收款落帳**互相看得見**

> ## 🔴🔴🔴 **codex 關卡 1 = FAIL(6 must-fix)。兩案【都被推翻】,而真正的修法在第三個地方。**
>
> ### 🛑 甲(共用鎖)**沒有消除壞結果** —— 這是最重的那一條
> ```
> A 拿 orders 那一列的 FOR UPDATE
> B 的 INSERT 要 FK KEY SHARE 在同一列 ⇒ 🔴 B 卡在【列鎖】, 根本還沒走到 advisory
> A COMMIT(單變成已取消)⇒ B 解除阻塞 ⇒ advisory 沒有人跟它搶, 一拿就到
> ⇒ B 照樣把錢記下去 ⇒ 📌 **結果還是「已取消 + 有收款」。**
> ```
> 🔬 **而決定性的那一格是我去讀碼才看到的**:`pcm_noncard_settle_recompute` 拿到鎖之後
> 　 **【沒有重讀 `cancelled_at`】** —— 它只讀 `payment_status`。
> 　 ⚠️ 我第一發用 `prosrc LIKE '%cancelled_at%'` 問正式庫 ⇒ **t** ⇒ 差點判「它有檢查」;
> 　 　 而那個 t 是**註解命中**(:315 一行說明文字)。**剝掉註解再問 ⇒ f。**
> 　 ⇒ 📌 **「註解被 grep 當成碼」而它剛好落在整案的樞紐上。**
> ⇒ 🎯 **所以鎖不是解方。** 排隊只是讓 B 晚一點做同一件錯事 ——
> 　 **除非 B 在拿到鎖之後【重讀 `cancelled_at` 並放棄】。那一句才是修法。**
>
> ### 🛑 乙(樂觀 WHERE 重驗)**幾乎沒有新增保護**
> 同一句 `UPDATE` 共用**命令開始時的 snapshot** ⇒ 第二次查 `order_payments`
> **仍然看不到命令執行期間才 commit 的付款**(READ COMMITTED)。
> ⇒ 🔴 我寫「窗口變小而洞仍在」—— **窗口幾乎沒有變小。**
>
> ### 🔴 而我在本檔裡寫錯三個可查的字面(codex 逐條指出, 我逐條實量確認)
> ```
> ① 函式在 pcm_cron 不在 public      ⇒ 實量 pcm_cron.expire_unpaid_orders
> ② 逾期取消排程是【每小時】不是每 10 分鐘 ⇒ 實量 0 * * * *(*/10 那個是 pcm-settle-retry)
> ③ 「兩案在錢不會不見上沒有差別」   ⇒ 我把【網存在】讀成【網有效】;
>    `pcm_pending_refund_open_for` 失敗會被記 log 吞掉 ⇒ 那個等號不成立
> ```
> 📌 **三個都是我讀了碼之後寫的,而三個都錯。** ⇒ 讀過 ≠ 讀對。
>
> ### ✅ 下一版要從哪裡開始(不是本檔的兩案)
> **在 `pcm_noncard_settle_recompute` 拿到 advisory 之後,重讀 `orders.cancelled_at`;
> 　 已取消 ⇒ 不翻 `payment_status`,改走「開待退款」那條路。**
> 🔵 它不需要動 cron 那半、不動鎖、不改 `SKIP LOCKED` 語意 ⇒ **爆炸半徑最小的那一個。**
> 🛑 **而它需要自己的一份 plan** —— 尤其這一格:「已取消而錢進來了」的**最終狀態該長什麼樣**
> 　 (codex 說的第四個必答:**各時序的最終狀態與驗收不變式到底要保證什麼**)——
> 　 **那是一個生意問題,不是工程判斷。**
>
> ### §5③ 已量(唯讀正式庫)
> `max_locks_per_transaction = 64`(default)· `max_connections = 60` · `max_prepared_transactions = 0`
> ⇒ 共享鎖表 **3840 格**;此刻實際用掉 **2 格**(advisory 0)。
> ⚠️ codex 更正我:**那不是單一交易的硬上限**,是共享表的平均預算 ⇒ 單一交易可以超過 64。
> ⇒ 📌 **所以「500 會不會爆」不能只看 64** —— 而**這一格在兩案都被推翻之後已經不重要了**。
>
> ---
> **以下是被推翻的原文,逐字留著。** 舊字面留著的理由:它記著我當時的推理,而下一個人會走同一條路。

> 派工:主視窗 `-f8` 2026-09-05 晚上。鐵則 8(動 schema/共用函式)+ 鐵則 12①③(錢 · DB 結構)。
> **本 plan 只到 codex 關卡 1 一輪,不動碼。**
> 📎 前一份 `docs/plans/2026-09-05-ncp-cron-race-lock-plan.md` 判「不做」——
> 🔴 **而它判的是【一個特定的拿鎖順序】,不是「共用鎖」這個方向。** 本檔把那件事說清楚(§4)。

## 0. 前置:那兩支到底貼了沒(2026-09-05 唯讀實量,不是引用)

```
板列 :335 誰欄那句判法逐字:
  SELECT prosrc LIKE '%pcm_pending_refund_open_for%' FROM pg_proc
   WHERE proname='pcm_noncard_settle_recompute'          ⇒ 【t】
語意特徵(不比字面, 問它做得到什麼):
  20260904230000  pcm_noncard_settle_recompute 函式在        ⇒ 1
                  order_payments 上 pcm_noncard_settle_after_payment_ai trigger 掛著 ⇒ 1
  20260905070000  pcm_pending_refund_open_for 函式在          ⇒ 1
                  orders 上 order_pending_refund_open_au trigger 掛著 ⇒ 1
🟢 正對照 pcm_settle_retry_sweep ⇒ 1   🔵 負對照 編造函式名 ⇒ 0
```
⇒ ✅ **兩支都在。誰欄那句「等 Sean 貼」的條件【到了】。**

## 1. 病灶:兩端拿的是【兩把不同的鎖】

```
A  cron 逾期取消  public.expire_unpaid_orders
     :493  FOR UPDATE OF o SKIP LOCKED        ← orders 那一列的【列鎖】
     :495  UPDATE orders SET cancelled_at = now()

B  收款落帳      public.pcm_noncard_settle_recompute(由 order_payments AFTER INSERT trigger 叫)
     :201  PERFORM pg_advisory_xact_lock(hashtextextended(p_order_id::text, 0))   ← 【advisory】
     :204  SELECT payment_status FROM orders WHERE id = p_order_id
```
🔴 **兩把鎖互不相干** ⇒ A 與 B 可以同時進到自己的臨界區。
⇒ 📌 **「已取消而錢在裡面」就是從這裡來的**:B 讀 orders 時 A 還沒 COMMIT ⇒ B 看到「還沒取消」⇒
　 B 照樣把錢記成收齊;而 A 隨後把單標成取消。

### 🔵 而 B 為什麼不用列鎖 —— 那是【刻意的】,不要「順手改成一致」
`20260904230000:198-199` 逐字:
> 用 advisory 而不是 `SELECT … FOR UPDATE`:後者是**鎖升級**(那筆 INSERT 的 FK 已對同一列持有 KEY SHARE)⇒ 會死結。

⇒ 🛑 **B 改成列鎖 = 已知會死結。那條路已經被關掉了,不要重開。**

## 2. 兩案

### 甲:讓 A **也**拿那把 advisory(共用同一把鎖)
```
A 的順序:  FOR UPDATE OF o SKIP LOCKED  ⇒  對選中的每一列 pg_advisory_xact_lock(同一把鍵)  ⇒  UPDATE
```
- ✅ 兩端從此**排隊**:B 進臨界區時 A 一定已經 COMMIT 或還沒開始。
- ✅ B **一個字都不用改** ⇒ 收款那條路的風險為零。
- 🔬 **而拿鎖順序是這一案的全部** —— 2026-09-05 拋棄式 PG 實測(真實形狀:`orders`+`order_payments` FK + trigger 內拿 advisory):
```
FOR UPDATE → advisory(本案)        ⇒ 【0 死結】
advisory → FOR UPDATE(反過來)      ⇒ 🔴 1 死結, 而 PostgreSQL 殺掉的是 B(客人的付款)
```
- 🔴 **那個實測【不是本案的驗收】** —— 它跑在同形 fixture 上,不是真的 `expire_unpaid_orders`。
　 ⇒ 動手前要用**真函式**重跑四張鎖圖(A 先 / B 先 / 交叉 / 同時)。
- ⚠️ 代價:`SKIP LOCKED` 的語意會變 —— 列鎖跳過了,advisory **不會跳過**(`pg_advisory_xact_lock` 是等待版)。
　 ⇒ 要用 `pg_try_advisory_xact_lock`,拿不到就**這一輪跳過那一列**,維持「cron 不等人」。
　 🔴 **而那會讓一張正在收款的單【這一輪不被取消】** —— 那是對的行為,但**它是一個新的不變式**,要寫進註解與斷言。

### 乙:樂觀 —— 把「重驗一次有沒有收款」放進取消那句 UPDATE 的 WHERE
```
UPDATE orders o SET cancelled_at = now() … FROM target t
 WHERE o.id = t.id
   AND (SELECT coalesce(sum(p.amount),0) FROM order_payments p WHERE p.order_id = o.id) <= 0   ← 重驗
```
- ✅ 完全不動鎖 ⇒ 零死結風險,零 `SKIP LOCKED` 語意改變。
- ✅ 改動最小(一個 WHERE 子句),而它與現有 CTE 是同一句 SQL。
- 🔴 **它擋不住「UPDATE 之後才落帳」那一段**:B 在 A 的 UPDATE 已經寫下去、還沒 COMMIT 之後才 INSERT
　 ⇒ 那筆 INSERT 讀不到 A 未提交的 `cancelled_at`(READ COMMITTED)⇒ **同一個洞仍在,只是窗口變小。**
- 🔵 **窗口小多少我沒量** —— 那要在真環境量 A 的 UPDATE 到 COMMIT 之間有多長。

## 3. 推薦:**甲**,而理由不是「比較徹底」

📌 **乙 把一個競態換成一個更短的競態,而【短的競態沒有訊號】。**
今天「已取消而錢在裡面」還有 `pcm_pending_refund_open_for` 那條網接住(070000 已貼);
而乙 之後剩下的那個窗口**一樣會落進那張網** ⇒ 兩案在「錢不會不見」這件事上**沒有差別**。
⇒ 🔴 **差別在:甲 讓那張網【幾乎不會被用到】,乙 讓它【繼續是主要防線】。**
　 而一張常態被用到的網,它的誤動作率就是我們的日常。

🛑 **而甲 有一格今天沒有答案**:`pg_try_advisory_xact_lock` 拿不到就跳過 ⇒
　 **一張單可能連續好幾輪都被跳過**(每 10 分鐘一輪,而收款是瞬間的 ⇒ 機率極低但非零)。
　 ⇒ 要不要加「連續跳過 N 輪就告警」是**另一片**,不在本 plan。

## 4. 🔴 與前一份 plan 的關係(不要讀成互相矛盾)

```
前一份判「不做」的是:A 先拿 advisory、再拿列鎖   ⇒ 實測【死結, 殺掉 B】
本 plan 的甲 是:      A 先拿列鎖、再拿 advisory   ⇒ 實測【0 死結】
```
📌 **兩者只差一個順序,而結論相反。** 前一份的標題寫「本 plan 的做法不做」——
🔴 **而我當時把它寫成「共用鎖這條路不做」,那個射程太寬。** 舊字面留在那一份裡,本節是它的訂正。
⇒ 🛑 **一個結論的射程,要跟著它的實驗條件走。** 我那次的實驗只否證了一個順序。

## 5. 動手前必答(而它們今天都沒有答案)

1. **四張鎖圖用【真函式】重跑** —— fixture 證不到真的 `expire_unpaid_orders`(它有 CTE + SKIP LOCKED + 批次)。
2. **`pg_try_advisory_xact_lock` 拿不到的那一輪,`SKIP LOCKED` 的計數怎麼回報** ——
   今天那支函式回傳「取消了幾張」,而「因為拿不到鎖而跳過幾張」**沒有地方放**。
3. **A 一輪持鎖多久** —— 批次上限 500 張,每張一把 advisory ⇒ 那一輪會持有 500 把。
   `max_locks_per_transaction` 夠不夠?(advisory 鎖走的是同一個 lock table)⇒ **這一格我沒量過。**

## 6. 🛑 這份 plan 證不到什麼

- 它沒有量過「這件事今天發生過幾次」—— `orders` 全表今天 1 張單 ⇒ **分母答不出來**,不要拿 0 當證據。
- 它沒有動碼,也沒有跑過真函式的鎖圖 ⇒ **§2 甲 的「0 死結」是 fixture 上的讀數**。
- 🔴 它假設 `pcm_pending_refund_open_for` 那張網今天是活的(070000 已貼、trigger 掛著 ⇒ 實量 1),
  **而那張網有沒有真的接住過一次,沒有人量過。**
