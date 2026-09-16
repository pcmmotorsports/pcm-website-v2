-- 20260916180000_m4b_home_banners_sean_three_overturns.sql
-- M-4b · 首頁大圖:Sean 2026-09-16 早上三題推翻(PRD §10 Q5 / Q6 / Q9 改答乙)
-- 板 196(20260916150000)已貼 ⇒ 不改那支檔,本檔是後續片。
-- pcm:idempotent: no
--   理由:DROP CONSTRAINT / DROP COLUMN。重貼 ⇒ 前置閘 RAISE(已經是新世界)。要重來先跑 rollback。
--
-- ══ 哪三題、改成什麼 ═════════════════════════════════════════════════
-- ① Q5 乙 **所有在職員工都可以發布**(推翻「限管理者」)⇒ admin_home_banner_publish 的 DB 閘拿掉 is_manager,只留在職員工。
--    **下架 / 封存也一起開給所有在職員工**(主視窗 2026-09-16 裁):發得出去就要收得回來 ——
--    「掛得上去、拿不下來」比兩個極端都糟,而把圖拿下來是比較安全的方向 ⇒ 兩邊同一條規則。
-- ② Q6 乙 **一定要配到商品才准發**(推翻「配不到可以連品牌頁」)。規則本檔定義如下(主視窗授權「define the exact rule」):
--    🔴 **只管【信件來的草稿】**(`source_email_id IS NOT NULL`):要有配到的商品(`matched_variant_ids` 非空)
--       且連結是商品列表 / 商品頁(`^/products($|[?/])`)。
--    🔵 **手動新增的大圖不受「要配到商品」這條管**(`source_email_id IS NULL`):Sean 自己建的季節性大圖本來就沒有
--       「配到商品」這件事,連結也可能是品牌頁 —— 那條路是 §1 目標第 3 點,把它一起擋掉會殺掉 Sean 自己在用的流程。
--       Q6 的題目字面是「商品還沒匯入(配到 0 件)的**草稿**可以發布嗎」⇒ 指的就是信件草稿。
--       🛑 **老實說:這個範圍是施工窗定的,偏離 Sean 乙的字面**(「一定要配到商品才准發」本身沒有分來源)。
--          主視窗 2026-09-16 認可這個範圍並同步告知 Sean;他要連手動的一起管 ⇒ 回來改這一條。
--    🔵 **手動的仍有最低限度**(主視窗同批加):連結一定要是站內商品 / 品牌頁(`^/(products|brands)($|[?/])`),
--       免得有人把首頁大圖指到站內任意路徑。
--    ⇒ 兩條都 RPC 擋一次(給員工看得懂的話)+ 表上 CHECK 兜底。
-- ③ Q9 乙 **首頁可以多張輪播**(推翻「一次一張」)⇒ 拿掉 EXCLUDE 不重疊約束;發布不再下架 / 交接別張;
--    交接欄位 `handover_original_ends_at` 與 archive 裡的接回邏輯一起拆掉(不留死碼)。
--    🔵 前台:大圖排在既有 hero 輪播最前面,多張就佔前 N 格;**排序規則 Sean 未定** ⇒ view 不帶 ORDER BY,前台自己決定。
--
-- ══ 沒有變 ═══════════════════════════════════════════════════════════
-- 發布要帶預覽時的 updated_at、要勾授權、缺標題 / 連結 / 桌機圖不准發、預設 max(上架, 現在) + 14 天自動下架、
-- 前台只讀 home_banners_live_v、寫入只走 RPC、EXECUTE 只給 service_role。
--
-- ══ 貼板必附 ═══════════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260916180000):三支函式換一代(CREATE OR REPLACE 保留 ACL)
-- 🔴 貼板順序:本檔先貼,後台那顆(發布鈕對所有員工開、沒配到商品擋)才合 dev
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- supabase/rollbacks/20260916180000-rollback.sql:兩支函式貼回 20260916150000 那一代、加回欄位與 EXCLUDE、拿掉新 CHECK。
-- ⚠️ 回滾時若已經有兩張時間重疊的 published,EXCLUDE 會建不起來 ⇒ 那支 rollback 會 RAISE,要先人工下架其中一張。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.home_banners') IS NULL THEN
    RAISE EXCEPTION '前置閘一:home_banners 不在 ⇒ 20260916150000(板 196)還沒貼';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_no_overlap_excl') THEN
    RAISE EXCEPTION '前置閘二:home_banners_no_overlap_excl 不在 ⇒ 本檔貼過了, 或世界不是我以為的那一代';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.home_banners'::regclass AND attname = 'handover_original_ends_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘三:handover_original_ends_at 不在 ⇒ 本檔貼過了';
  END IF;
END
$pre$;

-- ── 1. Q9 乙:多張可以同時掛 ⇒ 不重疊約束與交接欄位一起退場 ──────────────
ALTER TABLE public.home_banners DROP CONSTRAINT home_banners_no_overlap_excl;
ALTER TABLE public.home_banners DROP COLUMN handover_original_ends_at;

-- ── 2. Q6 乙:信件來的草稿要配到商品;已發布的連結要指到站內商品 / 品牌頁 ────
-- 🔴 兩條都是 OR 串 ⇒ 依 scripts/null-shortcircuit-check-guard.test.ts 的規矩,
--    已在拋棄式 PG 實跑壞形狀確認擋得住,並登記進該檔 PROBED_OR_CHECKS(逐格證據寫在那裡)。
--    NULL 面的承重柱是 home_banners.status 的 NOT NULL(已在該檔 LOAD_BEARING_NOT_NULL)。
ALTER TABLE public.home_banners
  ADD CONSTRAINT home_banners_mail_published_needs_match CHECK (
    status <> 'published'
    OR source_email_id IS NULL
    OR (cardinality(matched_variant_ids) > 0 AND link_path ~ '^/products($|[?/])'));

ALTER TABLE public.home_banners
  ADD CONSTRAINT home_banners_published_link_scope CHECK (
    status <> 'published'
    OR link_path ~ '^/(products|brands)($|[?/])');

COMMENT ON TABLE public.home_banners IS
  '首頁大圖(20260916150000;20260916180000 起 Sean 三題改乙)。draft ⇒ published ⇒ archived。寫入只走 admin_home_banner_save_draft / _publish / _archive(SECURITY DEFINER,EXECUTE 只給 service_role,各寫 admin_audit_log)。發布與下架 / 封存都 = 所有在職員工;發布要帶預覽時的 updated_at、要勾授權、預設 14 天下架。已發布的連結一定要是站內 /products… 或 /brands…;信件來的草稿(source_email_id 非空)另外要配到商品且連結指到 /products…。首頁可以同時掛多張(排序由前台決定;前台目前只顯示最近上架的一張,多張輪播還沒做)。anon / authenticated 零權限;前台讀 home_banners_live_v。';

-- ── 2b. 存草稿:source_email_id / matched_variant_ids 改成「不傳就別動」 ────
-- 🔴 **這是上面那兩條規則的承重點**。20260916150000 那一代是無條件覆寫,而後台存草稿一律送 NULL
--    (repository 寫死)⇒ 員工把信件來的草稿改個標題按「存草稿」,那一列就變成「不是信件來的、沒配到商品」,
--    RPC 的 Q6 閘與表上那條 CHECK 都以 source_email_id 為前提 ⇒ **三道閘同時失效**,
--    沒配到商品的廠商大圖照樣上得了首頁,連「這張是哪封信來的」那條稽核線也一起斷掉。
--    ⇒ 改成 COALESCE(不傳就保留原值)。要清空只能由送得出值的那一邊(系統 RPC)明確給 '{}'。
-- 🔵 新增那一支(p_banner_id IS NULL)照舊:系統建草稿時本來就會把兩個值都帶進來。
CREATE OR REPLACE FUNCTION public.admin_home_banner_save_draft(
  p_banner_id           uuid,
  p_eyebrow             text,
  p_title_line1         text,
  p_title_line2         text,
  p_subtitle            text,
  p_cta_label           text,
  p_link_path           text,
  p_image_desktop_url   text,
  p_image_mobile_url    text,
  p_image_origin        text,
  p_image_kind          text,
  p_rights_confirmed    boolean,
  p_rights_note         text,
  p_starts_at           timestamptz,
  p_ends_at             timestamptz,
  p_source_email_id     uuid,
  p_matched_variant_ids uuid[],
  p_actor               text,
  p_request_id          text
)
RETURNS uuid
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
  IF v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  IF p_banner_id IS NULL THEN
    INSERT INTO public.home_banners (
      eyebrow, title_line1, title_line2, subtitle, cta_label, link_path,
      image_desktop_url, image_mobile_url, image_origin, image_kind, rights_confirmed, rights_note,
      starts_at, ends_at, source_email_id, matched_variant_ids, created_by, updated_by)
    VALUES (
      NULLIF(pg_catalog.btrim(p_eyebrow), ''), NULLIF(pg_catalog.btrim(p_title_line1), ''),
      NULLIF(pg_catalog.btrim(p_title_line2), ''), NULLIF(pg_catalog.btrim(p_subtitle), ''),
      NULLIF(pg_catalog.btrim(p_cta_label), ''), NULLIF(pg_catalog.btrim(p_link_path), ''),
      NULLIF(pg_catalog.btrim(p_image_desktop_url), ''), NULLIF(pg_catalog.btrim(p_image_mobile_url), ''),
      NULLIF(pg_catalog.btrim(p_image_origin), ''), COALESCE(NULLIF(pg_catalog.btrim(p_image_kind), ''), 'scene'),
      COALESCE(p_rights_confirmed, false), NULLIF(pg_catalog.btrim(p_rights_note), ''),
      p_starts_at, p_ends_at, p_source_email_id, COALESCE(p_matched_variant_ids, '{}'), v_actor, v_actor)
    RETURNING * INTO v_after;

    INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
    VALUES (v_actor, 'home_banner.draft_create', 'home_banner:' || v_after.id::text, NULL, pg_catalog.to_jsonb(v_after), v_request_id);
    RETURN v_after.id;
  END IF;

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION '只有草稿可以修改(這張是 %)', v_before.status;
  END IF;

  UPDATE public.home_banners b
     SET eyebrow             = NULLIF(pg_catalog.btrim(p_eyebrow), ''),
         title_line1         = NULLIF(pg_catalog.btrim(p_title_line1), ''),
         title_line2         = NULLIF(pg_catalog.btrim(p_title_line2), ''),
         subtitle            = NULLIF(pg_catalog.btrim(p_subtitle), ''),
         cta_label           = NULLIF(pg_catalog.btrim(p_cta_label), ''),
         link_path           = NULLIF(pg_catalog.btrim(p_link_path), ''),
         image_desktop_url   = NULLIF(pg_catalog.btrim(p_image_desktop_url), ''),
         image_mobile_url    = NULLIF(pg_catalog.btrim(p_image_mobile_url), ''),
         image_origin        = NULLIF(pg_catalog.btrim(p_image_origin), ''),
         image_kind          = COALESCE(NULLIF(pg_catalog.btrim(p_image_kind), ''), 'scene'),
         rights_confirmed    = COALESCE(p_rights_confirmed, false),
         rights_note         = NULLIF(pg_catalog.btrim(p_rights_note), ''),
         starts_at           = p_starts_at,
         ends_at             = p_ends_at,
         -- 🔴 不傳就別動(20260916180000)—— 理由見本節檔頭
         source_email_id     = COALESCE(p_source_email_id, b.source_email_id),
         matched_variant_ids = COALESCE(p_matched_variant_ids, b.matched_variant_ids),
         updated_by          = v_actor,
         updated_at          = pg_catalog.clock_timestamp()
   WHERE b.id = p_banner_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.draft_update', 'home_banner:' || p_banner_id::text,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_after), v_request_id);
  RETURN p_banner_id;
END
$fn$;

COMMENT ON FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) IS
  '首頁大圖存草稿(20260916180000)。所有在職員工;只有 draft 可以改。🔴 source_email_id / matched_variant_ids 改成「不傳就別動」—— 後台一律送 NULL,舊版無條件覆寫會把信件來源與配到的商品清掉,讓「要配到商品才准發」那條規則一鍵失效。寫 admin_audit_log home_banner.draft_create / draft_update。EXECUTE 只給 service_role。';

-- ── 3. 發布:所有在職員工;不再動別張;信件草稿要配到商品 ─────────────────
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

-- ── 4. 下架 / 封存:接回邏輯退場(欄位沒了);也開給所有在職員工 ───────────
CREATE OR REPLACE FUNCTION public.admin_home_banner_archive(
  p_banner_id  uuid,
  p_actor      text,
  p_request_id text
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
BEGIN
  IF p_banner_id IS NULL OR v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  -- 🔴 主視窗 2026-09-16 裁:發得出去就要收得回來 ⇒ 下架 / 封存跟發布同一條規則(在職員工)
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status = 'archived' THEN
    RETURN pg_catalog.jsonb_build_object('id', p_banner_id, 'changed', false);
  END IF;

  UPDATE public.home_banners b
     SET status = 'archived', archived_by = v_actor, archived_at = pg_catalog.now(),
         updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
   WHERE b.id = p_banner_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.archive', 'home_banner:' || p_banner_id::text,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_after), v_request_id);

  RETURN pg_catalog.jsonb_build_object('id', p_banner_id, 'changed', true);
END
$fn$;

COMMENT ON FUNCTION public.admin_home_banner_archive(uuid, text, text) IS
  '首頁大圖下架 / 封存(20260916180000)。所有在職員工(主視窗 09-16 裁:發得出去就要收得回來);已封存 ⇒ changed=false、不寫第二筆稽核。首頁可多張之後不再有「接回上一張」那段。寫 admin_audit_log home_banner.archive。EXECUTE 只給 service_role。';

-- ── 5. 後置閘 ────────────────────────────────────────────────────────
DO $post$
DECLARE
  v_relations text[] := ARRAY['public.home_banners']::text[];
  v_functions text[] := ARRAY[
    'public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text)',
    'public.admin_home_banner_archive(uuid, text, text)',
    'public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text)'
  ]::text[];
  v_obj text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_no_overlap_excl') THEN
    RAISE EXCEPTION '後置閘一:不重疊約束還在';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.home_banners'::regclass AND attname = 'handover_original_ends_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '後置閘二:handover_original_ends_at 還在';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_mail_published_needs_match' AND c.convalidated) THEN
    RAISE EXCEPTION '後置閘三:配到商品那條 CHECK 不在或沒驗過';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_published_link_scope' AND c.convalidated) THEN
    RAISE EXCEPTION '後置閘三b:連結範圍那條 CHECK 不在或沒驗過';
  END IF;
  -- 🔴 存草稿是上面兩條 CHECK 的承重點:它被換回無條件覆寫 ⇒ 那兩條形同虛設(見 2b)
  IF (SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text)'::regprocedure)
     NOT LIKE '%COALESCE(p_source_email_id, b.source_email_id)%' THEN
    RAISE EXCEPTION '後置閘三c:存草稿沒有保留 source_email_id(不傳就別動)';
  END IF;
  FOREACH v_obj IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_obj, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘四:% 對 anon / authenticated 可執行', v_obj;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘五:% service_role 不能執行', v_obj;
    END IF;
    IF (SELECT p.proconfig FROM pg_catalog.pg_proc p WHERE p.oid = v_obj::regprocedure) IS DISTINCT FROM ARRAY['search_path=""'] THEN
      RAISE EXCEPTION '後置閘六:% 的 search_path 不是空字串(CREATE OR REPLACE 會把 SET 子句整組換掉)', v_obj;
    END IF;
    IF NOT (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_obj::regprocedure) THEN
      RAISE EXCEPTION '後置閘六b:% 不是 SECURITY DEFINER', v_obj;
    END IF;
  END LOOP;
  FOREACH v_obj IN ARRAY v_relations LOOP
    IF pg_catalog.has_any_column_privilege('anon', v_obj, 'SELECT')
       OR pg_catalog.has_any_column_privilege('authenticated', v_obj, 'SELECT') THEN
      RAISE EXCEPTION '後置閘七:% 對前台開了欄級讀取', v_obj;
    END IF;
  END LOOP;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
