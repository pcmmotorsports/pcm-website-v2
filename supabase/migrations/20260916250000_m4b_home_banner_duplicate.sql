-- 20260916250000_m4b_home_banner_duplicate.sql —— 首頁大圖「複製成新草稿」
-- M-4b · 設計窗 pcm-website-v2-c1(版本號由主視窗 pcm-website-v2-6d 指定 20260916250000)
-- Sean 2026-09-16 逐字「甲 = 批」⇒ 批准 docs/plans/2026-09-16-home-banner-duplicate-to-draft.md
-- plan:同上 §2-1 逐欄 · §2-3 權限 · §2-5 舊那列不動 · §2-6 片一
--
-- ══ 為什麼要有這支 ═══════════════════════════════════════════
-- Sean 2026-09-16 逐字:「我無法再上架時候改, 下架也沒辦法再改 然後上架」。
-- 他建了第一張首頁大圖、要改文案,而**改不動**。根因(讀活的正式庫 prosrc):
--   admin_home_banner_save_draft  IF status <> 'draft' THEN RAISE '只有草稿可以修改'
--   admin_home_banner_publish     IF status <> 'draft' THEN RAISE '只有草稿可以發布'
--   admin_home_banner_archive     SET status = 'archived'   ← 沒有任何回到 draft 的路
-- ⇒ draft → published → archived 是**單向**的;一旦發布,那一列永遠改不了也上不了架。
-- 🔵 全庫 grep duplicate|copy|clone|unarchive|restore ⇒ **0 命中** ⇒ 這功能從來沒人做過,不是壞了。
--
-- ══ 🔴 這支【不碰】那道刻意的閘 ════════════════════════════════
-- 「published 不可直接改」是刻意的:publish 那支還釘 p_expected_updated_at,
-- 註解逐字「**按發布的人批准的是他預覽的那一版**」⇒ 防的是線上的東西被人偷偷改掉。
-- ⇒ ✅ 本支**一個字都不碰它**。它做的是另一件事:**開一張新的草稿**,舊那列原封不動。
-- 📌 漏掉的是別的:archive 註解寫著「發得出去就要收得回來」——
--    那天補的是【出來】的路,**沒有人補回去的路**。**收得回來 ≠ 改得動。**
--
-- ══ 做什麼 ═══════════════════════════════════════════════════
-- 新增 public.admin_home_banner_duplicate(uuid, text, text) RETURNS uuid
--   把任一列(draft / published / archived)複製成一張新的 draft,回新那張的 id。
--
-- 🔴 **不複製的那幾欄,每一欄都有理由 —— 這是本支最該被讀到的部分**:
--   published_by / published_at   **那是一次批准的簽名。** 複製過去 = 偽造一個沒發生過的批准。
--   archived_by / archived_at     同上, 那是舊那列的歷史。
--   rights_confirmed → false      **那是一次人的確認, 不是一個屬性。** 複製過來 = 讓人跳過那一勾。
--   starts_at / ends_at → NULL    舊檔期已經開始甚至過了;新的一次要重新決定, 發布時再給。
--   (source_email_id / matched_variant_ids ⛔ ~~不複製~~ ⇒ **2026-09-16 改成複製**, 見下面那段)
--   status → 'draft'              複製出來的一定是草稿。
--   created_by / updated_by       改成**按複製的那個人**。
-- 🔵 **會複製的**:文字六欄 · 兩個圖網址 · image_origin · image_kind · rights_note
--   (圖已經在圖床上 ⇒ 不用重傳;rights_note 是**那張圖**的來源紀錄, 跟著圖走)。
--
-- ══ 🔴 source_email_id / matched_variant_ids:**複製**(2026-09-16 改過, 理由要留著)═══
-- ⛔ ~~原本不複製, 理由寫「複製品不是那封信生的」~~
-- 🔴 **那句話聽起來很對, 而它把一個【來歷】的問題講成一個【出身】的問題。**
--    複製品的**內容**就是那封信來的;把來歷丟掉 = **把那個內容該受的管一起丟掉**。
-- 🔴 **後果是一道閘一鍵失效**(adversarial-reviewer R1 MF1):
--    `20260916180000:241-246` 與表上 CHECK `home_banners_mail_published_needs_match`(同檔 :66)
--    **兩道都以 `source_email_id IS NOT NULL` 為前提** ⇒ 洗成 NULL 之後,
--    一張**沒配到任何商品**的廠商大圖, 勾個授權就發得上首頁(繞過 Sean 的 Q6 乙)。
--    📌 而 `20260916180000:11-18` 自己把同一個形狀列為必修過(save_draft 無條件覆寫那次)——
--       **這支原本是從另一個門把同一道閘關掉。**
-- ✅ **現在的規則:來歷跟著內容走** —— 與 `rights_note` 跟著圖走**是同一條**。
--    Sean 2026-09-16 逐字「甲 = 要」(主視窗端的時候照實講了是 plan 沒把後果寫出來)。
--
-- ══ 🔴 舊那列一個字不動 ════════════════════════════════════════
-- 本支對來源那列只有 SELECT(而且是 **FOR SHARE** 不是 FOR UPDATE —— 我們不改它,
-- 只要求它在這個交易裡不被人抽掉)。
-- ⇒ 📌 **複製不該有副作用。**「按一下東西不見了」是最難 debug 的那一種。
-- 🔬 而「兩張同時 published 會不會壞」我實查過(2026-09-16),不是猜:
--   storefront 讀 home_banners_live_v,`.order(starts_at desc).limit(HOME_BANNER_MAX_SLIDES = 4)`;
--   publish 那支 RPC 的註解逐字「Q9 乙:首頁可以同時掛多張」;
--   home_banners 的索引與 trigger 實查 ⇒ 只有 pkey + 一個 (status, updated_at) 的普通 index,
--   **沒有任何「同時只能一張」的 UNIQUE 或 trigger**。
--   🔴 **而這句話有一個前提,不寫出來會害人**(adversarial-reviewer R1 N4):
--      那條擋重疊的 EXCLUDE 是 `20260916150000:181` 建的,**是 `20260916180000:58`
--      `DROP CONSTRAINT home_banners_no_overlap_excl` 把它拿掉的**。
--      ⇒ 📌 **「沒有 UNIQUE」成立的前提是 180000 已經貼了。**
--         **若 180000 被回滾, 這句就不成立** —— 那時「複製 + 發布」會撞那條 EXCLUDE。
--      ⚠️ 寫出來不是免責, 是讓下一個人知道**要先確認哪件事**才能引用這句。
--   ⇒ 兩張同時 published 是**支援**的(輪播兩格, starts_at 新的在前)⇒ 所以不需要自動下架舊的。
--
-- ══ 權限 ═════════════════════════════════════════════════════
-- 與既有三支同一條:**在職員工**(staff.is_active)。
-- 🔵 理由:複製**不會讓任何東西上線** —— 它只生一張草稿,而發布那一關原封不動還在。
--   ⇒ 它比「發布」寬鬆不了,因為它繞不過發布。
-- EXECUTE 只給 service_role(同既有三支;後台的 key 就是 service_role)。
--
-- ══ 上線順序 ═══════════════════════════════════════════════════
-- 🟢 **板先貼、碼後推。** 函式不存在時那顆鈕會 PGRST202 ⇒ 碼先上 = 一顆按了就錯的鈕。
--    反過來只是多一支沒人叫的函式,零影響。
-- 🔵 **不碰任何既有函式的簽章** ⇒ 不是 2026-09-16 板 199 那種兩個方向都有空窗的情況。
-- 鎖:只 CREATE 一支新函式,不動表、不動既有函式、不 DROP 任何東西。
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶本支版本號)。
--
-- ══ rollback ═══════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
--   ⇧ 退回那支檔開頭就有這一行(照 repo 慣例的 5s)。rollback 是【人貼進 psql】跑的,
--     而 psql 預設沒有 lock_timeout ⇒ 卡在鎖上會無限等, 而「很慢」與「卡住」在畫面上
--     是同一個不動的游標。
-- supabase/rollbacks/20260916250000-rollback.sql
-- 🔵 **這支的退法乾淨**:DROP 掉那支函式就好 —— 它**只新增列、不改任何既有列**,
--    複製出來的草稿留著也無害(草稿不會上線)。**沒有資料要退。**

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 前置閘:已經有了就停,不要靜靜蓋掉
DO $pre$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_home_banner_duplicate(uuid,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘:admin_home_banner_duplicate 已經存在 ⇒ 貼過了或有人先建過, 停下對齊';
  END IF;
END
$pre$;

CREATE FUNCTION public.admin_home_banner_duplicate(
  p_banner_id  uuid,
  p_actor      text,
  p_request_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor      text := pg_catalog.btrim(p_actor);
  v_request_id text := pg_catalog.btrim(p_request_id);
  v_src        public.home_banners;
  v_new        public.home_banners;
BEGIN
  IF p_banner_id IS NULL OR v_actor IS NULL OR v_actor = ''
     OR v_request_id IS NULL OR v_request_id = '' THEN
    RAISE EXCEPTION '參數不正確';
  END IF;

  -- 在職員工即可(同 save_draft)。複製不會讓任何東西上線 ⇒ 它繞不過發布那一關。
  PERFORM 1 FROM public.staff s WHERE s.id = v_actor AND s.is_active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '無權執行此操作';
  END IF;

  -- 🔴 FOR SHARE 不是 FOR UPDATE:我們**不改**來源那列,只要求它在本交易內不被抽掉。
  SELECT * INTO v_src FROM public.home_banners b WHERE b.id = p_banner_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '找不到這張大圖';
  END IF;
  -- 🔵 三種狀態都可以複製(draft 也開:不開反而要多寫一條沒有人受益的規則)⇒ 這裡不擋 status。

  INSERT INTO public.home_banners (
    eyebrow, title_line1, title_line2, subtitle, cta_label, link_path,
    image_desktop_url, image_mobile_url, image_origin, image_kind,
    rights_confirmed, rights_note,
    starts_at, ends_at, source_email_id, matched_variant_ids,
    created_by, updated_by)
  VALUES (
    v_src.eyebrow, v_src.title_line1, v_src.title_line2, v_src.subtitle,
    v_src.cta_label, v_src.link_path,
    v_src.image_desktop_url, v_src.image_mobile_url, v_src.image_origin, v_src.image_kind,
    false,              -- 🔴 rights_confirmed:一次人的確認, 不是一個屬性 ⇒ 一律重來
    v_src.rights_note,  -- 🔵 那是【那張圖】的來源紀錄 ⇒ 跟著圖走
    NULL, NULL,         -- 🔴 starts_at / ends_at:舊檔期已經開始甚至過了 ⇒ 新的一次重新決定
    -- 🔴 source_email_id / matched_variant_ids:**帶過去**(見檔頭那段)。
    --    ⛔ ~~原本寫 `NULL, '{}'`~~ ⇒ 那會讓「要配到商品才准發」那道閘對複製品失效。
    v_src.source_email_id, v_src.matched_variant_ids,
    v_actor, v_actor)
  RETURNING * INTO v_new;
  -- 🔴 status / published_by / published_at / archived_by / archived_at **全部沒有列在上面**
  --    ⇒ 走欄位預設('draft' / NULL)。**那不是省略, 那是這支的重點**:
  --      published_* 是一次批准的簽名, 複製過去等於偽造一個沒發生過的批准。

  INSERT INTO public.admin_audit_log (actor, action, target, before, after, request_id)
  VALUES (v_actor, 'home_banner.duplicate', 'home_banner:' || v_new.id::text,
          pg_catalog.to_jsonb(v_src),   -- 🔵 before 放【被複製的那一列】⇒ 看得出這張從哪來
          pg_catalog.to_jsonb(v_new), v_request_id);

  RETURN v_new.id;
END
$fn$;

ALTER FUNCTION public.admin_home_banner_duplicate(uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_home_banner_duplicate(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_home_banner_duplicate(uuid, text, text) TO service_role;

COMMENT ON FUNCTION public.admin_home_banner_duplicate(uuid, text, text) IS
  '首頁大圖複製成新草稿(20260916250000)。任一狀態(draft/published/archived)都可以複製;新那張一律 draft、rights_confirmed=false、starts_at/ends_at/source_email_id/matched_variant_ids 清空、published_*/archived_* 不帶(那是一次批准的簽名)。來源那列一個字不動(FOR SHARE)。在職員工即可。寫 admin_audit_log home_banner.duplicate(before=來源那列)。EXECUTE 只給 service_role。';

-- ══ 事後閘:五格,每格說得出為什麼 ═══════════════════════════════
DO $post$
DECLARE
  v_functions text[] := ARRAY['public.admin_home_banner_duplicate(uuid,text,text)']::text[];
  f text; v_oid oid; n int;
BEGIN
  FOREACH f IN ARRAY v_functions LOOP
    -- 1. 函式真的建起來了(簽章逐字對得上)
    v_oid := pg_catalog.to_regprocedure(f)::oid;
    IF v_oid IS NULL THEN
      RAISE EXCEPTION '事後閘 1:% 不存在', f;
    END IF;

    -- 2. owner 是 postgres(SECURITY DEFINER 跑的是 owner 的權限 ⇒ 這一格決定它有多大)
    IF (SELECT pg_catalog.pg_get_userbyid(p.proowner) FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) <> 'postgres' THEN
      RAISE EXCEPTION '事後閘 2:% 的 owner 不是 postgres', f;
    END IF;

    -- 3. SECURITY DEFINER + search_path 釘住(這支讀寫 home_banners 與稽核表 ⇒ 兩者缺一都危險)
    SELECT count(*) INTO n FROM pg_catalog.pg_proc p
     WHERE p.oid = v_oid AND p.prosecdef AND p.proconfig @> ARRAY['search_path='];
    IF n <> 1 THEN
      RAISE EXCEPTION '事後閘 3:% 不是 SECURITY DEFINER 或 search_path 沒釘成空字串', f;
    END IF;

    -- 4. 🔴 EXECUTE 只給 service_role —— PUBLIC / anon / authenticated 一個都不能有
    IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid) IS NULL
       OR pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘 4a:% 的 PUBLIC 沒收掉', f;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘 4b:% 被 anon 或 authenticated 叫得動 ⇒ REVOKE 沒生效', f;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION '事後閘 4c:% 的 service_role 叫不動 ⇒ 後台按了會 42501', f;
    END IF;
  END LOOP;

  -- 5. 🔬 正對照:既有那三支【一支都沒有被動到】—— 本支只新增,不改任何既有函式
  SELECT count(*) INTO n FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname IN ('admin_home_banner_save_draft', 'admin_home_banner_publish', 'admin_home_banner_archive');
  IF n <> 3 THEN
    RAISE EXCEPTION '事後閘 5:既有三支現在是 % 支(期望 3)⇒ 有東西被動到或被多載, 停', n;
  END IF;
END
$post$;

COMMIT;
