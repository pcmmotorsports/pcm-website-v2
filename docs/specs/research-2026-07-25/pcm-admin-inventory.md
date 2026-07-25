# PCM admin 現況盤點(第二輪 — 訂單以外全部)

> 前輪(訂單領域)在 `pcm-order-inventory.md`,本檔不重複訂單細節,只在跨域處引用。
> 產出時間基準:repo `dev` branch,2026-07-25。只讀盤點,零改檔。

---

## 1. admin 完整頁面地圖(`apps/admin/src/app/`,排除 orders)

| Route | 檔案:行數 | 類型 | 功能 |
|---|---|---|---|
| `/` | `apps/admin/src/app/page.tsx:1-60` | 總覽/dashboard | 首頁總覽(內容待查細節,60 行) |
| `/customers` | `apps/admin/src/app/customers/page.tsx:1-70` | **列表頁** | 客戶清單(分頁+篩選) |
| `/customers/[id]` | `apps/admin/src/app/customers/[id]/page.tsx:1-104` | **詳情/表單頁** | 單一客戶詳情、tier 編輯、儲值金調整 |
| `/settings/order-statuses` | `apps/admin/src/app/settings/order-statuses/page.tsx:1-69` | **設定頁**(列表+表單混合) | 訂單狀態選項管理(新增/編輯 status option) |
| `/api/sso/start` | `apps/admin/src/app/api/sso/start/route.ts` | API route(非頁面) | SSO 登入啟動 |
| `/api/sso/callback` | `apps/admin/src/app/api/sso/callback/route.ts` | API route(非頁面) | SSO callback |
| `layout.tsx` | `apps/admin/src/app/layout.tsx:1-40` | 全域 layout | 側邊欄+頁首殼 |

**排除訂單後,admin 只有 3 個實際業務頁面:客戶列表、客戶詳情(含 tier/wallet 表單)、訂單狀態設定。沒有其他 route。**
查無:products/brands/categories/suppliers/inventory 任何頁面 —— `find apps/admin/src/app -type d` 只列出 `api/sso`、`customers`、`customers/[id]`、`orders`、`orders/[id]`、`settings`、`settings/order-statuses`。

---

## 2. admin 共用元件與版面

### Layout / 導覽
- `apps/admin/src/components/layout/app-sidebar.tsx:1-78` — 側邊選單。`NAV_ITEMS`(L23-28)硬列 4 項:總覽`/`、訂單`/orders`、客戶`/customers`、設定`/settings/order-statuses`。**無 products/brands/categories 項目**。註解 L18-20 明寫「精簡自 Kiranism starter,砍 Clerk / nav-config 動態導覽」。
- `apps/admin/src/components/layout/header.tsx:1-33` — 頁首。

### shadcn 基礎元件(`apps/admin/src/components/ui/`)
`breadcrumb.tsx` `button.tsx` `input.tsx` `separator.tsx` `sheet.tsx` `sidebar.tsx` `skeleton.tsx` `spinner.tsx` `tooltip.tsx` — 標準 shadcn primitives,非 PCM 自製。

### 跨域共用(`apps/admin/src/components/shared/`)
- `list-pagination.tsx:1-70` — 通用 server 端分頁(prev/next `<Link>`,orders/customers 共用;函式 `ListPagination`)。
- `multi-check-filter.tsx:1-72` — 多選篩選元件。
- `select-filter.tsx:1-36` — 單選篩選元件。
- `auto-apply-select.tsx:1-42` — 自動套用的 select(URL 同步)。

**結論:有共用的「篩選/分頁」原子元件,但沒有共用的「列表頁」或「表單頁」抽象組件(如 `<DataTable>` / `<AdminForm>`)。** 每個域各寫各的:
- 表格各寫一份:`orders-table.tsx:210 行` vs `customers-table.tsx:60 行` —— 無共用 Table 抽象。
- 表單各寫一份:`order-edit-form.tsx:90` / `tier-edit-form.tsx:62` / `wallet-adjust-form.tsx:60` / `status-option-create-form.tsx` / `status-option-edit-row.tsx` —— 無共用 Form 抽象,各自手刻 `<form action={...}>` + FormData。
- 篩選列各寫一份:`order-filter-bar.tsx:49` vs `customer-filter-bar.tsx:37`(各自組裝上面的 shared filter 原子)。
- Result banner 也各寫一份(非共用):`orders/result-banner.tsx:29` vs `settings/settings-result-banner.tsx:32` —— 兩份幾乎同構但未抽共用,查無單一 toast/banner 系統(grep `banner|toast|Modal` 只命中這兩檔 + `icons.tsx`/`order-filter-controls.tsx` 的無關字串)。
- **查無 Modal 元件**:`grep -rn "Modal" apps/admin/src/components` 除上述兩檔外無命中,admin 內操作走「整頁表單/整頁 sheet(`ui/sheet.tsx`)」而非 modal dialog。

### 誰用誰(bindings)
- `order-detail.tsx:249` → 用 `order-edit-form.tsx` + `workflow-status-select.tsx` + `item-workflow-status-cell.tsx` + `result-banner.tsx`。
- `customer-detail.tsx:161` → 用 `customer-detail-sections.tsx` + `tier-edit-form.tsx`(→`tier-edit-submit.tsx`)+ `wallet-adjust-form.tsx`(→`wallet-adjust-submit.tsx`)。
- `orders-table.tsx` / `customers-table.tsx` → 各自用 `list-pagination.tsx`。
- `order-filter-bar.tsx` / `customer-filter-bar.tsx` → 用 `multi-check-filter.tsx` / `select-filter.tsx` / `auto-apply-select.tsx`。

---

## 3. 商品領域資料表(`supabase/migrations/`)

### `products`(`supabase/migrations/20260507004826_init_products.sql:23-48`,後續多次 ALTER)
- 核心欄:`id uuid PK` `external_id text UNIQUE` `title` `subtitle` `description` `handle text UNIQUE` `price_by_tier jsonb`(CHECK 含 `general`+`store` 兩 key,`20260511180231:44-47` 已從三 key 改二 key)`fitments jsonb DEFAULT []` `images jsonb DEFAULT []` `availability text`(CHECK in-stock/out-of-stock)`brand_id → brands(ON DELETE RESTRICT)` `category_id → categories(ON DELETE RESTRICT)` `metadata jsonb`。
- 後續 ALTER 累加欄(`20260516064013:10-11`)`price_general integer` `price_store integer`(經銷敏感);(`20260602135934:34,47`)`supplier_slug text NOT NULL DEFAULT 'rpm'` `delisted_at timestamptz`(軟下架);(`20260708120000:30`)`highlights jsonb DEFAULT []`(賣點條列);(`20260709120000:35-36`)`manuals jsonb DEFAULT []`(說明書 `[{label,url,sizeKB?}]`)`video_url text`。
- 關鍵約束:`price_by_tier_keys` CHECK、`availability_valid` CHECK、`products_metadata_no_sensitive` CHECK(擋 shopee/cost/source_amount/source_currency 寫入,`20260602135934:88-90`)。
- 防護三層(反覆出現於多個 migration):REVOKE ALL + 逐欄 GRANT(`20260519031049`,本輪只讀到後續引用,未展開全檔)/ `products_public`、`products_list_public` security_invoker view 排除 `price_by_tier`/`price_store`/`metadata`/`delisted_at` / RLS `USING(delisted_at IS NULL)`。
- 索引:`idx_products_brand_id` `idx_products_category_id` `idx_products_availability` `idx_products_supplier_slug`。

### `brands`(`supabase/migrations/20260505130758_init_brands_categories.sql:22-30`)
- `id uuid PK` `name text UNIQUE` `slug text UNIQUE` `description` `logo_url` `created_at` `updated_at`。
- `20260511180231:27-28` 加 `premium_extra_pct integer NOT NULL DEFAULT 0 CHECK(0-30)`。
- RLS:SELECT 公開、INSERT/UPDATE/DELETE service_role only(4 policy,`:57-79`)。

### `categories`(同檔 `:38-47`)
- `id uuid PK` `parent_category_id → categories(RESTRICT)` `name` `raw_path text UNIQUE` `segments jsonb` `sort_order` `created_at` `updated_at`。
- 索引 `idx_categories_parent_category_id`;RLS 同 brands 4-policy 模式。
- `20260712120000_seed_taxonomy_v2_categories.sql` 為 seed(非 schema 變動,本輪未展開讀)。

### `product_variants`(`supabase/migrations/20260531142533_init_product_variants.sql:39-67`)
- `id uuid PK` `product_id → products(CASCADE)` `sku text UNIQUE`(join key)`spec jsonb`(CHECK object)`price_general integer` `price_store integer`(🔴經銷敏感,view 永遠排除)`availability` `images jsonb` `sort_order` `metadata jsonb`(CHECK object)`created_at` `updated_at`。
- 約束:`pv_spec_unique UNIQUE(product_id, spec)`、`pv_price_general/store_non_negative`、`pv_images_is_array`、`pv_metadata_is_object`。
- `20260602135934:35` 加 `supplier_slug`。
- 三層防護:`REVOKE ALL ... FROM anon,authenticated` + column GRANT(`:86-91`)/ `product_variants_public` view(`:99-113`,10 欄,排除 price_store+metadata)/ RLS 4-policy(`:125-149`)。

### `product_fitments`(`supabase/migrations/20260708130000_create_product_fitments_index.sql:24-34`)
- 衍生索引表(單一真相仍是 `products.fitments` jsonb,trigger 自動同步 — `sync_product_fitments()`)。
- `id bigint identity PK` `product_id → products(CASCADE)` `moto_brand text` `model_code text` `year_start int` `year_end int`,CHECK 四態不變式。
- 索引:`ix_pf_lookup(moto_brand,model_code,year_start,year_end)` `ix_pf_product(product_id)`。

### `product_image_trim`(`supabase/migrations/20260719150000_catalog_product_image_trim.sql:34-50+`)
- `url text PK` `status text CHECK(ok/no_trim/failed)` `bbox_left/top/width/height numeric(6,5)` `natural_width/height integer` `analyzed_at`。CHECK `bbox_complete` 連動 status。寫入僅 service key(`scripts/image-trim-scan.ts`),anon/authenticated 只讀。

### 查無
- **無獨立 `suppliers` 表**:只有 `products.supplier_slug` / `product_variants.supplier_slug` text 欄(`20260602135934:34-35`),供應商是字串列舉不是關聯表。grep `CREATE TABLE.*supplier` 全 migrations 零命中。
- **無獨立圖片表**:圖片存 `products.images` / `product_variants.images` jsonb 陣列欄,非正規化表(`product_image_trim` 只存 bbox 裁切資訊、非圖片主檔)。
- **無獨立 manuals 表**:`manuals` 是 `products.manuals` jsonb 欄,非正規化表。

---

## 4. 會員/價格領域資料表

### `customers`(`supabase/migrations/20260523034911_init_customers_and_subtables.sql:14-25`)
- `user_id uuid PK → auth.users(CASCADE)` `email UNIQUE` `name` `phone` `birthday date` `tier member_tier`(enum `general/store/premiumStore`,`:8`)`wallet_balance integer DEFAULT 0` `total_deposit integer DEFAULT 0` `created_at` `updated_at`。
- RLS:客人 SELECT/UPDATE own(`:146-153`),INSERT/DELETE service_role only。Column GRANT:authenticated 只能 UPDATE `(name,phone,birthday,updated_at)`(`:229-231`)— **tier/wallet_balance/total_deposit 不開 UPDATE 給 authenticated**,唯一寫入路是 RPC(見 §5)。
- Trigger:`on_auth_user_created`(auth.users INSERT → 自動建 customers row,`:278-294`)、`on_wallet_ledger_inserted`(ledger INSERT → 同步 wallet_balance/total_deposit,`:300-315`)。

### `customer_addresses`(同檔 `:40-60`)
- `id` `customer_user_id → customers(CASCADE)` `is_default bool` `name` `phone` `line`(地址)`invoice_type enum(personal/company/donate)` `invoice_carrier` `invoice_title` `invoice_tax_id` `invoice_donate_code` `created_at` `updated_at`。CHECK company 須填 title+tax_id、donate 須填 code。唯一索引:每 customer 至多一筆 `is_default`。
- RLS/GRANT:authenticated 全欄可 CRUD own(`:236`)。

### `customer_vehicles`(同檔 `:72-84`)
- `id` `customer_user_id` `is_primary bool` `name`(車型)`year text` `engine` `km` `mods` `service date` `created_at` `updated_at`。唯一索引每 customer 至多一輛 `is_primary`。
- 註解(`:92`)明寫 Phase 2 升級為獨立 Vehicle entity。

### `customer_wallet_ledger`(同檔 `:99-113`)
- `id` `customer_user_id` `entry_date date` `entry_type wallet_entry_type`(enum `deposit/use/refund`)`amount integer`(signed,CHECK 符號對應 entry_type)`note text` `related_order_id uuid`(Phase 1 留 null)`created_at`。
- **Immutable**:無 UPDATE/DELETE policy(全拒),只 SELECT own + INSERT service_role。
- 對帳工具 view:`customer_wallet_balance_check`(`:125-136`,security_invoker,admin 專用、不開 anon/authenticated)。

### `brands.premium_extra_pct`(`20260511180231:27-28`)— 定價領域跨欄,見 §3。

### 查無
- **無獨立「經銷價設定表」**:經銷價機制 = `products.price_store` / `product_variants.price_store` 欄位 + `customers.tier` 三檔,非獨立表。
- **無「addresses/vehicles」的後台管理路徑**——本輪未在 admin app 找到任何操作這兩表的 server action(grep 見 §5,只查到 customers 表本身的 tier/wallet RPC)。

---

## 5. 後台可寫入路徑(server action + SECURITY DEFINER RPC)

### admin app server actions(`'use server'`,排除 orders 已於前輪盤點)
| 函式 | 檔案:行號 | 功能 |
|---|---|---|
| `setTierAction` | `apps/admin/src/lib/customers/tier-actions.ts:31` | 呼叫 `admin_set_customer_tier` RPC 改會員 tier |
| `adjustWalletAction` | `apps/admin/src/lib/customers/wallet-actions.ts:29` | 呼叫 `admin_adjust_wallet` RPC 加值/扣款 |
| `selectActorAction` | `apps/admin/src/lib/session/actor-actions.ts:16` | 選擇/切換 session actor(具名操作者身分,非業務寫入) |
| `updateStatusOptionAction` | `apps/admin/src/lib/orders/status-option-actions.ts:42` | 編輯訂單狀態選項(設定頁,非訂單本體) |
| `createStatusOptionAction` | `apps/admin/src/lib/orders/status-option-actions.ts:122` | 新增訂單狀態選項 |

全部經共用授權閘 `authorizeAdminMutation()`(`apps/admin/src/lib/session/authorize.ts:24-35`):① `verifySession` cookie 自驗 ② Origin fail-closed ③ 具名 actor 解析,三者任一失敗回 `null`。

### SECURITY DEFINER RPC(非訂單域,`supabase/migrations/`)
| RPC | 檔案:行號 | 功能 |
|---|---|---|
| `admin_set_customer_tier(customer_user_id, tier, note, actor, request_id)` | `20260717010000_m4a_admin_set_customer_tier_rpc.sql:42` | 後台改會員 tier,UPDATE 單欄+`admin_audit_log` 同交易 INSERT;同值冪等回 `NO_CHANGE`;EXECUTE 只 GRANT service_role |
| `admin_adjust_wallet(customer_user_id, entry_type, amount, note, actor, request_id)` | `20260716210000_m4a_admin_adjust_wallet_rpc.sql:37` | 後台儲值金加值(`deposit`)/扣款(`use`);**零 UPDATE customers**,只 INSERT ledger,餘額靠既有 trigger 同步;`refund` enum 存在但本 RPC 拒收 |
| `sync_product_fitments()` | `20260708130000_create_product_fitments_index.sql:74` | trigger function,`products.fitments` 變動時同步 `product_fitments` 索引表(非 admin 觸發、由 products UPDATE 觸發) |
| `search_catalog_by_vehicle(...)` | 多版本,最新 `20260719150000:73` | 公開唯讀 RPC(車輛反查目錄),非寫入路徑,列於此供對照 |
| `catalog_brand_counts()` | `20260712183000_products_catalog_page_public.sql:111` | 公開唯讀 RPC,非寫入路徑 |
| `handle_new_auth_user()` | `20260523034911:278` | trigger,auth.users INSERT 自動建 customers row |
| `sync_wallet_balance_on_ledger_insert()` | `20260523034911:300` | trigger,ledger INSERT 同步 customers 餘額欄 |
| `rls_auto_enable()` | `20260531142534_govern_rls_auto_enable.sql:40` | 治理用,自動對新表 ENABLE RLS(非業務寫入) |

**訂單域 RPC**(`admin_update_order_workflow` / `admin_update_order_item_workflow` / `create_order` / `confirm_order_payment` 等一整組)已由前一輪訂單盤點覆蓋,此處不重複,僅在 §5 表格排除。

### 查無
- **無任何 products/brands/categories/product_variants 的寫入 server action 或 admin-only RPC**——這三張表的寫入路徑只有 `scripts/rpm-*.ts`(`rpm-import.ts` `rpm-load.ts` `rpm-transform.ts` `rpm-delta.ts` `rpm-reconcile.ts` `rpm-fetch.ts` `rpm-preflight.ts`,CLI 腳本、非 admin app),以及各自 migration 內的一次性 UPDATE/seed。base 表 GRANT 模型是 REVOKE ALL + service_role 專用(REVOKE 見 `20260519031049`,本輪未展開全檔內容)。
- **無 customer_addresses / customer_vehicles 的 admin 寫入路徑**——這兩表 RLS 只開 `authenticated`(客人自己),grep admin lib 無對應 action。

---

## 6. `@pcm/ui` 匯出清單

`packages/ui/src/index.ts:1-8` 完整內容:
```
export * from './filters/cascadeFilterReducer';
```

- **唯一匯出**:`cascadeFilterReducer`(`packages/ui/src/filters/cascadeFilterReducer.ts`)—「車輛/分類」階層篩選狀態機,供三個 Filter 元件共用(index.ts 註解 L6)。
- **無其他元件匯出**(無 Button/Table/Form/Modal 等 UI 元件)。`packages/ui/src` 底下只有 `filters/` 一個目錄 + `index.ts`。
- **Design token 檔位置**:`apps/storefront/src/styles/tokens.css`(唯一命中,`find . -iname tokens.css` 排除 node_modules/design-reference/worktree 後只此一份)。**`packages/ui` 內無 tokens.css**,tokens 屬 storefront app 私有,非跨 app 共用套件。
- **admin app 自己的 CSS**:`apps/admin/src/app/globals.css`(獨立於 storefront tokens,admin 用 shadcn/Tailwind 慣例、非設計系統 token 驅動)。

---

## 7. admin 現有缺口

### grep 結果(`TODO|backlog #|未實作|Phase 2|hardcode`,限 admin app、排除 `.test.` 檔)
| 檔案:行號 | 原句 |
|---|---|
| `apps/admin/src/components/customers/customer-detail-sections.tsx:16` | `看得到同一單);admin 專用含 unpaid 查法=另片,詳 backlog #278。` |
| `apps/admin/src/lib/staff.ts:3` | `🔴 臨時解:M-4b 完整帳號/權限前先 hardcode 名單;SSO 收端上線後由真實登入身分取代。` |
| `apps/admin/src/lib/staff.ts:12` | `hardcode staff 名單。`(docstring) |
| `apps/admin/src/lib/orders/order-list-view.ts:77` | `故付款 / 出貨各自一張表。文案 admin 視角、與會員側刻意不同(L2 hardcode、未來移後台 CMS)。` |
| `apps/admin/src/lib/orders/order-repository.ts:18` | `⚠️ 沿用 #249 隱含濾 unpaid、揭示見 backlog #278)——皆具名白名單投影、零成本欄。` |

Grep 範圍為 admin app(`apps/admin/src`);未擴大搜尋 `packages/`(超出本輪 admin 現況盤點主題,若需 packages 層 TODO 需另外 grep)。

### 四個是非題

**Q1:有沒有商品新增/編輯頁?**
**無。** 證據:`apps/admin/src/app` 底下只有 `customers/` `orders/` `settings/order-statuses/` `api/sso/` 四類 route(§1 表格),無 `products/` 目錄;側邊欄 `NAV_ITEMS`(`app-sidebar.tsx:23-28`)硬列 4 項不含商品;`grep -rl "products" apps/admin/src --include=*.ts --include=*.tsx` 排除 test 後零命中(§已執行、無輸出)。商品資料完全靠 `scripts/rpm-*.ts` CLI 管線寫入。

**Q2:有沒有圖片上傳?**
**無。** 商品圖存 `products.images` / `product_variants.images` jsonb(URL 陣列,`init_products.sql:32` `init_product_variants.sql:47`),來源是供應商 CDN URL(rpm 同步管線寫入),非 admin 上傳。`product_image_trim` 表(§3)只存裁切 bbox 中繼資料、非上傳檔案本身,寫入者是 `scripts/image-trim-scan.ts`(service key),非 admin UI。admin app 內查無任何 file upload / Supabase Storage 操作元件(未見 `<input type="file">` 或 storage client 於 admin components)。

**Q3:有沒有會員編輯頁?**
**有,但範圍窄。** `apps/admin/src/app/customers/[id]/page.tsx` 含 tier 編輯(`tier-edit-form.tsx` → `admin_set_customer_tier` RPC)+ 儲值金調整(`wallet-adjust-form.tsx` → `admin_adjust_wallet` RPC)。**僅限 tier 與 wallet 兩欄**,不含 email/name/phone/地址/愛車編輯(這些欄位的 admin 寫入路徑查無)。

**Q4:有沒有匯入匯出?**
**admin app 內無。** 商品「匯入」是 repo 根 `scripts/rpm-import.ts` 等 CLI 腳本(供應商報價單 → Supabase),非 admin app 內的功能、無 UI 觸發點。admin app 內查無任何匯出功能(CSV/Excel export 之類),`grep -rn "export.*csv\|download\|匯出\|匯入" apps/admin/src` 未執行(超出七題範圍,若需要可另 grep 補查)。

---

## 統計摘要
- §1 admin route(非 orders):3 個業務頁 + 1 個 layout + 2 個 API route
- §2 共用元件:4 個 shared filter/pagination 原子 + 9 個 shadcn ui primitives;**列表頁/表單頁抽象=0**
- §3 商品領域表:5 張(products / brands / categories / product_variants / product_fitments)+ 1 張輔助(product_image_trim)
- §4 會員/價格領域表:4 張(customers / customer_addresses / customer_vehicles / customer_wallet_ledger)
- §5 admin server action(非 orders):5 個;非訂單域 SECURITY DEFINER RPC:2 個業務寫入(tier/wallet)+ 6 個 trigger/唯讀/治理
- §6 `@pcm/ui` 匯出:1 個(`cascadeFilterReducer`)
- §7 grep 命中:5 筆(TODO/backlog/hardcode 相關)
