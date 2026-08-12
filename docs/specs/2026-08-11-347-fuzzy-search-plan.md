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

- 🔴 **先確定「現行定義」在哪一支**(不能只挑一個檔就宣稱現況 —— 後面的 migration 會 DROP/REPLACE 前面的,
  文字掃描看不到;memory `reference_count-objects-from-catalog-not-create-statements`)。
  全 migrations 掃 `admin_search_orders` 共 **3 支**
  (`grep -rln "admin_search_orders" supabase/migrations/`):
  · `20260809180000` = `CREATE OR REPLACE …(text, integer)`(`:158`)= **舊 2 參版**
  · `20260810120000` = `DROP FUNCTION …(text, integer)`(`:58`)+ `CREATE FUNCTION …`(`:65`)四參版
    (`text, integer, timestamptz, timestamptz`)⇒ **這支才是現行函式本體**
  · `20260810150000` = **只動 `COMMENT ON FUNCTION`**(`:77`),不碰函式體
  ⇒ 下面的斷言對象=`20260810120000` 那支,不是「隨便挑的一個檔」。
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

### 4.3 UNION 骨架(12 個分支;每個分支自己帶日期範圍與非空閘)

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
  UNION
  -- #12 舊訂單編號 legacy_display_id(識別碼;關卡1 R1 must-fix ①)
  --   🔴 少這支 = 淨失能力:現行舊欄是兩欄對稱查
  --      (`SupabaseOrderAdapter.ts:762` 逐字 `display_id.eq.…,legacy_display_id.eq.…`),
  --      改過號的單、客人拿舊單號來問,新搜尋若只查 display_id 就查不到。
  --   欄實況(`20260729010000_m4b_e10_d0_display_id_expand.sql:53/:58/:64`):
  --      `text` nullable、UNIQUE、CHECK `^PCM-[0-9]{4}-[0-9]{4,}$`。
  --      ⇒ NULL 由 NORM_ID 的 COALESCE 吃掉(§4.1),語意上不需要另加閘;
  --        下面那條 IS NOT NULL 是**為了對上 partial 索引的述詞**才寫的(§4.4 尾段),不是語意需要。
  SELECT o.id, o.created_at FROM public.orders o
   WHERE v_id_needle <> '' AND o.legacy_display_id IS NOT NULL AND <日期範圍>
     AND NORM_ID(o.legacy_display_id) LIKE '%' || v_id_like || '%' ESCAPE '\'
)
SELECT pg_catalog.array_agg(h.id ORDER BY h.created_at DESC, h.id DESC)
  FROM (SELECT DISTINCT id, created_at FROM hits ORDER BY created_at DESC, id DESC LIMIT v_limit + 1) h;
```
- `UNION`(非 `UNION ALL`)去重;最外層多取一筆用來判斷截斷(與現行合約相同)。
- 每個分支都 JOIN 回 `orders` 以套日期範圍 ⇒ 保留 #347-3a 的取樣窗口語意。

### 4.4 逐條規範表(12 條)

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
| 12 | `NORM_ID(o.legacy_display_id)`(**關卡1 R1 must-fix ① 補**) | 識別碼 | ✅ | ❌ | ✅ **但要 partial**(見下) |

索引一律 `CREATE INDEX … USING gin ((<上表表達式>) extensions.gin_trgm_ops)`。
**模糊六欄**=#2/#4/#6/#8/#9/#10;**禁模糊六欄**=#1/#3/#5/#7/#11/#12 ⇒ 這兩個數字驅動 §5 的格數。

🔴 **#12 的索引與 #1 不同形,不可照抄**:`legacy_display_id` 只有**改過號的單**才有值
(其餘為 NULL ⇒ 經 `NORM_ID` 的 `COALESCE(x,'')` 一律變成空字串)。整表建 gin 會把絕大多數列
索成同一個 `''` ⇒ 索引又肥又沒選擇性。⇒ **建成 partial**:
`CREATE INDEX … USING gin ((NORM_ID(o.legacy_display_id)) extensions.gin_trgm_ops) WHERE legacy_display_id IS NOT NULL;`
⚠️ **partial 索引要被用到,查詢必須帶得上同一個 `WHERE` 述詞** ⇒ #12 分支的 `WHERE` 除了
`v_id_needle <> ''` 之外**再加一條 `AND o.legacy_display_id IS NOT NULL`**(語意上是恆等的:
NULL 那些列本來就不可能命中非空 needle,加它只為讓規劃器對得上 partial 述詞)。
⚠️ **未量測**:A0 探針的拋棄式庫沒有造 `legacy_display_id` 非空的資料
(A0 結果段列的四張表沒有這欄的分布)⇒ 上面是**依 partial 索引規則推的設計,不是量出來的**。
驗收第 10 條的 EXPLAIN 逐條列名會證實或推翻它;若 EXPLAIN 顯示走不到,照實寫成缺口、不硬凹。

## 5. 驗收條件(逐條可 yes/no;格數由 §4 驅動)

1. `pg_trgm.installed_version` 非 null、schema=`extensions`(apply 後 `list_extensions`)。
2. **schema 限定沒漏**:①拋棄式庫完整 apply ②**實際執行**一次會走到 `<%` 分支的呼叫
   (🔴 plpgsql 內層 SQL 到首次執行才規劃 ⇒ 只 apply 證不到,關卡1 R2)③對 `prosrc` 逐個 pg_trgm 物件名斷言帶 `extensions.` 前綴。
3. **12 條 predicate 各一格正向**(每條只有該欄命中的隔離 fixture)。
   🔴 **#1 與 #12 必須各自隔離**(關卡1 R1 must-fix ①):#1 的 fixture 那張單
   `legacy_display_id IS NULL`、#12 的 fixture 那張單 `display_id` 與 needle **不共用任何子字串**
   ⇒ 兩格任一支 predicate 掉了都會單獨紅。**兩欄放同一張單上測 = 兩格互相掩護、都恆真。**
4. **模糊六欄各一格**(#2/#4/#6/#8/#9/#10):案例必須是「**LIKE 命不中、只有 `<%` 命得中**」的錯字輸入
   ⇒ 六欄的 `<%` 任一支壞掉都會紅(關卡1 R2:一個案例代表不了六欄)。
5. **禁模糊六欄各一格隔離負測**(#1/#3/#5/#7/#11/**#12**):差一碼的鄰居單搜不到;fixture 只放那兩張單。
6. **空 needle 兩格**:①識別碼/數字類搜 `-`、`___` ⇒ 零命中 ②文字類搜 `-` ⇒ 只命中真的含 `-` 的那列。
7. **LIKE 萬用字元跳脫**:搜 `%`、`_` ⇒ 零命中(非全部命中)。
8. **全形空白/NBSP 雙向兩格**:欄值含 U+3000、needle 用半形空白(以及反向)⇒ 仍命中(識別碼類)。
9. **突變逐欄隔離**:禁模糊六欄**各**做一次「把該條改成 `<%`」⇒ 對應的第 5 條負測必紅;還原後全綠。
10. **索引可達性**:照 A0 探針的方法逐條 EXPLAIN 內層查詢,產出「N/12 走得到索引」的表並**逐條列名**;
    走不到的照實寫成缺口(**不寫**「查詢變快 N 倍」這種在 12 列上量不到的宣稱)。
11. **PII 通道**:指定可控失敗點 = 函式內對 needle 長度上限那條 `RETURN`(現行 `:103-105`)改成
    `RAISE EXCEPTION` 的突變版;正向斷言 = 授權呼叫下 psql 收到的 ERROR/NOTICE 全文**不含 needle 字面**,
    突變(故意把 needle 塞進 RAISE)⇒ 該格必紅 ⇒ 證明觀察通道真的看得到。
12. **閾值邊界對**:六個模糊欄各給一組「應命中/應不命中」的邊界輸入,釘死 `word_similarity_threshold = 0.4`;
    改閾值必須同批改這 12 個期望值(⇒ 閾值不是可以隨手調的旋鈕)。
13. 三綠 + 全套 vitest Δ=0;harness 專屬埠、跑前 `lsof` 驗空、fail-closed 離場收叢集(照 #416 的 trap 形狀)。
14. 收據面:harness 收編 w7 ⇒ 同片 `record` + `check`;不收編 ⇒ commit body 明寫。

**以下 15-19 為 Q4=B 新增**(15-18=2026-08-12,`B-472-NOTE` §3-4 + `B-473-A` §4 裁准;
19=同日 A4b,`B-481-A` 轉報價單側坑。**15/17/18/19 四條已於關卡1 R1 後重寫**,見各條內的
🔴 段;16 等 Sean 答 Q-347-B1 才定字面)—— 沒有這幾條,
「同批收掉舊欄」會變成**淨失能力而測試全綠**:

15. 🔴 **能力等價性(最重要,三格)**:拿掉舊欄**之前**,證明新搜尋找得到舊欄找得到的單。
    **①訂單編號(新號)②訂單編號(舊號 `legacy_display_id`)③供應商單號**
    (舊路徑座標:①②=`SupabaseOrderAdapter.ts:762` 的 `.or()` 兩欄對稱查;③=`:663-703` 兩段式路徑)。

    🔴 **斷言形狀=隔離 corpus 上比「完整結果集」,不是比「同一張單有沒有被命中」**
    (關卡1 R1 must-fix ②)。原寫法「兩路徑都命中同一張單」**判別力不足**,三個漏法:
    ①新路徑同時多撈回一堆不該撈的單,斷言照樣綠(它只問「有沒有含 X」);
    ②新路徑因為**別的欄**碰巧命中同一張單(`.or()` 是 12 條 predicate 的聯集)⇒
    測的根本不是單號那條;③舊路徑是 `.eq` **精準相等**、新路徑是 `LIKE '%…%'` **子字串**
    ⇒ 兩者本來就**不等價**,只比單張命中會把這個差異藏起來。

    ⇒ 做法:每格建**專屬隔離 corpus**(≥3 張單:1 張目標、1 張「差一碼的鄰居」、1 張完全無關),
    同一個 corpus 上跑兩條路徑,斷言 **`toEqual` 比對排序後的完整 id 陣列**。
    ⚠️ 已知且**允許**的差異寫成明文期望值,不是讓它靜默通過:精準鍵給**完整單號**時兩路徑結果集
    必須逐字相等;給**部分字串**時舊路徑回 0 筆、新路徑回 ≥1 筆 ⇒ **在該格逐字寫成期望值**
    (寫下來 = 日後有人把它改回精準相等時這格會紅)。

    🔴 **這個「精準 → 子字串」的放寬,出處是本 plan 自己的設計**(§4.4 表格 #1/#12/#11 的
    「子字串 ✅」欄),**不是 Sean 拍過的題** —— 我原本在這裡寫「這是 Q3=A 要的能力擴張」是**引錯**:
    Q3 問的是**正規化**(不分大小寫 / 忽略 `-`、空白、底線),Q3=A 對應 §4.1 三巨集、與精準或子字串無關
    (§8 逐字:「**Q3=A** → §4.1 正規化三巨集現行字面(零改動)」)。
    ⚠️ **FYI 給主視窗,不擋工**:單號從 `.eq` 放寬成子字串是**大一統搜尋框的必然結果**
    (一個框要同時吃 12 種欄位,不可能對其中三種要求完整相等),Q1=A 也只把單號排除在**模糊**之外、
    沒說要精準相等 ⇒ 我判**不需要另外拍板**。若主視窗判要,那是 §5-15 期望值那兩行的事、不動架構。

    ---

15b. 🔴🔴 **等價性的「刻意不等價」那一格**(Sean 2026-08-12 拍 **Q-347-B1=B**,主視窗 `B-487-A` 轉)。

    **這格是本片最容易被誤判成 bug 的地方,所以它自己一格、不併進 15。**
    Q-347-B1=B ⇒ **不保留**「打單號就自動看得到未付款單」的能力 ⇒
    對 **`payment_channel='tappay'` 且 `payment_status='unpaid'`** 的單,
    **舊欄找得到、新搜尋故意找不到** —— 這是**拍板要的結果,不是回歸**。

    ⇒ **一格三條斷言**(同一個隔離 corpus,目標單=一張 tappay×unpaid 單):
    | | 斷言 | 為什麼要它 |
    |---|---|---|
    | ① | 舊欄路徑輸入其 `display_id` ⇒ **命中 1 筆** | 釘住「舊欄本來做得到」,否則 ② 的「找不到」證不出是**能力被移除**還是**fixture 本來就沒資料** |
    | ② | 新搜尋輸入**同一字串** ⇒ **回 0 筆** | Q-347-B1=B 的正面斷言 |
    | ③ | 同一次查詢 ⇒ **畫面出現提示**「可能有未付款的單被隱藏,勾起來再查一次」 | B 案的**交付物**;沒有它,B 案就退化成「客服看到共 0 筆而不知道為什麼」= 選項 C |
    | ④ | 勾起「連未付款一起顯示」再查同一字串 ⇒ **命中 1 筆** | 證明那個勾**真的是逃生口**(它是現況唯一活著的那個,見下)⇒ 否則 ③ 的提示是在叫人做一件沒有用的事 |

    🔴 **①與④缺一不可**:只寫 ② 的話,把新搜尋整條 predicate 刪掉、這格照樣綠
    (什麼都搜不到當然回 0 筆)—— 那是**恆真格**,正是本片已經踩過兩次的形狀(§5-18/§5-19)。
    **突變**:把隱藏規則那條 `payment_status <> 'unpaid'` 拿掉 ⇒ **② 必紅**(變成命中 1 筆);
    把提示的渲染條件拿掉 ⇒ **③ 必紅**;兩個突變**分開跑、各自只紅一條**。

    ⚠️ **現況前提(已實查,寫下來給下一代)**:那兩支 flag 現在都是 off
    (`apps/admin/src/app/orders/page.tsx:71`/`:77` 逐字 `=== '1'`;本機 `.env*` grep 零命中,
    **正式站 Vercel env 值未查**)⇒ 舊欄的豁免**今天本來就走不到**,現況唯一活著的逃生口
    就是 ④ 那個勾(`order-filter-bar.tsx:60`、`order-list-view.ts:334`)。
    ⇒ **B 案在現況下是「把已經走不到的路正式關掉並補上提示」,不是拆掉正在用的東西。**
    ⇒ 這也是為什麼 ① 要跑**舊欄路徑本身**(adapter 層直呼)而不是打開 flag 走 UI ——
    **不為了測試去改正式站的 flag**。
16. **舊欄零殘留**:①兩個 flag 名全樹 grep 零命中(含 `page.tsx` / `order-filter-controls.tsx` /
    `page.test.tsx`)②那兩個 `<form>` 不再渲染 ③`SupabaseOrderAdapter.ts` 的兩段式路徑整段消失。
    數法寫進 commit body,**不寫「應該都清了」**。
    ⚠️ ①的數法要**數語法位置**、不是數字串出現次數:flag 名會出現在註解裡
    (memory `reference_grep-keyword-count-includes-comments`)⇒ 收工前那次要數
    `process.env.<FLAG>` 的**取值點**,註解另外肉眼確認語意不再宣稱它還在。

    ### 16b 🔴 供應商兩段式路徑帶走的**三項能力**——逐項裁定,不含糊(關卡1 R1 must-fix ③)

    ⚠️ **本節是盤點與提案(寫於裁定之前),不是結論。裁定在 §16c** ——
    尤其「我的建議」那一欄與 ⅲ 的「要單獨講」**都已被 Q-347-B2=C + Q-347-B3=B 取代**,
    引用前先讀 §16c 的對照表。留著本節是因為 §16c 的理由建立在這裡的座標與盤點上。

    「整段消失」這四個字會把**三件不同性質的事**包成一件。實查 `SupabaseOrderAdapter.ts:663-712`,
    那段路徑除了「查得到單」之外還做了三件事,**新的 UNION RPC(#11)一件都不會自動繼承**:

    | | 能力 | 座標 | 性質 | 新路徑現況 | 我的建議 |
    |---|---|---|---|---|---|
    | ⅰ | **帶出命中的供應商名**(`suppliers(label)`,#338) | 取值 `:671`、意圖 `:667` | 顯示加值 | UNION 只回 order id 陣列,**不回供應商** ⇒ 消失 | **退場**(但要 Sean 知道 #338 這個功能會不見) |
    | ⅱ | **多家去重**(鍵=`supplier_id` 非 `label`) | 意圖 `:703`、實作 `:710` | 顯示正確性 | 同上,隨 ⅰ 一起消失 | **退場**(ⅰ 沒了 ⅱ 無所依附) |
    | ⅲ | **凡截斷必擲錯,共 3 道**(下表) | `:688` / `:701` / `:729` | 🔴 **fail-closed 正確性守門** | 新 RPC 走既有截斷合約(`LIMIT v_limit + 1` + `truncated` 旗標)= **fail-soft** | 🔴 **這項不是「退場」是「換語意」,要單獨講** |

    🔴 **ⅲ 是三道不是兩道**(我第一次盤點只列了兩道、漏掉第三道 —— 數法:
    `grep -n "throw new SupplierOrderNo" SupabaseOrderAdapter.ts` ⇒ **3 命中**):

    | 道 | 座標 | 擲什麼 | 守的是 |
    |---|---|---|---|
    | 第一道 | `:688` | `TooManyError(PROBE_ROW_LIMIT)` | **採購列**被截斷 ⇒ 集合完整性(`:685-686` 逐字:截斷後「看起來一切正常、實際少回訂單」) |
    | 形狀道 | `:701` | `ShapeError(rows.length)` | 回傳形狀與假設不符 ⇒ **逐列**判斷(`:695-696` 逐字:只在「全部失敗」時擲,部分失敗仍會靜默少回訂單) |
    | 第二道 | `:729` | `TooManyError(MATCH_CAP)` | **去重後訂單數**超上限 ⇒ 守的是**第二段的 URL 長度**,`:727` 逐字自陳「與上一道守的『集合完整性』是兩件事」 |

    ⚠️ 第二道背後有 **Sean 2026-08-07 Q1=A「不默默降級」的拍板**(`:726` 逐字,主視窗 `E-142-A` 批准)
    ⇒ 把它換成 fail-soft 旗標**是在動一條拍板的落點**,不是動一段實作細節。

    🔴 **ⅲ 為什麼不能當成純刪碼**:那兩道擲錯是**修過的 bug 的修法本體**,不是防禦性裝飾 ——
    程式碼裡逐字寫著病灶(`:685-687`:「截斷之後我們**不知道真正的訂單集合**…看起來一切正常、
    實際少回訂單(階段 C must-fix 的病灶)」;`:692-696`:Fable F1「濾掉的話會靜默變成查無此單,
    而且 mock 餵的是符合假設的形狀 ⇒ **測試全綠、功能壞掉**」)。
    換成 fail-soft 的 `truncated` 旗標**未必更差**(那是列表既有合約、UI 有對應顯示),
    但這是**行為改變**:同一個查詢,舊路徑會擲錯讓人知道結果不完整,新路徑會回一份**看起來正常的
    不完整結果** + 一個旗標 —— **旗標有沒有被 UI 真的顯示出來,是這項能不能退場的前提**。

    ⇒ **驗收(不論裁定為何都要跑)**:造一組「命中數超過上限」的 corpus ⇒
    ①新路徑回 `truncated=true` ②**畫面真的出現截斷提示**(`toBeVisible`,不是字串存在)。
    **突變**:把 RPC 的 `LIMIT v_limit + 1` 改成 `LIMIT v_limit` ⇒ ①必紅
    (少取那一筆就分辨不出「剛好觸頂」與「超過」——理由與舊路徑 `:678` 逐字同源)。

    ---

    ### 16c ✅ 定稿 = **Q-347-B2=C**(08-12,`B-491-A`)**+ Q-347-B3=B**(同日稍後,`B-494-A`)

    🔴 **兩次拍板要一起讀,只讀 C 會拿到過期結論**:

    | 項 | Q-347-B2=C 當時 | **Q-347-B3=B 之後(現行)** |
    |---|---|---|
    | ⅰ 供應商名帶出 | 保留、在新搜尋重建 | **不變**(→ 片 B-2) |
    | ⅱ 多家去重 | 保留、隨 ⅰ 重建 | **不變**(→ 片 B-2) |
    | ⅲ 截斷擲錯 | 「維持擲錯」 | 🔴 **實質退場** —— 併進大查詢、走既有 fail-soft(前 100 筆 + 「結果太多請更精確」提示) |

    **為什麼翻案**:C 的 ⅲ 在新架構下沒有載體 —— 三條路(甲 RPC 內 `RAISE` / 乙 adapter 見
    `truncated` 就擲 / 丙 供應商不併進 UNION)各自推翻一條已核准的東西(PII 規則 / 關鍵字截斷設計 /
    本 plan §4)。**Sean 是知情選的**:B3 題文逐字寫著「等於第③項實質退場」。
    ⇒ 08-07「**不默默降級**」那條拍板在本落點**由「畫面提示」承載**,不再由 throw 承載。
    ⇒ 舊路徑三道 throw(`:688` / `:701` / `:729`)隨兩段式路徑一起退場。

    🔴🔴 **⇒「提示真的看得見」那格從『A 案的前提』升格為【必留】** —— 它現在是
    **降級可見性的唯一載體**(`B-494-A` §1 逐字)。我上一版把它當殭屍撤掉,**那是基於 C 的判斷,
    B3=B 之後失效** ⇒ **本次撤銷該撤銷**、把格加回來,寫法照 §5-15b 的正負對照 + 突變形狀:

    | | 斷言 | 為什麼要它 |
    |---|---|---|
    | ① | 造「命中數 > 上限」的 corpus ⇒ RPC 回 `truncated=true` | 正面 |
    | ② | **畫面出現**「結果太多請更精確」(`within(搜尋控制區)` + `toBeVisible`) | **本片唯一的降級可見性**;字串存在斷言不算(§5-17 同族) |
    | ③ | 命中數 **≤ 上限**時該提示**不出現** | 沒有這條,提示恆顯也會過 = 恆真格 |

    **突變兩發、分開跑、各自只紅一條**:
    ⓐ 把 RPC 的 `LIMIT v_limit + 1` 改成 `LIMIT v_limit` ⇒ **①必紅**
      (少取那一筆就分辨不出「剛好觸頂」與「超過」,理由與舊路徑 `:678` 逐字同源);
    ⓑ 把提示的渲染條件拿掉(改成恆顯)⇒ **③必紅**。

    #### 🔴 新增一格:**單張多商品訂單只能算 1 筆**(Sean 08-12 追問衍生,`B-494-A` §2)

    Sean 問「單筆訂單超過 100 個不同商品會報錯嗎」。**不會**,但**追下去發現一個沒人守的不變式**:

    - 舊路徑:先 `order_items → order_id` **去重**再比 CAP(去重 `SupabaseOrderAdapter.ts:724`、
      比較 `:728`)⇒ 單張訂單恆 = 1。另一道 `PROBE_ROW_LIMIT = 500`(`:269` / `:687`)數的是
      商品列數,百餘商品仍遠低於它。
      ⚠️ **更正主視窗轉述的座標**:`B-494-A` §2 寫「去重在 `:669-670`」——那兩行實查是一段講
      `ADMIN_ORDER_LIST_SELECT` 的註解。結論對、座標錯,以本節的 `:724` / `:728` 為準。
    - 現行 RPC:用 `EXISTS (SELECT 1 FROM order_items …)`(`20260810120000_…:158-179`,`EXISTS (` 起於 `:158`、該子查詢的最後一條述詞在 `:179`)**不是 JOIN**
      ⇒ 一張訂單恆一列。
    - 本 plan §4.3 骨架:靠 **`UNION`(非 `UNION ALL`)+ 外層 `SELECT DISTINCT`** 去重 ⇒ 也是一列。

    ⇒ 三代實作**都對**,但**沒有任何一格在守它**。一旦有人把 `UNION` 當效能問題改成 `UNION ALL`
    (或拿掉外層 `DISTINCT`),單張有 N 個命中商品的訂單就會**吃掉 N 個名額**、把別的單擠出 100 筆之外
    ⇒ 畫面少單、`truncated=true` 看起來還「合理」= **靜默少回訂單**,正是舊路徑 `:685-686` 逐字
    描述的那個病灶換個地方復發。

    ⇒ **驗收**:fixture 造 1 張訂單、掛 **≥3 個都命中同一 needle 的商品**,搜該 needle ⇒
    `ids` 逐字 = `[該訂單 id]`(**長度 1**,用 `toEqual` 比完整陣列、不是 `toContain`)。
    **突變**:把骨架的 `UNION` 改成 `UNION ALL` ⇒ **必紅**(長度變 3)。

    #### 📖 存查:ⅲ「維持擲錯」為什麼落不了地(**這節是 B3=B 的理由,不是待辦**)

    C 案裁的是**語意**(不默默降級),但**落點在新架構下沒有載體**。三條實查,全部有座標:

    | # | 事實 | 座標 |
    |---|---|---|
    | 1 | 本 plan 把供應商單號收成 UNION 裡的**第 11 條 predicate**,並在同一批**拿掉 adapter 兩段式路徑** | 本檔 `:264`(§4.4 表格第 11 列)/ `:526`(§7 動作②)——⚠️ 這兩個是**本檔自己的行號**,改本檔必複量 |
    | 2 | 那支 RPC 被**明文禁止 RAISE**:逐字「🔴 本函式**無任何 RAISE** —— 搜尋詞本身是 PII,不得落進 server log」;同段還寫「`p_from > p_to` ⇒ 自然回零筆、不擲例外(…擲任何例外都可能把 PII 帶進 log)」 | `20260810120000_…_admin_search_orders_date_range.sql:214`(COMMENT) |
    | 3 | 該 RPC **已經有同一個 100 的上限**、而且走的就是 **fail-soft `truncated=true`**;它的 100 逐字「對齊下游 `.in()` 的 URL 長度上限 `SUPPLIER_ORDER_NO_MATCH_CAP=100`」——**與舊路徑第二道守的是同一件事、卻選了相反的處置** | 同上 COMMENT;常數 `SupabaseOrderAdapter.ts:115` / `:167` |

    ⇒ **UNION 把 12 條 predicate 壓成一個結果集,「這次截斷是供應商單號造成的」在回傳裡不可分辨** ⇒
    要對供應商單號單獨擲錯,只有三條路,而**每一條都碰到別的既有拍板**:

    | 路 | 做法 | 代價(實查,非推測) |
    |---|---|---|
    | **甲** | RPC 內對截斷 `RAISE` | **違反事實 2**(該 COMMENT 是鐵則 12 面的設計理由,不是風格偏好) |
    | **乙** | adapter 在 `truncated===true` 時擲錯 | 會對**全部 12 條 predicate**生效 ⇒ **純關鍵字搜尋也會擲錯**,推翻既有已核准設計(RPC COMMENT 逐字「命中超過上限時只回前 p_limit 筆並 `truncated=true`(**UI 必須顯示「結果太多請更精確」**)」)。要只對供應商生效就得**偵測輸入形狀**,而 **Q-347-B1=B 剛裁掉形狀偵測** |
    | **丙** | 供應商單號**不收進 UNION**、維持獨立一段 | 三項能力全部原地保留、零改動風險,但**推翻本 plan §4 的大一統設計**(#11 那列要撤),搜尋框變成「一個框 + 一條暗管」 |

    ✅ **已裁:Sean 選乙的變體 = Q-347-B3=B**(`B-494-A`)—— 不對供應商單獨擲錯,
    整條走大查詢既有的 fail-soft(前 100 筆 + 提示),ⅲ 實質退場。
    當時我不自選的理由留著存查:三條路各自推翻一條**已核准的東西**(PII 規則 / 關鍵字截斷設計 /
    本 plan §4),這不是連動調整,是**三個拍板互相打架** —— 照
    `feedback_decision-option-must-be-traced-to-end-state`,選項要走到終態才准上桌,
    而這三條的終態都不在我的射程內。**結果證明值得問**:Sean 選的那條要付的代價
    (08-07 拍板改由提示承載)沒有出現在任何一題的題文裡,是問出來才浮上檯面的。

    #### ⅰ/ⅱ 重建 = **另拆一片**(鐵則 4;Sean 授權我自己拆,`B-491-A` §1)

    重建「命中的供應商名 + 多家去重」不是加一個欄位,它要動**三層**:
    ①RPC 回傳形狀從 `{ids, truncated}` 變成要多帶供應商(**動的是鐵則 12 面的 RPC 契約**)
    ②adapter 的讀模型與型別 ③UI 顯示那塊。
    ⇒ 與「搜尋本體 + migration 130000」綁在同一片會**遠超 15-45 分**,且會讓一顆 commit
    同時動搜尋語意與回傳契約 ⇒ **拆兩片**:

    | 片 | 內容 | 前後關係 |
    |---|---|---|
    | **B-1 搜尋本體** | pg_trgm + 統一容錯 + UNION 12 條 predicate + 舊欄收掉 + migration 130000 | 先做;**不含** ⅰ/ⅱ |
    | **B-2 供應商顯示面** | RPC 回傳擴供應商 + adapter 讀模型 + UI「命中 N 家」 | 後做;獨立可驗、可獨立回滾 |

    ⚠️ **B-1 收掉舊路徑會讓 ⅰ/ⅱ 出現一段空窗**(B-1 上線到 B-2 上線之間,供應商名不顯示)。
    這是拆片的**真代價**,寫在這裡不藏:若不接受空窗,兩片必須**同一批上線**
    (與 Q4=B 的「同一次 push」硬條款同形狀,見 §7.1)—— **哪一種由主視窗裁**,一併問。
17. **A5 那句 UI 文案「看得到」**(Q2=A 的交付物,不是可選裝飾)。
    🔴 **原寫法「畫面上出現」= 字串存在斷言,恆真**(關卡1 R1 must-fix ④):元素被
    `display:none` / `hidden` / 摺在收合面板裡 / 渲染在頁面另一端,`getByText` 一樣過。改成兩道:
    ① **scope**:先 `within(<搜尋控制區>)` 取範圍(用搜尋框那個 region 的可及名稱定位,
       **不是整頁 `screen`**)—— 文案掛在別處也算沒交付,因為它要在使用者打字的地方被看到。
    ② **可見性**:`toBeVisible()`(非 `toBeInTheDocument()`)。
    ⚠️ **判別力邊界(誠實)**:jsdom 認得 inline style / `hidden` 屬性 / `display:none`,
    **認不得外部 CSS 檔造成的隱藏**(jsdom 不套 `.css`)⇒ 這格擋得住「忘了放」與「放錯地方」,
    擋不住「CSS 把它蓋掉」。後者要真瀏覽器,**本片不做、寫成缺口**
    (memory `feedback_claim-scope-exceeds-fact-three-shapes`:class 掛上 ≠ CSS 認帳)。
18. **突變:等價性三格各自打靶**(🔴 關卡1 R1 must-fix ⑤ —— 原寫法是**我自己寫的恆真格**)。
    原字面要突變「品名/品牌那條 predicate」,但第 15 條那三格是用**訂單編號 / 舊訂單編號 /
    供應商單號**搜的(#1 / #12 / #11)⇒ **改壞品名根本不會讓它們紅 = 突變打不到靶、全綠**。
    改成**逐格對位**,每個突變只准紅它自己那一格:
    | 突變 | 打壞 | 必紅 |
    |---|---|---|
    | 破壞 #1 `NORM_ID(o.display_id)` 那條 | 新號路徑 | 15① |
    | 破壞 #12 `NORM_ID(o.legacy_display_id)` 那條 | 舊號路徑 | 15② |
    | 破壞 #11 `NORM_ID(pc.supplier_order_no)` 那條 | 供應商單號路徑 | 15③ |
    ⚠️ 三個突變**分開跑**;若某個突變同時紅了不只一格 ⇒ 表示第 15 條的 corpus 沒隔離乾淨
    (別的 predicate 也在命中同一批單)⇒ **先修 corpus,不是接受它**。

19. 🔴 **已下架/隱藏商品的訂單仍搜得到**(A4b;2026-08-12 補,**2026-08-12 關卡1 R1 must-fix ⑥ 重寫**)。

    🔴 **原寫法是我自己寫的第二個恆真格**:它要求用**料號與品名**搜、突變是「改讀
    `storefront_catalog_v`」——但**料號與品名根本不經商品表**:
    #7=`NORM_ID(oi.variant_sku)`、#8=`NORM_TXT(oi.product_snapshot ->> 'title')`,
    兩者都讀 `order_items` 的**下單當下快照**(§4.4 表格逐字)⇒ **把資料源換成 view 也不會紅**。

    **真正的風險面只有 #10 品牌**——它是 12 條裡**唯一**走活的商品表的分支
    (§4.3 逐字「#10 品牌(文字,三跳 JOIN)」= `order_items → product_variants → products → brands`;
    數法:§4.4 表格 12 列裡,目標表達式的欄位前綴不是 `o.` / `c.` / `oi.` / `pc.` 的只有 `br.` 這一列)。
    快照那幾條**天生免疫**,不是被守住 —— 這個區別要寫清楚,否則下一代會以為那幾條有守門。

    ⇒ **改寫後的格**:fixture 造一張歷史訂單,其商品 `is_listed=false`(或 `hidden_from_store=true`)、
    且該商品**掛在一個有品牌的 variant 上** ⇒ 用該商品的**品牌名**搜尋**必須命中**。
    **突變**:把 #10 那條三跳 JOIN 的來源改成 `public.storefront_catalog_v`
    (該 view 條件=`WHERE p.is_listed AND NOT p.hidden_from_store`,見 A4b)⇒ **本格必紅、且只紅這格**。
    ⚠️ 料號與品名各留**一格正向**(=第 3 條的 #7/#8 已涵蓋,此處不重複造格),
    但**明寫它們免疫的理由是快照**,不是有守門在保護。

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
| **回滾(順序固定)** | ①`DROP INDEX` 逐支列名(**含 #12 那支 partial**)②`CREATE OR REPLACE` 換回現行 RPC ③**`DROP FUNCTION public.pcm_spec_text(jsonb)`** ④**把 RPC 的 `COMMENT ON FUNCTION` 還原成現行字面**(本片會改寫它)⑤確認零其他依賴後才 `DROP EXTENSION`。⚠️ `DROP EXTENSION` 預設 RESTRICT **不會**連帶刪索引(會報錯);`CASCADE` 可能刪到別人的 |
| 🔴 **回滾漏物件(關卡1 R1 must-fix ③)** | 原三步**只還原了 RPC 與索引**,漏兩個本片自己建/改的物件:①`public.pcm_spec_text(jsonb)` 是本片 `CREATE FUNCTION` 出來的(§4.1 逐字)、三步裡沒有 drop 它 ⇒ 回滾後**殘留一個沒人叫的函式**,下次有人 `CREATE OR REPLACE` 會撞到不同簽章 ②RPC 的 `COMMENT` 被本片改過、三步沒還原 ⇒ 正式站 COMMENT 與行為不符(**同型債正式站已有一筆**,見 memory `project_347-3-date-range-default-belongs-to-3c`)。⇒ 已補成上格的 ③④ |
| 🔴 **回滾的應用層那半(Q4=B 新增)** | 上面三步只還原 **DB 物件**。Q4=B 之後,舊欄與 adapter 兩段式路徑**在同一批被刪掉** ⇒ 只滾 DB 會得到「新搜尋沒了、舊欄也沒了」=**比事故前更糟的零入口狀態**。⇒ 回滾**必須連應用層一起回**,**但不是靠 `git revert`**(關卡1 R1 must-fix ⑦ 更正,詳下格)。⇒ **回滾單位=整批,不是 migration** |
| 🔴 **回滾手段=內容型 patch,不是 `git revert`**(關卡1 R1 must-fix ⑦) | 原字面寫「`git revert` 掉那顆、與 DB 三步**同一次**完成」,**兩個假設都站不住**:①**那顆未必還單獨存在**——`git revert <sha>` 需要一顆內容剛好等於「拿掉舊欄」的 commit,整批被 squash/rebase 過之後就沒有了;②**兩者無法原子**——git 與 DB 是兩個系統、沒有跨系統交易,「同一次完成」是願望不是機制。⇒ 改成 **事故當下把「恢復舊入口」寫成一個新的內容型 patch**(不查 sha、不依賴歷史形狀),順序=**先恢復應用層舊入口 → 實際驗一次搜得到 → 再回 DB 那五步**。理由:應用層先回=員工至少有舊欄可用(新 RPC 還在、兩套並存無害);**DB 先回=舊欄還沒回來的那段時間兩套都沒有**=正是要避免的零入口狀態。⇒ **回滾 runbook 在片組 B 的 commit body 裡逐字寫出來**(要恢復哪四處:兩個 flag、兩個 `<form>`、adapter 兩段式路徑、`page.test.tsx` 四處),不留「revert 那顆」這種指不到東西的字面 |
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

🔴 **硬條款的有效期只到「這一次 push」為止**(關卡1 R1 must-fix ⑧;**這是我原本漏寫的那半**)。
綁批只保證**首次上線**那一刻的順序,**保證不到日後**:任何人**單獨 revert 或 cherry-pick 掉接線那顆**
(留下「舊欄已刪、新 RPC 沒人叫」的狀態),對 gate 而言又是一個**零新增行 / 或新增行不含 RPC 名**的
diff ⇒ **同一個缺口、同樣放行、同樣零症狀**。⇒ 硬條款要連帶寫成**兩條**:

| | 條款 | 擋的時點 |
|---|---|---|
| **B-1** | 刪除那顆與接線那顆**同一次 push** | 首次上線 |
| **B-2** | **接線那顆日後不得被單獨 revert / cherry-pick 掉**;真要退,退**整批**(含把舊欄一起還原,照 §6「內容型 patch」那格的順序) | 上線之後 |

⚠️ **B-2 沒有機制擋得住,是純語意條款** —— 誠實寫出來:gate 只認「新增行出現未 apply 的函式名」,
**認不得「原本有的呼叫消失了」**(它不掃刪除行,`:158`/`:161` 逐字)。要機制化得另建一道
「RPC 名在 `apps/**`/`packages/**` 的**出現次數**由非零掉到零就擋」的守門 —— **本片不做**
(那是新的守門片、要自己的負測與突變),⇒ **寫成缺口、不假裝有防護**。
🔴 判準留給下一代:B-2 被破壞的症狀=正式站搜尋回 `PGRST202` 或恆空,**而三綠與 gate 都會是綠的**。

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
>
> ⚠️ **這句是 2026-08-11 拍板當下的字面,保留原樣不改寫**(拍板紀錄不回頭修飾)。
> 2026-08-12 關卡1 R1 must-fix ① 補進 #12 `legacy_display_id` 之後,§4.4 現況=**模糊六欄 /
> 禁模糊六欄**。Sean 拍的是「識別碼類不做模糊」這個**分法**,#12 是識別碼 ⇒ 歸禁模糊
> **是照這個拍板推的、不是推翻它**;數字從五變六不需要重拍。
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
