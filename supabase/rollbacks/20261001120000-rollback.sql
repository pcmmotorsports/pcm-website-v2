-- 20261001120000 回滾:刪兩支新函式、發布換回 20260916180000 原版、刪三欄。
-- ⚠️ 會丟掉草稿上的 FB / IG 文字與來源商品(大圖本身留著)。先停旗標 NEW_PRODUCT_DRAFTS_ENABLED 與排程, 再跑本檔。
-- 🔴 DROP COLUMN 要拆 products 上的外鍵觸發器, 會短暫取鎖 ⇒ 避開每天 07:45–08:30 的網站同步。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $precondition$
BEGIN
  IF pg_catalog.to_regproc('public.system_new_product_draft') IS NULL THEN
    RAISE EXCEPTION '前置閘:system_new_product_draft 不在 ⇒ 20261001120000 沒貼過或已經回滾, 停下';
  END IF;
END
$precondition$;

DROP FUNCTION public.system_new_product_draft(jsonb, text);
DROP FUNCTION public.admin_home_banner_save_social(uuid, text, text, text, text);

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
  '首頁大圖發布(20260916180000;Sean 2026-09-16 Q5 乙 / Q6 乙 / Q9 乙)。所有在職員工都可以發布;p_expected_updated_at 要等於預覽那一版;只收 draft、要 rights_confirmed 與標題 / 連結 / 電腦版圖;信件來的草稿還要有配到的商品且連結指到 /products;下架時間預設 max(上架, 現在) + 14 天;**不動其他已發布的大圖**(首頁可多張)。寫 admin_audit_log home_banner.publish。EXECUTE 只給 service_role。';

DROP INDEX public.home_banners_source_product_id_key;
ALTER TABLE public.home_banners
  DROP CONSTRAINT home_banners_one_source_check,
  DROP CONSTRAINT home_banners_fb_text_check,
  DROP CONSTRAINT home_banners_ig_text_check,
  DROP COLUMN source_product_id,
  DROP COLUMN fb_text,
  DROP COLUMN ig_text;

DO $post$
BEGIN
  IF pg_catalog.md5(pg_catalog.pg_get_functiondef(
       'public.admin_home_banner_publish(uuid,timestamptz,timestamptz,timestamptz,text,text)'::regprocedure))
     IS DISTINCT FROM '03c6d3432b3c08b555f875107edbd4ca' THEN
    RAISE EXCEPTION '後置閘:發布函式沒有換回 20260916180000 原版(md5 不符)';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'home_banners'
                AND column_name IN ('source_product_id', 'fb_text', 'ig_text')) THEN
    RAISE EXCEPTION '後置閘:新欄位沒有刪乾淨';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
