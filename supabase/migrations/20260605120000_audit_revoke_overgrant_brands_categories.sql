-- ============================================================
-- 安全稽核 batch 2:收斂 anon + authenticated 多餘寫權限(least-privilege、一次關閉 M-1 finding 兩半)
--   ① base 表:brands / categories
--   ② public view:products_public / product_variants_public
-- ============================================================
-- 對齊:
--   docs/reviews/2026-06-05-security-audit-report.md(Phase 1 finding M-1;含 base 表 + view 兩半 + 修法)
--   docs/reviews/2026-06-05-audit-phase2-review-log.md「batch 2」段(審查側獨立 MCP 實測)
--   Sean 拍板 B → A(2026-06-05:先收 base 表、再追加 view 半一次關完 M-1;附精確 spec + 🔴 保留 SELECT 戒律)
-- 鐵則 8 重大改動(動 grant / migration)+ 鐵則 12 敏感(security / GRANT / migration)。
--
-- 背景(finding M-1 兩半):
--   ① brands + categories 兩張公開查找 base 表;② products_public + product_variants_public 兩個公開 view。
--   四個物件,anon 與 authenticated 兩 role 各自持有
--   {INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER} 全套寫權限
--   —— Supabase 預設 grant 全開 footgun、靠 RLS / security_invoker 當閘。
--   public role 對四物件皆無 grant、service_role 為 admin/sync 正當寫入路徑(皆不動)。
--
-- 為何要做(least-privilege、修 fragile defense-in-depth gap):
--   ① base 表:目前打不出寫入靠「API 表面 + FK」而非最小權限——
--        INSERT/UPDATE/DELETE 被 RLS default-deny(兩表僅 service_role 寫 policy)擋;
--        TRUNCATE **不受 RLS 管**,僅因 PostgREST 不暴露 + 無 anon 直連 login + FK(products→brands/categories)
--        擋裸 TRUNCATE 而打不出來。→ 收掉這些用不到的權限,補上 TRUNCATE 這個 RLS 管不到的縫。
--   ② view:更 inert——security_invoker=true → 寫入以 caller(anon)權限落到 base 表 → anon base 表無寫權 → 42501;
--        且 view 無法 TRUNCATE;MCP 實測兩 view 無 INSTEAD OF trigger(information_schema.triggers 空)
--        亦無寫入 INSTEAD rule(pg_rewrite 僅各一筆 _RETURN/ON SELECT rule)→ 無任何可繞過 security_invoker
--        讓寫入真的成立的機制。
--        雖更打不出,仍屬「用不到的權限」,一併收乾淨關完 M-1。
--
-- 🔴🔴 絕不 REVOKE SELECT:
--   products_public = 前台讀商品主路徑、product_variants_public = 變體讀路徑;
--   誤收 SELECT 會害前台整頁空白。下方 REVOKE 清單嚴格只列 6 個非 SELECT 寫權限、SELECT 全程保留。
--
-- 經銷防護:N/A——
--   四物件 REVOKE 純收 grant,不動任何 view 定義 / RLS / column grant / 敏感欄;
--   products_public / product_variants_public 既有 SELECT 投射(已物理排除 price_by_tier / price_store / metadata /
--   cost)完全不變。不碰經銷防護鏈、無洩漏或回歸風險。
--
-- 影響面:零功能影響。
--   - 前台只 SELECT(四物件的 anon/authenticated SELECT 全保留)→ 讀路徑不受影響。
--   - 匯入 / 後台寫入走 service_role(不動)→ 寫路徑不受影響。
--   - anon/authenticated 的 DML 早被 RLS default-deny(base 表)/ security_invoker base 表無寫權(view)擋掉
--     → 收 grant 只移除「用不到的權限」、不改變任何可觀察行為。
--
-- 動手前真 DB 實測(來源=MCP execute_sql 唯讀查、2026-06-05;純 SELECT 無交易、零留痕;
--   SQL 字面本身不自證、權限現況以此唯讀查為憑):
--   四物件(brands / categories / products_public / product_variants_public),
--     anon 與 authenticated 各持 {SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER}(7 權限全套);
--     public role 對四物件零 grant(查無列);service_role 持全套(admin 寫入路徑);
--     兩 view 查 information_schema.triggers = 空(無 INSTEAD OF trigger)、查 pg_rewrite 僅各一筆
--     _RETURN(ON SELECT)rule(無 INSERT/UPDATE/DELETE 寫入 INSTEAD rule)→ 寫入無繞過 security_invoker 之路。
--   → 本 migration REVOKE 的 6 個非 SELECT 權限,REVOKE 前兩 role × 四物件皆確實持有(非 no-op);SELECT 不在 REVOKE 清單。
--   套用後行為驗證(SET LOCAL ROLE anon/authenticated:四物件 DML 應 permission denied、四物件 SELECT 應仍正常、
--   尤其兩 view SELECT 完整保留不傷讀路徑)交由審查 session 後-apply MCP 交易模擬執行 + sign-off。
--
-- ⚠️ 套用方式:走 supabase db push(不走 MCP apply_migration、避免時間戳 version drift)。
--   db push 時 repo ↔ 線上 schema_migrations 已零漂移(MCP 實測 2026-06-05、最近 8 顆全已套用)、
--   本顆為唯一 pending → db push 僅套此 REVOKE、不拖帶其他 migration。
--
-- Rollback(Supabase forward-only、僅供參考勿在正常流程執行;還原 = 退回 Supabase 預設全開 grant):見檔尾。
-- ============================================================


-- ── ① base 表:REVOKE 多餘寫權限(保留 SELECT;public / service_role 不動)──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brands     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.categories FROM anon, authenticated;

-- ── ② public view:REVOKE 多餘寫權限(🔴 保留 SELECT——前台讀商品/變體主路徑;public / service_role 不動)──
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.products_public         FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.product_variants_public FROM anon, authenticated;


-- ============================================================
-- Rollback(forward-only、勿在正常流程執行;還原 Supabase 預設全開寫權限):
-- ============================================================
-- -- ① base 表:
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.brands     TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.categories TO anon, authenticated;
-- -- ② public view:
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.products_public         TO anon, authenticated;
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.product_variants_public TO anon, authenticated;
-- 註:不建議回復(回復 = 退回多餘寫權限 + RLS 管不到的 TRUNCATE 縫);RLS/security_invoker 寫限仍在、SELECT 全程未動。
-- ============================================================
