# Plan — 人工待確認佇列:**完整範圍**(甲 + 乙 + 丙 一次做完)

> 🔴 **Sean 2026-08-19 拍板(逐字,主視窗轉)**:
> **「你安排完整一次做好,不要做一半。這種東西不能做一半然後等到之後忘記再補,寧可花時間做好。
>  如果需要,完整的 DB 權限都可以給你操作。」**
> ⇒ **「先做 A、B 寫進 backlog 之後補」這條路在這件事上【關了】。**
> ⇒ 本檔取代 `docs/specs/2026-08-18-manual-review-queue-has-no-exit-plan.md` §4 的實作範圍
>   (那份的**病理分析仍然有效、留痕不刪**;換掉的是**做什麼**)。
> **狀態:未批。** 命中 **鐵則 8**(跨 3+ 檔、動 schema)+ **鐵則 12 ①錢 ②權限 ③schema** ⇒ 要 Sean 批 + 對抗審查。

> ## 🔴🔴 檔頭警語(2026-08-19 加,**接手的人先讀這段**)
>
> **「`20260819010000` 的斷言群是今晚最強的一套 ⇒ 新版直接繼承、免重驗」這句【作廢】。**
> 它出現在 `~/pcm-mailbox/G4-008-STOP-段落-20260819.md` §0 與 GR 的第二意見裡。
> **錯的不是「繼承」,是「免重驗」** —— 而它具體錯在 **5c 那一格**:
>
> ```
> 5c 斷言(:404-409)要求函式原始碼(去 -- 註解後)含 'AND a.manual_reviewed_at IS NULL'
> 而 96e13bbe 的 C-B 反轉【把那一行從主告警述詞拿掉了】(:144 的刪除註記)
> ⇒ 兩者互斥 ⇒ **這支 migration apply 一定會 RAISE '告警述詞異常 … 拒繼續'**
> ```
> **量到的(唯讀,可重跑)**:
> ```
> $ f=supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
> $ sed -n '104,209p' $f | sed 's/--.*$//' | grep -c "manual_reviewed_at"
> 0     ← get_payment_anomaly_alert_summary 函式體去註解後零命中 ⇒ 5c 必紅
> $ sed -n '104,209p' $f | sed 's/--.*$//' | grep -c "reviewed_unknown_unresolved_count"
> 1     ← 負向對照:同一把尺對該命中的東西會動
> $ sed -n '232,340p' $f | sed 's/--.*$//' | grep -c "manual_reviewed_at"
> 5     ← 字串本身沒打錯,它在【另一支函式】(RPC)裡
> ```
> 🔴 **證據等級:讀檔 + grep 量到的,【沒有】在 PG 上跑過 apply。** 引用本段要帶這個限定。
> 範圍限定:104-209 = `get_payment_anomaly_alert_summary` 函式體(:104 CREATE / :110 LANGUAGE sql)。
>
> 📌 **教訓的形狀**:那句「免重驗」是**對【一群】斷言下的整體評價**,
> 而**壞掉的是其中【一格】** —— 整體評價天生蓋不住單格的反轉。
> ⇒ **繼承時要逐格核,不是逐群核。** 逐格清單見 §13。
>
> ## 🔴 主視窗裁定(2026-08-19,已生效、已落主視窗桌面狀態檔)
> **`20260819010000_m4a_close_manual_review_attempt.sql` 不得被 apply,直到 5c 與 C-B 反轉對齊。**
> Sean 的 apply 清單由主視窗控 ⇒ **這支不會進去。**
> 並裁:**不要改那支 SQL**(在舊形狀上補丁 = Sean 明文關掉的「做一半」);gate 仍是「完整範圍一次做完」。

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
⚠️ **它已經 commit** ⇒ 撤要有動作,不能靠「大家記得不要 apply」。~~**這一格要主視窗裁怎麼撤。**~~
✅ **2026-08-19 已答:撤除機制見 §14**(主視窗裁驗收條件、G4 出設計)。
🔴 **而 §14-0 有一個排序約束**:現在擋住 apply 的是【5c 那個 bug】本身 ⇒
**撤除機制要先立,才准動 5c** —— 否則修好 bug 會靜靜地把它變成可上。

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
⚠️ 「不 apply」需要會被讀到的載體 ⇒ 已在該檔檔頭;~~另請主視窗在待推清單標記~~
✅ 已完成(2026-08-19):主視窗已列進不得-apply 清單並落檔 `memory/project_0818-main-apply-blocklist.md`(含解除條件)
🔴 而那**只擋得住「經過主視窗」的 apply** ⇒ 檔案層的撤除機制仍然要做,見 §14
```
🔴🔴 **2026-08-19 更新:上面引號裡第三句【已作廢】,而它留在這裡是刻意的(留痕不刪)。**
```
「斷言群是今晚最強的一套，新版直接繼承免重驗」
  ↑ 這句作廢。錯的不是「繼承」，是「免重驗」——
    具體錯在 5c 那一格（apply 期斷言 vs C-B 反轉互斥 ⇒ apply 必 RAISE）。
    逐格清單見 §13；量到的數字見檔頭警語。
```
✅ **§11 最後那句「另請主視窗在待推清單標記」= 已完成**(2026-08-19 主視窗三裁之②):
```
主視窗逐字：「20260819010000_m4a_close_manual_review_attempt.sql 不得被 apply,
             直到 5c 與 C-B 反轉對齊。Sean 的 apply 清單由我控 ⇒ 這支不會進去。
            （這句我落成檔,不只留在訊息裡。）」
並裁：**不要改那支 SQL** —— 在舊形狀上補丁 = Sean 明文關掉的「做一半」。
```
⚠️ **而「不要改那支 SQL」與 §6「整支撤掉重寫」不衝突**:
前者說**現在不要動它**,後者說**新 migration 不建立在它之上**。**兩句的動作都是「不碰」。**

## 12. 🔴 非真 DB 不可的那一格(Sean 說「如果需要」,下一班拿這段去要)
```
甲那條 path：settleCharge 回 paid ⇒ 真的收斂成已付款
🔴 而它缺的【不是 DB 權限】，是【TapPay sandbox 的一筆真交易】
⇒ 所以：**不要為了這一格去要 DB 權限** —— 權限給不了它
⇒ 真正要問的是：「甲那條 path 由誰、在什麼環境驗過?」
```

---

## 13. 🔴 繼承 `20260819010000` 時【必改】的三格 —— **逐格,不逐群**

> 由來:主視窗 2026-08-19 三裁之③ ——「斷言群最強 ⇒ 直接繼承免重驗」作廢,**逐字寫明錯在哪一格**。
> 全部由 G4 唯讀量到(讀檔 + grep),**沒有在 PG 上跑過**。引用要帶這個限定。

| # | 位置 | 現況(過期/矛盾) | 繼承時要怎麼改 |
|---|---|---|---|
| **13-1** | `:404-409` apply 期斷言 **5c** | 要求函式體含 `AND a.manual_reviewed_at IS NULL`,而 C-B 反轉已把它拿掉 ⇒ **apply 必 RAISE** | 斷言要**跟著反轉**:改成驗「主告警述詞**不含**該行」+ 驗「`reviewed_unknown_unresolved_count` 在」。🔴 **不要只把 5c 刪掉** —— 刪掉 = 那一格從此沒有守門(照 `docs/patterns/guard-and-instrument-traps.md`) |
| **13-2** | `:210` `COMMENT ON FUNCTION` | 逐字仍寫「`attempt_manual_review_count` 多一條 `manual_reviewed_at IS NULL`」 ⇒ **描述的是已被拿掉的那一行** | COMMENT 改成描述**反轉後**的真實述詞;🔴 並在同一句寫明「unknown **不退出**主告警,可見性靠 `reviewed_unknown_unresolved_count` 的**差值**」 |
| **13-3** | `:151` 註解裡的**不變式** | 宣稱「未檢視數 = 主告警 − unknown 存量,新到一筆 ⇒ 差 0→1」。GR 指出它**會破**;讀 SQL 對上了 | 不變式**不能原樣繼承**。要嘛把兩述詞**重新綁回同源**,要嘛**刪掉這個不變式**改用別的可見性訊號 ⇒ **這是動手寫 code 的第一發**(§10-④) |

### 13-3 的破法(讀 SQL 得到,未實跑)
```
主告警述詞  needs_manual_review AND ( status='pending'
                                     OR (superseded_at IS NOT NULL AND status IN ('charged','released')) )
            AND o.payment_status='unpaid'
unknown 存量 manual_review_outcome='unknown' AND o.payment_status='unpaid'     ← 【不綁 status】

⇒ 一列:outcome='unknown' → 之後被 mark_charge_attempt_charged() 改成 charged 且【無 superseded_at】
   · 在【存量】裡(它只看 outcome + unpaid)
   · 不在【主告警】裡(charged 而沒有 superseded_at ⇒ 兩個分支都不成立)
⇒ 主告警 − 存量 **可以是負的** ⇒ 「新到一筆 ⇒ 差 0→1」在負數的世界裡不成立
```
📌 **這三格共同的形狀**:C-B 反轉只改了**述詞那一行**,
而**指著那一行的三個東西(斷言 / COMMENT / 不變式)一個都沒跟著改**。
⇒ 與 memory `feedback_claimed-sync-but-only-patched-touched-lines` 同族:
**改了被指名那處,沒改指著它的那些紙。**

### 🔴 繼承的方法(不是結論,是動作)
```
新 migration 抄斷言群之前,對【每一格】問一次:
  「這格斷言在描述的那個字面,C-B 反轉之後還在不在?」
量法:sed -n '<函式體起,迄>p' <檔> | sed 's/--.*$//' | grep -c '<斷言要找的字面>'
      —— 每一發都要有【負向對照】(同一把尺對該命中的東西回非 0)
```

---

## 14. 🔴 `20260819010000` 的**撤除機制** —— §6:160「這一格要主視窗裁怎麼撤」的答案

> 由來:主視窗 2026-08-19 轉 G6 must-fix #2 + 就地裁定。
> 主視窗逐字裁**驗收條件**(不裁設計):
> **「假設所有人都忘了這件事,這支還 apply 得下去嗎?答得出『不行,因為 X』才算數,X 要是檔案裡的東西。」**

### 14-0 🔴🔴 先講一件反直覺的:**它現在擋得住,而擋住它的是【那個 bug】**
```
5c 斷言 vs C-B 反轉互斥 ⇒ 現在誰去 apply 都會 RAISE ⇒ 事實上 apply 不下去。
🔴 而【意外不是機制】—— 而且這個意外有一個很壞的性質:
   **§13 要我們修好 5c,而修好 5c 的那一刻,這道意外的閘【自己消失】。**
⇒ 排序約束(不可換):**撤除機制要先立,才准動 5c。**
   否則「修一個 bug」會靜靜地把一支不該上的 migration 變成可上。
```
📌 這正是 memory `feedback_a-guard-on-a-safe-path-is-net-negative` 的反面:
**現在守著的那道閘,沒有人是故意裝的,所以也沒有人會在拆它的時候察覺。**

### 14-1 機制(重用既有慣例,不發明新東西)
```
把那支檔【移出 supabase/migrations/】
  supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql
  → scripts/20260819010000-blocked-until-full-scope.sql   (路徑待定,見 14-3)
```
**為什麼是這個形狀(爬梯子,不是設計)**:
```
· 這條慣例【已經在本 repo 裡】,不是新規矩 ——
  scripts/ 底下現有 20+ 支 .sql(*-down.sql 回退腳本 / *-behavior-probe.sql / *-rollback.sql)
  它們全是【刻意不放進 migrations】的 SQL。量法:
    find . -name '*.sql' -not -path './supabase/migrations/*' -not -path './node_modules/*' | wc -l
· MAIN-052:93 逐字已經寫著同一句:「草稿不進 supabase/migrations/(目錄本身是一道閘)」
⇒ 零新機制、零新腳本、零新 hook。**一次 git mv。**
```

### 14-2 對驗收條件的回答(照主視窗要求的句型)
```
Q:假設所有人都忘了這件事,這支還 apply 得下去嗎?
A:不行 —— 因為 **`supabase db push` 掃的是 `supabase/migrations/`,而這個檔不在那裡。**
  X = 檔案的【位置】,不是任何人的記性、不是註解、不是清單。
```
🔴 **而 X 的前提我【沒有驗過】**:
```
「db push 只讀 supabase/migrations/」= 我從 repo 慣例推出來的,不是量到的。
本 repo 沒有 supabase/config.toml(量法:ls supabase/ ⇒ APPLIED.tsv / migrations / tests)
⇒ 沒有檔案能證明那個路徑是不是可設定的。
🔴 缺的那一道檢查:**在拋棄式環境跑一次 `supabase migration list`(或 db push --dry-run),
   確認移走之後那支【真的從清單裡消失】。** ⇒ 移檔的那一片要附這一發,否則機制只是宣稱。
```

### 14-3 兩個要一起做、否則機制會製造新的洞
```
① 移走之後,舊路徑在 repo 裡有【指著它的紙】(plan 本身 / §11 / §13 / STOP / commit body)
   ⇒ 移的那一發要同時跑:
     bash scripts/literal-sweep.sh '20260819010000_m4a_close_manual_review_attempt.sql'
   逐處改成新路徑。**不改 = 下一個人 test -e 得到「查無」,會讀成「這支被刪了」。**
   (照 `~/.claude/rules/00-work-rules.md` §6-b 第 4 條:寫下「已移走」的同一句必須答出 canonical 在哪。)
② 新檔頭第一段要寫【它為什麼在這裡】+【怎麼放回去】——
   放回去的條件 = 甲+乙+丙 完整範圍就緒(§11 的 gate),**不是「5c 修好了」**。
```

### 14-4 這一片何時做(它不在本輪邊界內)
```
本輪主視窗的邊界:只動 plan 一個 .md,不動任何 .sql。**⇒ 移檔【沒有做】,本節只是設計。**
排序:14-1 移檔  →  §13 修 5c/COMMENT/不變式  →  乙/丙 實作
      ↑ 不可換(理由見 14-0)
⚠️ 而移檔動到 supabase/migrations/ ⇒ 命中鐵則 12③ ⇒ 它自己也要走對抗審查,不是「順手 git mv」。
```
