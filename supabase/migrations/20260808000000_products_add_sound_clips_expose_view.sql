-- ============================================================
-- 附件線片 3a:products 加 sound_clips + 公開 view 曝露(排氣聲浪音檔)
-- ============================================================
-- 真權威 = 報價單側交接檔 `docs/handoff/2026-08-07-f-line-attachments-final-handoff.md` §4;
--   報價單庫 storefront_catalog_v 第 30 欄 sound_clips jsonb [{title,url}] 已上正式庫(2026-08-07)。
--   本 migration 讓顧客庫存得下、前台讀得到;前台顯示區塊等 OD 稿另開片。
-- 照抄範本 = 20260719150000_catalog_product_image_trim.sql(**現行** view 定義 19 欄 + trim JOIN)。
--   🔴 **不要照 20260709120000 那份 18 欄範本抄** —— 它早於 trim 片,照它重述會把 card_image_trim
--      整欄回退掉(CREATE OR REPLACE VIEW 是整份取代、不是差異套用)。
--   本檔撰寫前實查:PostgREST 打線上 products_public 取實際欄位 = 19 欄、末欄 card_image_trim,
--   與 20260719150000 檔案內容逐欄一致(零漂移)。
-- 鐵則 8(動 schema + 共用 view)+ 鐵則 12③(動 schema)。
--
-- 四動作(原子、單 migration):
--   1. products 加 sound_clips jsonb NOT NULL DEFAULT '[]'(結構化 [{title,url}]、與 manuals 同族慣例)。
--   2. 欄位級 GRANT SELECT (sound_clips) 給 anon/authenticated —— products 走欄位級 grant 模型
--      (20260519031049 REVOKE ALL + 逐欄 GRANT)、products_public 為 security_invoker view 靠呼叫者權限;
--      漏此 grant → 前台讀 view 撞 permission denied(同 manuals 20260709120000 L45)。
--   3. products_public 末欄 append sound_clips(19 → 20 欄;CREATE OR REPLACE VIEW 僅允許末尾 append)。
--   4. NOTIFY pgrst 'reload schema'(view 加欄 = schema metadata 變更;缺此步 Data API 對新欄回
--      schema cache 錯誤 —— 20260719150000 的 codex 關卡2 MF-6,07-09 那份舊範本沒有這步)。
--
-- 🔴 經銷防護不削弱:sound_clips 是顧客可見的排氣聲浪連結(非價格);
--    view SELECT 仍排除 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不漏;
--    寫入權限 REVOKE(20260605120000)不受 CREATE OR REPLACE 影響(不 drop view、既有 grant 保留)。
--    products_list_public / product_variants_public 不動(卡片/變體頁不顯示附件)。
--
-- 🔴 **apply 硬前置(跨 apply 停點,memory feedback_app-layer-must-not-ship-before-migration-apply)**:
--    同片的 importer 接線(rpm-fetch VIEW_COLS + rpm-transform sound_clips)在本 migration **apply 之前
--    絕對不得上線跑** —— 欄不存在時 upsert 會整批失敗、該供應商同步全掛。
--    apply 後的觀測點 = PostgREST 對 products_public 具名 select sound_clips 拿得到 200(不是只看 migration 跑完)。
--
-- 資料寫入:sound_clips 由 rpm 同步管線寫(supplier-config.syncInstallResources gate);
--   來源僅 akrapovic 有值(364 群 / 719 段、2026-08-08 00:4x 唯讀實查)、其餘 14 家永遠 null
--   → 走 transform 的「來源 null 省 key」規則 → 不覆寫 → DEFAULT [] 天然空、前台 guard 不渲染。
--   🔴 title 存**原始英文原文、不在管線中文化**:實測 719 段有 112 種型別詞(小寫正規化後 93 種),
--   交接檔說的「三種中文名」對不上其中 36%(260 段)、且會讓 14 群出現同名段落無法比較;
--   中文化口徑待 Sean 拍板(片 3b),存原文可逆、烤進 DB 不可逆。
--
-- ⚠️ 本 migration **只寫檔、今晚不 apply**(與 W 線 pending 批同模式;獨立檔名時戳、不併批)。
--
-- Rollback(Supabase forward-only、僅 incident response、可手動執行):見檔尾。
-- ============================================================


-- ── 1. products 加 sound_clips(jsonb 結構化陣列、預設空)──
ALTER TABLE products ADD COLUMN sound_clips jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.sound_clips IS
  '排氣聲浪音檔清單(jsonb 物件陣列 [{title,url}]、如 [{"title":"Stock exhaust; BMW S 1000 RR","url":"https://.../x.wav"}])。來源=報價單 storefront_catalog_v.sound_clips、經 rpm 同步管線群級彙整 + http(s) 濾 + URL 去重保序。title=**來源英文原文未翻譯**(中文化在顯示層做、口徑待拍板;實測 719 段有 112 種型別詞,非交接檔所述三種);約 3.8% 段落 title 為 null,顯示層需給中性 fallback。僅 akrapovic 有值(364 群)、其餘 14 家恆 []。DEFAULT [] = 未同步/無音檔天然空,前台 guard 空陣列不渲染。🔴 檔案多為 .wav 且很大,前台絕不 autoplay/preload、點了才載入。';


-- ── 2. 欄位級 GRANT(security_invoker view 需呼叫者對此欄有 SELECT;漏 grant → view permission denied)──
GRANT SELECT (sound_clips) ON products TO anon, authenticated;


-- ── 3. products_public 末欄 append sound_clips(19 → 20 欄)──
-- ⚠️ 經銷防護回歸點:以下 SELECT 只比現行(20260719150000)多末一欄 p.sound_clips、
--    絕無 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不可漏;
--    card_image_trim 的 LEFT JOIN 與 CASE 表達式逐字保留(漏抄 = 該欄靜默消失、商品卡去白邊失效)。
CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
SELECT
  p.id,
  p.external_id,
  p.title,
  p.subtitle,
  p.description,
  p.handle,
  p.fitments,
  p.images,
  p.availability,
  p.brand_id,
  p.category_id,
  p.created_at,
  p.updated_at,
  p.price_general,
  p.supplier_slug,
  p.highlights,
  p.manuals,
  p.video_url,
  CASE WHEN t.url IS NULL THEN NULL ELSE jsonb_build_object(
    'l', t.bbox_left, 't', t.bbox_top, 'w', t.bbox_width, 'h', t.bbox_height,
    'nw', t.natural_width, 'nh', t.natural_height) END AS card_image_trim,
  p.sound_clips
FROM products p
LEFT JOIN public.product_image_trim t ON t.url = p.images ->> 0 AND t.status = 'ok';

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(附件片 3a 加末欄 sound_clips、共 20 欄):含 price_general / supplier_slug / highlights / manuals / video_url / card_image_trim / sound_clips,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。card_image_trim=首圖去白邊 bbox jsonb {l,t,w,h,nw,nh} 或 null(product_image_trim status=ok 才有)。sound_clips=排氣聲浪 [{title,url}]、title 為來源英文原文。';


-- ── 4. PostgREST schema cache reload(view 加欄=schema metadata 變更;
--       缺此步 → Data API 對 sound_clips 回 schema cache 錯誤;沿用 20260719150000 codex 關卡2 MF-6)──
NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Rollback(forward-only、僅 incident response)
-- ============================================================
-- 🔴 **本檔刻意不內嵌可貼上執行的 rollback SQL** —— 沿用 20260719150000:251-252 的規矩
--    (codex 關卡2 MF-5):內嵌簡化版會在 incident 當下誤導操作。這裡只列必要步驟與各步的陷阱,
--    真要退場請照下面順序自行組 SQL 並先在拋棄式 PG 實測來回貫通。
--
-- ⚠️ 兩個會讓「看起來合理」的簡化版直接卡死的限制(先知道再動手):
--   1. **PG 不允許 `CREATE OR REPLACE VIEW` 減欄**(20 → 19 欄會報 42P16)⇒ view 還原**必走 DROP + CREATE**。
--   2. view 仍依賴 products.sound_clips 時 `ALTER TABLE ... DROP COLUMN` 會報 2BP01 ⇒ **順序不可對調**。
--
-- 正確步驟(每步都要做,漏第 3 步 = 靜默把寫權限還給 anon;①-④ 請包在**單一交易**內 ——
--   DROP 與 CREATE 之間前台商品頁讀 view 會直接報錯):
--   ① DROP VIEW public.products_public;
--   ② 重建 **19 欄版** products_public —— 逐字取自 20260719150000 的 CREATE(含 security_invoker=true、
--      LEFT JOIN product_image_trim、card_image_trim 的 CASE 表達式),不要憑記憶重打。
--   ③ 重下 grant:`GRANT SELECT ON products_public TO anon, authenticated;`
--      **並重跑 20260605120000:69 的寫權限 REVOKE**(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE,
--      REFERENCES, TRIGGER ON public.products_public FROM anon, authenticated;`)。
--      為什麼非做不可(兩個機制都會咬人,任一成立就必須重跑):①ACL 隨物件消滅,DROP VIEW 把該 view
--      上的 grant 一併帶走 ②Supabase 的 default privileges 會在 re-CREATE 時自動 GRANT ALL ——
--      本 repo 自證:20260605120000 正是對「從未顯式 GRANT 過寫入」的 view 做 REVOKE。
--      只補 SELECT 而不重跑 REVOKE = 靜默把當初收掉的寫權限又打開。
--   ④ 還原 COMMENT ON VIEW 為 20260719150000 的 19 欄版字面。
--   ⑤ `REVOKE SELECT (sound_clips) ON products FROM anon, authenticated;`
--   ⑥ `ALTER TABLE products DROP COLUMN sound_clips;`(此時無 view 依賴、才不會 2BP01)
--   ⑦ `NOTIFY pgrst, 'reload schema';`
--
-- ⚠️ 本 rollback **未實測**(本片未跑拋棄式 PG 演練),故不以「可執行」字面呈現。
--    正常退場一律走新時戳 forward-only migration,不用本段。
-- ============================================================
