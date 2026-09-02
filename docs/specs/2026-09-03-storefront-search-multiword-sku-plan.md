# 顧客站搜尋:多詞 + 料號 · slice plan(線 `-mail`,2026-09-03)

> **狀態:等主視窗-87 批(鐵則 8)。批准前不動碼。**
> **這份 plan 在什麼情況下會【變成假的】**:
> ① 有人改了 `products_public` 的欄位集合 ⇒ §2 那張「哪一欄搜得到」的表就過期;
> ② 有人動了 `buildIlikeOrFilter` ⇒ §3 的 before 不再成立;
> ③ 正式站的 PostgREST 版本換掉 ⇒ §3 那個「兩個 `.or()` 疊 = AND」的實測基底要重量。
> ⇒ 三個都不是時間到期,是**別人動了東西**,而**沒有機制會叫**。

---

## §1 現況 = 紅(**線上量的,不是本機**;2026-09-03 01:2x,`fetch('/api/search?q=…')` 在 shop.pcmmotorsports.com 的頁面 console)

```
rsv4            ⇒ items 8    🟢 正對照:單詞今天是綠的
油箱貼           ⇒ items 8    🟢 正對照:中文不含空白, 今天是綠的
rpm             ⇒ items 8    🟢
🔴 rpm rsv4      ⇒ items 0
🔴 rsv4 油箱貼    ⇒ items 0
🔴 CARK9650      ⇒ items 0   ← 真料號, 而它就印在那支商品自己的頁面上
🔴 cark9650      ⇒ items 0
🔵 zzqprbxx9999  ⇒ items 0   負對照:亂碼要回 0(防「全部都回一堆」的壞尺)
```
🎯 **形狀:單詞全中、兩個詞一律 0、料號一律 0。** 與 Sean 線上撞到的三發同形
(他逐字:「rpm rsv4」「rsv4 油箱貼」都沒有找到 ·「輸入料號會找不到東西, 我要找料號」)。

**`CARK9650` 是真料號的證據**(不是我編的):`https://shop.pcmmotorsports.com/products/lightech-cark9650`
頁面主標下方逐字印「**LIGHTECH · CARK9650**」⇒ **那是客人看得到、會照著打的字。**

---

## §2 根因兩個,而它們是**兩個獨立的病**(修一個不會修到另一個)

### 病① 整串輸入被包成【一個】連續字面
`packages/adapters/src/supabase/helpers/product-query-support.ts`(錨 `buildIlikeOrFilter`):
```js
const pattern = `%${sanitized}%`;
return columns.map((col) => `${col}.ilike.${pattern}`).join(',');
```
⇒ `%rpm rsv4%` 要求那八個字**照這個順序連在一起**出現在**同一欄**裡 ⇒ 沒有商品標題長那樣 ⇒ 0。

### 病② 搜尋欄位裡沒有料號
同檔錨 `SEARCHABLE_COLUMNS` = `['title', 'subtitle', 'description']`。

🔴🔴 **而「加上 `sku` 就好」是錯的 —— 我開檔量了,那一欄【不在被搜的那張 view 上】**:
```
被搜的是 products_public(SupabaseProductAdapter 錨 searchByKeyword ⇒ .from('products_public'))
而 database.types.ts 的 products_public Row 逐欄:
  availability brand_id card_image_trim category_id created_at description external_id
  fitments handle highlights id images manuals price_general sound_clips subtitle
  supplier_slug title updated_at video_url
  ⇒ 🔴 **沒有 sku、沒有 variant_sku**
sku 住在 product_variants(表)· variant_sku 住在 product_variants_public
  ⇒ 那是**另一張表**, 要 join / embed 才搜得到
```
✅ **而客人看到的那個料號【就是 `external_id`】,它在 view 上**:
`packages/adapters/src/supabase/mappers/product.ts:228` 逐字 `productCode: row.external_id`;
`apps/storefront/src/components/ProductTabs.tsx:224` 逐字註解「顯真主碼 productCode(如 RPM-DCC01、← DB external_id)」。
⇒ 📌 **所以料號這一半不需要 join、不需要 migration** —— 加一欄 `external_id` 就到得了。
⚠️ **未確認**:`external_id` 與 `product_variants.sku` **是不是同一個東西**。本 plan 只主張
「客人頁面上顯示的那個碼 = `external_id`」(有兩個檔案:行號 的來源),**不主張兩者相等**。

---

## §3 修法 —— 拆兩片,而**只有片 A 現在做**

### 🟢 片 A(本 slice):多詞 AND + 料號欄。**零 DB 改動、零 migration、不依賴 Sean 貼任何東西。**

**A-1 多詞 = 每個詞各一組 `or()`,詞與詞之間 AND。**
機制不是我發明的,**repo 自己實測過**:
`packages/adapters/src/supabase/SupabaseOrderAdapter.ts:1043` 逐字
「片0(`docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md`,commit `b4865c29`)**實測過的是「兩個 `.or()` 疊起來 = AND、各自括號保住」**」;
同檔 `:1143` 再量一次(PostgREST 14.16)逐字「兩道 `.or()` 疊起來 ⇒ **仍是交集、括號各自保住**」。
⇒ 形狀:`terms.reduce((qb, term) => qb.or(buildIlikeOrFilter(COLS, term)), query)`

**A-2 `SEARCHABLE_COLUMNS` 加 `external_id`。** 一個字串常數,不動查詢形狀。

**⇒ 這兩格合起來就打掉 §1 那五個紅**,而**都不碰 DB**。

### 🟡 片 B(**本 slice 不做,另提**):正規化 / 模糊 / 排序 / 索引
主視窗-87 轉來的 `#347-fuzzy`(`supabase/migrations/20260812130000_m4b_347_fuzzy_admin_search_orders.sql`)
與 Gemini 各自給的形狀(料號走精確、文字走模糊、UNION 不要一大坨 OR、相關性排序、`pg_trgm` GIN 索引)
**我同意,而它們【不在片 A 的射程裡】,理由是結構性的**:

🔴🔴 **`#347-fuzzy` 是一支【SQL 函式】,而顧客站這條路是【PostgREST 對 view 的 client filter】。**
```
UNION / UNION 非 ALL / SELECT DISTINCT / needle <% 目標 / 函式層 SET word_similarity_threshold
⇒ 這些【沒有一個】表達得出來, 只要還走 .or() 這條路
```
⇒ **要照抄它 = 要新寫一支 RPC + migration** ⇒ 命中鐵則 12③(DB 結構)⇒ **要 Sean 貼**。
🛑 **而「要 Sean 貼」今晚剛量到是一個真實的瓶頸**:同一發查證 SQL 被包給他**四次而零答案回填**
(`docs/specs/2026-09-03-cancel-email-scope-spec-draft.md` §0-A-2)。
⇒ 📌 **把「客人搜不到料號」這件事綁在那條路上,等於把它排到那個佇列後面。**
⇒ ✅ **所以先出片 A 止血,片 B 另案提。** 而片 A **不會擋住片 B**:片 B 落地時把 `searchByKeyword` 換成 RPC 呼叫,片 A 的欄位常數與切詞規則可以整段搬過去。

🟢 **而片 A 有一個片 B 沒有的好處,要明寫**:
主視窗-87 提醒 **`pg_trgm` 對中文在 macOS BSD libc 會抽出零個 trigram、正式站 glibc 正常**
⇒ **凡是靠 `pg_trgm` 的東西,本機的紅與綠都沒有判別力。**
⇒ 而**片 A 一個字都不碰 `pg_trgm`**(純 ILIKE 子字串)⇒ **本機測得準**。⚠️ 而線上驗收照樣要跑(§5)。

---

## §4 邊界(每一格一個測試;**期望值從本表推,不從我要寫的碼推**)

| # | 輸入 | 期望 | 為什麼有這一格 |
|---|---|---|---|
| 1 | `''` | 回 `{items:[],total:0}`、**不發查詢** | 既有契約,不得回歸 |
| 2 | `'   '`(只有空白) | 同 1 | `trim()` 後為空 |
| 3 | `'rsv4'`(單詞) | 與今天**逐位元相同**的 filter | 🔴 不得回歸 —— 今天是綠的 |
| 4 | `'油箱貼'`(中文無空白) | 切完仍是 1 個 term ⇒ 同 3 | 🔴 不得回歸 |
| 5 | `'rpm rsv4'` | **2 組** `or()`,AND | 本片主症狀 |
| 6 | `'rsv4 rpm'`(詞序顛倒) | 與 5 **同一組結果** | AND 對順序不敏感 |
| 7 | `'rpm  rsv4'`(兩個空格) | 同 5 | `split(/\s+/)` |
| 8 | `'rpm　rsv4'`(全形 U+3000) | 同 5 | 🔴 切詞字元集要含全形 |
| 9 | `'CARK9650'` / `'cark9650'` | 命中同一筆(ILIKE 大小寫不敏感) | 料號 |
| 10 | 很多詞(> 上限) | **截到上限、且回報 truncated**,不靜默 | 見下方 🛑 |
| 11 | `'%'` `'_'` `'\'` | 仍被轉義(既有行為) | 不得回歸 |
| 12 | 亂碼 | 0 | 負對照:防「全部都回一堆」 |

🛑 **第 10 格是我加的,不在交辦單裡**:每多一個詞就多一組 `or()` ⇒ **URL 會長**,
而 PostgREST 走 GET ⇒ URL 過長會 **HTTP 414 或被 proxy 砍**,而**那個失敗長得像「搜不到」**。
⇒ 提案 **上限 8 個詞**,超過的**丟掉並回 `truncated: true`**,由 UI 說一句
(形狀抄 `#347-fuzzy` 的「命中超上限只回前 N 筆並 `truncated=true` —— **靜默截斷會讓人以為就這幾筆**」)。
⚠️ **8 這個數字我沒有量過** —— 標**未確認**,要 Sean 或主視窗給,或我實測 URL 長度上限再填。

---

## §5 驗收(**線上跑**,Sean 的原話是及格線:「只要做到極度方便客人搜尋」)
```
rsv4 / 油箱貼 / rpm                  ⇒ 非 0(今天已綠, 不得回歸)
rpm rsv4 / rsv4 油箱貼               ⇒ 非 0   ← 今天 0
gilles rsv4 / carbon rsv4            ⇒ 非 0   ← 今天 0
CARK9650 / cark9650                  ⇒ 非 0 且**同一組結果**
rsv4 rpm(詞序顛倒)                  ⇒ 與 rpm rsv4 同一組
rpm  rsv4(多空格)/ rpm　rsv4(全形) ⇒ 同上
現造亂碼                              ⇒ 0     ← 負對照
```
⚠️ **`09R-1234` vs `09r1234`(去連字號)這一格片 A 做不到** —— 那要**兩側都正規化**,
而資料庫那側的正規化是 DB 運算式 ⇒ **片 B**。⇒ **不要把它寫進片 A 的驗收然後宣告失敗。**

---

## §6 鐵則判定
- **鐵則 8:是** ⇒ 本檔就是那份 plan,**等批**。動的檔預估 3 支(helper / adapter / 新測試檔)。
- **鐵則 12⑥:是**(`packages/` 行為改動)⇒ commit 前跑 codex 對抗審查。**12③ 不命中**(片 A 零 DB 改動)。
- **鐵則 11:** 動 `.ts` ⇒ 三綠加 build;測試跑「測到我動的那個東西的檔」+ 連跑兩發比四個數。
- **L1/L2/L3:** L1(搜尋欄位是工程設定,不是內容)。**片型 = 標準片**(動 `packages/` 共用檔)。

---

## §7 三份外部意見的處置(主視窗-87 轉來 Gemini + Codex;**我逐格自己量過再寫**)

### 7-a 🔴 Codex 報的「第三個 bug」:sanitize 會把 `.` `,` `(` `)` `"` 換成空格 ⇒ 可能改壞料號
**逐字**:「你目前甚至會移除句點、括號等字元,可能改壞合法料號」。

✅ **我去撈了真料號來看(線上 8 筆,不是推論)**:
```
BO-03 · CARK9650 · DUC-45-BK · PR333-PR333B · KTARAP112B2
PED-GP EVO MON SX RS660 · PRN016060-016570 · BUNKAW018EB
量法:對 shop.pcmmotorsports.com 逐支抓 /products/<slug> 的 HTML, 取主標上方「品牌 · 料號」那一格
分母:8 筆, 全部來自 /api/search?q=a 的第一頁 ⇒ **不是全站抽樣**
```
🎯 **含 `.` 的:0/8。含 `-` 的:5/8(而 `-` 本來就不在被剝的字元集裡)。**
⛔ ~~「Codex 那一格在我這個分母上沒有實例」~~ —— **原句留著,而它已經被更大的分母取代:**

### 🔴 2026-09-03 02:0x 主視窗-87 對**正式庫唯讀**跑了那一發 ⇒ **Codex 是對的,而量級是 0.2%**
```
SELECT count(*) FROM products WHERE external_id ~ '[,()".]'   ⇒ 49
🟢 正對照 全站有 external_id 的                                ⇒ 22,804   ⇒ 尺會動、不是恆 0
🟢 正對照 含連字號的                                           ⇒ 9,308    ⇒ `-` 不在被剝的字元集 ⇒ 這 9,308 支不受影響
```
📌 **⇒ 我那 8 筆抽樣裡 0 命中是【抽樣運氣】,不是我量錯** —— 49/22,804 = **0.2%**,
抽 8 筆抽不到它的機率約 98%。⇒ 🛑 **「我的樣本裡沒有」與「不存在」差了一個分母,而那個差在這裡剛好是 49 支商品。**
🛑 **射程(主視窗自標)**:這只數了 `products.external_id`,**沒數 `product_variants.variant_sku`**(另一張表,未查)。

✅ **而這 49 支現在【搜得到】** —— 因為修法是「先 sanitize 再切」:
`AP.123` ⇒ `AP 123` ⇒ `['AP','123']` ⇒ AND ⇒ 命中。
⚠️ **代價明寫**:它們是**用兩個碎片 AND** 命中的,不是**整串完全命中** ⇒ 會比精確比對**寬**
(`AP.123` 也會撈到 external_id 同時含 `AP` 與 `123` 的別支)⇒ **完全命中要排在最前面 = 片 B 的排序。**

🟢 **而有一格比上面兩個都重要 —— 修病① 會【順手吃掉】病③ 的大部分**:
```
料號 AP.123, 客人打 AP.123
今天: sanitize ⇒ "AP 123" ⇒ 一個連續 pattern %AP 123% ⇒ "AP.123" 不含它 ⇒ 0
片A: sanitize ⇒ "AP 123" ⇒ 切成 ["AP","123"] ⇒ (…ilike.%AP%) AND (…ilike.%123%)
     而 "AP.123" **兩個都含** ⇒ 命中
```
📌 **⇒ 因為兩個碎片仍然是原字串的子字串。** ⇒ 病③ 在**子字串比對**這一層被病① 的修法吸收掉;
🛑 **它【不會】被吸收的地方是片 B 的「完全命中」那一階**(`AP 123` ≠ `AP.123`)⇒ 記進片 B,不進片 A。

### 7-b 🔴 **`PED-GP EVO MON SX RS660` —— 料號本身含空白**(8 筆裡 1 筆)
⇒ **這一筆是切詞設計的關鍵測資,而它是量到的不是想出來的。**
片 A 的 AND 形狀對它**仍然成立**(五個碎片都是該 `external_id` 的子字串 ⇒ 五格全中)。
⇒ ✅ 進 §4 邊界表第 13 格:輸入整串 `PED-GP EVO MON SX RS660` ⇒ **必須命中那一筆**。

### 7-c ✅ Codex ②「排序要有唯一欄位當 tie-breaker,否則分頁重複或漏商品」
**這一格今天【已經做掉了】** —— `SupabaseProductAdapter` 的 `searchByKeyword` 逐字
`.order('id', { ascending: true })`,而它上方的註解整段就在講這件事
(「`.order('id')` 不是排版,是**分頁正確性的前提**」)。
⇒ 📌 **與 `docs/patterns/pagination-loop-review.md` 第五條「排序帶唯一鍵」同一條** ⇒ **不必再做,但片 B 改排序時不得弄丟它。**

### 7-d 🛑 Codex ③ 安全:**這一條是硬約束,不是建議**
逐字:「搜尋投影漏掉 `is_listed/delisted/RLS` 條件,讓下架商品或敏感價格被搜尋 API 洩漏」。
⇒ **今天這條路查的是 `products_public` view,而它【物理上】沒有 `price_store` / 經銷價那些欄**
(§2 那張欄位表就是分母:20 欄裡沒有任何 tier 價)⇒ **那是一道實體隔離,不是一個 WHERE。**
🔴🔴 **⇒ 片 A 的硬約束:`.from('products_public')` 一個字都不准動。**
   加欄位只准加**那張 view 上已經有的欄**(`external_id` 在)。
🛑 **⇒ 而片 B 若為了效能改成新投影表 / materialized view ⇒ 那道實體隔離就沒了**
   ⇒ **命中 PCM Server 端鐵則(經銷價絕不傳到一般會員瀏覽器)+ 鐵則 12②(權限)**
   ⇒ **片 B 的 codex 對抗審查不可降級**,而片 A 因為不動投影,**這一格是綠的**。

### 7-e ⚠️ 中文斷詞:Gemini 與 Codex **給了相反的答案**,我不選
```
Gemini:不要用 FTS, 用 pg_trgm(Supabase 沒有好用的中文斷詞)
Codex :simple config 的 FTS + pg_trgm fallback + 人工同義詞表
```
⇒ 照紀律:**兩把尺不一致 ⇒ 兩把都不信,去開檔看。** 開檔的方法 Codex 自己給了:
對**正式站**跑 `SELECT * FROM ts_debug('simple', 'rsv4 油箱貼');` 看它實際切出什麼 token。
🛑 **不可在本機跑** —— `pg_trgm` / 斷詞對中文在 macOS BSD libc 與正式站 glibc 行為不同。
⇒ **我沒有正式庫 access ⇒ 跑不了 ⇒ 這一題留在片 B,而選項由那一發的結果決定,不由我或任何 AI 決定。**
🟢 **而片 A 不受這一題影響**(純 ILIKE 子字串,不碰斷詞也不碰 trigram)。

### 7-f 🟡 Codex ① 排序分級(100 SKU 完全命中 / 90 主碼 / … / 20 OR fallback)
**我同意方向**(分級優於加總:加總會讓「很熱門但只在描述提到」淹掉「料號完全命中」)。
⇒ **而它整段屬於片 B** —— 片 A 今天**沒有相關性排序**(`.order('id')` 是穩定序不是相關序),
而**片 A 也不引入排序** ⇒ 📌 **明寫:片 A 之後,搜尋結果仍然不是按相關性排的。**
⚠️ **不要把片 A 交件成「搜尋做好了」** —— 它修的是「找不到」,不是「排得好」。

---

## §8 我沒有 access、要別人跑的兩發唯讀 SQL(**跟著這份 plan 一起端**)
```sql
-- ① 關掉 7-a:真的有料號含被剝掉的字元嗎
SELECT count(*) AS 含符號的料號數 FROM public.products WHERE external_id ~ '[,()."]';
-- 🟢 正對照(同一把尺要印得出非 0):
SELECT count(*) FROM public.products WHERE external_id ~ '[-]';

-- ② 關掉 7-e:simple config 對中文實際切出什麼
SELECT * FROM ts_debug('simple', 'rsv4 油箱貼');
```
⚠️ **這兩發都【不擋片 A】** —— 片 A 的兩個修法都不依賴它們的答案。它們擋的是片 B。

---

## §9 🔴 codex 對抗審查(2026-09-03,鐵則 12⑥)—— **8 must-fix,而【4 條是真的】,其中 1 條推翻我自己寫在 §7-a 的話**

`codex exec -s read-only`,唯讀、不修。逐條開檔/實跑核過再處置,**不照單全收也不照單否決**。

| # | codex 說 | 我核的結果 | 處置 |
|---|---|---|---|
| MF1 | 只打 `U+200B` ⇒ `trim()` 清不掉、切完零詞 ⇒ **送出一句沒有條件的查詢** | 🔴 **真的**。node 實測 `'\u200B'.trim()` 仍是 `'\u200B'`(Unicode White_Space 不含它) | 加 fail-closed:零詞 ⇒ `{items:[],total:0}`,**一句都不送** |
| MF2 | **先切詞後 sanitize** ⇒ `AP.123` 仍是一個詞、變成 `%AP 123%` | 🔴 **真的,而且它推翻我 §7-a 那句話** | **改成先 sanitize 再切** |
| MF3 | 第 9 詞起**靜默**丟掉,沒有 truncated 訊號 | 🔴 真的(我自己 §4 第 10 格寫「不靜默」而實作是靜默的) | 加 `console.warn`(形狀對齊同檔 `fetchAllPaginated`);畫面上讓客人看到 = **片 B** |
| MF4 | 只打 `.` / `,` / `()` ⇒ sanitize 換成空白 ⇒ `% %` 撈一堆 | 🔴 真的 | 被 MF2 的順序調整 + MF1 的 fail-closed **一起解掉** |
| MF5 | 8×4 個前置萬用字元 ILIKE,無索引可用,沒有 EXPLAIN | 🟡 **成立而不是本片能關的** | 見下方 |
| MF6 | 空輸入測試只記 `or()`、沒記有沒有真的送查詢 ⇒ MF1 那個世界**照樣全綠** | 🔴 真的 | mock 加記 `ranged` / `froms`;**判別點改成 `ranged`** |
| MF7 | 上限測試只斷言「八次」⇒ 留後八個 / 任選八個都會過 | 🔴 真的 | 釘住是**前**八個:`w0…w7` 在、`w8` 與 `w19` 不在 |
| MF8 | 整組測試沒有 `%` `_` `\` 案例 ⇒ 刪掉 sanitize 仍全綠 | 🔴 真的 | 加 `50%` 那一格,**而且斷言「只轉一次」** |
| nit | `PED-GP…` 那格只驗頭尾,中間三個改錯字仍過 | 🔴 真的 | 五個詞逐個釘 |
| nit | mock 只證 `.or()` 呼叫兩次,不證 PostgREST 真的取交集 | ✅ 成立,**而我不為它建一座 PostgREST** | 交集的證據是 repo 自己的片0 實測(`b4865c29`),已寫在碼的註解裡 |
| nit | 註解說 JS `\s` 不含 `U+3000` | 🔴 **我寫錯了**。node 實測 `/\s/.test('\u3000')` ⇒ **true** | 改成正確理由:`\s` **不含 `U+200B` / `U+FEFF`** ⇒ 仍要顯式列舉 |

### 🔴🔴 §7-a 訂正(**我自己寫的話,錯了,原句留著加刪除線**)
⛔ ~~「修病① 會順手吃掉病③ 的大部分」~~ —— **那句話【只在 sanitize 跑在切詞之前】才成立**,
而**我第一版的實作是反過來寫的** ⇒ 在我自己交出去的那一版裡,**那句話是假的**。
✅ 現在成立了,而它成立的原因是**我改了順序**,不是原本就對:
```
先切後 sanitize(我的第一版):AP.123 ⇒ ['AP.123'] ⇒ %AP 123% ⇒ 仍要同欄連續 ⇒ 找不到
先 sanitize 後切(現在)    :AP.123 ⇒ 'AP 123' ⇒ ['AP','123'] ⇒ AND ⇒ 命中
```
📌 **⇒ 一句關於行為的宣稱,它的真假住在【兩行程式的順序】裡,而順序在 diff 上沒有形狀。**
⇒ 那個順序現在有一格測試釘著(`AP.123` ⇒ 2 詞,且**不准**出現 `%AP 123%`),而**突變實測它會紅**。

### ⚠️ MF5(效能)—— **本片不關,而它要跟著這一片走**
`.or()` 疊 8 道 × 4 欄 ⇒ 最多 32 個前置萬用字元 `ILIKE` 的 AND。
🔴 **前置 `%` 用不到 B-tree** ⇒ 這條路本來就是全表掃(修之前 1×3,現在最多 8×4)。
🛑 **我沒有量過**:沒有 `EXPLAIN`、沒有線上延遲數字 ⇒ **標未確認,不要寫成「效能沒問題」。**
✅ **交件後要做的一發**:線上打 `rpm rsv4` 與一個 8 詞查詢,**記回應時間**;明顯變慢 ⇒ 片 B 的 GIN 索引**優先於**排序。

### ✅ 突變驗證(**三發,每一發都要它紅在【該紅的那一格】**)
```
突變1 拿掉 fail-closed              ⇒ 1 紅:零詞那一格           🟢 殺掉
突變2 切詞改回 sanitize 之前         ⇒ 3 紅:零詞 / AP.123 / 轉義  🟢 殺掉
突變3 slice(0,N) 改成 slice(-N)     ⇒ 1 紅:詞數上限那一格        🟢 殺掉
還原以 shasum 逐檔比對備份 ⇒ 兩支都相同(不是「我跑了 cp」)
```
