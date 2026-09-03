# Q10 取消線 片④(enqueue + 後台入口)開工前必讀

> 誰會撞到這一份:`grep -rn order_cancelled` / `grep -rn admin_mark_order_cancelled` 的人。
> 寫這份的理由:片③(模板)已在 dev,而**片④ 停著的理由今天會消失** ——
> Sean 2026-09-03 拍乙(後台一顆鈕、那道閘只放行 `refunded`)⇒ 輸入集合從 0 變成非 0。
> 🛑 本份**只寫交接,零程式碼改動**。

---

## ① 🔴 不要照抄 `order_unpaid_cancelled` 那支 scanner —— 它會安靜地撈到 0

我那條線(`SupabaseUnpaidCancelledOrderScannerAdapter`)的身分判準是**列存在**:
`order_cancellations!inner(order_id)`。**它對片④ 不成立。**

逐字證據 —— `supabase/migrations/20260902140000_m4b_mark_order_cancelled.sql:106`:
```
✗ 不動任何品項數量、不寫 `order_cancellations` / `order_cancellation_items`
```
⇒ 📌 **照抄 ⇒ `!inner` 撈不到任何一列 ⇒ 0 筆 ⇒ 儀表全綠而一封都沒寄。**
⇒ 而那正是片③ 那顆 commit(`3f42a8e4`)修掉的同一個形狀:**做完的線看起來像做完了。**

### 那該用哪一個?三個候選,兩個是陷阱

| 候選 | 今天成不成立 | 🛑 |
|---|---|---|
| `order_cancellations` 那一列 | ❌ **不成立** | 上面 `:106` 明寫不寫 |
| `cancel_items_untouched = true` | ⚠️ 寫得對而**不可靠** | 該欄 COMMENT 逐字「它是一個**約定**, 不是一道閘」—— 今天**沒有 constraint 也沒有 trigger** 擋別的寫入路徑 |
| `payment_status='refunded'` + `cancelled_at IS NOT NULL` | ✅ 今天唯一 | 見下面那句 🛑 |

🛑 **而第三個「唯一」的來源要講清楚,不要當成不變式**:
它唯一,是因為 a8a1 `admin_cancel_order` 的閘把 `payment_status` 卡在 `unpaid` 或 `paid`
(`20260830020000_m4b_e10_cancel_reason_neutral.sql:327` 與 `:424`)—— **`refunded` 進不去**。
📌 ⇒ **救你的是【另一道閘】, 不是你的判準。** 而那道閘不歸你管、改它的人不會來讀這一份。
✅ ⇒ 判別句寫進你的 port 檔頭:
> **「有沒有第二條路能讓一張單同時是 `refunded` 又有 `cancelled_at`?
>   有 ⇒ 我這封信會寄給不該收的人,或漏掉該收的人。」**

## ② 🟢 而有一格是好消息 —— `cancelled_reason` 可以直接印給客人

兩條路寫進 `orders.cancelled_reason` 的**都是對客文字, 不是七值的碼**:
- 新路:`20260902140000:238-247` 的 `CASE p_reason_code WHEN 'customer_request' THEN '依您要求取消'`
- 舊路:`20260830020000:570` COMMENT 逐字「對客文字由 `admin_cancel_order` 依映射表產出、寫進 `orders.cancelled_reason`」

⇒ ✅ 片④ 可以照片③ 的做法原封印出來,**不需要自己再做一次映射**。
⚠️ 而 `other` 那一格是**員工自己打的字**(`:256` `v_reason_txt := v_detail`),
   **會原封進到客人眼前** —— 而「這樣可不可以」**Sean 還沒拍**(與我那條線共用同一題,已在他的下一批)。

## ③ 🔴 開工前先做掉的前置 —— 它今天還沒有人做

`20260902140000:83` 逐字:**「⇒ 處置:片④ 之前要先 bump 那支 view」**
理由:`admin_order_list_v` 是用 `o.*` 建的,PG 建立當下就把 `*` 展開凍結
⇒ **加欄之後那支 view 沒有 `cancel_items_untouched`**。

✅ 我當場量的(2026-09-03):最後真的重建那支 view 的是 `20260901020000`,
   而欄是 `20260902140000` 加的 ⇒ **中間沒有任何一支 migration 重建它** ⇒ **前置仍然開著**。

## ④ 🛑 而片② 的作者交出去的那句話,今天量起來還是 0

他在檔頭寫的是**事實而不是完成式**(逐字「**已交主視窗、尚未落板**」),並留了自檢命令。
✅ 我 2026-09-03 在**主樹**(不是我的 worktree、也不是 `origin/dev`)重跑那一發:
```
grep -c 'cancel_items_untouched\|mark_order_cancelled' docs/launch-todo.md docs/phase-1-backlog.md
⇒ 0 / 0        正對照:同檔 grep 'M-4b' ⇒ 有命中 ⇒ 尺會動
```
📌 ⇒ **一天過去了, 那兩個字面在板上仍然不存在。**
🎯 ⇒ 而他當時就寫對了:「**我交出去了**」與「**它到了**」是兩個宣稱,而他只看得到前者。
⇒ ✅ 所以這一份**不靠 mailbox**:它住在 repo 裡,而它含著你會 grep 的那兩個字面。

## ⑤ 為什麼片④ 的碼今天不先寫

不是「死碼會腐」這種泛稱 —— 是**具體的**:
📌 **今天寫,等於現在就要挑一個身分判準,而上面 ① 說了照抄那個會安靜地回 0。**
⇒ 而挑錯不會紅、不會有測試抓得到(scanner 的分母是它自己那支檔)。
⇒ ✅ 正確順序:**那顆鈕的 RPC 定案 ⇒ 判準跟著它定 ⇒ 才寫 scanner。**

## 未關(不屬於片④,但會撞到)
- `cutoff` 那顆 env(哪一刻之前的舊單不補寄)—— 等 Sean,與 `order_unpaid_cancelled` 共用一題
- `other` 的員工自由文字寄不寄給客人 —— 等 Sean
- `⟦b4-CANCELKINDBYCONTENT⟧`:`orderCancelKindOf` 拿 `cancelled_reason` 的**內容**當身分。
  🔴 而 ② 說了兩條路寫的都是對客文字 ⇒ **片④ 上線後那一欄會有兩個來源而長得一樣**
  ⇒ 那一列在板上(主樹)已開,不要在片④ 裡順手改它。
