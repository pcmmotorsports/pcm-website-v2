# 交接 — 網站子分類兩層上線收工(2026-07-12)

## 開工儀式
```
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status && git log --oneline -5
```
預期 branch=dev。**⚠️ 工作樹會有一批「已修改 + 未追蹤」檔** = 別的 session(車輛搜尋 S1、products-filter-logic 車款下推 DB 等)的 WIP,**不是本線的,絕對別 `git add .` / 別替它 commit**,先問 Sean 那批要不要動。

必讀:memory `project_website-subcategory-two-level-2026-07-12`(本線主檔)+ STATUS.md 最後更新頂端。

## 本 session(07-12)已完成 + prod LIVE 驗證
1. **網站子分類兩層(14 大類 / 77 子類)#212 全上線**:報價單 v1.2 taxonomy 接到網站側欄兩層篩選。
   - 報價單 view `storefront_catalog_v` 加吐 `major_category_v2_zh`/`sub_category_v2_zh`(B庫 `dllwkkfanaebrsuyuedy`、**MCP 直接套 prod**)。🔴 CREATE OR REPLACE VIEW 只能末尾加欄(插中間報 42P16);security_invoker view 須 `GRANT SELECT (新欄) TO anon`(漏了會 42501)。
   - 網站 categories seed 14+77+未分類兩層(A庫 `bmpnplmnldofgaohnaok`、MCP 套)。子類 raw_path=麵包屑「大類 · 子類」;分隔符 `CATEGORY_PATH_SEP=' · '`(半形空格+U+00B7)三處一致:seed / rpm-import / storefront products-filter-logic.ts。
   - rpm-import 改 v2 麵包屑掛子類 + **衝突 gate 分級**(跨大類→abort;同大類子類分歧→取決定性子類、不 abort);matchesCategory rollup;buildCategoryTree 大類 count=子類加總;FilterSide 桌機補「全部大類」列。
   - 全 11 家 `--confirm-write` 重匯入:**12,297 商品掛子類 / 5 未分類 / 0 卡大類**;舊 13 分類歸零、選項 A 自動隱藏。零 abort 零誤下架。curl 正式站新大類名數千次、舊名歸零。
   - Codex 對抗審 R1(2 must-fix)→ R2(+1)全修。
2. eazigrip 選項值繁中(源頭+網站+重抓+匯入)已 live。
3. 每日同步 cron matrix 補全 11 家(lightech 除外 #275)、今晚起生效。
4. 手機商品頁長車名標題溢出(右邊空白)修正。

## Git / 部署現況
- 網站:`origin/dev=7a1da3b`、**prod `main=35fc39a`**(dev→main FF 已部署);storefront 碼向後相容。
- 報價單 repo:`main` 有 `1c4a1f2`+`5db1187`(view v2 migration + 末尾欄修正)**未推**,Sean 決定要不要推。
- 🔴 兩個 migration 是 **MCP 直接套 prod**(非 db push);檔案在 repo 供記錄。

## 待 Sean / follow-up(非阻)
- ⏳ **Sean 肉眼驗子分類側欄「互動」**:大類展開子類、點大類涵蓋所有子類商品、點子類只顯該類(手機+桌機)。側欄若顯舊分類=15 分快取、重整即新。
- 子類網址深連結 `?category=`(現只大類深連結;側欄篩選不靠它)。
- rpm `DSFV42508`(牌照架)分類器 glitch:同商品變體被分到碳纖維部品下兩子類,現由 mild-conflict 取決定性子類化解、源頭分類規則可修。
- 未分類 5 筆邊緣品要不要收 / 舊 13 空分類行日後可刪(現靠隱藏)。
- 側欄 105 分類 count 查詢可優化(#247)。
- ⚠️ 車輛搜尋 S1 WIP(別 session)在工作樹未 commit — 問 Sean。

## 真權威檔
- `docs/reviews/2026-07-12-subcategory-data-pipeline-packet.md`(Codex Packet)
- `supabase/migrations/20260712120000_seed_taxonomy_v2_categories.sql`(網站 seed)
- 報價單 `supabase/migrations/20260712b_storefront_catalog_v_expose_v2_category.sql`(view)
