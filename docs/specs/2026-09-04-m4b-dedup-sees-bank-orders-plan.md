# Plan · 讓 dedup 看得見匯款單(⟦b4-BANKORDERINVISIBLE⟧ 的根因修法)

> 🔵 **授權**:主視窗 2026-09-04 拍甲 —— 「真正的修法 = 修 dedup 述詞, 排在分岔之前。那是你的下一片。」
> 🔴 **片型 = 高風險片**:鐵則 12①(錢:雙重付款)+ 12③(改 `SECURITY DEFINER` 函式)⇒ 對抗審查不降級。
> 🛑 **本 plan 寫作期間【零改碼】。**
> 📎 **前情**:同一個洞我先前提過兩份 plan(就地收窄 / 改名藏起來), **兩份都被獨立的理由打死** ——
>    而那兩條教訓已搬進板列 `⟦b4-BANKORDERINVISIBLE⟧`, 不在本檔重複。
>    🎯 **本片是那兩輪之後認出來的【對的題目】。**

---

## 0. 根因一句(而它有三個受詞)

```
三處都用「有沒有 payment_charge_attempts」當「有沒有進行中的單」的代理,
而**一條正確的匯款流程不會建立卡片 attempt** ⇒ 那些述詞對匯款單一律為假。
```
| # | 受詞 | 座標 | 現在對匯款單回什麼 |
|---|---|---|---|
| ① | `begin_charge_attempt` 的 cart dedup | `20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql:441-445` | **撈不到** ⇒ 放行 ⇒ 🔴 一張刷卡付掉、一張等匯款 |
| ② | `find_active_sibling_own` | 同檔 `:336-344` | 回 `none` ⇒ preflight 直接 `proceed` |
| ③ | `reconcileCartSession` | `apps/storefront/src/app/checkout/reconcile-actions.ts:81-84` | 回 `pending` ⇒ 客人撈不回自己那張單 |

🔬 ①的述詞逐字:`a.status='charged' OR o.payment_status='paid' OR (a.status='pending' AND o.payment_status<>'paid')`
⇒ 匯款單 = unpaid + 零 attempt ⇒ **三支全假**。

---

## 1. 🔴🔴 而這一片的核心不是述詞, 是**一題沒有人拍過的業務題**

改述詞讓它「看得見」很小(多一個 OR)。**難的是【看見之後要做什麼】。**

```
🔬 begin_charge_attempt 撈到 sibling 之後只有兩個出口(同檔 :449-465 逐字):
   · sibling 已 paid          ⇒ reason = 'duplicate'    ⇒ client 顯既有單
   · charged/pending 未 paid  ⇒ reason = 'needs_settle' ⇒ 上層跑 settleCharge 向 TapPay 即時裁決
🛑 **而匯款單兩個都不合**:
   · 它不是 paid ⇒ 不是 duplicate
   · 🔴 它**沒有 rec_trade_id 也沒有 bank_transaction_id**(兩個都 NULL)
     ⇒ 把它餵進 settleCharge = 拿一張沒有卡片交易的單去問 TapPay「這筆刷成功了嗎」
     ⇒ 📌 **那不是一個比較差的答案, 那是一個沒有意義的問題。**
```
🎯 **⇒ 所以「看得見」必須配一個【第三種出口】, 而那個出口長什麼樣是業務決定, 不是我能拍的。**

### ⇒ 要 Sean 拍的那一題(一個字回得完)
```
Q: 客人有一張【還沒匯款】的訂單, 而他現在想用刷卡付同一車東西, 系統該怎麼辦
A: 甲|乙|丙
甲 = 擋住他, 顯示那張匯款單(「你已經有一張待匯款的訂單」)
乙 = 讓他刷卡, 而**自動把那張匯款單取消**
丙 = 讓他刷卡, 不動那張匯款單(等它 5 天自動過期)
```
🔵 **我推乙**, 三句:
```
① 丙 **會把我們正在修的那個洞原樣造回來** —— 兩張單並存, 而他可能兩邊都付
② 甲 把客人關在門外最長 5 天, 而他做的事完全合理(改變主意)
③ 乙 的動作在系統裡**已經存在**:未付款單的取消是既有能力
   ⚠️ 而**「未付款匯款單的自動取消要不要開待退款」沒有人拍過** ——
     🔬 09-01 那筆拍板(已收款取消 ⇒ 自動開待退款)講的是**刷卡世界**
     ⇒ 未付款 = 沒收到錢 ⇒ 照理零退款, 而**那是我的推論不是他的拍板** ⇒ 一起端他
```
🛑 **而本 plan 在他拍板之前【不動 ①】** —— 述詞改了而出口沒定義, 等於把客人送進一條沒有終點的路。

---

## 2. 而 ② ③ 兩個受詞**不必等那題**, 它們可以先做

```
② find_active_sibling_own ⇒ 讓它回一個新 kind:'bank_pending'(帶 displayId)
   ⛔ ~~原句:「preflight 不 release、不 settle、**回 hold**」「它不製造新的業務決定」~~ **作廢。**
   ✅ **preflight 回 `proceed`(讓他刷卡)** —— Sean 2026-09-04 追加拍板 Q-改付款 逐字
     「乙 讓他刷卡, 而自動把那張匯款單取消」。**不 release、不 settle 照舊成立。**
   🔬 **而 hold 在客人那端是什麼, 我開檔量過**:`charge-actions.ts:295-298` 回
     `{ ok:false, payment:'processing', message: MSG.settlementRequired }`,同檔 `:92` 逐字
     「訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認」+ 註解「不建新單、保留 cart」「鎖死按鈕」
     ⇒ 🛑 **那是【擋住他】= 甲, 而 Sean 拍的是乙。**
   🔴 **為什麼原句會錯**:我寫它的時候「那條路上客人沒有在刷卡」是真的 ——
     ⇒ 📌 **而 Sean 的拍板改變了那條路上會有誰。一個在提問當下為真的前提, 可以被那個問題的答案推翻。**
     ⇒ ⇒ 🛑 **而它不會自己叫** —— plan 那時已經被批准了, 而**批准不會回頭重讀它的前提**。
③ reconcileCartSession ⇒ 同一個 'bank_pending' ⇒ 回 { status:'pendingTransfer', displayId }
   ✅ 這正好把「建單後回應掉了 ⇒ 客人撈不回那張單」補起來(⟦b4-BANKORDERINVISIBLE⟧ 第三個受詞)
```
🎯 **⇒ 所以本片建議拆成兩步, 而拆點不是體積, 是【要不要等 Sean】**:
```
片 A(本 plan, 不等人):② + ③ —— 讓匯款單【被看見】而不改變任何刷卡行為
片 B(等 Sean 拍那題):① —— 讓刷卡那條路知道要拿它怎麼辦
```
🛑 **而拆開的代價要明寫**:片 A 做完之後, **① 那個雙重付款的洞【還在】** ——
   ⇒ 📌 **所以 `BANK_TRANSFER_CHECKOUT_ENABLED` 在片 B 之前一樣不得翻 true。** 板列那三條不變。

---

## 3. 影響面 / 這一片最危險的地方

```
🔴 `find_active_sibling_own` 與 `begin_charge_attempt` 是**刷卡那條路的心臟** ——
   它們今天在收錢, 而我要動的是它們的 WHERE。
⇒ ✅ **所以片 A 的第一驗收不是「匯款看得見」, 是【刷卡那條路一個字都沒變】。**
🔬 而「沒變」要用突變證:
   拿掉我新加的那個 OR 分支 ⇒ **匯款那格必須紅, 而刷卡的每一格必須全綠**
   ⇒ 🛑 若刷卡也跟著紅 ⇒ 那不是共用, 那是我動到了原本的述詞
```
⚠️ **而 ② 是 `SECURITY DEFINER` + `SET search_path=''`** ⇒ 改它要照
   `docs/patterns/revoking-function-execute-in-supabase.md` 的紀律(ACL 保留、`CREATE OR REPLACE` 同簽名)。

---

## 4. 驗收條件(逐條 yes/no)

```
□ 1. 造一張匯款單(unpaid + 零 attempt)⇒ find_active_sibling_own 回 'bank_pending' 而不是 'none'
□ 2. 🟢 正對照:造一張刷卡在途單 ⇒ 仍然回 'active'(舊行為逐字不變)
□ 3. 🟢 正對照:什麼都沒有 ⇒ 仍然回 'none'
□ 4. 🔴 突變:拿掉新加的 OR ⇒ 第 1 格紅, 而第 2、3 格**必須全綠**
□ 5. reconcileCartSession 對匯款單回 pendingTransfer + displayId(不是 pending)
□ 6. 刷卡端到端:既有測試**零修改**通過
□ 7. 三綠(TURBO_FORCE=1)+ **全套 `--maxWorkers=2`** 連跑兩發比四個數
     🔴 `--maxWorkers=2` 的理由:全套現在會隨機紅(`-db` 已定位兩個家族)——
        少了它我會拿一個隨機紅去判自己的片, **而誤判方向是往「我弄壞了」偏**
□ 8. 🔴 這支 migration 要自帶前置閘與事後斷言(照 A 那支的形狀:改之前先驗它是我讀過的那一版)
```

---

## 5. 我沒查的(明寫)

```
🛑 `settleCharge` 收到一張零 attempt 的單現在確切回什麼 —— 我讀了它有 'no_attempt' 分支, **沒實跑**
🛑 新 kind 'bank_pending' 對既有 TS 型別的爆炸半徑 —— 沒盤(SiblingLookupResult 是判別式聯集, 加一格會讓窮舉處紅, 那是要的)
🛑 後台看到一張「客人有匯款單又刷卡成功」的資料時要顯示什麼 —— 不在本片
🛑 現金(cash)那條 —— DB 認, 顧客站沒開, 沒有人拍過
```
