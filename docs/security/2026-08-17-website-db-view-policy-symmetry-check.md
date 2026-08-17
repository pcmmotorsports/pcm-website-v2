# 網站庫:view WHERE ≠ 底表 anon policy USING 對稱檢查(把報價單庫 round2 方法套過來)

- **窗**:E(資安稽核,唯讀)　**日期**:2026-08-17　**庫**:`pcm-website-v2`(網站庫)production
- **憑證**:`pcm_audit_ro`,真登入(`current_user=session_user=pcm_audit_ro`);庫別自檢 `to_regclass('public.customers')`=customers、`orders`=orders ⇒ **是網站庫**
- **動機**:同一個盲點(view 的 `WHERE` 與底表 anon policy 的 `USING` 沒逐維比)在報價單庫 round1 出現過一次 ⇒ 那是方法缺口不是巧合。網站庫是**經銷價與會員資料所在的庫**,若這裡也有一格對不上,份量更大。
- **口徑**:本檔只對**網站庫**成立;metadata only、零業務資料列。

## 0. 結論:**網站庫【沒有】那個 asymmetry**(而且它用的正是我建議報價單庫改成的寫法)

- anon 可讀的 **invoker** view **3 支**(分母)——**都沒有自帶 row 過濾 WHERE**,過濾**全部委派給底表 RLS** ⇒ 走 view 讀與直查表讀看到**同一組 row**、**無繞過**。
- 🔴 **經銷價外洩檢查(Sean 第二優先)= PASS**:anon 對 `price_store`/`price_by_tier` 欄級 SELECT **皆 f**;敏感欄總計 anon=**0**、對照 postgres=1(判定式活)⇒ **即使 anon 繞過 view 直查 `products`,也讀不到經銷價**。

## 1. 對稱檢查(附配對控制組 + 分母 + 比了哪幾維)

**分母:anon 可讀 view 共 4 支**(`has_table_privilege('anon',...)=t`):3 支 invoker + 1 支 definer(見 §3)。

**3 支 invoker view 逐支查「有沒有自帶 row 過濾」**(grep viewdef:`where|delisted|is_listed|is null|is not null|published|active|hidden|stock`):

| view | mode | 底表 | 自帶 row 過濾? |
|---|---|---|---|
| `products_public` | invoker | `products`, `product_image_trim` | **無**(唯一 WHERE 命中在 CASE 運算式 `WHEN t.url IS NULL` 內,非 row filter) |
| `products_list_public` | invoker | `products`, `brands`, `categories` | **無** |
| `product_variants_public` | invoker | `product_variants` | **無** |

**底表 anon(TO PUBLIC,涵蓋 anon)policy 的 USING**:
- `products.products_select_public` = `delisted_at IS NULL`
- `product_variants.product_variants_select_public` = `EXISTS(products p WHERE p.id=product_variants.product_id AND p.delisted_at IS NULL)`
- `brands`/`categories`/`product_image_trim` 的 `*_select_public` = `true`

🔴 **配對控制組(兩把尺同時量,一 t 一 f)**:
```
policy 引用 delisted_at ?  t   ← products_select_public 的 USING 確實含 delisted_at
view   引用 delisted_at ?  f   ← products_public viewdef 不含 delisted_at
```
⚠️ **這裡的 `f` 意義與報價單庫【相反】**:報價單庫是「view 自帶 WHERE、且比 policy 嚴」⇒ 直查繞過;網站庫是「**view 根本沒有自帶 WHERE**」⇒ 過濾只由 RLS 做一次。控制組證明我的比較是活的(policy 這邊查得到 delisted_at),而 view 那邊的 `f` 代表「無自帶過濾」不是「漏了一維」。

**逐維結論**:view 顯示的 row = `RLS policy` AND `view WHERE(=TRUE)` = `RLS policy`;直查表的 row = `RLS policy`。**兩者恆等 ⇒ 無 bypass。**

## 2. 🔴 兩庫用【不同 pattern】—— 網站庫是報價單庫該改成的樣子

| | 報價單庫(有洞) | 網站庫(無洞) |
|---|---|---|
| 過濾住哪 | view 自帶 `WHERE is_listed AND NOT hidden` **且** policy 另一組(少 is_listed) | **只在 RLS policy**,view 不自帶 |
| 直查表 vs 走 view | **看到不同 row**(view 嚴、直查鬆)⇒ 繞過 | **看到同一組 row** ⇒ 一致 |

📎 **這證實 a4 的判斷**:同一方法在兩庫各跑一次是對的 —— 但結果不是「兩庫都有洞」,是「網站庫用了正確寫法、報價單庫沒有」。**報價單庫 finding#2 的修法方向 2(把過濾集中到 policy)在網站庫已經是現狀**,可當先例。

## 3. definer view `vehicle_taxonomy_public`(#550,不同軸,今天安全)

`security_invoker` 未設(=definer)⇒ 以 owner 權限跑、**繞過底表 RLS**。底表=`product_fitments`/`product_fitments_effective`。
暴露欄 **4 個**:`moto_brand`/`model_code`/`year_start`/`year_end`(敏感詞掃描 0 命中)⇒ 純車輛分類公開參考資料,**今天無敏感外洩**。
🔴 **#550 的風險是未來漂移**:因為它繞 RLS,日後只要有人往這支 view 或其底表加敏感欄/改用途,RLS 不會接住,而引爆的改動看起來會完全無關。**追蹤項,非今日洞。**

## 4. 🔴 順帶收掉 Sean 第一優先:外部匿名對客戶/訂單/金流表 = 零存取(量到的)

分母:public schema 名稱命中 `^customer|^order|payment|wallet|refund|charge|address|^auth` 的 **28 張表**(對照 postgres 對 28 張皆可讀,判定式活)。

```
anon  對 28 張表:表級 SELECT 全 f、欄級可讀欄數全 0    ← 外部匿名對客戶/訂單/金流零 DB 存取
```
⇒ **Sean 第一優先(外部讀到客戶資料)在 DB grant 層直接擋死**,不倚賴 RLS(RLS 是第二道)。

## 5. 🔴 會員隔離命脈:被盜的會員 token 只讀得到自己(量到的)

`authenticated`(已登入會員)對 `customers`/`orders`/`order_items`/`customer_addresses`/`customer_vehicles`/`customer_wallet_ledger` **有**欄級 grant ⇒ 會員間隔離**靠 RLS、不靠 grant**。逐表查 SELECT policy 的 USING:

| 表 | policy | USING |
|---|---|---|
| `customers` | customers_select_own | `auth.uid() = user_id` |
| `orders` | orders_select_own | `customer_user_id = auth.uid()` |
| `order_items` | order_items_select_own | `EXISTS(orders o WHERE o.id=order_items.order_id AND o.customer_user_id=auth.uid())` |
| `customer_addresses` | addresses_select_own | `auth.uid() = customer_user_id` |
| `customer_vehicles` | vehicles_select_own | `auth.uid() = customer_user_id` |
| `customer_wallet_ledger` | wallet_select_own | `auth.uid() = customer_user_id` |

⇒ **每一條都綁 `auth.uid()`=own** ⇒ **被盜/惡意的會員 token 只能讀自己的客戶/訂單/地址/車輛/儲值資料,讀不到別的會員**(帳號被盜情境的 DB 層防線成立;與軸二 app 層「無 IDOR」互相印證,是同一件事的兩層)。

## 6. 🔴 外部 REST 實打確認(2026-08-17,Sean 交付網站庫 anon key 後)

前面 §1-5 是 DB metadata;本節用**真正的網站庫 anon key**(`sb_publishable_…`,len 46,新格式;REST base `https://bmpnplmnldofgaohnaok.supabase.co/rest/v1`)**外部實打**,把兩大優先從「metadata 證」升成「外部 REST 證」。全程 GET-only、count-only、雙向表演、不印 key。

**庫別三發對照(確定打的是網站庫,不是報價單庫 —— 兩把 key 同前綴同長度,拿錯不報錯)**:
```
網站 key + products_public       ⇒ 206  0-0/19777   （products_public 是網站庫限定 view）
報價單 key + 同 endpoint          ⇒ 401              （報價單 key 對網站專案無效）
網站 key + storefront_catalog_v   ⇒ 404              （storefront_catalog_v 是報價單庫限定）
⇒ 三個世界印不同的東西 ⇒ 確定我在網站庫、用對 key
```

**🔴 Sean 第一優先(客戶/訂單/金流外部零存取)**:
```
customers               ⇒ 401  body 42501「permission denied … GRANT SELECT ON public.customers TO anon」
orders / order_items / order_payments / payment_charge_attempts / customer_addresses ⇒ 全 401
```
⇒ **外部匿名對客戶/訂單/金流 REST 端點全部 permission denied**(anon 連 grant 都沒有),不倚賴 RLS(grant 層直接擋)。

**🔴 Sean 第二優先(經銷價外部零漏,雙重擋)**:
```
products?select=handle       ⇒ 206  0-0/19777   （授權欄,對照亮）
products?select=price_store  ⇒ 401              （anon 無欄級授權）
products?select=price_by_tier⇒ 401              （anon 無欄級授權）
products_public?select=price_store ⇒ 400 body 42703「column products_public.price_store does not exist」
```
⇒ **經銷價外部讀不到,而且是兩道【機制不同】的獨立擋(縱深兩層,不是單一控制;同 §5-b 那把尺)**:
- ① products 表:`401` = **欄存在、但 anon 沒有欄級授權**(靠 grant 設定對)。
- ② `products_public` view:`400「column does not exist」` = **這條對外路上根本沒選那一欄**(靠 view 定義,比 grant 更強:不倚賴任何權限設定維持正確)。
🔴 **兩道要同時失效才漏** —— 有人給 anon 補一個 price_store 欄級授權(破①),products_public 那條路仍然沒有那一欄(②還在);反之亦然。**這比「單一 grant 在擋」穩一層。**

**OpenAPI root**:`GET /rest/v1/` ⇒ 401「Only secret API keys can be used」⇒ anon 拉不到 schema introspection,攻擊者無法用公開 key 枚舉整個 table/RPC 面(同報價單庫的硬化)。

⇒ **兩大優先在網站庫【外部 REST 層】確認,不只 DB metadata**;與報價單庫同樣的對照面都齊了。
📎 §1 的 facet-counts 放大(#1)/ resolveCartLines 往返(#7)是 **Vercel app 層**(route / server action),**anon key 打的是 Supabase REST、量不到它們**;#3 是壓測、明文不在正式站做 ⇒ 那三條不因這把 key 而解,見 `section1-unverified-items-round2` §1。

## 口徑

網站庫這輪:對稱檢查**無 asymmetry**(3 支 invoker view 皆委派 RLS)、經銷價欄級 anon=0、definer view 今天非敏感、**外部 anon 對 28 張客戶/訂單/金流表零存取、會員 token own-only(RLS 綁 auth.uid())**;§6 外部 REST 實打再證兩大優先(客戶 401、經銷價 401+欄不存在)。全 metadata + 外部 GET count-only、零業務列。
