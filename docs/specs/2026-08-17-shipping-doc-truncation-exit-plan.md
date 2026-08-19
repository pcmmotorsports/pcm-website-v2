# 讓出貨單「撈不全」不會發生 · plan(C 窗,2026-08-17)

> **Sean 逐字(方向,不是需求)**:
> 「我們立場不是【如果東西壞了,那我要提醒 Sean 什麼、寫什麼字給員工看】,
> 而是【**這樣的狀況不應該讓他發生**;如果會發生,那我們現在應該怎麼解決問題讓他不要發生】。」
> 前一句追問是「那印不全之後該怎辦?還是要出貨啊…」,而他自己把它收窄成上面這句。
>
> **驗收標準**(主視窗校準後):**不是「被截的時候那個人能不能把事情做完」,是「不會被截」。**
>
> 🔴 **守門(`ee7b1f35`,`Q-C16` 已追認)留著,但降級成【最後一道保險】。**
> 判別句:**它在正式站上響了一次 = 我們的分頁壞了,不是使用者做錯事。**
>
> ## ✅ 批准狀態:**Sean 已批【甲】,2026-08-17。**
> 逐字「**A: 甲 = 批,現在做**」(經主視窗轉達)。批准範圍逐字:
> ①`listOrderItemsForPrint` 頂層 `.range()` 撈到盡 + `count: 'exact'` 對帳
> ②🔴 **「A 餵壞 B」必須一起解**(只修品項那半等於沒修,而那半連症狀都沒有;
>   主視窗確認**這條有單獨講給他聽,他是知道了才批的**)
> ⛔ **不含**動共用的 `ADMIN_ORDER_DETAIL_SELECT` —— 真要動 ⇒ 鐵則 12⑥ ⇒ 停下來問。
> ⚠️ **這句批准寫在這裡而不是只留在訊息裡** —— 08-16 已經發生過「兩份已批 plan 的檔頭
> 仍寫著尚未批准」。**訊息會不見,檔會留下來。**
> 🔴 **而批准之後我查證出【他聽到的理由裡有一句是錯的】**(embed 不能翻頁 ⇒ 錯,見 §1 更正段)
> ⇒ 結論沒變、理由換掉,**是否要讓他重看由主視窗決定,不由我判**。
>
> 座標實測自 worktree `/Users/sean_1/pcm-print` branch `print-docs`,
> 落筆當下 `git rev-parse --short HEAD` ⇒ `edc09ff5`。**行號會漂,引用前用同段的錨點自己重跑。**

---

## §1 現況:為什麼會撈不全 —— **結構性,不是暫時性**

**有兩條路。擋法與畫面不同,只答一條會答錯。**
**數法**:`git grep -n 'itemsTruncated) {' -- apps/admin/src/components/print/shipping-doc.tsx` ⇒ 1 處(路 A)、
`git grep -n 'groups === null) notFound' -- 'apps/admin/src/app/print/**'` ⇒ 1 處(路 B)。
⚠️ **這個 2 是「我找到兩條」不是「總共只有兩條」** —— 我掃的是這兩個 pattern,**沒有窮舉全站列印路徑** ⇒ 標**未確認**。

| | 觸發條件 | 出處(錨點) | 現行擋法 |
|---|---|---|---|
| **路 A** | 這張訂單的品項列數 **≥ 200** | `packages/adapters/src/supabase/mappers/order.ts:406` `ORDER_ITEMS_EMBED_LIMIT = 200`;判定 `:830` | `components/print/shipping-doc.tsx:63` ⇒ 一行紅字 |
| **路 B** | 這張訂單相關的箱品項列數 **> 500** | `lib/shipping/shipment-repository.ts:454` `SHIPMENT_ITEM_ROWS_LIMIT = 500`;查詢 `:511`;判定 `lib/shipping/order-shipments.ts:48` | `app/print/orders/[id]/shipping/[shipmentId]/page.tsx:62` ⇒ `notFound()` |

**兩個都是【一次最多拿這麼多】的固定上限** —— 不是逾時、不是權限、不是網路。
⇒ **重新整理一百次,拿回來的還是同一個數字。**(⇒ 重試鍵這條路已排除。)

### 🔴🔴 兩條路不是獨立的 —— **A 會餵壞 B**

`page.tsx:51-52` 把 `detail.items` 的 id 集合(**已被 200 夾過**)餵給 `loadOrderShipments`
⇒ 訂單有 300 項時,**後 100 項所在的箱根本不會被查到**,而那不會被算成「截斷」。
**⇒ 只修 B 不修 A 等於沒修。**

### 🔴 這兩個常數**是我們自己設的**,而底下還有一道**不是我們設的**

`ORDER_ITEMS_EMBED_LIMIT` 的 docstring 逐字(`mappers/order.ts:397-404`):
> 「邊界一直握在伺服器 `max-rows`(**production 實測 1000**)手上…
>  ⇒ 邊界必須由我們的常數擁有,觸及時翻成 `AdminOrderDetail.itemsTruncated`。」

> ⚠️ **上面是 2026-08-17 當時的逐字引用,原文不動(改它等於偽造引用)。**
> 🔴 **而它引的那份 docstring 後來改了**:`1000` 已於 2026-08-18 更正為 `2000` ⇒ 以 `packages/adapters/src/supabase/mappers/order.ts:406` 為準。

⇒ **200 不是天花板,1000 才是** —— 而 1000 是 PostgREST 的**伺服器設定**。
🔴 **這裡我第一版寫錯並當場更正,留痕**:我先寫「`max-rows` 全樹 **0 命中** ⇒ 它不在這個 repo 裡」,
**而實跑 `git grep -c 'max-rows' -- . | wc -l` ⇒ `36` 個檔命中**
(正向對照 `git grep -l 'ORDER_ITEMS_EMBED_LIMIT' -- . | wc -l` ⇒ `14`)。
⇒ **那 36 處是【在講它】的註解與文件,不是【設定它】的地方** —— 兩者不是同一件事,
而我把「我沒查」寫成了「查無」。**正確的說法**:`max-rows` 是 Supabase 專案端設定,
**我沒有查證它現在的值**;那個 `1000` 我是引 docstring 的實測紀錄
(`mappers/order.ts:398` 逐字「production 實測 1000」)⇒ **未確認,動工前要自己量一次**。
> ✅ **那一次「自己量」已經發生了**(2026-08-18,Sean 親手調、V 窗實測 ⇒ `2000`)⇒ 本段的「未確認」**已結案**,值以 `packages/adapters/src/supabase/mappers/order.ts:406` 為準。
> ⚠️ 上面那個 `mappers/order.ts:398` 的**行號已漂**(現為 `:406`)—— 行號會漂,**引它請對字面不對行號**。
### 🔴🔴 更正(2026-08-17,開工前查證官方文件之後):**「embed 不能翻頁」是錯的**

我原本在這裡寫:「**內嵌(embed)的列數沒有辦法翻頁** ⇒ 要真的撈得完,那份品項**必須**改成頂層查詢。」
**那句話是錯的**,我當時自己標了「未確認、動工前要先查一次」,而**查證的結果是推翻,不是確認**。

**官方文件當場查(附 URL,不憑 docstring、不憑記憶)**:
- <https://docs.postgrest.org/en/stable/references/api/resource_embedding.html> §Embedded Filters 逐字:
  「Limit and offset operations are possible」,範例逐字
  `-d "select=*,actors(*)" -d "actors.limit=10" -d "actors.offset=2"`
  ⇒ **內嵌資源可以獨立 limit/offset,也可以獨立 `order`。**
- <https://docs.postgrest.org/en/stable/references/configuration.html> `db-max-rows` 逐字:
  「A hard limit to the number of rows PostgREST will fetch from a view, table, or function.」
  預設 **∞** ⇒ ⚠️ **文件【沒有】說它對內嵌資源的行為** ⇒ 「1000 對 embed 也是硬牆」這半
  **仍然未確認**,而且現在少了一個支撐它的理由。

🔴 **結論不變,理由整段換掉** —— 這一句要留著,因為**下一個人是照理由決定要不要重看的**:
甲(頂層 `.range()`)之所以仍然是對的,**不是因為 embed 做不到**,是因為
1. **不動共用的 `ADMIN_ORDER_DETAIL_SELECT`** ⇒ 不觸發鐵則 12⑥
   (消費端數法 `git grep -c ADMIN_ORDER_DETAIL_SELECT -- packages apps | grep -v test`;
   byte-equal 守門在 `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts`);
2. 走 embed 翻頁的話**每翻一頁都要把上層那張 orders 列(含 PII)重撈一次**,而我們只要品項;
3. 頂層查詢的投影是 `id / title / sku / spec / quantity / quantitySummary` **6 個非 PII 欄**
   (⚠️ **這 6 個是我列的需求,不是量出來的** —— 實作時要對著 `ShippingDoc` 的用法重數一次),
   比明細那份白名單窄 ⇒ **更安全,不是更寬**。

⚠️ **而甲不再是「唯一可行」,它是「我推薦的那一條」** —— 乙(調高上限)之外,
**現在多出一條丁:沿用 embed、加上 `order_items.limit/offset` 翻頁**
(依據= 上面那條 `resource_embedding.html` 的 URL 與逐字範例)。
⚠️ **「現在共有甲乙丙丁四條」是我列得出來的四條,不是窮舉過的四條 ⇒ 未確認。**
📎 我**沒有**改推薦,理由是上面三條;**但 Sean 批甲的時候,他聽到的理由裡有一句是錯的**
⇒ **已回報主視窗,由它決定要不要讓他重看。**

---

## §2 主體:怎麼讓它**永遠撈得完**

### 🟢 甲(推薦)· 品項改走**頂層分頁查詢**,列印頁專用

**做法**
1. 新增一支列印頁專用的 `listOrderItemsForPrint(orderId)`:對 `order_items` 下**頂層**查詢,
   `.range()` 逐頁撈到盡(既有寫法照抄 `apps/admin/src/lib/products/product-repository.ts:134`,
   `.range()` + 第二排序鍵防漂的理由寫在 `:119-131`)。
2. `page.tsx` 用它取代 `detail.items` 作為「這張單有哪些品項」的來源;
   `detail` 其餘欄位(收件、取消、金額)照舊。
3. 路 B 的 `listShipmentItemsByOrderItemIds` 同樣改 `.range()` 撈到盡
   —— 它**本來就是頂層查詢**(`shipment-repository.ts:499`),改動比路 A 小。

**為什麼是這個**
- **它讓問題消失**,不是給問題一個出口。§3 那題(少掉的品項怎麼補)在這個方案下不存在。
- 🔴 **它【不動】共用的 `ADMIN_ORDER_DETAIL_SELECT`**(`SupabaseOrderAdapter.ts:373`;
  消費端數法 `git grep -c ADMIN_ORDER_DETAIL_SELECT -- packages apps | grep -v test`,
  byte-equal 守門在 `SupabaseOrderAdapter.test.ts`)⇒ **不觸發鐵則 12⑥**,風險留在新的這一邊。
  這正是 `page.tsx:67-69` 已經寫下的既有立場(逐字「讓新來的自己多做一點」)。
- **新查詢的投影比明細窄** ⇒ **零 PII、零價格**,白名單比現行那份**更安全**,不是更寬。

#### 🔴 那「6 個欄」已從【我列的需求】升級成【量出來的】(2026-08-17,主視窗要求)

**量法(可重跑)**:對 `apps/admin/src/components/print/shipping-doc.tsx` 掃品項欄位的用法
`git grep -nE '\bitem\.|\bit\.' -- apps/admin/src/components/print/shipping-doc.tsx`,
再加上兩支數量算式 `git grep -n 'item\.' -- apps/admin/src/lib/shipping/shipping-doc-quantities.ts`。
**逐處分類的結果**:

| 欄 | 誰在用 |
|---|---|
| `id` | `known` 集合(面7 孤兒判定)、`itemById`、`<tr key>` |
| `variantSku` / `title` / `spec` | `<ItemCells>` 三處 |
| `quantity` | 只在 `lines`(箱那半)用到,**品項本身的 `quantity` 目前沒有被印**;仍取,因為它是「訂購數」的權威來源、金額片會用 |
| `quantitySummary` | `outstandingQuantity`(`shipping-doc-quantities.ts:73`)與 `cancelledQuantityOf`(`:89`) |

⇒ **6 個,與我原本列的一致 —— 而現在它是量出來的。**
⚠️ **未取而金額片會需要的**:`unitPrice` / `lineTotal`(現行紙上零金額,見本檔 §3)。
⚠️ **刻意不取**:`procurements` / `procurementTruncated` —— **它們自己是另一個內嵌上限**
(`ORDER_ITEM_PROCUREMENT_EMBED_LIMIT`),取了等於把同一個病帶進新的查詢。

#### 🔴 這支 reader 必須住在 `packages/adapters`,不能住在 `apps/admin`

**原本我打算放 `apps/admin/src/lib/shipping/`(與 `shipment-repository.ts` 同層)。實查之後改了。**
`product_snapshot` → `title` / `spec` 的防禦解析與 `quantitySummary` 的映射,
在 `packages/adapters/src/supabase/mappers/order.ts` 是**私有函式**
(數法 `git grep -n 'function pickString\|function pickSpec\|function mapQuantitySummary' -- packages`
⇒ 三支皆無 `export`)⇒ **放 admin 就得抄一份。**
📎 **而我今晚剛立案的 `#602` 講的正是這個病**:同一份資料兩份實作、互指單向、日後各自漂。
⇒ **reader 放在 mapper 旁邊,重用那三支私有函式。**

#### ⚠️ 一個型別上的岔路,我選了窄的那條

`ShippingDoc` 現在收 `detail: AdminOrderDetail` 並讀 `detail.items`(型別 `AdminOrderDetailItem[]`,
**含 `unitPrice` / `lineTotal` / `procurements` / `procurementTruncated`**)。
新 reader 只取 6 欄 ⇒ **型別對不上**。兩條路:

| | 做法 | 代價 |
|---|---|---|
| **窄型別**(選這條) | 新增 `AdminOrderPrintItem` = 那 6 欄;`ShippingDoc` 改收 `items` 這個獨立 prop | 動 `packages/domain` 型別 + 元件簽章 + 其測試 |
| 補齊型別 | 新 reader 連 `unitPrice`/`lineTotal`/`procurements` 一起取 | **把 `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 這個內嵌上限帶進新查詢** ⇒ 同一個病換個位置 |

⇒ **選窄型別。** 理由不是「比較乾淨」,是**補齊型別那條會把我們正在拿掉的那道牆重新裝回去**。

##### 🔴 適用條款(V 窗 2026-08-17 打回,**這條不是 nit**)

**上面那個「補齊 = 把牆裝回去」的論證【只對 `procurements` 成立】**,而我把四個欄合在一起排除了:

| 被排除的欄 | 真正的理由 | 會不會過期 |
|---|---|---|
| `procurements` / `procurementTruncated` | **它是內嵌陣列、受 `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 管** ⇒ 取它等於把我們正在拆的那道牆裝回來 | **結構性,永久成立** |
| `unitPrice` / `lineTotal` | **只是「現行紙上零金額」** | **YAGNI,會過期** |

🔴 **第二列的結尾是全部的重點,它是寫給【未來那個要加金額欄的人】看的**:
**它們是同列 scalar,取它們不產生任何截斷面 ⇒ 金額片要加,不受第一列那條約束。**
📎 V 窗原話:**「論證寫得越漂亮越容易被當通則搬走,而它的適用條款就差這一句。」**
📎 而主視窗自陳它有一半責任:**它先前把那個論證讚成「本片的判準本身」並要我放進 commit body**
—— **一個被背書、寫進 commit body 的漂亮論證,下一個人不會去查它的射程。**
⚠️ `ShippingDoc` 的消費端數法 `git grep -n 'ShippingDoc' -- apps/admin/src | grep -v test` ⇒ **改簽章前當場重數**。

**成本(往返次數是算的,延遲是未量)**
- 一張 **500 品項**的單,頁大小 1000 ⇒ **1 次**;頁大小 200 ⇒ **3 次**(`ceil(500/200)`)。
  ⚠️ **實際毫秒數我量不到**(本窗無 `.env.local` ⇒ 無 DB)⇒ **未量**。
  📎 可比較的既有量測:`product-repository.ts:126-129` 引的正式庫 `EXPLAIN(ANALYZE)`
  是 **全表 seq scan 4,389 buffers / 48.053 ms**,⚠️ 那是 **2026-08-11 量的、量的是型錄那支 RPC
  不是本函式** ⇒ **是量級參考,不是保證**。
- 動 3-4 檔 ⇒ **命中鐵則 8,要 Sean 批。**
- ⚠️ **N 很大時那張紙會很長**(200 項就是好幾頁)—— 那是**紙的問題不是資料的問題**,且它至少是對的。

### 🟡 乙 · 把上限拉高(200 → 1000)

**成本最低**(改一個數字)。**而它只是把懸崖推遠,沒有拿掉懸崖** —— 1000 是伺服器 `max-rows`,
超過它一樣被切,**而且切在我們的判定看不見的地方**(docstring `:403-404` 自己寫了這個殘餘風險)。
另外 `ORDER_ITEMS_EMBED_LIMIT` **不只列印頁在用**(數法
`git grep -n ORDER_ITEMS_EMBED_LIMIT -- packages apps | grep -v test`)⇒ 調它會改到別的畫面的行為。
⇒ **只當甲落地前的止血,不當終局。**

### ⛔ 丙 · 給一條「明知不完整仍然印」的出口 —— **不推薦,理由在這裡**

**那正是守門存在的理由本身**:紙上少列品項而**紙看起來完全正常**
(該理由逐字寫在 `apps/admin/src/app/print/orders/[id]/shipping/[shipmentId]/page.tsx:55`)。
若真要走,我想得到的可接受形狀是紙上大字寫「本單共 N 項,本紙只列出前 200 項」
(⚠️ **「唯一」是我想得到的唯一,不是窮舉過的唯一 ⇒ 未確認**),
而 **N 必須是真的總數 —— 那正是我們拿不到的東西**(要 `count: 'exact'`,見 §4)
⇒ **這個方案自己咬到自己的尾巴。列出來是為了讓它被看見為什麼不行。**

---

## §3 守門降級之後,文案與那顆鈕(順手清,不是主體)

> ✅ **本節前兩件已於 2026-08-17 落地,不要照本節的描述再修一次**:
> `8f41e80e`(出貨明細單:文案 + 列印鈕 + 抬頭七值 + 標題)、
> `492205ed`(揀貨單:同一句假話 + 同一顆無條件列印鈕 + 入口鈕改名)。
> ⚠️ **第 3 件(英文 404)仍未做。**
> 🔴 **下面的行號是【落地前】的座標,現在對不上了** —— 留著是為了讓人看得懂當時的病灶,
> **不是可以照著跳過去的位置**。

三件現況實查。🔴 **出處一律用 `grep` 錨點文字,不用行號** —— 主視窗退回我上一版的理由逐字:
**「這些行號對不上」是誠實的,「這是怎麼找到它」才是有用的**
(A 窗實測同一支檔一輪內漂 **69** 行)。

1. ✅ **【已修 `8f41e80e`】路 A 的文案是一句假話** —— 舊字面逐字「請重新整理後再列印」,
   而上限是固定值 ⇒ **叫他去做一件永遠不會成功的事。**
   **怎麼找到它**:`git grep -n '請重新整理後再列印' -- apps/admin/src`
   ⇒ 修前(`edc09ff5`)**2 個檔**(出貨明細單 + 揀貨單)。
   🔴🔴 **而修完之後同一支 grep 回【5 行 / 4 個檔】,不是 0 —— 我差點把 0 寫進本檔。**
   逐行開檔分類:**5 行【全部】是我自己寫的註解與測試註解**,逐字都是
   「**原本逐字『請重新整理後再列印』**」= **它自己的訃聞**;**活的文案 0 處**。
   ⇒ 這正是 house `feedback_claimed-sync-but-only-patched-touched-lines` 的**反向代價**:
   **留痕會讓掃舊字面掃到它自己的訃聞。**
   **判別法 = 命中後開檔讀那一段**,別看到非 0 就以為沒改乾淨、
   也**別為了讓數字好看而把留痕刪掉**。
   ⚠️ **要量「活的文案還有沒有」,得換一支 pattern**:
   `git grep -n "return '.*請重新整理後再列印" -- apps/admin/src` ⇒ **0**,
   正向對照 `git grep -l '聯絡負責人' -- apps/admin/src | wc -l` ⇒ **4 個檔**
   ⇒ 那個 0 是量出來的,不是 pattern 沒對上。
2. ✅ **【已修 `8f41e80e` / `492205ed`】「列印」鈕在警告【上面】、不受擋**
   ⇒ 他按得下去,印出來的紙上只有那一行紅字。**守門裝在沒有事的那條路上。**
   **當時怎麼找到它**:`git grep -n "<PrintButton label='列印' />" -- apps/admin/src/components/print`
   ⇒ 修前**兩張紙各 1 處、都沒有任何條件包著**;
   修後 `git grep -n 'PrintButton label' -- apps/admin/src/components/print` ⇒ **2 行**,
   **兩行都在條件式裡**(逐字 `{blocked === null && …}` /
   `{cancelledAt === null && !detail.itemsTruncated && …}`)⇒ **裸的 0 處**。
3. ⛔ **【仍未做】路 B 是 Next.js 內建的英文 404** —— admin 沒有自訂 404 頁
   (數法 `git grep -ln 'not-found' -- apps/admin/src/app` ⇒ **1 檔,且是 `orders/[id]/page.tsx`
   不是 404 頁本身**)⇒ 員工分不出這是「資料太多」「網址打錯」還是「這張單不存在」
   —— **三種長得一模一樣**,正是量具坑的母題,而它現在正發生在員工眼前。
   **怎麼找到它**:`git grep -n 'groups === null) notFound' -- 'apps/admin/src/app/print/**'`。

**新文案的立場**(照守門降級後的定位寫):
> 這不是他做錯事,是我們的分頁沒撈完 ⇒ **不叫他重試、不叫他自己解決**,
> 講出真正的原因(這張訂單品項超過上限),下一步是**找負責人、不要拿這張紙出貨**。

📌 **揀貨單不是出口** —— 它截斷時照印,只加一句
「**下面看到的不是全部…不要拿這張去揀貨**」⇒ **它只是換一句話叫他別用。**
**怎麼找到它**:`git grep -n '不要拿這張去揀貨' -- apps/admin/src`。
⚠️ **`492205ed` 之後那段文案已改寫**(不再叫人重新整理),**而「照印」這個性質沒有變** ——
它仍然印出品項清單,只是同時說了「不是全部」。**改的是話,不是那張紙的行為。**

---

## §4 發生率 —— **未量,而且這個窗量不到**

本窗無 `.env.local` ⇒ **無 DB 可打**。要量的 SQL(I 窗已在跑):

```sql
select max(c) as max_items,
       count(*) filter (where c >= 200) as over_limit,
       count(*) as total_orders
from (select order_id, count(*) c from order_items group by order_id) t;
```

⚠️ **我刻意不套用 A 窗那個「最大 29 對上限 1000」的結論** —— 那是別的資料維度的量測,
拿來這裡等於**用別人的尺量自己的東西**。
🔴 **而這個數字【不改變方向,只改變急迫度】**:它量的是**歷史**,
一張「今天最大 29」的表不保證下一張團購單不是 400 項。

📎 **治本的觀測點寫在既有 docstring 裡**(`mappers/order.ts:404` 逐字「治本要 `count: 'exact'`」)
⇒ 甲落地時順帶取 `count: 'exact'`,**「撈到的筆數 = 資料庫說的總筆數」就變成一個可以斷言的東西**,
而不是靠「有沒有碰到上限」去猜。**這是把守門從猜測升級成對帳的唯一一步。**

---

## §5 要 Sean 拍的

```
Q-C18：怎麼讓出貨單永遠撈得完？
甲  品項改走頂層分頁查詢（.range() 撈到盡）＋ count: 'exact' 對帳
    ⇒ 拿掉懸崖。動 3-4 檔（鐵則 8），不碰共用查詢、不碰 schema
乙  先把上限 200 拉到 1000 止血，甲照排
    ⇒ 最快，但 1000 是伺服器硬牆、且會改到別的畫面的行為
丁  沿用內嵌、加 order_items.limit/offset 翻頁
    ⇒ 2026-08-17 查證官方文件才知道這條存在（我原本寫「embed 不能翻頁」是錯的）
C 窗推薦：仍是甲。理由換了：不是「embed 做不到」，是甲不動共用查詢、
          且每翻一頁不必把帶 PII 的訂單列重撈一次。乙可在甲落地前先做。
丙（明知不完整仍然印）我不列進選項 —— 理由在 §2 丙。
```

⚠️ **無論拍哪一條,§3 那三件都要清掉** —— 那句假話、那顆會印出空白紙的鈕,不是設計題。

## §6 誠實邊界

- **發生率未量**(§4),我沒有 DB。
- **甲的往返次數是算的,延遲未量**;正式庫 `order_items` 的索引與量級**未查**。
- 「伺服器 `max-rows` = 1000」我是**引 docstring 的實測紀錄**(`mappers/order.ts:398`),
  **不是我自己這次量的** ⇒ 引用時要帶這個限定。官方文件對 `db-max-rows` 只寫
  「A hard limit to the number of rows PostgREST will fetch from a view, table, or function」、
  預設 ∞,**沒有說它對內嵌資源怎麼算** ⇒ 那半**仍然未確認**。
- 🔴 **「PostgREST embed 不支援獨立分頁」我原本寫進本檔、標未確認,而查證結果是【推翻】**
  (見 §1 更正段的兩個 URL)。**Sean 批甲的時候,他聽到的理由裡有一句是錯的**
  —— 結論沒變、理由換掉,已回報主視窗由它決定要不要讓他重看。
- 「有沒有別的路可以出貨」我**沒有查完全部後台畫面** ⇒ 答**不知道**,不推。
- 本檔**沒有動任何 code**;手上另有一片(抬頭七值)未 commit,與本檔無關。
