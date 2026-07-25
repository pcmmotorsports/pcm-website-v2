# 搜尋引擎方案偵察成果(2026-07-25;E0 開工前的事實底稿)

> **緣起**:Sean 2026-07-25 拍 Q2=A(先修搜尋)並追加需求逐字 ——「**搜尋引擎參考我們報價單的方式,或者有可以帶入的現成工具,因為我希望可以模糊搜尋,包含內文、標題、料號、車款、年份 都可以,甚至是類似關鍵字**」。
> **本檔性質**:**偵察事實底稿、不是 plan**。E0 的正式 slice plan 由接手 session 依本檔撰寫(需先答 §5 決策題)。
> **上位**:`docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md` §0b(拍板)+ §1.1(搜尋現況根因);既有搜尋線規劃 = `docs/specs/2026-07-12-search-vehicle-work-plan.md` §4。
> ⚠️ 本檔的 C 節(第三方工具)含次級來源,已逐項標示信心程度;**引用前請重新查證**。

---

## 1. 🔴 最重要的一件事:我們早就拍板過搜尋技術

**ADR-0004 Q3=A1**(`docs/decisions/0004-m1-pre-launch-decisions.md:35`,逐字):

```
| Q3 | Search engine | A1 PG tsvector + pg_jieba(實作分兩階段:dev 期 ILIKE / 上線後切) | M-1-03 起 dev 期 / M-6 切 |
```

同檔 `:59`:「Q3 兩階段 search:dev 期 ILIKE 跑 200 SKU 規模可用(p99 1-3s)…M-6 切 tsvector 對 5w SKU(p99 <100ms)」。

**完整設計已寫好**(`docs/architecture/supabase-schema-design.md:552-584`,逐字):

```sql
CREATE EXTENSION IF NOT EXISTS pg_jieba;
ALTER TABLE products ADD COLUMN search_tsv tsvector GENERATED ALWAYS AS (
  to_tsvector('jiebacfg', coalesce(title,'')||' '||coalesce(subtitle,'')||' '||coalesce(description,''))
) STORED;
CREATE INDEX idx_products_search_tsv ON products USING GIN (search_tsv);
```

查詢:`SELECT *, ts_rank(search_tsv, websearch_to_tsquery('jiebacfg', $1)) AS rank FROM products WHERE search_tsv @@ websearch_to_tsquery('jiebacfg', $1) ORDER BY rank DESC LIMIT 20;`(目標 p99 <100ms @ 5 萬 SKU)。

🔴 **現況 = 仍停在第一階段(ILIKE)**:`supabase/migrations/` 全樹 grep `CREATE EXTENSION` / `pg_trgm` / `pgroonga` / `unaccent` / `pg_jieba` / `tsvector` / `GIN` / `similarity(` → **只命中一處註解**(`20260507004826_init_products.sql:55`:「階段 3(tsvector + pg_jieba)推遲 backlog #35、Supabase Pro 升完觸發」)。
⇒ **零 extension、零 tsvector 欄位、零 GIN 索引、零 similarity()**。Supabase 現已是 Pro(memory `reference_pcm-platform-plans-vercel-hobby-supabase-pro`),**升 Pro 這個前置已消除**。

## 2. 需求 vs 現有能力落差

Sean 要五個欄面 + 模糊 + 近似詞。逐項對照:

| Sean 要的 | 現有 `searchByKeyword()` | 落差 |
| --- | --- | --- |
| 標題 | ✅ `title` | — |
| 內文 | ✅ `description`(+`subtitle`) | — |
| **料號** | ❌ 未含 | 料號在 `products.external_id`、變體在 `product_variants.sku` |
| **車款** | ❌ 未含 | 在 `products.fitments` jsonb(`motoBrand`/`modelCode`) |
| **年份** | ❌ 未含 | 在 `fitments` jsonb 的 `yearStart`/`yearEnd` |
| **模糊/錯字容錯** | ❌ ILIKE 只做子字串 | 需 pg_trgm 或分詞 |
| **類似關鍵字(近似詞)** | ❌ 無 | 需同義詞表 |

現行實作 = `packages/adapters/src/supabase/SupabaseProductAdapter.ts:357-383`,`SEARCHABLE_COLUMNS = ['title','subtitle','description']`(`product-query-support.ts:13`)、走 `products_public` view + ILIKE。**且零呼叫端**(見上位 plan §1.1)。

## 3. 報價單系統怎麼做(Sean 指定「參考我們報價單的方式」)

repo 實際路徑 = **`/Users/sean_1/API大量上架/PCM報價單-V2`**(⚠️ 不是 `/Users/sean_1/PCM_Quote`)。

**技術棧 = ILIKE 多欄 + 字典正規化 + 同義詞 RPC + 物化視圖**(不是 tsvector/pg_trgm):

1. **多欄 ILIKE**(`app/quotations/_lib/search.ts:288-300`,逐字):
   ```
   const orParts = [
     `brand.ilike.%${safe}%`, `model.ilike.%${safe}%`, `vehicle_label.ilike.%${safe}%`,
     `product_name.ilike.%${safe}%`, `category.ilike.%${safe}%`, `main_sku.ilike.%${safe}%`,
     `product_name_zh.ilike.%${safe}%`, `category_zh.ilike.%${safe}%`, `major_category_zh.ilike.%${safe}%`,
   ];
   ```
   查 `product_groups_mv` 物化視圖(pg_cron 每 10 分鐘 REFRESH);token 以空白/逗號拆、`splitCjkBoundary` 再斷中英界線、**多 token 間 AND**(多個 `.or()` 疊加)。
2. **車型+年份走專用 RPC**:`search_groups_model_year`(per-fitment 精準交集)、只選年份走 `search_groups_year`(`search.ts:141-149`)。
3. **料號反查**:`products.sku ilike` → 對到 `group_code` 合卡料號(`:249-286`)。
4. **同義詞擴展**:`expand_synonyms` RPC(`:214-233`)+ `term_synonyms` 表(在地俗稱 → 部件正名,例「魚骨貼」→「油箱止滑貼」)。
5. **別名字典 `model_dictionary`**(`supabase/migrations/20260512_init_schema.sql:51-71`):欄位 `brand / model_canonical / year_start / year_end / aliases text[] / generation_code / generation_years / confidence / status(normal|ignore|brand_alias)`。
6. **正規化**(`lib/dict_lookup.py:48-50`,逐字):`"""Normalize model 字串: 去重音 + 砍空白/連字號/底線 + lower (對齊 parser)."""` → `re.sub(r"[\s\-_]", "", strip_accents(s).lower())`。
7. **longest-match 最長別名優先**(`lib/fitment_parser.py:525`:`sorted_kws = sorted(kw.keys(), key=lambda k: -len(k))`;`:594` 同法)→ 這是解「`2021MT09護蓋`」連寫的關鍵。
8. 另有 `model_family_closure_mv`(母款展開子款樹)、`category_variant_rule`、`DictCache` 世代消歧(year-aware,`lib/dict_lookup.py:128-346`)。
9. 🔴 **字典只授 service_role、不對外**。

### 🔴 報價單踩過的血淚教訓(必須帶進網站側)

`search.ts:244-246` 逐字:

> `order('sku') 不可省: LIMIT 無 ORDER BY 時資料庫可以回任意 200 列。實測 2026-07-22 同一個 token 連跑五次拿到 123/100/137/96/129 個不同 main_sku`

⇒ **任何帶 LIMIT 的搜尋查詢必須有決定性 ORDER BY**,否則同一關鍵字每次結果不同。網站側 `fetchRelatedProducts` 已有同款註解(「以 handle 升冪排序後取前 N…決定性」),但新寫的搜尋路徑要重新守。

## 4. 技術選項實況(只列事實,不做推薦)

| 方案 | 事實 | 來源 / 信心 |
| --- | --- | --- |
| **tsvector + pg_jieba** | 我方 ADR-0004 已拍板;設計 SQL 已寫好;中文需分詞 extension(標準 PG `to_tsvector('simple'/'english')` 不分中文) | ✅ 高(自家文件逐字) |
| **pg_trgm** | Supabase 支援;trigram 相似度做模糊/錯字容錯,可建 GIN/GiST 加速 `similarity()` / `<->` | ⚠️ 中(未逐字引用官方原句) |
| **PGroonga** | Supabase **有官方專頁**(`supabase.com/docs/guides/database/extensions/pgroonga`)、出現在 dashboard extensions 選單;官方頁引 PGroonga 原話「wider range of character support… including Japanese, Chinese」。**是否需 Pro 該頁未寫明** | ⚠️ 中(頁面存在已確認、Pro 需求未確認) |
| **pgvector 語意搜尋** | Supabase **所有方案都含 pgvector**,支援 IVFFlat / HNSW(`supabase.com/docs/guides/ai/semantic-search`);本 repo 未使用 | ⚠️ 中 |
| Algolia | 免費 Build tier 10,000 records / 10,000 searches 月;SaaS 免自架;中文細節未確認 | ⚠️ 低-中 |
| Meilisearch | 開源可自架(免費);Cloud 約 $20/月起;官方稱對中文等有優化分詞 | ⚠️ 低-中(次級來源) |
| Typesense | 開源可自架;Cloud 約 $30/月起;第三方評測稱 CJK 分詞較弱 | 🔴 低(次級來源、非官方自陳) |

🔴 **既有規劃已對 PGroonga 設過關卡**:`2026-07-12-search-vehicle-work-plan.md` §4⑤ 明寫「**PGroonga 先 spike 再決定**(非零維運,要 precision/recall 實測 + REINDEX runbook + 降級 ILIKE 演練 + SECURITY INVOKER)」。

## 5. 🔴 E0 開工前要 Sean 拍的決策題(接手 session 請照 Sean 風格出 prose code block)

1. **要不要現在就切 tsvector + pg_jieba(履行 ADR-0004),還是先做「多欄 ILIKE + 字典」的報價單同款方案?**
   - 前者=履行既有 ADR、對 5 萬 SKU 才有效能保障,但要裝 extension + migration + Sean db push。
   - 後者=零 extension、與報價單同一套心智模型、可先上線;但模糊/錯字容錯弱、大量 SKU 效能差。
   - (兩者非互斥:可先做後者、tsvector 排後面;也可一次到位。)
2. **別名字典要不要跨庫帶進網站?** 報價單的 `model_dictionary` / `term_synonyms` 只授 service_role。既有規劃 §4② 提的做法是「**每日快照本地化**」(`search_aliases` + `term_synonyms` + `catalog_version` 原子切版)、不即時跨庫 RPC。要 Sean 確認是否採此法(涉跨 repo 資料流)。
3. **搜尋結果要顯示幾組?** design 彈窗有四組(商品/品牌/分類/車款);只做商品=**須明列為經核准的 design 偏離**(鐵則 1)。
4. **料號搜尋要不要含變體 SKU?** 網站商品有 `products.external_id` 與 `product_variants.sku` 兩層;報價單有「料號反查 → 合卡 group_code」的既有做法。

## 6. E0 實作必守(不論選哪個方案)

- 🔴 **決定性 ORDER BY**(§3 血淚教訓)。
- 🔴 **經銷價零外洩**:搜尋讀取一律走 `products_public` / `products_list_public`(排除 `price_store` / `price_by_tier`);結果 DTO 釘 `general`(鏡像 `fetchFeaturedProducts` 既有做法)。
- 🔴 **keyword URL contract 碰 `products-url-state.tsx`** = #287/#288 的高風險 URL-state 禁區(Next segment cache key 碰撞前科)→ 動它要提 plan。
- 🔴 **`searchByKeyword()` 是資料層 adapter 方法、不能從 client component 直呼** → 需 server action 或 route handler 邊界。
- design 真權威 = `design-reference/components/SearchOverlay.jsx`(205 行);監聽器範例 = `design-reference/components/App.jsx:346`。搬運照鐵則 1「直接搬、不翻譯」。
- 樣式檔 `search-overlay.css` 目前**不存在**(`layout.tsx:11` 註解提及)→ 需一併補。

## 7. 未確認項(接手 session 若要引用請重查)

- PGroonga 在 Supabase 是否需特定方案等級。
- pg_jieba 在 Supabase 的可用性(ADR 寫「Supabase Pro 升完觸發」,但**未實測該 extension 是否真的可在 Supabase 啟用**)—— 🔴 **這是 tsvector 路線的關鍵前置,務必先驗**。
- pg_trgm 官方原句、Algolia/Meilisearch/Typesense 的中文分詞實測品質。
