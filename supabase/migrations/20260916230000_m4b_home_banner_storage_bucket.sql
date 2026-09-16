-- 20260916230000_m4b_home_banner_storage_bucket.sql —— 首頁大圖圖床:建一個公開讀的桶
-- M-4b · 設計窗 pcm-website-v2-c1(版本號由主視窗 pcm-website-v2-6d 指定)
-- Sean 2026-09-16 逐字「甲 = 批, 開始做」⇒ 批准 docs/plans/2026-09-16-home-banner-image-upload.md
-- plan:同上 §2 放哪裡 · §3 誰能傳 · §5 rollback
--
-- ══ 為什麼要有這支 ═══════════════════════════════════════════
-- 後台大圖那一格只收一串 https 文字(home-banner-form.ts:82 readText / :104 isHttpsUrl),
-- 而整個 repo 掃 S3Client / PutObject / storage.from( / createSignedUploadUrl / R2_
-- 在 apps + packages + scripts 三處合計 **0 命中**
-- ⇒ home_banners 的 image_origin CHECK 收 'supplier_url' | 'storage',
--    而 **'storage' 這個值沒有任何程式產得出來**。這支把那一端補上。
-- 🔬 實查(2026-09-16,帶正對照):storage schema 有 8 張表(⇒ 查詢是活的)、
--    storage.buckets **0**、storage.objects **0** ⇒ Storage 裝著而一個桶都沒開過。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════
-- **只 INSERT 一列桶。不建任何 policy。**
--   id / name        home-banners
--   public           true   ← 首頁大圖本來就要給客人看
--   file_size_limit  5 MiB  ← 現有 25 張品牌頁頁首圖最大 1156K,用不到 5MB
--   allowed_mime_types  image/jpeg · image/png · image/webp   只收圖
--
-- ══ 🔴 為什麼【不建 policy】才是安全的那一邊(這節是本支的重點)════
-- 實查 2026-09-16:
--   storage.objects  RLS **enabled**、policy **0 條**
--   而 anon / authenticated 在 storage.objects 上的 **table GRANT 是開的**
--     (SELECT/INSERT/UPDATE/DELETE 都有 —— 那是 Supabase 的預設,不是誰設錯)
-- ⇒ 📌 **擋住 anon 寫入的不是 GRANT,是「RLS 開著而且一條 policy 都沒有」。**
--    RLS 開 + 0 policy ⇒ 非 bypass 的角色一律拒絕。service_role 走 bypass ⇒ 後台照樣寫得進去。
-- ⇒ 🔴 **所以這支【加任何一條 policy 都只會放寬】。** 本支一條都不加,
--    而且下面的事後閘會盯著「policy 仍然是 0」——有人加了就當場出聲。
-- ⚠️ 公開讀走的是 `/storage/v1/object/public/<bucket>/<path>` 這條**不經 RLS** 的路,
--    由 buckets.public = true 決定 ⇒ 公開讀**不需要**也**不應該**為它寫 policy。
--
-- ══ 上線順序 ═══════════════════════════════════════════════════
-- 🟢 **板先貼,再推碼。** 桶不存在時上傳會失敗 ⇒ 碼先上會是一顆按了就錯的鈕。
--    反過來(板先貼、碼還沒上)⇒ 只是多一個沒人用的空桶,零影響。
-- 🔵 這支**不碰函式簽章** ⇒ 不是 2026-09-16 板 199 那種兩個方向都有空窗的情況。
-- 鎖:只 INSERT storage.buckets 一列,不動 public schema 任何東西,不 DROP 任何東西。
-- 🔴 貼完同批跑 pcm_acl_approve_latest(p_note 帶本支版本號)。
--
-- ══ rollback ═══════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
--   ⇧ rollback 檔開頭就有這一行(照 repo 慣例的 5s)。為什麼要有:rollback 是【人把它貼進 psql】
--     跑的,而 psql 預設沒有 lock_timeout ⇒ 卡在鎖上會【無限等】,
--     而「很慢」與「卡在鎖上」在那個畫面上是同一件事 —— 兩者都是一個不動的游標。
-- supabase/rollbacks/20260916230000-rollback.sql
-- 🔴 **順序不可以反**:先把 home_banners 裡引用到這個桶的列改回 supplier_url 或下架,
--    再刪桶。倒過來做 ⇒ 圖沒了而大圖那一列還指著它 ⇒ 首頁破圖。
--    那道前置閘住在退回那支檔裡, 不是住在人的記性裡。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- 前置閘:桶已經在了就停,不要靜靜地當作成功
DO $pre$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'home-banners';
  IF n <> 0 THEN
    RAISE EXCEPTION '前置閘:home-banners 這個桶已經有 % 列 ⇒ 貼過了或有人手開過, 停下對齊', n;
  END IF;
END
$pre$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'home-banners',
  'home-banners',
  true,
  5242880,                                            -- 5 MiB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
);

-- ══ 事後閘:三格,每一格都說得出「為什麼是這個數」═══════════════
DO $post$
DECLARE n int; b record;
BEGIN
  -- 1. 桶真的建起來了,而且參數就是上面寫的那些(不是「INSERT 沒報錯」而已)
  SELECT * INTO b FROM storage.buckets WHERE id = 'home-banners';
  IF b IS NULL THEN RAISE EXCEPTION '事後閘 1:桶不在'; END IF;
  IF b.public IS NOT TRUE THEN RAISE EXCEPTION '事後閘 1:public 不是 true ⇒ 客人讀不到'; END IF;
  IF b.file_size_limit <> 5242880 THEN RAISE EXCEPTION '事後閘 1:大小上限是 % 不是 5 MiB', b.file_size_limit; END IF;
  IF b.allowed_mime_types IS DISTINCT FROM ARRAY['image/jpeg','image/png','image/webp'] THEN
    RAISE EXCEPTION '事後閘 1:allowed_mime_types 是 % ⇒ 不是只收那三種圖', b.allowed_mime_types;
  END IF;

  -- 2. 🔴 storage.objects 上仍然 0 條 policy —— 擋住 anon 寫入的就是這個 0
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF n <> 0 THEN
    RAISE EXCEPTION '事後閘 2:storage.objects 上出現 % 條 policy。本支一條都沒加 ⇒ 是別人加的, 而任何一條都只會放寬 ⇒ 停下看那一條在做什麼', n;
  END IF;

  -- 3. 🔬 正對照:RLS 真的還開著。關掉的話上面那個 0 就從「全擋」變成「全開」,而數字一模一樣
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'storage' AND c.relname = 'objects' AND c.relrowsecurity;
  IF n <> 1 THEN
    RAISE EXCEPTION '事後閘 3:storage.objects 的 RLS 沒開 ⇒ 0 條 policy 從【全擋】變成【全開】, 停';
  END IF;
END
$post$;

COMMIT;
