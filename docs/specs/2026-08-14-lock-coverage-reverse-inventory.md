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
⇒ **`base.py` 內**對 `products` 的保護類查詢都走分頁:`:1256`、`:1380`、`:1407`、`:1435`、`:1474`、`:1546`、`:1687`、`:2778`。

> 🔴 **2026-08-14 訂正(C 窗 N1/N2,我重跑確認)**:原文寫「未分頁的 `client.get` **只有三處**」與
> 「**逐支**都走分頁」,兩句都比事實窄。
> **N1**:`grep -nE "client\.get\("` 實為 **5 處** —— `:153`(`fetch_json`,打供應商站抓 `collections.json`、**非 Supabase**)、
> `:301`(`count=exact`+`Range: 0-0` **純計數**)、`:1162`(`supplier_freeze`)、
> `:1343`(**`_paginated_get_json` 自己那一發**,該排除但要說)、`:2366`(`audit_results`)。**五處逐處看過,都不是鎖列查詢 ⇒ 結論存活。**
> **N2**:「逐支」的掃描範圍其實**只有 `base.py` 一支**,而 `fetchers/` 共 30 支;
> `cncracing_csv.py:765` 確實直打 `rest/v1/products`(C 窗開檔驗過它 `:770-779` 自帶 Range 分頁迴圈 ⇒ 結論仍存活)。
> ⇒ **這是我在本檔 §0 才檢討過的同族病(掃描字集/範圍比宣稱窄),當天再犯一次。**
同族的 `direct_fit` 漂移(常數集有、快照 SELECT 漏)也已於 2026-07-01 修掉,現在
`PRESERVE_ON_NULL_FIELDS`(`:520`)是快照 SELECT / or-filter / 填值迴圈的**單一驅動來源**。
⇒ **這條不該進盤點表當風險。** 真正該記的是:這個專案**踩過兩次「保護以為有、其實漏」的坑,兩次都補成單一來源。**

## 1. 反向盤點表(從常數區列,共 4 組保護 + 未保護組)

| 報價單欄位 | 保護形狀 | 旗標 | 出處 |
|---|---|---|---|
| `brand` `model` `year_start` `year_end` `fitment_parsed` | **①旗標鎖** `PROTECTED_FIELDS_ON_RECORRECT` | `manually_corrected` | `:459` |
| `product_name_zh` `category_zh` `description_zh` `summary_zh` `highlights_zh` | **①旗標鎖** `PROTECTED_TRANSLATION_FIELDS` | `translation_locked` | `:467`(2026-06-12 由 3 欄擴到 5) |
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
| `description` | `description_zh` | 🔴 **看供應商** —— 見 M2 訂正框 |
| `highlights` | `highlights_zh` | 🔴 同上 |
| `images` | view `images` | 🟡 **只有②防洗網** —— 來源給新圖就覆寫,**鎖不住** |
| `subtitle` | 🔴 **沒有對應欄**,但**有兩個輸入** —— `buildSubtitle(vehicleLabel, ctx.subtitleTag)`(`rpm-transform.ts:79-83`) | 🟡 **一半已鎖、一半全裸** —— 見 M1 訂正框 |
| `price_general` | `price_retail` | ❌ 完全沒保護、每跑覆寫 |
| `delisted_at` | 來源鏡射 | ❌ 完全沒保護(且 Sean 已拍 Q-B3=B 要把權威搬到我們這邊) |

## 2b. 🔴 三條 must-fix 訂正框(C 窗 2026-08-14 對抗複驗;每條我都自己重跑過)

**M1 訂正 —— `subtitle` 原文「報價單側沒這欄、鎖不了」講太死。**
它**沒有對應欄**成立,但它的**兩個輸入**不是同一回事:
- `vehicleLabel` ← 報價單 view 的 `vehicle_label`,定義逐字是 `brand` + `model` 串接
  (`baseline_schema.sql:4860` `NULLIF(btrim(concat_ws(' ', brand, model)), '')`;`:2560` 是聚合版同義)
  ⇒ 🔴 **`brand`/`model` 就在 `PROTECTED_FIELDS_ON_RECORRECT` 裡(`base.py:459-461`)= 已受①旗標鎖。**
- `subtitleTag` ← rpm 是我們寫死的字串;試點供應商是 `major_category_zh`,
  而它**四個保護集全部零命中**(數法 `sed -n '455,525p' fetchers/base.py | grep -c "major_category"` ⇒ **0**)= **全裸**。
⇒ **正確說法:副標無欄可鎖,但輸入一半已鎖、一半全裸。**

**M2 訂正 —— `description` / `highlights` 的「✅」漏了供應商軸,而且保護來源根本不是報價單的鎖。**
`rpm-transform.ts:328-333` 逐字 `...(ctx.syncDescription && description != null ? { description } : {})`,highlights 同 gate。
`supplier-config.ts:114` **rpm 是 `syncDescription: false`** ⇒ 對 rpm,這兩欄**我們的同步腳本一個字都不寫**,
**保護來自我們自己的閘,報價單那把①旗標鎖根本沒參與。**
⚠️ **C 窗此條的數字我重數後不同**:它寫「其餘 7 家 `true`」並列 7 個行號,
實為 **14 家**(`grep -n "syncDescription: true" scripts/supplier-config.ts | wc -l` ⇒ 14,行號 `126…303`)。**結論不受影響,數字以 14 為準。**
🔴 風險點:**哪天有人把 rpm 的 `syncDescription` 翻成 `true`,保護就換人了,而上面的表看不出來。**

**M3 訂正 —— 兩套鎖不是同級機制,「設鎖路徑」的保護不對稱。**
逐支重跑(`git grep -ln "manually_corrected" -- 'app/api/**/route.ts'`,5 支):
`admin/fitment-year` / `audit/accept` / `audit/reject` / `dictionary/update` / `export`
—— **5 支的 `requireAdmin|requireFull2FA` 命中數皆為 0**(我另數:其中**真的寫該欄的是 3 支** ——
`audit/accept`×3、`audit/reject`×1、`export`×1;另兩支只是提及)。
對照寫 `translation_locked` 的 `translations/update` ⇒ **命中 2**。
⇒ **fitment 鎖只靠 middleware session(=密碼登入),翻譯鎖才在 2FA 牆後。**
⚠️ **作用域**:這只證明「寫鎖路徑」這一族;C 窗自陳 37 支只開了 6 支,**不是 37 支全貌**,不要放大。

## 3. 三態歸類(交辦第 2 點;已含 M1/M2 訂正)
- **①已被旗標鎖保護**:fitment 5 欄、`_zh` 5 欄。⚠️ 但「內文」對 **rpm** 實際靠的是我們的 `syncDescription` 閘(M2)。
- **②只被防洗網保護(可鎖但今天沒鎖)**:`images` / `image_url` 及另 5 個 enrichment 欄
  ⇒ **要真正「鎖住圖片」得新增旗標鎖,防洗網不夠。**
- **③完全沒保護**:`product_name`(英文回退)、`price_retail`、`stock_status`、`spec`、`delisted_at`、
  **`major_category_zh`(副標的另一半輸入,M1)**。
- **④無欄可鎖但輸入可鎖**:我們的 `subtitle` —— `brand`/`model` 那半已鎖、`major_category_zh` 那半全裸。
  **這欄本身無論選甲乙都只能在我們這邊處理,但它的上游有一半是鎖得住的。**

## 4. 這張表對 Q-B4(「可能都會需要」)的意義 —— **只陳述,不設計**
Sean 點名的三個欄落在**三個不同的格**:內文=①(已有,但 rpm 那家是我們的閘在擋)、
圖片=②(要升級成①)、副標=④(**無欄可鎖,但輸入一半已鎖、一半全裸**)。
⇒ **「都要鎖」不是一件事,是三件形狀不同的事。** 這是盤點結論,**做法由 Sean 與主視窗決定,本檔不提。**

## 5. 誠實缺口
1. **mac mini 正本未讀** —— 每份報告都留。
2. 我盤的是 `fetchers/base.py` 的常數區與 `rpm-transform.ts` 的對照;
   **沒有做「全 repo 反向盤點」確認沒有第五套保護** —— 若某支 fetcher 自己另寫了保護,我會漏掉。
3. 表中「完全沒保護」那一格是**反推**(不在四個集合內 ⇒ 每跑覆寫),**不是逐欄實測寫入行為**。
4. `product_name_zh` 為空時 `title` 會回退英文 —— **這個回退實際發生在多少列,我沒數**(需查 DB,沒連線)。
5. 我沒查 `supplier_freeze` 今天實際凍結了哪幾家哪幾欄(那是 DB 內容,不是 code)。
