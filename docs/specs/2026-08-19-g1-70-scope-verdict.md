# `#70` B2B 月結對帳 —— **範圍判定:Phase 2。而有一題要問 Sean**

> 作者:G1 · 2026-08-19 · **這份是【判定】不是 plan** —— 主視窗指示:判出 Phase 2 就寫判定、不寫 plan。
> 判法與 `#69` 同一套(先讀 NORTHSTAR;答不出來就去找它在世界上留下的痕跡),而**結論相反**。

## ① NORTHSTAR 怎麼寫(逐條讀,附行號)
```
§1.1 要做的   :43  三級會員(general / store / premium_store)**tier 機制**
              :44  儲值金 ledger 基本功能(加值 / 扣款 / 退款 / 餘額查詢)
§1.2 不做的   :57  9 大業務藍圖(車輛履歷、**店家端**、預約、保養提醒等)⇒ Phase 2
§5 上線就緒的關鍵硬規則五條 ⇒ **沒有一條提到月結或對帳**
```
🔴 **`tier 機制` 在 Phase 1,而它指的是【價格】不是【帳期】** —— 實作處 `packages/domain/src/catalog/pricing.ts:21`:
`premiumStore` 的定義是 `store.amount × (1 - brand.premium_extra_pct / 100)`,**純粹是折扣算法**。
⇒ **「有 store tier」推不出「有月結」。** 這一格如果誤讀,整條就會被當成 Phase 1。

## ② 系統裡到底有沒有「月結」這個概念 ⇒ **沒有**
```
`git grep -rniE '月結|賒帳|付款條件|payment_terms|credit_limit|due_date|net30|帳期' -- apps packages supabase`
排除測試 ⇒ **6 命中,而逐個開檔之後【零個】是真的月結機制**:
  packages/domain/src/order/types.ts:165        註解「**未來**月結等只讀清單」← 講的是未來
  packages/ports/src/IOrderRepository.ts:200    `// TODO M-4a-XX: 補 listByDateRange — 月結統計用` ← **未實作**
  packages/ports/src/IEmailOutbox.ts:121-122    「帳期」= **Resend 的用量配額週期**
  supabase/migrations/20260717020000_…:180-181  同上
```
🔴 **又是同形異義多報**:`帳期` 在這裡指的是**寄信服務的配額週期**,不是應收帳款的帳期。
(與 `#69` 的 `unsubscribe` 同族 —— **字面完整而意思換了,而它看起來像正解。**)
⇒ **真正該有的東西一個都沒有**:沒有付款條件欄、沒有信用額度、沒有到期日、沒有對帳單。
⇒ 而 SOP 要用的那支查詢(`listByDateRange`)**本身就是一個 TODO**。

## ③ 有沒有對外承諾過(這是 `#69` 成立的關鍵,而這裡是反的)
```
`git grep -rniE '月結|帳期|對帳單|經銷商|批發' -- apps/storefront/src/data apps/storefront/src/app`
排除測試 ⇒ **0 命中**
線上實查(唯讀 GET,2026-08-19):https://shop.pcmmotorsports.com/terms ⇒ HTTP 200 / 42,176 bytes
  「月結」0 /「帳期」0 /「對帳」0 /「經銷」0 /「批發」0
```
⇒ 🔴 **站上沒有對任何人承諾過月結。** 這與 `#69` 正好相反 —— `#69` 是「已經答應了」,`#70` 是「從沒答應過」。

## ④ 判定
```
**Phase 2。** 理由三條，每條都可推翻:
  ① NORTHSTAR 把「店家端」明列在 Phase 2（:57），而月結對帳是店家端的一部分
  ② 系統零基礎建設：沒有付款條件/額度/到期日；SOP 要用的查詢是 TODO
  ③ 零對外承諾（與 #69 的決定性差異）
```
📌 **而「判它是 Phase 2」本身就是產出** —— 它讓這條從 P1 池子裡**正確地退出**,
不再每次盤點都被重新撿起來問一次。

## 🔴 ⑤ 一題要問 Sean(而它可能推翻上面整份)
```
**現在有沒有經銷商在跟你月結?**（不是系統裡，是實際上）
· 有  ⇒ 那麼「員工每月怎麼結」這件事【今天就在發生】，只是在系統外面用紙筆/Excel 做
        ⇒ 那份 SOP 仍值得寫（紙上流程），而「跑列表 + 加總」那半仍卡在 listByDateRange 沒做
· 沒有 ⇒ 判定成立，這條退到 Phase 2，不必再碰
```
⚠️ **我量不到這一格** —— 它是業務事實,不在 repo 裡也不在站上。**這是「我查不到」不是「不存在」。**
📎 相關但不同題:Sean 2026-08-18 已拍**儲值金業務現在不開** —— 而儲值金正是 B2B 預付的那條路。
⇒ **預付不開 + 月結沒做 ⇒ 現在的 B2B 客人與一般客人走同一條路(當場付款,只是價格不同)。**

## ⑥ 我沒做/沒查的
```
· 沒開過後台看實際畫面（G6 也標了同一格）
· 沒查正式庫有沒有 store/premiumStore tier 的真實客人、有幾個
· 沒讀 docs/PHASE-2-VISION.md 的店家端章節（判定只靠 NORTHSTAR §1.2 的字面）
· #27（markPartiallyPaid 多次累積）我沒查它的現況 —— 條目說它是 schema 端的對應項
```
