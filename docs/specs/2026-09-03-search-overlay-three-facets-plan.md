# 搜尋疊層另三區(品牌 / 分類 / 車款)· slice plan · 線 `-front` · 2026-09-03

> **狀態:等主視窗-87 批(鐵則 8)。批准前不動碼。**
> **這份 plan 在什麼情況下會【變成假的】**:
> ① 有人改了 `/api/search` 的回傳形狀 ⇒ §2 那張欄位表過期;
> ② `-mail` 的 pg_trgm 索引落地 ⇒ §5 那個「R6 撈到 CBR600」的實測值會變;
> ③ 有人先動了 `lib/search-shape.ts` ⇒ §3 的檔案清單要重數。
> ⇒ 三個都不是時間到期,是**別人動了東西**,而**沒有機制會叫**。

---

## §0 為什麼提 plan 而不是直接做(鐵則 8)

主視窗-87 交辦時說「標準片,除非跨 3+ 檔」。**實查:跨 4-5 檔,而其中一支是共用契約。**

```
lib/search-shape.ts          ← 🔴 共用契約, 現有 4 個消費端
  (search/page.tsx · api/search/route.ts · SearchOverlay.tsx · lib/search.ts)
components/SearchOverlay.tsx ← 擴 state + 解析回應
components/SearchOverlayFacets.tsx ← 🆕 新元件(鐵則 6 逼出來的, 見 §4)
components/SearchOverlay.test.tsx  ← 測試
(可能) SearchOverlayFacets.test.tsx
```
⇒ 命中鐵則 8「跨 3+ 檔」⇒ 停下提 plan。

---

## §1 鐵則 1:稿是真權威,而它把我最可能自己發明的那一格講死了

`bash scripts/design-ref-check.sh` ⇒ 本樹 submodule 已初始化、**176 個檔**(正對照 README.md 在)。
真權威 = `design-reference/components/SearchOverlay.jsx`,逐字:

| 稿說的 | 落點 |
|---|---|
| 區塊順序 = **商品 → 品牌 → 分類 → 車款** | `:125` `:148` `:162` `:176` |
| 標題字面 = `商品 · {N}` / `品牌` / `分類` / `車款`(**只有商品帶數字**) | `:126` `:149` `:163` `:177` |
| 🔴 **空區【不畫】** = `{results.brands.length > 0 && (…)}` | `:147` `:161` `:175` |
| 每區上限 = 品牌 6 / 分類 6 / 車款 6(商品 8) | `:40` `:44` `:58` |
| 版面 = `search-overlay-section` > `search-overlay-h` + `search-overlay-tagrow` > `search-overlay-tag` | `:148-157` |
| 車款顯示字面 = `{v.brandName} {v.modelName}` | `:185` |

🟢 **「空區要不要出現」我沒有自己發明** —— 主視窗特別點名這一格,而**稿明確寫了 `length > 0 &&`**。
🟢 **CSS 四個 class 全部已存在**(`search-overlay.css` 各 grep ⇒ 2 / 2 / 1 / 3;負對照現造 class ⇒ 0)
⇒ **零新增 CSS。**(第一刀搬 CSS 時整支搬過,連還沒用的區塊樣式一起。)

---

## §2 資料那半【已經做完了】,只差畫

`/api/search` 實測回應鍵 = `items,total,brands,categories,vehicles,failed`,欄位形狀:
```
brands     { id, name, count }          例 { akrapovic, AKRAPOVIČ, 648 }
categories { id, name, count }          例 { <uuid>, 排氣系統, 740 }
vehicles   { brandId, brandName, modelId, modelName }   例 { honda, Honda, cbr600, CBR600 }
failed     { brands: bool, categories: bool, vehicles: bool }
```
🟢 **`vehicles` 的形狀與稿【逐欄相同】**(稿 `:50` 也是 brandId/brandName/modelId/modelName)。

---

## §3 一個【與稿不同】的地方,而它是我們自己的 URL 決定的(要記 override)

稿的分類導頁用 `c.id`(`:167` `onNav('products', { category: c.id })`)。
**而我們的 `?category=` 吃的是【名稱】不是 id** —— 實測落點
`lib/brand-products.test.ts:20-22` 逐字 `/products?pbrand=akrapovic&category=輪框與傳動`。
⇒ **本片用 `c.name`**,而這是**授權偏離、要進 manifest override**,不是自創。

三區的導頁目標(全部走既有參數,不新增):
```
品牌 → /products?pbrand=<brand.id>
分類 → /products?category=<category.name>
車款 → /products?vehicle=<brandId>:<modelId>
```

---

## §4 鐵則 6:這一片幾乎確定過線 ⇒ 拆,而拆點是我自己寫在檔頭的那個

`SearchOverlay.tsx` 現行 **396 行 / 400 硬線**。三區約 +50 行 ⇒ **必過線。**
✅ 照該檔檔頭那段(2026-09-03 我寫的):**拆點是 render 那幾支結果區塊** ⇒ 抽 `SearchOverlayFacets.tsx`。
🛑 **註解跟著它解釋的那段碼搬** —— 鐵則 6 逐字「不得以壓縮/刪減註解作為降行手段」。
🟢 而 `SearchOverlay.test.tsx` 的 **G1-f**(釘住 render 的 kind 集合)會在拆的時候盯著:
   若抽走之後主檔的 kind 集合變了,它會紅 ⇒ **那一格就是為這一刻寫的。**

---

## §5 `failed` 三旗標要接上 —— 否則前置白做

主視窗指定。而**畫面上要分得開**:
```
failed.brands = true  ⇒ 品牌區畫「這次讀不到」(而不是不畫 —— 不畫 = 告訴客人「沒有這個品牌」)
failed.brands = false + 0 筆 ⇒ 不畫那一區(照稿)
```
🔴 **而文案我不發明**:既有那兩句是「搜尋暫時無法使用」與「沒有找到「X」相關結果」。
⇒ 提案沿用**同一種語氣**的短句,**字面留給 Sean**(鐵則 R6)。**這一格我會在收尾一起端他。**

---

## §6 驗收(每條 yes/no)

```
① 四區順序與稿相同(商品→品牌→分類→車款), 標題字面逐字相同
② 空區不畫;而 failed=true 時【要畫】且與「沒有符合」不同字
③ 每區上限 6(商品 8)
④ 導頁三個參數正確:pbrand / category(名稱) / vehicle(brandId:modelId)
⑤ 🧬 突變:把 vehicles 那一段拿掉 ⇒ 指定那一格必須紅
⑥ 🧬 突變:把 failed 判斷拿掉 ⇒ 指定那一格必須紅
⑦ G1-f 仍然綠(或依拆檔結果更新, 而更新要在 commit body 說明)
⑧ 三綠 TURBO_FORCE=1(動 .tsx ⇒ 加 build)+ code-reviewer 一輪
```

---

## §7 🔴 順手量到、**不在本片範圍**、而它會讓這一片看起來像壞的

**打 `R6` ⇒ `vehicles` 回的是 `Honda CBR600` / `CBR600F` / `CBR600FS`。**
成因:ILIKE 子字串比對 —— **`cbr600` 裡面含 `r6`**。
⇒ 🎯 **這一片做完之後,客人打 R6 會【看到】一區車款寫著 Honda CBR600** ——
  而那在他眼裡是「搜尋壞了」,**而它其實是 `⟦搜尋-準確度⟧` 那一列(已轉 `-mail` 的 pg_trgm 線)。**
🛑 **⇒ 這是一個「把既有的爛結果變得看得見」的片。**
⇒ 🔵 **要不要等索引落地再做這一片,是一個決策題,不是我能拍的。**
  · **甲 現在做** ⇒ 車款區今天就會出現,而它今天會顯示可疑的比對結果
  · **乙 等 `-mail` 索引落地再做** ⇒ 晚一點,而第一次上線就是好的
📌 **我沒有偏好,而我把它端出來的理由是:這一格在做完之後才會被發現,那時已經上線了。**
