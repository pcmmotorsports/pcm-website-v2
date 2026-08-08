# 列表投影帶「有無變體」· 資料面小 plan(**已核准並施工完畢**)

> 起因=加購鈕片的 Critical(幽靈品項);Sean 2026-08-08 中午拍板 **A**:
> 「有規格的商品點加購 → 跳商品頁讓客人選規格;沒規格的 → 直接加入」(`D-229-A` ①)。
> 本檔只處理**資料面**,卡片端行為改動併在加購鈕片同一 commit 收。
> 核准=`D-230-A`(兩裁:鈕文字「選擇規格」/ `variantCount` 必填;部署面風險由主視窗對正式站實測拆除)。
> ⚠️ 施工後 R2 又抓到三條 must-fix,**§6a 是其中最重的一條**,讀本檔務必連它一起看。

## §1 片型

| 項 | 判定 |
|---|---|
| 片型 | **標準片**,但動 `packages/adapters` + `packages/domain` ⇒ 從嚴 |
| 內容分級 | L1 |
| 鐵則 8 | ✅ **命中**(跨 3+ 檔、動共用 adapter 的讀投影)⇒ 本檔即 plan,等核 |
| 鐵則 12 | ❌ 未命中。⚠️ **但貼著紅線**:embed 仍走 `product_variants_public` view(物理排除 `price_store`/`metadata`,`SupabaseProductAdapter.ts:86-88` 逐字),**不得改抓別的來源**;本片零 migration、零 RPC、不碰價。 |

## §2 🔴 關鍵省力點:A 案不需要 variant id,只需要「有沒有」

Sean 拍的是「有規格 → 導頁」,不是「加第一個規格」⇒ **卡片端根本用不到 `variantId`**。
所以不必把變體資料搬到列表,只要一個**數量**。這讓本片比 `D-229-A` ② 提的「embed 兩欄」更輕、
而且**零行為回歸**(見 §4)。

## §3 現況實查(全部主對話親自開檔)

| # | 事實 | 位置 |
|---|---|---|
| A | list 讀路徑**刻意不 embed 變體**,理由逐字「避 N+1 jsonb 膨脹」 | `SupabaseProductAdapter.ts:83-84`(行號為**本片編輯後**的值;規劃當下是 :73-74)|
| B | 全部 list 讀路徑共用**同一個常數** `PRODUCT_SELECT_DETAIL_VIEW`(8 處:`:156,:191,:231,:244,:265,:289,:340,:371`)⇒ **改常數一處、全 list 路徑同時生效** | 同左 |
| C | detail 路徑(`findById`/`findByHandle`,`:116,:135`)用 `..._WITH_VARIANTS`、embed 完整 7 欄 | `:80` |
| D | mapper 逐字「list 路徑無 embed key → undefined → []」 | `mappers/product.ts:247`(編輯後值;規劃當下 :231-236)|
| E | `SupabaseVariantRow` 需要 7 欄;缺欄餵給 `mapVariantRow` 會做出 `sku` 為空的垃圾變體(而 `sku` 會一路進購物車行) | `mappers/product.ts:129`(編輯後值;規劃當下 :125-135)|
| F | domain `Product.variants: ProductVariant[]`(必填、無變體為 `[]`) | `packages/domain/src/catalog/types.ts:286` |
| G | `toUIProduct` 把 domain variants 映到 `MockProduct.variants` | `apps/storefront/src/lib/products.ts:201` |
| H | 卡片三個直接呼叫點**全部都傳 `href`**(指向商品頁)⇒ 「導頁」不必寫 `router.push`,**不 `preventDefault` 讓外層 `<Link>` 自己導**即可 | `ProductsPage.tsx:399`、`ProductRelated.tsx:105`、`ProductRail.tsx:242-247` |

## §4 要改什麼

### 4-1 資料面(4 檔)

1. **`SupabaseProductAdapter.ts`**:`PRODUCT_SELECT_DETAIL_VIEW` 尾端加 embed `product_variants_public(id)`
   —— **只一欄**。8 處 list 讀路徑吃同一常數、自動生效。
2. **`packages/domain/src/catalog/types.ts`**:`Product` 加 `variantCount: number`(**必填**,不用 optional
   —— optional 會讓「沒帶到」與「真的沒有」再次分不出來,那正是本次 Critical 的病根)。
3. **`mappers/product.ts`**:
   - `variantCount: (row.product_variants_public ?? []).length`(兩條路徑都算得出來)
   - `variants:` **維持現行邏輯,但只吃完整形狀**:精簡 row(只有 `id`)⇒ 不進 `variants`。
     判別=`'sku' in v`(我們自己的投影決定的欄位,可控);精簡形狀 ⇒ `variants: []`。
   - 🔴 **這是本片零回歸的關鍵**:list 路徑的 `variants` **還是 `[]`**(與今天逐字相同),
     所有既有消費者(含 `cart/actions.ts` 的 fail-closed)行為一字不變;新增的只有 `variantCount`。
4. **`apps/storefront/src/lib/products.ts`**:`toUIProduct` 帶 `variantCount` 進 `MockProduct`
   (`MockProduct` 同步加欄)。

### 4-2 卡片端(併加購鈕片同一 commit)

`ProductCard.quickAdd`:
- ~~`p.variantCount > 0`~~ → 落地為 **`p.variantCount !== 0`**(R2 must-fix:`undefined`=**不知道**、
  歸安全側當有規格;理由見 §6a)⇒ **不 `preventDefault`**、直接 return ⇒ 外層 `<Link>` 導商品頁(§3-H)。
- `p.variantCount === 0`(**明確是 0**)⇒ 照 Q2=A 直加 + 1.5 秒「✓ 已加入」(既有邏輯不動)。
- ⚠️ **無 `href`** 的分支:型別上 `href` 是 optional,但三個呼叫點全傳(§3-H)⇒ 實際不可達。
  fail-safe = 沒 href 就走既有 `onClick`(不直加、也不假裝加成功),**不做「猜一個變體加下去」**。

## §5 ⚠️ 需要主視窗裁的兩件

1. **鈕的文字**:有規格時鈕還寫「+ 加入購物車」但實際是導頁 ⇒ 字面 vs 行為不符。
   建議改成 **「選擇規格」**(有規格時)/「+ 加入購物車」(無規格時)。文案調性我不自己拍。
2. **`variantCount` 必填 ⇒ 所有 `Product` 建構點都要補**(mapper、test factory、in-memory adapter…)。
   我會 `grep` 全樹補齊;若某個建構點補不出真值(例如純測試假資料)⇒ 填 `0` 並在該處註明,
   **不用 optional 逃避**(理由見 §4-1 第 2 點)。這條若你認為代價太大,替代案=`variantCount?: number`
   + 卡片端 `?? 0`,但那等於承認「分不出來就當沒有」,**我不推薦**。

## §6 驗收(每條配只紅自己的突變)

1. list 路徑的 `variants` **仍為 `[]`**(零回歸;突變:讓精簡 row 也進 `variants` ⇒ 只紅這條)
2. list 路徑的 `variantCount` = 該商品真實變體數(突變:寫死 0 ⇒ 只紅這條)
3. detail 路徑的 `variants` 仍是完整 7 欄變體(既有行為;突變:改吃精簡判別 ⇒ 只紅這條)
4. detail 路徑的 `variantCount` 與 `variants.length` 一致(兩條路徑同一真相)
5. 卡片 `variantCount !== 0`(含 `undefined`)⇒ 點加購**不加入購物車**、且 `defaultPrevented === false`
6. 卡片 `variantCount === 0` ⇒ 照舊直加(§4-2;突變:把判定改回 `(p.variantCount ?? 0) > 0` ⇒ 只紅缺欄那條)
7. 🔴 **幽靈品項回歸格**:模擬「有變體商品從卡片加購」⇒ 現在不會產生任何 cart item
   (這條是本片存在的理由,直接釘住 Critical 不復發)

⚠️ **測不到、要誠實申報**:embed 語法本身(`product_variants_public(id)`)**在本 worktree 無法實測**
(無 `.env.local`、無 DB)。同檔 `:62-64` 已有前例警告:PostgREST 對不存在欄回 **42703 整條 throw**、
非優雅降級。⇒ **這是部署面風險**,不是單元測試蓋得住的。
建議:主視窗或 Sean 在有 DB 的環境跑一次 `products_public` 的 embed smoke(一條 select 即可),
過了再 merge;或至少在 preview 部署後**第一件事**就是打開 `/products` 確認不是整頁 500。

## §6a 🔴 R2 追加:本 plan 漏了 `/products` 與品牌頁那條資料路

§3 的現況表只盤了 `SupabaseProductAdapter` 的 list 讀路徑,**漏掉 RPC 那條**:
`/products` 商品目錄與品牌頁走 `search_catalog_by_vehicle` → `lib/catalog-page.ts:54` 的
`catalogRowToUIProduct`(**不經 `toUIProduct`**),那支 mapper 沒有 `variantCount` 欄。
⇒ 本 plan 的 §4-1 四檔改動**照顧不到那兩面**。

**本片的處置(已落地)**:卡片端把「未知」歸到**安全側**——`variantCount !== 0` 才算有規格
(`undefined` ⇒ 當作有規格、導商品頁)。兩種猜錯的代價不對稱:猜「有規格」最差多跳一次商品頁;
猜「沒規格」會做出刪不掉的幽靈行。⇒ 那兩面**不會製造幽靈品項**,但卡片直加暫時失效(全部導頁)。

**待辦(另開片、需 Sean 拍板)**:讓 RPC 回傳變體數 ⇒ 動 DB 函式 = migration = **鐵則 12③ + 鐵則 8**,
不在本片範圍。做完那片,`/products` 與品牌頁才會恢復卡片直加。

## §7 Rollback

`git revert` 即完整回退(零 migration、零 schema、零 env)。
若只想拆掉 embed(效能疑慮),把 `PRODUCT_SELECT_DETAIL_VIEW` 那段 embed 拿掉即可 ——
那會讓 `variantCount` 在**所有**路徑變成 `undefined` ⇒ 依安全側規則,**全站卡片的快速加購都變成導頁**
(不會製造幽靈品項,但那顆鈕等於全面失效)。~~卡片又會開始製造幽靈品項~~ 是 R2 修安全側方向**之前**的
後果,已不成立;劃線保留原文。

## §8 一併收的三筆自過 + R1 兩 nit(併本片 commit)

- manifest 突變數 **12 → 11**(我目測數錯,已重數實跑輸出逐條點過)
- `ProductCard.tsx` **345 行**(落筆時量得,非規劃時估的 330)跨 >300 警戒 ⇒ 不拆理由寫進 manifest
  與 backlog #341 同族第二筆:`quickAdd`/`hasVariants` 與唯一消費者同檔內聚,且會把當天出過 Critical
  的「導頁 vs 直加」判斷推到另一個檔
- 手機底欄徽章進 `MobileTabBar.business_overrides`(design 稿無此元素)
- `vi.mock('next/navigation')` 被 hoist 到整檔生效 ⇒ 註解擺位改到檔頭、講清楚作用範圍
- `design-reference` submodule 在本 worktree **是空目錄** ⇒ 鐵則 1 的「grep design 字面」物理上做不到,
  照實記進 override 條目、不假裝有做

— site-redesign 窗,2026-08-08
