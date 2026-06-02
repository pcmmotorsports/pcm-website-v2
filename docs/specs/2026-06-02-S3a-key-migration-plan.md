# S3a — 唯一鍵切複合 + 廢 RPM- 前綴(schema migration plan)

> 2026-06-02 / 執行 session 產出。**鐵則 8 重大改動(動 schema/唯一鍵)+ 鐵則 12 敏感(碰商品主鍵、為停寫敏感成本鋪路)。等 codex 關卡1 + Sean 批才動手。**
> 決策基線:**Q1=A** 只做 RPM 一家 / **Q2=A** 獨立 `price_store` integer 欄留 NULL(S3b)/ **Q3=A** 拆 S3a(本片、改鍵)+ S3b(腳本改寫)。
> 上層 plan:`docs/specs/2026-06-02-quote-website-integration-phase1-plan.md`(§4 S3 / §8 風險)。偵察:`docs/specs/2026-06-02-S3-sync-rewrite-prep.md`。
> 目標 DB:網站本 repo Supabase `bmpnplmnldofgaohnaok`(套用走 Sean `supabase db push`、對齊 S1)。
> **審查鏈**:codex 關卡1 = **PASS**(0 must-fix);3 consider 採納(見 §2/§4/§5:transaction+LOCK 原子化 / rollback COUNT guard / 縮短 import 空窗)。

---

## 0. 一句話
S3a 把網站 `products`/`product_variants` 的全表單欄唯一鍵(`external_id` / `sku`)切成複合 `(supplier_slug, external_id)` / `(supplier_slug, sku)`,並把既有 933 列 `external_id` 的髒 `RPM-` 前綴一次性洗掉(`RPM-DCC01`→`DCC01`、D2 真主碼)。純 SQL migration、不動任何 `.ts`。為 S3b(腳本改讀乾淨 view + 複合 onConflict + 停寫敏感 metadata)鋪鍵。

## 1. 為什麼
- **廢前綴(D2)**:主料號真值 = `DCC01`;現 import 寫入端 `('rpm-'+mainSku).toUpperCase()` 造出髒 `RPM-DCC01`。S3 廢前綴 → `external_id` 存乾淨真碼。
- **複合鍵((supplier_slug, sku) 模型)**:報價單合約用 `(supplier_slug, sku)`;S1 只加了 `supplier_slug` 欄 + 普通 index、**唯一鍵切換明寫「留 S3」**(S1 migration L10/L41/L43)。S3b 的 upsert onConflict 要用複合鍵 → 必須先有複合 UNIQUE 約束(本片建)。
- **多供應商前瞻**:全表 `external_id`/`sku` UNIQUE 會擋「兩家同 sku」;改複合後跨家不撞(本片 RPM-only、為未來各家上架鋪路)。

## 2. 改什麼(精確 SQL、真 DB 約束名已 MCP 唯讀驗)
migration 檔(實作時建):`supabase/migrations/<ts>_s3a_composite_keys_drop_rpm_prefix.sql`

```sql
BEGIN;
-- 原子化 + 防 apply 中途舊 import 插髒(codex 關卡1 finding 1):整段包 transaction、
--   開頭即 ACCESS EXCLUSIVE LOCK 兩表(並發寫入擋到 COMMIT;任一 DDL 失敗全回滾、不留半遷移態)。
LOCK TABLE products, product_variants IN ACCESS EXCLUSIVE MODE;

-- ── 1. 資料搬遷:洗 external_id 髒 RPM- 前綴(933 列、大寫 RPM-DCC01 → DCC01)──
--    雙重精準 scope:supplier_slug='rpm' AND external_id LIKE 'RPM-%'(現只 rpm 933、防誤改;
--    與 rollback 對稱、審查守則 3)。external_id 仍 NOT NULL,只洗值不動欄定義。
UPDATE products
  SET external_id = regexp_replace(external_id, '^RPM-', '')
  WHERE supplier_slug = 'rpm'
    AND external_id LIKE 'RPM-%';

-- ── 2. products 唯一鍵:全表 (external_id) → 複合 (supplier_slug, external_id)──
ALTER TABLE products DROP CONSTRAINT products_external_id_key;
ALTER TABLE products ADD  CONSTRAINT products_supplier_external_id_key UNIQUE (supplier_slug, external_id);

-- ── 3. product_variants 唯一鍵:全表 (sku) → 複合 (supplier_slug, sku)──
--    sku 資料本已乾淨(無前綴)、零搬遷;pv_spec_unique(product_id, spec) 不動。
ALTER TABLE product_variants DROP CONSTRAINT product_variants_sku_key;
ALTER TABLE product_variants ADD  CONSTRAINT product_variants_supplier_sku_key UNIQUE (supplier_slug, sku);

COMMIT;
```

**不動(刻意)**:
- `products_handle_key` UNIQUE(handle) 全表保留(handle 供應商命名空間化 `rpm-{mainsku}`、跨家不撞、且前台 findByHandle 唯一查詢鍵)。
- `external_id` / `sku` 的 NOT NULL 保留。
- `supplier_slug NOT NULL DEFAULT 'rpm'` 保留(RPM-only;多供應商上架前再評估移 DEFAULT 防誤 default、留 follow-up、不在本片)。
- `pv_spec_unique(product_id, spec)`、PK、FK(brand/category RESTRICT、variant→product CASCADE)、RLS、grant、view 全不動。

## 3. 影響面(blast radius、Explore 全碼掃 + MCP 驗)
- **前台可見(預期、Sean 已知)**:規格表「產品型號」([ProductTabs.tsx:143](../../apps/storefront/src/components/ProductTabs.tsx) `productCode ?? slug`)+ JSON-LD sku([product-jsonld.ts:52](../../apps/storefront/src/lib/product-jsonld.ts))即時由 `RPM-DCC01` → `DCC01`(= D2 想要的結果)。**handle/URL 不變、SEO 不破**。
- **adapter/mapper 零改碼**:`external_id ↔ productCode` 純搬([product.ts:183/290](../../packages/adapters/src/supabase/mappers/product.ts))、無格式假設(全碼零 `replace('RPM-')`/`startsWith`/`split` 解析);findById 用 id、findByHandle 用 handle、**無 findByExternalId** → 查詢路徑零影響。dropping `UNIQUE(external_id)` 不影響任何讀路徑。
- **測試 fixture 獨立**:mapper/jsonld 測試寫死 `RPM-DCC01`(product.test.ts:151/157/159、product-jsonld.test.ts:57)= 獨立測試輸入、不連 live DB → 本片純 SQL 不動 `.ts`、**這些測試不跑也不紅**(可選 S6 更新 fixture 為 `DCC01` 求真實感、非必要、不在本片)。
- 🔴 **舊 rpm-import 套用後即壞**(審查守則 3):onConflict=`external_id`(單欄、已 drop)+ transform 仍加 `RPM-` 前綴 → S3a 後跑會失敗/造壞資料。**S3a 套用 → S3b 之間絕不可跑 rpm-import**;S3b onConflict 改複合鍵 + transform 去前綴才修。
- **cart discriminator**:[ProductInfo.tsx:142](../../apps/storefront/src/components/ProductInfo.tsx) 用 `sku` 當購物車 line key(假設全表唯一)。改複合後跨供應商 `sku` 理論可撞 → **RPM-only 現無此風險**;多供應商上架時再評估 cart key(follow-up、不在本片)。

## 4. Rollback(Supabase forward-only、僅供參考、可手動跑;審查守則 3:scope rpm)
```sql
-- 反向:複合鍵 → 全表單欄(現只 rpm 933、加其他家前才安全;順序=先還原資料前綴再加回全表 unique)
BEGIN;
LOCK TABLE products, product_variants IN ACCESS EXCLUSIVE MODE;

-- 前置 guard(codex 關卡1 finding 2):只有「零非 rpm 列」才允許 rollback、
--   防多供應商上架後誤跑、全表單欄 unique 還原撞跨供應商。
DO $$
BEGIN
  IF (SELECT count(*) FROM products         WHERE supplier_slug <> 'rpm') > 0
  OR (SELECT count(*) FROM product_variants WHERE supplier_slug <> 'rpm') > 0 THEN
    RAISE EXCEPTION 'S3a rollback 拒跑:存在非 rpm 列、還原全表單欄 unique 會撞跨供應商';
  END IF;
END $$;

ALTER TABLE product_variants DROP CONSTRAINT product_variants_supplier_sku_key;
ALTER TABLE product_variants ADD  CONSTRAINT product_variants_sku_key UNIQUE (sku);

ALTER TABLE products DROP CONSTRAINT products_supplier_external_id_key;
UPDATE products
  SET external_id = 'RPM-' || external_id
  WHERE supplier_slug = 'rpm'
    AND external_id NOT LIKE 'RPM-%';
ALTER TABLE products ADD  CONSTRAINT products_external_id_key UNIQUE (external_id);

COMMIT;
```
- ⚠️ rollback 的 `'RPM-'||external_id` **必 scope `supplier_slug='rpm'`**(現只 rpm、安全;未來有別家時誤 prefix 非 rpm 列會壞)。codex 關卡1 請審此點。
- 整體最壞:還原 S3a 前狀態(全表單欄唯一 + 髒前綴),前台照舊運作。

## 5. 操作順序 + S3a↔S3b 耦合(審查守則 3、固定)
1. 本 plan → **codex 關卡1**(`codex exec -s read-only` 審 plan vs view 合約 + rollback scope)→ Sean 批。
2. 實作:建 migration 檔 + 更新 STATUS 7 欄 → **三綠**(純 .sql/.md、typecheck+lint 跑、build N/A)→ **code-reviewer** → commit(精準 add、字面 vs 事實、**不 push**)。
3. Sean `supabase db push` 套用 → 審查 session 哨兵自動 fresh-context 複驗 + **codex 關卡2**(S3a 命中鐵則 8+12)+ live 查(複合鍵生效 / external_id 已洗 / 零碰撞 / 前台 productCode 變 DCC01、對齊 S1 §8.5 手法)。
4. 過了 → **接連 S3b**(腳本改寫 + 價格 delta gate);**db push → S3b commit 前禁跑非 dry-run `rpm-import`**(STATUS 明記、codex 關卡1 finding 3),**S3b 開工第一步先改 import 縮短空窗**。

## 6. 真 DB pre-flight(MCP 唯讀、2026-06-02、只查約束名 + count、不取金額)
- 約束名(真值):`products_external_id_key UNIQUE(external_id)` / `product_variants_sku_key UNIQUE(sku)` / 保留 `products_handle_key` + `pv_spec_unique` + 2 PK。
- products = **933**、全 `RPM-%` 前綴(非前綴 0)、supplier distinct=1、非 rpm 列 0;**洗前綴後 distinct=933 = total → 零碰撞**(複合 UNIQUE 安全)。
- variants = **7277**、supplier distinct=1、`(supplier_slug, sku)` distinct=7277、dup sku=0 → 複合 UNIQUE 安全。

## 7. Gates(PCM 紀律)
- 鐵則 8 → 本 plan 等 Sean 批。鐵則 12 → codex 關卡1(plan)+ 關卡2(diff、commit 後哨兵)、每片 codex 硬上限 2 輪。
- 三綠(typecheck+lint+build〔N/A 純 migration〕)+ code-reviewer + STATUS 7 欄同 commit + busboy-end + **不 push**。
- 🔴 S1→S3b 間勿經任何路徑寫 shopee/cost/source_* 到 metadata(S1 CHECK 拒);S3a 本片不寫 metadata。

## 8. 給 S3b 的接力備忘(非本片 scope、列此防遺漏)
- 🔴 **價格 delta gate**(審查守則 1):bulk 寫入前抽樣比對「網站現存 price_general vs view price_retail(by sku)」、清單給 Sean 點頭才上線;dry-run 不可略。
- 🔴 **Q2 別踩 CHECK**(審查守則 2):`price_by_tier.store` 被 CHECK 逼著要值、view 無經銷價 → 填 `price_retail` placeholder;**獨立 `price_store` integer 欄才留 NULL**(Q2=A)。
- env:`SOURCE_*` → `QUOTE_SUPABASE_URL` + `QUOTE_SUPABASE_PUBLISHABLE_KEY`(anon 唯讀、只讀 view、Sean 放 .env.local)。
- rpm-fetch 改讀單一 `storefront_catalog_v`(用 view `main_sku`/`vehicle_label`、省 computeMainSku regex + 第二查);transform 去前綴 + 停寫敏感 metadata;load onConflict 複合鍵。

— END —
