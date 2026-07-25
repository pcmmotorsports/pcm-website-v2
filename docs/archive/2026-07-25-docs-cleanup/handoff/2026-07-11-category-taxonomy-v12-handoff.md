# SESSION HANDOFF — 2026-07-11 分類一致化 v1.2 定稿(研究+設計 session)

> 一句話:報價單↔網站「零件分類一致化」完成三線研究+逐輪拍板,**v1.2 分類體系定稿(14 大類/77 子類)已 commit、未 push**;程式零改動,實作未動工。
> 環境:pcm-website-v2 · branch dev · HEAD=81048c0(工作樹另有 2 個他 session 的 untracked docs,勿動)。
> 接手先讀:①`docs/specs/2026-07-11-category-taxonomy-v1-draft.md`(**分類真權威**,含全部拍板紀錄 §7)②memory `project_category-taxonomy-unification-2026-07-11` ③機器可讀樹=`docs/specs/assets/2026-07-11-category-taxonomy-v12.json`。

## 1. 做了什麼(按時序)

- **起點**:Sean 問側欄「零件分類」讀哪——查明=網站 `categories` 表靜態 seed(手抄報價單 B 庫 `major_category_zh`),兩邊已漂移(B 庫有避震無碳纖、網站相反)。
- **三線偵察**(subagent 唯讀):報價單 repo 血緣(SSoT=`lib/product_categorizer.py` 寫死 dict,非資料表;「97 子類」查無出處,實況 category_zh 125 distinct/原廠 category 285 distinct)/兩庫資料分布/競品分類法(Webike TW、蝦皮、REYS、RPM-Motor、RevZilla)。
- **四拍板(Sean,均=A)**:報價單當唯一大腦、兩層樹+台灣口語、草案先行、車型軸另開。
- **草案 v1**:321 原廠分類→14 大類/64 子類,腳本映射 49,843 筆零遺漏,commit 前交付 artifact 對照表+spec。
- **方法統整(Sean 確認)**:主軸=原廠分類→我們分類直接對照;品名關鍵字=純程式規則補丁(非 AI、每日自動、沒接住落兜底桶+日報),僅 4 補丁點。
- **v1.1(Sean 拍 A=補丁全做+用詞總審)**:碳纖 13 部位子類(29 關鍵字覆蓋 97.6%、漏網 216)/離合器拆外蓋≈272+機構分泵≈275/motogadget 912 筆分家(**重要發現:服飾≈201 筆**)/雜物桶清運;用詞修訂 9 條(止滑貼與保護膜/精品螺絲與螺帽/拉桿與把手/車身防護與防摔/騎士用品與配件/犀牛皮等)。
- **v1.2(Sean 兩修正)**:kspeed Brake 51 筆品名實查拆五路(僅泵蓋油杯蓋≈17 併油杯類;碟盤≈18 新開「煞車碟盤」);大類順序=想買的排前面:碳纖維>腳踏後移與傳動>拉桿與把手>排氣>止滑貼與保護膜>引擎與冷卻>…(=側欄 sort_order)。
- **定稿(Sean「依照建議」)**:v1.1 三題全過;煞車碟盤保留,**未來進卡鉗、總泵時再開子類**(spec §7.6 已預留)。
- 過程中自抓自修 2 個數字錯:子類數 50→64(v1)、電裝與線材 574→604(v1.2 對帳差 30);最終全樹「大類=子類加總=49,843」腳本 assert 對帳。

## 2. Commit 序列(push 狀態寫死)

| commit | 內容 |
|---|---|
| 81048c0 | docs:分類一致化 v1.2 定稿 spec(本 session 唯一 commit) |
| 40991d4 | (他 session)showcase smoke test 修 CI |

**2 支待推**(origin/dev..HEAD);本 session **無 code commit**。多 session 共用 dir,接手先 `git fetch`。

## 3. DB / 部署 / 外部足跡

- DB:**零寫入**;唯讀 SELECT 查 B 庫(dllwkkfanaebrsuyuedy)與網站庫(分析用,不取價格欄)。
- Artifact(claude.ai,私有):v1.2 視覺對照表 https://claude.ai/code/artifact/73c47d9f-272a-4085-a15e-fffba6c4a3f3
- scratchpad 有映射腳本(build_taxonomy.py 含 321 條對照 dict、build_v11.py、gen_deliverables.py)——**session 專屬會消失**,但全部映射內容已落 spec 附錄表+assets JSON,可重建。

## 4. graphify 地圖增量

地圖未動——本 session 只動 docs/specs、docs/handoff 與 memory,未動 code_dirs。

## 5. 開放項(待辦)

- 🔴 **Sean**:push 2 支 commit(`git push`)。
- ⏳ **接手 session(主任務)**:在**報價單 repo**(`/Users/sean_1/API大量上架/PCM報價單-V2`)提實作 plan(鐵則 8 等批):①321 條對照表落 DB(category_mapping 表)+子類欄 ②categorizer v2(讀表+4 補丁點品名規則模組+兜底桶+每日漏網日報)③**平行寫入**新欄位、舊欄不動、回填對帳(各類加總=B 庫全量)④view 增欄→報價單篩選器切 14 類 ⑤網站側:砍手抄 seed、categories 改同步帶入(兩層+sort_order)、匯入 resolveIdOrNull 改吃新欄、RPM fixed 策略併入統一 classify;rollback=舊欄全程保留。
- ⏳ 實作 plan 需列的**確認項**:mapping 落 DB 是推薦方向、Sean 未單獨硬拍(spec §6 Q3)——plan 裡再確認一次;#276 backlog 條目補建;≈估計值實跑精算;切換選離峰(URL/篩選會變)。
- carry-over:無(本工作流新開)。

## 6. push 狀態與收尾自檢

2 支待推等 Sean 手動;工作樹除 2 個他 session untracked docs 外乾淨;secret 0(全程唯讀、無連線字串進文件)。接手 1-2-3:①讀 spec 定稿+memory ②cd 報價單 repo 讀 `lib/product_categorizer.py`+`supabase/migrations/20260602_products_major_category.sql` ③寫鐵則 8 實作 plan 給 Sean 批。

## 相關 plan / 記憶 / 文件

- `docs/specs/2026-07-11-category-taxonomy-v1-draft.md`(定稿真權威)
- `docs/specs/assets/2026-07-11-category-taxonomy-v12.json`(機器可讀樹,含來源對照與 est 標記)
- memory:`project_category-taxonomy-unification-2026-07-11`(拍板全紀錄)
- 報價單 repo 關鍵檔:`lib/product_categorizer.py`(現行 SSoT)、`lib/category_lookup.py`、`supabase/migrations/20260602_products_major_category.sql`、`docs/STOREFRONT_CATALOG_CONTRACT.md`、`docs/NEW_SUPPLIER_ONBOARDING.md`(步驟 7 分類規則)
- 網站 repo 關鍵檔:`supabase/migrations/20260703120000_p0b_seed_16_major_categories.sql`(要被取代的 seed)、`packages/adapters/src/supabase/helpers/category-queries.ts`、`apps/storefront/src/lib/category-taxonomy.ts`、`scripts/rpm-import.ts:190-197`、`scripts/supplier-config.ts`
