# M-1-14 Customer schema 偵察報告

- **日期:** 2026-05-23
- **作者:** Claude Code(`M-1-14-recon` slice)
- **目的:** 為 M-1-14 plan 階段準備字面素材,供下一輪 Cowork 寫 plan + raise backlog #156 / #158。
- **範圍:** 純唯讀偵察、無實質 code 變更。
- **HEAD:** `797a8c3`(STATUS「最後更新」描述此 commit、已 push、工作樹乾淨;slice 指令預期 `bfdf745` 為寫成時舊一個 commit,屬良性 drift)。

---

## 1. design-reference auth / account / mobile 字面

design 把全部 auth / account 邏輯放在單一檔 **`design-reference/components/AccountPages.jsx`(805 行)**,內含 `CartPage` / `LoginPage` / `RegisterPage` / `AccountPage` / `OrdersPage` + Inline 表單;tier 相關在 `TierComponents.jsx`(90 行)+ `WalletTab.jsx`(231 行);MobileTabBar 藏在 `App.jsx`。**沒有獨立的 `LoginPage.jsx` / `RegisterPage.jsx` 檔。**

### 1.1 LoginPage(`AccountPages.jsx` L180-253)

- `data-screen-label="Login"`、`ap-mono` 標題 `N°01 · Sign in`、h1 `歡迎回來`、副標 `登入你的 PCM 帳號，查看訂單與收藏。`
- 表單 state:`{ email: '', password: '', remember: true }`
- 欄位:
  - Email — `<input type="email">`、placeholder `your@email.com`、`autoFocus`
  - 密碼 — `<input type="password">`、placeholder `至少 8 碼`
  - 記住我 — `<input type="checkbox">`(預設 true)
  - 忘記密碼？ — `<a className="auth-forgot">`(無實作)
- 驗證提示字面:`請輸入 Email 與密碼`(`auth-err`)
- 提交按鈕:`登入`(`auth-submit`)
- 分隔線 `auth-divider` 字面 `或`
- 社群登入:
  - `使用 Google 登入`(`auth-social`、含 Google 4-color SVG)
  - `使用 LINE 登入`(`auth-social auth-social-line`、含 LINE SVG)
- 底部:`第一次來？` + `建立帳號`(`onNav('register')`)
- 「登入」mock 行為:寫 `localStorage['pcm-user'] = { email, name: email.split('@')[0], loggedIn: true }`、`onNav('account')`

### 1.2 RegisterPage(`AccountPages.jsx` L255-308)

- `data-screen-label="Register"`、`ap-mono` `N°02 · Sign up`、h1 `加入 PCM`、副標 `建立帳號，享會員價與專屬優惠。`
- 表單 state:`{ name: '', email: '', password: '', phone: '', agree: false }`
- 欄位(順序):
  - 姓名 — placeholder `王小明`
  - Email — `type="email"`、placeholder `your@email.com`
  - 手機 — placeholder `0912 345 678`
  - 密碼 — `type="password"`、placeholder `至少 8 碼`
  - 同意 checkbox — `我同意 [服務條款] 與 [隱私政策]`(`auth-check auth-check-full`)
- 驗證提示字面:`請填寫必要欄位`(name/email/password 缺)、`請同意服務條款`(agree 未勾)
- 提交按鈕:`建立帳號`
- 底部:`已有帳號？` + `登入`(`onNav('login')`)
- mock 行為:寫 `localStorage['pcm-user'] = { email, name, phone, loggedIn: true }`、`onNav('account')`

### 1.3 AccountPage(`AccountPages.jsx` L310-681)

未登入(`!user.loggedIn`)→ `onNav('login')` redirect。已登入顯示會員中心,**7 個 tab**:

| tab id | label | icon | 內容 |
|---|---|---|---|
| `overview` | 總覽 | ◉ | 3 stat 卡(Member tier / Stored value / Total orders)+ 最近訂單 + 為你推薦 |
| `orders` | 訂單記錄 | □ | 訂單列表(id / date / items / total / status / 查看詳情) |
| `wallet` | 儲值金 | ◈ | 渲染 `<WalletTab>`(見 §1.x 下方) |
| `favorites` | 收藏清單 | ♡ | 商品 grid(brand / name / price) |
| `vehicles` | 我的愛車 | ◎ | 車輛卡 + InlineVehicleForm |
| `address` | 收件地址 | ▸ | 地址卡 + InlineAddressForm |
| `profile` | 個人資料 | ✎ | 姓名 / Email(disabled)/ 手機 / 生日 |

**頭部:** avatar(name 首字)+ `會員中心` + `Hi, {name}` + email + `登出` 按鈕(清 `pcm-user`、`onNav('home')`)。

**Account 用到的資料欄位(供 Customer schema 對齊):**

- **user(`localStorage['pcm-user']`):** `email` / `name` / `phone` / `birthday` / `loggedIn`
- **Member tier:** `general` / `store` / `premium_store`(來自 `tweaks.memberTier`、渲染 `<TierBadge>`)。tier sub 字面:`premium_store`→`已享 PREMIUM 經銷折扣`、`store`→`已享店家經銷價`、`general`→`一般會員價(升級需聯絡客服)`
- **Stored value:** `tweaks.walletBalance`(NT$)
- **orders(hardcoded mock):** `{ id: 'PCM-2026-0042', date, items, total, status: '已出貨'/'已完成' }`
- **addresses(`localStorage['pcm-addresses']`):** `id` / `isDefault` / `name` / `phone` / `line` / `invoice{ type: personal|company|donate, carrier, title, taxId, donateCode }`
  - InlineAddressForm 含**發票** sub-form(個人手機載具 / 公司三聯式抬頭+統編 / 捐贈愛心碼)
- **vehicles(`localStorage['pcm-vehicles']`):** `id` / `isPrimary` / `name`(車型)/ `year` / `engine`(引擎號)/ `km`(里程)/ `mods`(已改裝)/ `service`(最近保養)
- **profile:** `name` / `email`(disabled、不可改)/ `phone` / `birthday`(`type="date"`)

> **L2/L3 觀察:** Account 的 addresses / vehicles / wallet / orders 在 design 全用 localStorage mock。M-1-14 Customer schema 最小集只需對齊 §3.1 的 `id / email / tier`;addresses / vehicles / orders / wallet 屬後續 milestone(見 §3.1 JSDoc 已標 vehicles → M-2-05、orders → Order context、wallet 未排)。

#### WalletTab(`WalletTab.jsx` 231 行,在 AccountPage `wallet` tab 渲染)

- Balance card:`CURRENT BALANCE` + `NT$ {balance}` + `可用於下單折抵 · 永久有效` + `立即儲值` / `查看交易紀錄`
- Tier card:`YOUR TIER` + `<TierBadge size="lg">` + tier line(`general`→`您目前是一般會員`、`store`→`您目前是店家會員`、`premium_store`→`✓ 您是 PREMIUM STORE 會員`)+ `<TierUpgradePath>`
- Tier note 字面(L81):`· 進階會員 由 PCM 後台手動設定、需升級請聯絡客服`
- 交易紀錄(`localStorage['pcm-wallet-tx']`):`{ id, date, type: deposit|use, amount, balance, note }`
- DepositModal:presets `[3000, 10000, 30000, 50000, 100000]`、付款方式 `信用卡(TapPay)` / `ATM 轉帳`
- **關鍵業務字面(L26 + L125):`v2.1: tier 由後台手動標記、UI 不提示「再儲值 X 升級」文案` / `不自動升級、tier 由後台手動標記`**

### 1.4 Header auth UI 區塊(`Header.jsx` 108 行)

- **桌機(≥1080px):** logo `PCM MOTORSPORTS` + 7 nav(商品目錄 / 依車輛搜尋 / 品牌 / 新品 / 特價 / 安裝預約 / 合作店家)+ 搜尋框 + **account icon 按鈕**(`onNav('account')`)+ cart 按鈕
- **手機(<1080px):** 只有 search icon + logo `PCM` + cart 按鈕。**手機 Header 無 account 入口**(會員入口在 MobileTabBar、見 §1.5)
- Header 無「登入 / 註冊」文字按鈕,點 account icon 直接 `onNav('account')`,由 AccountPage 自行判斷未登入 redirect login。

### 1.5 MobileTabBar(`App.jsx` L166-190,**藏在 App.jsx、非獨立檔**)

底部 5 tab `<nav className="mobile-tabbar">`:

| tab id | label | matches(active 判定) |
|---|---|---|
| `home` | 首頁 | `['home']` |
| `catalog` | 商品 | `['catalog','products','product','brands','brand-detail','new','sale']` |
| `vehicle-search` | 找車 | `['vehicle-search']` |
| `account` | 會員 | `['account','login','register','orders']` |
| `cart` | 購物車 | `['cart']` |

- 每 tab:`mobile-tabbar-dot` + SVG icon + `lbl` label
- **特殊邏輯(`MobileWrapper` L195):`商品詳細頁(currentPage === 'product')隱藏 tabbar`** — 註解:`Hide tabbar on product page — sticky buy bar is the primary control there`(與 13e mobile-buy-bar 二選一)
- 此即 backlog **#158** 的補搬目標(見 §5.2)。**MobileTabBar 字面存在於 design,storefront 完全沒搬。**

### 1.6 design 尚未補的清單

**無。** auth / account / mobile-nav 字面在 design-reference 全數存在(`AccountPages.jsx` / `Header.jsx` / `TierComponents.jsx` / `WalletTab.jsx` / `App.jsx` MobileTabBar),不需列入 Claude Design 阻塞清單。

---

## 2. apps/storefront 既有 auth / account 雛形

### 2.1 既有路由樹(`apps/storefront/src/app`)

```
app/
├── layout.tsx
├── page.tsx                    # 首頁
├── dev-preview/                # 設計預覽 harness(filter-drawer / filter-side / filter-top)
│   └── _components/PreviewHarness.tsx
└── products/
    ├── page.tsx                # 商品列表
    └── [slug]/page.tsx         # 商品詳細
```

**無 `(auth)/login`、無 `(auth)/register`、無 `account/*` 路由。** auth / account 在 storefront 完全未落地。

### 2.2 既有元件清單(grep 命中 auth 關鍵字者)

`grep -lEi "login|register|signup|auth|account|customer"` 命中 6 檔,但**全為偶然命中**(註解 / "customer" 字眼),**無真實 auth 實作**:

- `app/layout.tsx`、`components/BrandIndex.tsx`、`components/ProductTabs.tsx`、`components/BrandIndex.test.tsx`、`components/Header.tsx`、`lib/products.ts` — 皆非 auth 元件。

storefront 目前**無任何 Login / Register / Account 元件**。

### 2.3 是否已有 Supabase client 整合

- **storefront 無真實 auth client。** `lib/products.ts` 只 `import { ... } from '@pcm/adapters'`(商品讀取)。
- `lib/tier.ts`:tier 解析來源 = `tierOverride ?? cookie['pcm-tier'] ?? 'general'`,經 `designTierToSchema()` 轉 camelCase,corrupt → catch fallback `general`。**這是 dev override stub(backlog #163),非真實登入態。** M-1-14 後 tier 應改由真實 customer 記錄取得。
- adapters 既有 client:`packages/adapters/src/supabase/client.ts` 提供 `createSupabaseAnonClient()`(anon key、RLS、可進 client bundle)+ `createSupabaseServiceClient()`(service_role、server-only、繞 RLS)。為 product 而建但 pattern 可重用於 customer / auth。

---

## 3. packages/{domain,ports,adapters,schemas} identity 現況

### 3.1 domain/identity(`packages/domain/src/identity/types.ts`,**已存在**)

```ts
import type { MemberTier } from '../shared/types';
export type CustomerId = string;
export type Customer = {
  id: CustomerId;
  email: string;
  tier: MemberTier;
};
```

- M-0-04 type stub、**最小欄位集 `id / email / tier`**。
- JSDoc 字面:
  - 對齊 ADR-0003 §3.1 命名 + ADR §4 #8 三級會員
  - `vehicles` 欄位待 **M-2-05** 補(Phase 1 用 `customer.metadata.vehicles` 存儲、Phase 2 升級為獨立 Vehicle entity)
  - 新註冊預設 `tier='general'`(由 M-1-14 register use-case 設定、本 type 不管 default)
- **MemberTier 定義(`shared/types.ts` L55-70):`'general' | 'store' | 'premiumStore'`(camelCase)**
  - L65 業務含義字面:`premiumStore 高級店家(累積儲值 ≥ NT$ 100,000、經銷價再 -3~5%)` ← **見 §6 drift D-3**
  - L59 字面:`Medusa wire 是 customer_group(string)` ← **見 §6 drift D-1**

### 3.2 ports/ICustomerRepository(`packages/ports/src/ICustomerRepository.ts`,**已存在**)

```ts
import type { Customer, CustomerId } from '@pcm/domain';
export interface ICustomerRepository {
  findById(id: CustomerId): Promise<Customer | null>;
  findByEmail(email: string): Promise<Customer | null>;
  save(customer: Customer): Promise<Customer>;
  // TODO M-4a-10: 補 listByTier(tier: MemberTier) — admin 會員列表用
}
```

- `save` 純 persist、業務動作(register / tier 升級 / profile 改)走 use-case + entity method,不在 repo 介面出現業務語意方法。
- **JSDoc L10:`實作:M-1-14 MedusaCustomerAdapter(login / register)、M-2 起補 tier 相關 use-case` ← 見 §6 drift D-1(Medusa→Supabase)。**

### 3.3 adapters 既有 implementation(`packages/adapters/src`)

- **無 CustomerAdapter。** 既有僅 product 相關:`SupabaseProductAdapter.ts`、`supabase/client.ts`、`supabase/mappers/product.ts`、`in-memory/InMemoryProductRepository.ts`、`storefront-mappers/availability.ts`。
- M-1-14 需新建 customer adapter(命名應為 **Supabase**CustomerAdapter,非 Medusa)。

### 3.4 schemas 既有 Customer type(`packages/schemas/src/index.ts`)

```ts
// @pcm/schemas — 跨前後台共用 zod schema, 殼、M-1 期間第一個跨前後台 schema
// (login / register form input validation 等)落地時填
export {};
```

- **空殼,只有 `export {}`。** 註解明示:M-1 第一個跨前後台 schema(login / register form 驗證)落地時填 → 即 M-1-14 / M-1-15。

### 3.5 tier 雙命名 mapper(`packages/domain/src/shared/utils.ts`,**已存在、已驗證**)

> **重要:tier 的 snake_case ↔ camelCase「分歧」不是未解 drift,已有 mapper 處理。**

- `designTierToSchema(design)`:`'premium_store'` → `'premiumStore'`(非法值 throw TypeError)
- `schemaTierToDesign(tier)`:`'premiumStore'` → `'premium_store'`(exhaustive `never` check)
- `tier.test.ts` 已驗 cookie `pcm-tier=premium_store`(design snake_case)→ schema `premiumStore`。
- 三層字面慣例(對齊 lessons §12-5):schema/wire/TS = camelCase、design-handoff = snake_case、後台 UI = 中文。

---

## 4. Supabase 既有 schema(project ref `bmpnplmnldofgaohnaok`)

### 4.1 list_tables 結果

**`public` schema(只有 3 表 + 商品 view,無任何 identity 表):**

| 表 | RLS | 重點欄位 |
|---|---|---|
| `public.brands` | ✅ | id(uuid PK)/ name / slug / description / logo_url / **`premium_extra_pct`(int, 0-30, default 0)** / timestamps |
| `public.categories` | ✅ | id / parent_category_id(自參照 FK)/ name / raw_path(unique)/ segments(jsonb)/ sort_order |
| `public.products` | ✅ | id / external_id / title / handle / **`price_by_tier`(jsonb, check `? 'general' AND ? 'store'`)** / fitments / images / availability(check in-stock\|out-of-stock)/ brand_id FK / category_id FK / metadata / **`price_general`(int, 公開, view 可見)** / **`price_store`(int, 經銷敏感, 僅 service_role)** |

> **`public.customers` / `public.profiles` / `public.customer_tiers` 表皆不存在。** M-1-14 必須新建。

**`auth` schema:** Supabase 內建 auth 全套表(users / sessions / refresh_tokens / identities / mfa_* / sso_* / oauth_* / one_time_tokens / flow_state / webauthn_* / audit_log_entries / schema_migrations 等),全 0 rows(尚無註冊用戶),RLS 多數啟用。

### 4.2 list_migrations 結果(10 筆,**全 product/pricing,無 identity**)

```
20260505130758  init_brands_categories
20260507004826  init_products
20260507012301  init_products_rls
20260507222633  products_brand_category_not_null
20260510134708  products_public_view
20260511180231  pricing_tier_alignment
20260516064013  products_add_price_general_store
20260516072210  products_views_pricing_split
20260519031049  products_base_table_column_grants
20260519152353  drop_orphan_line_tables
```

**無 customer / identity / profile 相關 migration。** M-1-14 需新增第 11 筆 migration 建 customers 表。

### 4.3 既有 `auth.users` 表結構(內建,join 目標)

- PK:`id`(uuid)
- 內建欄位(M-1-14 可直接重用、不需在 customers 重複):`email`(varchar)/ `phone`(text, unique)/ `encrypted_password` / `email_confirmed_at` / `last_sign_in_at` / `created_at` / `updated_at` / `confirmed_at`(generated)/ `banned_until` / `deleted_at` / `is_anonymous`
- `raw_user_meta_data`(jsonb)— 可存 name / birthday 等 profile metadata(或拆 public.customers 欄位,plan 拍板)
- RLS 啟用、`rows: 0`

### 4.4 join 關係預期

```
auth.users (Supabase 內建, id uuid PK)
   ↑ 1:1
public.customers.user_id → auth.users.id  (FK, M-1-14 新建)
```

- `public.customers` 持業務欄位(`tier` + 未來 profile / application_status 等),`auth.users` 持登入認證資料。
- 1:1 對應(一個 auth user = 一個 customer 記錄),customer 建立時機由 register use-case 或 DB trigger(`on auth.users insert`)決定 → **plan 拍板**。
- **安全 pattern 先例(必沿用):** products 表已示範 RLS + public view 分離公開欄(`price_general`)vs 敏感欄(`price_store`、僅 service_role)。customers.tier 屬經銷敏感(决定看到的價格),M-1-14 RLS policy 應限「customer 只能讀自己的 row」+ tier 寫入僅 service_role / admin。

---

## 5. backlog #156 + #158 既有條目字面(完整貼)

### 5.1 #156 完整字面(`docs/phase-1-backlog.md` L4151-4177)

```
### #156. ⏳ 店家會員申請流程 PRD(Q-1=B 拍板)

- 狀態: ⏳ 待執行(PRD 階段)
- 分流: P1-before-launch(Sean 拍板 Phase 1 做)
- 優先級: 🟠 中
- 問題:
  - Customer schema(M-0-04)只有 id / email / tier 三欄、預設 tier='general'
  - 變 store / premium_store 目前唯一路徑 = 後台手動改 tier 欄位(無稽核紀錄)
  - 缺前台「店家申請」入口 + 後台「審核」介面 + 升等通知流程
  - 業務真實情境:店家不會「升等」、而是「原本就是店家、註冊後申請」(Sean 2026-05-20 業務語意澄清)
- 觸發事件(任一觸發即啟動 PRD):
  - M-1-14 Customer schema 落地前 audit(register flow + tier 預設邏輯撞點)
  - M-1-15 LoginPage / RegisterPage 落地前 audit(前台註冊流程入口分流 — 一般客人 vs 店家入口)
- 預期解法(PRD 草稿方向):
  - 申請表前台頁面(公司名 / 統編 / 聯絡人 / 營業地址 / 期望 tier)
  - Customer schema 擴欄:application_status enum(none / pending / approved / rejected)+ requested_tier + applied_at + reviewed_at + reviewed_by
  - 後台 admin 審核介面(apps/admin 新建 ApplicationsPage)
  - 通過 → 自動升等 tier + email / line 通知
  - 拒絕 → 註明原因 + 客戶可重新申請
- 不修會痛在:
  - 擴充性:店家想申請只能打電話 / line 業務、無 self-service
  - 可維護性:後台手動改 tier 留無稽核紀錄、誰改的 / 何時改 / 為何改全失
  - bug 可追蹤性:某客人為何是 store tier 沒記錄、爭議時無據
- 估時: PRD 60-90 min + 落地 3-5 個 slice(~3-4 hr)
- 依賴: M-1-14 Customer schema
- 發現於: 2026-05-20 / M-1-13c slice 對話岔題
- 相關: Sean 拍板 Q-1=B、packages/domain/src/identity/types.ts Customer、M-1-14 / M-1-15
```

**是否需擴展(供 Cowork 評估、本 slice 不改字面):**

- ✅ 字面大致完整。下一輪 raise 時建議**核對 / 補**以下,皆已有素材:
  - `application_status` / `requested_tier` 等擴欄與 §3.1 Customer 最小集(`id/email/tier`)的關係:plan 需決定「M-1-14 先建最小集、#156 擴欄留申請流程 milestone」還是「一次建全」。
  - 「通過 → **自動升等** tier」字面與 design「tier **由後台手動標記、不自動升級**」(§1.x WalletTab L81 + TierComponents L27)需對齊措辭:此處「自動升等」應指「**審核通過後系統寫入 tier**」(仍是人工審核觸發),非「累積消費自動升等」。raise 時建議釐清用詞避免與 §6 D-3 混淆。

### 5.2 #158 完整字面(`docs/phase-1-backlog.md` L4214-4241)

```
### #158. ⏳ 手機底部 5 tab bar(MobileTabBar)漏元件補搬(M-1-14 / M-1-15 啟動前順手做)

- 狀態: ⏳ 待執行
- 分流: P1-before-launch
- 優先級: 🟠 中(M-1-14 / M-1-15 啟動前處理、不阻 13d~g 主線)
- 問題:
  - design App.jsx line 162-193 有完整 <nav className="mobile-tabbar"> 字面、5 個 tab(首頁 / 商品 / 找車 / 會員 / 購物車)+ SVG icon + label + active dot
  - storefront 完全沒搬(apps/storefront/src/components/Mobile* 不存在)
  - 為什麼漏:design 把 MobileTabBar 放在 App.jsx(SPA harness 容器)、不像 Header / Footer 是獨立 .jsx 檔;之前 audit 沒抓到「藏在 App.jsx 裡的元件」
  - 2026-05-20 / M-1-13c 收工肉眼驗階段 Sean 發現缺漏
- 觸發事件(任一觸發即啟動實作):
  - M-1-14 Customer schema 落地後(會員 tab 連結需要登入頁存在)
  - M-1-15 LoginPage / RegisterPage 落地前 audit(那時補最自然、5 tab 連結指向 3 個未落地頁:找車 / 會員 / 購物車)
- 預期解法:
  - 新建 apps/storefront/src/components/MobileTabBar.tsx(對齊 design mobile-tabbar className 字面)
  - 新建 apps/storefront/src/styles/mobile-tabbar.css(對齊 design styles/app.css 或 home.css 內 .mobile-tabbar* selectors)
  - 5 tab 用 Next.js <Link href> + usePathname 判定 active(取代 design SPA setPage state)
  - tab 路由對映:首頁 / / 商品 /products / 找車 /vehicle-search(待 M-1-15+ 建)/ 會員 /account(待 M-1-15)/ 購物車 /cart(待 M-3)
  - 特殊邏輯:商品詳細頁需隱藏 tab bar(design line 193 字面:Hide tabbar on product page...);用 usePathname 判 /products/[slug] 隱藏
  - 接點:各 page layout / root layout 加 <MobileTabBar />(只在 < 900px 顯示、CSS @media query 控)
- 不修會痛在:
  - 擴充性:手機體驗缺核心 nav、客人沒有快速跳 5 大區的入口
  - 可維護性:design 真權威字面落地不全、後台 / 前台對齊出 gap
  - bug 可追蹤性:Sean 肉眼驗已發現「沒做」、未來 audit / Codex Review 也會抓
- 估時: 30-45 min(MobileTabBar.tsx + CSS + 商品頁隱藏 + 各 page 接)
- 依賴: 無前置(可在 M-1-14 啟動前獨立 slice 跑、或合進 M-1-15 啟動前 audit 後)
- 發現於: 2026-05-20 / M-1-13c 收工肉眼驗 Sean raise
- 相關: design-reference/components/App.jsx line 162-193、M-1-14 / M-1-15、13e mobile-buy-bar 隱藏邏輯撞點
```

**是否需擴展(供 Cowork 評估、本 slice 不改字面):**

- ⚠️ **行號校正:** 條目寫 `App.jsx line 162-193`,本次偵察實測 **MobileTabBar 在 `App.jsx` L166-190**(`MobileWrapper` 隱藏邏輯在 L192-209、`hideTabBar = currentPage === 'product'` 在 L195)。raise 時建議更新行號。
- ⚠️ **CSS 來源校正:** 條目寫「對齊 design styles/app.css 或 home.css」。本次偵察 `design-reference/styles/` **無 `app.css`**;`.mobile-tabbar*` selector 實際位置 plan 階段需 grep 確認(候選 `home.css` / `tweaks.css`,本 slice 未深挖 CSS selector 落點)。
- ⚠️ **「5 tab」措辭:** 條目標題寫「5 tab bar」正確(home/catalog/vehicle-search/account/cart),與 §1.5 實測一致。但要注意 tab id 是 `vehicle-search`(非 design Header nav 的 `vehicle`)、`catalog`(非 `products`),路由對映需 plan 拍板。

---

## 6. drift 摘要(供 Cowork plan 階段用)

### D-1 — Medusa → Supabase adapter 命名變更(milestone 表 §4.5 + 2 處 code 字面)

專案架構已從 Medusa 轉 Supabase(public schema 已是 Supabase products/brands/categories),但以下字面仍寫 Medusa,plan 階段應校正:

| 位置 | 現字面 | 應為 |
|---|---|---|
| `docs/PHASE-1-MILESTONES.md` L217 | `domain/identity Customer + ports + MedusaCustomerAdapter(login / register)` | SupabaseCustomerAdapter |
| `docs/PHASE-1-MILESTONES.md` L255(§4.5 slice 表 M-1-14 列) | `... + MedusaCustomerAdapter(login / register API) | 45 min | 無 | M-0-04` | SupabaseCustomerAdapter + 估時校正(見 D-4) |
| `packages/ports/src/ICustomerRepository.ts` L10 | `實作:M-1-14 MedusaCustomerAdapter(login / register)` | SupabaseCustomerAdapter |
| `packages/domain/src/shared/types.ts` L59 | `Medusa wire 是 customer_group(string)` | Supabase customers.tier(text / enum) |

> 註:這些是 docs/JSDoc 字面校正,M-1-14 實作 slice 動 code 時順手改即可(屬鐵則 11 字面 vs 事實對齊),非阻塞。

### D-2 — Customer 最小集 vs design AccountPage 富欄位

- 現 `Customer = { id, email, tier }`(§3.1),design AccountPage 需 name / phone / birthday / addresses / vehicles / wallet / orders(§1.3)。
- JSDoc 已標 vehicles → M-2-05、addresses/orders 屬 Order context。**plan 需明確劃 M-1-14 範圍邊界**(建議:M-1-14 只落 `id/email/tier` + 對 auth.users 的 FK + register/login adapter,profile 富欄位走後續 milestone),避免 scope 膨脹超鐵則 4(15-45 min)。

### D-3 — tier 升級語意衝突(domain JSDoc vs design 字面)

- `shared/types.ts` L65:`premiumStore 高級店家(累積儲值 ≥ NT$ 100,000、經銷價再 -3~5%)` — 字面暗示「**累積儲值自動升級**」。
- design `TierComponents.jsx` L27:`三 tier 並非自動升級、純後台手動標記。UI 不提示「累計消費 X 自動升級」任何條件。`+ `WalletTab.jsx` L81:`進階會員 由 PCM 後台手動設定、需升級請聯絡客服`。
- backlog #156 L4160 業務澄清:`店家不會「升等」、而是「原本就是店家、註冊後申請」`。
- **衝突:** domain JSDoc 的「累積儲值 ≥ NT$100,000」與 design / #156 的「後台手動標記、不自動升級」矛盾。**plan 階段需拍板** tier 升級機制真相(推測:NT$100,000 是後台**參考門檻**、非自動觸發;但 JSDoc 字面需校正避免實作者誤建 auto-upgrade 邏輯)。⚠️ 與 §5.1 #156「通過→自動升等」措辭一併釐清。

### D-4 — 估時校正(45 min → 多 sub-slice)

- §4.5 slice 表 M-1-14 列估時 **45 min**,僅涵蓋 `domain/identity Customer + ports + adapter(login/register)`。
- 但 M-1-14 真實工作面已擴張(STATUS「下一步」+ #156 + #158 audit):
  - Customer schema + auth.users FK + RLS(經銷敏感、沿用 products view pattern)
  - Supabase migration 第 11 筆(建 customers 表)
  - SupabaseCustomerAdapter(login / register)
  - schemas/src login / register form zod schema 填空(§3.4)
  - #156 店家申請 PRD raise(60-90 min PRD)
  - #158 MobileTabBar 補搬(30-45 min)
- **plan 建議:** M-1-14 拆多 sub-slice(每個 15-45 min 可中斷、對齊鐵則 4),45 min 單一估時已不符實況。

### D-5 — 「design 字面無 UI 標示」JSDoc 過時(次要)

- `shared/types.ts` L60:`design 字面無 UI 標示`(指 tier)。但實況 design 有 `TierComponents.jsx`(TierBadge / TierUpgradePath)+ AccountPage tier stat + WalletTab tier card,**有完整 tier UI**。此 JSDoc 為早期字面、已過時,plan / M-1-14 實作時順手校正。

### D-6 — storefront tier 來源是 dev stub,非真實 auth(接點提醒)

- `lib/tier.ts` 現由 cookie `pcm-tier` 解析 tier(#163 dev override),非登入態。M-1-14 落地 customer + auth 後,tier 來源應改為真實 customer 記錄(server-side 重新檢查、對齊 CLAUDE.md「三級會員價格驗證」鐵則:不信任 client 送的欄位)。plan 需排此接線。

---

— END —
