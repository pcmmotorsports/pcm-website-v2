# 前台 storefront:「半份資料算出來的值」盤點(2026-08-18 A 窗)

> **這是純盤點,一行 code 都沒動。** 目的是回答 `A-223-STOP` §5 洞 B:
> 「A 窗這條線叫【前台 + 後台外觀】,而整整一班全在後台 ⇒ **沒有人知道前台那半現在是什麼狀態**。」
>
> 🔴 **盤點角度不是「前台有幾支檔」,是一個具體問句** ——
> **後台這幾天在收的那個病(資料只載到一半,而畫面印出一個由半份資料算出來的答案),前台有沒有同一款?**
> 選這個角度的理由:它有現成判準(`docs/patterns/pagination-loop-review.md` 五條 + 拍板 `Q-EMBED-1/2`),
> 而「盤點前台狀態」這種沒有判準的題目會產出一份沒有人讀的檔。

---

## 0. 一句話結論

**前台這一款病**:**已知的兩處都已經修好了**(客人訂單的件數印「?」);
**新撈到兩處是「依賴沒有被寫下來」** —— 與後台 `shouldMergeAmount` 完全同型。
⚠️ **「今天不可達」這半句對 §4 那處是【推的、未量】**(C 窗收窄;§3 那處則有實測 `2000` 撐著)。

---

## 1. 分母(每一條都可重跑)

```
路由頁       find apps/storefront/src/app -name 'page.tsx' | wc -l        ⇒ 28
元件         find apps/storefront/src/components -name '*.tsx' | grep -v '\.test\.' | wc -l  ⇒ 118
測試檔       find apps/storefront/src -name '*.test.*' | wc -l            ⇒ 226
.range( 迴圈  grep -rn '\.range(' apps/storefront/src --include='*.ts' --include='*.tsx' | grep -v '\.test\.' | wc -l  ⇒ 1
截斷旗標      grep -rn 'runcated' 同上                                      ⇒ 4
直接 .from(   grep -rn "\.from('" 同上                                      ⇒ 5
畫面上的 .length  grep -rnE '\{[a-zA-Z.]+\.length\}' --include='*.tsx'      ⇒ 8
```

---

## 2. ✅ 已經修好的:截斷旗標 4 處

```
OrdersTab.tsx:39,46      itemCountTruncated ⇒ 件數改印「?」  （2026-08-16 Q-EMBED-1）
OverviewTab.tsx:121,128  同上
```
⇒ **4 處命中全部是同一件事的兩個載體,而且都已落地。** 前台的 `Q-EMBED-1` 是做完的。

---

## 3. 唯一的翻頁迴圈:逐條核 `pagination-loop-review.md` 五條準則

**位置**:`apps/storefront/src/lib/products.ts:679-720`(`getVehicleTaxonomyCached`,車輛下拉的來源)

| # | 準則 | 判定 | 依據 |
|---|---|---|---|
| ② | `.range()` 兩端皆含 | ✅ | `:695` `range(from, from + PAGE_SIZE - 1)` |
| ③ | 中途失敗要 throw、不得 break | ✅ | `:696-702` throw,而且**帶頁碼**(逾時通常在後段頁) |
| ④ | `count` 不當終止判準 | ✅ | `:719` 用 `data.length < PAGE_SIZE` |
| ⑤ | 排序帶唯一鍵 | ✅ | view 是 `SELECT DISTINCT moto_brand, model_code, year_start, year_end`(`20260811100000_…:122`) |
| ① | **頁大小【嚴格小於】`db-max-rows`** | ✅ **成立** | `:682` `PAGE_SIZE = 1000` < `max-rows = 2000` ⇒ 有餘裕。**量測資訊跟著數字走,見下** |

### ① 的量測資訊(**跟著數字走** —— 表會被複製走,前後文不會)

```
db-max-rows = 2000
量法    V 窗親手打，storefront anon key → 正式站 REST
        products?select=id&limit=5000 ⇒ HTTP 206、content-range 0-1999/19777、實回 2000 列
        🔴 分母 19,777 > 2000 ⇒ 量到的是【天花板本人】，不是資料不夠
時點    2026-08-18 凌晨；環境 = 正式站
背景    Sean 2026-08-17 D2 拍「調大 + 程式改」，調大【他已經按了】
```
🔴 **我原本在這裡寫的是「`max-rows` = 1000 ⇒ 零餘裕、準則①不成立」——【那是錯的】。**
**來源是 memory 裡 08-17 的值,而 Sean 之後把它調大了。**
⇒ **教訓不在「我引錯數字」,在【我引的是一個會被人改掉的伺服器設定,而我當它是常數】。**
**這正好就是下面那條 finding 講的病 —— 我在描述它的時候自己踩了一次。**

### 🔴 ① 真正的 finding(**不受上面那個數字翻面影響**)

> **上面是今天的天氣;下面才是這一則的價值。**

```
❌ 已過期  「今天剛好相等所以翻得動」（前提是 1000/1000，而實際是 1000/2000）
✅ 仍成立  🔴 max-rows 一旦低於 PAGE_SIZE ⇒ 【第 0 頁就 break】⇒ 整份車款表只剩一頁
          🔴 2026-08-18 C 窗開檔複核，更正我原本寫的「每頁少一筆、漸進漏」:
             max-rows=999 ⇒ 第 0 頁拿 999 ⇒ 999<1000 為真 ⇒ break
             max-rows=500 ⇒ 第 0 頁被夾到 500 ⇒ 一樣 break
          ⇒ 不是漸進漏，是【只剩一頁】。「漸進」那個形狀會讓讀的人【低估】它。
✅ 仍成立  🔴 而這個依賴【沒有任何載體】：repo 內零字面可掃、測試看不到、
          調低的那一刻沒有任何東西會叫
```
⚠️ **調低今天沒有理由發生** —— 但「沒有理由發生」與「發生了會被發現」是兩件事,
而這一條**兩件都不成立**:它沒理由發生,**而且真的發生也不會被發現**。
🔴🔴 **而那道 `console.warn` 救不了這一面 —— 它裝在一條【到不了的路】上**(C 窗複核,比我原本寫的深一層):
```
warn 的條件   page === MAX_PAGES - 1        ← 第 49 頁才判
而壞世界      第 0 頁就 break
⇒ page 永遠走不到 49 ⇒ 那道 warn 【一次都不會響】
```
⚠️ **原本我寫「它防住了 MAX_PAGES 那一面,而沒防住 max-rows 這一面」** ——
**那句讀起來像「再加一個條件就好」**,而實際是那道守門在這個世界裡**根本執行不到**。
✅ 它守 `MAX_PAGES` 撞頂仍然是對的、值得留 —— 只是那是**另一個世界**。

---

## 4. 畫面上的 `.length` 逐處判(8 處,不是抽驗)

| 位置 | 印什麼 | 判定 |
|---|---|---|
| `CategoryGrid.tsx:236` | **全站共 N 類** | 🔴 **候選,見下** |
| `CategoryGrid.tsx:188` | `console.warn` 的數字 | ✅ 不在畫面上 |
| `CartView.tsx:108` / `CheckoutView.tsx:298` / `CheckoutStep2ReviewSections.tsx:132` | 購物車件數 | ✅ 資料是 client 端自己的購物車,不經 DB 列表查詢 |
| `ProductTabs.tsx:136` | 重點 N 項 | ✅ 來自**單一商品**的 `product.highlights` 欄位,不是列表查詢 |
| `FilterTop.tsx:132` | 品牌 · N | ✅ **語意上安全**:它說的是「這個下拉裡有 N 個」,而那句是真的;**不是**「全站有 N 個」 |
| `BrandPageWhy.tsx:65` | `data-n` 屬性 | ✅ 不是文字內容 |

### 🔴 `CategoryGrid.tsx:236` —— 唯一的全稱宣稱

```
畫面逐字   依件數排序取前 {chips.length} 名 · 全站共 {categories.length} 類
來源       page.tsx:91 → listCategories() → helpers/category-queries.ts:54
           .from('categories').select(…).order('sort_order')
           🔴 【沒有 .limit()、沒有 .range()】⇒ 吃 PostgREST db-max-rows 上限（**2000**，量測資訊見 §3）
⇒ 分類數若超過 2000，那個數字會停在 2000 而畫面【完全正常】
⚠️ **今天可不可達 = 未量**(2026-08-18 C 窗收窄):我**沒有量過分類數**,只是覺得它遠小於 2000
   ⇒ **那是推的,不是事實**。缺的檢查 = 對正式庫數一次 `categories` 列數。
**依賴同樣沒有寫下來 —— 與 §3 那條同一個病根。**
```
🔴 **值得注意的是那一格自己的註解**(`:233-234` 逐字):
> 「兩個數字都現算:抄稿上的『11』『15』會在分類增減的那一天開始說謊,而畫面看起來完全正常 —— 沒有任何測試會紅。」

⇒ **寫這行的人已經想過「這個數字會說謊」這件事,而想的是【寫死值】那一面。**
**「現算」擋掉了寫死值那個病,同時把它換成另一個:現算的來源自己有上限。**

---

## 5. ⚠️ 這份盤點守不住什麼(不要讀成「前台掃過沒事」)

```
1 只掃了【一個角度】——「半份資料算出來的值」。前台的視覺對齊、無障礙、
  效能、design-reference 一致性(鐵則 1) 一律【沒有掃】。
2 .length 那 8 處是【字面 grep】⇒ 組出來的字串、i18n key、
  用變數接過一手再印的（const n = xs.length 之後印 {n}）⇒ 掃不到。
3 ~~「前台透過 adapter 查」那一大半【沒有逐支盤】~~ 🏁 **已補,見 §8**(2026-08-18)。
4 第 3 節那五條是【對著 code 讀出來的】，不是實跑。
  🔴 尤其 ① 那條的「壞世界」我【沒有真的把 max-rows 調低去看它漏】——
     那需要一個可拋棄的 Postgres，本班沒做。⇒ 它是推的，不是量的。
```

---

## 6. 建議的下一步(不自己做,列出來讓人挑)

```
甲  把第 3 節 ① 與第 4 節那兩個「沒寫下來的依賴」各補一行註解 —— 最便宜，零行為改動
乙  🔴 【已作廢】~~把 PAGE_SIZE 從 1000 降到 900（真正拿到餘裕）~~
    —— 前提是 max-rows=1000，而實測是 2000 ⇒ 餘裕本來就有，這一案沒有標的
丙  盤 adapter 那一半（本檔限度 3）—— 範圍最大，建議獨立一片
```
⚠️ **我判甲最划算,而且在乙作廢之後它是唯一有標的的一案** ——
它讓一個隱形依賴變成看得見的字。**這是我的判斷,可以推翻。**

🔴 **~~原本這裡寫「而乙才是真的修」~~** —— 那句在 `max-rows` 翻面成 2000 之後就沒有對象了,
**而我改完上面那格之後,這一句還在下面活著。**
⇒ **同一份檔裡的一個更正,會在別的段落留下孤兒句** —— 這是本檔第二次示範自己在講的那個病。

---

## 7. 🔴 這三處是同一個病根,**不要當成三件事**

🏁 **號已發 = `#629`**(C 窗用 `reserve-backlog.sh` 走 git ref CAS 真鎖;
本檔兩處已於 C 窗 commit `37a4749d` 併入,兩邊互指)。

```
本檔 §3   vehicle_taxonomy 翻頁：max-rows 一旦低於 PAGE_SIZE ⇒【第 0 頁就 break】
          ⇒ 整份車款表只剩一頁（不是漸進漏），而那道 console.warn 到不了
本檔 §4   CategoryGrid「全站共 N 類」：listCategories 無上界 ⇒ 吃 max-rows
C 窗      ORDER_ITEMS_EMBED_LIMIT = 200：max-rows 若低於 200 ⇒ PostgREST 先夾
          ⇒ 回 150 列 ⇒ 150 >= 200 為 false ⇒ 旗標說沒事而紙真的少列
```
> **共同病根一句話:code 依賴一個住在【伺服器設定】裡的數字,
> 而那個依賴沒有任何載體 —— 調低的時候完全靜默。**

⇒ **走一個號、一張站點表,不是三個號**(三個號會讓下一個人以為是三件事、修一個就結案)。

### 🔴🔴 而掃的時候撈到一件比這三處大的事:**全 repo 至少 18 處的 `max-rows = 1000` 已經過期**

```
數法（可重跑）
  grep -rn '1000 上限\|1000-row\|1000 列上限\|PostgREST 1000\|max-rows.*1000\|1000.*max-rows' \
    --include='*.ts' --include='*.tsx' --include='*.md' apps packages docs | grep -v '\.test\.'
  ⇒ 18 命中（2026-08-18 落筆當下；🔴 這個數字自己也會漂，重跑）
```
**代表性的幾處**（不是全部，全部見上面那條命令）：
```
packages/domain/src/order/types.ts:822 / :1196        「production 實測 1000」
packages/adapters/src/supabase/mappers/order.ts:444    「又低於伺服器 max-rows（production 實測 1000）」
packages/ports/src/IWalletRepository.ts:27             「靜默停在 db-max-rows（實測 1000）」
apps/admin/src/lib/dashboard/today-read.ts:53          「取 500，嚴格低於 production 實測的 max-rows=1000」
docs/patterns/pagination-loop-review.md:23             「對上 db-max-rows 1000 ⇒ 零餘裕（自知，註解有記）」
docs/phase-1-backlog.md:15801                          「db-max-rows 實測也是 1000」
```
🔴 **這些當初【都是對的】** —— 它們寫的是 2026-08-02 那次 production 實測。
**Sean 08-17 把它調大之後,它們在同一秒全部變成假的,而【沒有任何一個檔案被改動】。**

⚠️ **影響面要講精確,不要嚇人**:
```
「N < 1000 所以安全」那類論證   ⇒ 實際餘裕【變大】了 ⇒ 結論仍成立、只是理由的數字過期
「等於 1000 所以零餘裕」那類    ⇒ 🔴 結論【翻面】（本檔 §3 就是被我這樣寫錯的那一個）
⇒ 沒有立即壞掉的東西，而【下一個引用這些數字做判斷的人會判錯】。
```
🔴 **我沒有全部改** —— 跨 `apps/` `packages/` `docs/` 多條線、有些在別人正在動的檔裡,
**逐處改字面是收割窗/主視窗的層級,不是我一個施工窗該自己橫掃的。** 已回報。
⇒ **而真正的修法不是把 18 處的 `1000` 改成 `2000`** —— 那只是把保存期限往後推一次。
**要改的是「數字旁邊沒有時點與探法」這件事本身。** 這條已進 `#629`。


---

## 8. `packages/adapters` 逐支盤(補 §5 限度 3;2026-08-18)

### 分母(先寫死,再開始掃 —— 不邊掃邊定義範圍)

```
adapters 全部 .from(   grep -rn "\.from\('" packages/adapters/src --include='*.ts' | grep -v '\.test\.' | wc -l
                       ⇒ 46
```

### 判法(每處三類)

```
① 有 .limit(              ⇒ 有界
② 有 .range( 分頁迴圈      ⇒ 有界（fetchAllPaginated 共用）
③ 🔴 什麼都沒有           ⇒ 吃 db-max-rows
（.single / .maybeSingle / head:true / count: 也算有界 —— 它們不回列陣列）
```

### 🔴 我第一版篩法【有假陽性】,而它差點讓我報 16 處

```
第一版  正規式從 .from(' 往後切【600 字元】找 limit/range   ⇒ 報 16 處
第二版  每處往後看【20 行】                                  ⇒ 剩 2 處
```
**差在哪(逐處開檔看到的)**:
```
SupabaseProductAdapter.ts:273  .limit(limit) 在【15 行外】(中間隔著 orderDesc 三元式)
SupabaseProductAdapter.ts:286  走 fetchAllPaginated + .range(from, to)，是【外層函式】給的界
SupabaseProductAdapter.ts:331  .limit(poolLimit) 在 .order 之後
email_outbox 5 處              全是 insert / update ⇒ 本來就不需要【讀取】上界
VehicleAdapter:79 / AddressAdapter:85  是 delete
```
🔴 **教訓**:「無上界查詢」這個判定,**量具的窗開多寬會直接改變答案** ——
600 字元與 20 行的差別,是「16 處要修」與「2 處要看」的差別。
⇒ **報這種數字之前先問:我的量具會不會把【有界但寫得遠】誤判成無界?**
⚠️ **而第二版也不保證對** —— 20 行窗一樣有上限,只是比 600 字元寬。**這是縮小誤差,不是消除。**

### 結果:③ 類 = **2 處**

| 位置 | 表 | 有沒有濾條件 | 判定 |
|---|---|---|---|
| `helpers/category-queries.ts:67` | `categories` | 🔴 **沒有**(撈全站分類) | **真候選** —— 已於本班補註解,併 `#629` |
| `helpers/fitment-queries.ts:164` | `product_fitments_effective` | ✅ `.eq('product_id', …)` + `.eq('match_source','inherited')` | **低風險,但有一句未量** |

**`fitment-queries.ts:164` 的判定(寫清楚,不含糊)**
```
✅ 它的註解【已經寫了理由】(:154-155 逐字):
   「單商品 inherited 列個位數~數十(Y016=6),單次查詢即可、不分頁」
   ⇒ 這比大多數地方好 —— 它有理由，而且有一個實測樣本。
⚠️ 而「不會超過 db-max-rows」這句仍是【推的】:
   Y016=6 是【一個商品】的實測，不是全稱。
   一個通用件理論上可以適配到很多車款。
   缺的檢查 = 對正式庫問一次「單一 product_id 的 inherited 列數最大值」。
⇒ 照 §2③ 的規矩標【未量】，不寫成「不可能」。
```

### 一句話結論

**`packages/adapters` 46 處查詢裡,真正「什麼界都沒有的 select」只有 2 處,而其中 1 處有濾條件。**
⇒ **這一半的狀態比我掃之前預期的好。** 唯一的真候選(`categories`)已經進 `#629`。
