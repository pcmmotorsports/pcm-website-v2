-- 20260916180000-rollback.sql —— 退回 20260916180000_m4b_home_banners_sean_three_overturns.sql
--
-- 🔴 退回 = 回到「限管理者發布 / 一次一張 / 配不到商品也能發」那一代(20260916150000 的行為)。
--    那是 Sean 2026-09-16 推翻掉的規則 ⇒ **只有在那次推翻本身要被撤回時才跑本檔**。
-- 🔴 順序:先 revert 後台那顆(發布 / 下架鈕對所有員工開),再跑本檔。反過來 ⇒ 一般員工按發布或下架會拿到「無權執行此操作」。
-- ⚠️ **現在有兩張以上時間重疊的 published ⇒ 本檔會在加回 EXCLUDE 那一句 RAISE**(那正是它要擋的東西)
--    ⇒ 先人工把多的下架(admin_home_banner_archive),再跑本檔。
--    🔵 那一句丟的是 PG 原文 `23P01 conflicting key value violates exclusion constraint`,不是中文 —— 半夜看到就是這一段。
-- ⚠️ **接回原下架時間這件事回不來**:`handover_original_ends_at` 是重新加的欄位,全部是 NULL ⇒
--    推翻之前曾被交接截短的舊圖,退回後接不回原本的下架時間(那個值在 DROP COLUMN 那一刻就沒了)。
--    要救只能翻 admin_audit_log 的 home_banner.handover 那幾筆 before 值,人工改回去。
-- 🔴 本檔一併把三支函式的 COMMENT 與表的 COMMENT 貼回 20260916150000 那一代 —— 不然目錄註解會繼續寫著新世界的規則,
--    而行為是舊世界(讀註解的人會被騙)。
-- 🔴 退完同批跑 pcm_acl_approve_latest(p_note 帶 20260916180000 與「rollback」)。
-- 🔵 可重跑:DROP / ADD 都先判存在。

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.home_banners DROP CONSTRAINT IF EXISTS home_banners_mail_published_needs_match;
ALTER TABLE public.home_banners DROP CONSTRAINT IF EXISTS home_banners_published_link_scope;
ALTER TABLE public.home_banners ADD COLUMN IF NOT EXISTS handover_original_ends_at timestamptz;

DO $excl$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_no_overlap_excl') THEN
    ALTER TABLE public.home_banners
      ADD CONSTRAINT home_banners_no_overlap_excl
      EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'published');
  END IF;
END
$excl$;

COMMENT ON COLUMN public.home_banners.handover_original_ends_at IS
  '排程交接前原本的下架時間(C2 乙)。發布一張未來上架的新圖時,現在掛著的這張下架時間被改成新圖上架,這裡記原值;那張新圖還沒上架就被下架時,用它接回。NULL = 沒有被交接截短。';

-- 三支函式貼回 20260916150000 那一代(逐字)
-- 🔴 存草稿這支也要退:180000 把 source_email_id / matched_variant_ids 改成「不傳就別動」,
--    舊世界是無條件覆寫。退了它 ⇒ 後台存草稿又會清掉信件來源(那是舊世界本來就有的行為)。
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
         source_email_id     = p_source_email_id,
         matched_variant_ids = COALESCE(p_matched_variant_ids, '{}'),
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
  v_is_manager boolean;
  v_before     public.home_banners;
  v_after      public.home_banners;
  v_old        public.home_banners;
  v_old_after  public.home_banners;
  v_starts     timestamptz;
  v_ends       timestamptz;
  v_archived   uuid[] := '{}';
  v_handed     uuid[] := '{}';
BEGIN
  IF p_banner_id IS NULL OR p_expected_updated_at IS NULL
     OR v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = v_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT COALESCE(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.home_banners:publish', 0));

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION '只有草稿可以發布(這張是 %)', v_before.status;
  END IF;
  IF v_before.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION '草稿剛被改過,請重新確認內容再發布';
  END IF;
  IF NOT v_before.rights_confirmed THEN
    RAISE EXCEPTION '還沒確認圖文可以使用';
  END IF;
  IF v_before.title_line1 IS NULL OR v_before.link_path IS NULL OR v_before.image_desktop_url IS NULL THEN
    RAISE EXCEPTION '大圖缺標題、連結或電腦版圖片';
  END IF;

  v_starts := COALESCE(p_starts_at, v_before.starts_at, pg_catalog.now());
  v_ends   := COALESCE(p_ends_at, v_before.ends_at, GREATEST(v_starts, pg_catalog.now()) + interval '14 days');
  IF v_ends <= v_starts THEN
    RAISE EXCEPTION '下架時間要晚於上架時間';
  END IF;
  IF v_ends <= pg_catalog.now() THEN
    RAISE EXCEPTION '下架時間已經過了';
  END IF;

  FOR v_old IN
    SELECT * FROM public.home_banners b
     WHERE b.status = 'published' AND b.id <> p_banner_id
       AND b.starts_at < v_ends AND b.ends_at > v_starts
     ORDER BY b.id
       FOR UPDATE
  LOOP
    IF v_starts > pg_catalog.now() AND v_old.starts_at < v_starts THEN
      UPDATE public.home_banners b
         SET ends_at = v_starts,
             handover_original_ends_at = COALESCE(b.handover_original_ends_at, b.ends_at),
             updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
       WHERE b.id = v_old.id
      RETURNING * INTO v_old_after;
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id)
      VALUES (v_actor, 'home_banner.handover', 'home_banner:' || v_old.id::text,
              pg_catalog.to_jsonb(v_old), pg_catalog.to_jsonb(v_old_after),
              'handover_to:' || p_banner_id::text, v_request_id);
      v_handed := v_handed || v_old.id;
    ELSE
      UPDATE public.home_banners b
         SET status = 'archived', archived_by = v_actor, archived_at = pg_catalog.now(),
             updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
       WHERE b.id = v_old.id
      RETURNING * INTO v_old_after;
      INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id)
      VALUES (v_actor, 'home_banner.archive', 'home_banner:' || v_old.id::text,
              pg_catalog.to_jsonb(v_old), pg_catalog.to_jsonb(v_old_after),
              'replaced_by:' || p_banner_id::text, v_request_id);
      v_archived := v_archived || v_old.id;
    END IF;
  END LOOP;

  UPDATE public.home_banners b
     SET status = 'published', starts_at = v_starts, ends_at = v_ends,
         published_by = v_actor, published_at = pg_catalog.now(),
         updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
   WHERE b.id = p_banner_id
  RETURNING * INTO v_after;

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.publish', 'home_banner:' || p_banner_id::text,
          pg_catalog.to_jsonb(v_before), pg_catalog.to_jsonb(v_after), v_request_id);

  RETURN pg_catalog.jsonb_build_object(
    'id', p_banner_id, 'starts_at', v_starts, 'ends_at', v_ends,
    'archived_ids', pg_catalog.to_jsonb(v_archived), 'handed_over_ids', pg_catalog.to_jsonb(v_handed));
END
$fn$;

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
  v_is_manager boolean;
  v_before     public.home_banners;
  v_after      public.home_banners;
  v_prev       public.home_banners;
  v_prev_after public.home_banners;
  v_next       timestamptz;
  v_restore    timestamptz;
BEGIN
  IF p_banner_id IS NULL OR v_actor IS NULL OR v_actor = '' OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;
  SELECT s.is_manager INTO v_is_manager
    FROM public.staff s WHERE s.id = v_actor AND s.is_active
     FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;
  IF NOT COALESCE(v_is_manager, false) THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.home_banners:publish', 0));

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

  IF v_before.status = 'published' AND v_before.starts_at > pg_catalog.now() THEN
    FOR v_prev IN
      SELECT * FROM public.home_banners b
       WHERE b.status = 'published' AND b.id <> p_banner_id
         AND b.handover_original_ends_at IS NOT NULL
         AND b.ends_at = v_before.starts_at
       ORDER BY b.id
         FOR UPDATE
    LOOP
      SELECT min(n.starts_at) INTO v_next
        FROM public.home_banners n
       WHERE n.status = 'published' AND n.id <> v_prev.id AND n.starts_at >= v_prev.ends_at;
      v_restore := LEAST(v_prev.handover_original_ends_at, COALESCE(v_next, v_prev.handover_original_ends_at));
      IF v_restore > v_prev.ends_at THEN
        UPDATE public.home_banners b
           SET ends_at = v_restore,
               handover_original_ends_at = CASE WHEN v_restore = v_prev.handover_original_ends_at
                                                THEN NULL ELSE v_prev.handover_original_ends_at END,
               updated_by = v_actor, updated_at = pg_catalog.clock_timestamp()
         WHERE b.id = v_prev.id
        RETURNING * INTO v_prev_after;
        INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id)
        VALUES (v_actor, 'home_banner.handover_restore', 'home_banner:' || v_prev.id::text,
                pg_catalog.to_jsonb(v_prev), pg_catalog.to_jsonb(v_prev_after),
                'archived:' || p_banner_id::text, v_request_id);
      END IF;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object('id', p_banner_id, 'changed', true);
END
$fn$;

-- 表與三支函式的 COMMENT 貼回 20260916150000 那一代(逐字)
COMMENT ON TABLE public.home_banners IS
  '首頁大圖(20260916150000;PRD §3.1,Sean §11)。draft ⇒ published ⇒ archived。寫入只走 admin_home_banner_save_draft / _publish / _archive(SECURITY DEFINER,EXECUTE 只給 service_role,各寫 admin_audit_log)。發布限管理者、要帶預覽時的 updated_at、任何時刻最多一張(排程發布時舊的掛到新的上架)、預設 14 天下架。anon / authenticated 零權限;前台讀 home_banners_live_v。過期的列 status 仍是 published,後台用 ends_at 判。';
COMMENT ON FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) IS
  '首頁大圖存草稿(20260916150000)。p_banner_id NULL ⇒ 新增;否則只改 draft(updated_at 換新 ⇒ 之前的預覽不能拿來發布)。在職員工即可(staff.is_active)。寫 admin_audit_log home_banner.draft_create / draft_update。EXECUTE 只給 service_role。';
COMMENT ON FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) IS
  '首頁大圖發布(20260916150000;Sean Q5 甲 / Q9 甲 / Q10 乙)。管理者限定(staff.is_manager AND is_active,否則 無權執行此操作);p_expected_updated_at 要等於預覽那一版;只收 draft、要 rights_confirmed 與標題 / 連結 / 電腦版圖;下架時間預設 max(上架, 現在) + 14 天;時間窗重疊的舊圖:排程發布且舊圖先開始 ⇒ 下架時間改成新圖上架(home_banner.handover),其餘 ⇒ archived(home_banner.archive)。寫 admin_audit_log home_banner.publish。EXECUTE 只給 service_role。';
COMMENT ON FUNCTION public.admin_home_banner_archive(uuid, text, text) IS
  '首頁大圖下架 / 封存(20260916150000)。管理者限定;已封存 ⇒ changed=false、不寫第二筆稽核。下架的是還沒上架的排程 ⇒ 交接給它的舊圖接回原本下架時間(不超過下一張排程上架,home_banner.handover_restore)。寫 admin_audit_log home_banner.archive。EXECUTE 只給 service_role。';

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.home_banners'::regclass AND c.conname = 'home_banners_no_overlap_excl') THEN
    RAISE EXCEPTION '退回後置閘一:不重疊約束沒加回來';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
              WHERE c.conrelid = 'public.home_banners'::regclass
                AND c.conname IN ('home_banners_mail_published_needs_match', 'home_banners_published_link_scope')) THEN
    RAISE EXCEPTION '退回後置閘二:180000 加的兩條 CHECK 還在';
  END IF;
  IF (SELECT pg_catalog.pg_get_functiondef(p.oid) FROM pg_catalog.pg_proc p
       WHERE p.oid = 'public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text)'::regprocedure)
     LIKE '%COALESCE(p_source_email_id, b.source_email_id)%' THEN
    RAISE EXCEPTION '退回後置閘四:存草稿還是 180000 那一代(不傳就別動)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.home_banners'::regclass AND attname = 'handover_original_ends_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION '退回後置閘三:handover_original_ends_at 沒加回來';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
