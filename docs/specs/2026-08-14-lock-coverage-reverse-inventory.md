# 保護涵蓋率反向盤點 · 從 code 反查,不從 Sean 的字眼查

> 交辦 = `主-B-006-DISPATCH`。**盤點,不是設計。** 零 code、零寫入
> (報價單 repo 收工驗 `git status --porcelain` = 0)。
> 🔴 **mac mini 正本未讀**(Sean 逐字「本機只是 ssh clone」)—— 全部讀 `origin/main`,這條缺口不消失。
> 方法照交辦:從 `fetchers/base.py` 的常數區 + `fetch_*_skus` 反向列,**不從「title/subtitle/images」去找對應欄**。

## 0. 🔴 先更正交辦裡的一條前提:**1000 筆截斷已經修好了,不是「今天就是破的」**

交辦寫「那不是背景知識,那是**現行保護今天就是破的**」。**這句不成立,我逐支驗過。**
`_paginated_get_json()`(`base.py:1325-1356`)就是為了繞 1000 上限而寫的,docstring 逐字記錄了那次事故
(「實測 RPM 2593 鎖列只保到 1000」)—— **那是修法的動機,不是現況。**

數法:`git show origin/main:fetchers/base.py | grep -nE "_paginated_get_json\(|client\.get\(|rest/v1/"`
⇒ 對 `products` 的保護類查詢**逐支都走分頁**:`:1256`、`:1380`、`:1407`、`:1435`、`:1474`、`:1546`、`:1687`、`:2778`。
未分頁的 `client.get` 只有三處,逐處看過:`:301` 是 `Prefer: count=exact` + `Range: 0-0` 的**純計數**(不拉 row body)、
`:1162` 是 `supplier_freeze`、`:2366` 是 `audit_results` —— **都不是鎖列查詢**。
同族的 `direct_fit` 漂移(常數集有、快照 SELECT 漏)也已於 2026-07-01 修掉,現在
`PRESERVE_ON_NULL_FIELDS`(`:520`)是快照 SELECT / or-filter / 填值迴圈的**單一驅動來源**。
⇒ **這條不該進盤點表當風險。** 真正該記的是:這個專案**踩過兩次「保護以為有、其實漏」的坑,兩次都補成單一來源。**

## 1. 反向盤點表(從常數區列,共 4 組保護 + 未保護組)

| 報價單欄位 | 保護形狀 | 旗標 | 出處 |
|---|---|---|---|
| `brand` `model` `year_start` `year_end` `fitment_parsed` | **①旗標鎖** | `manually_corrected` | `:459` |
| `product_name_zh` `category_zh` `description_zh` `summary_zh` `highlights_zh` | **①旗標鎖** | `translation_locked` | `:467`(2026-06-12 由 3 欄擴到 5) |
| `image_url` `images` `description_origin` `inherit_override` `panel_type` `spec_marketing` `direct_fit` | **②防洗網**(只擋 null) | 無旗標、**全家全列生效** | `:483` |
| `summary_zh` `highlights_zh` `description_zh` | **②防洗網**(疊在①之上) | 無旗標 | `:512` |
| 整家凍結 `freeze_strip_fields` | **③整家無條件剝欄** | `supplier_freeze` 表 | `:1113`、`:1857` |
| **其餘欄**(含 `product_name` 英文、`price_retail`、`sku`、`stock_status`、`delisted_at`、`spec`) | **③完全沒保護** | — | 每跑覆寫 |

**兩種形狀的差別(這是本盤點最有用的軸)**:
①**旗標鎖** = 人工設旗標,鎖了就**連非空的來源值也不覆寫**(`supabase_upsert_respect_protected` 逐列剝欄)。
②**防洗網** = 不用設定,規則只有一條「incoming 空 **且** DB 既有非空 → 保留既有」⇒ **來源有值時照樣覆寫**。
⇒ **②擋不住「供應商改了名字/換了圖」,只擋「供應商那天沒給值」。**

## 2. 對照我們網站的欄位(交辦說別從 Sean 字眼出發,但盤完要能回答他)

| 我們的欄 | 來自報價單哪一欄 | 今天的保護狀態 |
|---|---|---|
| `title` | `product_name_zh \|\| product_name`(`rpm-transform.ts:326`) | 🟡 **一半** —— 中文名有①旗標鎖;**回退的英文 `product_name` 完全沒保護** |
| `description` | `description_zh` | ✅ ①旗標鎖 + ②防洗網(雙層) |
| `highlights` | `highlights_zh` | ✅ 同上 |
| `images` | view `images` | 🟡 **只有②防洗網** —— 來源給新圖就覆寫,**鎖不住** |
| `subtitle` | 🔴 **沒有對應欄** —— `buildSubtitle(vehicleLabel, ctx.subtitleTag)`(`rpm-transform.ts:79-83`)在**我們的同步腳本裡算出來的** | ❌ 報價單側**無法鎖**(那邊沒有這個欄位) |
| `price_general` | `price_retail` | ❌ 完全沒保護、每跑覆寫 |
| `delisted_at` | 來源鏡射 | ❌ 完全沒保護(且 Sean 已拍 Q-B3=B 要把權威搬到我們這邊) |

## 3. 三態歸類(交辦第 2 點)
- **①已被旗標鎖保護(可鎖且已有機制)**:fitment 5 欄、`_zh` 5 欄 ⇒ **含 Sean 的「內文」**。
- **②只被防洗網保護(可鎖但今天沒鎖)**:`images` / `image_url` 及另 5 個 enrichment 欄
  ⇒ **要真正「鎖住圖片」得新增旗標鎖,防洗網不夠。**
- **③完全沒保護**:`product_name`(英文回退)、`price_retail`、`stock_status`、`spec`、`delisted_at` 等。
- **④報價單側無此欄、鎖不了**:我們的 `subtitle`。**這欄無論選甲乙,都只能在我們這邊處理。**

## 4. 這張表對 Q-B4(「可能都會需要」)的意義 —— **只陳述,不設計**
Sean 點名的三個欄,今天各自落在**三個不同的格**:內文=①(已有)、圖片=②(要升級成①)、副標=④(那邊沒有)。
⇒ **「都要鎖」不是一件事,是三件形狀不同的事。** 這是盤點結論,**要做什麼由 Sean 與主視窗決定,本檔不提做法。**

## 5. 誠實缺口
1. **mac mini 正本未讀** —— 每份報告都留。
2. 我盤的是 `fetchers/base.py` 的常數區與 `rpm-transform.ts` 的對照;
   **沒有做「全 repo 反向盤點」確認沒有第五套保護** —— 若某支 fetcher 自己另寫了保護,我會漏掉。
3. 表中「完全沒保護」那一格是**反推**(不在四個集合內 ⇒ 每跑覆寫),**不是逐欄實測寫入行為**。
4. `product_name_zh` 為空時 `title` 會回退英文 —— **這個回退實際發生在多少列,我沒數**(需查 DB,沒連線)。
5. 我沒查 `supplier_freeze` 今天實際凍結了哪幾家哪幾欄(那是 DB 內容,不是 code)。
