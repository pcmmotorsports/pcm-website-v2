# plan · 另外兩扇門也要講話(分類 / 品牌)—— ⟦search-SILENTDOORS2⟧

> 立於 2026-09-06 · 線 `front` · **碼未動,等批**
> 板列 `docs/launch-todo.md:2203` · **形狀直接套 `e9a811d25`**(車款那一扇),不重新設計。
> 文案照主視窗裁的「同句延伸」——⚠️ **那是主視窗的延伸,不是 Sean 的逐字**(他那一板只點名車款)。

---

## 1 · 分母(照那一列自己寫的數法,當場重跑)

```
數法 git grep -n <名字> -- apps/ | 濾掉 .test. 與註解行與 lib/products.ts 自己
負對照 現造 fetchZqNopeTaxonomy2 ⇒ 0

fetchCatalogBrandTaxonomy
  app/api/catalog/facet-counts/route.ts:29,108     ← API,不是頁面
  app/products/page.tsx:23,103                     ← 型錄側欄「品牌」

fetchCategories
  app/api/catalog/facet-counts/route.ts:29,108     ← 同上
  app/page.tsx:28,119                              ← 首頁分類區
  app/products/page.tsx:24,102                     ← 型錄側欄「分類」
```
🎯 **⇒ 要接的【頁面】面只有三個**:首頁分類 · 型錄側欄分類 · 型錄側欄品牌。
　 `facet-counts` 是 API(回 JSON,沒有畫面)⇒ **本片不碰**,它自己那條路怎麼處理是另一題。

## 2 · 做法(逐字照 `e9a811d25`,不發明)

```
route  fetchCategories() / fetchCatalogBrandTaxonomy()  ⇒  tryCategories() / tryCatalogBrandTaxonomy()
       解構出 failed,下游既有讀取點【一個字都不用改】(那一片已驗過這個做法)
元件   多一個選填 prop(預設 false)⇒ 舊呼叫端零改動,typecheck 就是那把尺
訊息   共用 products-message-state.tsx 的同一顆元件, 只換受詞常數
測試   每個面兩格【成對】:failed=true 要說話 / 空而沒失敗要沉默
       + route 接線兩格(true / false 都要驗, 走元素樹不渲染)
```

## 3 · 🔴 一個 Sean 那一板【沒有涵蓋】的問題 —— 我不自己決定

**型錄側欄同時有【分類】與【品牌】兩區,而車款那一句已經在那一頁上了。**
⇒ 三個都掛掉時,客人會在同一頁看到**三行幾乎一樣的話**。

```
Q-三行會不會太吵: 型錄那一頁若三個清單同時讀不到, 客人會看到三行
  「◯◯清單暫時無法載入,請稍後再試…」。要不要合成一句?
  甲 = 各講各的(三行)—— 客人知道是哪一區壞了
  乙 = 合成一句「部分篩選條件暫時無法載入…」—— 畫面乾淨而資訊變少
A: 甲 | 乙
```
🔵 **我推甲** —— 它與已經上線的那一句一致,而**乙要新編一句文案**(那才是要 Sean 拍的東西)。
🛑 **而三個同時掛掉的機率我沒有量** —— 它們共用同一個 Supabase,**很可能是一起壞的**,
　 所以這不是一個理論問題。⚠️ **未量。**

## 4 · 鐵則
| 鐵則 | 判定 |
|---|---|
| 8 | 🔴 觸發(2 支 route + 2 支元件 + 常數)⇒ **本檔就是那個 plan** |
| 12 | ⚠️ 六類一類都不在(元件都在 `apps/storefront/src/components`, 不是 `packages/ui`)⇒ `code-reviewer` |
| 11 | 動 `.tsx` ⇒ typecheck + lint + **build** |
| 1 | §2 的答案沿用 `e9a811d25`:OD 那半有 `pp-error` 那個形狀, 用站內既有 `MESSAGE_STATE_STYLE` + `role="alert"` |

## 5 · 這份 plan 答不出什麼
· **那兩扇門今天多常真的 `failed`** —— 車款那扇有 `57014` 可數,**這兩扇我沒查有沒有對應的錯誤行**。
· **`facet-counts` 那條 API 路**:本片不碰,而它也是同一個形狀 ⇒ 要不要一起,主視窗判。
· **三行同時出現的畫面沒看過** —— §3 那題若裁甲,實作完要在真瀏覽器造三個都 failed 的世界看一眼。
