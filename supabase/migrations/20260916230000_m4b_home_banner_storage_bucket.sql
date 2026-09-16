-- 20260916230000_m4b_home_banner_storage_bucket.sql —— 首頁大圖圖床:建一個公開讀的桶
-- M-4b · 設計窗 pcm-website-v2-c1(版本號由主視窗 pcm-website-v2-6d 指定)
-- Sean 2026-09-16 逐字「甲 = 批, 開始做」⇒ 批准 docs/plans/2026-09-16-home-banner-image-upload.md
-- plan:同上 §2 放哪裡 · §3 誰能傳 · §5 rollback
--
-- pcm:idempotent: yes
-- 🔴 **這一行講的不是「重跑會 no-op」,是「重跑不會靜靜多一列」** —— 兩者不一樣,寫清楚免得誤讀。
--    那道閘擔心的逐字是「一支純 INSERT 的片子**重貼會加倍**」。本支加不了倍:
--    下面 `$pre$` 那道前置閘會先數 `storage.buckets` 有沒有 'home-banners',
--    有 ⇒ `RAISE EXCEPTION` ⇒ **整個交易回捲**,一列都不會多。
--    ⇒ 📌 所以第二次貼是**當場硬錯**,不是安靜成功。**它出聲是刻意的,不是缺陷。**
-- ⚠️ **刻意不寫成 `ON CONFLICT DO NOTHING`**:那會讓「重貼」變成靜靜成功,
--    而「有人又貼了一次」正是我希望有人看見的事。
-- 🔵 責任歸屬照那道閘自己的說法:「**責任在宣告者,本閘只證明有人看過**」——
--    看過的是設計窗 pcm-website-v2-c1,判準就是上面那兩句。
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
--   file_size_limit  4 MiB  ← 見下面「為什麼是 4 MiB」;現有 25 張品牌頁頁首圖最大 1156K
--
-- ══ 🔴 為什麼是 4 MiB(不是 5)════════════════════════════════
-- 這個上限被改小過一次。原因不是圖太大,是**最外面那一層比我們訂的小**:
--   畫面 → server(HB_UPLOAD)→ 本桶 → Next 的 bodySizeLimit → **Vercel Function 的 request body**
--   ⇒ 前四層對齊得再漂亮也不會發現第五層。
-- 🔴 **而選 4 MiB 不是因為確定平台是 4.5MB,是因為 4 MiB 在兩種說法下都成立**
--   (4.5MB ⇒ 4 MiB + 信封 ≈ 4.3MB 過得去;100MB ⇒ 當然過)⇒ 不押注在那個爭議上。
-- 🔬 證據留在 `apps/admin/src/lib/home-banners/home-banner-constants.ts` 的 HB_UPLOAD 檔頭
--   (「100MB」那篇 changelog 網址 404;limitations 頁逐字 4.5MB + 413 FUNCTION_PAYLOAD_TOO_LARGE)。
-- ⚠️ 改這個數字 ⇒ **`HB_UPLOAD.maxBytes` 要一起改**,有一格測試在比兩邊。
--   allowed_mime_types  image/jpeg · image/png · image/webp   只收圖
--
-- ══ 🔴 為什麼【不建 policy】才是安全的那一邊(這節是本支的重點)════
-- 實查 2026-09-16:
--   storage.objects  RLS **enabled**、policy **0 條**
--     🔬 這兩格 adversarial-reviewer 用【唯讀帳號】獨立複驗過,結論相同
--       (objects / buckets / s3_multipart_uploads / ..._parts 四張 relrowsecurity 全 t、policy 0 筆)
--   而 anon / authenticated 在 storage.objects 上的 **table GRANT 是開的**
--     (SELECT/INSERT/UPDATE/DELETE 都有 —— 那是 Supabase 的預設,不是誰設錯)
--     🔴 **這一格的來源要講明**:是用【看得到 storage schema 的身分】查 information_schema 得到的。
--        ⚠️ **`readonly-prod-sql.sh` 那個唯讀帳號核不到它** —— 它回 0 筆,而那是
--           【權限過濾後的 0(查不到)】不是【0(沒有)】;同一發 `SELECT ... FROM storage.buckets`
--           直接 `permission denied for schema storage` 就是證據。
--        ⇒ 📌 拿唯讀帳號去核這一句的人會以為它是假的。**它未被唯讀帳號證實,而結論不靠它** ——
--           RLS 開 + 0 policy 之下,GRANT 開不開都一樣擋。
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
  4194304,                                            -- 4 MiB(與 HB_UPLOAD.maxBytes 同源)
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
  IF b.file_size_limit <> 4194304 THEN RAISE EXCEPTION '事後閘 1:大小上限是 % 不是 4 MiB', b.file_size_limit; END IF;
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
