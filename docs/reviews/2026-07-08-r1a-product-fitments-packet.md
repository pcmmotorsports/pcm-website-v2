# Codex Review Packet — R1a product_fitments 正規化索引表(鐵則 12)

> **狀態:** 2026-07-08 Claude Code session(dev)產出、commit 前。**鐵則 12 觸發:migration + RLS + GRANT + schema。**
> **用途:** 供 Sean 上正式庫(db push)前可選貼 web Codex 做完全獨立的第三方審。
> **注意:** 本 slice **已跑本機 codex 關卡2 對抗審(gpt-5.5、唯讀)= round2 PASS 零 finding**(round1 抓 2 must-fix+1 nit 已折);另 Claude code-reviewer round1 抓 3 findings 亦全折。故此 Packet 為 belt-and-suspenders、非首審。

---

## 1. 這個 migration 做什麼

新表 `product_fitments` = 把 `products.fitments`(jsonb 陣列「相容車輛」)**正規化成一列一相容**的索引表,供推薦引擎「以車查商品」反查(現商品頁只能「以商品查車」,推薦 Case A 需反向)。**單一真相仍是 `products.fitments`;此表是 trigger 自動同步的衍生索引、可 DROP 重建。**

檔案:`supabase/migrations/20260708130000_create_product_fitments_index.sql`(141 行)。
真權威 plan:`docs/specs/2026-07-08-recommendation-engine-related-products-plan.md` v0.3 §3。

## 2. 相關 PCM 鐵則摘錄(Codex 無需 repo 即可審)

- **經銷價絕不外洩**:client/anon 不得讀到 `price_store`/`cost`/`price_by_tier`/`metadata`;查詢一律經 `products_public`(view 物理排除敏感欄)。
- **金額整數**:禁浮點處理價格(本表無價格欄)。
- **下架商品**:`products` 靠 RLS `products_select_public USING(delisted_at IS NULL)` 對 anon/authenticated 隱藏整列;衍生表需連動隱藏。
- **字面 vs 事實**:migration 註解宣稱 = 實際 DDL 行為,不得誇大。
- **既有慣例**:REVOKE ALL 移 Supabase 預設 over-grant(`20260531142533:86`);RLS delisted 連動範式(`20260602135934:67` product_variants_select_public)。

## 3. 安全模型(本表如何不洩漏)

- 表僅 `id/product_id/moto_brand/model_code/year_start/year_end` —— **無任何價格/敏感欄**。
- `REVOKE ALL PRIVILEGES ... FROM anon, authenticated` → 再 `GRANT SELECT` → anon/authenticated 僅讀(實測 INSERT/UPDATE/DELETE 皆 false)。
- `ENABLE ROW LEVEL SECURITY` + policy `product_fitments_select_public USING (EXISTS (SELECT 1 FROM products p WHERE p.id=product_id AND p.delisted_at IS NULL))` → 下架商品的 fitment 對 anon 隱藏(實測下架 634 列被閘)。
- 反查得 product_id 後,商品資料一律 join `products_public`(經銷價已物理剝離)。

## 4. fail-closed 防禦(trigger 絕不 abort products 寫入)

- 拆 **AFTER INSERT**(無 WHEN)+ **AFTER UPDATE OF fitments WHEN (OLD.fitments IS DISTINCT FROM NEW.fitments)**(值未變不觸發 → 每日 40k upsert 不 churn;`TG_OP` 不可用於 CREATE TRIGGER WHEN 故拆兩個)。
- 逐元素僅在 `jsonb_typeof(elem)='object'` + `motoBrand`/`modelCode` 為 **JSON 字串型**且 btrim 非空才成列(非字串如 `123`/`true` 跳過)。
- 年份文字正則 `^[0-9]{4}$` 白名單(4 位才取;float `2021.5`/超界 `99999`/字串垃圾 → NULL、**絕不 `::int` abort**);`year_end` 僅在 `year_start` 亦合法時取(守四態不變式、不產生非法 `(NULL,Y)`)。
- `CHECK (year_start IS NOT NULL OR year_end IS NULL)`(四態不變式;parse 保證不觸發、防直寫/regression)。
- 單一髒元素跳過、`SELECT DISTINCT` 去重、非 array → 0 列。

## 5. 年份四態(對齊 domain FitmentSpec.yearStart/yearEnd + resolveEnd)

| 語意 | year_start | year_end | 反查 Y 適用 |
|---|---|---|---|
| 無年份 | NULL | NULL | 通吃(任何 Y) |
| 單年 | Y | Y | Y==year |
| 區間 | A | B | A≤Y≤B |
| 開放式 | Y | NULL | Y≤year |

反查條件:`(year_start IS NULL) OR (year_start<=$Y AND (year_end IS NULL OR year_end>=$Y))`。

## 6. 已驗證(DDL 交易模擬 BEGIN...ROLLBACK 零留痕、正式庫實測)

- backfill 8384 列 / 2962 商品;四態總和吻合;illegal `(NULL,Y)` 列 = 0。
- UPDATE OF fitments trigger 同步正確;髒 jsonb(空/非物件/非字串/float/超界年份)不 abort、對應收斂為跳過或 NULL;DISTINCT 去重。
- anon:SELECT=true、INSERT/UPDATE/DELETE=false;下架 fitment 634 列被 RLS 閘。
- 反查 sample(Ducati Streetfighter V4 @2021)= 95 商品。
- 模擬後 information_schema 查:pf 表/function/trigger/測試資料 **全 0 殘留**。

## 7. 請 Codex 審(若 Sean 選擇貼 web Codex)

1. trigger/backfill 是否還有能 abort products 寫入的路徑(fail-closed 破口)?
2. RLS + REVOKE + GRANT 組合有無殘留寫權或洩漏下架/經銷價路徑?
3. 年份四態不變式 + CHECK 有無邏輯漏洞?
4. 索引 `ix_pf_lookup(moto_brand,model_code,year_start,year_end)` + `ix_pf_product` 對反查/NOT EXISTS/trigger DELETE 是否足夠(EXPLAIN 走 index 由 R1b db push 後實測)?
5. 字面 vs 事實:註解與 DDL 一致?

## 8. 施工序

R1a(本 migration、產本 Packet → commit → **不 push**)→ **Sean:①(可選)貼 web Codex ②`db push` 寫正式庫**(只有 Sean 能寫 prod)→ R1b(db push 後 types regen + EXPLAIN + RLS 行為驗)→ R2a/R2b(引擎資料層,可平行,單測走 InMemory 不依賴 prod 表)→ R3(前端橫滑區,Sean 肉眼驗)。
