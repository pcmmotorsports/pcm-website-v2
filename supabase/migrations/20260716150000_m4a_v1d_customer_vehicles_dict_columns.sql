-- V-1d-1:愛車車庫「源頭字典化」— customer_vehicles 加字典鍵兩欄(M-4a、2026-07-15)
--
-- 依 Sean 07-15 拍板「愛車沿用車款字典選擇、沒有再自行輸入」+ 值班台 V-1d 單/plan 關卡1 PASS
-- (docs/specs/2026-07-15-v1d-garage-dictionary-slug-plan.md)。additive、零 DROP、零資料轉換。
--
-- 🔴 語意=**字典名稱字面**(brand.name / model.name 逐字、如 'YAMAHA' / 'YZF-R6'),非合成 slug id。
--   與 plan §1 字面(taxonomy brand.id/model.id)的有意識偏離,理由(硬審單詳列):
--   taxonomy id=slugify(名稱)+撞名加 '-2' 序號去重(vehicle-taxonomy.ts uniqueId),字典演化下
--   序號可換位 → 持久化 id 有「靜默指錯車」向量;名稱字面=車種鐵律真相本體,精確比對永不錯指,
--   演化(改名)→ 查無 → 降級 REQUIRED-2 字面比對流(零猜)。
--
-- 不變式(值班台 REQUIRED-1 的 DB 層底線):兩欄恆成對(同 NULL 或同非 NULL),CHECK 強制;
--   server/adapter 層另負責 UPDATE 恆寫兩欄(dict=新對、free=雙 NULL),防舊值殘留。
-- 既有列不回填(NULL=自由輸入/舊資料;硬轉=替客人認錯車)。
-- RLS:既有 vehicles_*_own 四 policy 為 row 級、新欄自動涵蓋;GRANT 為表級
--   (20260523034911 L239-240 GRANT SELECT/INSERT/UPDATE/DELETE TO authenticated)、新欄自動涵蓋;
--   本支零新 GRANT/REVOKE 面。

ALTER TABLE public.customer_vehicles
  ADD COLUMN IF NOT EXISTS dict_brand_name text NULL,
  ADD COLUMN IF NOT EXISTS dict_model_name text NULL;

-- 成對不變式(既有列全 NULL/NULL、天然滿足;plain CHECK 即可、不需 NOT VALID)
ALTER TABLE public.customer_vehicles
  ADD CONSTRAINT customer_vehicles_dict_pair_chk
  CHECK ((dict_brand_name IS NULL) = (dict_model_name IS NULL));

COMMENT ON COLUMN public.customer_vehicles.dict_brand_name IS
  'V-1d:車輛字典品牌名稱字面(taxonomy brand.name 逐字;NULL=自由輸入/舊資料)。恆與 dict_model_name 成對(CHECK)。server 端寫入前驗存在於 taxonomy(fail-closed)。';
COMMENT ON COLUMN public.customer_vehicles.dict_model_name IS
  'V-1d:車輛字典車型名稱字面(taxonomy model.name 逐字、屬 dict_brand_name 該品牌;NULL=自由輸入/舊資料)。首頁愛車 chips:本欄有值走精確 lookup 直套、NULL 走 REQUIRED-2 字面比對流。';
