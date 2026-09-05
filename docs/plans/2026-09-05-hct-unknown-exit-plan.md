# plan · 卡在 `unknown` 的箱子要有出口(`⟦ship-HCTUNKNOWNSTUCK⟧` RPC 那半)

> **狀態**:草案, 未實作。**一行碼都還沒改。**
> **來源**:主視窗 `-f8` 2026-09-05 派 —— 逐字「它只依賴我們自己的 unknown 狀態機」。
>
> ## 🔴 而那句話【只對一半】—— 這是本 plan 最重要的一格, 放最前面
> ```
> 甲型「佔位卡住」  hct_status=unknown 且 raw 有 "placeholder": true 且 hct_request_id IS NULL
>                   ⇒ ✅ **完全不依賴新竹的回應格式** —— 那個標記是【我們自己寫的】
> 乙型「新竹回了而我們讀不懂」 raw 是新竹的真實回應, 沒有 placeholder 鍵
>                   ⇒ 🔴 **仍然依賴新竹** —— 要看得懂那份回應才知道「查到了沒」
> ```
> 🎯 **⇒ 本 plan 只做甲型。乙型留在板上, 等 `Q-新竹傳輸方式`。**
> 📌 **而這一刀不是為了少做事** —— 是因為**乙型的判準寫進 migration 就是猜一個不可變的東西**。

---

## 0. 🛑 而甲型也【不能自動決定】—— 這一格決定了整個設計

佔位是在 **HTTP 發出去之前**寫的。所以「有 placeholder 而沒有回應」有**兩個世界**:
```
① 那一發【從來沒送出去】   ⇒ 新竹沒收到 ⇒ 放回 draft 是對的
② 送出去了而【回應掉了】   ⇒ 新竹收到了 ⇒ 放回 draft ⇒ 有人再按一次 ⇒ 🔴 客人收到兩箱
```
🔴 **我們這一端沒有任何量具分得出這兩個世界。** ⇒ 📌 **所以 RPC 不可以自己判。**

✅ **⇒ 設計成【帶人證的閘】**:RPC 收一個**操作者的證詞**(「我打電話問過新竹, 他們說沒有這張單」),
把那句證詞**連同是誰說的一起寫進稽核**, 然後才准放回 `draft`。
🎯 **⇒ 它把一個【機器答不出來的問題】換成一個【有人負責的答案】** —— 而稽核讓那個負責可查。
⚠️ **而這【不是】把責任丟給人**:人本來就是唯一能打電話的那個;
   RPC 做的是**讓那通電話留下痕跡**, 而今天手動改 DB 是零痕跡的。

---

## 1. 要做什麼(三塊)

### ① migration —— `admin_hct_reset_unknown_to_draft`
```sql
-- 版本號:ship 的配額(主視窗 2026-09-05 分配:320000 / 390000)
参數  p_shipment_reference text
      p_actor              text     -- 誰做的
      p_request_id         text     -- correlation id
      p_attestation        text     -- 🔴 那句證詞, NOT NULL 且不得為空白
```
**閘寫在 `WHERE` 裡, 不寫在呼叫端**(呼叫端可以被繞過, 這一層每條路都會經過):
```
① hct_status = 'unknown'
② (hct_raw_response ->> 'placeholder') = 'true'      ← 甲型才准
③ hct_request_id IS NULL                              ← 拿到貨號的不准
④ deleted_at IS NULL
⑤ (hct_raw_response ->> 'at')::timestamptz < now() - interval '<N> minutes'
```
🔴 **改 0 列時要 `RAISE`, 不可以安靜地回成功** —— 「條件不成立」與「做完了」在呼叫端**必須不同**。
🔵 **舊的 `hct_raw_response` 整個塞進 `previous` 鍵** ⇒ 那是 rollback 的依據(runbook 已驗過這個形狀)。
**同一個交易裡寫 `admin_audit_log`**(欄位是查過的:`actor` `action` `target` `before` `after` `reason` `request_id` `source_app`):
```
action  = 'shipment.hct.reset_unknown_to_draft'
target  = 'shipment:<reference>'
before  = 那一列的 hct_* 三欄
after   = 同上, 改後
reason  = p_attestation      ← 🔴 那句證詞住這裡, 而它是【內部原因】欄的正確用途
```
🛑 **收權**:`REVOKE ALL FROM PUBLIC, anon, authenticated`, 只給 `service_role`。
🛑 **`SECURITY DEFINER` + `SET search_path`**;而**新物件出生自帶 anon 權限**, 所以那兩道 REVOKE 一個都不能少。

### ② UI —— 那顆鈕
放在**已經有紅字提示的那個元件**(`shipment-hct-unknown-notice.tsx`, 2026-09-05 早上做的)。
```
🔴 它【不是】一顆「重送」鈕 —— 文案要寫成「我已向新竹確認【沒有】這張單, 放回草稿」
🔴 按下去要先跳一個【要打字】的確認, 而打的內容就是 p_attestation
   ⇒ 📌 一個「打勾同意」擋不住習慣性點擊, 一個「要打字」擋得住
⚠️ 而甲型/乙型在畫面上長得一樣 ⇒ **乙型那顆鈕【不要出現】**(不是 disabled, 是不存在)
   ⇒ 因為 disabled 的鈕會讓人去找「怎麼把它變成可按」
```

### ③ 測試(而它是這一片會不會變成假綠的地方)
```
DB 層  五道閘各一發【負對照】:每一道單獨不成立 ⇒ 必須改 0 列且 RAISE
       🔴 而那五發要【各自】跑, 不可以一發五個條件都錯 —— 那樣一道閘壞掉也全紅
       正對照:五個條件都成立 ⇒ 改 1 列, 而 audit 也多 1 列(兩個數一起比)
TS 層  乙型不得出現那顆鈕(拿一筆沒有 placeholder 的 fixture 餵進去 ⇒ 元件不含那個字面)
       🔴 突變:把「只在甲型顯示」那個判斷拿掉 ⇒ 這一格要紅
```

---

## 2. 🛑 我沒做 / 沒查(照實)

```
1  N 分鐘那個門檻【沒有來源】—— runbook 用 15 分, 理由只是「比一次 HTTP 逾時久」
   ⚠️ 它是【前置閘】不是判準, 擋的是「剛按下去還在跑」那一種
2  乙型整個不做 —— 等 Q-新竹傳輸方式
3  🔴 這一片沒有辦法在【真的卡住的箱】上演練 —— 今天暴露 = 0(HCT_SUBMIT_ENABLED 沒設)
   ⇒ 它與 runbook 同一個限制:【讀起來對】不是【跑過對】
4  取消那條路(新竹那支 TransDataCancel_Json)與本片【無關】—— 本片處理的是
   「我們以為送了而其實沒送」, 不是「送成功了要收回」。不要把兩件混成一件。
5  🔴 `admin_audit_log` 的 `actor` 今天是【首頁 picker 自己選的, 零驗證】
   ⇒ 稽核記得下「誰按的」, 而**那個「誰」本身沒有被驗過** —— 這是既有缺口, 本片不修, 但要知道
```

## 3. 前置與順序
```
本片【不需要】等新竹                    ✅ 甲型不依賴他們的回應格式
本片【必須】排在「開 HCT_SUBMIT_ENABLED」之前  🔴 開關開了就可能卡箱, 而那時沒有出口
估時  migration 60 分 · UI 40 分 · 測試 50 分 ⇒ 🔴 遠超鐵則 4 的 45 分 ⇒ 要拆三片
rollback  純新增(新函式 + 新鈕)⇒ revert 即可;而 migration 是不可變歷史 ⇒ 改它要再開一支
```
