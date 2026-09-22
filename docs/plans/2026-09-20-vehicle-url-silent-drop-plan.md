# 選錯車靜默給全站商品 —— plan(鐵則 8,等 Sean 批)

> 板列 `⟦front-VEHFACETSILENTDROP⟧`(`docs/launch-todo.md`)。
> 線 `-17` 2026-09-20 寫。**本檔不動任何碼。** 批了才有下一步。
> 🔵 2026-09-22:Sean 選乙(提示客人重新選車)⇒ 施工版見 **§9**。

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

---

## 9. 施工版(2026-09-22,Sean 早上選乙:提示客人重新選車;經主視窗轉達)

> 第二版(同日):第一版經 Codex R1 FAIL(5 項必修),本版逐項改寫;R1 全文 `~/pcm-mailbox/codex-901-plan-R1-20260922.txt`。
> 🛑 **第二版經 Codex R2 仍 FAIL(5 項必修 + 1 小修),依鐵則 12 停下、不跑 R3,等 Sean 決定。本節尚不能施工。**
> R2 全文 `~/pcm-mailbox/codex-901-plan-R2-20260922.txt`。R2 指出的核心:保留 D / E 不動時,不同壞網址的最終網址與畫面差很多
> (牌子在車型不在 ⇒ E 還原成整個品牌、D 改成 `?vehicle=honda`;有關鍵字時 D 不清理;有選車紀錄時可能寫回舊車),
> 疊一層有狀態的提示會出現「新網址已合法仍說找不到」「同一壞值翻頁時該顯示還是收起」等矛盾;另 9-3 對年份的描述有誤(網址年份不會被丟掉)。

### 9-1. 選哪一案、為什麼

選 **§3 乙的縮小版:只在商品列表頁加提示,`parseVehicleFromUrl` 不動,D / E 不動**。

- Sean 選乙 = §8 Q2 乙:08-08「壞參數視同無車」**只管還原 / 讀鏡**,列表頁要讓客人知道。
  ⇒ D(改寫網址)、E(讀全站選車鏡)**照舊**,本案不碰那個拍板。
- 甲(函式改三態)要動 6 個呼叫端,D / E 會因為 `'invalid'` 是 truthy 改變行為,範圍比「加一個提示」大很多。
- B(商品詳情頁的推薦)、C(件數 API,已回 400)不改。

### 9-2. 客人會看到什麼

帶著網站認不得的車款網址進入商品列表頁時,在選車列下方顯示一行提示:

> **找不到這個網址裡的車款,請重新選擇車款。** 〔關閉〕

- 文字只講確定的事:網址裡的車款找不到;客人可以做的是重新選車。
  不寫「目前顯示全部商品」:沒有關鍵字時,若客人之前選過車,E 會套用那台車,那句話就會是錯的。
- 商品清單本身照今天的行為,不改。
- 車款清單讀不到時(`motoBrands` 是空的)**不顯示**:那時認不得是因為清單沒載到,由既有的「車款清單暫時無法載入」說明。
- 樣式沿用 `products-message-state.tsx` 的 `COMPACT_MESSAGE_STATE_STYLE`,文字常數放同一支檔。

### 9-3. 什麼算「網站認不得的車款網址」(R1 MF-1、MF-2)

判斷讀【原始網址】,不讀 `catalog-query.ts:289` 過濾過的 `catalogQuery.vehicle`(那一步會先丟掉格式不合的值)。
新增純函式 `badVehicleInput(searchParams, motoBrands): string | null`(放 `lib/vehicle-url.ts`,回傳那段車款輸入的原字串,沒有問題回 `null`):

| 網址 | 結果 | 理由 |
|---|---|---|
| `?vehicle=zzq:nosuchbike999`(牌子不存在) | 提示 | `parseVehicleFromUrl` 回 null |
| `?vehicle=honda:nosuchbike999`(牌子在、車型不在) | 提示 | 解析結果 `model` 是 undefined 而網址有指定車型(`vehicle-url.ts:42`);今天會默默擴大成整個品牌 |
| `?brand=honda&model=nosuchbike999`(長版) | 提示 | 同上 |
| `?vehicle=Honda:adv-150`(格式不合,大寫) | 提示 | 原始值在、對不到 |
| `?vehicle=honda`(只有牌子,合法) | 不提示 | 負對照:品牌單段是合法網址 |
| `?vehicle=honda:adv-150` | 不提示 | 負對照:正常車款 |
| 沒帶車款 / `?brand=akrapovic`(商品品牌篩選,沒有 `model`) | 不提示 | 負對照:長版要 `brand` 與 `model` 同在才算車款 |
| `?vehicle=`(空值) | 不提示 | 沒有指定任何車款,沒有「找不到」可言;站內也沒有地方產生這種網址 |
| 車款清單是空的 | 不提示 | 見 9-2 |

年份對不到(例如 `honda:adv-150:1999`)**不在本案**:今天 `resolveVehicle`(`vehicle-url.ts:93`)會丟掉年份、保留車款,那是另一個既有決定。

### 9-4. 提示什麼時候出現、什麼時候收起(R1 MF-3、MF-4)

在瀏覽器端判斷(`ProductsPage` 已有 `useSearchParams` 與 `motoBrands`;伺服器端畫面也用同一組值,不會有 hydration 不一致),**不用伺服器 prop**。
規則寫成一支純函式 `nextVehicleNotice(prev, event)`,每一種轉換都有測試:

| 事件 | 結果 |
|---|---|
| 進站時網址是壞車款 | 顯示 |
| 網址變了,新網址是壞車款(同頁導航、換另一個壞網址、關掉後又導航回壞網址) | 顯示(關閉狀態重置) |
| 網址變了,**只有車款相關參數**(`vehicle` / 長版 `brand`+`model`、`year`)不同,其他參數都一樣 | **保留**:這是 D 在清理或改寫網址(`use-vehicle-url-sync.tsx:83-92` 只動這幾個參數) |
| 網址變了,其他參數也變了(換分類、換頁面上的篩選、點頁首「商品目錄」) | 收起:客人已經在做別的事 |
| 客人用畫面上的篩選或選車(走 `useFilterScrollTop` 包出來的 `dispatch`) | 收起 |
| 進站還原、讀選車鏡(走 `rawDispatch`,`ProductsPage.tsx:205,245`) | **不**收起 |
| 按「關閉」 | 收起 |

- 用 `dispatch` / `rawDispatch` 分辨「客人做的」與「系統還原的」,不靠渲染輪次推測(R1 MF-4 的建議)。
- 有關鍵字時(`keywordActive`)E 不還原任何篩選(`use-deep-link-restore.tsx:72`),D 照樣清理網址 ⇒ 依上表提示保留,客人第一次選車就收起。
- 客人用畫面選車時,D 也會改寫網址(只動車款參數)⇒ 依上表「保留」,但同一時間 `dispatch` 那一條已經收起 ⇒ 結果是收起。

### 9-5. 要改的檔(拆 2 片,合計約 75 分鐘)

**片 1(約 30 分鐘):兩支純函式 + 單元測試**

| 檔案 | 改什麼 |
|---|---|
| `apps/storefront/src/lib/vehicle-url.ts` | 新增 `badVehicleInput` |
| `apps/storefront/src/lib/vehicle-notice-state.ts`(新檔) | 新增 `nextVehicleNotice` |
| 兩支對應測試 | 9-3 表格每一列一格;9-4 表格每一列一格 |

**片 2(約 45 分鐘):接到畫面 + 元件測試 + 本機看畫面**

| 檔案 | 改什麼 |
|---|---|
| `apps/storefront/src/components/ProductsPage.tsx` | 用上面兩支函式管提示狀態;`dispatch` 包一層收起提示;畫提示與關閉按鈕 |
| `apps/storefront/src/components/products-message-state.tsx` | 新增文字常數 `VEHICLE_PARAM_NOT_FOUND` |
| `apps/storefront/src/components/ProductsPage.test.tsx` | 見 9-7 |

`app/products/(catalog)/page.tsx`、`catalog-query.ts`、`use-deep-link-restore.tsx`、`use-vehicle-url-sync.tsx` **不改**。

### 9-6. 影響與 Rollback

- 客人:帶壞車款網址進來,會多一行提示。其他人看不到任何差別。
- 網址、狀態碼、商品清單、件數 API、商品詳情頁、選車鏡:都不改。SEO 不受影響(仍是 200,內容不變)。
- 不碰 schema / API / 共用套件 `packages/ui`。
- Rollback:revert 那兩顆 commit。沒有資料庫變更。

### 9-7. 怎麼驗(R1 MF-5)

元件測試(`ProductsPage.test.tsx`;注意測試裡的 `router.replace` 只改網址、不重跑伺服器,所以網址變化要用 `useSearchParams` 的 mock 模擬):
1. 壞網址進站 ⇒ 顯示;模擬 D 清理(網址只少了 `vehicle`)⇒ **仍顯示**。
2. 正常 `/products` ⇒ 同頁換成壞網址 ⇒ 顯示。
3. 壞網址 A 顯示 ⇒ 關閉 ⇒ 換成壞網址 B ⇒ 再次顯示。
4. 有選車紀錄(鏡)+ 壞網址 ⇒ 還原套用舊車後**仍顯示**;沒有選車紀錄 ⇒ 顯示。
5. `keywordActive`(帶 `search=`)+ 壞網址 ⇒ 顯示;客人第一次選車 ⇒ 收起。
6. `StrictMode` 下進站還原 ⇒ 不會被誤收起。
7. 換分類(其他參數變了)⇒ 收起。
8. 負對照:`?vehicle=honda`、`?vehicle=honda:adv-150`、`?brand=akrapovic`、沒帶車款 ⇒ 都不顯示。

本機鑽機(`scripts/storefront-probe/up.sh`):
- `/products?vehicle=zzq:nosuchbike999` 與 `/products?vehicle=aprilia:nosuchbike999` ⇒ **等網址被清理完、商品清單穩定後**再截圖,畫面上要同時看到「網址已不含 vehicle」與提示。
- 正對照:`/products?vehicle=<鑽機裡有的車>`、`/products?vehicle=aprilia` ⇒ 沒有提示。
- 手機寬度(375)看一次換行。

### 9-8. 沒做 / 限制

1. 沒有關鍵字、客人之前選過車時,壞網址進站仍會套用那台舊車(E 照舊,08-08 拍板);提示會說網址的車找不到,但不會說列表套了哪台車。有關鍵字時不會套用。
2. 年份對不到仍是默默丟掉年份(見 9-3 最後一段),不在本案。
3. 沒量今天有多少人帶壞車款網址進來(§7-1 那條仍成立)。
4. 08-08 拍板原文仍未找到,射程判斷依 `use-deep-link-restore.tsx:77` 的轉述與 Sean 今天的選擇。
