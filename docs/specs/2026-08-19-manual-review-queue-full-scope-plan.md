# Plan — 人工待確認佇列:**完整範圍**(甲 + 乙 + 丙 一次做完)

> 🔴 **Sean 2026-08-19 拍板(逐字,主視窗轉)**:
> **「你安排完整一次做好,不要做一半。這種東西不能做一半然後等到之後忘記再補,寧可花時間做好。
>  如果需要,完整的 DB 權限都可以給你操作。」**
> ⇒ **「先做 A、B 寫進 backlog 之後補」這條路在這件事上【關了】。**
> ⇒ 本檔取代 `docs/specs/2026-08-18-manual-review-queue-has-no-exit-plan.md` §4 的實作範圍
>   (那份的**病理分析仍然有效、留痕不刪**;換掉的是**做什麼**)。
> **狀態:未批。** 命中 **鐵則 8**(跨 3+ 檔、動 schema)+ **鐵則 12 ①錢 ②權限 ③schema** ⇒ 要 Sean 批 + 對抗審查。

---

## 0. 🔴🔴 先講最重要的一件:**我原本的形狀是錯的,而正確的機器【已經存在】**

我 2026-08-18/19 寫的 `20260819010000` 是這個形狀:
```
close RPC 收一個 p_outcome enum（unknown / not_charged / charged）
⇒ 由【操作者宣告】那筆到底收到錢沒有
```
🔴 **而那是錯的,理由不是「不夠嚴謹」,是【我們不需要人去猜】**:
```
settleCharge（packages/use-cases/src/settle-charge.ts）逐字：
  「三路（callback / webhook / sweeper）+ retry 共呼同一條冪等結算、
    以 **Record API 為唯一權威**（notify 無簽章不可信）」
它的四種結果：paid / failed / pending(reason) / no_attempt
  paid   ⇒ 它自己就把錢收斂完（markCharged → confirm → recordPendingInvoice）= 【甲(補入帳)已經在裡面】
  failed ⇒ 它自己 markFailed = 【釋鎖那條也在裡面】
  pending⇒ Record 查不到 / 查不動 / 驗不過 ⇒ **那才是真正的「還不知道」**
```
⇒ **佇列裡的單,不是「沒人去查」,是【自動查了 8 次都沒查出結果】**
(`settle_attempt_count >= 8` ⇒ `needs_manual_review = true`,`20260615120001:100,210`)。

**⇒ 所以正確的形狀是:那個鈕【不是讓人宣告】,是【讓人再查一次,而且繞過 8 次上限】。**
```
❌ 舊形狀：人看 → 人判斷 → 人宣告 → 系統照著寫
✅ 新形狀：人按 → 系統去問 TapPay → 【TapPay 的答案】決定走哪條路
```
📌 **主視窗那句「問題可能出在【讓人選】這一步本身」是對的,而答案比他想的更好:
不只不該讓人選 —— 那台會查的機器早就在了,而且它已經是這條線的唯一權威。**

⚠️ **而這也解掉了那個「三個選項兩個噴錯、一個通過」的阻力最小路** ——
**因為沒有選項了。** 只有一個動作:**再查一次**。

---

## 1. 範圍(甲 / 乙 / 丙,以及為什麼它們是同一片)

| | 是什麼 | 落在哪 | 新東西還是重用 |
|---|---|---|---|
| **乙** 證據 | 按鈕觸發**伺服器端 TapPay Record 查詢** | 新 admin server action + 窄 RPC | **重用 `settleCharge`**,零新狀態機 |
| **甲** 補入帳 | 查到 `paid` ⇒ 收斂成已付款 | — | **已存在**(`settleCharge` step 5) |
| **丙** 出口 | `pending` 的單去哪、誰看、怎麼收 | 後台一頁清單 + 兩個計數 | 新 UI + 既有告警函式加一欄 |

🔴 **它們是同一片的理由**:乙產生的結果直接決定甲或出口;
**只做乙不做丙** ⇒ 查完仍是 `pending` 的單沒有地方去 ⇒ **佇列還是沒有出口** ⇒ 那就是「做一半」。

---

## 2. 甲:**不做**(它已經在了)—— 而這一格要有人去核,不是我說了算

`settleCharge` step 5 逐字:`markCharged(主軌) → confirm → recordPendingInvoice → paid`。
⇒ **查到真的收了錢,系統本來就會登記它。**
⚠️ **我沒有實跑過那條 path**(它要真的 TapPay 回一個 paid 的 Record)
⇒ **這是【讀 code 得到的結論】,不是量到的。** 審查時請當成待證。

---

## 3. 乙:一支「重查」RPC + 一個 admin action

```
admin_request_manual_settle(p_attempt_id, p_order_id, p_actor, p_reason, p_request_id)
  ① 驗那一列真的在告警述詞裡（逐字對齊 attempt_manual_review_count）
  ② 🔴 把 settle_attempt_count 歸零 + next_settle_at = now()
     —— 這就是「繞過 8 次上限」的全部：讓既有 sweeper/settle 路徑重新看得到它
  ③ 同交易寫 admin_audit_log（action='payment.manual_review.request_settle'，reason 必填）
  ④ 回 {requested: true}
⇒ 🔴 它【不決定任何結果】。結果由隨後的 settleCharge 決定。
```
**然後** admin server action 立刻呼一次 `settleCharge(getSettleChargeDeps(), { orderId })`
(與 `reconcile-actions.ts:101` 同一條路,**逐字重用、零改語意**),把回傳的四種結果顯示給操作者。

🔴 **為什麼要 RPC + action 兩段而不是只做 action**:
`settle_attempt_count` 歸零是**寫 DB**,而 admin 走 `service_role`;
既有設計把 attempts 的寫入**全部收在 SECURITY DEFINER 的窄 RPC 後面**(`service_role` 對該表**零寫權**)。
⇒ **不開表權限**,只多一支窄門。

---

## 4. 丙:出口 —— **`pending` 的單去哪**

```
① 告警函式加第二個計數 manual_review_unresolved_count
   = needs_manual_review AND unpaid AND（尚未有人按過重查，或按過而仍 pending）
   ⇒ 🔴 主告警不動、不移除任何列 —— 新到一筆仍然看得見（差值 0→1）
② 後台一頁清單「人工待確認」：每列顯示
   attempt_id / display_id / 卡多久 / last_settle_error / 上次重查是誰按的、什麼時候、結果是什麼
   ⇒ 那正是 scripts/triage-manual-review-alert.sh 印的東西（既有,不用重新發明欄位）
③ 出口的定義：那一列離開清單，只有兩種方式
   · settleCharge 回 paid  ⇒ 訂單變 paid ⇒ 它不再是 unpaid ⇒ 自然離開
   · settleCharge 回 failed ⇒ attempt 變 failed ⇒ 離開述詞（鎖也釋放，客人可重付）
   🔴 pending ⇒ **它【不會】離開**。它留在清單上，直到查得出結果為止。
   ⇒ **那才是誠實的出口:出口不是「有人按過」,是「查出來了」。**
```
🔴 **這一段是對我前一版最大的修正**:前一版的出口是「有人看過」——
**而「有人看過」不是一個結果,它是一個動作。** 拿動作當出口,就是那個無聲黑洞。

---

## 5. 相依順序(不可換)
```
1. 丙-① 計數（無 UI 也看得到存量）      ← 先做，這樣後面每一步都量得到
2. 乙 RPC + action（重查）              ← 它會開始改變計數
3. 丙-② 清單頁                          ← 有東西可看之後才有意義
4. 甲 只做【核對】不動 code
```

## 6. 要不要 migration
```
乙 RPC          ⇒ 要（新函式 + GRANT + apply 期斷言）
丙-① 計數       ⇒ 要（改 get_payment_anomaly_alert_summary）
丙-② 清單頁     ⇒ 不用（讀既有欄位）
甲              ⇒ 不用
⇒ 一支 migration 可以裝完乙與丙-①
```
🔴 **而 `20260819010000`(已 commit、未 apply)要【整支撤掉重寫】** ——
它的 enum 形狀是錯的,不是修一修就好。**撤法:新 migration 不建立在它之上,而它不要 apply。**
⚠️ **它已經 commit** ⇒ 撤要有動作,不能靠「大家記得不要 apply」。**這一格要主視窗裁怎麼撤。**

## 7. 估時(估,非量到)
```
乙 RPC + 斷言 + 拋棄式 PG 驗       ~60 分
乙 admin action + 測試             ~45 分
丙-① 計數 + 驗                     ~30 分
丙-② 清單頁 + 測試                 ~90 分
甲 核對 + 寫下證據等級             ~20 分
對抗審查（動錢 ⇒ 不降級）+ 折      ~90 分
⇒ 合計 ~5.5 小時（🔴 估的，不是量到的；而 Sean 說「寧可花時間做好」）
```

## 8. 🔴 需要真 DB 的那一格(Sean 說「如果需要」,我只列真的需要的)
```
甲那條 path（settleCharge 回 paid ⇒ 真的收斂成已付款）
⇒ 它要一個【TapPay 真的回 paid 的 Record】才走得到
⇒ 拋棄式 PG 造不出來（那不是 DB 的問題，是 TapPay 那側的回應）
🔴 而【正式庫的 DB 權限也解不了它】—— 需要的是 TapPay sandbox 的一筆真交易，不是 DB 權限
⇒ **所以我【不要】DB 權限。** 我要的是「甲那條 path 由誰在什麼環境驗過」的答案。
```
📌 **我把這一格寫出來,是因為「他給了權限」很容易變成「那就用吧」** ——
而**我這一格真正缺的東西,權限給不了。**

## 9. 誠實揭示
```
· 甲「已經在了」是【讀 code 得到的】，我沒有實跑過那條 path
· 丙-② 清單頁的欄位沿用 triage 腳本，而我【沒有量過】那些欄位在正式庫的實際內容
· settleCharge 重查會不會有副作用（它會 markCharged / confirm）—— 它本來就是這樣設計的，
  而【由後台按鈕觸發】是一個新的呼叫路徑 ⇒ 要對抗審查特別打這一格
· 本 plan 沒有處理「TapPay 永遠查不出來」的極端情況 —— 那種單會永遠留在清單上，
  🔴 而那是【正確的】：它確實還沒有答案。不要為了清單好看而給它一個假出口。
```

---

## 10. 🔴 GR 第二意見(`~/pcm-mailbox/GR-040-…`)折進來的五格 —— 其中一格**推翻了我的全稱句**

### ①🔴 既有出口我盤點漏了一支,**而它正是甲/丙該長的形狀 —— 新設計從它開始,不要從零**
`supabase/migrations/20260624120010_m3_3ds_r1c3_close_released_attempt.sql`
```
COMMENT 逐字：「owner-only 人工結案(SECDEF、search_path='')。
  Sean 取得 TapPay 明確終局(未扣款)後收尾 released attempt：released→failed +
  寫 released_closed_at / released_closed_by / released_close_resolution(三欄成組、滿足 group_chk)」
權限逐字：「REVOKE 5 角色含 payment_confirmer、無 GRANT = owner/postgres only(Phase 1 受控人工流程)」
```
🔴 **我在前一份 plan 寫「全樹只有一處把 `needs_manual_review` 設回 false」= 全稱句,被這一支推翻。**
📌 **它的三個性質正是我們要的**:
```
· 【不讓人宣告】—— 它要求「已取得 TapPay 明確終局」當前提，然後只做狀態收尾
· 【owner-only、一個角色都不 GRANT】—— Phase 1 就是刻意讓它走人工受控流程
· 依據寫成【三欄成組 + CHECK】，不是自由文字備註
```
⚠️ 它**只收 `released`**(其餘狀態一律拒)⇒ **`pending` 那族仍無對應結案 RPC** = 缺口的真正邊界。

### ②🔴 released 族的**對稱缺口**
我的 ⑤-2 只擋 `charged` 宣告 `unknown` ⇒ **`released` 列宣告 `unknown` 照樣過 = 反向的說謊**。
⇒ `not_charged` 要**分 pending / released 兩支**(released 那支就是 ①)。

### ③🔴 指路訊息住在一條**被我自己禁掉的通道**
我在 COMMENT 寫「**API 不得把 DB 例外原文回給前端**」,
而我的指路訊息(「請回報,不要改選 unknown」)**只活在例外原文裡** ⇒ **自相矛盾,操作者永遠看不到。**
⇒ 改成**結構化回傳**(`{ok:false, reason, next}`);RAISE 只留給「不該發生」。

### ④🔴 我自標「未重跑」的 C-B,GR 指出**差值不變式會破**
```
我寫：未檢視數 = attempt_manual_review_count − reviewed_unknown_unresolved_count
而兩述詞【已解綁】⇒ 一列 unknown-closed 之後變 charged 且無 superseded_at
⇒ 它在 unknown 存量裡、不在主告警裡 ⇒ **差值可以變負**
⇒ 「新到一筆 ⇒ 差 0→1」在負數的世界裡不成立
```
⇒ **這是重跑的第一發。** 📌 而教訓是:**標了「未驗」不等於可以宣稱。**

### ⑤ 三份述詞要互釘
`attempt_manual_review_count` / RPC 的 ⑤ / unknown 存量 —— **三處各寫一份**,必須一致。
⇒ 抽成單一 SQL 函式(只寫一次)或加斷言驗三者同源;並進 rule-ledger。

---

## 11. `20260819010000` 的處置 —— **GR 裁「不能單獨上」,而【在哪個標準下】要寫清楚**
```
GR 逐字：「不能單獨上 —— 新標準下它照定義就是做一半」
        「dev commit 不必回退，gate = apply + UI 片等完整範圍」
        「斷言群是今晚最強的一套，新版直接繼承免重驗」
```
🔴 **那個「新標準」= Sean 2026-08-19 的「不准做一半」** ——
**不是**「那支自己有問題」。⇒ **三天後有人看到一顆綠的 commit 卡著,不要以為 gate 可以拆** ——
**gate 的解除條件是【甲+乙+丙 完整範圍就緒】,不是「那支修好了」。**
```
處置：commit 留著（不回退）／【不 apply】／新 migration 不建立在它之上
⚠️ 「不 apply」需要會被讀到的載體 ⇒ 已在該檔檔頭；另請主視窗在待推清單標記
```

## 12. 🔴 非真 DB 不可的那一格(Sean 說「如果需要」,下一班拿這段去要)
```
甲那條 path：settleCharge 回 paid ⇒ 真的收斂成已付款
🔴 而它缺的【不是 DB 權限】，是【TapPay sandbox 的一筆真交易】
⇒ 所以：**不要為了這一格去要 DB 權限** —— 權限給不了它
⇒ 真正要問的是：「甲那條 path 由誰、在什麼環境驗過?」
```
