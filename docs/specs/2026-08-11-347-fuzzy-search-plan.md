# #347-fuzzy · 訂單搜尋容錯化 slice plan(B 窗八代起草,2026-08-11 夜;**九代依 §8 拍板改寫 2026-08-12**)

> **狀態:§8 四題 Sean 已批(2026-08-11 深夜:Q1=A / Q2=A / Q3=A / **Q4=B**),本版依拍板改寫;
> **改寫後尚未過關卡1 —— 不沿用舊輪**(七項改動中三項〔§7.1 部署停點、§5 新增三格、§6 回滾列〕
> 動到風險與驗收面,非排版)。鐵則 8:動 schema/擴充/RPC ⇒ plan 先過批;鐵則 12③④:DB 結構 +
> 平台設定 ⇒ 關卡1 codex 必跑。
> 上游:Sean 拍 Q-347=A(要容錯搜尋);缺口盤點=B-459-STOP(本檔 §1 只引結論,不重述)
> **本版改動來源**:`B-471-A`(四題拍板)/ `B-472-NOTE`(七項清單)/ `B-473-A`(A6 不跟進、等級取高)/
> `B-474-NOTE` + `B-475-A`(gate 三層寫法、兩發實跑要求)

---

## 0. 片型、授權、邊界

- **片組 A = 高風險片**(鐵則 12③ DB 結構 + ④ 平台設定〔`CREATE EXTENSION`〕)⇒ plan 過關卡1 codex、diff 過關卡2。
- ~~**片組 B = 標準片**(拆 UI 與 adapter 分支,零 DB)。~~ **Q4=B 後改判(`B-473-A` §2 裁「等級取高」)**:
  B 與 A 同批 ⇒ **整批以片組 A 的「高風險片」為準**,對抗審查不因為「B 那半只是拆 UI」而降級。
- ⚠️ **鐵則 4(15-45 分鐘可中斷)**:合併後體積跨 DB + UI + adapter + 測試,單顆做不完 ⇒
  **切兩顆 commit、同一批一起收**(不是拆成兩片排程 —— 拆片會踩 §7.1 的部署真空)。
- **不 apply、不 push**:migration 留 pending 等 Sean 批(夜跑規則④)。
- 本片**不動**:100 筆上限、日期預設窗、POST-only + httpOnly cookie 那條 PII 紅線(都是 #347-2b/-3a/-3c 的既有合約)。

## 1. 現況(結論引 B-459;座標為本窗實查)

- `admin_search_orders`(`supabase/migrations/20260810120000_…:138-180`)**八維度已全部比對**,全部是
  `strpos(lower(欄), needle) > 0` 的**字面子字串**。正式站已 apply(`schema_migrations` 實查)。
- **零全文檢索/模糊基礎設施**:掃 `supabase/migrations/*.sql` 的
  `pg_trgm|tsvector|to_tsvector|gin\s*\(|pgroonga|CREATE EXTENSION`(不分大小寫)⇒ 可執行 SQL **零命中**。
- 同一維度**兩套規則**:供應商單號在單欄路徑走 `supplier_order_no_upper`(`20260807130000:81-82` 的
  `GENERATED ALWAYS AS upper(...) STORED` + 專屬索引 `:88-90`),在大框 RPC 走原文 strpos。
- 量級(正式站唯讀實查 2026-08-11):`orders` **12** / `order_items` **15** /
  `order_item_procurement` **2** / `customers` **10** / `product_variants` 51,492。

## 2. 平台面查證(官方文件實查,非憑記憶)

| 事實 | 出處 |
|---|---|
| Supabase 開擴充的官方語法 = `create extension <name> with schema extensions;` | Supabase Docs「Postgres Extensions」(本窗 WebFetch 實讀,逐字引「create extension pgtap with schema extensions」) |
| 擴充預設裝在 **`extensions` schema**,該 schema 對 public 可讀;官方明文**不建議**在 `extensions` schema 內另建物件 | 同上(逐字「To avoid namespace pollution, we do not recommend creating other entities in the extensions schema」) |
| `pg_trgm` 在**本專案正式站可用但未安裝**(`default_version` 1.6、`installed_version` = null) | 正式站 `list_extensions` 實查 |
| 本專案既有已安裝擴充**都在 `extensions` schema**(pgcrypto / pg_net / uuid-ossp / pg_stat_statements),`pg_cron` 例外在 `pg_catalog` | 同上 |

🔴 **由此推出的硬約束(這條最容易寫錯)**:`admin_search_orders` 是
`SECURITY DEFINER` + **`SET search_path = ''`**(`20260810120000:78`)⇒ 函式體內**任何** pg_trgm 的
函式與運算子都必須**逐一 schema 限定**:`extensions.similarity(a, b)`、
`a OPERATOR(extensions.%) b`;索引 opclass 同理寫 `extensions.gin_trgm_ops`。
少寫一處 = apply 當下就紅(不是上線後才發現),這是本片最可預期的第一個坑。

## 3. 片組 A 設計

> 🔴 **§4 那張表是唯一的規範來源**。本節只寫「為什麼」。
> 🔴 **關卡1 兩輪(codex,共 23 條 must-fix)之後的結構性結論**:這片有一半的關鍵問題
> **plan 層答不了、只能量** —— 規劃器會不會真的用那些 GIN 索引、`<%` 在這個
> 跨表 OR + correlated EXISTS + 排序 + LIMIT 的形狀下走不走得到索引。
> ⇒ 因此 **A0 先做量測探針(spike),用它的結果決定 A3 的最終形狀**,而不是在 plan 裡假裝已經知道。

### A0 量測探針(**第一步,先做完才寫 migration**)
在拋棄式庫(`d1t2-rehearsal` + 專屬埠)塞 ≥5 萬列有真實分布的假資料、`ANALYZE`,然後:
1. 把 RPC **內層那段查詢逐字抽出來**單獨 `EXPLAIN (ANALYZE, FORMAT JSON)`
   —— 🔴 **不能 EXPLAIN 函式呼叫**:plpgsql 內的 SQL 不會出現在外層計畫裡(關卡1 R2 must-fix)。
2. 斷言 JSON plan 裡出現本片索引名;**禁止**用 `enable_seqscan=off` 造出成功。
3. needle 用**稀有且 ≥3 個 trigram** 的字串(太短或太常見會讓結果恆假)。
4. 產出=一張「哪幾條 predicate 的索引真的走得到」的表。
   ⇒ **走不到的那幾條**:要嘛把該 predicate 改寫成 UNION/semi-join 形狀,要嘛**記為缺口照實寫**
   (不假裝索引有用)。這個決定由探針結果決定,不由本 plan 決定。

### A0 結果(**2026-08-11 夜實跑,拋棄式庫 PORT=54378 / 50,031 orders / 50,072 items / 20,002 customers / 30,000 procurement,已 ANALYZE**)

| 形狀 | 索引有沒有被用到 | 實測時間 |
|---|---|---|
| A 單條 `display_id` LIKE(識別碼) | ✅ `Bitmap Index Scan on spike_o_display` | **1.4 ms** |
| B 單條品名 LIKE(文字) | ✅ `spike_oi_title` | **0.3 ms** |
| C 單條品名 **`<%` 詞相似度** | ✅ `spike_oi_title` | **1.8 ms** |
| D **現行 RPC 形狀**(跨表 OR + correlated EXISTS + 排序 + LIMIT) | ⚠️ **`order_items` 走 Seq Scan**;customers/procurement 側有走 index | **127.5 ms** |
| E **UNION 改寫**(同一 needle、三條 predicate) | ✅ 三支索引全走到 | **1.4 ms** |
| D2 只留兩條 OR(品名 EXISTS + 地址) | ✅ 走到 `spike_oi_title` | 28.6 ms |
| E2 同 needle 的 UNION | ✅ | 7.3 ms |
| F 規格(spec)走 helper 函式索引 | ✅ `spike_oi_spec` | 192.9 ms(**選擇率造成**:我塞的 spec 只有 ~24 種值、命中 5,000 列;recheck 成本吃掉索引好處) |

**三個結論(這是 A0 存在的理由,plan 層答不出來)**:
1. **`<%` 走得到 trigram 索引**(C)⇒ 模糊比對不是只能全表掃。
2. 🔴 **現行的「一大坨 OR + EXISTS」形狀,品項側索引拿不到**(D)——分支越多,規劃器越傾向整表掃。
   ⇒ **實作必須改成 UNION/semi-join 形狀**(E),否則索引白建。這條先前只是 codex 的推測,現在有數字。
3. 索引的價值**取決於選擇率**(F):低基數欄位(規格顏色/尺寸)命中太多列時,索引反而不划算
   ⇒ 規格那條的索引**列為可選**,由實作時的資料分布決定(**不預先宣稱它有用**)。

🔴 **A0 順帶抓到兩個 plan 寫錯的字面(都會讓 migration 當場失敗)**:
- **`product_snapshot->'spec'` 是 jsonb 物件、不是字串**(正式站實查:`{"color": "經典-經典黑"}`;
  拋棄式庫的 CHECK `order_items_snapshot_whitelist` 也強制 `jsonb_typeof(spec)='object'`)
  ⇒ `->>'spec'` 拿到的是**整段 JSON 文字**(含 `{`、`"`、鍵名)⇒ 直接比對會用鍵名命中一堆單。
  ⇒ 改用 IMMUTABLE helper `pcm_spec_text(jsonb)`(`string_agg(value,' ')` over `jsonb_each_text`)
  取**值**再比對;索引也建在 helper 上(F 實測索引建得起來也用得到)。
- **`pg_catalog.coalesce(...)` 不存在**(COALESCE 是 SQL 語法不是函式)⇒ 索引建立當場
  `No function matches the given name`。§4 的表達式一律寫**裸 `COALESCE`**(既有 RPC 也是這樣寫的)。

### A1 安裝擴充
`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;`(單獨 migration 第一段)。
驗收 1 fail-closed:裝不上就整片停。

### A2 三類比對(規則本體見 §4)
- **識別碼類**(#1 訂單編號、#7 料號、#11 供應商單號):正規化子字串,**不套模糊**。
- **文字類**(#2 會員姓名、#4 收件人姓名、#6 收件地址、#8 品名、#9 規格、#10 品牌):子字串 **OR** 詞相似度。
- **數字類**(#3 會員電話、#5 收件電話):正規化子字串,**不套模糊**。

🔴 **模糊的運算元方向是固定的**(關卡1 R2 must-fix):`word_similarity(a, b)` 問的是
「a 有多少比例對得上 b 裡的某個詞組」⇒ 必須寫 **`needle OPERATOR(extensions.<%) 目標表達式`**
(needle 在左)。寫反了語意就顛倒(變成「整個地址有多少對得上 needle」),而且**照樣會編譯過**。

🔴 **空 needle / 純標點的語意(關卡1 兩輪都打;R2 指出我第一版折歪了)**:
`()` 不會被 `[-_[:space:]]` 清掉、`-` 與 `___` 在**文字類**正規化後仍非空 ⇒
「搜純標點一律零命中」這個承諾**只對識別碼類與數字類成立**。本片的口徑固定為:
- **每一類各自**檢查自己那份正規化 needle 是否為空;**空 ⇒ 該類整組 predicate 跳過**。
- 文字類不做「純標點就跳過」的特判 —— 資料裡真的可能有 `-`,搜得到才是對的。
- ⇒ 驗收 6 因此拆成兩格:識別碼/數字類搜 `-`/`___` = 零命中;文字類搜 `-` = 只命中真的含 `-` 的列。

🔴 **空白的承諾限縮成 ASCII + 明列的兩個全形字元**(關卡1 R2):C locale 下 `[[:space:]]`
**不保證**涵蓋 U+3000(全形空格)與 NBSP ⇒ 正規化字元類明寫成
`[-_[:space:]\u3000\u00A0]`(欄值與 needle **雙向**都套),驗收各加一格。

### A3 索引:與查詢**逐字相同**的表達式(🔴 A0 已證:**查詢形狀必須改成 UNION**,否則品項側索引拿不到)
GIN trigram 索引建在原欄、而查詢對欄套函式 ⇒ 索引用不到;`strpos()` 與
`similarity(a,b) >= 常數` 本來就不是 trigram 索引支援的形狀。⇒ 三件事一起改:
1. 子字串:`LIKE '%' || <跳脫後 needle> || '%'`(needle 內 `\` `%` `_` 必須跳脫)。
2. 模糊:`OPERATOR(extensions.<%)`,閾值走 **`pg_trgm.word_similarity_threshold`**,
   函式層 `SET` 釘死 **0.4**(起始值;由 A0 探針與驗收 12 的邊界對調整,調整要連驗收一起改)。
   🔴 **不可**寫 `similarity(a,b) >= 閾值` 配 GUC —— 那個 GUC 只作用於運算子。
3. 索引表達式逐字複製 §4 的「完整表達式」欄。

### A4 `product_snapshot ->> 'spec'` 納入比對(#9)

### A4b 🔴 搜尋資料源的 `is_listed` / `hidden_from_store` 語意(2026-08-12 補;來源 `B-481-A` 轉報價單側坑)

報價單側 08-09 回檔(信箱 `QUOTE-2026-08-09-service-other-category.md` 尾段)提醒:
`storefront_catalog_v` 條件=`WHERE p.is_listed AND NOT p.hidden_from_store`
⇒ **料號搜尋若讀那個 view,未上架商品一律搜不到**(且分類留空 → `is_listed` 自動 false、
零告警,就是 733 筆消失的機制)。

**本片現況實查=不受影響,但方向相反的風險是真的**:

- **現行大框(`20260810120000_m4b_347_3a_admin_search_orders_date_range.sql`)讀的全是 base 表**:
  `public.orders` / `public.customers` / `public.order_items` /
  `public.product_variants` → `public.products` → `public.brands`(`:160-179` 品名·品牌·供應商單號那段)/
  `public.order_item_procurement`。
  **全檔 `is_listed` / `hidden_from_store` / `storefront_catalog_v` 命中數 = 0**
  (數法:`grep -c "is_listed\|hidden_from_store\|storefront_catalog_v" supabase/migrations/20260810120000*.sql`)。
- ⇒ 目前**沒有**「未上架商品的訂單搜不到」這個病;本片 UNION 化沿用同樣的 base 表面,也不會引入它。

🔴 **要釘死的語意(兩種面兩種答案,別互抄)**:

| 面 | 該不該看到已下架/隱藏商品 | 理由 |
|---|---|---|
| **後台訂單搜尋(本片)** | **要看到** | 那是**歷史交易**。商品今天下架不代表去年那張單不存在;搜不到=員工查不到自己出過的單 |
| 前台商品目錄(`storefront_catalog_v`) | 不要看到 | 客人只該看到在賣的東西 |

⇒ **本片明文不讀 `storefront_catalog_v`、不加任何上架/隱藏過濾**。
⚠️ 這條的真正風險**不是現在**,是未來有人「順手優化」把搜尋改讀那個 view(它看起來就是「商品的正規來源」)
⇒ 已下架商品的訂單會**靜默**從搜尋結果消失、零告警(與 733 筆同機制)。驗收見 §5 第 19 條。
### A5 品牌時間語意 — **Sean 拍 Q2=A:維持現況(搜「現在的品牌」)+ 畫面標明**
不動建單流程、不碰金流路徑(Q2 的 B 案要凍快照=動建單=另案)。
🔴 **本片要交付的是那句 UI 文案**(原 plan 只寫了語意、沒指定落點):文案字面
**「品牌以現行資料為準」**,落點=**訂單搜尋欄位區**(與搜尋框同一視覺群組,`order-filter-controls.tsx`;
確切行號待實作時 `grep -n` 定,不在此預寫會過期的座標)。驗收見 §5 第 17 條。

### A6 `supplier_order_no_upper` 生成欄本片不改 — **死欄清理另片**
~~(死欄清理併片組 B)~~ **2026-08-12 改判**(`B-473-A` §1):Q4=B 把片組 B 拉進同一批,
若照舊字面,這條「評估死欄」也會被一起拉進來 ⇒ **明確不跟進**。
理由:drop 生成欄 + 索引=**不可逆 schema 動作**(鐵則 12③),與「換搜尋實作」綁同批會把回滾面
從「換回舊 RPC」擴大成「重建欄與索引 + 回填」;死欄清理零急迫、隨時可單獨做。⇒ **另立片,不在本批**。

## 4. 🔴 規範表 + UNION 骨架(唯一來源;實作照抄)

> 條數:現行 10 條 `strpos`(數法 `sed -n '136,181p' supabase/migrations/20260810120000_*.sql | grep -c 'strpos'` = 10)+ 新增 `spec` ⇒ **11**。
> 🔴 **形狀由 A0 的數字定案:UNION,不是一大坨 OR**(OR 形狀下品項側索引拿不到:127.5 ms vs 1.4 ms)。

### 4.1 正規化三巨集(查詢與索引**同一字面**;`COALESCE` 是語法、**不加 `pg_catalog.` 前綴**)

```sql
-- NORM_ID(x):識別碼類。忽略大小寫 + 忽略 - _ 空白(含全形空白 U+3000 與 NBSP)
pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(x,'')), '[-_[:space:]\u3000\u00A0]', '', 'g')
-- NORM_NUM(x):數字類。只留數字
pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(x,'')), '[^0-9]', '', 'g')
-- NORM_TXT(x):文字類。lower + btrim
pg_catalog.lower(pg_catalog.btrim(COALESCE(x,'')))
-- spec 專用(A0 實測:spec 是 jsonb 物件,不是字串)
CREATE FUNCTION public.pcm_spec_text(p jsonb) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$ SELECT COALESCE((SELECT pg_catalog.string_agg(value, ' ') FROM pg_catalog.jsonb_each_text(p)), '') $$;
```

### 4.2 needle 側(函式開頭算一次,三份各自檢查非空)

```sql
v_id_needle  := NORM_ID(p_query);
v_num_needle := NORM_NUM(p_query);
v_txt_needle := NORM_TXT(p_query);
-- LIKE 用的跳脫版(\ % _ 三個字元;跳脫字元固定用反斜線)
v_id_like  := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_id_needle ,'\','\\'),'%','\%'),'_','\_');
v_num_like := …(同形)…;  v_txt_like := …(同形)…;
```
🔴 **空字串就整類跳過**(A0 前已用正式站 SQL 實測:`strpos(x,'')=1`、`x LIKE '%%'`=true ⇒ 不跳過會撈出全部)。

### 4.3 UNION 骨架(11 個分支;每個分支自己帶日期範圍與非空閘)

```sql
WITH hits AS (
  -- #1 訂單編號(識別碼)
  SELECT o.id, o.created_at FROM public.orders o
   WHERE v_id_needle <> '' AND (p_from IS NULL OR o.created_at >= p_from) AND (p_to IS NULL OR o.created_at < p_to)
     AND NORM_ID(o.display_id) LIKE '%' || v_id_like || '%' ESCAPE '\'
  UNION
  -- #2 會員姓名(文字:子字串 OR 詞相似度;🔴 needle 在左)
  SELECT o.id, o.created_at FROM public.orders o
     JOIN public.customers c ON c.user_id = o.customer_user_id
   WHERE v_txt_needle <> '' AND <日期範圍>
     AND (NORM_TXT(c.name) LIKE '%' || v_txt_like || '%' ESCAPE '\'
       OR v_txt_needle OPERATOR(extensions.<%) NORM_TXT(c.name))
  UNION
  -- #3 會員電話(數字,不模糊) / #4 收件人姓名(文字) / #5 收件電話(數字)
  -- #6 收件地址 line(文字) / #7 料號(識別碼) / #8 品名(文字)
  -- #9 規格(文字,走 pcm_spec_text) / #10 品牌(文字,三跳 JOIN) / #11 供應商單號(識別碼)
  --   …同形:JOIN 到該表 → 非空閘 → 日期範圍 → LIKE(+ 文字類再 OR `<%`)
)
SELECT pg_catalog.array_agg(h.id ORDER BY h.created_at DESC, h.id DESC)
  FROM (SELECT DISTINCT id, created_at FROM hits ORDER BY created_at DESC, id DESC LIMIT v_limit + 1) h;
```
- `UNION`(非 `UNION ALL`)去重;最外層多取一筆用來判斷截斷(與現行合約相同)。
- 每個分支都 JOIN 回 `orders` 以套日期範圍 ⇒ 保留 #347-3a 的取樣窗口語意。

### 4.4 逐條規範表(11 條)

| # | 目標表達式(查詢與索引同一字面) | 類別 | 子字串 | `needle <% 目標` | 索引 |
|---|---|---|---|---|---|
| 1 | `NORM_ID(o.display_id)` | 識別碼 | ✅ | ❌ | ✅ |
| 2 | `NORM_TXT(c.name)` | 文字 | ✅ | ✅ | ✅ |
| 3 | `NORM_NUM(c.phone)` | 數字 | ✅ | ❌ | ✅ |
| 4 | `NORM_TXT(o.shipping_address_snapshot ->> 'name')` | 文字 | ✅ | ✅ | ✅ |
| 5 | `NORM_NUM(o.shipping_address_snapshot ->> 'phone')` | 數字 | ✅ | ❌ | ✅ |
| 6 | `NORM_TXT(o.shipping_address_snapshot ->> 'line')` | 文字 | ✅ | ✅ | ✅ |
| 7 | `NORM_ID(oi.variant_sku)` | 識別碼 | ✅ | ❌ | ✅ |
| 8 | `NORM_TXT(oi.product_snapshot ->> 'title')` | 文字 | ✅ | ✅ | ✅ |
| 9 | `NORM_TXT(public.pcm_spec_text(oi.product_snapshot -> 'spec'))`(**新增**) | 文字 | ✅ | ✅ | **可選**(A0-3:低基數時索引不划算) |
| 10 | `NORM_TXT(br.name)` | 文字 | ✅ | ✅ | 可選(brands 是小表,規劃器多半不用) |
| 11 | `NORM_ID(pc.supplier_order_no)` | 識別碼 | ✅ | ❌ | ✅ |

索引一律 `CREATE INDEX … USING gin ((<上表表達式>) extensions.gin_trgm_ops)`。
**模糊六欄**=#2/#4/#6/#8/#9/#10;**禁模糊五欄**=#1/#3/#5/#7/#11 ⇒ 這兩個數字驅動 §5 的格數。

## 5. 驗收條件(逐條可 yes/no;格數由 §4 驅動)

1. `pg_trgm.installed_version` 非 null、schema=`extensions`(apply 後 `list_extensions`)。
2. **schema 限定沒漏**:①拋棄式庫完整 apply ②**實際執行**一次會走到 `<%` 分支的呼叫
   (🔴 plpgsql 內層 SQL 到首次執行才規劃 ⇒ 只 apply 證不到,關卡1 R2)③對 `prosrc` 逐個 pg_trgm 物件名斷言帶 `extensions.` 前綴。
3. **11 條 predicate 各一格正向**(每條只有該欄命中的隔離 fixture)。
4. **模糊六欄各一格**(#2/#4/#6/#8/#9/#10):案例必須是「**LIKE 命不中、只有 `<%` 命得中**」的錯字輸入
   ⇒ 六欄的 `<%` 任一支壞掉都會紅(關卡1 R2:一個案例代表不了六欄)。
5. **禁模糊五欄各一格隔離負測**(#1/#3/#5/#7/#11):差一碼的鄰居單搜不到;fixture 只放那兩張單。
6. **空 needle 兩格**:①識別碼/數字類搜 `-`、`___` ⇒ 零命中 ②文字類搜 `-` ⇒ 只命中真的含 `-` 的那列。
7. **LIKE 萬用字元跳脫**:搜 `%`、`_` ⇒ 零命中(非全部命中)。
8. **全形空白/NBSP 雙向兩格**:欄值含 U+3000、needle 用半形空白(以及反向)⇒ 仍命中(識別碼類)。
9. **突變逐欄隔離**:禁模糊五欄**各**做一次「把該條改成 `<%`」⇒ 對應的第 5 條負測必紅;還原後全綠。
10. **索引可達性**:照 A0 探針的方法逐條 EXPLAIN 內層查詢,產出「N/11 走得到索引」的表並**逐條列名**;
    走不到的照實寫成缺口(**不寫**「查詢變快 N 倍」這種在 12 列上量不到的宣稱)。
11. **PII 通道**:指定可控失敗點 = 函式內對 needle 長度上限那條 `RETURN`(現行 `:103-105`)改成
    `RAISE EXCEPTION` 的突變版;正向斷言 = 授權呼叫下 psql 收到的 ERROR/NOTICE 全文**不含 needle 字面**,
    突變(故意把 needle 塞進 RAISE)⇒ 該格必紅 ⇒ 證明觀察通道真的看得到。
12. **閾值邊界對**:六個模糊欄各給一組「應命中/應不命中」的邊界輸入,釘死 `word_similarity_threshold = 0.4`;
    改閾值必須同批改這 12 個期望值(⇒ 閾值不是可以隨手調的旋鈕)。
13. 三綠 + 全套 vitest Δ=0;harness 專屬埠、跑前 `lsof` 驗空、fail-closed 離場收叢集(照 #416 的 trap 形狀)。
14. 收據面:harness 收編 w7 ⇒ 同片 `record` + `check`;不收編 ⇒ commit body 明寫。

**以下 15-18 為 Q4=B 新增(2026-08-12;`B-472-NOTE` §3-4 + `B-473-A` §4 裁准)** —— 沒有這幾條,
「同批收掉舊欄」會變成**淨失能力而測試全綠**:

15. 🔴 **能力等價性(最重要,兩格)**:拿掉舊欄**之前**,證明新搜尋找得到舊欄找得到的單。
    ①**訂單編號**:同一張單,舊欄輸入 `display_id` 命中 ⇒ 新搜尋輸入同一字串**也命中同一張單**。
    ②**供應商單號**:同一張單,舊的兩段式路徑(`SupabaseOrderAdapter.ts:663-703`)命中 ⇒
    新搜尋輸入同一字串**也命中同一張單**。
    ⚠️ 兩格都要**在同一個 fixture 上跑兩條路徑做對照**,不是各測各的(各測各的證不出「等價」)。
16. **舊欄零殘留**:①兩個 flag 名全樹 grep 零命中(含 `page.tsx` / `order-filter-controls.tsx` /
    `page.test.tsx`)②那兩個 `<form>` 不再渲染 ③`SupabaseOrderAdapter.ts` 的兩段式路徑整段消失。
    數法寫進 commit body,**不寫「應該都清了」**。
17. **A5 那句 UI 文案存在**:畫面上出現「品牌以現行資料為準」(Q2=A 的交付物,不是可選裝飾)。
18. **突變**:把新搜尋的品名/品牌那條 predicate 改壞 ⇒ 第 15 條的等價性格必紅
    (證明那兩格真的在驗新路徑,不是在驗舊路徑殘留)。

19. 🔴 **已下架/隱藏商品的訂單仍搜得到**(A4b;2026-08-12 補):fixture 造一張含
    `is_listed=false`(或 `hidden_from_store=true`)商品的歷史訂單 ⇒ 用該商品的**料號與品名**
    搜尋**都要命中**。
    **突變**:把新 RPC 的商品那幾條分支改成讀 `public.storefront_catalog_v` ⇒ **本格必紅**。
    ⚠️ 這格擋的是**未來的「順手優化」**,不是現況 bug(現況實查零命中,見 A4b)——
    沒有它,那種改動會零告警地把已下架商品的訂單從搜尋結果抹掉。

## 6. 風險與回滾

| 風險 | 處置 |
|---|---|
| 索引根本走不到(跨表 OR + EXISTS + LIMIT 的形狀) | **A0 探針先量**;走不到就改形狀或認缺口,不假裝 |
| `<%` 方向寫反 | §A2 釘死 `needle <% 目標`;驗收 4 的六格會抓到(方向反了那些案例不會命中) |
| `search_path=''` 漏限定 | 驗收 2 的三道(apply + 實跑 `<%` 分支 + prosrc 斷言) |
| 空 needle / 純標點 | §A2 逐類非空閘 + 驗收 6 兩格 |
| 全形空白 | 正規化字元類明列 + 驗收 8 |
| 閾值 | 釘死 0.4 + 驗收 12 的 12 個邊界期望值 |
| **回滾(順序固定)** | ①`DROP INDEX` 逐支列名 ②`CREATE OR REPLACE` 換回現行 RPC ③確認零其他依賴後才 `DROP EXTENSION`。⚠️ `DROP EXTENSION` 預設 RESTRICT **不會**連帶刪索引(會報錯);`CASCADE` 可能刪到別人的 |
| 🔴 **回滾的應用層那半(Q4=B 新增)** | 上面三步只還原 **DB 物件**。Q4=B 之後,舊欄與 adapter 兩段式路徑**在同一批被刪掉** ⇒ 只滾 DB 會得到「新搜尋沒了、舊欄也沒了」=**比事故前更糟的零入口狀態**。⇒ 回滾**必須連應用層一起回**:`git revert` 掉「拿掉舊欄」那顆(兩個 flag + 兩個 `<form>` + adapter 兩段式路徑 + `page.test.tsx` 四處),與 DB 三步**同一次**完成。⇒ **回滾單位=整批,不是 migration** |
| 🔴 **部署真空(Q4=B 新增)** | 應用層先於 migration apply 上線 ⇒ 搜尋功能真空(§7.1)。防護三層見 §7.1 表;**硬條款=刪除那顆與接線那顆同一次 push**(gate 對純刪除 diff 盲,§7.2 已實測 exit 0 證實) |

## 7. 片組 B(終態:收掉兩個專用欄)— **Sean 2026-08-11 拍 Q4=B:與 A 同批收、無過渡期**

~~前提 = A 上線且試用過。~~ **作廢**(Q4=B 推翻;原 Q4 推薦 A=試用一週後再收,Sean 選 B)。
**現前提 = 與片組 A 同一批**。

**動作**:①拿掉 `ADMIN_E10_ORDER_NUMBER_SEARCH` / `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH` 兩個 flag
與對應 UI 欄位(`order-filter-controls.tsx:222` / `:265`)②拿掉 adapter 的供應商兩段式路徑
(`SupabaseOrderAdapter.ts:663-703`)③**測試面**(原 plan 漏列、窄 R2 補):
`apps/admin/src/app/orders/page.test.tsx` **四處**設這兩個 flag(`:70` / `:72` / `:78` / `:138`)
⇒ flag 拿掉後那些格會變孤兒或假綠,**同批刪或改寫**。
④~~評估 `supplier_order_no_upper` 生成欄是否成死欄~~ **不隨本批進來**(主視窗 `B-473-A` §1 裁):
drop 生成欄+索引=不可逆 schema 動作,綁進來會把回滾面從「換回舊 RPC」擴大成「重建欄與索引+回填」;
死欄清理零急迫 ⇒ **另片**(A6 維持「本片不改」)。

### 7.1 🔴 「順序不可倒」在 Q4=B 之下換了形狀(**本片最實的風險**)

原字面「B 先做 = 員工同時失去舊入口與新能力」**沒有消失**,而是從「片的順序」變成
**「同一批內的部署順序」**:若**拿掉舊欄的應用層先於 migration apply 上線**,結果一模一樣 ——
舊欄沒了、新 RPC 還不存在 ⇒ **搜尋功能真空**。同型事故=2026-08-07 A9h(app 層先上線、正式站
`PGRST202`、壞約 8 小時;memory `feedback_app-layer-must-not-ship-before-migration-apply`)。

⚠️ **現況緩衝**:後台尚未正式使用、只有 Sean 測試(memory `project_admin-preprod-planning-posture`)
⇒ 真空的代價目前很低。但語意一次定對,不因為現在沒人用就寫鬆。

**三層防護,分清楚誰擋得到什麼(不可只寫其中一層)**:

| 層 | 擋什麼 | 狀態 |
|---|---|---|
| **① 機制(自動)** | **接線那顆**:新搜尋 RPC 名一旦出現在 `apps/**` / `packages/**` 非測試檔的**新增行**,未 apply 就推不出去(`scripts/deploy-order-gate.sh:166`;比對範圍 `:142` = `git diff $BASE $local_sha` = **這次推的整段累積 diff**,非只看 tip) | 已上崗、免寫 |
| **② 機制的缺口(明寫、不假裝)** | **拿掉舊欄那顆是純刪除 diff ⇒ gate 看不見**:只掃新增行(`:158` `grep '^+'`),`[ -n "$ADDED" ] \|\| continue`(`:161`)⇒ 零 `+` 行直接跳過 | **補法=下面的硬條款** |
| **③ 語意(人)** | apply 綠了才推 | 最後一道、**不是第一道** |

🔴 **硬條款(不是建議)**:**拿掉舊欄那顆與接線那顆必須在同一次 push 內**。
理由=②的缺口只有靠「同一段累積 diff 裡含接線那顆的新增行」才會觸發 gate;拆成兩次 push、
且刪除那顆先推 ⇒ **零守門、零症狀**。

### 7.2 兩發實跑(2026-08-12;拋棄式 worktree + 拋棄式 branch,現場零留痕)

構造:拋棄式 pending migration `29991231000000_gate_probe_disposable.sql`(含
`CREATE OR REPLACE FUNCTION public.gate_probe_fn_zzz`,**絕不 apply、絕不併 dev**),
base=`25bcf709`,用 `bash scripts/deploy-order-gate.sh <<< "refs/heads/dev <sha> refs/heads/dev 25bcf709"`
直餵 stdin(**不真的 push**)。

| 測 | 構造 | 期望 | **實測** |
|---|---|---|---|
| **A 盲區** | 純刪除 `order-filter-controls.tsx` 的舊搜尋欄 JSX + 型別 + 預設值(`git diff --numstat` = **`0 44`** = 零新增、44 刪除),單獨推 | gate **放行**(=缺口為真) | **exit 0 放行** ✅ |
| **B 綁批** | 同一段 diff 內再加一顆「接線」commit(新增行逐字帶 `gate_probe_fn_zzz`) | gate **擋下** | **exit 1 擋下**,訊息逐字指出函式名、檔案、那支 migration ✅ |

⇒ **B 的範圍含 A 那顆** ⇒ 同時證明 7.1 硬條款有效:**綁批同推時,刪除那顆被接線那顆連坐擋下**。

⚠️ 三點誠實邊界:①本測證的是 **gate 腳本的判定**,不是真 push(真 push 另有 `--no-verify`／
GitHub 網頁 merge／Vercel Redeploy 等出口,該腳本 `:22-33` 自己聲明看不到)。②測試 A 的刪除讓
`page.tsx` 仍傳一個已不存在的 prop(型別會紅)——拋棄式分支**刻意不修**,本測要的是 **diff 形狀**
而非可編譯性。③**第一次跑測試 B 是假的**:我用 `>>` 附加到一個**不存在**的檔、`git add -u` 不收
untracked ⇒ 什麼都沒 commit、`ADD_SHA` 與 `DEL_SHA` 相同、那個 `exit 0` 其實是測試 A 又跑一次;
靠印出兩個 sha 對照才發現。**已改用 `git ls-files` 先證檔案受追蹤、並斷言兩 sha 相異後重跑。**

## 8. 決策題 — ✅ **Sean 2026-08-11 深夜全批:Q1=A / Q2=A / Q3=A / Q4=B**(主視窗 `B-471-A` 轉)

> **本節保留原題文備查,但已不是「等答」狀態。** 落點:
> **Q1=A** → §4.4 模糊六欄 / 禁模糊五欄的現行分法(零改動)。
> **Q2=A** → §A5(維持現況 + **畫面標明那句文案**,驗收 §5-17)。
> **Q3=A** → §4.1 正規化三巨集現行字面(零改動)。
> **Q4=B**(**偏離本 plan 原本的推薦 A**)→ §7 整節改寫 + §0 等級取高 + §5-15~18 新增 +
> §6 兩列新增 + §A6 死欄不跟進。
> ⚠️ **轉述紀律留痕**(主視窗 `B-471-A` §2 自報):Sean 原文打了兩次「q2」
> (`q1: A / q2: A / q2: A / q4: B`),主視窗按序讀成 Q3=A。**若 Sean 更正,受影響的是 §4.1 三巨集
> 與 §5 第 6/8 格**(Q3 的 B/C 兩案會讓正規化字面大改),屆時整段重寫、不是改個字。

```
Q1 模糊比對(打錯字也找得到)要套用在哪些欄位?
A: A|只套 姓名/品名/品牌/規格/地址(推薦——電話與單號差一碼就是別人)
   B|再加上電話與單號(想「差不多就好」)
   C|先都不套,只做「符號與大小寫不計較」

Q2 品牌搜尋要以哪個時間點為準?(現況:搜「現在的品牌」)
A: A|維持現況,畫面上標明「品牌以現行資料為準」(推薦——零風險、零改錢路徑)
   B|下單當時就把品牌凍進快照(要動建單流程=金流路徑,風險高、要另外對抗審查)
   C|兩個都比(先做 A,B 等下次動建單時順手補)

Q3 單號比對要放寬到什麼程度?
A: A|不分大小寫 + 忽略 -、空白、底線(推薦)
   B|只不分大小寫(現況)
   C|忽略所有非英數字元(最寬,可能把兩個相近單號混在一起)

Q4 兩個舊搜尋欄(訂單編號、供應商單號)什麼時候收掉?
A: A|新搜尋上線並試用一週後再收(推薦)
   B|同一批一起收(畫面最乾淨,但出問題時沒有退路)
   C|先關掉不刪程式碼(隨時可開回來)
```

## 9. 不做的事

- 不動 100 筆上限與日期預設窗(#347-3a/-3c 的合約)。
- 不改 POST-only + httpOnly cookie 的 PII 設計。
- 不做「搜尋建議/自動完成」(那是另一條線,#347 沒有它)。
- 不裝 PGroonga / tsvector(pg_trgm 已足夠;多裝一個擴充=多一個要維護的面)。
- 不碰 storefront 的商品搜尋(`search_catalog_by_vehicle` 那條線與本片無關)。
