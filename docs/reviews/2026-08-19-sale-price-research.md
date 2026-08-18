# 調研 — 特價(sale price):**它是券的隔壁,而它卡在一個沒拍的板上**

> Sean 睡前逐字把兩件講在同一句:「參考所有購物網站商品怎樣管理、**特價怎樣管理**、優惠券號碼設計」
> ⇒ 我們只查了後者。本片補前者。**純調研,零 code。**
> ⚠️ 另一個窗在做「員工改一件商品要做完哪些事」的全欄位清單 —— **本片只查特價這條線。**

---

## 0. 🔴🔴 一句話結論:**特價的畫面早就做好了,而它卡在一個【沒有人拍過的板】上**

```
UI       ✅ 已實作(劃線原價 + 特價)—— apps/storefront/src/components/Price.tsx
資料層   🔴 零(products 表沒有任何特價欄位)
而中間那一格 = **Q-B1:價格的權威歸屬** —— 已被列為【硬前置】,而**還沒拍板**
```

---

## 1. 特價與優惠券:**是不是同一件事的兩種形狀?**(第 1 格)

```
券   = 客人打一組碼 ⇒ 折抵發生在【結帳當下】
特價 = 商品自己就便宜 ⇒ 折抵發生在【看到價格的那一刻】
```
🔴 **而它們最後落點不同,這一格很重要**:
```
券   ⇒ 落在訂單的 discountTotal(errors.ts:20「total ≠ subtotal + shippingFee − discountTotal」)
特價 ⇒ **不落在 discountTotal** —— 它直接改變 subtotal 裡那一行的單價
```
⇒ **所以它們不是同一件事的兩種形狀,是【兩個不同層】**:
```
特價 改的是「這件商品多少錢」    ⇒ 商品層
券   改的是「這一單折多少」      ⇒ 訂單層
⇒ 兩者可以同時存在而不打架,**而「特價品能不能再用券」是個【產品決定】**
  (Woo 把它做成一個開關叫 "Exclude sale items" ⇒ 別人認為這題一定要問)
```

---

## 2. design 有沒有特價 ⇒ ✅ **有,而且我們已經照著做了**(第 2 格)

**`apps/storefront/src/components/Price.tsx:40-45` 逐字**:
```
三條件 AND:
 (1) !isMember — 訪客 / 一般會員、無 dealer 價
 (2) originalPrice !== null — 商品有原價(非 null fallback)
 (3) originalPrice > price — 真有折扣、非 originalPrice <= price 異常狀態
```
同檔 `:58` 註解逐字:「**retail discount(general + sale):劃線 origPrice + sale 價**」
⇒ **劃掉的原價 + 特價,已經實作完成**,而且連「原價比特價低」這種異常都擋了。

### 2-1 🔴 而它現在吃的是 **mock 資料**
```
ProductCard.tsx:194  originalPrice={p.originalPrice ?? null}
而唯一有 origPrice / isSale 的地方:apps/storefront/src/data/mock-products.ts:132,234-235
  例:{ …, price: 5800, origPrice: 7200, isSale: true, … }
🔴 domain / adapters 兩層:git grep -n "origPrice" ⇒ **零命中**
```
⇒ **又是「機器在、沒接線」** —— 與優惠券同一個形狀,而**這次連 UI 都寫完了**。

---

## 3. 資料層:商品價格今天長什麼樣(第 3 格)

```
products 表兩個整數欄(20260516064013_products_add_price_general_store.sql:10-11):
  ALTER TABLE products ADD COLUMN price_general integer;   ← 一般價
  ALTER TABLE products ADD COLUMN price_store   integer;   ← 經銷價
(高級經銷 premiumStore 暫 = store,見 m3-checkout-plan §3.2「premiumStore 再折(暫=store)」)
```
🔴 **特價欄位:零。** 量法與負向對照:
```
sale_price / compare_at / original_price / msrp / list_price
  ⇒ 五個字面在 migrations + packages + apps **全部 0 命中**
負向對照:price_general 同範圍 ⇒ 命中多檔(admin repository / catalog-query / storefront)⇒ 尺會動
```
⇒ **「特價」是【多一個欄位】還是【多一張表】** ——
而那個答案**不是技術決定,是第 4 格那個板**。

---

## 4. 🔴🔴 最重要的一格:**價格是同步進來的,而覆寫問題已經有編號了**(第 4 格)

### 4-1 價格確實是同步寫進來的
```
.github/workflows/rpm-sync.yml + scripts/rpm-import.ts
rpm-import.ts:25 逐字:「rpm-transform price_retail→price_general〔零售〕/ price_store 欄 NULL」
⇒ **每一輪同步都會寫 price_general。**
```

### 4-2 ⇒ 所以「員工手改的特價會不會被蓋掉」= **會**,除非有覆寫層
🔴 **而這件事【已經被發現、已經有編號、而且 code 已經先鋪好路】**:

`apps/admin/src/lib/products/product-repository.ts:64-65` 逐字:
> 「為什麼要有這支:**`Q-B1` 若拍 B 案(後台覆寫層),售價要改讀 `price_override ?? price_general`**。
>  把取值集中在這裡 ⇒ **B 案只改這一個函式**;頁面與表格直讀 `row.price_general` 的話,〔會散〕」

⇒ **有人已經想到了,並且把取值集中成一支函式,好讓那個板拍下去時只改一處。**

### 4-3 🔴 而那個板 **【半解】不是全未拍** —— 射程要收窄(2026-08-19 主視窗更正)
```
上下架  ✅ **Sean 2026-08-15 已拍板【員工贏】,而且已實作上線**
        scripts/rpm-transform.ts:200-206 逐字「delisted_at 已從本型別移除,同步管線不再輸出這個 key…
        🔴 不要把這一欄加回來 —— 加回來等於把下架權威還給來源」
        他的業務理由逐字:「如果原廠停產,但是我有現貨庫存,那我需要維持上架狀態」
價格    🔴 **沒拍過**,同步今天仍每輪覆寫
```
⇒ **本片的結論仍然成立**(特價卡在【價格】那半),而**不要說「Q-B1 整個沒拍」。**

🔴 **而我引錯了一句,原因值得記**:
```
我引 products-admin-line-recon.md:54「沒拍板下面全部不能開」當現況 ——
而那份寫於 **2026-08-14**,**比上下架拍板早一天**。
📌 **一份寫著「等 X」的檔,不會在 X 到了的時候自己變色。**
⇒ 引用「還沒 / 等待中」這類句子前,要問:**這句話是哪一天寫的?那天之後發生過什麼?**
```

### 4-3b 而它被列為硬前置的那段(留痕,而讀時要帶上面的收窄)
```
docs/specs/2026-08-14-products-admin-line-recon.md:54 逐字:
  「Q-B1 拍板(價格/上下架權威歸屬)     ← 硬前置,沒拍板下面全部不能開」
同檔 :43 逐字:「**#22 不是「補畫面」,#20 也不是「開個 route」。先拍板 Q-B1 才有片可切。**」
同檔 :47 逐字:圖片也來自來源 view ⇒ 「**同步商品的圖片同樣每輪被覆寫,與 Q-B1 是同一題**」
另有一份查證報告:docs/specs/2026-08-14-field-lock-verification.md(「逐欄鎖查證報告 · Q-B1 追問」)
```

---

## 5. ⇒ 給 Sean 的一句話(而這是本片的用途)

```
特價這件事,畫面早就做好了(劃線原價 + 特價,連異常都擋了)。
缺的不是畫面,是【一個決定】:

  **商品的價格,誰說了算 —— 同步進來的那個,還是你在後台改的那個?**

· 選「同步說了算」⇒ 特價要改在來源(報價單那邊),後台只能看
· 選「後台說了算」⇒ 要多一層覆寫欄位,而同步不能碰它
🔴 而這個決定【不只影響特價】—— 圖片、上下架也是同一題(recon:47)
⇒ 那就是 Q-B1,而它已經被標成「沒拍板下面全部不能開」。
```
📌 **所以特價這條線不是「要不要做」的問題,是「Q-B1 那個板」的下游。**
⇒ 而優惠券**不受它影響**(券是訂單層,不碰商品價格)⇒ **兩件可以分開走。**

---

## 6. 我沒有查的(不要當已驗)
```
· Q-B1 有沒有在別的地方被拍過(我只掃 docs/,沒掃信箱與 memory)
· field-lock-verification.md 那份查證報告的內容(只讀了標題)
· 特價要不要有【期間】(限時特價)—— 那會讓它從「一個欄位」變成「一張表」
· 特價與會員價的關係:經銷價已經比較便宜,特價是不是對經銷商也生效?**沒人決定過**
· 🔴 那 20,341 件商品裡,**現在有幾件的來源本來就有特價** —— 我沒有查來源資料的形狀
```
