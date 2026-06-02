# S3b — 同步腳本改讀乾淨 view + 廢前綴 + 停寫敏感 + 複合鍵(plan)

> 2026-06-02 / 執行 session 產出(承 5-lens 設計分析 workflow + B庫 view 真連線唯讀探查)。
> **鐵則 8 重大改動(動同步腳本核心 + env)+ 鐵則 12 敏感(碰 pricing / 停寫成本 metadata)。等 codex 關卡1 + Sean 批才動手。**
> 決策基線:Q1=A 只 RPM(view 過濾 supplier_slug='rpm'=8878 變體)/ Q2=A 獨立 price_store integer 欄留 NULL / Q3=A 拆片(S3a 已完)。
> 前置:S3a ✅ 已 db push(複合鍵生效、external_id 已洗 DCC01)。上層 plan:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`。
> **審查鏈**:codex 關卡1 round1 FAIL(3 must-fix:delta gate 改硬 gate〔正式寫入須 `--confirm-write` 否則 abort〕+ delta 兩層〔products + variants〕+ pv_spec_unique preflight)→ 修進 §2.4/§6 → round2 PASS。**S3b-1 實作後審查 session 獨立 codex k2 再抓 2 must-fix(寫入閘只擋價變〔改任何寫入須 --confirm-write〕+ isAbnormal 漏 NaN/Inf)→ S3b-1-fix 補 → 審查 round2 PASS。**

---

## 0. 一句話 + 拆片
S3b 把同步腳本從「直讀 B庫 raw products + product_groups_mv」改成「讀 B庫乾淨 view `storefront_catalog_v`」、停寫敏感成本 metadata(解 S1 CHECK)、價格照語意 `price_retail`→`price_general`、用 S3a 的複合鍵 onConflict。
**拆兩 sub-slice**(審查 lens 建議 + 鐵則 4 可中斷):
- **S3b-1**(本片主體、可 commit、三綠、**不寫線上**):改 `rpm-fetch/transform/load/import` + dry-run 驗證 + 價格 delta gate 工具。收工時線上資料零變動。
- **S3b-2**(後續純執行片、像 16b-3):跑 dry-run → 價格 delta 清單給 **Sean 點頭** → 跑正式 bulk 同步寫線上(全站改價 + 新增 ~190 群/~1601 變體)→ 唯讀抽驗。**不可逆、需 Sean 親自授權**。

## 1. 🔴 最重大業務影響:全站降價(Sean 必拍)
真連線唯讀親驗:舊同步讀 B庫 `price_listing`(如 APRILIA-01 17300),新合約讀 view `price_retail`(=B庫 `price_store`=零售真相=14800);全 8878 變體 `listing > retail`(differ=8878 / 全降)、約 **14-17% 全面降價**。
- 命名地雷正解:報價單 `price_store`=零售→view 正名 `price_retail`→網站 `price_general`(零售)。舊讀 `price_listing` 是**過時/較高的 listing 價**;`price_retail` 是報價單**唯一真相零售價**。
- **這不是技術 no-op、是真實全商城調降售價** → 鐵則 12,**delta gate + Sean 點頭**才上線(S3b-2)。S3b-1 只產生 dry-run delta 清單供 Sean 看實際每 sku 漲跌。

## 2. 要改什麼(S3b-1、grounded、附 file:line)

### 2.1 `scripts/rpm-fetch.ts`
- 改讀單一 `storefront_catalog_v`(`.eq('supplier_slug','rpm')`、分頁),取代讀 raw `products` + `product_groups_mv` 兩查。
- `SourceProductRow` 介面重寫對齊 view 21 欄;**砍 4 敏感欄**(price_shopee/price_cost/price_source_amount/price_source_currency)+ 砍 `manually_corrected`(view 無)+ 砍 `price_listing`/`price_store`(view 無、改 `price_retail`)。`price_retail` 型別標 `string|number`(view numeric 序列化、roundTwd 吃 string 安全)。
- **刪 `fetchVehicleLabels` 整個函式**(L70-82):`vehicle_label` 已在 view 21 欄、主查帶回。
- 檔頭 🔴 紅線註解改寫:不再「敏感欄只進 metadata」(改讀乾淨 view、source 端零敏感)。

### 2.2 `scripts/rpm-transform.ts`
- **廢 `computeMainSku` regex**(L27-29):用 view `main_sku` 欄(親驗全大寫、distinct=1123、與 S3a 洗淨 external_id 大小寫一致)。
- **價格**(命名地雷正解、Q2):
  - `transformGroup`:基準款排序鍵 `price_listing`→`price_retail`;`price_general = roundTwd(basis.price_retail)`;獨立 `price_store` 欄 = **`null`**(Q2=A、view 無 dealer 價、刪 `priceStore` 變數);`price_by_tier = {general:{retail}, store:{retail placeholder}}`(審查守則 2:現役 CHECK〔`20260511180231` 已改 general+store 兩 key〕逼 store 要值、view 無經銷價→填 general 同值 placeholder)。
  - `transformVariant`:`price_general = roundTwd(v.price_retail)`;`price_store` 欄 = **`null`**(變體表無 price_by_tier、無 placeholder 問題)。
  - ⚠️ **placeholder 接力陷阱**:`price_by_tier.store`=零售 placeholder(非真經銷價)。讀路徑現以 dummy 0 覆蓋(mapper L173/L252)、今天前台不顯錯;但 **M-2-08 tier-aware 取價別信此欄**、真經銷價要回報價單 dealer view 取。→ transform 寫入處 + mapper TODO L171-172 留註記(鐵則 10 可追蹤性)。
- **external_id 廢前綴**(L142):`('rpm-'+mainSku).toUpperCase()` → 直接 `view.main_sku`(乾淨大寫、對齊 S3a)。`handle`(L143)**維持** `'rpm-'+main_sku.toLowerCase()`(S3a 保留 handle_key、URL/SEO 不破)。
- **顯式寫 `supplier_slug:'rpm'`** 進 `ProductRow`/`VariantRow`(取 view.supplier_slug):複合 onConflict 的鍵欄須在 payload、不靠 DB DEFAULT 隱式(多供應商前瞻除雷)。
- **停寫敏感 metadata**(解 S1 CHECK):
  - `transformGroup` metadata(L160-167):刪 shopee/cost/source_amount/source_currency(S1 CHECK 擋)+ 刪 `source_corrected_count`(view 無 manually_corrected)→ 收斂為 `{ name_en: row.product_name }`(name_en 續留、非敏感、見決策 D4)。
  - `transformVariant` metadata(L181-187):刪全部(4 敏感 + source_corrected)→ `metadata: {}`(顯式空物件、DB DEFAULT '{}' + pv_metadata_is_object CHECK 合法)。
- 取值來源換 view 欄名:`title = product_name_zh || product_name`(view 兩欄都有)、`subtitle` 用 `view.vehicle_label`(取群內第一個非空)。**description 移出 scope**(Sean Q-desc 定案:view 對 RPM 全空〔親驗 8878 列 0 描述〕、**不抓不寫**;upsert 省此欄 → 現有 933 英文描述原地保留、新品 NULL;描述交獨立中文化 workstream〔baoyu-translate→台灣校對 pilot、backlog〕)。
- `spec` 直接 `v.spec`(view object、值全 string、親驗);`variantSortKey` 改讀 `v.spec`。
- `images`/`ownVariantImages`:view.images 親驗 = `[{url}]`(與現 `mapImages` 相同)→ 邏輯不變、只換來源欄。
- `availabilityOf`:view.stock_status 親驗 = `in_stock`/`out`(底線)→ 現函式原樣可用(`in_stock`→in-stock、`out`→out-of-stock)。
- **mergeFitments 加防呆**(L69-87):跳過 `!e.brand && !e.model` 的 entry(通用件防呆;親驗現 0 列空 fitment、但便宜保險)。

### 2.3 `scripts/rpm-load.ts`
- `upsertBatched` onConflict 透傳不動本體;由 import 傳新複合鍵字串。

### 2.4 `scripts/rpm-import.ts`(orchestration)
- **source client** 改吃 `QUOTE_SUPABASE_URL` + `QUOTE_SUPABASE_PUBLISHABLE_KEY`(anon 唯讀、親驗讀 view OK;requireEnv 改名;舊 SOURCE_* 留一行退役註解)。**target 寫端完全不動**(SUPABASE_SECRET_KEY + ALLOWED_TARGET_REF guard 保留)。
- 分群改用 `view.main_sku`(廢 computeMainSku);刪 `fetchVehicleLabels` 那格 Promise.all。
- **onConflict 改複合鍵**:products `'supplier_slug,external_id'`、variants `'supplier_slug,sku'`(對齊 S3a 約束、逗號無空格)。
- **價格 delta gate(硬 gate、審查守則 1 + codex k1 MF1/MF2)**:**兩層比對**——`products` by `(supplier_slug, external_id)` 比 `price_general`(🔴 前台列表/卡片吃**商品層**基準價、S3b 改基準款排序鍵〔price_listing→price_retail〕會動到群最低價)+ `product_variants` by `(supplier_slug, sku)` 比 `price_general`;分批唯讀讀網站現存(別大 `.in()` 撞 URL 上限)。輸出 delta 清單(external_id/sku / 品名 / 舊價 / 新價 / 漲跌幅)+ **摘要分列**(商品降價數 / 變體降價數 / 新商品 / 新變體 / 消失項 / 最大漲跌)+ **異常列**(新價 null/0/負 / 單筆 ±>30%)。
  - **dry-run**:印完整兩層 delta 清單供 Sean 看(S3b-2 點頭依據)。
  - **正式寫入(非 dry-run)= 硬 gate**:同樣先算 delta。**異常列(新價 null/0/負/NaN)= 不可覆寫硬 abort**(無條件先擋、即使帶旗標也不放行、防髒值上線炸前台);**任何正式寫入**(無價變也算)→ 須帶明確旗標 `--confirm-write`、無旗標一律 abort(審查 codex k2 must-fix:原只 hasPriceChange 時擋有洞)+ delta 摘要印 log 留痕。**杜絕誤跑繞過 Sean 點頭擅自寫線上**(鐵則 12)。S5 排程化沿用此 gate。
- **pv_spec_unique preflight(硬 gate、codex k1 MF3)**:S3b 非首灌(7277→8878)、upsert by `(supplier_slug, sku)`;若同 `main_sku` 內新 view 出現重複 `spec`、或某 sku 更新後與同 product 既有另一列 spec 相同 → 批次 upsert 部分寫後才撞 `pv_spec_unique(product_id, spec)` 23505(髒中間態)。**dry-run preflight**:對 transform 後 source 檢查 `(supplier_slug, main_sku, 穩定序列化 spec)` 重複;**正式寫入前**也查 target 現況 + 模擬 upsert 後 `(product_id, spec)` 唯一性。有 collision → **先 abort 並列出 main_sku/sku/spec、不進任何 write batch**(避免部分寫的髒中間態)。新 product 尚無 product_id 時以 `(external_id, spec)` 為 synthetic key 分組模擬(codex k1 r2 consider、避免 preflight 漏判)。

## 3. 為什麼
源頭唯一真相(報價單 view)、廢髒前綴、停寫敏感成本(解 S1 CHECK)、複合鍵對齊報價單模型、為 OD(S6)鋪乾淨資料。

## 4. 影響面
- **價格**:全站零售降 ~14-17%(§1、Sean 拍)。經銷防護:price_store 欄 NULL、price_by_tier 整欄 view 不投射、零洩漏;**S3b 零動 view/grant/RLS/security_invoker**(三層防護 S1+16a 已建妥)。
- **資料量**:+~190 群/+~1601 變體(upsert 只增不減;消失群=S4 下架對賬、不在本片)。
- **前台**:商品圖/規格/標題/副標來源換 view 但形狀相同(親驗)→ 視覺不變;料號已 S3a 洗乾淨。
- **檔案大小**:rpm-fetch 砍欄+刪函式→降;transform 刪 metadata→降;import +delta gate ~+20 行;全 <400(鐵則 6)。tsconfig.scripts.json/eslint 已覆蓋、config 零動。

## 5. Rollback(誠實)
- **S3b-1**(程式)= `git revert`、乾淨對稱。
- **S3b-2**(bulk 同步)= **前進式、難真回滾**:舊 rpm-import 已壞(S3a 後單欄鍵 drop + 仍加前綴)不能當 rollback;已改價/新增列回退需另寫反向同步或 DB 快照還原。**主力防線=跑前 dry-run + delta gate 攔截**,非跑後復原。S3b-2 前 Sean 確認 PITR/快照 視窗(決策 D5)。

## 6. 操作順序 + gates
1. 本 plan → codex 關卡1 → Sean 批。
2. **S3b-1**:改 4 腳本 + 兩層 delta gate(硬 gate)+ pv_spec_unique preflight →(動手第一步先改 import 縮短 S3a 空窗、審查守則 3)→ 三綠(動 .ts 加 build)→ code-reviewer → **codex 關卡2**(命中鐵則 8+12 pricing/敏感)→ commit(精準 add、字面 vs 事實、不 push)→ 審查哨兵複驗。
3. **S3b-2**:`pnpm dlx tsx scripts/rpm-import.ts --dry-run --delta-full`(全量)→ 離群清單 + 兩層 delta + pv_spec preflight + 抽驗給 Sean →(D5 拍)→ 正式跑**帶 `--confirm-write` 旗標**寫線上(無旗標→硬 gate abort)→ MCP 唯讀抽驗(筆數 ~8878 變體/~1123 群、orphan 0、null price 0、經銷欄零洩、抽樣價對)→ 審查 §8.5-style live 複驗 + sign-off。
- 🔴 db push S3a → S3b-1 commit 前禁跑非 dry-run rpm-import。

## 7. Sean 決策(consolidated、回 Q:/A:)
- **D1 全站降價方向**:新合約零售=`price_retail`(報價單真實零售)是對的方向嗎?(A 是、`price_listing` 17300 是過時 listing、降到真實零售 14800 上線〔實際每 sku 漲跌看 S3b-2 dry-run delta 清單再最終點頭〕/ B 暫緩、價格切換另案評估、S3b 先只做結構不切價〔較複雜、價與結構耦合〕)。**建議 A**(price_retail 是唯一真相、且 delta gate 仍會讓你 S3b-2 看清單再拍)。
- **D2 拆 S3b-1 + S3b-2**:(A 拆〔建議〕/ B 不拆)。
- **D3 source_corrected/manually_corrected**(view 無此欄、現存 metadata):(A 停寫、接受標記消失、M-5-03 鎖值機制改由報價單 B庫側負責〔建議、Q1=A 切乾淨 view 的自然結果〕/ B 請 S0 把 manually_corrected 加進 view 保留)。
- **D4 metadata.name_en**:我**預設續留**=view.product_name(英文、零行為變更、非敏感);若你要刪改說。
- **D5 S3b-2 前資料保險**(後續 S3b-2 才需、先預告):(A 確認 PITR/快照後跑全量 / B 接受前進式靠 delta gate / **C 先單群 `--group=APRILIA-01` 上線抽驗肉眼確認再全量〔建議〕**)。
- **D-desc 定案 ✅**(dry-run 抓到、Sean 拍):description **移出 S3b scope**——view 對 RPM 全空(親驗 8878 列 0 描述)、不抓不寫(upsert 省此欄 → 現有 933 英文描述原地保留、新 ~190 品留 NULL〔nullable 零約束問題〕);描述交獨立中文化 workstream(baoyu-translate→台灣校對 pilot 測中)、backlog 立項。

## 8. 真連線唯讀探查紀錄(2026-06-02、只查形狀/count、不取敏感)
- env/rollback lens(B庫 anon 親驗):anon publishable key 讀 view OK、零 permission denied;price_listing 17300 vs price_retail 14800(全 8878 降)。
- 主 session 探查(storefront_catalog_v、supplier_slug='rpm'):images=`[{url}]` / spec=object 值全 string / stock_status=`in_stock`,`out` / main_sku 全大寫 distinct=1123 / major_category 單一`Body` / brand distinct=10〔車輛品牌、非供應商〕/ price_retail null·≤0=0 列 / fitment 空=0 列 / 8878 變體。

— END —
