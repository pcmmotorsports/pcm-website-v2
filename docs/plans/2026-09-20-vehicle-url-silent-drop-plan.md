# 選錯車靜默給全站商品 —— plan(鐵則 8,等 Sean 批)

> 板列 `⟦front-VEHFACETSILENTDROP⟧`(`docs/launch-todo.md`)。
> 線 `-17` 2026-09-20 寫。**本檔不動任何碼。** 批了才有下一步。

---

## 0. 先講三件會改變這份 plan 形狀的事(都是查出來的,不是設計的)

### 🔴 ① 呼叫端是 **6 個**,不是 11 或 12 —— 我自己先前那個數字是錯的

```
🔬 grep -rn 'parseVehicleFromUrl(' apps/storefront/src --include='*.ts' --include='*.tsx'
   排除 .test. / 定義檔本身 / 剝掉 `//` 之後仍有呼叫的行:
   app/products/[slug]/page.tsx:269
   app/products/(catalog)/page.tsx:320
   app/api/catalog/facet-counts/route.ts:94
   components/use-vehicle-url-sync.tsx:50
   components/use-deep-link-restore.tsx:74
   components/ProductPage.tsx:100
   ⇒ **6 個**
```

⛔ 我 2026-09-20 稍早報過「呼叫端 12,帶補救 1,其餘 11 沒有」——
🔴 **那是 `grep -rln` 數的【提到它的檔案數】,不是【呼叫次數】。**
其餘那幾支是**註解裡提到**(`ProductsPage.tsx:350` · `VehicleFinder.tsx:110` · `ProductFitmentCheck.tsx:26` · `lib/vehicle-taxonomy.ts:102`)或**純 re-export**(`products-url-state.tsx:36`)。
📌 **⇒ 同一族的分母錯:我數的是「檔」,而結論講的是「呼叫端」。**

### 🔴 ② 這件事 **Sean 2026-08-08 已經拍過板**,而修法會推翻它

`components/use-deep-link-restore.tsx:76-77` 逐字:

```
🔴 `?vehicle=garbage` 與「沒有 vehicle 參數」在 parseVehicleFromUrl 回同一個 null(簽章上分不出),
   ⇒ 壞參數落到鏡、並由 useVehicleUrlSync 把 URL 改寫乾淨。Sean 08-08 拍板 A:合意,壞參數視同無車。
```

🎯 **⇒ 那個「靜默視同無車」不是漏掉,是拍過板的。**
🛑 **而要注意它的【射程】**:那一句講的是**還原 / 鏡**那條路(深連結進站時要不要讀鏡),
**它沒有講「列表頁該顯示幾件商品」。** 📌 **同一個行為,兩個受詞 —— 而拍板只涵蓋其中一個。**

### 🟢 ③ 這個問題 **repo 裡已經有一個解好的樣本**

`components/ProductPage.tsx:96-105`(PDP)自己做出了**三態**:

```ts
const hasVehicleParam =
  searchParams.get('vehicle') != null ||
  (searchParams.get('brand') != null && searchParams.get('model') != null);
if (!hasVehicleParam) return null;                 // 無參數 = null(讀鏡)
const parsed = parseVehicleFromUrl(searchParams, motoBrands);
return parsed ? { … } : 'invalid';                 // 參數在而對不到 = 'invalid'(不讀鏡、顯重選)
```

📌 **⇒ 它是在【呼叫端外面】用 `hasVehicleParam` 把 `null` 的兩個語意拆開的。**
🎯 **⇒ 所以「分不出來」這件事,已經有人分出來了 —— 只是分在自己家裡,沒有分在函式裡。**

---

## 1. ① 那 6 處**今天**各自怎麼用 `null`(逐支,帶座標)

| # | 座標 | 呼叫前有沒有 `hasVehicleParam` 護欄 | 拿到 `null` 之後做什麼 | 把 `null` 讀成 |
|---|---|---|---|---|
| A | `app/products/(catalog)/page.tsx:320` | ✅ 有(`hasVehicleParam ? … : null`) | `vehicle?.brand ?? null` 交給 `vehicleTreeForProductsPage`,並照「沒有車」去算整頁 | **「沒有車」** |
| B | `app/products/[slug]/page.tsx:269` | ✅ 有 | `parsedVehicle && parsedVehicle.model ? {…} : undefined`,推薦引擎當「沒車」(`:270` 註解逐字「只選了品牌沒選車型 → 當作沒車」) | **「沒有車」** |
| C | `app/api/catalog/facet-counts/route.ts:94` | ✅ 有(`:60-63` 先擋形狀) | 🔴 **`:97-99` `!parsed ⇒ 400 unknown_vehicle`;`:101-105` `modelId 而 parsed.model undefined ⇒ 400 unknown_model`** | **「壞參數」⇒ 擋** |
| D | `components/use-vehicle-url-sync.tsx:50` | ❌ 沒有 | `if (restorable) return;`(還原窗口:URL 有車待 flush ⇒ 勿清)。`null` ⇒ **往下走去改寫 URL** | **「URL 上沒有可還原的車」** |
| E | `components/use-deep-link-restore.tsx:74` | ❌ 沒有 | `const v = urlVehicle ?? vehicleFromContext(motoBrands);` ⇒ **`null` 才去讀鏡** | 🔴 **「沒有車」——而那是 Sean 08-08 拍板 A 的那一格** |
| F | `components/ProductPage.tsx:100` | ✅ 有(`:96-99` 自己組) | `parsed ? {…} : 'invalid'` ⇒ **三態** | **「參數在而對不到」⇒ 顯重選** |

🛑 **我讀不懂的:0 處。** 六處的用法都有在原地寫下理由。

---

## 2. ② 哪幾處把 `null` 當成「使用者清掉車 / 本來就沒車」⇒ 那幾處是**約束**

```
🔴 E(use-deep-link-restore)—— **最硬的一處**:它拿 `null` 當「去讀鏡」的開關,
   而 Sean 08-08 拍板 A 逐字同意「壞參數視同無車」。
   ⇒ 📌 **函式若改成對壞參數丟錯誤 / 回可分辨的東西, 這一處的行為會變** ——
      壞參數不再落到鏡 ⇒ **而那正是拍板說要的行為。**
🔴 D(use-vehicle-url-sync)—— 它用 `null` 當「沒有可還原的車 ⇒ 可以改寫 URL」。
   ⇒ 而「壞參數」在今天也走這一條 ⇒ **URL 被改寫乾淨**(那是 E 那句拍板的後半)。
🟢 A / B —— 把 `null` 當「沒有車」而**呼叫前已經有 `hasVehicleParam` 護欄** ⇒
   它們拿到 `null` 只有一種可能:**參數在而對不到**。📌 **所以它們今天就已經把壞參數當成沒車了 —— 而那正是 `:901` 抱怨的那一格。**
🟢 C —— 已經擋了,不受影響。
🟢 F —— 已經自己分出三態,不受影響(而它可以改成直接用函式的新回傳,少一段自組)。
```

🎯 **⇒ 真正的約束只有 D 與 E 兩處,而它們背後是同一個拍板。**
📌 **⇒ 而那個拍板的射程是「還原 / 鏡」,不是「列表頁顯示幾件」。**

---

## 3. ③ 在 ①② 之下,函式能改成什麼形狀 —— **三案,不先選**

### 甲:函式回**三態**(`null` / `'invalid'` / 物件),呼叫端各自決定

- 把 `ProductPage.tsx:96-105` 那個已經跑得動的形狀**搬進函式**。
- A / B 改成:`'invalid'` ⇒ 顯示「認不得這台車」(或照 C 的做法擋)。
- D / E **一個字都不用改**(它們今天就只看 truthy / falsy,`'invalid'` 是 truthy ⇒ 🔴 **會改變行為,要逐處確認**)。
  ⚠️ **這一格是甲案最大的風險,而它可以用型別擋**(回傳型別改成 union ⇒ TypeScript 會在 D / E 逼你處理)。
- 🟢 優點:**不推翻 Sean 08-08 那個拍板** —— D / E 可以明文選擇「`'invalid'` 也走讀鏡」。
- 🔴 缺點:改函式簽章 ⇒ 6 處全部要看(而那正是這份 plan 已經做完的事)。

### 乙:函式不動,**只修 A 與 B**(照 C 的做法在呼叫端擋)

- 🟢 優點:**零風險動到 D / E**,拍板完全不碰;而 C 已經證明這個做法可行。
- 🔴 缺點:**第 4 份拷貝** —— C 已經是一份、F 是一份、再加 A / B 就是四處各判一次。
  📌 **而「每個消費端各判一次就會分岔,而分岔不會紅」是這個 repo 自己記過的話**
  (`ProductImage.tsx:117` 逐字:「判斷住在 `@pcm/domain`,不在這裡」)。

### 丙:函式對壞參數 **throw**

- 🔴 **推翻 Sean 08-08 拍板 A**(壞參數視同無車)。
- 🔴 而 D / E 在 render 路徑上 ⇒ throw 會把整頁弄掉,**比今天的靜默更糟**。
- 🛑 **列在這裡是為了讓下一個人不要再想一次。不建議。**

---

## 4. 影響

- **前台**:A / B 改了之後,客人帶壞 `?vehicle=` 進來會看到「認不得這台車」而不是**全站 25,444 件**。
- **今天的實測讀數**(2026-09-20 11:3x,正式站,匿名):
  ```
  /products?vehicle=zzq:nosuchbike999&page=1  ⇒ 200 · 25,444 件(= 全站)
  /products?page=1(不帶 vehicle)            ⇒ 200 · 25,444 件  ← 逐字相同
  /api/catalog/facet-counts?vehicle=同一個值  ⇒ 400
  🟢 正對照 /products?vehicle=honda:adv-150   ⇒ 200 · 3,754 件
  ```
- **後台**:不碰。
- 🆕 **這一改會不會弄壞別的**:
  - 甲案改簽章 ⇒ **D / E 的行為會變**(`'invalid'` 是 truthy)⇒ 🔴 **要逐處明文決定**,而型別會逼人處理。
  - **SEO / 舊書籤**:今天帶壞車的網址回 200 全站;改了之後回「認不得」⇒ 🛑 **那些網址的爬蟲行為會變,我沒量**。
  - **沒量**:今天實際有多少請求帶著認不得的 `?vehicle=` 進來(要帶 query string 的請求 log)。
    📌 **本 plan 只證明【踩得到】,沒有證明【有人在踩】。**

---

## 5. Rollback

- **甲**:把函式簽章改回 `… | null`,並還原 A / B / F 的呼叫端。🛑 **D / E 若在甲案裡被改過,要一起還原** —— 而那是改動面最大的一格。
- **乙**:只還原 A / B 兩處的呼叫端判斷。**最小。**

---

## 6. 怎麼驗它真的好了

```
🟢 正對照(必須仍然正常):/products?vehicle=honda:adv-150 ⇒ 200 · 件數 ≠ 全站
🔴 判準:/products?vehicle=zzq:nosuchbike999 ⇒ **件數 ≠ 全站**(或明文擋)
🔵 而 C 那條路不得回歸:/api/catalog/facet-counts?vehicle=<亂編> ⇒ **仍然 400**
🛑 而 D / E 那兩條路要各有一格會紅的檢查 —— 它們今天的行為是拍板過的, 不得無聲改變
```
📌 **用的是我量出這件事的同一把尺(件數比對),不換新的。**

---

## 7. 沒做 / 證不到

1. **我沒有量今天有多少客人帶著壞 `?vehicle=` 進來** —— 只證明踩得到。
2. **我沒有跑任何碼** —— 六處的用法是開檔讀出來的。
3. **甲案對 D / E 的實際影響我沒有驗**(`'invalid'` 是 truthy 會怎樣)—— **那要做出來才知道**。
4. **Sean 08-08 那個拍板的完整原文我沒看過** —— 我讀的是 `use-deep-link-restore.tsx:77` 那一行**轉述**。
   🔴 **落筆前應該先把原文找出來**,而我沒找到。**標【轉述,未見原文】。**

---

## 8. 要 Sean 答的

```
Q1: 走哪一案?
A1: 甲(函式回三態, 判斷收回函式裡)| 乙(只修 A/B, 不動函式)| 丙(throw, 已不建議)

Q2: 🔴 而不管哪一案, 有一題只有你能答:
    你 2026-08-08 拍的「壞參數視同無車」——
    那一句要不要繼續涵蓋【列表頁顯示幾件商品】?
A2: 甲 要(那 /products 回全站就是對的, 這一列可以收掉)
    乙 不要(那一句只管「還原 / 讀鏡」, 列表頁該擋)  ← 而 facet-counts 那條路今天已經是這樣做的
```
🛑 **Q2 沒答之前,甲乙都不該動手** —— 📌 **因為它決定的不是「怎麼改」,是「這件事到底算不算壞的」。**
