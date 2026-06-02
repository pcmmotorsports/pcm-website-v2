-- ============================================================
-- S3a:報價單↔網站整合 Phase 1 — 唯一鍵切複合 (supplier_slug, *) + 廢 RPM- 前綴
-- ============================================================
-- 對齊 docs/specs/2026-06-02-S3a-key-migration-plan.md(codex 關卡1 PASS、3 consider 採納)。
-- 鐵則 8 重大改動(動 schema/唯一鍵)+ 鐵則 12 敏感(碰商品主鍵、為 S3b 停寫敏感成本鋪路)。
--
-- 決策(Sean 拍):
--   Q1=A 只做 RPM 一家(本片改的是【網站現況】933 products / 7277 variants;8878=【報價單 B庫來源】RPM 變體數、S3b 同步目標、本片完全不碰;其他 5 家各別 slice 之後上)/
--   Q2=A 獨立 price_store integer 欄留 NULL(屬 S3b、本片不碰價)/
--   Q3=A 拆 S3a(本片改鍵)+ S3b(腳本改寫)。
--
-- 為什麼:
--   - 廢前綴(D2):主料號真值=DCC01;舊 import 寫入端 ('rpm-'+mainSku).toUpperCase() 造出髒 RPM-DCC01。
--   - 複合鍵:報價單合約用 (supplier_slug, sku);S1 只加 supplier_slug 欄 + 普通 index、唯一鍵切換明寫「留 S3」。
--     S3b upsert onConflict 要用複合鍵 → 本片先建複合 UNIQUE。
--
-- 🔴 經銷防護不碰(本片零削弱):不動 view / GRANT / RLS / price_store / price_by_tier / metadata / cost / shopee / source_*。
--
-- 真 DB pre-flight(MCP 唯讀、2026-06-02、只查約束名 + count、不取金額):
--   約束名真值:products_external_id_key UNIQUE(external_id) / product_variants_sku_key UNIQUE(sku);
--     保留 products_handle_key + pv_spec_unique + 2 PK。
--   products=933 全 RPM- 前綴(非前綴 0、非 rpm 列 0)、洗前綴後 distinct=933 → 零碰撞。
--   variants=7277、(supplier_slug, sku) distinct=7277、dup sku=0 → 複合 UNIQUE 安全。
--   交易模擬實測(BEGIN+套用+ROLLBACK、不含 LOCK):無錯(ADD UNIQUE 無碰撞即證零重複)、
--     ROLLBACK 後約束回原狀(零留痕、information_schema 複查 4 unique 約束原樣)。
--
-- 原子化(codex 關卡1 finding 1):整段包 BEGIN/COMMIT + 開頭 ACCESS EXCLUSIVE LOCK 兩表
--   (並發寫入擋到 COMMIT;任一 DDL 失敗全回滾、不留半遷移態)。
--
-- ⚠️ S3a↔S3b 耦合(審查守則 3 / codex 關卡1 finding 3):
--   本 migration 由 Sean supabase db push 套用後、舊 scripts/rpm-import.ts 即壞
--   (onConflict='external_id'/'sku' 單欄已 drop + transform 仍加 RPM- 前綴)。
--   → db push 到 S3b commit 前【禁跑非 dry-run rpm-import】;S3b 開工第一步先改 import 縮短空窗。
--
-- Rollback(Supabase forward-only、僅供參考、可手動執行):見檔尾(含 COUNT guard)。
-- ============================================================

BEGIN;

-- 原子化 + 防 apply 中途並發寫入髒資料(codex 關卡1 finding 1)
LOCK TABLE products, product_variants IN ACCESS EXCLUSIVE MODE;

-- ── 1. 資料搬遷:洗 external_id 髒 RPM- 前綴(933 列、大寫 RPM-DCC01 → DCC01)──
--    雙重精準 scope:supplier_slug='rpm' AND external_id LIKE 'RPM-%'(現只 rpm 933、防誤改;
--    與 rollback 對稱)。external_id 仍 NOT NULL、只洗值不動欄定義。
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


-- ============================================================
-- Rollback(forward-only、勿在正常流程執行;還原 S3a 前狀態、可手動跑;審查守則 3 + codex 關卡1 finding 2):
-- ============================================================
-- BEGIN;
-- LOCK TABLE products, product_variants IN ACCESS EXCLUSIVE MODE;
-- -- 前置 guard:只有「零非 rpm 列」才允許 rollback、防多供應商上架後誤跑、全表單欄 unique 還原撞跨供應商。
-- DO $$
-- BEGIN
--   IF (SELECT count(*) FROM products         WHERE supplier_slug <> 'rpm') > 0
--   OR (SELECT count(*) FROM product_variants WHERE supplier_slug <> 'rpm') > 0 THEN
--     RAISE EXCEPTION 'S3a rollback 拒跑:存在非 rpm 列、還原全表單欄 unique 會撞跨供應商';
--   END IF;
-- END $$;
-- ALTER TABLE product_variants DROP CONSTRAINT product_variants_supplier_sku_key;
-- ALTER TABLE product_variants ADD  CONSTRAINT product_variants_sku_key UNIQUE (sku);
-- ALTER TABLE products DROP CONSTRAINT products_supplier_external_id_key;
-- UPDATE products
--   SET external_id = 'RPM-' || external_id
--   WHERE supplier_slug = 'rpm'
--     AND external_id NOT LIKE 'RPM-%';
-- ALTER TABLE products ADD  CONSTRAINT products_external_id_key UNIQUE (external_id);
-- COMMIT;
-- ============================================================
