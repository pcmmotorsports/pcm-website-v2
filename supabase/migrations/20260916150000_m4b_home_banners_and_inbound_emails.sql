-- 20260916150000_m4b_home_banners_and_inbound_emails.sql
-- M-4b · 「email 廠商新品 → 首頁大圖」第一片:資料結構(兩張表 + 一張前台 view + 三支後台 RPC + 一支清理函式)
-- PRD:docs/plans/2026-09-15-email-newproduct-homepage-banner-prd.md §3 / §5 / §6 / §11(Sean 2026-09-15 拍板)
-- OD 稿:pcm-home-redesign/home-hero-newproduct-v1.html、pcm-524f/admin-home-banners-v1.html(PRD §3.1 沒有的兩欄 subtitle / image_kind 由稿來)
-- pcm:idempotent: no
--   理由:建新表。重貼 ⇒ 前置閘一 RAISE(表已在)。要重來先跑 rollback。
--
-- ══ Sean 拍板(§11)落在哪 ═══════════════════════════════════════════
-- · Q1 乙 大圖混進既有首頁輪播 ⇒ 前台讀 view;排第幾張(Sean 未拍)不進 schema,view 不帶順序,要排序欄之後 ALTER ADD 即可
-- · Q5 甲 只有管理者能發布 ⇒ publish / archive 在 DB 層驗 staff.is_manager AND is_active
--   (逐字抄 admin_staff_create 20260912050000:146-154)。
--   ⚠️ 這道擋的是「後台 TS 授權寫錯」;service_role key 外洩的人帶任一位管理者的 p_actor 照樣過。
-- · Q5 甲 的另一半:發布要帶管理者【看過的那一版】的 updated_at(p_expected_updated_at),不同就擋
--   ⇒ 不會發生「管理者按發布、上架的是別人剛存的內容」(adversarial-reviewer R1 MF1)
-- · Q9 甲 一次一張 + C2 乙(主視窗 2026-09-16 裁:首頁不能空)⇒ 【任何時刻】最多一張:
--   立即發布 ⇒ 時間重疊的舊圖同交易改 archived;排程發布 ⇒ 現在掛著的舊圖留著、下架時間改成新圖上架那一刻,
--   排在新圖上架之後才開始的舊排程改 archived。兜底 = EXCLUDE(published 的時間窗不得重疊)
--   交接時記下舊圖原本的下架時間(handover_original_ends_at);那張排程還沒上架就被下架 ⇒ 舊圖接回原本的下架時間
--   (不超過下一張排程的上架時間)⇒ 下架重排不會讓首頁空(delta 審 MF1)
-- · Q11 甲 大圖放輪播第一張 ⇒ 前台排版,schema 不帶順序
-- · Q10 乙 14 天自動下架 ⇒ publish 沒給下架時間 ⇒ max(上架時間, 現在) + 14 天;view 用 now() 判,不需要排程
-- · Q2 甲 圖複製到自家空間 ⇒ image_origin 欄先留;「發布時必須是 storage」等 storage 那一片(PRD §8 #15)再收緊
-- · Q8 甲 信件只存必要欄位、90 天後刪 ⇒ supplier_inbound_emails 沒有內文欄 + supplier_inbound_emails_purge_expired()
--   (排程在 PRD §8 #12/#13 那一片接;本檔只提供函式)。⚠️ extracted 是 JSON,「不塞內文」靠寫入端守,CHECK 只擋形狀與大小
--
-- ══ 權限形狀(照 PRD §3.1 / §6)═══════════════════════════════════════
-- home_banners ⇒ anon / authenticated 零權限(表級、欄級都沒有);service_role 只有 SELECT;寫入只走三支 SECURITY DEFINER RPC
--   · RLS 開 + service_role SELECT 政策(rls-service-role-policy-gate;service_role 帶 BYPASSRLS,政策是給拿掉那天用的)
-- home_banners_live_v ⇒ security_invoker = false(view owner 讀表;表 owner 不受自己表的 RLS 管)+ security_barrier
--   · 只露前台欄位、只給已發布且在時間內的列;anon / authenticated / service_role SELECT
--   · 🔴 選這個形狀而不是「表開欄級 GRANT + anon 政策」:ACL 快照(pcm_acl_approve_latest)只看表級權限,
--     看不到欄級授權 ⇒ 帳本會記成 anon 對表零權限而其實讀得到(R1 C3)
-- supplier_inbound_emails ⇒ RLS 開、service_role SELECT 政策;service_role SELECT + INSERT;anon / authenticated 零權限
-- 函式四支 ⇒ EXECUTE 只給 service_role(docs/patterns/revoking-function-execute-in-supabase.md §1)
--
-- ══ 刻意不做 ═══════════════════════════════════════════════════════
-- · 寄件者白名單表 supplier_mail_senders(PRD §3.2)⇒ Gmail 那一片再建;所以 inbound 表先沒有 sender_id FK
-- · cron 自動起草的寫入路(created_by = 'system:mail-draft')⇒ 那一片另開 RPC,不讓 service_role 直寫表
-- · 排程(cron.schedule)⇒ PRD §8 #13
-- · 過期的大圖 status 仍是 published(view 用時間擋);後台列表要自己用 ends_at 判斷「已過期」
--
-- ══ 貼板必附 ═══════════════════════════════════════════════════════
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260916150000):新增 2 表 + 1 view + 4 函式
-- 🔴 本檔先貼,後台 / 前台片才合 dev(新 view / 新 RPC ⇒ 部署時序閘會擋)
-- 🔴 貼完先驗 view 真的讀得到:它靠「表 owner = postgres 且沒 FORCE RLS」繞過 RLS(拋棄式 PG 是 superuser,這點沒證)。
--    做法:發布一張測試圖後 `SET ROLE anon; SELECT count(*) FROM public.home_banners_live_v;` 要 > 0。
--    讀到 0 ⇒ 首頁永遠沒有大圖(不顯示,不是外洩)。
-- ⚠️ Supabase Security Advisor 會把 home_banners_live_v 標 security_definer_view(lint 0010)——照 PRD 刻意的形狀,不用改。
-- ⚠️ 給後台那一片:p_expected_updated_at 比到微秒 ⇒ 原樣回傳 PostgREST 給的字串,不要先轉 JS Date(只剩毫秒 ⇒ 每次發布都被擋)。
-- ⚠️ 給後台那一片(主視窗 2026-09-16 裁乙):發布時下架時間早於現行那張 ⇒ DB 照做(截短現行那張),
--    後台要跳提示:『這張下架後到 X 之前首頁不會有新品大圖』(X = 現行那張的下架時間)。不擋 —— 輪播還有原本幾張,首頁不會真的空。
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- supabase/rollbacks/20260916150000-rollback.sql:DROP view / 函式 / 兩張表。⚠️ 草稿與已發布的大圖一起消失;稽核列留著。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 ─────────────────────────────────────────────────────────
DO $pre$
BEGIN
  IF pg_catalog.to_regclass('public.home_banners') IS NOT NULL
     OR pg_catalog.to_regclass('public.supplier_inbound_emails') IS NOT NULL
     OR pg_catalog.to_regclass('public.home_banners_live_v') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘一:home_banners / supplier_inbound_emails / home_banners_live_v 已存在 ⇒ 貼過了或撞名, 停下(要重來先跑 rollback)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                  WHERE attrelid = 'public.staff'::regclass AND attname = 'is_manager' AND NOT attisdropped) THEN
    RAISE EXCEPTION '前置閘二:staff.is_manager 不在 ⇒ 20260829193000 還沒貼';
  END IF;
  IF pg_catalog.to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION '前置閘三:admin_audit_log 不在';
  END IF;
END
$pre$;

-- ── 1. 讀過的廠商信(只存必要欄位,90 天後刪)──────────────────────────
CREATE TABLE public.supplier_inbound_emails (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id text        NOT NULL,
  gmail_thread_id  text,
  sender           text        NOT NULL,
  subject          text,
  received_at      timestamptz NOT NULL,
  auth_passed      boolean     NOT NULL DEFAULT false,
  status           text        NOT NULL,
  extracted        jsonb,
  error_code       text,
  created_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT supplier_inbound_emails_gmail_message_id_key UNIQUE (gmail_message_id),
  CONSTRAINT supplier_inbound_emails_message_id_check CHECK (btrim(gmail_message_id) <> '' AND char_length(gmail_message_id) <= 200),
  CONSTRAINT supplier_inbound_emails_thread_id_check  CHECK (gmail_thread_id IS NULL OR char_length(gmail_thread_id) <= 200),
  CONSTRAINT supplier_inbound_emails_sender_check     CHECK (sender <> '' AND sender = lower(btrim(sender)) AND char_length(sender) <= 320),
  CONSTRAINT supplier_inbound_emails_subject_check    CHECK (subject IS NULL OR char_length(subject) <= 500),
  CONSTRAINT supplier_inbound_emails_status_check
    CHECK (status IN ('drafted', 'no_products', 'skipped_sender', 'skipped_auth', 'failed')),
  -- 🔴 extracted 只放抽出來的品名 / 料號 / 圖網址 / 廠商連結,不放信件內文 ⇒ 限物件 + 限大小
  CONSTRAINT supplier_inbound_emails_extracted_check
    CHECK (extracted IS NULL OR (jsonb_typeof(extracted) = 'object' AND octet_length(extracted::text) <= 16384)),
  -- 🔴 error_code 只放分類,不放內容
  CONSTRAINT supplier_inbound_emails_error_code_check CHECK (error_code IS NULL OR error_code ~ '^[a-z0-9_]{1,64}$')
);
CREATE INDEX supplier_inbound_emails_created_at_idx ON public.supplier_inbound_emails (created_at);

COMMENT ON TABLE public.supplier_inbound_emails IS
  '讀過的廠商新品信(20260916150000;PRD §3.3,Sean Q8 甲)。只存必要欄位、不存信件內文;90 天後由 supplier_inbound_emails_purge_expired() 刪。anon / authenticated 零權限;service_role 讀 + 新增。';

ALTER TABLE public.supplier_inbound_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_inbound_emails_service_role_select ON public.supplier_inbound_emails
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.supplier_inbound_emails FROM PUBLIC, anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.supplier_inbound_emails -- 新表, 讀信 cron route(service_role)要讀與新增(20260916150000, PRD §4, Sean 2026-09-15 §11)
GRANT SELECT, INSERT ON TABLE public.supplier_inbound_emails TO service_role;

-- ── 2. 首頁大圖 ─────────────────────────────────────────────────────
CREATE TABLE public.home_banners (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  status              text        NOT NULL DEFAULT 'draft',
  eyebrow             text,
  title_line1         text,
  title_line2         text,
  subtitle            text,
  cta_label           text,
  link_path           text,
  image_desktop_url   text,
  image_mobile_url    text,
  image_origin        text,
  image_kind          text        NOT NULL DEFAULT 'scene',
  rights_confirmed    boolean     NOT NULL DEFAULT false,
  rights_note         text,
  starts_at           timestamptz,
  ends_at             timestamptz,
  handover_original_ends_at timestamptz,
  source_email_id     uuid        REFERENCES public.supplier_inbound_emails (id) ON DELETE SET NULL,
  matched_variant_ids uuid[]      NOT NULL DEFAULT '{}',
  created_by          text        NOT NULL,
  updated_by          text        NOT NULL,
  published_by        text,
  published_at        timestamptz,
  archived_by         text,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT home_banners_status_check CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT home_banners_eyebrow_check     CHECK (eyebrow     IS NULL OR char_length(eyebrow)     <= 40),
  CONSTRAINT home_banners_title_line1_check CHECK (title_line1 IS NULL OR char_length(title_line1) <= 60),
  CONSTRAINT home_banners_title_line2_check CHECK (title_line2 IS NULL OR char_length(title_line2) <= 60),
  -- 🔵 OD 稿:標題下一行小字(例「適用 BMW S 1000 RR 2025 · 已上架 6 件」);表單字數上限比這裡嚴
  CONSTRAINT home_banners_subtitle_check    CHECK (subtitle    IS NULL OR char_length(subtitle)    <= 60),
  CONSTRAINT home_banners_cta_label_check   CHECK (cta_label   IS NULL OR char_length(cta_label)   <= 20),
  -- 🔴 只准站內相對路徑:開頭恰一個 `/`,後面不是 `/`;整串不准有反斜線、空白、控制字元
  --    (`//evil.com` 與 `/\evil.com` 在瀏覽器都會被當成外站)。依賴 standard_conforming_strings = on(Supabase 預設)
  CONSTRAINT home_banners_link_path_check
    CHECK (link_path IS NULL OR (link_path ~ '^/[^/]' AND link_path !~ '[\\[:space:][:cntrl:]]' AND char_length(link_path) <= 500)),
  CONSTRAINT home_banners_image_desktop_url_check
    CHECK (image_desktop_url IS NULL OR (image_desktop_url ~ '^https://[^[:space:][:cntrl:]]+$' AND char_length(image_desktop_url) <= 2000)),
  CONSTRAINT home_banners_image_mobile_url_check
    CHECK (image_mobile_url IS NULL OR (image_mobile_url ~ '^https://[^[:space:][:cntrl:]]+$' AND char_length(image_mobile_url) <= 2000)),
  CONSTRAINT home_banners_image_origin_check CHECK (image_origin IS NULL OR image_origin IN ('supplier_url', 'storage')),
  -- 🔵 OD 稿:scene = 情境照(滿版);product = 白底商品照(前台左字右圖排)
  CONSTRAINT home_banners_image_kind_check   CHECK (image_kind IN ('scene', 'product')),
  CONSTRAINT home_banners_rights_note_check  CHECK (rights_note IS NULL OR char_length(rights_note) <= 500),
  CONSTRAINT home_banners_window_check CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT home_banners_matched_variant_ids_check
    CHECK (cardinality(matched_variant_ids) <= 200 AND array_position(matched_variant_ids, NULL) IS NULL),
  CONSTRAINT home_banners_created_by_check CHECK (btrim(created_by) <> ''),
  CONSTRAINT home_banners_updated_by_check CHECK (btrim(updated_by) <> ''),
  -- 🔴 已發布的列一定帶齊前台要的東西與發布人(RPC 擋一次,這裡再兜一次)
  CONSTRAINT home_banners_published_shape_check CHECK (
    status <> 'published' OR (
      starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND title_line1 IS NOT NULL AND link_path IS NOT NULL AND image_desktop_url IS NOT NULL
      AND rights_confirmed AND published_by IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT home_banners_archived_shape_check CHECK (
    status <> 'archived' OR (archived_by IS NOT NULL AND archived_at IS NOT NULL)),
  -- 🔴 Q9 甲 + C2 乙 的兜底:published 的上下架時間窗不得重疊 ⇒ 任何時刻最多一張(RPC 已先交接 / 下架)
  --    ⚠️ 已過期但還是 published 的列也算在內;它們的時間窗在過去,不會擋到新的
  CONSTRAINT home_banners_no_overlap_excl
    EXCLUDE USING gist (tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE (status = 'published')
);

CREATE INDEX home_banners_status_updated_at_idx ON public.home_banners (status, updated_at DESC);

COMMENT ON TABLE public.home_banners IS
  '首頁大圖(20260916150000;PRD §3.1,Sean §11)。draft ⇒ published ⇒ archived。寫入只走 admin_home_banner_save_draft / _publish / _archive(SECURITY DEFINER,EXECUTE 只給 service_role,各寫 admin_audit_log)。發布限管理者、要帶預覽時的 updated_at、任何時刻最多一張(排程發布時舊的掛到新的上架)、預設 14 天下架。anon / authenticated 零權限;前台讀 home_banners_live_v。過期的列 status 仍是 published,後台用 ends_at 判。';
COMMENT ON COLUMN public.home_banners.image_origin IS
  'supplier_url = 還是廠商站的圖;storage = 已複製到自家空間(Sean Q2 甲)。發布時要求 storage 的收緊等 storage 那一片。';
COMMENT ON COLUMN public.home_banners.handover_original_ends_at IS
  '排程交接前原本的下架時間(C2 乙)。發布一張未來上架的新圖時,現在掛著的這張下架時間被改成新圖上架,這裡記原值;那張新圖還沒上架就被下架時,用它接回。NULL = 沒有被交接截短。';
COMMENT ON COLUMN public.home_banners.image_kind IS
  '圖的種類(OD 稿):scene = 情境照;product = 白底商品照。前台依此換排版。';

ALTER TABLE public.home_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY home_banners_service_role_select ON public.home_banners
  FOR SELECT TO service_role USING (true);

REVOKE ALL ON TABLE public.home_banners FROM PUBLIC, anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.home_banners -- 新表, 後台列表(service_role)唯讀;寫入只走 definer RPC(20260916150000, Sean 2026-09-15 §11)
GRANT SELECT ON TABLE public.home_banners TO service_role;

-- ── 3. 前台讀的 view ────────────────────────────────────────────────
CREATE VIEW public.home_banners_live_v WITH (security_invoker = false, security_barrier = true) AS
SELECT b.id, b.eyebrow, b.title_line1, b.title_line2, b.subtitle, b.cta_label, b.link_path,
       b.image_desktop_url, b.image_mobile_url, b.image_kind, b.starts_at, b.ends_at
  FROM public.home_banners b
 WHERE b.status = 'published'
   AND b.starts_at <= now()
   AND (b.ends_at IS NULL OR b.ends_at > now());

ALTER VIEW public.home_banners_live_v OWNER TO postgres;
COMMENT ON VIEW public.home_banners_live_v IS
  '首頁現在該掛的大圖(20260916150000;PRD §5)。security_invoker = false:view owner 讀表,anon 對表本身零權限;只露前台欄位、只給已發布且在上下架時間內的列。不帶順序(輪播排第幾張 Sean 未拍)。';

REVOKE ALL ON TABLE public.home_banners_live_v FROM PUBLIC, anon, authenticated, service_role;
-- ACL-GATE-EXEMPT: public.home_banners_live_v -- 顧客站首頁以 anon 讀已發布大圖(不經 server 端 service_role, 同 products_list_public);後台預覽用 service_role(20260916150000, PRD §5, Sean 2026-09-15 §11)
GRANT SELECT ON TABLE public.home_banners_live_v TO anon, authenticated, service_role;

-- ── 4. 存草稿(新增或修改;所有在職員工)──────────────────────────────
CREATE FUNCTION public.admin_home_banner_save_draft(
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

-- ── 5. 發布(管理者;要帶預覽時的 updated_at;一次一張;預設 14 天下架)─────────
CREATE FUNCTION public.admin_home_banner_publish(
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

  -- 🔴 發布 / 下架排隊:兩位管理者同時發布兩張草稿時,後到的那一發要看得到先到的那一張已經上架
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public.home_banners:publish', 0));

  SELECT * INTO v_before FROM public.home_banners b WHERE b.id = p_banner_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  IF v_before.status <> 'draft' THEN
    RAISE EXCEPTION '只有草稿可以發布(這張是 %)', v_before.status;
  END IF;
  -- 🔴 管理者批准的是他預覽的那一版;中間有人存過草稿 ⇒ 不發,請他重看(R1 MF1)
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
  -- 🔵 預設 14 天從「真的開始掛」起算:草稿帶著早就過去的上架時間時,不讓它只掛幾天(R1 C1)
  v_ends   := COALESCE(p_ends_at, v_before.ends_at, GREATEST(v_starts, pg_catalog.now()) + interval '14 days');
  IF v_ends <= v_starts THEN
    RAISE EXCEPTION '下架時間要晚於上架時間';
  END IF;
  IF v_ends <= pg_catalog.now() THEN
    RAISE EXCEPTION '下架時間已經過了';
  END IF;

  -- 🔴 Q9 甲 + C2 乙:只動【時間窗跟新圖重疊】的舊圖(沒重疊的 —— 已過期、或排在新圖下架之後 —— 不碰)
  --    · 新圖排在未來、舊圖在新圖上架之前就開始 ⇒ 舊圖留著,下架時間改成新圖上架那一刻(首頁不空)
  --    · 其他重疊(立即發布,或舊排程在新圖上架之後才開始)⇒ 舊圖改 archived
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

-- ── 6. 下架 / 封存(管理者;重按不寫第二筆稽核)──────────────────────────
CREATE FUNCTION public.admin_home_banner_archive(
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

  -- 🔴 C2 乙 接回:下架一張【還沒上架】的排程 ⇒ 之前交接給它的舊圖把下架時間接回去,
  --    上限 = 下一張已發布排程的上架時間(不撞 EXCLUDE)。本張已先改 archived,不在下面兩個查詢裡。
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

-- ── 7. 90 天清理(Sean Q8 甲;排程那一片來呼叫)───────────────────────────
CREATE FUNCTION public.supplier_inbound_emails_purge_expired()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 天數寫死 90,不收參數:呼叫端傳錯一個數字就會多刪
  -- ⚠️ 大圖的 source_email_id 由 FK 設 NULL(不寫稽核、不動 updated_at);與發布同時跑理論上可能 40P01,PG 會自己解
  DELETE FROM public.supplier_inbound_emails e
   WHERE e.created_at < pg_catalog.now() - interval '90 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$fn$;

-- ── 8. 函式權限 + 註解 ─────────────────────────────────────────────
ALTER FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_home_banner_archive(uuid, text, text) OWNER TO postgres;
ALTER FUNCTION public.supplier_inbound_emails_purge_expired() OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_home_banner_archive(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.supplier_inbound_emails_purge_expired() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_home_banner_archive(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.supplier_inbound_emails_purge_expired() TO service_role;

COMMENT ON FUNCTION public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text) IS
  '首頁大圖存草稿(20260916150000)。p_banner_id NULL ⇒ 新增;否則只改 draft(updated_at 換新 ⇒ 之前的預覽不能拿來發布)。在職員工即可(staff.is_active)。寫 admin_audit_log home_banner.draft_create / draft_update。EXECUTE 只給 service_role。';
COMMENT ON FUNCTION public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text) IS
  '首頁大圖發布(20260916150000;Sean Q5 甲 / Q9 甲 / Q10 乙)。管理者限定(staff.is_manager AND is_active,否則 無權執行此操作);p_expected_updated_at 要等於預覽那一版;只收 draft、要 rights_confirmed 與標題 / 連結 / 電腦版圖;下架時間預設 max(上架, 現在) + 14 天;時間窗重疊的舊圖:排程發布且舊圖先開始 ⇒ 下架時間改成新圖上架(home_banner.handover),其餘 ⇒ archived(home_banner.archive)。寫 admin_audit_log home_banner.publish。EXECUTE 只給 service_role。';
COMMENT ON FUNCTION public.admin_home_banner_archive(uuid, text, text) IS
  '首頁大圖下架 / 封存(20260916150000)。管理者限定;已封存 ⇒ changed=false、不寫第二筆稽核。下架的是還沒上架的排程 ⇒ 交接給它的舊圖接回原本下架時間(不超過下一張排程上架,home_banner.handover_restore)。寫 admin_audit_log home_banner.archive。EXECUTE 只給 service_role。';
COMMENT ON FUNCTION public.supplier_inbound_emails_purge_expired() IS
  '刪掉 90 天前讀過的廠商信紀錄(20260916150000;Sean Q8 甲),回刪除筆數。大圖的 source_email_id 由 FK 設成 NULL。EXECUTE 只給 service_role。';

-- ── 9. 後置閘(權限;行為在拋棄式 PG 另驗)───────────────────────────
DO $post$
DECLARE
  v_relations text[] := ARRAY[
    'public.home_banners',
    'public.supplier_inbound_emails',
    'public.home_banners_live_v'
  ]::text[];
  v_functions text[] := ARRAY[
    'public.admin_home_banner_save_draft(uuid, text, text, text, text, text, text, text, text, text, text, boolean, text, timestamptz, timestamptz, uuid, uuid[], text, text)',
    'public.admin_home_banner_publish(uuid, timestamptz, timestamptz, timestamptz, text, text)',
    'public.admin_home_banner_archive(uuid, text, text)',
    'public.supplier_inbound_emails_purge_expired()'
  ]::text[];
  v_obj  text;
  v_role text;
  v_priv text;
BEGIN
  FOREACH v_obj IN ARRAY v_functions LOOP
    IF pg_catalog.has_function_privilege('anon', v_obj, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘一:% 對 anon / authenticated 可執行', v_obj;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_obj, 'EXECUTE') THEN
      RAISE EXCEPTION '後置閘二:% service_role 不能執行', v_obj;
    END IF;
  END LOOP;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_obj IN ARRAY v_relations LOOP
      FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(v_role, v_obj, v_priv) THEN
          RAISE EXCEPTION '後置閘三:% 對 % 有 %', v_role, v_obj, v_priv;
        END IF;
      END LOOP;
    END LOOP;
    -- 🔴 欄級也要看:has_table_privilege 看不到欄級 GRANT(R1 N1)
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, 'public.home_banners', v_priv)
         OR pg_catalog.has_any_column_privilege(v_role, 'public.supplier_inbound_emails', v_priv) THEN
        RAISE EXCEPTION '後置閘四:% 對底表有欄級 %(前台只准讀 view)', v_role, v_priv;
      END IF;
    END LOOP;
    IF NOT pg_catalog.has_table_privilege(v_role, 'public.home_banners_live_v', 'SELECT') THEN
      RAISE EXCEPTION '後置閘五:% 讀不到 home_banners_live_v', v_role;
    END IF;
  END LOOP;

  FOREACH v_obj IN ARRAY ARRAY['public.home_banners', 'public.supplier_inbound_emails'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      IF pg_catalog.has_table_privilege('service_role', v_obj, v_priv)
         OR (v_priv = 'UPDATE' AND pg_catalog.has_any_column_privilege('service_role', v_obj, 'UPDATE')) THEN
        RAISE EXCEPTION '後置閘六:service_role 對 % 有 %(寫入只准走 RPC / 清理函式)', v_obj, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('service_role', 'public.home_banners', 'INSERT') THEN
    RAISE EXCEPTION '後置閘七:service_role 能直接新增 home_banners';
  END IF;

  IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.home_banners'::regclass)
     OR NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = 'public.supplier_inbound_emails'::regclass) THEN
    RAISE EXCEPTION '後置閘八:RLS 沒開';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
