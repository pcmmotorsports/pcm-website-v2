# #347-fuzzy · 訂單搜尋容錯化 slice plan(B 窗八代,2026-08-11 夜)

> **狀態:等批**(鐵則 8:動 schema/擴充/RPC ⇒ plan 先過批;鐵則 12③④:DB 結構 + 平台設定 ⇒ 關卡1 codex 必跑)
> 上游:Sean 拍 Q-347=A(要容錯搜尋);缺口盤點=B-459-STOP(本檔 §1 只引結論,不重述)

---

## 0. 片型、授權、邊界

- **片組 A = 高風險片**(鐵則 12③ DB 結構 + ④ 平台設定〔`CREATE EXTENSION`〕)⇒ plan 過關卡1 codex、diff 過關卡2。
- **片組 B = 標準片**(拆 UI 與 adapter 分支,零 DB)。
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

### A3 索引:與查詢**逐字相同**的表達式
GIN trigram 索引建在原欄、而查詢對欄套函式 ⇒ 索引用不到;`strpos()` 與
`similarity(a,b) >= 常數` 本來就不是 trigram 索引支援的形狀。⇒ 三件事一起改:
1. 子字串:`LIKE '%' || <跳脫後 needle> || '%'`(needle 內 `\` `%` `_` 必須跳脫)。
2. 模糊:`OPERATOR(extensions.<%)`,閾值走 **`pg_trgm.word_similarity_threshold`**,
   函式層 `SET` 釘死 **0.4**(起始值;由 A0 探針與驗收 12 的邊界對調整,調整要連驗收一起改)。
   🔴 **不可**寫 `similarity(a,b) >= 閾值` 配 GUC —— 那個 GUC 只作用於運算子。
3. 索引表達式逐字複製 §4 的「完整表達式」欄。

### A4 `product_snapshot ->> 'spec'` 納入比對(#9)
### A5 品牌時間語意(產品面,§8 Q2 給 Sean)
### A6 `supplier_order_no_upper` 生成欄本片不改(死欄清理併片組 B)

## 4. 🔴 規範表(唯一來源;**完整 SQL 字面**,實作與索引照抄)

> 條數:現行 10 條 `strpos`(數法 `sed -n '136,181p' supabase/migrations/20260810120000_*.sql | grep -c 'strpos'` = 10)+ 新增 `spec` ⇒ **11**。
> 共用巨集(寫在 migration 頂端註解,實作展開):
> - `NORM_ID(x)` = `pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.coalesce(x,'')), '[-_[:space:]\u3000\u00A0]', '', 'g')`
> - `NORM_NUM(x)` = `pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.coalesce(x,'')), '[^0-9]', '', 'g')`
> - `NORM_TXT(x)` = `pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(x,'')))`
> needle 側同樣算三份(`v_id_needle` / `v_num_needle` / `v_txt_needle`),各自非空才進該類。

| # | 目標表達式(查詢與索引**同一字面**) | 類別 | 子字串 | 模糊 `needle <% 目標` |
|---|---|---|---|---|
| 1 | `NORM_ID(o.display_id)` | 識別碼 | ✅ | ❌ |
| 2 | `NORM_TXT(c.name)` | 文字 | ✅ | ✅ |
| 3 | `NORM_NUM(c.phone)` | 數字 | ✅ | ❌ |
| 4 | `NORM_TXT(o.shipping_address_snapshot ->> 'name')` | 文字 | ✅ | ✅ |
| 5 | `NORM_NUM(o.shipping_address_snapshot ->> 'phone')` | 數字 | ✅ | ❌ |
| 6 | `NORM_TXT(o.shipping_address_snapshot ->> 'line')` | 文字 | ✅ | ✅ |
| 7 | `NORM_ID(oi.variant_sku)` | 識別碼 | ✅ | ❌ |
| 8 | `NORM_TXT(oi.product_snapshot ->> 'title')` | 文字 | ✅ | ✅ |
| 9 | `NORM_TXT(oi.product_snapshot ->> 'spec')`(**新增**) | 文字 | ✅ | ✅ |
| 10 | `NORM_TXT(br.name)` | 文字 | ✅ | ✅ |
| 11 | `NORM_ID(pc.supplier_order_no)` | 識別碼 | ✅ | ❌ |

索引:每列一支 `CREATE INDEX … USING gin ((<上表表達式>) extensions.gin_trgm_ops)`
(jsonb 那四支的表達式全都是 IMMUTABLE 組合 ⇒ 可建表達式索引;`->>` 與 `lower/btrim/regexp_replace` 皆 IMMUTABLE)。
**模糊欄 6 個**(#2/#4/#6/#8/#9/#10)、**禁模糊欄 5 個**(#1/#3/#5/#7/#11)—— 這兩個數字驅動 §5 的格數。

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

## 7. 片組 B(終態:收掉兩個專用欄)

前提 = A 上線且試用過。動作:①拿掉 `ADMIN_E10_ORDER_NUMBER_SEARCH` / `ADMIN_E10_SUPPLIER_ORDER_NO_SEARCH`
兩個 flag 與對應 UI 欄位(`order-filter-controls.tsx:222` / `:265`)②拿掉 adapter 的供應商兩段式路徑
(`SupabaseOrderAdapter.ts:663-703`)③評估 `supplier_order_no_upper` 生成欄與其索引是否成為死欄(見 A6)。
🔴 **順序不可倒**:B 先做 = 員工同時失去舊入口與新能力。

## 8. 給 Sean 的決策題(**不執行,等答**)

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
