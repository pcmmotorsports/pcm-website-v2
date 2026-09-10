-- ↩️ 20260910200000 的回頭路 —— 把那一列空的「維修零件」放回去。
--
-- 🔴 這些值不是抄自 schema 預設, 是【刪之前從正式庫抓下來的原值】
--    (2026-09-10 20:1x 唯讀擷取, row_to_json 全欄)。
--    刪前 categories 總數 = 117。
--
-- 🛑 而它救不了什麼:那一列被刪的時候底下 0 件商品 0 子分類 ⇒ 沒有東西跟著它一起消失。
--    ⇒ 📌 這支的用途是「把世界還原成刪之前的樣子」, 不是「救資料」。
--
-- 🔵 created_at / updated_at 用原值寫回去 ⇒ 還原後那一列看起來就是 08-11 建的那一列。

BEGIN;

INSERT INTO public.categories
  (id, parent_category_id, name, raw_path, segments, sort_order, created_at, updated_at)
VALUES
  ('d83ce275-1dd7-489d-a4c1-809a5c5c87fc'::uuid,
   'e9f18025-dbc5-4aa7-9674-d755549950da'::uuid,
   '維修零件',
   '服務與其他 · 維修零件',
   ARRAY['服務與其他', '維修零件'],
   10,
   '2026-08-11T15:40:10.912731+00:00'::timestamptz,
   '2026-08-11T15:40:10.912731+00:00'::timestamptz);

DO $assert$
DECLARE v_dup bigint;
BEGIN
  SELECT count(*) INTO v_dup FROM public.categories WHERE name = '維修零件';
  IF v_dup <> 3 THEN
    RAISE EXCEPTION '還原斷言:同名「維修零件」應回到 3 列, 實際 % ⇒ 世界不是刪之前那樣了', v_dup;
  END IF;
  RAISE NOTICE '↩️ 還原完成 —— 而 sort_order=10 又變回兩列同名, 前台 .find() 選中誰又回到靠巧合。';
END
$assert$;

COMMIT;
