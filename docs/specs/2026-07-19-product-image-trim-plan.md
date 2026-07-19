# 商品卡去白邊縮放(product image trim)plan v1.1

> 2026-07-19。Sean 拍板 Q1=B(一步到位、不做 CSS contain 過渡)+「用 Fable 審查一次、沒問題就開工」。
> v1.1:Fable 關卡1 R1 NO-GO(F1 資料物件誤認+雙資料路/F2 default grant/F3 露底色)三 must-fix + 7 nit 全數落字修正;銷案表見 §8。**R2 複核 VERDICT=GO**(0 must-fix;new-nit-A 影響面舊字面/new-nit-B 章節順序皆已順手清)。
> 背景:商品目錄卡片 `object-fit: cover` 對供應商原圖一律放大裁切,白邊大的圖商品顯小、商品佔比大的圖被切邊(Sean 截圖實錘=GB Racing 電盤蓋)。
> 目標:每張卡片圖預先算出「非白內容邊界框(bbox)」存 DB,前端用現成數字做去白邊等比縮放——不切商品、整排視覺一致、**客人端零運算零額外下載**。
> 鐵則 8 命中(schema+跨 3 檔+動 CI)→ 本 plan 送審;鐵則 12 命中(migration)→ S1/S4 commit 前跑關卡2。

## 0. Sean 三條件(硬約束)

1. **每日自動**:新圖由既有每日同步(GitHub Actions `rpm-sync.yml`、台灣 03:00)自動補算,Sean 零操作。
2. **不影響既有**:products 表零改動;無 trim 資料=照現狀顯示(最壞=現狀);掃描失敗不擋同步。
3. **來源零變更**:圖片仍在供應商 CDN、URL 不動、不搬圖、不加外部付費服務。

## 1. 相關既有紀錄與連動面(偵察 pass 2026-07-19)

- 圖片資料流(v1.1 依 Fable F1 更正):`products.images jsonb`(`20260507004826_init_products.sql:32`)→ **兩條卡片資料路**:①車款目錄走 RPC `search_catalog_by_vehicle`(JSON 打包於 `20260712183000_products_catalog_page_public.sql:82-97`;同檔 L5-31 是平面 view `products_list_public`、`security_invoker=true`)②首頁精選/全目錄/相關商品/車款頁走 `products_public` view(`20260510134708_products_public_view.sql`;`apps/storefront/src/lib/products.ts:513` 一帶)→ `toUIProduct`。→ domain `images: string[]`(`packages/domain/src/catalog/types.ts:194`)→ `MockProduct.image?`(`mock-products.ts:118`)。**S1 必須兩條路都曝光 trim,否則首頁/相關商品卡與目錄卡不一致**;`products_list_public` 的直接消費端於 S1 實作時 grep 確認、有消費才第三處曝光。
- 每日同步:`.github/workflows/rpm-sync.yml` cron `0 19 * * *`、matrix 12 家 `max-parallel:1`、`fail-fast:false`;寫 products 於 `scripts/rpm-import.ts:491`;代表圖組裝於 `scripts/rpm-transform.ts:366-401`。
- 商品卡:`ProductCard.tsx:87-99`(inline `objectFit:'cover'`、hover scale 1.04、onError 退 placeholder);格子 `.pcard-img-wrap { aspect-ratio: 1/1 }`(`product-card.css:31`)。消費端=ProductsPage/ProductRelated/HomeSelect/OverviewTab(皆經 ProductCard)。
- **不在範圍**:`CartView.tsx:124` 購物車裸 img 縮圖、`ProductGallery.tsx` 詳情頁大圖——皆不動。
- 依賴:sharp 0.34.5 僅為 Next 傳遞依賴(lockfile 已含 darwin+linux prebuilt)、**無 package.json 直接宣告**;repo **無**抓外部圖 bytes 先例(逾時/重試/UA 須新建)。
- DB:無 per-image metadata 表先例;migration 慣例 `YYYYMMDDHHMMSS_<milestone>_<slug>.sql`;最新=`20260719120000`。
- 圖片主機多網域(cdn.shopify.com/www.cncracing.com/eazi-grip/racebikebitzusa/materya.shop/bonamiciracing.it/R2 等)。
- 既有教訓連動:security_invoker view 需 anon column 級 grant(memory `project_website-subcategory-two-level`);rollback 交付=forward-only migration、SQL Editor 只當 break-glass(B-2 §15.4);新表 RPC/GRANT 對齊 sibling 慣例(memory `feedback_new-rpc-align-sibling-gates`)。

## 2. Schema(S1;新表、純加法)

```sql
-- 20260719150000_catalog_product_image_trim.sql(實際檔名;交易保證來自 supabase db push 的 apply 路徑、檔內不自帶 BEGIN/COMMIT;codex 關卡2 nit-1 更正)
CREATE TABLE public.product_image_trim (
  url            text PRIMARY KEY CHECK (btrim(url) <> ''),
  status         text NOT NULL CHECK (status IN ('ok','no_trim','failed')),
  -- bbox 皆為 0..1 內容框比例(相對原圖);status='ok' 才有值
  bbox_left      numeric(6,5) CHECK (bbox_left  >= 0 AND bbox_left  < 1),
  bbox_top       numeric(6,5) CHECK (bbox_top   >= 0 AND bbox_top   < 1),
  bbox_width     numeric(6,5) CHECK (bbox_width  > 0 AND bbox_width  <= 1),
  bbox_height    numeric(6,5) CHECK (bbox_height > 0 AND bbox_height <= 1),
  natural_width  integer CHECK (natural_width  > 0),
  natural_height integer CHECK (natural_height > 0),
  analyzed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bbox_complete CHECK (
    status <> 'ok' OR (bbox_left IS NOT NULL AND bbox_top IS NOT NULL AND bbox_width IS NOT NULL
      AND bbox_height IS NOT NULL AND natural_width IS NOT NULL AND natural_height IS NOT NULL
      AND bbox_left + bbox_width <= 1 AND bbox_top + bbox_height <= 1)
  ),
  -- nit-5:非 ok 列 bbox 強制 NULL(failed/no_trim 不得殘留舊值)
  CONSTRAINT bbox_null_unless_ok CHECK (
    status = 'ok' OR (bbox_left IS NULL AND bbox_top IS NULL AND bbox_width IS NULL
      AND bbox_height IS NULL AND natural_width IS NULL AND natural_height IS NULL)
  )
);
ALTER TABLE public.product_image_trim ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_image_trim_public_read ON public.product_image_trim FOR SELECT USING (true);
-- F2:Supabase default privileges 會給新表 anon/authenticated 全權(B-2 function 層同款實測)→ 必先全收再窄放
REVOKE ALL ON public.product_image_trim FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.product_image_trim TO anon, authenticated;
-- MF-3:service_role 寫入路顯式授與、不靠 default privileges 隱式保留
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_image_trim TO service_role;
-- 寫入僅 service key(scripts/CI);驗收 has_table_privilege 斷言 anon INSERT/UPDATE/DELETE 皆 false + service_role 正向
```

- 無 PII、無金額;url=供應商公開 CDN 位址。URL query string 換版會留孤兒列(只增不減、無 GC)=已知接受,量級小(nit-5 註記)。
- **曝光兩條路(F1)**,同 migration 內,**wire 鍵名兩路統一=`card_image_trim`**(codex 關卡2 MF-2):①RPC `search_catalog_by_vehicle` CREATE OR REPLACE(**同簽章**、無 42725 風險),卡片 `jsonb_build_object` 加 `card_image_trim` 鍵——**count/排序/分頁先在 paged CTE 收斂至 ≤100 列、之後才 LEFT JOIN trim 表**(MF-4;on `card_image=url AND status='ok'`,無資料=null)②`products_public` view **末尾加欄** `card_image_trim jsonb`(末尾加欄合法;同樣 LEFT JOIN on `images->>0`)。`products_list_public` 消費端 grep 已做=僅 sitemap id+handle 輕量投影與 RPC 內部、無第三處曝光。anon 對 trim 表的 SELECT GRANT 補齊 security_invoker 底層權限;**service_role 顯式 GRANT SELECT/INSERT/UPDATE/DELETE**(MF-3、不靠 default privileges)。migration 尾 `NOTIFY pgrst, 'reload schema'`(MF-6、view 加欄=schema metadata 變更)。
- **apply=Sean `db push`**(慣例);apply 後路徑②驗收:表存在+RLS on+anon 只讀(`has_table_privilege`:SELECT true、INSERT/UPDATE/DELETE false)+**service_role 寫入正向**+**PostgREST 層 smoke**(publishable key 直查 `products_public` 選 `card_image_trim` 欄 + 呼 RPC 驗卡片 JSON 含 `card_image_trim` 鍵;不能只用直連 PG 代替=MF-6)。

## 3. 掃描腳本(S2;`scripts/image-trim-scan.ts`)

- 輸入:`SELECT DISTINCT p.images->>0` 於 products(非下架)`EXCEPT` trim 表已有 url(增量);`--full` 全量、`--limit N` 上限、`--confirm-write` 慣例對齊 rpm-import。
- 逐 url:fetch bytes(瀏覽器 UA、逾時 15s、重試 1 次、**同 host 併發 ≤2** 禮貌上限、單圖 ≤10MB 保險)→ sharp `.rotate()`(nit-4:先套 EXIF orientation,使 bbox 與瀏覽器顯示座標一致)→ `.trim({ background:'#ffffff', threshold:16 })` 取 `trimOffsetLeft/Top`(**nit-2:sharp 回報負值、必取絕對值**)+ 裁後尺寸 + rotate 後原尺寸 → bbox 比例。
- 判定:裁不動(bbox≈整圖,寬高皆 >0.97)→ `no_trim`;bbox 面積 <2% 或任一維 ≤0(異常)→ `failed`;其餘 → `ok`。深底情境圖落 `no_trim` 的理由(nit-3 更正)=**plan 指定 background:'#ffffff'**、深底與白差距超過 threshold 故裁不動(非 sharp 預設左上角色行為);透明底 PNG 依 sharp d.ts 以 alpha+非 alpha 聯合 bbox 裁切 → 會落 `ok` 且結果正確(與「非白底=no_trim」字面不同、屬預期)。
- 失敗容錯:fetch/decode 失敗 → `failed` 行照寫(analyzed_at 供重試判斷);**任何單圖失敗不中斷批次、腳本結尾 exit 0**(summary 印 ok/no_trim/failed 計數);`failed` 且 `analyzed_at` >7 天者納入增量重試。
- sharp 升 root devDependency(lockfile 既有 0.34.5 prebuilt,darwin/linux 皆可,CI ubuntu 免 apt)。
- **首灌**(MF-1 精確化):S2 的 slice=寫腳本+單測(15-45 分內);**全量首灌是腳本的一次長時間「執行」非 slice 本體**,天然可續跑(增量=EXCEPT 已有 url,中斷重跑自動接續、無需 checkpoint 檔),屬本 plan 已含、Sean 已批的 production 寫入動作(比照 rpm-import --confirm-write 慣例;12,145 群、估 2-4h、背景跑)。寫入用 service key(env 既有慣例、不進 git)。

## 4. CI 增量掛點(S3;`rpm-sync.yml`)

- matrix 全家跑完後新增獨立 job `image-trim-scan`(`needs: sync`、`if: ${{ !cancelled() }}`——nit-7:cancel 時不跑、sync 部分失敗仍跑):`pnpm exec tsx scripts/image-trim-scan.ts --confirm-write --limit=800`(等號式=parseArgs 唯一支援形式;S2 code-reviewer Important 抓 plan/腳本字面不同構、以腳本為準同步)。
- job 自帶 env secrets(與 sync job 同組 SUPABASE URL/service key 引用;nit-7)。
- 失敗不影響主同步(獨立 job、`continue-on-error: true`);--limit 防 CI 時長失控(單日新圖遠低於 800;積壓自然逐日消化)。

## 5. 前端(S4;ProductCard 接線)

- 資料流(F1+MF-2 更正):wire 鍵/欄名兩路皆 `card_image_trim`,但**映射入口有兩個**——①RPC 路走 `catalogRowToUIProduct`(`apps/storefront/src/lib/catalog-page.ts`)②`products_public` 路走 adapter→domain→`toUIProduct`(`lib/products.ts`)。S4 必須**抽共用 runtime parser**(clamp+形狀驗證單一來源)、兩個 mapper 都接、各附測試,收斂到 `MockProduct.imageTrim?: {l,t,w,h,nw,nh}`(optional、純加法);漏接任一路=不同頁商品卡不一致。
- **底色策略(F3)**:trim 生效時 `.pcard-gallery` 背景改**純白**(去白邊圖與白底無縫;現行彩色漸層底只留給無 trim 的 cover 路徑)。此屬品味預設:Sean 肉眼驗實品後若偏好漸層框,改一行 CSS 即可、不動資料層。
- 渲染數學(通用瀏覽器、不依賴 object-view-box):框=正方形;目標=內容框等比縮放至佔框 92%(P=0.92)置中。
  - 內容像素框 `cw=w*nw, ch=h*nh`;`scale = P*F/max(cw,ch)`(F=框邊長,以 % 表達免量測):img 顯示寬 `= P*100/max(w, h*(nh/nw)*ar…)`——實作為純函式 `computeTrimStyle(trim)` 回 `{width%, left%, top%}` inline style,wrapper `overflow:hidden` 沿用。
  - **防髒數據 clamp**:l/t∈[0,1)、w/h∈(0,1]、l+w≤1、t+h≤1、nw/nh>0、縮放倍率上限 3×(超界=退回現狀 cover);單元測試鎖 clamp。
- 無 `imageTrim`/clamp 未過/`no_trim`=現行 cover 路徑 **byte 不變**;hover scale 1.04 與 onError placeholder 沿用(nit-6:hover origin=img 中心、bbox 不對稱時微漂移 ≤2% 框寬=接受)。
- **design 對齊(MF-1)**:design-reference 商品卡無 trim 先例(cover 行為源自 design);本功能=Sean 2026-07-19 拍板的**行為層授權偏離**(截圖實錘切邊痛點、Q1=B),卡片佈局/字級/token 字面不動;S4 收尾於 manifest 補 business_override 條目(對齊 typeahead 前例)。
- 測試:`computeTrimStyle` 純函式測(正常/邊界/髒數據)+ ProductCard 有/無 trim 兩渲染案。

## 6. 影響面 / 風險 / rollback

- **影響面**(R2 補全):新表+RPC JSON 加鍵+`products_public` 末尾加欄(products 表零動)/ rpm-sync.yml 加一獨立 job / scripts 新檔+sharp devDep / storefront:`lib/products.ts`+`lib/catalog-page.ts`(兩 mapper)+共用 parser 新檔+`data/mock-products.ts`(MockProduct 型別)+`ProductCard.tsx`+`product-card.css`+測試+manifest;`packages/adapters` domain 映射與 `database.types.ts` 視 S4a 需要小改(generated types 落後=既有 B-4 慣例)。結帳/金流/會員/admin 零觸碰。
- **風險與緩解**:①CDN 擋 CI IP → failed 行+7 天重試、不擋同步;②髒數據放大破版 → 前端 clamp+上限;③view replace 手滑 → migration 內含 view 完整定義、apply 後 anon smoke;④sharp CI 原生依賴 → lockfile prebuilt 已含、frozen install 即用;⑤同站禮貌 → 同 host 併發 ≤2+UA。
- **rollback(MF-5)**:前端天然降級(trim 表清空/JSON 鍵回 null=回現狀);結構退場=**完整可執行 rollback SQL 已落 `docs/reviews/2026-07-19-trim-s1-rollback.md`**(舊 12 鍵 RPC 全文重套 → DROP+CREATE 18 欄 view+GRANT/COMMENT → DROP 表 → NOTIFY pgrst;已於拋棄式 PG 17 實測 apply→rollback→三斷言回基線)。正常退場包成新時戳 forward-only migration 走 db push;SQL Editor 僅 break-glass(B-2 教訓)。⚠️ PG 不允許 REPLACE 減欄、view 還原必走 DROP+CREATE。
- 內容分級:**系統衍生資料(圖片幾何量測),非內容、L1/L2/L3 內容分級不適用**(鐵則 9 針對人編文案/展示內容;本表無文案、由管線自動生成與更新;codex 關卡2 MF-1 精確化)。

## 7. 拆片與審查

| 片 | 內容 | 審查 |
|---|---|---|
| S1 | migration(表+RLS+GRANT+RPC+view)+ Sean db push + 路徑②驗收 | 關卡2(migration=鐵則 12;codex 額度卡 → adversarial-reviewer+Fable) |
| S2 | 掃描腳本 + sharp dep + 單測(**不含首灌**) | code-reviewer |
| OP-首灌 | **獨立作業非 slice**(S1 apply+S2 收案後執行;plan 已批的 production 寫入、本機背景跑、可續跑、中斷重跑自動接續) | 執行紀錄進報告 |
| S3 | CI job | code-reviewer |
| S4a | 資料接線(RPC/adapter 兩 mapper + 共用 runtime parser + MockProduct.imageTrim + 測試) | code-reviewer |
| S4b | ProductCard TSX+CSS(鐵則 5 同片)+ 白底策略 + manifest business_override + 實跑截圖 | 關卡2(同 S1 條件) |

順序:S1→S2→OP-首灌→S4a→S4b(前端見真數據)→S3(CI 收尾)。每片三綠;S4b 加 build+實跑截圖。前端兩片天然向後相容(apply 前欄/鍵不存在=undefined=現狀 fallback)。

## 8. Fable 關卡1 銷案表(R1 NO-GO → v1.1;R2 GO)

| # | 級別 | 處置 |
|---|---|---|
| F1 資料物件誤認+雙資料路 | must-fix | §1/§2/§5 重寫:RPC JSON 加鍵+`products_public` 末尾加欄、兩路同映射;`products_list_public` 消費端 S1 grep 決定第三處 |
| F2 default grant 陷阱 | must-fix | §2 DDL 補 REVOKE ALL→GRANT SELECT;驗收斷言 anon 寫權三項 false |
| F3 trim 露彩色漸層底 | must-fix | §5 定案:trim 生效底=純白(預設);Sean 肉眼驗可一行 CSS 改回 |
| nit-1 行號錯 | nit | §1 更正 `mock-products.ts:118` |
| nit-2 offset 負值 | nit | §3 明記取絕對值 |
| nit-3 深底理由誤植 | nit | §3 更正理由+透明底 PNG 行為補述 |
| nit-4 EXIF | nit | §3 `.rotate()` 前置 |
| nit-5 非 ok 殘值+孤兒 | nit | §2 加 `bbox_null_unless_ok` CHECK+孤兒接受註記 |
| nit-6 hover 漂移 | nit | §5 註記接受 |
| nit-7 CI secrets/cancel | nit | §4 env 明列+`!cancelled()` |
| new-nit-A 影響面舊字面 | nit | §6 首句更正 |
| new-nit-B 章節順序 | nit | §8 移文末 |

## 9. codex 關卡2 S1 銷案表(R1 FAIL 6 must-fix + 2 nit → 全修)

| # | 處置 |
|---|---|
| MF-1 切片合規 | §3 首灌=可續跑執行非 slice 本體/§5 補 design 偏離+business_override/§6 分級改「系統衍生資料不適用」 |
| MF-2 鍵名+雙 mapper | §2/§5 統一 `card_image_trim`;S4 明列 catalogRowToUIProduct+toUIProduct 兩入口+共用 parser |
| MF-3 service_role 顯式 GRANT | migration 補 GRANT S/I/U/D TO service_role;拋棄式 PG service_role 寫入正向實測過 |
| MF-4 JOIN 移分頁後 | RPC 兩分支改 paged CTE(≤100 列才 JOIN);15k 列 force_generic_plan 實測 4-11ms |
| MF-5 rollback 可執行 | 完整 SQL 落 `docs/reviews/2026-07-19-trim-s1-rollback.md`;拋棄式 PG apply→rollback→三斷言回基線實測 |
| MF-6 PostgREST cache | migration 尾 NOTIFY pgrst;路徑②加 publishable key 層 smoke(view 欄+RPC 鍵) |
| nit-1 檔名/交易字面 | §2 更正實際檔名+交易保證限定 db push 路徑 |
| nit-2 url 空白 | DDL 補 `CHECK (btrim(url) <> '')` |

**R2(2 must-fix + 1 nit → 全修;皆機械字面同步、零設計分歧,依 E2a-a Q14=A 前例修完收案不開 R3、明列 Sean 可否決)**:

| # | 處置 |
|---|---|
| R2-MF-1 plan §2 DDL 範例漏同步(btrim CHECK+service_role GRANT) | §2 code fence 與 migration 對齊 |
| R2-MF-2 拆片表未跟上(§7 S2 仍含首灌/S4 過大) | §7 改 S2 不含首灌+OP-首灌獨立作業列+S4 拆 S4a/S4b;§6 影響面補列兩 mapper/parser/型別檔 |
| R2-nit rollback 斷言未限定 schema/簽章 | 斷言改 to_regclass+table_schema+regprocedure,並對測試庫實跑 true |
