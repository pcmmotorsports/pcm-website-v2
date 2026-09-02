# 顧客站搜尋 · 第二刀:把【品牌名】加進搜尋範圍 · slice plan(線 `-mail`,2026-09-03)

> **狀態:等主視窗-87 批(鐵則 8)。批准前不動碼。**
> **這份 plan 什麼時候會【變成假的】**:
> ① 有人改了 `PRODUCT_SELECT_DETAIL` 的 embed(`brands(...)` 被拿掉)⇒ §2 的地基就沒了;
> ② 正式站 PostgREST 版本換掉 ⇒ §3 那個「能不能在 `or()` 裡引用 embed 欄」的答案要重量;
> ③ 有人動了 `products_public` 的欄位集合 ⇒ §5 的權限論述要重看。

---

## §1 為什麼是這一刀,而不是相關性排序

Sean 線上撞到的三發**全是兩個詞**,而其中兩發(`rpm rsv4` / `gilles rsv4`)今天仍然 **0 件**。
🔴 **而 0 的原因不在片 A 的碼裡** —— 主視窗-87 對正式庫唯讀查證:
```
title/subtitle/description/external_id 四欄
  含 rsv4  346 · 含 rpm  149 · **兩者交集 0** · 全站 22,804
```
⇒ **`rpm` 是品牌名、`rsv4` 是車款名,而【兩者都不在被搜的四欄裡】。**

✅ **而「加品牌就會有交集」已經被證過了**(主視窗-87,2026-09-03 03:0x,正式庫唯讀):
```sql
FROM products p LEFT JOIN brands b ON b.id = p.brand_id
  品牌含 rpm      1,421
  四欄含 rsv4       346
  🎯 交集            41     ← 非空
  🔵 對照:不 join 品牌時的交集 = 0
```
🛑 **射程(主視窗自標,照抄不改寫)**:這一發**只證了 `rpm`+`rsv4` 這一組**;
**不證明所有品牌+車款組合都有交集**,也**沒有碰適配車款那張表**。

⇒ 📌 **所以這一刀解的是「找不找得到」,而排序解的是「排得好」** —— Sean 撞到的是前者。

---

## §2 🟢 地基比預期好:**`brands` 這張表【已經 join 進來了】**

`SupabaseProductAdapter` 的 `PRODUCT_SELECT_DETAIL` 逐字含:
```
brands(id, name, slug, premium_extra_pct)
```
⇒ **搜尋那條路今天就已經把品牌 embed 進來了** —— 缺的**不是 join,是【把 brand 的名字放進比對條件】**。

🔵 **而一格順帶量到的,不是本片造成的,只回報**:
`premium_extra_pct`(品牌層加價%)在**這個 select 裡被撈出來**。
✅ **而它沒有到客人的瀏覽器** —— 線上實測 `/api/search` 回傳的每一筆只有
`slug / brand / name / price / image` 五個鍵(mapper 有收斂)。
🛑 **⇒ 今天沒有洩漏,而那道防線是【mapper】不是【查詢】** ⇒ 任何把回傳放寬的改動要重看這一格。

---

## §3 🔴 做法有兩條路,而**選哪一條取決於一個【我還沒量】的事實**

### 甲(便宜):PostgREST 在 `.or()` 裡直接引用 embed 欄
形狀會是:每個詞一組 `or(title.ilike.*,…,external_id.ilike.*,brands.name.ilike.*)`,
配 `brands!inner(...)` 讓它變成過濾父列的 inner join。
· ✅ **零 migration、零 RPC、不用等任何人貼 SQL**(而「等 Sean 貼」今晚量到是真實瓶頸)
· ✅ 片 A 的形狀原封不動,只是欄位清單多一個
· ❓ **而它成不成立,我不知道** —— **PostgREST 能不能在 top-level `or()` 裡引用 embed 資源的欄位,
  我沒有量過**,而**本 repo 對這一族有明確立場:不要憑推論改。**

🔴 **repo 自己的先例逐字**(`SupabaseOrderAdapter.ts` 那兩處):
「片0 **實測過的是**『兩個 `.or()` 疊起來 = AND、各自括號保住』…**沒有測過 `in.(…)` 寫在 `or=(…)` 的括號【裡面】**」
以及「巢狀 `and()` 同樣沒被片0 測過。**所以量了,沒有憑推論改**(PostgREST 14.16)」。
⇒ 📌 **同一個形狀的問題,這個 repo 過去兩次都是【去量】,不是去推。** 我照做。

### 乙(貴):新寫一支 RPC(照 `#347-fuzzy` 的形狀)
· ✅ 表達力完整:**UNION 不是一大坨 OR**(`#347-fuzzy` 實測 **127.5ms vs 1.4ms**)、
  `UNION` 非 `UNION ALL` + 外層 `SELECT DISTINCT`(**一支商品多處命中只能算一筆,否則靜默少回**)
· ✅ **可以順便解掉效能** —— 見 §4
· ❌ 要 migration ⇒ 鐵則 12③ ⇒ **要 Sean 貼**,而那條佇列今晚量到會塞住
· ❌ 前台是 `anon`,而後台那支是 `SECURITY DEFINER` 給 `service_role` ⇒ **不可照抄權限模型**(見 §5)

### 🔴🔴 量完了(2026-09-03 03:4x,線 `-mail`,拋棄式 PostgREST)⇒ **甲【不成立】,走乙。**

**環境**:`scripts/storefront-probe/up.sh`,自己的埠(`PG 55545 / PostgREST 3959 / dir /tmp/pcm-mail-probe`)
—— 🔵 **另一個窗已經有一座在跑,我沒有碰它**,照 `env.sh` 檔頭寫的並行用法另起一座。
**PostgREST 版本 `postgrest/14.16`**(從回應的 `Server:` 標頭讀的)。

**梯子(每一階都有對照,而 f0 要求的前置在 B/C)**:
```
A 純表 products_public?select=id,title&limit=3                        HTTP 200 · 3 列   ✅ 基線
B embed  select=id,title,brands(name)                                  HTTP 200 · 3 列   ✅ embed 通
C embed!inner + 過濾品牌 brands.name=ilike.*BONAMICI*                  HTTP 200 · 7 列   ✅ 權限也通
🔴 D or=(title.ilike.*zzqprbxx*,brands.name.ilike.*BONAMICI*)          HTTP 400          ⇒ 甲不成立
E 負對照 亂語法 or=(title.zzz.1)                                       HTTP 400          ✅ 尺會叫
F 負對照 or=(…zzqprbxx…,brands.name.ilike.*zzqprbxx*)                  HTTP 400          ⇒ 與 D 同錯
```
🎯 **C 那一階就是 f0 要的前置**:它證明 **embed 過濾與權限都是通的**
⇒ **所以 D 的 400 不是權限問題,是語法問題** —— 兩者原本都會回空/失敗,而 C 把它們分開了。
🔵 **而 F 也 400(我原本預期 200/0)** ⇒ 那更乾淨:**它證明 400 來自【語法】,與匹不匹配無關。**

**D 的錯誤原文(逐字)**:
```json
{"code":"PGRST100",
 "message":"\"failed to parse logic tree ((title.ilike.*zzqprbxx*,brands.name.ilike.*BONAMICI*))\" (line 1, column 34)",
 "details":"unexpected \"a\" expecting \"not\" or operator (eq, gt, ...)"}
```
📌 **column 34 落在 `brands.name` 的那個點上** —— 解析器把 `brands` 讀成欄名、把 `name` 讀成運算子。
⇒ **PostgREST 14.16 的 top-level `or()` 只認【本表的欄】,不認 embed 資源的欄。**

⚠️ **射程,兩格**:
1. **這是 14.16 的行為**,而**正式站的 PostgREST 版本【未查】**(本 repo 的
   `SupabaseOrderAdapter.ts` 也自標過同一格「正式站的 PostgREST 版本未查」)⇒ **版本不同要重量。**
2. 我測的是 **top-level `or()` 引用 embed 欄**;`brands.or=(…)`(對 embed 資源自己下 or)**是另一件事**,
   它過濾的是**被 embed 的那一側**,答不出「詞命中標題**或**品牌」⇒ **不是甲的替代品。**

### ⇒ 結論:**走乙(RPC + migration),而它進「等 Sean 貼」佇列**
🛑 **而甲被否掉之後,有一格要明寫**:乙需要 migration ⇒ **這一刀不可能今天上線**。
⇒ ✅ **而它不擋前置工作**:述詞、測試、驗收表、權限約束都可以先寫完並 commit,
   等 SQL 貼完再接線。**不要因為「要等」就什麼都不做,也不要假裝它能今天上。**

### (原本的建議,留著看得到推論的過程)⇒ ~~先花一發把甲量掉,再選。~~
量法**不必猜也不必等人**:本 repo 有現成的拋棄式 PostgREST(片0 就是這樣量出來的,
`docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md`,commit `b4865c29`,逐字「跑真 PostgREST,非讀文件推」)。
⇒ **成立 ⇒ 走甲(今天就能上,零依賴)· 不成立 ⇒ 走乙,而乙本來就要做(§4)。**
🛑 **⇒ 這一發的價值不是省事,是【它讓「不知道」變成「知道」,而現在有兩個人在猜】。**

---

## §4 🔴 效能:**先前那個「索引優先」的結論【已被推翻】,而推翻它的與再修正它的不是同一個人**

### 4-a 我原本的結論,以及它錯在哪
我 03:1x 量到「兩詞 ~1,660ms」⇒ 判準命中 ⇒ 主視窗-87 採用時補了半句「**⇒ 所以 GIN 索引優先於排序**」。
🔴 **那半句假設了【慢在 DB】,而沒有人驗過那個假設。** 主視窗-87 03:2x 對正式庫跑 `EXPLAIN (ANALYZE, BUFFERS)`:
```
Seq Scan on products · Rows Removed by Filter 22,802 · Buffers shared hit=4,977(零磁碟讀)
🎯 Execution Time 181.973 ms   ← DB 只花 182ms
```
⇒ 📌 **端到端 1,660ms 裡,DB 佔 ~11%。** ⇒ 建 GIN 最好的情況是 182 → 5ms ⇒ **1,660 → 1,483,客人感覺不出來。**
⛔ ~~片 B 的 GIN 索引優先於相關性排序~~ **作廢。** 而**判準本身沒有錯**(那兩個數是真的量到的),
錯的是**從「慢」推到「所以建索引」那一步** —— 那一步沒有來源。

### 4-b 而我接著量了一發,**它把「不在 DB」再切一刀**(線 `-mail`,2026-09-03 03:3x)
🔵 **關鍵是找一個【零 DB】的對照**:空查詢會走我加的短路(`terms.length === 0` ⇒ 直接回),**一句 SQL 都不發**
⇒ 它量到的就是「網路 + Vercel route」的**底**。
```
空查詢(零 DB)      176 / 105 /  89 /  79 ms   ⇒ 底 ≈ 90ms
單詞 rsv4           157 / 130 / 158 / 128 ms   ⇒ 比底多 ~50ms
兩詞 連打四發      1,755 / 1,660 / 1,702 / 1,733 ms
```
🎯 **三格結論,每格都有對照**:
1. **不是冷啟** —— 連打四發**一樣慢**(1,755 → 1,733,沒有第一發特別慢的形狀)。
2. **不是網路、也不是 route 本身** —— 零 DB 的底只有 ~90ms。
3. 🔴 **也【不是】「每次都重新建連線」** —— 若是,**單詞那發也要付同樣的連線成本**,
   而單詞只比底多 **~50ms**。⇒ **成本跟著【那一句查詢】走,不是跟著【每一次請求】走。**

### 4-c ⇒ 而**這樣就對不起來了,那個缺口才是下一步**
```
DB 自己說          182 ms
我量到端到端     1,660 ms
零 DB 的底          90 ms
單詞的 DB 往返      ~50 ms
⇒ 🔴 對不上的缺口 ≈ **1,400 ms**, 而它【只在兩詞那一句上出現】
```
🛑 **最可能的成因(而它是【假設】,我標未確認)**:
**主視窗那發 `EXPLAIN` 量的,很可能不是 PostgREST 實際跑的那一句。** 差異至少三處:
· 那條路帶 **embed**:`brands(...)`、`categories(...)`、`product_variants_public(id)`
· 帶 **`count: 'exact'`**(`/search` 那條要「共 N 件」)
· `.or()` 疊兩道之後 **PostgREST 生成的 SQL 形狀**與手寫的不一定相同
⇒ 📌 **「我量了那句查詢」與「我量了它實際跑的那句」是兩個宣稱。**

✅ **⇒ 下一步不是建索引,也不是猜,是【拿到實際跑的那一句】**:
```
pg_stat_statements 找 total_exec_time 最高且 query 含 products_public 的那幾筆
或 Supabase 的 query log / PostgREST 的 log_level
⇒ 對【那一句】重跑 EXPLAIN (ANALYZE, BUFFERS)
🟢 而先跑一個更便宜的對照:同一條路但 countTotal=false(疊層那條)vs true(/search 那條)
   —— 兩者差很多 ⇒ 成本在 exact count;一樣 ⇒ 不是它
```
⚠️ **我沒有正式庫 access,也改不了線上的 `countTotal`** ⇒ **這兩發要有 access 的人跑。**

### 4-d ⇒ 對【品牌那一刀】的意思
🟢 **品牌那一刀不受影響** —— 它解的是「找不找得到」,而那一格的證據(交集 41)沒有變。
🛑 **而它會讓每個詞多比對一欄** ⇒ **只會更慢**;而**在 §4-c 那個缺口被拆開之前,我們不知道會更慢多少**。
⇒ ✅ **驗收表照樣留一格效能(§6),而它的作用是【偵測】不是【判定成因】** ——
   紅了代表「要去拆那 1,400ms」,**不代表「要建索引」**。

---

## §5 🛑 權限:**這一刀的硬約束,而它比前一刀多一條**

① 🔴 **不得繞過 `products_public`** —— 經銷價的物理防線在那張 view(它 20 欄裡沒有任何 tier 價)。
   ⇒ **`.from('products_public')` 一個字不准動。**
② 🔴 **而這一刀多碰一張表:`brands`。** ⇒ 動手前要答兩格,**而我答不出來、要有 DB access 的人跑**:
```sql
-- ⓐ anon 對 brands 有沒有 SELECT
SELECT has_table_privilege('anon', 'public.brands', 'SELECT');
-- ⓑ brands 上有沒有敏感欄(逐欄看,不要只看名字)
SELECT column_name, data_type FROM information_schema.columns
 WHERE table_schema='public' AND table_name='brands' ORDER BY ordinal_position;
-- 🟢 正對照(這把尺要印得出 true):
SELECT has_table_privilege('anon', 'public.products_public', 'SELECT');
```
🔵 **而我已經知道一格**:`premium_extra_pct`(品牌加價%)**在那張表上**,而它今天被 select 撈出來、
被 mapper 擋在瀏覽器之外(§2 實測)。⇒ **ⓑ 的答案至少含這一欄,而它是【定價相關】** ⇒ 要當敏感欄看待。
🛑 **⇒ 若 anon 對 `brands` 是 table-level SELECT** ⇒ 客人拿自己的 key 直接打 PostgREST 就讀得到**每一欄**,
   **應用層的 select 字串不是那把鎖** —— 這正是本 repo 記過的形狀(`shipments` 那次逐字同款)。
   ⇒ **那不是本片造成的,而本片會【第一次把 brands 放進一條客人打得到的查詢路徑】** ⇒ 要一起回報。
③ 鐵則 12② 命中(權限)⇒ **codex 對抗審查不降級。** 鐵則 8 命中 ⇒ 本檔就是 plan,等批。

### 🔴🔴 5-a 授權查證結果(主視窗-87 2026-09-03 正式庫唯讀,原始輸出他整段回貼)
```
anon_讀得到_brands = t     正對照 products_public = t     負對照 orders = f
⇒ 三格都照預期 ⇒ 那個 t 有判別力, 不是恆真

brands 逐欄:id · name · slug · description · logo_url · created_at · updated_at · premium_extra_pct(integer)

欄級授權查詢 ⇒ 0 列
```
🛑 **0 列那一格【標未確認,不讀成安全】** —— `information_schema` 對零權限帳號會回 0(本 repo 記過)
⇒ **那可能是查的人看不到,不是「沒有欄級授權」。**
🔵 **唯一站得住的讀法**:`has_table_privilege` 回 `t` 是 **table-level** ⇒ **保守讀法:`anon` 讀得到全部 8 欄,含 `premium_extra_pct`。**

### 🔴🔴 5-b ⇒ 硬約束升成兩條(主視窗-87 收緊,我同意並寫成可驗收的形狀)
```
① 不動 mapper 的投影
② 不得在 select / or() 裡【新增】任何 brands 欄位到【回傳路徑】上
   —— brands.name 只用在【比對條件】, 不放進回傳
```
✅ **② 是可驗收的,而判別句是機械的**:改完之後線上 `/api/search` 每一筆的 `Object.keys()`
**必須逐字仍是** `slug / brand / name / price / image` —— **多一個都不行**。改前改後各打一發比對。
📌 **理由**:`premium_extra_pct` 是**經銷/加價資訊**,而它在 DB 那一層對 `anon` 是**開著的**
⇒ **今天唯一擋住它的就是 mapper** ⇒ 🛑 **那不是「深層防護」,那是【最後一道】。**

---

## §6 驗收(**線上跑**,判準先寫)
```
rpm rsv4 / gilles rsv4 / carbon rsv4    ⇒ 非 0    ← 今天 0, 這一刀的主症狀
rsv4 / 油箱貼 / rpm / LIGHTECH 拉桿      ⇒ 不得回歸(今天分別 8/8/8/8)
CARK9650 / PED-GP EVO MON SX RS660      ⇒ 不得回歸(今天 1/1)
現造亂碼                                 ⇒ 0      ← 負對照
詞序顛倒 rsv4 rpm                        ⇒ 與 rpm rsv4 同一組
🔴 效能:兩詞中位數                        ⇒ 判準同 §4;比 1,660ms 明顯更慢 ⇒ 走乙 + GIN
```
⚠️ **一格先寫下來免得事後解釋**:`rpm rsv4` 的**期望值是 41 那個數量級**,而**不是 41 本身** ——
主視窗那發算的是「品牌含 rpm **且** 四欄含 rsv4」,而**我的述詞是「每個詞在【五欄任一】命中」**
⇒ **兩個集合不相同**(我的更寬:`rpm` 也可以命中在標題)。⇒ **對不上 41 不代表錯,要開檔看。**

---

## §7 適配車款(第三刀)—— **本片不做,而理由是可執行的**
主視窗建議先只做品牌,我同意,而理由要寫成判準不是感覺:
· 品牌那一半**已證非空**(41);車款那一半**未證** ⇒ 照同一道閘:**證不出交集就不做**。
· 綁在一起的話,**車款那半卡住,品牌那半也上不了** —— 而品牌那半已經能解掉 Sean 撞到的那一個真實案例。
⇒ ✅ **要開第三刀之前,先請有 DB access 的人跑同款的一發**(把 `b.name` 換成適配車款那張表的欄位),
   **非空才排。**
