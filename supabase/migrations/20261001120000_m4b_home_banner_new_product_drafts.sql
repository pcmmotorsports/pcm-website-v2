-- 20261001120000 · M-4b 每日自動新品草稿:首頁大圖加「來源商品」與 FB / IG 文字, 系統建新品草稿, 發布前加紅字檢查。
--
-- 為什麼:Sean 2026-10-01 批准「每天自動產新品草稿」(計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md,
--   Q4 甲, 每天最多 3 份、每個品牌 1 份)。草稿 = 首頁大圖 + FB 文字 + IG 文字, 小編看過才發;
--   FB / IG 先用複製文字與下載圖片, Meta 自動發文是第二階段。
--
-- 改了什麼:
--   1. home_banners 加三欄:source_product_id(草稿來自哪個新商品, FK products ON DELETE SET NULL, 部分唯一 ⇒ 一個商品只建一份)、
--      fb_text、ig_text(各 ≤ 2200 字, IG 貼文上限)。source_product_id 與 source_email_id 不能同時有值。
--   2. system_new_product_draft(p_draft, p_request_id):每日 cron 建新品草稿。actor = system:new-product-draft,
--      rights_confirmed 一律 false;同一商品第二次 ⇒ 回 duplicate、不建。EXECUTE 只給 service_role。
--   3. admin_home_banner_save_social(...):後台改 FB / IG 文字。另開一支, 不改 admin_home_banner_save_draft 的參數
--      ⇒ 沒有「新 RPC 先上、舊後台叫不動」的空窗(CLAUDE.md:改既有函式簽章兩個方向都有空窗)。
--   4. admin_home_banner_publish:CREATE OR REPLACE, 本體逐字照抄 20260916180000(正式庫 2026-10-01 唯讀量
--      pg_get_functiondef md5 03c6d3432b3c08b555f875107edbd4ca, 例外訊息逐條與 repo 一致), 只多一段大圖文字紅字檢查。
--      🔴 SET search_path = '' 照抄(CREATE OR REPLACE 會把 SET 子句整組換掉)。
--
-- 🔴 部署順序:新欄位 + 新函式 ⇒ 板先貼, 程式才用。本支貼上去之後沒有任何程式讀新欄位、沒有排程呼叫新函式 ⇒ 零行為變化;
--   唯一立即生效的是發布多一道紅字檢查(現有草稿只要大圖文字沒有那幾個字, 行為不變)。
--   排程(每天 09:00 打 /api/cron/new-product-drafts)不在本支, 開旗標那天另外交(計畫片 6)。
-- 🔴 大圖的保固規則比 FB / IG 嚴(R1 F1):大圖一律不寫保固;FB / IG 的「原廠提供…」「品牌名 提供…」放行。
--   後台對大圖欄位要用 packages/domain 的 checkBannerCopy(同一份嚴規則), 不可用 FB / IG 那套 ⇒ 否則畫面綠、資料庫擋。
-- 🔴 給後台那一片(R1 F2):admin_home_banner_save_social 會更新 updated_at, 回傳新值;
--   後台存完 FB / IG 文字要把發布表單的 expected_updated_at 換成回傳值, 否則下一次發布一律「草稿剛被改過」。
-- 🔴 貼板時段(R1 F3):ADD COLUMN … REFERENCES products 與回滾的 DROP COLUMN 都要在 products 上短暫取鎖 ⇒
--   避開每天 07:45–08:30 的網站同步。貼完同批跑 pcm_acl_approve_latest(p_note 帶 20261001120000;0914 拍甲)。
-- 回滾:supabase/rollbacks/20261001120000-rollback.sql —— 刪兩支新函式、發布換回原版、刪三欄。
--   ⚠️ 回滾會丟掉草稿上的 FB / IG 文字與來源商品(大圖本身留著)。先停旗標與排程, 再跑回滾。

BEGIN;

-- ALTER TABLE ... ADD COLUMN ... REFERENCES products 會對 products 取 SHARE ROW EXCLUSIVE(瞬間);同步正在寫 ⇒ 夾 5s 不卡別人。
SET LOCAL lock_timeout = '5s';

DO $precondition$
DECLARE
  v_md5 text;
BEGIN
  -- 前置閘①:home_banners 在, 三個新欄位都還沒有
  IF pg_catalog.to_regclass('public.home_banners') IS NULL THEN
    RAISE EXCEPTION '前置閘①:home_banners 不在 ⇒ 20260916150000 還沒貼';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'home_banners'
                AND column_name IN ('source_product_id', 'fb_text', 'ig_text')) THEN
    RAISE EXCEPTION '前置閘①:home_banners 已經有新欄位 ⇒ 貼過了, 停下(要重來先跑 rollback)';
  END IF;
  -- 前置閘②:兩支新函式還不存在
  IF pg_catalog.to_regproc('public.system_new_product_draft') IS NOT NULL
     OR pg_catalog.to_regproc('public.admin_home_banner_save_social') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘②:新函式已存在 ⇒ 貼過了, 停下';
  END IF;
  -- 前置閘③:發布函式是 20260916180000 那一版(本支逐字照抄它)
  v_md5 := pg_catalog.md5(pg_catalog.pg_get_functiondef(
    'public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)'::regprocedure));
  IF v_md5 IS DISTINCT FROM '03c6d3432b3c08b555f875107edbd4ca' THEN
    RAISE EXCEPTION '前置閘③:admin_home_banner_publish 不是預期那一版(md5 %), 有人改過 ⇒ 先比對再貼', v_md5;
  END IF;
  -- 前置閘④:products.id 是 uuid(FK 要對得上)
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'id') IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION '前置閘④:products.id 不是 uuid';
  END IF;
END
$precondition$;

-- ── 1. 三個新欄位 ─────────────────────────────────────────────────────
ALTER TABLE public.home_banners
  ADD COLUMN source_product_id uuid REFERENCES public.products (id) ON DELETE SET NULL,
  ADD COLUMN fb_text text,
  ADD COLUMN ig_text text,
  ADD CONSTRAINT home_banners_fb_text_check CHECK (fb_text IS NULL OR char_length(fb_text) <= 2200),
  ADD CONSTRAINT home_banners_ig_text_check CHECK (ig_text IS NULL OR char_length(ig_text) <= 2200),
  ADD CONSTRAINT home_banners_one_source_check CHECK (source_product_id IS NULL OR source_email_id IS NULL);

-- 🔴 一個商品只建一份草稿;部分唯一 ⇒ ON CONFLICT 要帶相同的 WHERE(見 system_new_product_draft)
CREATE UNIQUE INDEX home_banners_source_product_id_key
  ON public.home_banners (source_product_id) WHERE source_product_id IS NOT NULL;

COMMENT ON COLUMN public.home_banners.source_product_id IS '每日自動新品草稿:這份草稿來自哪個新商品(20261001120000)。一個商品只建一份;商品被刪 ⇒ 變 NULL。';
COMMENT ON COLUMN public.home_banners.fb_text IS 'FB 貼文文字(20261001120000)。小編複製去 FB 貼;紅字檢查在 packages/domain/src/catalog/social-copy-rules.ts。';
COMMENT ON COLUMN public.home_banners.ig_text IS 'IG 貼文文字(20261001120000)。小編複製去 IG 貼;紅字檢查同 fb_text。';

-- ── 2. 系統建新品草稿 ─────────────────────────────────────────────────
CREATE FUNCTION public.system_new_product_draft(
  p_draft      jsonb,
  p_request_id text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c_actor      constant text := 'system:new-product-draft';
  v_request_id text := pg_catalog.btrim(p_request_id);
  v_product    uuid;
  v_title      text;
  v_link       text;
  v_image      text;
  v_banner     public.home_banners;
BEGIN
  IF v_request_id IS NULL OR v_request_id = '' OR p_draft IS NULL OR pg_catalog.jsonb_typeof(p_draft) <> 'object' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  v_product := NULLIF(p_draft ->> 'source_product_id', '')::uuid;
  v_title   := NULLIF(pg_catalog.btrim(p_draft ->> 'title_line1'), '');
  v_link    := NULLIF(pg_catalog.btrim(p_draft ->> 'link_path'), '');
  v_image   := NULLIF(pg_catalog.btrim(p_draft ->> 'image_desktop_url'), '');
  IF v_product IS NULL OR v_title IS NULL OR v_link IS NULL THEN
    RAISE EXCEPTION '新品草稿缺商品、標題第一行或連結';
  END IF;

  INSERT INTO public.home_banners (
    eyebrow, title_line1, title_line2, subtitle, cta_label, link_path,
    image_desktop_url, image_origin, image_kind, rights_confirmed,
    source_product_id, matched_variant_ids, fb_text, ig_text,
    created_by, updated_by)
  VALUES (
    NULLIF(pg_catalog.btrim(p_draft ->> 'eyebrow'), ''),
    v_title,
    NULLIF(pg_catalog.btrim(p_draft ->> 'title_line2'), ''),
    NULLIF(pg_catalog.btrim(p_draft ->> 'subtitle'), ''),
    NULLIF(pg_catalog.btrim(p_draft ->> 'cta_label'), ''),
    v_link,
    v_image,
    CASE WHEN v_image IS NULL THEN NULL ELSE 'supplier_url' END,
    'product',          -- 商品圖多半是白底方圖 ⇒ 用商品版型
    false,              -- 🔴 圖文能不能用一律由人確認
    v_product,
    CASE WHEN pg_catalog.jsonb_typeof(p_draft -> 'matched_variant_ids') = 'array'
         THEN ARRAY(SELECT x::uuid FROM pg_catalog.jsonb_array_elements_text(p_draft -> 'matched_variant_ids') AS x)
         ELSE '{}'::uuid[] END,
    NULLIF(pg_catalog.btrim(p_draft ->> 'fb_text'), ''),
    NULLIF(pg_catalog.btrim(p_draft ->> 'ig_text'), ''),
    c_actor,
    c_actor)
  ON CONFLICT (source_product_id) WHERE source_product_id IS NOT NULL DO NOTHING
  RETURNING * INTO v_banner;

  IF v_banner.id IS NULL THEN
    RETURN 'duplicate';
  END IF;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id)
  VALUES (c_actor, 'home_banner.draft_create', 'home_banner:' || v_banner.id::text, NULL,
          pg_catalog.to_jsonb(v_banner), 'source_product:' || v_product::text, v_request_id);

  RETURN 'created';
END
$fn$;

ALTER FUNCTION public.system_new_product_draft(jsonb, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.system_new_product_draft(jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.system_new_product_draft(jsonb, text) TO service_role;

COMMENT ON FUNCTION public.system_new_product_draft(jsonb, text) IS
  '每日自動新品草稿(20261001120000;Sean 2026-10-01 批准)。建一份首頁大圖草稿 + FB / IG 文字;actor = system:new-product-draft, rights_confirmed = false, image_kind = product。同一商品已有草稿 ⇒ 回 duplicate、不建。寫 admin_audit_log home_banner.draft_create(reason = source_product:<id>)。EXECUTE 只給 service_role。';

-- ── 3. 後台改 FB / IG 文字 ────────────────────────────────────────────
CREATE FUNCTION public.admin_home_banner_save_social(
  p_banner_id  uuid,
  p_fb_text    text,
  p_ig_text    text,
  p_actor      text,
  p_request_id text
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor      text := pg_catalog.btrim(p_actor);
  v_request_id text := pg_catalog.btrim(p_request_id);
  v_before     public.home_banners;
  v_after      public.home_banners;
BEGIN
  IF p_banner_id IS NULL OR v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status = 'archived' THEN
    RAISE EXCEPTION '已封存的大圖不能改 FB / IG 文字';
  END IF;

  UPDATE public.home_banners b
     SET fb_text = NULLIF(pg_catalog.btrim(p_fb_text), ''),
         ig_text = NULLIF(pg_catalog.btrim(p_ig_text), ''),
         updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
   WHERE b.id = p_banner_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.social_update', 'home_banner:' || p_banner_id::text,
          pg_catalog.jsonb_build_object('fb_text', v_before.fb_text, 'ig_text', v_before.ig_text),
          pg_catalog.jsonb_build_object('fb_text', v_after.fb_text, 'ig_text', v_after.ig_text), v_request_id);

  RETURN v_after.updated_at;
END
$fn$;

ALTER FUNCTION public.admin_home_banner_save_social(uuid, text, text, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_home_banner_save_social(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_home_banner_save_social(uuid, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_home_banner_save_social(uuid, text, text, text, text) IS
  '首頁大圖的 FB / IG 文字存檔(20261001120000)。所有在職員工;草稿與已發布都可以改, 已封存不行;空字串存成 NULL。回傳新的 updated_at(發布要帶它當 p_expected_updated_at)。寫 admin_audit_log home_banner.social_update(只記兩欄文字的前後)。EXECUTE 只給 service_role。';

-- ── 4. 發布:多一道大圖文字紅字檢查(其餘逐字照抄 20260916180000)──────────
CREATE OR REPLACE FUNCTION public.admin_home_banner_publish(
  p_banner_id           uuid,
  p_expected_updated_at timestamptz,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_actor               text,
  p_request_id          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor      text := pg_catalog.btrim(p_actor);
  v_request_id text := pg_catalog.btrim(p_request_id);
  v_before     public.home_banners;
  v_after      public.home_banners;
  v_starts     timestamptz;
  v_ends       timestamptz;
BEGIN
  IF p_banner_id IS NULL OR p_expected_updated_at IS NULL
     OR v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  -- 🔴 Sean 2026-09-16 Q5 乙:所有在職員工都可以發布(推翻限管理者)⇒ 這裡只驗在職
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION '只有草稿可以發布(這張是 %)', v_before.status;
  END IF;
  -- 🔴 按發布的人批准的是他預覽的那一版;中間有人存過草稿 ⇒ 不發,請他重看
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '草稿剛被改過,請重新確認內容再發布';
  END IF;
  IF NOT v_before.rights_confirmed THEN
    RAISE EXCEPTION '還沒確認圖文可以使用';
  END IF;
  IF v_before.title_line1 IS NULL OR v_before.link_path IS NULL OR v_before.image_desktop_url IS NULL THEN
    RAISE EXCEPTION '大圖缺標題、連結或電腦版圖片';
  END IF;
  -- 🔴 最低限度:已發布的連結一定要是站內商品 / 品牌頁(手動新增的也管)
  IF v_before.link_path !~ '^/(products|brands)($|[?/])' THEN
    RAISE EXCEPTION '連結要指到商品或品牌頁(/products… 或 /brands…),不能發布';
  END IF;
  -- 🔴 20261001120000:大圖文字的紅字檢查(Sean 2026-10-01 批准, 計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md)。
  --   大圖只是短標題 ⇒ 比 FB / IG 文字嚴:保固一律不寫在大圖上(FB / IG 的「原廠提供…」放行規則在 packages/domain 那支)。
  --   後台按鈕已經先擋, 這裡是最後一道 —— 員工繞過畫面直接呼叫也發不出去。
  IF pg_catalog.concat_ws(' ', v_before.eyebrow, v_before.title_line1, v_before.title_line2, v_before.subtitle, v_before.cta_label)
       ~ '現貨|到貨|庫存|合法上路|免登記|品質保證|保固|保修' THEN
    RAISE EXCEPTION '大圖文字有不能寫的字(現貨、到貨、庫存、合法上路、免登記、品質保證、保固、保修),請改字再發布';
  END IF;
  -- 🔴 Q6 乙:信件來的草稿還要配到商品、連結要指到商品(手動新增的不受這條管,見檔頭)
  IF v_before.source_email_id IS NOT NULL THEN
    IF cardinality(v_before.matched_variant_ids) = 0 THEN
      RAISE EXCEPTION '這張還沒配到商品,不能發布';
    END IF;
    IF v_before.link_path !~ '^/products($|[?/])' THEN
      RAISE EXCEPTION '連結要指到商品列表或商品頁(/products…),不能發布';
    END IF;
  END IF;

  v_starts := COALESCE(p_starts_at, v_before.starts_at, pg_catalog.now());
  -- 🔵 預設 14 天從「真的開始掛」起算
  v_ends   := COALESCE(p_ends_at, v_before.ends_at, GREATEST(v_starts, pg_catalog.now()) + interval '14 days');
  IF v_ends <= v_starts THEN
    RAISE EXCEPTION '下架時間要晚於上架時間';
  END IF;
  IF v_ends <= pg_catalog.now() THEN
    RAISE EXCEPTION '下架時間已經過了';
  END IF;

  -- 🔵 Q9 乙:首頁可以同時掛多張 ⇒ 這裡【不動別張】(20260916150000 的交接 / 自動下架整段退場)
  UPDATE public.home_banners b
     SET status = 'published', starts_at = v_starts, ends_at = v_ends,
         published_by = v_actor, published_at = pg_catalog.now(),
         updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
   WHERE b.id = p_banner_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.publish', 'home_banner:' || p_banner_id::text,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_after), v_request_id);

  RETURN pg_catalog.jsonb_build_object('id', p_banner_id, 'starts_at', v_starts, 'ends_at', v_ends);
END
$fn$;

COMMENT ON FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) IS
  '首頁大圖發布(20260916180000;20261001120000 加大圖文字紅字檢查)。所有在職員工都可以發布;p_expected_updated_at 要等於預覽那一版;只收 draft、要 rights_confirmed 與標題 / 連結 / 電腦版圖;大圖文字不能有現貨、到貨、庫存、合法上路、免登記、品質保證、保固、保修;信件來的草稿還要有配到的商品且連結指到 /products;下架時間預設 max(上架, 現在) + 14 天;不動其他已發布的大圖。寫 admin_audit_log home_banner.publish。EXECUTE 只給 service_role。';

-- ── 5. 後置閘 ────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_fn        text;
  -- 收權斷言清單(scripts/migration-static-checks.sh 規則③ 數這一份)
  v_functions text[] := ARRAY[
    'public.system_new_product_draft(jsonb,text)',
    'public.admin_home_banner_save_social(uuid,text,text,text,text)',
    'public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)']::text[];
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'home_banners'
         AND column_name IN ('source_product_id', 'fb_text', 'ig_text')) <> 3 THEN
    RAISE EXCEPTION '後置閘一:三個新欄位沒有都加上';
  END IF;
  FOREACH v_fn IN ARRAY v_functions LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.oid = v_fn::regprocedure AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']) THEN
      RAISE EXCEPTION '後置閘二:% 不是 SECURITY DEFINER 或 search_path 不是空字串', v_fn;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘三:% 的 EXECUTE 不是只給 service_role', v_fn;
    END IF;
  END LOOP;
  -- 後置閘四:發布函式換成本檔那一版(拋棄式 PG17 實算;舊版 03c6… 在正式庫與 PG17 算出同值 ⇒ 兩邊輸出格式相同)
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)'::regprocedure))
     IS DISTINCT FROM '00de56d51d3e75a5ff1c483ddc63c800' THEN
    RAISE EXCEPTION '後置閘四:發布函式不是本檔那一版';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
