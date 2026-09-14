-- 20260915090000-rollback.sql
--
-- 維修零件合併 回滾:重建子類 `維修零件 · 維修零件`(同 id / raw_path / segments / sort_order,
-- 值 = 2026-09-14 唯讀正式庫抄下來的),把頂層上的商品**全部**搬回子類。
-- 🔴 「全部搬回」只在【合併之後頂層沒有任何分類異動】(沒新同步、沒人工改掛)時才等於原狀:正向前置閘③釘住
--    「頂層此刻 0 件」,所以貼完當下頂層上的每一件都是搬上去的;之後進來的分不出誰是誰,會一起被搬到子類。
--    ⚠️ 件數相同(約 1,520)【不是】集合相同的證據(codex R2),只能當輔助;真要精確得保存搬移集合,本片不做。
-- 🔵 供應商 importer 的 `X · X` 退回 `X` 那條路對兩種世界都成立,不用跟著回。
-- 🔴 只在「貼完當日、合併之後沒有新同步 / 人工改掛」時精確(codex R1 must-fix 3;正向檔頭有寫):
--    合併後才進來的商品分不出誰是誰,會一起被搬到子類。先看件數再回;要精確就得保存搬移集合,本片不做。
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $rb$
DECLARE
  v_top_id   uuid;                                             -- 用 raw_path 找(鑽機 / 正式庫 id 不同;codex R1 nit)
  v_child_id uuid := 'ce697b77-b1e4-4072-ac53-f5c78b545ee8';  -- 正式庫原 id(2026-09-14 唯讀抄);別台庫上只是個新 uuid
  v_sep      text := ' · ';
  v_n        bigint;
BEGIN
  SELECT id INTO v_top_id FROM public.categories WHERE raw_path = '維修零件' AND parent_category_id IS NULL;
  IF v_top_id IS NULL THEN
    RAISE EXCEPTION '回滾前置閘:頂層 維修零件 不在,沒有東西可回';
  END IF;
  IF EXISTS (SELECT 1 FROM public.categories WHERE id = v_child_id OR raw_path = '維修零件' || v_sep || '維修零件') THEN
    RAISE EXCEPTION '回滾前置閘:子類還在 ⇒ 正向沒貼過或已回滾過,拒繼續';
  END IF;
  INSERT INTO public.categories (id, parent_category_id, name, raw_path, segments, sort_order)
  VALUES (v_child_id, v_top_id, '維修零件', '維修零件' || v_sep || '維修零件',
          to_jsonb(ARRAY['維修零件', '維修零件']), 10);
  UPDATE public.products SET category_id = v_child_id WHERE category_id = v_top_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF (SELECT count(*) FROM public.products WHERE category_id = v_top_id) <> 0 THEN
    RAISE EXCEPTION '回滾事後閘:頂層應剩 0 件';
  END IF;
  RAISE NOTICE '維修零件合併回滾:% 件商品搬回子類 %', v_n, v_child_id;
END
$rb$;
COMMIT;
