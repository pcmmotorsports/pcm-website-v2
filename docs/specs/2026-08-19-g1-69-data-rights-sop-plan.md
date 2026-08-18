# `#69` plan · 個資法資料權利流程(查詢／複本／更正／停止處理／刪除,30 天回應)

> 作者:G1 · 2026-08-19 · 🔴 **狀態:尚未批准,一行 code / 一份 runbook 都還沒寫。**

## ⓪ 🔴 第 1 步的答案:**這題的框架要換 —— 我們已經對客人承諾了**

主視窗要我先判「上線必要 vs Phase 2」,並說「答不出來就停下回報」。
**我從 `docs/PHASE-1-NORTHSTAR.md` §1 答不出來** —— `§1.1 要做的` 與 `§1.2 不做的(Phase 2)` **兩邊都沒有提到個資法資料權利**(逐條讀過 `:30-66`)。§5 上線就緒的關鍵硬規則五條也沒有。
**⇒ 光看 NORTHSTAR,這題無解。**

### 而有一件事讓它不必再判:**那個承諾已經公開上線了**
```
apps/storefront/src/data/legal-content.ts:199 逐字:
  「依個資法第 3 條,您得就本公司保有之您的個人資料,請求查詢或閱覽、製給複製本、
    補充或更正、停止蒐集處理利用、刪除。行使方式:客服 LINE … / 電話 … / 信箱 …」

路由 apps/storefront/src/app/privacy/page.tsx（吃 PRIVACY_DOC）
線上實查(2026-08-19,唯讀 GET):
  curl https://shop.pcmmotorsports.com/privacy  ⇒ HTTP 200 / 34,357 bytes
  「您得行使之權利及方式」命中 3 / 「請求查詢或閱覽」2 / 「製給複製本」2 / 「刪除」2
```
🔴 **⇒ 這不是「要不要做」的題,是「已經答應了而沒有人知道怎麼兌現」。**
客人現在就可以照那頁寫的三個管道來要求刪除,而**員工收到之後不知道要刪什麼、留什麼**(這正是條目 `#69` 記的病)。
⇒ **判定:上線必要。而更準確的說法是 —— 它已經是【現在進行中的曝險】,不是未來的工作。**
⚠️ **限定**:我判的是「**承諾已存在**」這個可查證的事實,**不是**在做法律意見。要不要因此改隱私政策的措辭,是 Sean 的決定。

## ① 第二層查核:條目今天還成立嗎(我自己重驗,不吃 G6 的轉述)
```
`git grep -rnE '資料可攜|刪除帳號|delete_account|export_personal|dataExport' -- apps packages` ⇒ **0 命中**
`git grep -rn 'data-rights' -- docs scripts` ⇒ **0 命中**
`ls docs/runbooks/ | grep -i 'data-rights\|個資\|privacy'` ⇒ **查無**
負向對照(同尺該命中的):`git grep -rln '隱私' -- apps/storefront/src` ⇒ 有命中(政策頁本體)✅
```
⇒ **零實作成立。** 而 G6 那句「命中全是會員中心的個人資料編輯頁」我沒有重跑它的完整分母 —— **我驗的是「資料權利那一族的識別字零命中」,不是它的 666 支分母。**
📎 G6 自己留的證物我要指名:它第一次用 `個資` 當 pattern ⇒ **誤中「整個資料」「兩個資料夾」**。**中文沒有 `\b` 詞界,短詞會安靜多報,而多報看起來像「有做」。**

## ② 客人的個資實際落在哪(這是 SOP 的骨架,不是背景)
```
量法:掃 packages/adapters/src/supabase/database.types.ts 的 Row 定義
      分母 **58 個表/view**;以 email|phone|name|address|recipient|birth|tax_id|user_agent|note 為字集
      ⇒ **25 個命中**,逐個開來判之後,真正承載客人 PII 的是下列這些
```
| 表 | 欄位 | 刪除時的難處 |
|---|---|---|
| `customers` | `name` `email` `phone` `birthday` | 本體 |
| `customer_addresses` | `name` `phone` `email` `invoice_tax_id` | 發票抬頭/統編涉稅務保存 |
| `customer_vehicles` | `name` 車輛資訊 | 與訂單關聯 |
| `orders` / `admin_order_list_v` | `notification_email` `shipping_address_snapshot` | 🔴 **快照** —— 刪了客戶主檔,快照仍在 |
| `shipments` | `recipient_snapshot` `carrier_note` | 同上,且已交付物流業者 |
| `email_outbox` | `recipient_email` | 已寄出的信本身不可回收 |
| `order_legal_consents` | `client_user_agent` | 它是**同意的證據**,刪掉等於毀證 |
| `customer_wallet_ledger` / `order_payments` / `order_notes` 等 | `note` `payer_note` | 自由文字,可能夾帶 PII |
⚠️ **`brands.name` / `categories.name` / `order_items.line_total` / `sweeper_heartbeat.job_name` 是我的字集誤收**,已排除 —— **寫出來是因為「25 命中」這個數字本身會誤導。**

## ③ 分級與鐵則
- **產出物 = `docs/runbooks/data-rights-sop.md`(純文件)**。隱私政策已把行使管道指向 LINE／電話／信箱 ⇒ **Phase 1 不需要自助 UI**。
- **鐵則 8**:本片**不動 code** ⇒ 未命中。
- **鐵則 12**:六類逐字對過 —— 不動錢/權限/schema/平台設定/對外發送/`packages/ui` ⇒ **未命中**。
  🔴 **而這是【本片】的判定** —— 之後若要做「後台一鍵匿名化」那種東西,那片**一定**命中 12②③,要另外提 plan。
- **L 分級(鐵則 9)**:SOP 是**內部作業文件**,不是站上內容 ⇒ L1/L2/L3 不適用。**而它引用的法定天數(30 天)是法律值,不是可調參數。**

## ④ SOP 要回答的六件事(每件都可 yes/no 驗收)
```
1. 收件:三個管道各自誰看、怎麼登記(現況：沒有任何登記載體)
2. 身分驗證:怎麼確認來要求的人就是本人（錯刪別人的資料比不刪更糟）
3. 刪除範圍:哪些刪、哪些【依法必須留】、留多久
4. 快照怎麼辦:orders.shipping_address_snapshot / shipments.recipient_snapshot
5. 回覆:30 天內、回什麼、留什麼紀錄（稽核時要證明合規）
6. 拒絕的情形:法定保存期內不能刪時，怎麼跟客人講
```

## ⑤ 🔴 其中【我不能自己決定】的三格(Sean 拍板;他今晚睡了 ⇒ plan 先寫、這三格留空)
```
甲 商業保存期限:訂單/發票要留幾年（我會查法規並附來源，而【採用哪個口徑】是他的決定）
乙 刪除的語意:硬刪 vs 匿名化（匿名化留得住營運統計，硬刪比較乾淨；兩者法律風險不同）
丙 誰是窗口:目前三個管道沒有指名負責人 —— 而「沒有具名負責人」正是 30 天會被漏掉的原因
```
⚠️ **我不會替他填預設值** —— 這三格空著,SOP 仍寫得出可用的第一版(收件登記 + 身分驗證 + 回覆範本),**而刪除範圍那一節會標「待拍板」並寫明擋在哪。**

## ⑥ 我沒做/沒查的(免得被讀成做完了)
- **沒有查法規原文**(個資法第 3 條、第 11 條、商業會計法保存年限)⇒ 寫 SOP 時要查證並附條號與來源,不憑記憶。
- **沒有問過員工現在實際怎麼處理** —— 可能已經有非正式做法,而我看不到。
- **沒有碰正式庫**,PII 分佈是從型別檔推的,**不是從資料查的**。
