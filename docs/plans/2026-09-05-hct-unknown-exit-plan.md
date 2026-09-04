# Plan:卡在 `unknown` 的箱,要怎麼出來(⟦ship-HCTUNKNOWNSTUCK⟧)

> 來源:`f1b3e8461` 的 codex must-fix —— 送新竹前寫的 `unknown` 佔位,在
> 「寫完而 HTTP 還沒發出去就被砍」時讓那一箱**永久卡住**,而**今天沒有出口**。
> 🔴 **鐵則 8:UI 那半跨 4 檔 ⇒ 等 Sean 一個字才動。** DB 那半照主視窗指示**只寫規格、不建物件**。

## 1. 🔴 這一片在做的事,是【解除一道保護】—— 所以它的形狀由那件事決定

`unknown` 的語意逐字是「**送出去了而不知道結果 ⇒ 不得重送**」。
把它推回 `draft` = **允許再送一次**。⇒ 📌 **做錯的代價是【客人收到兩箱】,不是一個難看的畫面。**

🛑 **所以「重設為草稿」不能是一顆自由的鈕。** 它必須**掛在一次查詢的結果上**:

```
按「查新竹」 → queryEdelno(epino)
   查到貨號   ⇒ 它其實送成功了 ⇒ 補寫 submitted。不給重設。
   查無此單   ⇒ 證明沒送出去 ⇒ 這時才亮出「重設為草稿」
   查不動     ⇒ 什麼都不亮(見下)
```
🔴 **`HCT_QUERY_ENABLED` 關著 ⇒ 查不動 ⇒ 我們證明不了它沒送出去 ⇒ 【不得提供重設】。**
⇒ 📌 **一個在「查不動」時還亮著的重設鈕,就是那個佔位列本來要擋的那個洞。**

## 2. 畫面(出貨單頁,`hct_status = 'unknown'` 那一箱)

- 常駐一句:**「送出結果未知 —— 不要重送,先查新竹」**(紅字,不是灰字)
- 一顆「**查新竹**」:`HCT_QUERY_ENABLED` 關著時**灰掉並寫明原因**,不消失
  ⚠️ 而**灰掉這次要真的做**:與送出那顆不同,查詢是唯讀的
  ⇒ 可以在 server 先問一次閘,不必等按下去。**上一片那個「說了沒做」不要再來一次。**
- 查完才可能出現的「**重設為草稿**」:二次確認,文案寫**後果**不是動作
  ⇒ 「確定新竹那邊查無這張單?按下去之後這箱會變回可送,**送錯就是兩箱**」

## 3. DB 那半(**本 plan 不建,列規格**)

`admin_record_hct_submit` 的 `p_status` 值域是 `submitted|failed|unknown`
⇒ 📌 **它結構上寫不出 `draft`** —— 這不是漏掉,是它被設計成只往前走。
需要一支**新的**:

```
admin_reset_hct_to_draft(p_shipment_reference text, p_actor text, p_evidence jsonb)
  · 只在 hct_status = 'unknown' 時動;其餘一律 RAISE(尤其 submitted)
  · p_evidence 必填且必須含那次查詢的回應 —— 沒有證據不准重設
  · hct_request_id 要一起清掉, 否則 write-once trigger 會擋住下一次真的送出
  · 寫一列稽核(誰、何時、憑什麼)—— 它是在推翻一個保護, 留痕不是選配
```
🛑 **而 `hct_request_id` write-once 那一條要先確認**:它擋不擋寫成 `NULL`?
⇒ 這一格**我還沒查**,寫 migration 之前要先讀 `20260904170000:81` 那支 trigger。

## 4. 測試分母

- action:查到貨號 / 查無 / 查不動(閘關)/ 非 unknown 狀態按了 —— 各一格
- 🔴 **負對照**:`HCT_QUERY_ENABLED` 關著時,**重設那條路徑必須不可達**(不是「鈕是灰的」,
  是 **server action 拒絕**)—— 前端灰掉擋不住有人直接呼叫 action
- 🔴 **突變**:把「只在 unknown 時動」那個條件拿掉 ⇒ 必須有測試紅
- 既有必須仍綠:`hct-client` / `hct-submit-flow` / `hct-submit-action` / `shipment-section`

## 5. Rollback

1. `git revert`(UI 半)—— 那一半沒有 DB 副作用。
2. 🛑 **已經被重設過的箱回不去**:它已經變成 draft、`hct_request_id` 已清
   ⇒ **revert 不會把它變回 unknown**,而稽核那一列是唯一的紀錄。

## 6. 影響面 / 要動的檔

```
新增  components/orders/shipment-hct-unknown-panel.tsx   (+ .test.tsx)
改    lib/shipping/shipment-actions.ts                   (+2 個 action)
改    components/orders/shipment-section.tsx             (掛上去 + 那一句話)
改    lib/shipping/shipment-repository.ts                (讀 hct_status 給畫面)
```
⇒ **四檔(不含測試)⇒ 鐵則 8 成立 ⇒ 等批。** 估時 **40-55 分**。
⚠️ 最後那一檔要小心:`hct_status` **不得**加進 `SHIPMENT_ROW_SELECT`(它同時餵顧客站那條路)
⇒ 沿用上一片的做法:**另開一支窄讀取**。

## 7. 這份 plan 答不出來的

· **今天有幾箱卡在 unknown?** —— 我沒查(唯讀連線查得到,但那要另一發)。
  📌 **而那個數字會改變這一片的急迫性,不會改變它的設計。**
· `hct_request_id` 的 write-once trigger 對 `NULL` 的行為(見 §3)。
