# 計畫：經銷子網域 b2b.pcmmotorsports.com

- 日期：2026-09-23
- 狀態：**只寫計畫。沒有改任何程式、沒有改任何設定、沒有貼正式庫、沒有推送。**
- 依據拍板：Sean 2026-09-23（做 b2b 子網域，帳號與一般站共用）、2026-09-08（`project_0908-b2b-subdomain-after-launch`）、2026-09-09（`project_0909-dealer-price-whole-package-after-launch`）
- 需要 Sean 批准才能動工：本計畫碰資料庫函式、共用登入元件、Vercel 設定與金額顯示，命中鐵則 8 與鐵則 12。
- 審查：見文末「審查紀錄」。**本輪沒有 Codex**（額度用完到 2026-09-27），改用 Fable 對抗審查，缺 Codex 那一路。**R1 判 FAIL（4 條必修）、R2 也判 FAIL（1 條必修）**，兩輪的必修都已修完，但照鐵則 12「R2 還有必修就不跑 R3、停下端 Sean」，**這份計畫要 Sean 看過才動工**。
- 🔴 **最重要的一件事**：真的經銷價**從來沒有灌進網站過**（2026-09-23 讀同步 log 實測，見第 4.0 節）。所以修目錄頁那支 migration 貼下去，畫面上一個數字都不會變——要先灌價，而灌價的第四道門是 Sean 要說「灌」這個字。

---

## 1. 做完之後，兩種客人各自看到什麼

一般客人在 `www.pcmmotorsports.com` 買東西，看到的一律是牌價，網站上沒有任何地方會出現經銷價；經銷商改到 `b2b.pcmmotorsports.com`，用**同一組帳號**登入後，從商品列表到結帳看到的一律是他自己的經銷價。

一般帳號如果打開經銷站的網址，會看到一頁「這個帳號沒有經銷資格」的說明，**看不到任何商品與價格**。

---

## 2. 架構

### 2.1 一份程式碼、兩個 Vercel 專案

顧客站程式碼只有一份（`apps/storefront`），用一個環境變數決定它這次是「一般站」還是「經銷站」。不複製 repo、不開新分支。

這個做法在本專案已經有先例：`apps/admin` 就是同一個 repo 開成另一個 Vercel 專案（`pcm-admin`，綁 `admin.pcmmotorsports.com`）。

現有 Vercel 專案（來源：`docs/runbooks/2026-09-09-domain-switch-shop-to-www.md:29-37`，Sean 2026-09-11 自己在後台看過並貼回，主視窗用 Vercel MCP 唯讀複核過）：

| 專案 | 綁的網域 | production 分支 |
|---|---|---|
| `pcm-website-v2` | `shop.pcmmotorsports.com` 等 | `main` |
| `pcm-admin` | `admin.pcmmotorsports.com` | `dev` |
| `pcm-quote-v2` | `quote.pcmmotorsports.com` | 未問 |
| `pcm-official-site` | `www.pcmmotorsports.com`、`pcmmotorsports.com` | 沒接 Git |
| `pcm-moto` | `bikes.pcmmotorsports.com` | 未問 |

上表是 2026-09-11 的狀態。`docs/handoff/CURRENT.md` 2026-09-21 那段寫著 `www.pcmmotorsports.com`、`pcmmotorsports.com`、`shop.pcmmotorsports.com` 現在都指向顧客站的 production 部署，**所以上表第 1 列與第 4 列之間已經變過**。開新專案之前要先在 Vercel 後台重看一次，不要照抄這張表。

新專案設定：

- 名稱：`pcm-website-b2b`（暫定）
- Git repo：同一個，Root Directory 與 Build Command **照抄 `pcm-website-v2` 現有設定**（repo 本機沒有 `.vercel/project.json`，這兩格我查不到，必須開後台看）
- Production 分支：與顧客站相同
- 網域：`b2b.pcmmotorsports.com`

### 2.2 環境變數怎麼分

顧客站只有一個「站台自己的網址」環境變數：`NEXT_PUBLIC_SITE_URL`（`apps/storefront/src/lib/site-url.ts:6,21-29`）。它刻意不寫進 `.env.example`，值由 Sean 在 Vercel 後台設（同檔 `:11-16` 註解）。

經銷站專案要獨立設定的：

| 變數 | 值 | 為什麼 |
|---|---|---|
| `NEXT_PUBLIC_SITE_MODE` | `b2b` | 新增。一般站不設或設 `retail` |
| `NEXT_PUBLIC_SITE_URL` | `https://b2b.pcmmotorsports.com` | 不設會讓 canonical、Open Graph 與刷卡 3DS 回呼全部指回 www。3DS 那支會嚴格驗 https origin（`apps/storefront/src/lib/payment/three-ds-urls.ts:18,27-36`），值不對刷卡會壞 |
| `LINE_REDIRECT_URI` | `https://b2b.pcmmotorsports.com/api/auth/line/callback` | 只在決定經銷站保留 LINE 登入時才要。LINE 後台的 channel 也要把這個網址加進 Callback URL 清單，否則 LINE 登入會被 LINE 擋掉 |

其餘變數（`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`NEXT_PUBLIC_TAPPAY_*` 等）與顧客站相同值，兩邊各設一份。

### 2.3 經銷站不可以被 Google 收錄

這一格很容易漏，而漏掉的後果是經銷站整站進 Google。要改三個地方：

- `apps/storefront/src/lib/seo.ts` 的 `buildRobots()`：經銷模式回 `Disallow: /`
- `apps/storefront/src/app/sitemap.ts`：經銷模式回空陣列
- `apps/storefront/src/app/layout.tsx` 的 metadata：經銷模式加 `robots: { index: false, follow: false }`

不能靠「不設 `NEXT_PUBLIC_SITE_URL`」來達成（那確實會讓 robots 休眠全擋），因為同一個變數也在管刷卡 3DS 回呼。

### 2.4 登入狀態要不要跨兩個子網域

**現況（我開檔核過）**：

- 顧客站**沒有 middleware**。Next 16 把這支檔改名成 `proxy.ts`，所以兩個檔名都要找：`find apps -iname 'middleware.ts*' -o -iname 'proxy.ts*'` 只命中 `apps/admin/src/proxy.ts`（後台的），顧客站兩種都沒有。登入保護目前落在每個頁面與 server action 自己呼叫 `getVerifiedUser()`。
- Supabase client 建立時**沒有設 cookie domain**：`apps/storefront/src/lib/supabase/browser.ts:23`（`createBrowserClient(url, anonKey)`，無第三參數）、`apps/storefront/src/lib/supabase/server.ts:35-49`（`createServerClient` 只給 `cookies` adapter，`setAll` 直接沿用 SDK 給的 options）。
- 所以登入 cookie 今天是 host-only，`www` 與 `b2b` **預設不會共用同一個登入狀態**。

有兩條路：

**路 A：不共用 session，只共用帳號（建議）**

兩個站用同一個 Supabase 專案、同一份 `auth.users` 與 `customers`，所以是**同一組帳號、同一組密碼**。差別只是經銷商在 b2b 要自己登入一次。

- 要改的程式：**零**。
- 要改的設定：Supabase 後台 Authentication → URL Configuration 的 Redirect URLs 加 `https://b2b.pcmmotorsports.com/**`（Google 一鍵登入與密碼重設信要用）。Google Cloud Console 不用改，Google 的回呼對象是 Supabase 自己的網址，不是我們的網域。
- 代價：經銷商在兩個站之間切換要各登入一次。

**路 B：共用 session（不建議，但寫清楚怎麼做）**

要把 cookie 從 host-only 改成 `domain: '.pcmmotorsports.com'`：

- `apps/storefront/src/lib/supabase/browser.ts:23` → `createBrowserClient(url, anonKey, { cookieOptions: { domain: '.pcmmotorsports.com' } })`
- `apps/storefront/src/lib/supabase/server.ts:35` → `createServerClient(url, anonKey, { cookies: {...}, cookieOptions: { domain: '.pcmmotorsports.com' } })`

（型別上可行：`@supabase/ssr` 的 `cookieOptions` 是 `Partial<SerializeOptions>`，接受 `domain`。）

三個代價要先知道：

1. 這顆 cookie 會**同時送到 `admin.pcmmotorsports.com`、`quote.pcmmotorsports.com` 與 `bikes.pcmmotorsports.com`**，因為它們在同一個主網域底下。今天顧客的登入資料不會到後台，改了就會。（後台沒有用 `@supabase/ssr`，所以不會撞到同名 cookie，但它仍然會收到客人的登入資料。）
2. 改了之後，**現有每一位已登入客人的瀏覽器裡會同時存在新舊兩顆同名 cookie**（舊的 host-only、新的帶 domain）。瀏覽器兩顆都會送，而哪一顆生效沒有保證，症狀是「有些客人被登出、有些客人怎麼重登都卡住」，而且只發生在改版那一刻已登入的人身上，本機測不出來。
3. 這是共用登入元件，命中鐵則 8，本身就要另外一份 plan。

**建議走路 A**，理由是它的失敗方向是「經銷商多登入一次」，路 B 的失敗方向是「顧客的登入資料跑進後台網域」與「上線當下一批客人登入壞掉」。這題列進第 8 節請 Sean 決定。

### 2.5 進站的閘要放在哪

不新增 middleware。把閘放在 `apps/storefront/src/app/layout.tsx`：那是根 layout，**每一個頁面**都從它渲染，經銷模式時先問一次身分，不是經銷商就直接渲染說明頁、不渲染 `children`。

**但它只管「頁面」，不管下面這些**，這一格不要讀寬了：

| 不經過根 layout 的東西 | 在經銷站上的影響 |
|---|---|
| route handler（`apps/storefront/src/app/api/` 底下 7 個目錄） | 一般帳號仍叫得到。它們吐的東西**不含經銷價**（有些是逐單資料、有些是金流 webhook，不是全部都公開） |
| server action（購物車與結帳 `app/cart/actions.ts`） | 一般帳號仍呼叫得到。**這一支要自己加擋**，它已經 import 了 `resolveAuthenticatedTierStrict`（`:30`） |
| `sitemap.ts` / `robots.ts` / `generateMetadata` | 走 2.3 節那三處改法，不走這道閘 |
| `not-found` / error boundary | 會在閘外渲染。內容是通用文字，不含價格 |

**而這道閘不是經銷價的防線**——真正的防線在資料庫，而且已經在了：

- 經銷目錄函式 `search_catalog_by_vehicle_dealer`：沒登入或 tier 不是 `store` 直接 `RAISE EXCEPTION`。引註要指**現役那一代**（14 參）：閘在 `supabase/migrations/20260922130000_m4b_catalog_page_limit_1000.sql:649`，`anon` 沒有 EXECUTE（`supabase/migrations/20260916220000_m4b_catalog_fit_scope.sql:1063` 只 GRANT 給 `authenticated`）。最初那一代（12 參）的同一道閘在 `20260908010000:158`，行為一樣，但那個簽章已經不是活的了。
- 經銷價函式 `get_effective_prices`：非 `store` 的 tier 一律降成 `general`（`supabase/migrations/20260907010000_m4b_m208_get_effective_prices.sql:107`）。
- 經銷專用 view `products_list_dealer`：`anon` 與 `authenticated` 都沒有任何權限，只有上面那支 SECURITY DEFINER 函式讀得到（`supabase/migrations/20260908000000_m4b_q74_products_list_dealer_view.sql:231-233`）。

所以「一般帳號誤進經銷站」不會洩漏經銷價，這件事不靠畫面判斷，靠的是資料庫拒絕。畫面那道閘是為了**不要讓一般客人看到一個他用不了的站**，不是為了擋價格。

---

## 3. 進站規則與文案

文案照 `docs/patterns/admin-copy-style.md`：說明現在是什麼狀態、下一步能做什麼，不出現資料表名稱、tier、RPC 這類字眼。

### 未登入

導到經銷站自己的登入頁，頁面上方一句說明：

> 標題：經銷商專區
> 說明：這裡是 PCM 經銷商專用的訂購網站，登入後會顯示您的經銷價格。
> 按鈕：登入
> 附註：一般消費者請前往 www.pcmmotorsports.com

登入表單本身沿用現有的（`apps/storefront/src/app/login`），不另做一套。

### 一般帳號登入

不顯示任何商品與價格，只有一頁說明：

> 標題：這個帳號目前沒有經銷資格
> 說明：您已登入，但這個帳號尚未開通經銷商資格，因此無法查看經銷價格與下單。
> 說明第二段：如果您是經銷商，請與 PCM 業務聯絡開通；如果您要以一般消費者身分購買，請前往 www.pcmmotorsports.com。
> 按鈕一：前往 www.pcmmotorsports.com
> 按鈕二：登出

這一頁**不渲染任何商品資料**，也不去呼叫任何取價的函式。

### 經銷帳號登入

正常顯示整個網站，價格一律是經銷價。頁首固定一條說明，讓人知道自己在哪個站：

> 經銷商專區：以下價格為您的經銷價，未稅。

「未稅」這兩個字要不要印，跟著 Sean 2026-09-06 的 Q24 拍板走（`project_0906-dealer-price-display-tax-by-payment-method`）：他明文說**不標「未稅」**。所以上面那句要改成：

> 經銷商專區：以下價格為您的經銷價。

同一條拍板還定了：刷卡加 5%、匯款不加；商品頁那句「含稅 · 滿 NT$ 5,000 免運」對經銷身分不顯示。這兩件已經拍過，不再問。

### 身分查不到的時候

Sean 2026-09-08 拍過「查不到身分給牌價、不給錯誤頁」（`project_0908-tier-lookup-failure-shows-general`）。**那條拍板的射程是一般站**。在經銷站上「給牌價」等於讓一個身分不明的人看到整個站，方向相反。

經銷站的處理是：身分查不到就當作沒有經銷資格，顯示上面那頁說明，並在文案裡明說這可能是暫時的：

> 標題：目前無法確認您的經銷資格
> 說明：系統暫時讀不到您的帳號資料，請重新整理。若仍無法進入，請聯絡 PCM 業務。
> 按鈕：重新整理

這一格算是對 09-08 拍板的例外，要列進第 8 節請 Sean 確認。

---

## 4. 經銷價資料修好的步驟

### 4.0 先講清楚：這裡有兩個病，不是一個

**病一：真的經銷價從來沒有灌進網站過。這句是實測的，不是推論。**

經銷價的真來源是報價單資料庫的 `dealer_price_v`，要灌進顧客站必須把 GitHub secret `DEALER_PRICE_SUPPLIERS` 從空字串設成 `rpm`。那顆按鈕的前置條件逐字寫在 `docs/runbooks/dealer-price-first-load.md`：門 1 說這顆 secret「**先設成空字串**」，門 4 說「**Sean 說了『灌』這個字，A 才 `gh secret set`**」。

secret 的值讀不出來，但**同步程式每一輪都會把生效的 allowlist 印進 log**（`scripts/rpm-import.ts:272`）。我讀了最近一輪排程同步的 log（2026-09-23 唯讀跑 `gh run view 35710220221 --log`，那是 2026-09-22 09:32 CST 那一輪）：

```
[dealer-price] 本次生效 allowlist: (空) · 家數 0
[dealer-price] eazigrip 不在 allowlist ⇒ untouched(兩層各帶自己的舊值)
```

每一家供應商都是同一句。⇒ **到 2026-09-22 為止，經銷價一次都沒有灌過。**

旁證（都對得上）：`20260908000000_m4b_q74_products_list_dealer_view.sql:46-48` 逐字（2026-09-07 唯讀實測，**分母 25,769 筆 products**）`price_store IS DISTINCT FROM price_general` = **0** 筆；`tier-prices.ts` 檔頭記著 25,769 件商品 + 59,841 個變體全無差價。

⇒ **第 4.2 節那支 migration 修完之後，畫面上一個數字都不會變。** 這不是失敗，是這個病本來就要兩件一起做——片 1b 那趟灌價流程是**必做**，不是「如果」。

**病二：就算灌了，目錄頁還是顯示一般價**，因為它接的欄位永遠 NULL。這是第 4.1 節。

⇒ 順序是：先確認病一（片 1），再修病二（片 3）。兩個都做完，經銷商在目錄頁才會看到自己的價。

### 4.1 病二的根因

經銷價在資料庫裡有三個欄位，而**目錄頁接的是唯一一個沒有任何程式會寫的那個**。

| 欄位 | 誰寫 | 誰讀 | 現況 |
|---|---|---|---|
| `product_variants.price_store` | `scripts/rpm-transform.ts:678`（`dealerPriceOf()`，`:635`） | `get_effective_prices`（`20260907010000:150`）、`create_order`（`20260915100000:377`） | **接線是對的**（商品頁、購物車、結帳走這條）。**有沒有資料是另一回事**，見 4.0 |
| `products.price_by_tier->>'store'` | `scripts/rpm-transform.ts:563`（`productStoreOf()`，`:653-658`） | `get_effective_prices`（`20260907010000:120-123`） | 接線是對的（沒有變體的商品走這條）。**key 一定在，但值不一定是真經銷價**，見下 |
| **`products.price_store`** | **沒有人寫**：`scripts/rpm-transform.ts:534` 逐字 `price_store: null` | **只有經銷目錄 view 讀它**：`supabase/migrations/20260908000000_m4b_q74_products_list_dealer_view.sql:216` 逐字 `coalesce(pr.price_store, v.price_general) AS price_general` | **永遠 NULL** |

同步程式那一行的註解寫著「Q2=A 獨立經銷欄留 NULL（view 無經銷價、絕不接）」——那是 2026-06-02 的決定（`supabase/migrations/20260602192455_s3a_composite_keys_drop_rpm_prefix.sql:9`），而 2026-09-08 建經銷目錄 view 的人接了這一欄。**兩邊各自都合理，湊起來就是經銷目錄永遠 `coalesce` 回一般價。**

**「`price_by_tier` 帶 store 有 26,642 筆」不能讀成「有 26,642 筆經銷價」。** 資料庫的 CHECK 逼每一列都必須有 `store` 這個 key（`supabase/migrations/20260511180231_pricing_tier_alignment.sql:44-47` 逐字 `price_by_tier ? 'general' AND price_by_tier ? 'store'`），所以那個數字就是商品總數。而沒有真經銷價時，同步程式填的是一般價或 0：`scripts/rpm-transform.ts:563` 逐字 `store: { amount: productStoreOf(...) ?? priceGeneral ?? 0, currency: TWD }`。

⇒ 判斷「有沒有真經銷價」只能靠 4.3 節那句「與一般價不同的有幾筆」，不能靠「有幾筆帶 store」。

### 4.2 要改哪裡

**改讀的那一邊，不改寫的那一邊。** 一支 migration 把 view 的那一格從 `pr.price_store` 換成 `price_by_tier->'store'->>'amount'`。

**不可以寫成裸的 `::integer` 轉型。** 上面那條 CHECK 只保證 key 存在，不保證值是數字：遇到 `'1,500'`、`'12.5'`、`'abc'` 會讓整張 view 的查詢直接 RAISE，而 `fetchCatalogPage` 對經銷路徑刻意不退回公開查詢（`apps/storefront/src/lib/products.ts:861-877`）⇒ **經銷商看到的是整個目錄空白**。既有的 `get_effective_prices` 正是因為這個理由用正則守（`20260907010000:118-123`，檔內註解寫明那是 codex R1 的 must-fix）。

**逐字照抄它的判斷，一個字都不要多加**：

```sql
coalesce(
  CASE
    WHEN pr.price_by_tier -> 'store' ->> 'amount' ~ '^[0-9]+$'
    THEN (pr.price_by_tier -> 'store' ->> 'amount')::integer
  END,
  v.price_general
) AS price_general
```

`CASE` 沒有 `ELSE`，不符合的列回 NULL，再由外層 `coalesce` 退回一般價——與舊寫法「NULL 就退回一般價」的語意完全一樣。

🔴 **不要自作聰明多加守衛。** 這份計畫第一版加了 `nullif(...,0)` 與幣別判斷，R2 審查抓出來那是錯的，理由有三個，每一個都足以單獨否決：

1. **會跟商品頁與結帳算出不同的價。** `get_effective_prices` 對 `amount` = `'0'` 的列回 **0**（正則命中、不看幣別），而加了 `nullif(...,0)` 的 view 會退回一般價。同一支商品：目錄頁印 750、商品頁印 0、結帳收 0。**修一個不一致，造出一個更難發現的不一致。**
2. **與 Sean 的拍板方向相反。** Sean 2026-08-25 拍板「0 元是合法價格」（贈品、買一送一的那個「送」、試用品），`create_order` 那道閘為此從 `<= 0` 改成 `< 0`（`20260915100000:381-385` 逐字）。把 0 當成「沒有價格」是在推翻它。
3. **理由本身與程式事實不符。** 我原本寫「擋同步程式填的 0 placeholder」，但 `scripts/rpm-transform.ts:563` 是 `productStoreOf(...) ?? priceGeneral ?? 0`——只有在一般價**也是** null 時才會填 0，那種情況下退不退回一般價結果都一樣。幣別同理：同一行寫死 `currency: TWD`，那道守衛擋不到任何實際資料，只會製造分歧。

⇒ **如果真的要訂「0 元怎麼算」或「非台幣怎麼算」的規則，那要在同一支 migration 裡把 `get_effective_prices` 與 `create_order` 一起改**，而那是金流函式，要另外一份 plan 與一輪審查。本片只做一件事：讓目錄頁讀對欄位。

為什麼不是「讓同步程式開始寫 `products.price_store`」：那要重跑一整輪同步才會有值，而且從此有兩個欄位要保持一致，哪天不一致沒有人會發現。改 view 是一支 migration、當下生效、不用重跑同步，而且讓那一欄真正變成沒人用的死欄（要不要順手 DROP 它另案，本次不動）。

那支 migration 必須沿用 `20260908000000` 的寫法：`security_invoker` 刻意不設、兩道 REVOKE、誰都不 GRANT。少任何一道，經銷價就對 `authenticated` 開了。

### 4.3 改之前一定要先做的三件事（片 1）

全部唯讀（`scripts/readonly-prod-sql.sh` 或 `~/pcm-mailbox/0905查證/run.sh`）。探測 SQL 本身也要帶正則守，否則一筆壞資料會讓探測先炸，而那會被誤讀成「查不到」。

**① 有幾筆真的有經銷價**

```sql
-- 商品層：守衛後取得到值、而且與一般價不同的有幾筆
select count(*) from products
where case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end is not null
  and case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end <> price_general;

-- 變體層：有幾筆有值、有幾筆與一般價不同
select count(*) filter (where price_store is not null)                     as 有值,
       count(*) filter (where price_store is distinct from price_general)  as 有差價
from product_variants;
```

**這裡不可以用 `IS DISTINCT FROM`**：守衛後的值是 NULL 時（壞資料、缺 key），`NULL IS DISTINCT FROM 1500` 會回 true，**把壞資料算成「有差價」**——而這個數字正是 Sean 決定要不要灌價的依據。要先 `IS NOT NULL` 再比。

依第 4.0 節的實測，這兩層預期都是 **0**。量到不是 0 ⇒ 我對「從來沒灌過」的判斷錯了，停下重查。

**② 會不會有「經銷價比一般價貴」的錯價見客**

```sql
select count(*) from products
where case when price_by_tier->'store'->>'amount' ~ '^[0-9]+$'
           then (price_by_tier->'store'->>'amount')::integer end > price_general;
```

`project_0909-dealer-price-whole-package-after-launch` 記著：2026-09-09 有 **9 筆**不同、其中 **5 筆經銷價比一般價貴**（止滑貼 750 → 1500、搖臂護蓋 4600 → 12800 等），原因是網站把一般價與經銷價取自不同變體。今天目錄頁接的是 NULL，所以那幾筆藏著沒人看到；**一修 view 就直接見客**。

同步程式後來改過：`productStoreOf()`（`scripts/rpm-transform.ts:653-658`）現在取的是 `basis` 那一支的上游價，與 `price_general` 同一支，註解明寫「兩個數才是一對」。**所以根因可能已經修掉了，而 09-09 那個讀數是 14 天前的，我沒有複量。** 這個數不是 0 ⇒ **停，先查那幾筆，不要貼 view**。

**③ 有沒有非數字或非台幣的值**

```sql
select count(*) from products
where price_by_tier->'store'->>'amount' !~ '^[0-9]+$'
   or coalesce(price_by_tier->'store'->>'currency','') <> 'TWD';
```

這個數不是 0 ⇒ 上面那三個守衛就不只是保險，是現在就會用到的。

### 4.4 怎麼驗證

**正對照（改對了會看到）**：挑一支已知經銷價與一般價不同的商品，用經銷帳號在目錄頁看到的是經銷價，用一般帳號在同一頁看到的是一般價。今天兩個帳號看到的是同一個數字。

**⚠️ 如果 4.3 ① 量出來是 0，全站沒有任何一支商品有價差**，那這個正對照做不出來——`20260908000000:48` 逐字寫過同一件事：「改對與改錯會印出同一個畫面」。那種情況下要在拋棄式 PG 上自己造一筆有價差的資料來驗，不能宣稱「線上驗過了」。

**負對照（證明這把尺是活的）**：三個都要做，只做一個證不到事情。

1. 在拋棄式 PG 上把 view 的那一格**故意寫回 `pr.price_store`**，跑同一組查詢，經銷價必須退回一般價。如果照樣顯示經銷價，代表我量的不是這條路。
2. 在拋棄式 PG 上餵一筆 `amount` 是 `'1,500'` 的壞資料，view 必須照常回一般價、**不可以 RAISE**。這一格在驗三個守衛真的在。
3. 用一般帳號直接呼叫 `search_catalog_by_vehicle_dealer`，必須被 `RAISE EXCEPTION` 擋下（現役那一代的閘在 `20260922130000:649`）。如果它回了資料，代表身分閘壞了，這支 migration 不能貼。

**注意拋棄式 PG 證不到正式庫**（`reference_throwaway-pg-fixture-types-differ-from-prod`：09-19 板 217 就是假表型別與正式庫不同，Sean 貼上去當場炸）。貼之前要用 catalog 對一次型別，而且要確認正式庫 `products` 的欄位授權與 view 的 proacl 仍與 migration 相同（`reference_view-truth-is-in-the-live-db-not-the-migration`）。

**另外要留一發會紅的測試**（鐵則 13 第 ③ 條）：在 `apps/storefront/src/lib/catalog-tier-all-paths.test.ts` 那一族補一格，斷言經銷目錄拿到的價格來自 `price_by_tier->store` 而不是 `price_general`。**落筆前先餵一發該紅的**（把 view 定義換回舊的那一格，確認測試會紅）。

---

## 4.5 還有三個地方，經銷商在經銷站上也會看到牌價

修完 view 還不夠。下面三條路**寫死一般價**，經銷商在 b2b 站上會遇到「目錄與商品頁是經銷價、這三個地方是牌價」，同一個站兩種價：

| 檔案:行號 | 現況 |
|---|---|
| `apps/storefront/src/app/api/search/route.ts:177` | 搜尋疊層回 `price: p.price`，來源是公開 view，恆牌價 |
| `apps/storefront/src/lib/recommendations/rule-based-engine.ts:35-36` | 商品頁「相關商品」逐字「一律 `toUIProduct(p,'general')` strip」 |
| `apps/storefront/src/lib/product-jsonld.ts:246-250` | 結構化資料用 `product.price` / `v.price`（給 Google 看的，經銷站本來就不該被收錄，所以這一條跟著 2.3 節走就好） |

另外還有兩處已知的同族缺口，`docs/launch-todo.md` 記著 `⟦front-FEATUREDRAILGENERALPRICE⟧`（Sean 拍 B 先不修，理由就是等子網域）：`fetchFeaturedProducts()`（`apps/storefront/src/lib/products.ts:399`）釘死一般價，首頁精選與會員中心推薦兩處對經銷會員顯示牌價。

⇒ 這些要排成片 5b，時間 45 分：經銷模式下，搜尋疊層與相關商品要嘛改成取經銷價，要嘛不顯示價格（顯示「登入查看價格」之類）。**建議不顯示價格**——改成取經銷價要多開兩條取價路徑，而不顯示價格是刪東西，零新增路徑。這一題的選擇列進第 8 節 Q6。

---

## 5. 一般站要不要保留經銷價邏輯

**建議：全部移除**，讓一般站在結構上不可能出現經銷價。這也正是 Sean 2026-09-08 選子網域的理由——他自己寫的那張對照表裡，子網域那一欄逐字是「結構上不可能」。

### 要移除的程式路徑

| 檔案:行號 | 內容 |
|---|---|
| `apps/storefront/src/lib/products.ts:861-878` | 目錄頁 `tier === 'store'` 走經銷 RPC 的整段分支 |
| `apps/storefront/src/app/products/(catalog)/page.tsx:45,436` | 目錄頁取 tier |
| `apps/storefront/src/app/brands/[slug]/page.tsx:44,178` | 品牌頁取 tier |
| `apps/storefront/src/app/products/[slug]/page.tsx:33,123-190` | 商品頁疊 `dealerPrice` 的整段 |
| `apps/storefront/src/components/ProductInfo.tsx:175-195,379,418` | 顯示層選經銷價 |
| `apps/storefront/src/components/ProductPage.tsx:145-160,383` | 同上 |
| `apps/storefront/src/components/products-filter-logic.ts:183-211` | 經銷價參與篩選與排序 |
| `apps/storefront/src/app/cart/actions.ts:30,32,255,286-300` | 購物車與結帳改用經銷價 |
| `apps/storefront/src/lib/tier-prices.ts` | 整支只服務經銷價，一般站不需要 |

`apps/storefront/src/lib/tier.ts` **保留**：首頁還在用 `resolveTierFromRequest()`（`app/page.tsx:38,105`），而且經銷站那邊要用它做進站判斷。

### 風險：這一步不能單獨做

移除之後，一般站畫面顯示的是牌價，**但資料庫那支 `create_order` 仍然會依 `customers.tier` 收經銷價**：`supabase/migrations/20260915100000_m4b_couponfield_p_d_create_order_redeem_dryrun.sql:377` 逐字 `v_unit_price := coalesce(v_variant.price_store, v_variant.price_general)`。

⇒ 經銷商如果在一般站下單，會變成**畫面上是一件事、實際收的是另一件事**。這是金額不一致，不能留。

（順帶訂正一則舊記憶：`project_0909-dealer-price-whole-package-after-launch` 寫「結帳收一般價」，那是 09-09 的狀態。09-07 的 migration `20260907040000` 已經改成收經銷價，並且一路帶到 09-15 那一代。那一格現在是對的。）

所以第 5 節與第 8 節第一題綁在一起：

- 若 Sean 決定**經銷商不能在一般站下單**：移除顯示邏輯的同一片，要在一般站的購物車與結帳加一道「這個帳號請到經銷站下單」的擋下（改 `app/cart/actions.ts`），畫面與收款就一致。
- 若 Sean 決定**經銷商可以在一般站下單、而且照牌價**：那要改的是資料庫那支 `create_order`，屬於金流函式，要另外一份 plan 與一輪審查。
- 若 Sean 決定**經銷商可以在一般站下單、照經銷價**：那一般站就必須保留顯示邏輯，第 5 節整節不做，回到 2026-09-08 那個「每一頁都要記得」的狀態。

### 替代方案（如果不移除）

保留現狀，靠 `apps/storefront/src/lib/products.ts:861-878` 那個「經銷會員整條繞過快取」的做法擋快取混用。它今天是對的，代價是每加一個會顯示價格的新頁面，就多一次漏掉的機會——而顧客站已經有一個漏掉的例子：`fetchFeaturedProducts()`（`apps/storefront/src/lib/products.ts:399`）釘死一般價，首頁精選與會員中心推薦兩處對經銷會員顯示的是牌價（`docs/launch-todo.md` 記著 `⟦front-FEATUREDRAILGENERALPRICE⟧`，Sean 拍 B 先不修，理由就是等子網域）。

---

## 6. 分幾片、多久、順序

每片 15-45 分鐘（鐵則 4）。**片 1 到片 3 是資料修復，與子網域無關，可以先做、先驗收。**

| 片 | 內容 | 時間 | 需要 Sean 做什麼 |
|---|---|---|---|
| 1 | 正式庫唯讀複量第 4.3 節那三組數 | 20 分 | 無（唯讀） |
| 1b | **如果經銷價還沒灌**：照 `docs/runbooks/dealer-price-first-load.md` 走那五道門 | 另計 | **門 4 要 Sean 說「灌」這個字** |
| 2 | 若 4.3 ② 不是 0：查那幾筆的根因、寫進報告 | 30 分 | 可能要拍板怎麼處理 |
| 3 | 寫 `products_list_dealer` 改讀 `price_by_tier->store` 的 migration + rollback + 測試（含先餵一發該紅的） | 45 分 | **要 Sean 批准後才貼正式庫**（鐵則 8） |
| 4 | 新增 `lib/site-mode.ts`（一個環境變數、一個函式），根 layout 依模式分流 | 30 分 | 無 |
| 5 | 三種進站畫面與文案（第 3 節） | 45 分 | 文案要 Sean 看過 |
| 5b | 經銷站上的搜尋疊層與相關商品不再顯示牌價（第 4.5 節）；購物車與結帳 server action 在經銷模式擋下非經銷帳號 | 45 分 | 要先答 Q6 |
| 6 | 經銷站不被收錄：`lib/seo.ts`、`app/sitemap.ts`、`app/layout.tsx` metadata 三處 | 30 分 | 無 |
| 7 | Vercel 開第二個專案、掛網域、設環境變數；順便確認新專案的防火牆規則（Vercel 防火牆是專案設定、不在 repo，新專案一開是空的） | — | **只有 Sean 做得到**（Vercel 後台） |
| 7b | Supabase 後台 Redirect URLs 加 b2b；若保留 LINE 登入，LINE 後台加 Callback URL；確認 TapPay 商戶端有沒有回呼網址白名單要登記 | — | **只有 Sean 做得到** |
| 8 | Sean 自己開瀏覽器走一遍：一般帳號進 b2b、經銷帳號進 b2b 從目錄走到結帳 | — | **只有 Sean 做得到**（做完的定義） |
| 9 | 一般站移除經銷價邏輯（第 5 節），連同購物車擋下 | 45 分 × 2 片 | 要先答 Q1 |

合計程式工約 **4 小時 20 分**（片 1、2、3、4、5、5b、6、9），另加片 1b 的灌價流程與片 7、7b、8 由 Sean 操作的時間。

順序理由：片 1-3 修的是「經銷功能現在是壞的」，不修的話片 7 上線的經銷站在目錄頁還是顯示一般價。片 5b 要在片 8 之前，否則 Sean 走一遍時會看到同一個站兩種價。片 9 排最後，因為它要先確定經銷商真的能在 b2b 買完東西，才敢把一般站那條路拆掉。

**片 1b 要動 GitHub secret 與寫入正式庫商品價，片 3 要貼 migration，片 7 與 7b 要改 Vercel、Supabase、LINE、TapPay 的後台設定。** 其他片不碰正式庫、不碰設定。

貼板與推碼的順序（CLAUDE.md〈Git〉那條）：片 3 的 migration 與片 3 的測試要在**同一顆 commit**，板先貼、碼才合進 dev。這支改的是既有 view 不是新函式，部署時序閘只擋新函式與新 view，**擋不到這一支**，所以順序要人工顧。

---

## 7. 出事怎麼退回

| 出了什麼事 | 怎麼退回 | 可逆嗎 |
|---|---|---|
| 片 3 貼上去之後目錄頁價格不對 | 跑 rollback SQL，把 view 定義換回 `coalesce(pr.price_store, v.price_general)`。那一欄永遠 NULL，所以退回之後就是今天的行為 | 可逆，秒級 |
| 片 3 讓那 5 筆（或複量後的筆數）錯價見客 | 同上，退回 view。錯價來源在同步資料，不是 view | 可逆 |
| 經銷站 build 壞掉、環境變數打錯 | 一般站完全不受影響，兩個 Vercel 專案各自獨立部署。把 `b2b.pcmmotorsports.com` 從新專案拿掉即可 | 可逆 |
| 進站閘誤擋真的經銷商 | 經銷站那一頁有「前往 www.pcmmotorsports.com」按鈕，他還是買得到東西（照牌價）。**退回方式是在 Vercel 把 `b2b.pcmmotorsports.com` 從專案拿掉**，不是回滾片 4 那一顆——片 4 與片 5、5b 若分顆，只回滾一顆會留下一個沒有閘的經銷站 | 可逆 |
| 片 1b 灌了經銷價之後發現價格錯 | `dealer-price-first-load.md` 門 5 要求**先取 pre-image 再 dispatch**，落點在 repo 外。照那份 runbook 用 pre-image 還原 | 可逆，但**前提是門 5 有做** |
| 走了路 B（共用 cookie）之後一批客人登入壞掉 | **這一格最難退**：cookie 已經寫進客人的瀏覽器，程式回滾不會刪掉它。要另外做一支清舊 cookie 的路徑。這也是建議走路 A 的原因 | **不好退** |
| 片 9 移除之後才發現經銷商需要在一般站買東西 | `git revert` 那幾顆 commit。程式碼還在 git 裡，沒有資料損失 | 可逆 |

所有不可逆的動作（貼 migration、改 Vercel 網域、改 Supabase 設定）都排在各自那一片的最後，而且要 Sean 批准。

---

## 8. 要 Sean 決定的題目

已經拍過的不再問：經銷價顯示未稅且不標「未稅」、刷卡 +5%、匯款不加稅（`project_0906-dealer-price-display-tax-by-payment-method`）；發票是手寫紙本不串平台（`project_0913-invoice-handwritten-paper-no-platform`）；統編前台不開、客人講員工後台填（`project_0914-tax-id-frontend-stays-hidden`）。

### Q1　經銷商能不能在一般站（www）下單？

這題會決定第 5 節與片 9 做不做。今天的狀況是：畫面顯示什麼由程式決定，實際收多少由資料庫 `create_order` 依帳號 tier 決定，兩邊必須講同一件事。

- **甲（建議）**：不能。一般站的購物車與結帳偵測到經銷帳號就擋下，文案寫「您的帳號為經銷商帳號，請至 b2b.pcmmotorsports.com 下單」。一般站完全移除經銷價邏輯，結構上不可能出現經銷價。
- 乙：可以，而且照牌價買。要改資料庫金流函式 `create_order`，另外一份 plan 與一輪審查。
- 丙：可以，照經銷價買。一般站必須保留全部經銷價邏輯，第 5 節不做，回到「每加一頁多一次漏掉的機會」的狀態。

**員工端不受這題影響**（先講清楚，免得誤會）：後台建單的單價是員工自己打的（`20260915233000:439`），換貨依訂單成立時凍結的 `orders.tier_at_checkout`（`20260922100000:273-277`），儲值金與優惠券都走同一支 `create_order`。這三條路都不會繞過一般站那道擋下。

### Q2　登入狀態要不要跨 www 與 b2b 共用？

- **甲（建議）**：不共用。同一組帳號、同一組密碼，在 b2b 自己登入一次。改 0 行程式。
- 乙：共用。要把登入 cookie 改成整個 `pcmmotorsports.com` 通用，代價是這顆 cookie 會同時送到後台與報價單網域，而且改版當下已登入的客人可能被登出或卡住（詳見 2.4 路 B）。

### Q3　經銷商資格怎麼開通？b2b 要不要做申請表單？

經銷身分今天是員工在後台手動標的（`apps/admin/src/components/customers/tier-edit-form.tsx`），不是客人註冊時選的。所以「第一個經銷會員註冊要不要通知」這個問題的前提不成立——標的人自己就是員工。

- **甲（建議）**：不做表單，0 改碼。客人打電話或 LINE 談，員工在後台把他標成經銷商。b2b 那頁「沒有經銷資格」的說明寫「請與 PCM 業務聯絡開通」。
- 乙：b2b 做一個申請表單，送出後寄信通知 sean@pcmmotorsports.com。多一個表單、一條寄信路徑與一個後台待審清單。

（這題與 `project_0913-next-bind-identity-to-quote-login` 那件事不衝突。那件排的是「員工用自己的報價單帳號登入後台」，管的是員工；這題管的是客人怎麼變成經銷商。兩件可以先後做，甲不會擋住那件。）

### Q4　經銷站的免運門檻跟一般站一樣嗎？

**運費怎麼算稅已經拍過，不再問**：Sean 2026-09-07 逐字「經銷商在網頁都是未稅，刷卡+5%（就是含稅）運費就是 105 這樣沒錯」（`project_0907-sean-rulings-qb1-qb3-freight`）⇒ 經銷單有運費、運費當未稅進稅基，100 變 105。

沒拍過的只有**門檻**。一般站現在是「滿 NT$ 5,000 免運」。

- **甲（建議）**：一樣，沿用滿 5,000 免運。0 改碼，之後要改再改。
- 乙：經銷單另訂門檻（請 Sean 給數字）。要改運費計算，碰金額。

「經銷單一律免運」不列為選項，因為它與上面那條拍板（經銷單運費 100 變 105）直接相撞。

### Q5　身分查不到的時候，經銷站要擋還是要放？

Sean 2026-09-08 拍過「查不到身分給牌價、不給錯誤頁」，那條拍板的場景是一般站。經銷站方向相反。

- **甲（建議）**：擋。顯示「目前無法確認您的經銷資格，請重新整理」，不顯示任何商品。錯的方向是經銷商暫時進不來。
- 乙：放，給牌價。錯的方向是身分不明的人看到整個經銷站的頁面結構（價格仍然不會洩漏，資料庫會擋）。

### Q6　經銷站上的搜尋疊層與「相關商品」怎麼處理？

這兩處今天寫死一般價（第 4.5 節）。不處理的話，經銷商在同一個站會看到兩種價。

- **甲（建議）**：不顯示價格，改成商品名稱與圖片就好。這是刪東西，不多開取價路徑，也不會出現兩種價。
- 乙：改成取經銷價。要多開兩條取價路徑，而每一條都是一個以後可能漏掉的地方——那正是 Sean 2026-09-08 選子網域時想避開的形狀。

---

## 審查紀錄

### R1　2026-09-23　Fable 對抗審查（`adversarial-reviewer`）

**🔴 這一輪沒有 Codex。** Codex 額度用完到 2026-09-27（`project_0911-codex-quota-fable-as-second-review`），所以鐵則 12 那一路是用 Fable 代打的，**深度不等於 Codex 那一路**。

結果：**FAIL，4 條必修。** 每一條我都自己開檔複核過才改，不是照抄審查意見。

| 編號 | 問題 | 處置 |
|---|---|---|
| M1 | 原本寫的 `::integer` 裸轉型沒有守衛。資料庫的 CHECK 只保證 key 存在、不保證值是數字，一筆 `'1,500'` 會讓整張經銷目錄查詢炸掉，而顧客站對經銷路徑刻意不退回公開查詢 ⇒ 經銷商看到整個目錄空白 | 已修。第 4.2 節改成照抄 `get_effective_prices` 的正則守，另加 `nullif(...,0)` 與幣別判斷 |
| M2 | 原本寫「變體那條路有值、是對的」，而我引用的「1 筆」出自 `20260908000000:46`，那一行的分母明寫是 **products** 不是變體。查下去發現更大的事：**真的經銷價可能從來沒有灌進網站過**（`dealer-price-first-load.md` 門 4 要 Sean 說「灌」這個字，而那顆 secret 的值讀不出來） | 已修。新增第 4.0 節把「兩個病」講開，片 1 加量變體層，片 1b 排灌價流程 |
| M3 | 原本把「`price_by_tier` 帶 store 26,642 筆」當成「有 26,642 筆經銷價」。那個數就是商品總數，因為 CHECK 逼每一列都要有那個 key；沒有真經銷價時同步程式填的是一般價或 0（`rpm-transform.ts:563`） | 已修，寫進第 4.1 節 |
| M4 | 原本寫根 layout 是「一個檔案、一個選擇點」。route handler、server action、sitemap/robots 都不經過它；而且經銷商在經銷站上，搜尋疊層與相關商品仍顯示牌價 | 已修。第 2.5 節加了射程表，新增第 4.5 節與片 5b |

審查員另外提的 7 條建議（nit）已併入：`proxy.ts` 檔名、cookie 會送到 `bikes` 子網域、後台沒用 `@supabase/ssr`、員工端下單路徑不受 Q1 影響、回滾要拿掉網域而不是回滾單顆 commit、TapPay 回呼白名單、Vercel 防火牆新專案是空的。

有一條我**沒有採納**：審查員說 `scripts/rpm-transform.ts:678` 是註解、程式在 `:679`。我 `grep -n` 核過，`:678` 就是 `price_store: dealerPriceOf(v.sku, dealerPrice),` 那一行，原文是對的。`productStoreOf()` 的行號他說得對，已從 654-660 改成 653-658。

### R2　2026-09-23　Fable 對抗審查

結果：**FAIL，1 條必修。** 已修完，但照鐵則 12「R2 還有必修 ⇒ 不跑 R3，停下端 Sean」，**到此為止，等 Sean 看過**。

**必修：第一版的 §4.2 我自己多加的兩道守衛是錯的。**

我原本在 view 的 CASE 外面包了 `nullif(...,0)`，又加了幣別判斷，理由寫成「擋 0 placeholder、擋非台幣」。審查抓出三件事，我逐條開檔複核過，三件都成立：

1. 它會讓目錄頁與商品頁、結帳對同一筆資料算出**不同的價**（`get_effective_prices` 對 `'0'` 回 0，我的 view 會退回一般價）。修一個不一致，造出一個更難發現的不一致。
2. 它與 Sean 2026-08-25「0 元是合法價格」那條拍板方向相反（`20260915100000:381-385`）。
3. 我寫的理由與程式事實不符：`rpm-transform.ts:563` 只在一般價也是 null 時才填 0，幣別那一行寫死 `TWD`，兩道守衛都擋不到任何真實資料。

⇒ §4.2 已改成**逐字照抄 `get_effective_prices:118-123`**，只留正則、`ELSE NULL`、外層 `coalesce` 退回一般價。§4.3 的探測 SQL 同步改掉。

**R2 另外提的四條建議，全部採納：**

- 「經銷價有沒有灌過」其實查得到，不必寫成未確認。我自己跑了 `gh run view 35710220221 --log`（唯讀），六家供應商每一家都印 `allowlist: (空) · 家數 0`。§4.0 已從推論改成實測，片 1b 從「如果」改成「必做」。
- §4.3 ① 的探測 SQL 原本用 `IS DISTINCT FROM`，壞資料（守衛後是 NULL）會被算成「有差價」——而那個數字正是 Sean 決定要不要灌價的依據。已改成先 `IS NOT NULL` 再比。
- Q4 的運費**已經拍過一半**：Sean 2026-09-07 逐字「經銷商在網頁都是未稅，刷卡+5% 運費就是 105」（`project_0907-sean-rulings-qb1-qb3-freight`）。原本的選項「經銷單一律免運」與那條拍板相撞，已拿掉，題目收窄成只問免運門檻。
- Q3 與 `project_0913-next-bind-identity-to-quote-login` 的關係已在題目下面講明。

行號訂正：`fetchFeaturedProducts()` 是 `products.ts:399`、`browser.ts:23`、`productStoreOf()` 是 `:653-658`；§2.5 與 §4.4 引的經銷目錄函式身分閘已換成現役那一代（`20260922130000:649`，GRANT 在 `20260916220000:1063`）。

---

## 這份計畫裡哪些是我親自驗過的、哪些不是

**親自開檔核過（本機 repo 的字面）**：第 4.1 節那張三個欄位的表、第 4.2 節引用的 CHECK 與正則守、第 4.5 節三處寫死一般價、第 5 節的檔案行號清單、第 2.4 節「沒有 middleware 也沒有 proxy」與「cookie 沒有設 domain」、第 2.5 節三道資料庫身分閘、第 5 節 `create_order` 現在收經銷價（而且 `supabase/APPLIED.tsv` 顯示 `20260915100000` 已貼）、Q1 底下員工端那三條路。

**自己實跑過的**：`gh run view 35710220221 --log`（2026-09-23 唯讀），確認 2026-09-22 那一輪同步的經銷價 allowlist 是空的 ⇒「經銷價從來沒灌過」是量到的，不是推論。

**沒有親自驗的**：

- 正式庫今天的筆數（15 位會員、tier=store 0 人、`product_variants.price_store` 非空 1 筆、`price_by_tier` 帶 store 26,642 筆）是後台窗 2026-09-23 唯讀實查給的，我**沒有複量**。
- 第 4.3 節那「9 筆 / 5 筆」是 2026-09-09 的讀數，**已經 14 天，必須複量**（片 1 就是在做這件事）。
- **正式庫現在的欄位授權與 view 的 proacl 是不是仍與 migration 檔一致**，我只讀了 migration，沒有查活的庫（`reference_view-truth-is-in-the-live-db-not-the-migration`：view 的真相在活的庫，不在 migration）。片 3 貼之前要查。
- 第 2.1 節的 Vercel 專案表是 2026-09-11 的，而 `docs/handoff/CURRENT.md` 顯示網域之後變過，**開專案前要重看後台**。
- `pcm-website-v2` 專案的 Root Directory 與 Build Command 我查不到（repo 裡沒有 `.vercel/project.json`）。
- **TapPay 商戶端有沒有回呼網址白名單**要登記 b2b，我沒查（刷卡是金流，這一格不能用猜的）。
- Vercel 防火牆規則是專案設定、不在 repo，新專案一開是空的。顧客站現在有哪些規則我沒查。
