# plan · ⟦search-CATALOGPAGE2MB⟧ —— 清單頁把 40,278 筆 fitments 送給瀏覽器,只為印四個字

> 立於 2026-09-06 · 線 `front` · **碼未動,本檔是 plan,等主視窗批**
> 板列 `docs/launch-todo.md:2200`(⟦search-CATALOGPAGE2MB⟧)· 相鄰列 `:2201`(⟦search-TAXONOMYPERREQ⟧)

---

## 1 · 問題(量到的,不是推的)

preview `dpl_6gju1Bf89qU2fp3mueKPWZVXJQuv`(= `origin/dev` `1ee5cf064`),同一個 cookie,`curl` 三發:

```
網址                                          bytes      motoBrand   modelCode   負對照(現造 zqxwvnope7)
/products?per=100                              693,655        239         238         0
  &vehicle=ducati:scrambler-800:2023         3,290,035     27,138      27,137         0
  &vehicle=ducati:scrambler-1100-club-italia 4,477,365     40,278      40,277         0
```

每筆 fitment 佔多少 bytes,兩個獨立車款各算一次:

```
scrambler-800   (3,290,035 − 693,655) / (27,138 − 239) = 96.5
club-italia     (4,477,365 − 693,655) / (40,278 − 239) = 94.5
```

⇒ **兩個獨立輸入落在同一個常數 ⇒ fitments 幾乎解釋掉全部的增量。**

正式站 log 逐字(板列上已有):
`Failed to set Next.js data cache … items over 2MB can not be cached (2679379 bytes)`,
鍵裡帶 `per=100&vehicle=ducati:scrambler-800:2023`。

⚠️ **兩個數不可以比大小**:log 量的是 **cache entry 序列化後** bytes,我量的是 **RSC 回應 body**。
**只能比方向** —— 而方向一致(club-italia > scrambler-800,兩把尺都是)。

## 2 · 為什麼只有「選了車」那條路爆

⛔ **不是投影不同。** 兩個分支都寫 `'fitments', pg.fitments`
(`supabase/migrations/20260904260000_m4b_recommend_sort_with_category.sql:359` 與 `:478`)。

✅ **是【回來的商品不同】**:選了車 ⇒ 命中的正是**有 fitments 資料**的那些商品;
預設 `recommend` 排序的前 100 名多半沒有 fitments(239 筆 / 100 件 ≈ 2.4)。

🛑 **這一格是【讀碼推的】,不是量的** —— 我沒有逐商品去數 fitments 筆數分布。**標未確認。**

## 3 · 而真正貴的不是它大,是清單頁用不到

```
apps/storefront/src/components/ProductCard.tsx:265
    {!compact && <div className="pcard-fits">適用 {formatCardFits(p.fitments, p.fits)}</div>}

apps/storefront/src/components/product-card-fits.ts:48   formatCardFits(...)
    · byModel.size > 1  ⇒  回 `${byModel.size} 款車型`      ← 一個數字
    · byModel.size === 1 ⇒ 回 單一車款名 + 年份區間
    · fitments 空/undefined ⇒ 回 fallback(= `p.fits`, DB 的字串欄)
```

🎯 **⇒ 40,278 筆進瀏覽器,產出是「N 款車型」四個字。**

消費端怎麼數的(可重跑):`git grep -n '\.fitments' -- apps/storefront/src packages/ui/src`,再自己濾掉 test 檔。
⇒ 清單頁那條路上**只有 `ProductCard`**;其餘命中在 PDP(`ProductFitments` / `ProductBreadcrumb` / `ProductPage`)
與購物車(`CartView` / `CartVehicleMixNotice` / `cart/actions.ts`)。
⚠️ **射程**:那一發只掃兩棵樹、只認 `.fitments` 這個字面 ⇒ **解構寫法(`const { fitments } = p`)撈不到**,我沒有另掃。

## 4 · 三個候選,而它們的風險差一個數量級

| 案 | 動什麼 | 省下的 | 鐵則 | 風險 |
|---|---|---|---|---|
| **甲** | migration:RPC 投影改成算好的摘要 | DB→server + cache + 瀏覽器 三段全省 | 8 + 12③ | 動正式庫函式;要 Sean 貼;錯了影響每一發 `/products` |
| **乙** | app 一支檔:`catalogRowToUIProduct` 把陣列收成字串 | cache + 瀏覽器 兩段 | 8(單檔,可不提) | 零 SQL、零部署順序問題、可單獨回滾 |
| 丙 | 甲 + 乙 | 全部 | 8 + 12③ | 兩件綁一顆 commit ⇒ 弱的那塊繼承強的背書 |

### ✅ 推薦 **乙 先做,甲另開一片**

理由三條:
1. **兩個實際痛點(cache 存不進去 · 瀏覽器收 4.5 MB)都在 app 那一側就解得掉** —— 甲多解的是 DB→server 那一段,而**那一段多貴我沒有量**。
2. 乙**零 migration、零 RPC**、不進 Sean 的貼板佇列 ⇒ 今天就能驗。
3. 甲的收益要等乙做完再量才知道值不值 —— 📌 **先做便宜的那個,再用它的讀數決定要不要做貴的。**

## 5 · 乙案的具體改法(一支檔,一行)

`apps/storefront/src/lib/catalog-page.ts` 的 `catalogRowToUIProduct`:

```
現在   fits: row.fits ?? '通用款',
       fitments: toCardFitments(row.fitments),

改成   fits: formatCardFits(toCardFitments(row.fitments), row.fits ?? '通用款'),
       fitments: undefined,
```

🟢 **為什麼畫面逐字不變**:`ProductCard` 那一行是 `formatCardFits(p.fitments, p.fits)`,
而 `formatCardFits(undefined, x)` 的第一句就是 `if (!fitments || fitments.length === 0) return fallback;`
⇒ **回傳 `p.fits`,而那正是我們預先算好的同一個字串。**
⇒ 🛑 **`ProductCard` 一個字都不用改** ⇒ 它其他呼叫端(走 domain 那條路、fitments 是真的)行為零改動。

⚠️ **要在實作時當場驗的兩件事**(現在是讀碼推的):
1. `CatalogCardProduct.fits` 的語意從「DB 原始字串」變成「顯示標籤」⇒ **這條路上還有沒有別人讀它原始值**。
   數法:`git grep -n 'CatalogCardProduct'`,逐個呼叫端開檔。
2. `formatCardFits` 住在 `components/` 而 `catalog-page.ts` 住在 `lib/` ⇒ **會不會產生反向相依**。
   不行的話把那支純函式搬進 `lib/`(它零 React、零 DOM)。

## 6 · 驗收 —— 兩個世界各量一發,同一把尺

**尺**:`curl` 同一支 preview、同一個 cookie,數 `bytes` 與 `motoBrand` 出現次數。

```
                                        改前(已量, §1)      改後(預期)
/products?per=100                          693,655              ≈ 670,000     motoBrand → 0
  &vehicle=ducati:scrambler-800:2023      3,290,035              < 800,000    motoBrand → 0
  &vehicle=ducati:scrambler-1100-club-italia 4,477,365           < 800,000    motoBrand → 0
```

🔴 **這把尺會不會飽和?** —— `motoBrand → 0` 是**單向**的,而「改對了」與「頁面整個壞掉」**都會印 0**
⇒ 🛑 **必須配一個【非 0】的正對照**:同一發 HTML 裡 `pp-count` 命中數 = 1、且卡片數 = 50(或 100)。
⇒ 再配**畫面那一格**:那三頁的 `適用 …` 字串,改前改後**逐字相同**(這才是「行為零改動」的證據,bytes 不是)。

**負對照**:現造字串(每次現編、不重用寫過的)⇒ 三發皆 0。

**測試層**:
· `apps/storefront/src/lib/catalog-page.test.ts` 補一格:多車款 ⇒ `fits === 'N 款車型'`;單車款 ⇒ 帶年份區間。
· **突變兩發**:①把 `formatCardFits` 那層拿掉(退回原樣)⇒ 新那格必須紅
　②`fitments: undefined` 改回 `toCardFitments(...)` ⇒ **bytes 那格量不到,測試也不會紅**
　⇒ 🛑 **這一格要老實寫進報告:測試守不到「有沒有真的變小」,只有 bytes 量測守得到。**

**三綠**:`TURBO_FORCE=1 pnpm typecheck / lint / build`(動 `.ts`)。
`vitest related` 連跑兩發,比四個數(`Test Files` / `Tests` / 紅的格數 / 我餵幾條 vs 它跑幾支)。

## 7 · rollback

· **乙案**:單檔單次 commit ⇒ `git revert <sha>` 即可,**零 DB 狀態、零快取遷移問題**。
　⚠️ 一個副作用要寫明:`unstable_cache` 的 Data Cache **跨部署保留**,而本案**不換鍵**
　(鍵仍是 `['catalog-page-v4']`,`apps/storefront/src/lib/products.ts` 那個 `unstable_cache` 的第二參數)
　⇒ 🔴 **舊條目裡仍帶著 `fitments`**,revalidate 到期(60s)前會混著兩種形狀。
　✅ 而**兩種形狀都能被 `ProductCard` 正確渲染**(舊的有 fitments ⇒ 走陣列;新的沒有 ⇒ 走 `fits` 字串)
　⇒ **不需要換鍵**;⚠️ 而這句是**讀碼推的**,實作時要拿舊形狀的 fixture 跑一格測試證明它。
· **甲案**(若日後做):`CREATE OR REPLACE` 回上一代 `20260904260000`;
　回滾腳本要照 `docs/patterns/revoking-function-execute-in-supabase.md` 的形狀寫。

## 8 · 鐵則標記

| 鐵則 | 乙案 | 甲案 |
|---|---|---|
| 8(重大改動先提 plan) | ⚠️ 單檔、不動 schema/API/共用元件 ⇒ **嚴格說不觸發**;本檔仍先提,因為它改的是**每一發清單頁的資料形狀** | 🔴 觸發 |
| 12(高風險必過 codex) | ⚠️ **不在六類裡**(不動錢/權限/schema/平台設定/對外送出/`packages/ui`)⇒ 走 `code-reviewer` 即可 | 🔴 觸發 ③(DB 結構) |
| 11(三綠) | 🔴 動 `.ts` ⇒ typecheck + lint + **build** | 同 |
| 9(內容分級) | L1(不是內容,是資料形狀) | 同 |

## 9 · 這份 plan 答不出什麼

· **線上有多少比例的請求帶 `?vehicle=`** —— 板列原本就列著這一格,**我沒有關掉它**。
　⇒ 乙案的實際收益(省下多少次必敗寫入)**未量**。
· **非 vehicle 的那些 cache key 實際多大** —— 只知道「沒超過 2 MB」。
· **DB→server 那一段的成本** —— 甲案唯一多解的那一段,**未量** ⇒ 所以現在不做甲。
· **每商品 fitments 筆數的分布** —— §2 那個「因為回來的商品不同」是讀碼推的,**未量**。
