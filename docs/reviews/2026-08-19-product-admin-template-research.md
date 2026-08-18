# 商品後台【模板調研片】—— 現成方案 / 特價 / 優惠券資料模型

> **這是調研,不是設計。** 不畫 UI、不寫 code、不裝任何東西。產出 = **取捨表給 Sean 拍**。
> 依據:memory `project_product-editing-admin-research-templates-first`(Sean 2026-08-11 逐字
> 「這個到時候**要去研究看有沒有適合的模板可以套用**」)⇒ 這條線的**第一片 = 模板調研**,不直接開手刻 plan。
> 觸發:Sean 2026-08-19 `Q18=A`(重新找)+ 他當晚提出的**優惠券代碼**新需求。
>
> 🔴 **調研者不是判斷者**:本檔**不推薦任何一個方案**。每一格附來源,推不出來的寫「未確認 + 缺哪一道」。

---

## §0 先講三個【量到的】現況 —— 它們直接決定取捨

```
① 特價:**我們今天沒有任何特價欄位**
   grep -rn 'sale_price|special_price|compare_at|discount_price|price_sale' supabase/migrations
     packages/adapters/src/supabase/database.types.ts   ⇒ **0 命中**
   負向對照(同尺該命中的)`price_general` 於 database.types.ts ⇒ **11 命中** ✅ 尺會動
   ⇒ 🔴 Sean `Q2=甲`「原價只回報價單改、**後台只管特價**」——
      **而「特價」這個欄位還不存在。** 後台要管的東西目前沒有落點。

② 優惠券:**零實作,如他所說是全新的**
   grep -rn 'coupon|voucher|promo_code|discount_code' apps packages supabase
     (.ts/.tsx/.sql,排 node_modules、排測試)   ⇒ **0 命中**

③ 價格今天長這樣(兩支整數欄,無變體以外的層級)
   products         price_general / price_store   `20260516064013:10-11`
   product_variants price_general / price_store   `20260531142533:44-45`(integer、nullable、CHECK >= 0)
   🔴 同檔 `:6` 逐字「Sean 拍板:**#81 落地走 A 真變體**」
```
🔴 **③ 的最後一行順帶更正我自己**:我今天稍早在 `#81` 條目寫「這就是候選 **B**」——
**兩個獨立來源都說 A**(`20260531142533:6` 與 `packages/domain/src/catalog/types.ts:207`)
⇒ **我的 B 是推的、不是讀的,收回。** 實物 = 自家 `product_variants` 表 + `spec jsonb`。

---

## §1 現成方案盤點 —— **先分兩類,因為它們是兩種不同的東西**

**這是本調研最重要的一句話:**

| 類 | 是什麼 | 對我們的意義 |
|---|---|---|
| **A. 完整電商後端**(Medusa / Saleor / Vendure) | 它**自帶一整套資料庫 schema**(products / variants / prices / orders…) | 🔴 **等於換掉我們的資料庫** —— 我們的 `products` / `product_variants` / `orders` 全部要遷 |
| **B. 無頭後台框架**(Refine / React-Admin) | 它**沒有自己的 schema**,接你現有的資料來源產 CRUD 畫面 | ✅ **坐在我們現有的 Supabase 上**,不動資料 |

⚠️ **A 類的那句「等於換掉資料庫」我標【推論】** —— 它來自 A 類產品的設計(自帶 migration 與 data model),
**而我沒有找到一篇官方文件逐字寫「不能接既有 Postgres 表」**(搜過,結果不直接回答)⇒ **未確認,缺一道官方明文。**
📌 但**對我們的決定影響不大**:即使技術上接得上,`§2` 那八條拍板已經足以判掉 A 類(見下)。

### 候選清單(來源附在 §5)
```
A 類  Medusa v2      Node/TS、Postgres、模組化;Promotion 模組成熟(見 §4)
      Saleor         Python/Django、GraphQL;Voucher 模型最完整(見 §4)
      Vendure        Node/TS、GraphQL   ← **未查**(本輪沒讀它的文件,標未確認)
B 類  Refine         headless React 框架,**內建 Supabase data provider**;UI 不綁死(Ant/MUI/Mantine/shadcn)
      React-Admin    資料密集型後台首選;免費版覆蓋多數情境,企業版才有 RBAC / audit log
      Directus       偏內容團隊;Cloud $99/月起,自架可行
```

---

## §2 🔴 **必答那一格:它們能不能吃下我們既有的八條拍板**

來源:memory `project_0815-product-admin-eight-rulings`(Sean 2026-08-15 逐題拍板)。

| 拍板 | 內容 | A 類(Medusa/Saleor) | B 類(Refine/React-Admin) |
|---|---|---|---|
| **Q1** | 員工改的值**不給同步蓋**,不必填原因,**靠變更紀錄** | ❌ **吃不下** —— 它們沒有「欄位級鎖 + 來自外部夜間同步」這個概念;要自己加 | ✅ 這是**我們自己的 DB 邏輯**,框架不介入 |
| **Q2** | 原價只回報價單改,**後台只管特價** | ❌ **正面衝突** —— A 類把價格當成**它的**權威,而我們的原價權威在**報價單 repo** | ✅ 不介入 |
| **Q3** | 大量改價**進位到整數元** | ⚠️ 可設定,而多數以最小貨幣單位存,要對過 | ✅ 不介入 |
| **Q4** | 一個**主分類 + 多個副分類** | ⚠️ 多半是「多對多 collections」,**沒有主/副之分** ⇒ 要自己加一個「哪個是主」的欄 | ✅ 不介入 |
| **Q5** | **每個變體各自有庫存** | ✅ 標準做法,吃得下 | ✅ 不介入(而我們**今天沒有庫存欄**,見 §3) |
| **Q6** | 庫存 0 **仍可下單**(預購) | ✅ 多半有 `allow_backorder` 之類的開關 | ✅ 不介入 |
| **Q7** | 「手動商品」拆成**人工建立的**與**有人工改過的**兩個條件 | ❌ **吃不下** —— 那是我們同步管線的概念 | ✅ 不介入 |
| **Q8** | 「我的檢視」**大家都能建、都能改** | ⚠️ 各家做法不一,多半沒有共享檢視 | ⚠️ 要自己做,但**框架不擋** |

### ⇒ 這張表的結論(而它不是推薦,是**判掉**)
🔴 **A 類在 `Q1` / `Q2` / `Q7` 三條上正面衝突,而那三條全是【我們與報價單 repo 之間的同步契約】。**
把商品權威搬進 A 類 = **把「原價只回報價單改」這條拍板作廢**。
⇒ **A 類不是「要不要用」的問題,是它與一條已拍板的架構決定互斥。**
⚠️ **未確認**:我**沒有**驗證「A 類能不能只當 admin UI、不當資料權威」——
理論上可以雙寫,而**那等於自己維護兩套真相**,成本我沒量。**缺一道:實際搭一次試。**

---

## §3 特價 —— **主流怎麼做,以及我們缺的那一格**

```
主流做法(Shopify 為代表):**兩個價格欄,不是一個「折扣」欄**
  price             = 現在賣多少(**售價**)
  compare_at_price  = 劃掉的那個數字(**原價**)
  規則:compare_at_price > price 才會顯示成「特價中」
  變體層可各自設;而**變體之間不一致(有的空、有的 0)會讓列表頁不顯示特價徽章**
🔴 **Shopify 原生【沒有排程】** —— compare-at price 要**人工改回去**;
   有起訖時間的檔期要靠第三方 app。(這一格直接對上 Sean 要的「期間」)
```

### 🔴 對我們的意義(三格,前兩格是量到的)
```
① 我們今天有 price_general / price_store 兩欄,**沒有第三欄放特價**
② Sean Q2 拍「後台只管特價」⇒ 特價必須是**一個獨立於 price_general 的欄位**
   否則後台一改就會蓋掉「原價只回報價單改」那條線
   ⇒ 形狀上最接近的是 Shopify 的兩欄制,而**方向相反**:
      我們的 `price_general` 是**原價(報價單權威)**,新欄是**售價(後台權威)**
      ⇒ 顯示層要改成「有特價就顯示特價 + 劃掉 price_general」
③ ⚠️ **未確認**:特價要不要**排程(起訖)**。Sean 對優惠券明確講了「期間」,
   **對特價沒講** ⇒ 這是要問他的一格,不要替他決定
   (而 Shopify 原生無排程 = 主流也覺得這件事不便宜,值得當成獨立一題)
```

---

## §4 優惠券 —— **他點名的五個維度,四家怎麼存**

> Sean 逐字:「優惠券的設定方式、**次數**、期間、折扣%數或者折多少錢這樣、甚至是**能使用幾次**。」

### 🔴 先回答「次數」與「能使用幾次」是不是同一件事 —— **不是,查到的四家都分兩欄**
(分母 = 我這輪讀過文件的 **4 家**:WooCommerce / Shopify / Saleor / Medusa v2;**Vendure 沒查**。逐字欄名見下表。)

| 系統 | 總量上限 | 每人上限 |
|---|---|---|
| **WooCommerce** | `usage_limit`(逐字「How many times the coupon can be used **in total**」) | `usage_limit_per_user`(逐字「How many times the coupon can be used **per customer**」) |
| **Shopify** | `usage_limit`(store-wide,留空=無限) | `once_per_customer`(布林,**只有「一次」沒有「N 次」**) |
| **Saleor** | `usageLimit`(逐字「in total」across all customers) | `applyOncePerCustomer`(布林) |
| **Medusa v2** | `limit` + `used`(v2.12.0 起) | **本輪查到的文件沒有明列每人上限** ⇒ 未確認 |

⇒ 🔴 **他講的兩件事在這四家都是【兩個欄位】,不是一個。**
**逐家點名(4 家的分母全列,不留白)**:
```
每人 N 次(整數)  WooCommerce  `usage_limit_per_user`
每人一次(布林)  Shopify      `once_per_customer`
每人一次(布林)  Saleor       `applyOncePerCustomer`
**未確認**        Medusa v2    本輪讀的兩份文件都沒明列每人上限 ⇒ 不算進任何一邊
```
⚠️ **原句我寫成「其中三家只做得到布林」—— 那是錯的,布林的是【兩家】,第三家是未確認。**
⇒ **要不要做到「每人 N 次」是一個真的取捨題**:四家裡**只有一家**給整數。

### 五個維度 × 四家(逐字欄名)

| 維度 | WooCommerce | Shopify | Saleor | Medusa v2 |
|---|---|---|---|---|
| **代碼** | `code` | discount code | `code` / **`codes`(一張券可掛多組碼)** | `code` |
| **折扣型態** | `discount_type` = `percent` / `fixed_cart` / `fixed_product` | `discount_type`(百分比 / 定額) | `discountValueType` = `PERCENTAGE` / `FIXED` | ApplicationMethod `type`(如 `percentage`)+ `value` |
| **金額 / %數** | `amount`(逐字「always numeric, even if setting a percentage」) | `value` | 值 + `VoucherChannelListing` | `value` + `currency_code` |
| **期間** | `date_expires` / `date_expires_gmt`(**只有到期,沒有開始**) | `starts_at` / `ends_at`(ISO 8601) | `startDate` / `endDate` | Campaign `starts_at` / `ends_at` |
| **總次數** | `usage_limit` | `usage_limit` | `usageLimit` | `limit` / `used` |
| **每人次數** | `usage_limit_per_user` | `once_per_customer`(布林) | `applyOncePerCustomer`(布林) | 未確認 |

### 📌 而它們還有四個【他沒提、而主流都有】的維度 —— 列出來讓他知道有這些選項
```
· 門檻      minimum_amount / maximum_amount(Woo)、minSpent(Saleor)、minCheckoutItemsQuantity(Saleor)
· 適用範圍  product_ids / excluded_product_ids / product_categories / excluded_product_categories(Woo)
· 可否疊加  individual_use(Woo,逐字「can only be used individually. Other applied coupons will be removed」)
· 特價品    exclude_sale_items(Woo,逐字「will not be applied to items that have sale prices」)
  🔴 **最後這一條與 §3 直接連動** —— 我們一旦有了特價,「特價品能不能再用券」就是必答題
· 另有:free_shipping(Woo)、email_restrictions(Woo)、onlyForStaff / singleUse(Saleor)、
        limit_usage_to_x_items(Woo,「一張券最多折幾件」)
```

---

## §5 取捨表(**每格附「吃不下哪幾條」與「明顯的坑」**)

| 方案 | 吃得下的拍板 | 🔴 吃不下的 | 自建 vs 現成 | 明顯的坑 |
|---|---|---|---|---|
| **A 類完整後端**(Medusa / Saleor) | Q3 Q5 Q6(部分 Q4) | **Q1 Q2 Q7** —— 全是同步契約 | 現成 ~70%,而**要遷整個資料庫** | **與「原價只回報價單改」互斥**;兩套真相;既有 `orders` / 金流 / RLS 全部重來 |
| **B 類無頭後台**(Refine) | **全部不介入** ⇒ 八條都保留 | — | 現成 = **畫面與 CRUD 骨架**;業務規則 100% 自建 | 內建 Supabase data provider ⇒ 接得上;而**它不會幫我們想 Q1 的欄位鎖** |
| **B 類**(React-Admin) | 同上 | — | 同上;**RBAC / audit log 在企業版** | 我們要的「變更紀錄」若靠它 ⇒ **付費版**;而我們**已有** `admin_audit_log`,不必靠它 |
| **Directus** | 同上 | — | 現成度高,而它是**另一個後端** | Cloud $99/月起;自架多一套服務要顧 |
| **全部自建** | 全部 | — | 0% 現成 | 見下方基準線 |

### 🔴 **必寫的基準線:如果全部自建,體積大概是什麼量級**
```
可比對的既有實物(本 repo,可重跑 wc -l):
  admin 訂單面(已完成)  apps/admin/src/components/orders/ + lib/orders/  ⇒ **未量**(本輪沒數)
  一支中型後台 RPC       20260814100000 的 admin_record_item_receipt ⇒ **176 行**(:266-441 那支是 catalog 的;
                          本支見 :608 起)—— **單一寫入 RPC 的量級 ≈ 一百多行 SQL + 斷言**
🔴 **而我不替商品後台估總量** —— 那要先知道要做幾個面(商品列表 / 編輯 / 圖片 / 分類 / 特價 / 券 = 至少 6)。
⇒ **標「未量」。缺的那一道 = 先定範圍,才估得出量級。**
⚠️ 上面那句「至少 6 個面」是**我從 Sean 的話數的**,不是他列的清單。
```

---

## §5-b 🔴 價錢與【資料落地】—— **主視窗點名這是 Sean 拍板的關鍵欄**

> **為什麼「資料落地」與價錢一樣重要**:我們的資料在 **Supabase Singapore**。
> **一個要求資料進它自己雲的 SaaS,對 Sean 是「資料搬家」不是「換工具」。**

| 方案 | 授權費 | 自架成本 | 託管價 | 🔴 **資料落在哪** |
|---|---|---|---|---|
| **Refine** | **$0**(開源;RBAC / realtime / audit log **都在開源版**) | 只有我們自己的 Vercel | 無(它不是服務,是**函式庫**) | 🔴 **完全不搬** —— 它跑在**我們自己的 Next app 裡**,直接打我們的 Supabase |
| **React-Admin** | 免費版可用;**企業版 €300/月**(10 開發者) | 同上 | 無 | **不搬**(同上) |
| **Medusa v2** | **$0**(MIT,無 GMV 抽成) | 我們要多跑一個 Node 服務 + **它自己的 Postgres** | Medusa Cloud:Develop **$29/月**、Launch **$99/月**、Scale **$299/月**(另有用量加購) | ⚠️ 自架 = 資料在**我們自己的另一個 DB**(不是 Supabase);走 Cloud = **進它的雲** |
| **Saleor** | **$0**(開源,自架免費) | 多跑 Docker 服務 + 它自己的 DB | Saleor Cloud **$159 或 $300/月起**(兩個來源不一致,**未確認**);第三方託管 Elestio 自 **$16/月** | 同上 |
| **Directus** | **BSL 1.1**:年收入 < **$5M** 自架**免費**(含商用);三年後轉 GPLv3 | 多跑一個服務 | Cloud **$99/月起** | 同上 |
| **全部自建** | $0 | 只有工時 | — | **不搬** |

### 🔴 這張表回答的那一句
```
**只有 B 類(Refine / React-Admin)與「全部自建」是【零資料搬家 + 零授權費】的組合。**
理由不是它們比較便宜,是【它們根本不是服務】—— 它們是跑在我們自己 app 裡的函式庫。
⇒ 對 Sean 而言:B 類的成本 = **只有工時**;A 類的成本 = 工時 + 多一個服務 + **資料換家**。
```
📌 **而 Refine 對 React-Admin 有一格具體差異(對我們有用)**:
React-Admin 的 **RBAC / audit log 在企業版(€300/月)**,而 **Refine 開源版就有**。
⚠️ **而我們不需要靠任何一邊做變更紀錄** —— 我們**已有** `admin_audit_log`(見 §2 Q1)。

### ⚠️ 這一節的限定
```
· 全部是搜尋結果,**我沒有向任何一家詢價、沒有讀合約**
· 🔴 **Saleor Cloud 起價兩個來源不一致($159 / $300)** ⇒ **未確認**,要拍板前得自己去官網對
· 🔴 **Directus 的 $5M 門檻我沒有對 PCM 的實際年收入** —— 那是 Sean 的資訊,我不猜
· **Vendure 的價錢與授權完全沒查**(整個候選都沒查)
· 自架成本我**沒有估任何金額** —— 那要先知道跑在哪(Vercel / 另一台 VPS / Supabase Edge),
  而那是還沒決定的事 ⇒ **標未估,不填一個看起來完整的數字**
```

---

## §6 誠實揭示(**引用本檔必帶**)

```
· 全部是【讀官方文件 / 搜尋】+【讀本 repo】。**沒有裝任何東西、沒有搭起來試過一個方案**
· ⚠️ **Vendure 完全沒查**(候選清單裡列了它,而本輪一行文件都沒讀)⇒ 未確認
· ⚠️ **「A 類等於換掉資料庫」是推論** —— 我沒找到官方逐字說「不能接既有 Postgres 表」
  ⇒ 缺一道:實際搭一次,或找到那句明文
· ⚠️ **Medusa 的「每人使用次數」未確認** —— 本輪讀到的兩份文件都沒明列
· ⚠️ **價錢與資料落地我只查到 Directus Cloud $99/月** ——
  其餘方案的自架成本、以及**資料會不會離開 Supabase Singapore**,我一格都沒查
  🔴 主視窗明文交代過這一格 ⇒ **這是本檔已知的最大缺口**
· ⚠️ 特價「要不要排程」**Sean 沒講過** ⇒ 我標成待問,沒有替他選
· 🔴 本檔**不推薦任何方案**。§2 那張表是「**判掉 A 類**」的依據,而那是依據不是裁決
```

## §7 建議送 Sean 的問題(**不要一次全問,主視窗排**)
```
Q-商品-1  特價要不要有【起訖時間】?(主流:Shopify 原生沒有、要外掛;Woo/Saleor 有)
Q-商品-2  優惠券的「每人幾次」要做到【N 次】,還是【一次 / 不限】就夠?
          (四家裡只有 WooCommerce 給整數;其餘都是布林)
Q-商品-3  特價商品【能不能再用優惠券】?(Woo 有 exclude_sale_items 這個開關)
Q-商品-4  優惠券要不要限定【某些商品 / 某些分類】?(主流都有,而它會讓後台介面複雜一級)
```

---

## §8 來源
- Medusa Promotion 概念:https://docs.medusajs.com/resources/commerce-modules/promotion/concepts
- Medusa Promotion 模型欄位:https://docs.medusajs.com/resources/references/promotion/models/Promotion
- WooCommerce Coupon properties:https://woocommerce.github.io/woocommerce-rest-api-docs/#coupon-properties
- Saleor Vouchers:https://docs.saleor.io/developer/discounts/vouchers
- Shopify DiscountCodeBasic:https://shopify.dev/docs/api/admin-graphql/latest/objects/DiscountCodeBasic
- Shopify 設定特價:https://help.shopify.com/en/manual/products/details/product-pricing/sale-pricing
- Refine / React-Admin / Directus 比較:https://refine.dev/blog/react-admin-dashboard/ ／ https://www.gridphp.com/best-supabase-admin-panel-tools-in-2026/
- Refine 開源定位:https://refine.dev/core/ ／ https://github.com/refinedev/refine
- React-Admin 企業版價:https://reactadmin.gumroad.com/l/jSUpt
- Medusa 價格(Cloud 方案與自架):https://www.buildwithmatija.com/blog/medusajs-pricing-cloud-self-host-costs-2026 ／ https://deploymedusa.com/cloud-vs-self-host
- Saleor 開源與 Cloud 價:https://saleor.io/open-source ／ https://saleor.io/pricing ／ https://elest.io/open-source/saleor
- Directus 自架授權(BSL 1.1、$5M 門檻):https://directus.io/pricing/self-hosted ／ https://mobian.studio/directus-cms-license/
