# plan · 讓變體料號搜得到(`storefront_search_product_ids` 加第 ④ 塊)

> 線【資料】`-db` 2026-09-06 寫;主視窗 `-f1` 18:3x 派(來源:Sean 18:3x 在正式站搜 `PET52R` / `AZ203B` 找不到)。
> 根因由線【前台】查到, 交接全文 `~/pcm-mailbox/front-022-搜尋料號與卡片顯示-plan.md`。
> **鐵則 8 + 鐵則 12 第③類 ⇒ 等批, 且要過 codex(gpt-6-astra, `--disable apps`)。**

---

## R1 · codex(gpt-6-astra, `--disable apps`)= **FAIL**, 3 must-fix + 3 nit —— 逐條寫在這裡, 而不是改完就算

> 🔴🔴 **最重要的那一條我完全沒想到, 而它不在 SQL 層 —— 它在【呼叫端】。**

### MF1 · 加第 ④ 塊可能讓【原本搜得到的商品消失】(跨層反例)
`packages/adapters/src/supabase/SupabaseProductAdapter.ts:872` 逐字:
```ts
    if (ids.length > RPC_ID_CAP) {
```
`RPC_ID_CAP = 1000`(`:78`)。超過 ⇒ `return null` ⇒ **整發搜尋退回舊路**, 而舊路(`:716` 一帶)
**沒有正規化比對、也沒有變體比對**。
⇒ 🎯 **反例**:某個詞原本命中 998 件, 其中有幾件是**只靠正規化前綴**找到的;
　 第 ④ 塊再多帶回 3 件 ⇒ 1001 > 1000 ⇒ **退回舊路** ⇒ **那幾件反而不見了**。
⇒ 📌 **一個「讓更多東西搜得到」的改動, 可以讓原本搜得到的東西消失** —— 而它在 SQL 層完全看不出來。
✅ **驗收條件加一格(必做)**:構造一個讓 id 數**跨過 1000→1001** 的詞, 端到端(走 adapter 那條路)跑,
　 並明寫處置:是提高 cap、是分頁、還是接受降級。**只驗兩個 SKU 的 SQL 命中不算數。**

### MF2 · 乙案(運算式索引)不能當成加速方案
`text_pattern_ops` 對**常數** `LIKE 'X%'` 是對的 opclass, 而這裡右側是 CTE 每列算出來的 `t.term`。
`supabase/migrations/20260904010000_...sql:120` 的 `COMMENT ON INDEX` 早就寫過這件事。
⇒ ✅ 乙案若要做, **必須驗完整查詢的 `Index Cond`**, 不能拿常數版的 EXPLAIN 代替。
⇒ ⏰ 這一條已另開板列 `⟦search-PATTERNCONSTIDX⟧`(真正的修法是**函式重寫成 pattern 常數**, 不是加索引)。

### MF3 · §0 那句「RLS 會生效」證據不足 —— 我把【必要】講成了【充分】
⛔ ~~「view 是 `security_invoker=true` + 函式 `prosecdef=f` ⇒ anon 吃得到 policy」~~
🔴 兩層 INVOKER 是**必要不充分**:它不證明 RLS 真的啟用、不證明呼叫者沒有 `BYPASSRLS`、
　 不證明沒有**別的 permissive policy 把它放寬**、也不證明基表欄位權限齊全。
　 **而我量的是唯讀連線, 那不是 anon。**
✅ 補法:以 **anon 身分**跑完整的新查詢, 附**上架正對照**(看得到)與**下架負對照**(看不到),
　 並列出該表的**有效 policies 全集**。⇒ 在那之前, 這一格是**證據缺口**, 不是已證實的越權。

### N1 · §2 「planner 無論如何都要全表掃」過度絕對
無合格詞時可能根本不掃;多詞可能重算多次;RLS 也會改變處理列數。
`§0` 那句「複合鍵第二欄**用不到**」同樣太絕對 —— PostgreSQL 對非首欄條件仍可能掃, 只是效率差。
✅ 改寫成「**沒有可用的前綴索引 ⇒ 預期是全表掃**, 而實際計畫要 EXPLAIN 才算數」。
🔵 codex 另提一個可比的寫法:按 (商品, 詞) 的 correlated `EXISTS`, 吃 `product_id` 索引並提前停止 —— **但快不快要量**。

### N2 · 「真的沒貼進正式庫」是推論, 不是那個讀數答得出來的
同一個讀數也可能來自**套用後被刪掉 / 改名 / 回滾**。
✅ 全文改成「**該名稱的索引在量測時不存在**」;「少的只有索引」也要分開查(部署歷史 + 完整函式本體)。

### N3 · 我引用的那句註解逐字相符, 而【它自己已經過期】
`§1` 引的「三個條件缺一不可, 少了第一個會回傳整張表」——
現行版本還有**數字閘**在, 單獨移除「正規化非空」那一條**不會**讓中文詞變成全表命中;
而那句註解也**漏掉了現行的七位純數字分支**。
✅ **防護保留**(它仍然該在), 而**理由要訂正** —— 📌 **逐字引用對了, 不代表被引用的那句話今天還成立。**

### 🟢 codex 同時答掉了我最擔心的兩題(這兩題我原本要自己驗)
- `want` 只由 `t` 算, 第 ④ 塊的 `ord` 也來自同一個 `t` ⇒ **重複的 `(id, ord)` 不會增加 `DISTINCT` 計數**
  ⇒ 集合**不會縮小**;`PET52R` / `AZ203B` 同時含字母與數字 ⇒ 通得過條件。
- `LANGUAGE sql STABLE` **不會**免除 RLS(`STABLE` 影響的是查詢快照, 不是權限)。

---

## 0. 先回答 front 留下的兩個「未確認」—— 我對【正式庫】唯讀量了一發, 零寫入

| front 的問題 | 答案 | 怎麼量的 |
|---|---|---|
| sku 上有沒有 trgm 索引? | 🔴 **沒有** | 全庫 16 支 trgm 索引逐支列出, **沒有一支在 `product_variants`** |
| sku 上有沒有【任何】索引? | ⚠️ **有一支, 而它幫不上忙** | `product_variants_supplier_sku_key` = `UNIQUE btree (supplier_slug, sku)` —— **sku 是複合鍵的第二欄** ⇒ 單獨查 sku 用不到它 |
| `product_variants_public` 有沒有濾掉下架? | ✅ **有, 而不是靠 view** | view 本體**零 `WHERE`**(`20260602135934:137-150` 只是投影);濾的是 **RLS**:policy `product_variants_select_public` 的 `USING` = `EXISTS(products p WHERE p.id = product_id AND p.delisted_at IS NULL)` |
| 那 RLS 在這條路上會生效嗎? | ⚠️ **必要條件成立, 而【不足以下結論】**(codex MF3;原本我寫 ✅ 會) | view 是 `security_invoker = true`, 而 `storefront_search_product_ids` 的 `prosecdef = **f**`(正式庫親查)⇒ 以呼叫者身分跑 ⇒ anon 吃得到 policy |
| 零價變體呢? | 🔴 **沒有濾** | 那條 policy 只看**母商品下架**, 不看變體自己的價格或狀態 ⇒ 要濾得自己加條件 |

🔬 **數法(可重跑, 唯讀零寫入;走 `bash scripts/readonly-prod-sql.sh <你的.sql>`)**:
```sql
-- trgm 索引全清單(得 16 支, product_variants 佔 0 支)
SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public' AND indexdef ILIKE '%trgm%';
-- product_variants 上真的有哪些索引(得 6 支)
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='product_variants';
-- 🟢 正對照:一支一定在的索引 ⇒ 1 · 🔴 負對照:現造索引名 ⇒ 0
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_product_variants_product_id';
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='zzq_never_existed_idx';
-- 量級(得 59841 / 59841)
SELECT count(*), count(*) FILTER (WHERE sku IS NOT NULL AND btrim(sku) <> '') FROM public.product_variants;
```
⚠️ **射程**:2026-09-06 18:5x 單發、正式庫、唯讀。索引清單是**那一刻**的;有人加索引它就變。

### 🔴 而我順手撞到一件不在交辦裡的事

`20260904010000_m4b_storefront_search_partno_indexable.sql` 建的那支索引 **在量測時不存在於正式庫** ——
(⛔ ~~原本我寫「真的沒貼進正式庫」~~ ⇒ codex N2:同一個讀數也可能來自**套用後被刪 / 改名 / 回滾**)
它建的索引 `products_external_id_normalized_idx` 在正式庫 ⇒ **0**。數法(同一支唯讀 SQL):
```sql
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='products_external_id_normalized_idx';  -- ⇒ 0
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='idx_product_variants_product_id';      -- 🟢 正對照 ⇒ 1
SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='zzq_never_existed_idx';                -- 🔴 負對照 ⇒ 0
```
它建了什麼:`grep -nE '^[[:space:]]*CREATE' supabase/migrations/20260904010000_*.sql`。
🛑 **而那不是「帳本沒記」而已** —— 它是**新物件, 沒貼就不存在**, 判別力滿的那種證物。
⇒ 📌 **那一代的名字叫 `indexable`, 而讓它 indexable 的那個索引不在線上。**
　 後面兩代是 `CREATE OR REPLACE` ⇒ **函式本體是最新的, 少的只有索引** ⇒ 那段正規化前綴比對**今天在正式庫是全表掃**。
⇒ ⏰ 這件**不併進本片**(它是另一支 migration 的事), 另開板列。

---

## 1. 要改什麼

`supabase/migrations/<新版本號>_m4b_storefront_search_variant_sku.sql` —— 一支 `CREATE OR REPLACE FUNCTION`,
**簽章與本體逐字抄自 `20260904180000_m4b_storefront_search_partno_long_numeric.sql:215`**, 只加第 ④ 塊:

```sql
    UNION ALL
    -- ④ 變體料號:形狀【逐字鏡射第 ③ 塊】, 只把 products_public.external_id 換成 product_variants_public.sku
    SELECT pv.product_id AS id, t.ord
      FROM public.product_variants_public pv
      JOIN t ON (
             t.term ~ '[0-9]'
         AND ( t.term ~ '[A-Za-z]'
            OR length(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) >= 7 )
         AND upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) <> ''
         AND upper(regexp_replace(pv.sku, '[^A-Za-z0-9]', '', 'g'))
             LIKE upper(regexp_replace(t.term, '[^A-Za-z0-9]', '', 'g')) || '%'
      )
```

**為什麼逐字鏡射第 ③ 塊, 而不是寫 `ILIKE '%sku%'`**:
- 第 ③ 塊那三個條件的註解逐字寫著「**三個條件缺一不可, 而少了第一個會【回傳整張表】**」——
  中文詞正規化後是空字串 ⇒ `LIKE '%'` ⇒ 命中每一列, 而**HTTP 200、畫面完全正常**。
  ⇒ 📌 這三個坑在 sku 這一塊**一模一樣**, 抄形狀等於把已經付過的學費一起抄過來。
- `ILIKE '%AZ203%'` 走不到任何索引 —— 依據就是 §0 那份 `pg_indexes` 清單(sku 上只有複合唯一鍵的第二欄), 
  而 `PET52R` / `AZ203B` 這種**是前綴查得到的**。⚠️ **「前綴查得到」我還沒對正式庫實測** ——
  它是從 Sean 打的那兩個詞的形狀推的, §2 的 EXPLAIN 那一步才會把它變成讀數。

**不動的東西(front 交代 + 我自己加的)**:
- ✅ `WHERE n.want > 0` 與 `HAVING count(DISTINCT h.ord) = n.want` **一個字不動** —— 加的是 `hits` 裡的一塊, 那兩行在外面。
- ✅ `UNION ALL` 的層級仍在【(商品, 詞)】那一層(第 ④ 塊吐的是 `pv.product_id AS id`)—— 檔頭逐字「不可以搬到商品那一層」。
- ✅ 不新建物件、不動 `GRANT`。⚠️ **而 §3 的索引是例外, 見那一節。**
- ✅ 不寫 `SECURITY DEFINER`、不寫 `SET search_path`(檔頭逐字「那是本片的安全前提」, 且有事後閘釘住)。

---

## 2. 🔴 這一片最該先講的風險:它會讓搜尋變慢, 而慢多少我還沒量

`product_variants` **59,841 列**, 而 sku 上**沒有可用索引**
⇒ 第 ④ 塊的 `upper(regexp_replace(pv.sku, …)) LIKE …` 是**運算式**, 而 sku 上沒有可用的前綴索引
⇒ **預期是全表掃**。⛔ ~~原本我寫「planner 無論如何都要全表掃 + 每列算一次 regexp」~~ ——
codex N1:無合格詞時可能根本不掃、多詞可能重算、RLS 也改變處理列數 ⇒ **實際計畫要 EXPLAIN 才算數**。

🛑 **而第 ③ 塊今天已經是這樣了**(因為 `20260904010000` 那支沒貼)⇒ 本片是**在一個已經全表掃的路徑上再加一次全表掃**。

⇒ **驗收條件必須包含【修前修後兩個讀數】**, 不是只有「搜得到了」:
```
量法:對正式庫 EXPLAIN (ANALYZE, BUFFERS) 跑同一組詞, 修前 / 修後各一發
詞集:PET52R · AZ203B(Sean 打的那兩個)+ 一個中文詞 + 一個負對照(不存在的料號)
🔴 中文詞那一發要看第 ④ 塊有沒有印 `never executed` —— 第 ③ 塊今天是印的, ④ 應該一樣
```
⚠️ **我還沒量。** 這是 plan, 不是結果。

---

## 3. 索引要不要一起加(要主視窗拍)

**甲 = 不加索引**,只加第 ④ 塊。優點:改動面最小、零新物件。代價:59,841 列每次搜尋多掃一遍。
**乙 = 一併加一支運算式索引**
```sql
CREATE INDEX product_variants_sku_normalized_idx ON public.product_variants
  ((upper(regexp_replace(sku, '[^A-Za-z0-9]', '', 'g'))) text_pattern_ops);
```
　🔵 **而「不新建物件」這條規矩在這裡要拆開讀**:
　**索引【沒有 ACL】** —— `pg_class.relacl` 對 index 是空的, `GRANT` / `REVOKE` 對它無意義
　⇒ 📌 **加索引【不會】動到任何權限面**, 它與「新建 view / 函式」不是同一類風險。
　⚠️ 代價是**建索引要鎖表**(59,841 列, 要 `CONCURRENTLY` 或挑離峰), 而那是**部署動作**不是 SQL 風格題。
　🔴 **而乙有一個先決問題**:`20260904010000` 那支(做同一件事給 `external_id`)**沒貼** ——
　　**先搞清楚那一支為什麼沒貼**, 再決定要不要用同一個形狀再來一支。

**我推薦:先甲, 而把乙寫成板列**(理由:量都還沒量, 而先加索引會讓「加了第 ④ 塊到底慢多少」量不出來)。

---

## 4. 影響面 / rollback / 片型

| 項 | 內容 |
|---|---|
| 動到的檔 | 一支新 migration(`CREATE OR REPLACE FUNCTION`)· 板列 |
| 影響面 | **顧客站搜尋**, 每一發搜尋都會走到 —— 所以 §2 的量測是**必要條件**不是加分項 |
| rollback | `CREATE OR REPLACE` 回 `20260904180000` 那一版(它逐字在 repo 裡)⇒ 一支 down.sql 一起交 |
| 片型 | **高風險片**(鐵則 12 ③ DB 結構)⇒ codex gpt-6-astra `--disable apps` |
| 🔴 貼的授權 | apply 要 Sean 說「貼 N」;本片只交檔, **不貼** |

---

## 5. 要主視窗拍的兩個字

1. ~~**索引**:甲(先不加, 推薦)· 乙(一併加)~~ ⇒ ✅ **主視窗已裁甲**, 而**理由比我當時寫的更硬**:
   不是「先量再說」, 是 **`text_pattern_ops` 那個形狀在這條查詢上本來就無效**(見 MF2 與 `⟦search-PATTERNCONSTIDX⟧`)。
2. **零價變體要不要濾**:丙(不濾, 與現況一致)· 丁(濾掉 `price_general` 為 0 或 NULL 的變體)
   —— 🔴 我沒有推薦, 因為那是**商業決定**:一個沒定價的變體要不要讓客人搜到, Sean 說了算。
