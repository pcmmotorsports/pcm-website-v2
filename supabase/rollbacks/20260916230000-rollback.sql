-- 20260916230000-rollback.sql —— 退回 20260916230000_m4b_home_banner_storage_bucket.sql
--
-- 做什麼:刪掉 home-banners 這個桶。
-- 🔴 **順序不可以反**:先把 home_banners 裡引用到這個桶的列處理掉,再刪桶。
--    倒過來 ⇒ 圖沒了而大圖那一列還指著它 ⇒ **首頁當場破圖**。下面前置閘擋這件事。
-- ⚠️ 刪桶會把桶裡的圖一起帶走,而且**拿不回來**(我們沒有備份那些圖的地方)。
--    ⇒ 真的要退之前,先確認那些圖在別的地方還有一份,或確認不要了。
-- 🔵 退板之前**先退碼**:後台那顆「選檔上傳」若還在線上,退完按下去會失敗。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $pre$
DECLARE n int;
BEGIN
  -- 前置閘一:桶不在 ⇒ 沒貼過或已經退過
  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'home-banners';
  IF n <> 1 THEN
    RAISE EXCEPTION '退回前置閘一:home-banners 這個桶有 % 列(期望 1)⇒ 沒貼過或已經退過, 停', n;
  END IF;

  -- 🔴 前置閘二:還有大圖指著這個桶 ⇒ 不准退。先把那些列改回 supplier_url 或下架
  SELECT count(*) INTO n FROM public.home_banners
   WHERE image_desktop_url LIKE '%/storage/v1/object/public/home-banners/%'
      OR image_mobile_url  LIKE '%/storage/v1/object/public/home-banners/%';
  IF n <> 0 THEN
    RAISE EXCEPTION '退回前置閘二:還有 % 列大圖的圖指著這個桶 ⇒ 先把那幾列改回 supplier_url 或下架, 再退。硬退會讓首頁破圖', n;
  END IF;
END
$pre$;

DELETE FROM storage.objects WHERE bucket_id = 'home-banners';
DELETE FROM storage.buckets WHERE id = 'home-banners';

DO $post$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM storage.buckets WHERE id = 'home-banners';
  IF n <> 0 THEN RAISE EXCEPTION '退回事後閘:桶還在(% 列)', n; END IF;

  -- 🔬 正對照:RLS 仍然開著、policy 仍然 0 —— 退桶不應該動到這兩格
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';
  IF n <> 0 THEN RAISE EXCEPTION '退回事後閘:storage.objects 上冒出 % 條 policy ⇒ 不是這支做的, 停下看', n; END IF;
END
$post$;

COMMIT;
