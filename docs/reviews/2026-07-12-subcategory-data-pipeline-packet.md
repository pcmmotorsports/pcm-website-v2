# Codex Review Packet — 網站子分類資料管線(#212、2026-07-12)

> **給 Codex 的自帶脈絡**(你無 repo 存取):PCM 是機車精品跨境賣場。報價單 DB(B 庫)是分類真相、每日同步流到網站 DB。本次把「新 taxonomy 14 大類 / 77 子類(兩層)」接上網站:報價單 view 加吐 v2 欄 → 網站匯入把商品掛到「子類」→ 側欄兩層篩選。**這是資料遷移(重匯入會改 prod 每個商品的 category_id)**,請對抗審查、嘗試擊破。

## 待審規則(PCM 鐵則摘錄,與你判斷衝突以此為準)
- 金額用整數/Decimal,禁 float(本次不動價格)。
- 經銷價絕不出現在 client bundle / 一般會員瀏覽器;view 走 security_invoker + anon key、只露公開欄。
- 資料遷移:交易模擬驗證、零留痕;動 prod 前先乾跑;source 空/大比例下架要 fail-closed abort。
- 字面 vs 事實:註解/commit 對應實際行為。

## 變更清單(6 檔)
**A. 報價單 view(B 庫、Sean SQL Editor 套用)**
1. `supabase/migrations/20260712b_storefront_catalog_v_expose_v2_category.sql`(報價單 repo)
   — `CREATE OR REPLACE VIEW storefront_catalog_v WITH (security_invoker=true)`,在 base/deduped/final SELECT 三處各加 `major_category_v2_zh`、`sub_category_v2_zh`(products 表既有欄、S3-S6 已回填)。dedup PARTITION 不動。

**B. 網站分類 seed(A 庫 migration)**
2. `supabase/migrations/20260712120000_seed_taxonomy_v2_categories.sql`
   — INSERT 14 大類 + 77 子類 + 1「未分類」fallback,兩層(parent_category_id);子類 `raw_path` = 麵包屑「大類 · 子類」(分隔符 = 半形空格 + U+00B7 + 半形空格);`segments` 由 `string_to_array(raw_path,' · ')` 現算;`ON CONFLICT (raw_path) DO UPDATE` 冪等。VALUES 由 canonical `taxonomy_v2_major/sub` 以 `format(%L)` 產生(非手抄)。舊 17 單層分類不刪(重匯入後 0 商品、前端選項 A 自動隱藏)。

**C. 網站匯入(scripts)**
3. `scripts/rpm-fetch.ts` — `SourceProductRow` 加 optional `major_category_v2_zh?`/`sub_category_v2_zh?`(view 恆 select、缺欄 fetch 即報錯);`VIEW_COLS` 加此二欄。
4. `scripts/rpm-import.ts` — 分類解析改:移除舊 fixed/per-group(依 `major_category_zh` 解析單層大類),改每群取 `major_v2 + sub_v2` 組麵包屑 `raw_path` → `resolveCategoryByPath` 解析到子類 id;缺 v2 或子類未 seed → `未分類` fallback(`uncategorizedId`,`resolveId` 查無 fail-closed throw = 明確擋「seed 未套用就重匯入」)。加 `nullV2Groups`/`unseededSubGroups` 診斷計數。`CATEGORY_PATH_SEP=' · '`。

**D. 網站前端篩選(已 commit f4b0f57、一併審)**
5. `apps/storefront/src/components/products-filter-logic.ts` — `matchesCategory`:選子類→`product.category === main+' · '+sub`(精確);選大類→`=== main` 或 `startsWith(main+' · ')`(rollup 涵蓋所有子類)。`export const CATEGORY_PATH_SEP=' · '`。
6. `apps/storefront/src/lib/category-taxonomy.ts` — `buildCategoryTree`:大類 `count` = 自身 + 子類加總(商品全掛子類、大類自身通常 0)。`apps/storefront/src/components/FilterSide.tsx` — 有子類大類展開後補「全部 {大類}」列(dispatch selectCategoryMain、rollup)。

## 🔴 請重點擊破的不變式
1. **麵包屑分隔符三處一致**:seed `raw_path`、rpm-import `CATEGORY_PATH_SEP`、storefront `CATEGORY_PATH_SEP` 都必須是「空格+U+00B7+空格」。任一處用了不同字元(半形 middot vs 全形、或無空格)→ `product.category`(= JOIN categories.raw_path)與 matchesCategory 重組鍵不符 → 選子類/大類 rollup 全失效(靜默、篩選變空)。請檢查是否有隱性不一致。
2. **rollup 前綴誤命中**:matchesCategory 大類 rollup 用 `startsWith(main+' · ')`。若某大類名是另一大類名的前綴(如「排氣」vs「排氣系統」)會誤命中嗎?(實際 14 大類名互不為前綴,但請驗此假設;`+ ' · '` 分隔是否足夠隔離?)
3. **null fallback 遮蔽**:子類未 seed 時 fallback 到「未分類」而非 abort(舊 #261 是 abort)。這是否讓「taxonomy 新增子類但忘補 seed」靜默流失商品到未分類?診斷計數 `unseededSubGroups` 是否足夠讓 cron 值班發現?(seed 已含全 77、理論上不會命中,但請評估防呆是否夠。)
4. **view security_invoker 保留**:CREATE OR REPLACE 有帶 `WITH (security_invoker=true)`;若漏帶會改成 definer、anon 讀取權限語意變更(經銷欄外洩風險?view 物理無經銷欄,但請確認)。
5. **重匯入下架安全**:重匯入走既有 rpm-import S4/V1 gate(source 空 abort、下架>10% abort)。分類欄變更不影響 external_id/sku 集合 → 下架對賬應零觸發。請確認分類改動不會被誤判為「商品消失」。
6. **dedup 不變**:view 加的 v2 欄非 PARTITION key → 去重列不變、只多兩輸出欄。請確認同群變體 v2 分類一致(否則 _rn=1 代表列的 v2 可能非群內多數)。

## 已驗證(不需 Codex 重跑)
- 網站 scripts typecheck 綠 / 完整 vitest 1868 綠 / eslint 乾淨。
- seed 資料完整性:純 CTE SELECT 驗 15 大類 / 77 子類 / 孤兒子類 0(每子類的大類都存在、JOIN 不漏)。
- view SQL:跑 view body(eazigrip 濾、LIMIT)驗兩新欄正確流出(如 BADGECL → 止滑貼與保護膜/油箱止滑貼)。
- storefront matchesCategory/buildCategoryTree/FilterSide 單元測補齊(rollup/子類精確/大類 count 加總/全部大類列)。

## 施工順序(Sean 執行、審查後)
1. Sean SQL Editor 跑 view migration(B 庫)→ anon 抽驗兩欄有值。
2. Sean 套 seed migration(A 庫)→ 驗 15 大類 + 77 子類 + 未分類。
3. 部署網站碼(dev→main)。
4. 全 11 家重匯入(--confirm-write ×11 或今晚 cron)→ 商品掛新子類;舊 17 分類變 0 商品自動隱藏。
5. 肉眼驗側欄兩層 + 篩選 rollup。

**未含(defer 小 follow-up)**:子類網址深連結 `?category=`(現只大類深連結;側欄篩選不依賴)。

---

## R1 Codex 對抗審 findings 已修(2026-07-12、codex-cli 0.144.1)
R1 判 FAIL、2 must-fix(皆 `scripts/rpm-import.ts` 分類解析、prod 資料安全):
1. **靜默搬未分類 + 假綠**:缺值/子類未 seed 時 fallback 未分類卻繼續正式寫入、彙整報告收 fallback id 誤印全對上 → cron 綠燈把整批商品靜默搬走無告警。
   **修**:WRITE 模式 `unseededSubGroups>0` 或 `conflictGroups>0` 或 `nullV2Ratio>5%` → abort;`categoryResolutions` 改傳 `resolved`(fallback=null、真實反映未對上)。
2. **群內分類不一致無驗證**:major/sub 各一次 `.find()` 取第一筆 → 兩變體不同分類合成不存在麵包屑、或靜默採第一筆錯置。
   **修**:群內收集去重完整 `(major·sub)` pair;恰一才用、0=null-v2、>1=conflictGroups(WRITE abort)。
R1 其餘核對 PASS(分隔符三處一致、rollup 前綴無誤命中、buildCategoryTree 無重複計數、seed SQL 冪等、FilterSide toggle 正確)。修後三綠 + vitest 1868 綠。**R2 複審中**。
