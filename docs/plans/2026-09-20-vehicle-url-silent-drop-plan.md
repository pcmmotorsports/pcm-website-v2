# 選錯車靜默給全站商品 —— plan(鐵則 8,等 Sean 批)

> 板列 `⟦front-VEHFACETSILENTDROP⟧`(`docs/launch-todo.md`)。
> 線 `-17` 2026-09-20 寫。**本檔不動任何碼。** 批了才有下一步。
> 🔵 2026-09-22:Sean 推翻 08-08,選「只差空白 / 橫線 / 大小寫就自動選,差更多列 3 台建議」⇒ 施工版見 **§9(第三版)**。

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

## 9. 施工版(第三版,2026-09-22;Sean 推翻 08-08、選「接近就自動選,差更多就讓客人挑」)

> 前兩版(保留 08-08、只加提示)經 Codex R1 / R2 都 FAIL,全文 `~/pcm-mailbox/codex-901-plan-R1-20260922.txt`、`…-R2-20260922.txt`。
> Sean 2026-09-22 新方向(經主視窗轉達,原話):「千萬不要換成上次選的車,如果帶入找不到我們車款,那就變成自動挑選最接近車款就好。」
> 主視窗提醒「名字最接近不代表零件通用(YZF-R7 可能被配到 YZF-R6)」後,Sean 選甲:
> ① 只差空白、橫線、大小寫就自動選;② 差更多就列同品牌最接近的 3 台讓客人自己點,不套用上次選的車;③ 商品詳情頁與列表頁同一套規則。
> ⇒ 本版取代前兩版 §9,從 Codex R1 重新審。
> 🔵 第三版 R1 FAIL(10 必修)⇒ 改寫 9-3 起;R2 FAIL(3 必修)⇒ Sean 2026-09-22 選甲(接受約 1 個工作天、三處一次做完)⇒ 三項補進 **9-11**,送 R3。
> 🛑 **R3 仍 FAIL(4 必修),依主視窗指示停下、未開始實作。本節尚不能施工。** 全文 `~/pcm-mailbox/codex-901-plan-v3-R3-20260922.txt`:
> ① `pending` 的失效規則不足(導航被取代 / 被靜默忽略 / 上一頁 / 換路徑);② 寫網址的入口不只 6 個(另有 `ActiveChips` 移除分類、三個清除全部入口、通用配件分頁、移除關鍵字);
> ③ 商品頁 `persistVehicle` 的等值早退只比短版,純長版仍清不掉,不能「照舊保留」;④ 桌機加購若收父層預先算好的值,客人在頁內清車後仍會帶舊車。
> R2 剩下的三項(全文 `~/pcm-mailbox/codex-901-plan-v3-R2-20260922.txt`):
> ① 分頁同步(`page=`)也會寫網址,導航還沒落地時會把舊車款抄回去(例:`page=3` 時清車 ⇒ 舊車被寫回),要把分頁同步納入同一套協調;
> ② 商品詳情頁的加入購物車(桌機 `ProductInfo.tsx:263`、手機 `ProductPage.tsx:238`)直接讀選車紀錄,網址 `notFound` 時仍會帶上舊車;
> ③ 測試 router 要能模擬「導航還沒落地」,否則 ① 那種競態測不出來。

### 9-1. 一句話

網址裡的車款,**只差空白、橫線、大小寫**就當成同一台車直接選上;差更多就**不猜**,畫面列出同品牌最接近的 3 台讓客人點,商品清單在客人點之前不顯示。**任何情況都不再套用客人上次選的車。**

### 9-2. 比對規則(全部收進 `lib/vehicle-url.ts` 一支函式,6 個呼叫端共用)

新增 `resolveVehicleFromUrl(searchParams, motoBrands)`,回傳三種結果:

| 結果 | 何時 | 內容 |
|---|---|---|
| `none` | 網址沒有車款輸入(沒有非空的 `vehicle`,也沒有 `brand`+`model` 同在的長版) | — |
| `ok` | 找得到 | `{ brand, model?, year? }`(與今天 `parseVehicleFromUrl` 的回傳同形)+ `canonical: boolean`(網址是不是正規寫法) |
| `notFound` | 有車款輸入但對不到 | `{ brandName?: 找得到的牌子名, suggestions: 最多 3 台 { brandId, modelId, label } }` |

判斷步驟(輸入是網址上的牌子段、車型段,短版優先、短版空才讀長版,與今天 `vehicle-url.ts:29-37` 相同):

1. **牌子**:先比 id 完全相同(今天的做法);沒有 ⇒ 用 `looseVehicleKey`(`lib/vehicle-match.ts:38`,= NFKC + 去頭尾空白 + 小寫 + 去掉空白與橫線)比牌子的 id 與名字,**剛好一個**對上才算。對不上 ⇒ `notFound`(沒有牌子,建議清單是空的)。
2. **只有牌子段**(`?vehicle=honda`)⇒ `ok`(整個品牌),與今天相同。
3. **車型**:先比 id 完全相同(今天的做法,含 `-2` 這種撞名序號 id);沒有 ⇒ 用同一支 `looseVehicleKey` 比這個牌子底下每台車的 id 與名字,**剛好一台**對上 ⇒ `ok`,`canonical: false`。
4. 對上兩台以上(例如同時有 `MT-09` 與 `MT 09`,正式庫這種撞名車型有 15 組)或一台都沒有 ⇒ `notFound`,附同品牌最接近的 3 台。
5. **年份**:照今天,不驗(`vehicle-url.ts:45` 原樣帶過);不在本案。

「最接近的 3 台」怎麼挑:在同一個牌子裡,依「寬鬆鍵與網址車型段開頭相同的字數」由多到少排,同分再依名字排序,取前 3。
例:網址 `yamaha:yzf-r9` ⇒ 寬鬆鍵 `yzfr9` ⇒ 前綴最長的是 `yzfr7`、`yzfr770th`、`yzfr7worldgp60thanniversary`(都前 4 字相同)⇒ 列這 3 台。
🔵 2026-09-22 實作(片 1 Codex R1)更正:同品牌還有 `YZF-R6` 等其他 `yzfr` 開頭的車時,它們也是前 4 字相同 ⇒ 同分依名字取前 3,不一定是上面 3 台。下表 `yzf_r7` 那列原寫「建議清單會列 YZF-R7」與本規則不符(`yzf_r7` 與各台都只有前 3 字相同 ⇒ 全部同分、依名字),以本規則為準;名字排序 `YZF R7 …` 排在 `YZF-R7` 前面,所以 YZF-R7 不一定在前 3。
🔴 **只列、不選**:名字接近不代表零件通用(主視窗提醒的 YZF-R7 / YZF-R6),所以第 4 步一律不自動選。

測試案例(正式庫 2026-09-22 唯讀,經主視窗:Yamaha 有 `YZF-R7`、`YZF R7 70th`、`YZF R7 World GP 60th Anniversary`):

| 網址車型段 | 結果 |
|---|---|
| `yzf-r7`(正規 id) | `ok`,`canonical: true` |
| `YZF R7`、`yzfr7`、`YZF-R7` | `ok` ⇒ YZF-R7,`canonical: false` |
| `yzf_r7`(底線) | 底線不在規則內 ⇒ `notFound`,建議照上面的規則(不保證有 YZF-R7,見上面更正) |
| `yzf-r7-70th` | `ok`(正規 id) |
| `yzf-r9` | `notFound`,建議 3 台(見上) |
| 牌子 `YAMAHA` / `yamaha` | 牌子 `ok` |
| 牌子 `zzq` | `notFound`,沒有建議 |

`parseVehicleFromUrl` 保留原簽章,改成 `ok ⇒ vehicle、其他 ⇒ null` 的薄包裝,給只要「有沒有找到車」的地方用;需要分 `none` / `notFound` 的呼叫端改用新函式。

### 9-3. 同步規則:網址是真相,選車狀態跟著網址走(R1 MF-1、MF-3、MF-7)

今天列表頁的「網址 ⇒ 選車狀態」只在進站那一次做(E 是 mount-only,`use-deep-link-restore.tsx:110`),之後都是「選車狀態 ⇒ 網址」(D)。
同頁導航到另一個車款網址時,選車列不會跟著變。本案補一條規則,三種來源的先後如下:

| 來源 | 做什麼 | 誰負責 |
|---|---|---|
| ① 網址的車款輸入變了(進站、同頁導航、點建議、上一頁 / 下一頁),而且不是 D 自己剛寫的那一個 | 重新判斷:`ok` ⇒ 選車狀態改成那台車(`rawDispatch`,不算客人操作);`notFound` ⇒ 選車狀態清空、**不讀選車鏡**;`none` ⇒ 照今天(進站讀鏡;同頁導航維持目前選車,D 會把它寫回網址) | 新增的 `useVehicleFromUrl`(列表頁),取代 E 裡處理車款的那一段 |
| ② 客人在畫面上選車 / 改車 | 照今天:D 把正規寫法寫進網址、寫選車鏡 | D |
| ③ 客人清除車款(選車列清除、膠囊 ×、清除全部、提示區塊的「移除車款條件」) | 網址拿掉所有車款參數(短版與長版一起)、**同時清選車鏡** | 共用 helper(9-5) |

- D 寫網址前記下它寫的值;① 看到網址變成 D 剛寫的值就不動,避免來回互蓋。
- D 在網址是 `notFound` 且選車狀態是空的時候**不動網址**(今天會刪掉壞參數)。
- 網址 `ok` 而不是正規寫法(`canonical: false`)⇒ ① 選上那台車後,D 照今天把網址寫成正規的 `?vehicle=yamaha:yzf-r7`(`router.replace`,不捲動)。
- **有關鍵字時**(`keywordActive`):今天 E 整段跳過(`use-deep-link-restore.tsx:72`),但伺服器照樣用網址車款過濾商品,商品卡連結卻只從選車狀態帶車(`ProductsPage.tsx:375`)⇒ 兩邊不一致。
  本案改成:有關鍵字時,① 仍然處理**網址上的車款**(`ok` 選上、`notFound` 清空),但**不讀選車鏡**、不還原分類與品牌(關鍵字那道閘原本擋的是鏡與分類品牌,理由不變)。
- **商品詳情頁**:沒有 D / E。本案在 `ProductPage.tsx` 補:`ok` 而非正規 ⇒ 用它既有的 `persistVehicle`(`router.replace`)改成正規寫法;`notFound` ⇒ 不讀選車鏡、顯示提示。

### 9-4. 客人看到什麼

**找得到(含只差空白 / 橫線 / 大小寫)**:跟今天正確網址一樣;網址自動改成正規寫法。

**找不到(列表頁)**:
- 選車列是空的,**不套用上次選的車**。
- 商品清單的位置改顯示提示區塊,**不顯示商品**(不顯示全站,也不顯示整個品牌 —— 整個品牌的商品大多不適用那台車):

  > 找不到這台車,你是不是要找:
  > 〔YZF-R7〕〔YZF R7 70th〕〔YZF R7 World GP 60th Anniversary〕
  > 也可以在上方重新選擇車款,或〔移除車款條件〕看全部商品。

  - 牌子也找不到(沒有建議)時:「找不到這台車,請在上方重新選擇車款,或〔移除車款條件〕看全部商品。」
  - 建議:連結,把網址車款換成那台車的正規寫法,其他條件保留、頁碼回第 1 頁 ⇒ 由 9-3 ① 選上。
  - 「移除車款條件」:按鈕,走 9-3 ③(拿掉車款參數 + 清選車鏡),重新整理也不會跑回舊車(R1 MF-4)。
- 側欄件數:網址車款是 `notFound`,或 `ok` 但還沒改成正規寫法時,**先不查**件數(改成正規寫法後才查)⇒ 不會閃「件數暫時無法顯示」。件數 API 本身(C)不改(R1 MF-6:它的 `SAFE_VEHICLE` 前置檢查與年份驗證都用正規 id,本案讓它永遠只收到正規寫法)。
- 文字常數放 `products-message-state.tsx`,樣式沿用 `MESSAGE_STATE_STYLE`。

**找不到(商品詳情頁)**:
- 提示與 3 個建議放在適用判斷那一區的**最前面**,在 `ProductFitmentCheck.tsx:160`「沒有 fitments 就整段不畫」那道早退**之前**(R1 MF-9),所以通用商品也看得到。
- 點建議:留在同一個商品頁,網址車款換成那台車。不套用上次選的車。今天的「重新選車」入口保留。
- 頂端車款標籤(`ProductBreadcrumb.tsx:118`)改用同一份解析結果,不再自己 slugify 商品 fitments 去猜(R1 MF-8:撞名車型會顯示成另一台)。

### 9-5. 要改的檔(對照 §1 的 A–F,另加 R1 指出的漏項)

| # | 檔案 | 改什麼 |
|---|---|---|
| — | `lib/vehicle-url.ts` | 新增 `resolveVehicleFromUrl`(9-2);新增 `withVehicleParam(params, segment \| null)`:設定或清除車款時**同時處理短版與長版**(長版 `brand` 只在與 `model` 同在時才清,單獨的 `brand` 是商品品牌篩選不能刪,與 D 今天 `use-vehicle-url-sync.tsx:83-87` 的規則相同,改成共用) |
| A | `app/products/(catalog)/page.tsx` | 用新函式;`notFound` ⇒ 不查商品,交給 `ProductsPage` 畫提示區塊;`hasVehicleParam` 改讀原始網址 |
| B | `app/products/[slug]/page.tsx` | 用新函式;`ok` 才當有車;`notFound` 當沒車 |
| C | `app/api/catalog/facet-counts/route.ts` | **不改**(見 9-4 側欄件數) |
| D | `components/use-vehicle-url-sync.tsx` | `notFound` 且選車空 ⇒ 不動網址;改用 `withVehicleParam`;記下自己寫的值給 ① 比對 |
| E | `components/use-deep-link-restore.tsx` | 車款那一段移到新的 `useVehicleFromUrl`;分類、品牌還原照舊 |
| — | `components/use-vehicle-from-url.ts`(新檔) | 9-3 ① |
| — | `components/use-catalog-filter-url-sync.tsx` | 「清除全部」那一輪(`clearedToEmpty`,`:349` 附近)一併拿掉車款參數;今天它會從還沒更新的網址把 `vehicle` 抄回去(R1 MF-2 已隔離執行重現) |
| — | `components/ProductsPage.tsx` | 收 `notFound` 畫提示區塊;商品卡連結的車款改用「網址解析結果優先、選車狀態次之」(R1 MF-3) |
| — | `lib/vehicle-facet-display.tsx` | 見 9-4 側欄件數 |
| F | `components/ProductPage.tsx` | 三態改用新函式;`ok` 非正規 ⇒ 改網址;`persistVehicle` 改用 `withVehicleParam`(今天只刪短版,純長版網址清不掉,R1 MF-5) |
| — | `components/ProductFitmentCheck.tsx` | 提示與建議放在 `:160` 早退之前 |
| — | `components/ProductBreadcrumb.tsx` | 車款標籤改用解析結果;清除改用 `withVehicleParam`(`:134` 今天只刪短版) |

`catalog-query.ts` 的 `SAFE_VEHICLE` 白名單照舊(查商品用);查商品一律用解析後的正規車款。

### 9-6. 拆片與時間(初估約 6 小時,7 片;每片 15–45 分鐘的上限照鐵則 4)

| 片 | 內容 | 時間 |
|---|---|---|
| 1 | `resolveVehicleFromUrl` + 建議排序 + `withVehicleParam` + 單元測試(9-2 表格、短長版並存、單獨 `brand` 不刪) | 45 分 |
| 2 | `useVehicleFromUrl` + E 拆出車款段 + D 改動 + 測試(先把守 08-08 行為的舊斷言改成新行為,改之前讓它紅一次) | 45 分 |
| 3 | 清除全部抄回壞車款那一格 + 「移除車款條件」清鏡 + 測試 | 30 分 |
| 4 | 列表頁 A + `ProductsPage` 提示區塊 + 商品卡連結來源 + 件數延後 + 元件測試 | 45 分 |
| 5 | 商品詳情頁 B / F / `ProductFitmentCheck` / `ProductBreadcrumb` + 測試 | 45 分 |
| 6 | 測試用的「會真的換網址」router(見 9-9)+ 導航回歸測試 | 45 分 |
| 7 | 本機鑽機走查與截圖 + 三綠 + `pnpm test` 全跑 | 30 分 |
| — | 整批送 Codex、修正 | 另計,約 1 小時 |

### 9-7. 影響

- 客人:壞車款網址不再默默變成全站或舊車;只差空白 / 橫線 / 大小寫的網址會直接找到車。
- **推翻 08-08 拍板 A**(壞參數視同無車、落到鏡):Sean 2026-09-22 明示推翻。
- **行為改變的邊界**:同頁導航到另一個車款網址時,選車列會跟著網址變(今天不會);有關鍵字時網址上的車款會顯示在選車列(今天不會,但商品早就按它過濾)。
- 一般網址(正規 id)的結果不變。
- 不碰 schema / 資料庫 / `packages/ui` / 件數 API。
- SEO:壞車款網址從「200 + 全站商品」變成「200 + 提示區塊、沒有商品」;沒量有多少爬蟲帶這種網址。

### 9-8. Rollback

revert 那 7 顆 commit。沒有資料庫變更。

### 9-9. 怎麼驗(R1 MF-10)

今天的整合測試 router 只記錄呼叫、不會真的換網址(`use-deep-link-restore.test.tsx:40,85`)。片 6 在測試裡做一個「`router.replace` / `push` 會更新 `useSearchParams` 並重新 render」的小 router,下面每一格都核對**網址、選車列、商品查詢參數、商品卡連結**四樣,清除類再加「重新整理後」:

1. 直接進站:`ok` 正規 / `ok` 寬鬆(之後網址變正規)/ `notFound` 有建議 / `notFound` 沒建議 / 只有牌子 / 正規 `-2` 車型 / 寬鬆撞兩台(⇒ `notFound`)。
2. 有選車紀錄(鏡)再開上面的壞網址 ⇒ 不套用舊車;`none` 仍讀鏡(負對照)。
3. 同頁導航:已選 A ⇒ 導航到壞網址(選車列清空);壞網址 ⇒ 點建議(選上那台);上一頁 / 下一頁。
4. 清除:選車列清除、膠囊 ×、清除全部、「移除車款條件」、商品詳情頁清除 —— 每個都要網址不留車款、重新整理不跑回舊車。
5. 短長版並存:`vehicle=&brand=honda&model=nosuch`(依長版)、合法短版 + 壞長版(依短版)、單獨 `brand=akrapovic` 不被刪。
6. 關鍵字 + 車款:`?search=煞車&vehicle=yamaha:YZF%20R7` ⇒ 選車列顯示 YZF-R7、網址改正規、商品卡連結帶車;`?search=煞車&vehicle=yamaha:nosuch` ⇒ 提示區塊。
7. 商品詳情頁:同樣的網址組各一次;沒有 fitments 的商品帶壞車款 ⇒ 看得到提示;撞名車型的頂端標籤顯示正確那台。
8. 伺服器與瀏覽器兩端用同一份車款清單呼叫同一支函式,建議的內容與順序相同(同一組輸入各跑一次比對);hydration 以本機鑽機開發模式的主控台沒有 hydration 警告為準。

本機鑽機(`scripts/storefront-probe/up.sh`):第 1、3、4、6、7 格挑代表各走一次,**等網址穩定、商品載完再截圖**;手機寬度 375 看換行。
上線後正式站用 `YZF R7` 那組實際走一次(Sean 走一遍的一部分)。

### 9-10. 沒做 / 限制

1. 年份:列表與商品頁照今天不驗(網址年份原樣帶過並送進查詢);件數 API 照今天會驗年份。不在本案。
2. 底線、句點等其他符號不算「只差空白 / 橫線 / 大小寫」,會走「列建議」那一條。
3. 沒量今天有多少人帶壞車款網址進來。
4. 首頁、購物車頁、搜尋 API、帳號頁不經過 `parseVehicleFromUrl`,不在本案。**商品詳情頁的加入購物車在本案內**(見 9-11 ②)。
5. 時間是初估;第 6 片的測試 router 若比預期難做,會先回報再決定。

### 9-11. R2 三項的補法(2026-09-22,Sean 選甲後補;送 Codex R3)

> ⛔ **本節已被 `docs/plans/2026-09-22-catalog-url-writer-plan.md` 取代**(R3 FAIL 後,Sean 選乙:一次做完整)。以下留作紀錄。

**① 所有寫網址的地方共用一個「待落地網址」(R2 MF-1)**

今天列表頁有 4 個會改網址的 hook,各自讀 `window.location.search` 再 `router.replace`:
D(`use-vehicle-url-sync.tsx:92`)、篩選同步(`use-catalog-filter-url-sync.tsx:595`)、分頁 / 排序同步(`products-url-state.tsx:203`)、
以及本案新增的「移除車款條件」;商品詳情頁另有 `ProductPage.tsx:117`、`ProductBreadcrumb.tsx:138`。
`router.replace` 是非同步的:上一發還沒落地,下一發讀到的仍是舊網址,就會把舊車款抄回去(R2 已隔離執行重現:`page=3` 清車 ⇒ 舊車被寫回)。

補法:新增 `lib/url-writer.ts`,只有一支 `replaceSearch(router, edit)`:
- 模組內記一個 `pending`(最近一次送出、還沒落地的網址)。
- 每次呼叫:若 `window.location` 已經等於 `pending` ⇒ 清掉 `pending`;以 `pending ?? window.location` 為底,交給 `edit(params)` 改,改完跟底比,一樣就不送;不一樣就記成新的 `pending` 再 `router.replace`。
- 上面 6 個寫入點全部改用它(各自原本的判斷與等值早退照舊,只把「讀哪一份網址」與「送出」收進來)。
- 9-3 的 `useVehicleFromUrl` 判斷「是不是 D 剛寫的值」也改讀這個 `pending`,不另記一份。
- 🔴 效果:多個寫入者在同一輪接力改網址時,後一個會在前一個的結果上改,不會蓋掉;順序照 React effect 的執行順序,不需要各 hook 互相知道。
- 限制:只管本站自己送的導航。瀏覽器上一頁 / 下一頁不經過它 ⇒ 那時 `pending` 會在下一次呼叫時因為網址不同而被新網址取代(以實際網址為底)。

**② 商品詳情頁加入購物車遵守網址解析結果(R2 MF-2)**

桌機 `ProductInfo.tsx:263` 與手機 `ProductPage.tsx:238` 都直接 `readSearchVehicle()`(只讀選車鏡)。
補法:`ProductPage` 已算出網址車款的三態(9-3);新增一支純函式 `cartVehicleFromUrlState(urlState)`:
- `ok` 且有車型 ⇒ 用網址那台車(`source: 'search'`,形狀與 `readSearchVehicle` 相同);
- `ok` 只有牌子 ⇒ 不帶車款(與今天「名稱不齊就不帶」同一個原則);
- `notFound` ⇒ **不帶車款**(不讀鏡);
- `none` ⇒ 照今天 `readSearchVehicle()`。
手機那一處直接用;桌機由 `ProductPage` 把結果當 prop 傳給 `ProductInfo`。購物車資料結構不改。

**③ 測試 router 要能模擬「導航還沒落地」(R2 MF-3)**

片 6 的測試 router 分兩種模式:`immediate`(`replace` 立刻更新網址與 `useSearchParams`)與 `deferred`(先排隊,測試呼叫 `flush()` 才落地)。
`deferred` 模式掛上實際的 D、`useVehicleFromUrl`、篩選同步、分頁同步,從 `?vehicle=yamaha:mt-07&page=3` 出發各做一次:換車、清車、清除全部、點建議、移除車款條件,
每格 `flush()` 後核對**最終網址、選車列、商品查詢參數**三樣一致,且舊車沒有被寫回。
另加 `url-writer` 自己的單元測試:連續兩發在第一發未落地時,第二發以第一發為底;網址已落地後 `pending` 被清掉;上一頁造成的網址變化會蓋過 `pending`。
商品詳情頁:鏡裡有 MT-07、網址 `notFound` ⇒ 桌機與手機加入購物車都**不帶**車款;網址 `ok` ⇒ 帶網址那台;`none` ⇒ 帶鏡那台(負對照)。
本機鑽機走查另加:第 3 頁清車、第 3 頁換車、商品頁壞網址加購後打開購物車看車款欄。

**對 9-5 / 9-6 的增補**

| 檔案 | 改什麼 |
|---|---|
| `lib/url-writer.ts`(新檔) | ① |
| `components/products-url-state.tsx` | 分頁 / 排序同步改用 `replaceSearch` |
| `components/use-catalog-filter-url-sync.tsx` | 送出改用 `replaceSearch`(原本的讓路守衛與等值早退照舊) |
| `components/ProductInfo.tsx` | 加購車款改收 `ProductPage` 傳入的值 |
| `lib/search-vehicle.ts` | 新增 `cartVehicleFromUrlState` |

片 1 加 `url-writer` 與單元測試(+15 分);片 2 起各寫入點改用它(+20 分);片 5 加兩個加購入口(+20 分);片 6 加 `deferred` 模式(+20 分)。
合計初估約 **7.5 小時 + 審查約 1 小時**。
