-- #352-b:把「店內現貨」種子供應商翻成啟用。
--
-- 為什麼分兩步(a1 落 false、b 翻 true):a1 apply 之後、b 的 UI 上線之前,
-- 那家供應商若已經 active 就會出現在**採購下拉**裡(`apps/admin/src/lib/supplier.ts:29`
-- 逐字 `rows.filter((row) => row.is_active)`),而員工那時還沒有任何說明可看
-- ⇒ 先落 false、等入口做好再翻。plan v3.3 §6「b 的載具講明(R3-F6)」。
--
-- 🔴 **本片只翻旗標,不建列、不改 label、不動任何其他欄** ——
--    列由 a1 `20260810230000` 建立(固定 UUID)。查不到那一列 = a1 沒 apply 或有人動過,
--    **fail-loud、不自己補建**:靜默 INSERT 會在「label 被別人佔用」時撞 UNIQUE,
--    或更糟 —— 建出第二列而 a2/b 的固定 UUID 查到的是空的。
--
-- 🔴 **可逆**:回滾 = 同一支把 `is_active` 設回 false(見檔尾)。
--    它是單列、非結構、可逆的資料更正 ⇒ 依鐵則 12③ 字面(「DB **結構**與**大量/不可逆**寫入」)
--    **不命中**;走 code-reviewer。審查者若判它該升,照辦不爭。

DO $activate$
DECLARE
  -- 🔴 與 a1 `:213` 逐字同一個字面。
  --    ⚠️ plan §2.3 寫「改它要同步**五處**」——**本次實查對不上**,而且「處」本身有歧義
  --    (出現次數 vs 檔案數)。實測(2026-08-11,全樹 .sql/.ts/.tsx、排除 node_modules):
  --    這個字面只住在**兩個檔案**裡 —— `20260810230000`(4 次)與本檔(1 次宣告 + 註解)。
  --    ⇒ 這裡寫**檔案數**而不是「處」:要改它,該動的是那兩個檔。
  --    🔴 但**別信這行的數字**(它一樣會過期)。動手前自己跑一次:
  --    `grep -rln "00000000-0000-4000-8000-000000000352" --include=*.sql --include=*.ts --include=*.tsx .`
  v_id    constant uuid := '00000000-0000-4000-8000-000000000352';
  v_label constant text := '店內現貨';
  v_row   public.suppliers%ROWTYPE;
  v_n     integer;
BEGIN
  SELECT * INTO v_row FROM public.suppliers WHERE id = v_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '#352-b 翻啟用:找不到「店內現貨」種子列(id=%)—— a1 20260810230000 沒 apply?拒絕自行建列', v_id;
  END IF;

  -- label 一致才動它:不一致代表有人改過,我們對這一列的假設已經過期。
  IF v_row.label <> v_label THEN
    RAISE EXCEPTION '#352-b 翻啟用:id % 的 label 是 %(預期 %)—— 拒絕在假設過期的情況下改旗標',
      v_id, v_row.label, v_label;
  END IF;

  -- 冪等:已經是 true 就不寫(重跑本支不製造多餘的 UPDATE 與 trigger 級聯)。
  IF v_row.is_active THEN
    RAISE NOTICE '#352-b 翻啟用:已經是 active,no-op';
  ELSE
    UPDATE public.suppliers SET is_active = true WHERE id = v_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '#352-b 翻啟用:預期改 1 列、實際 % 列', v_n;
    END IF;
  END IF;

  -- 驗收:讀回來確認(不是「我下了 UPDATE 所以它成了」)。
  SELECT is_active INTO v_row.is_active FROM public.suppliers WHERE id = v_id;
  IF NOT v_row.is_active THEN
    RAISE EXCEPTION '#352-b 驗收:翻啟用之後讀回來仍是 false';
  END IF;
END
$activate$;

-- ── 回滾(需要時逐句手動執行;本片可逆)────────────────────────────────
-- 🔴 **回滾要包成單一交易**,不要逐句貼:`psql -f` 是 autocommit、無 ON_ERROR_STOP,
--    守門 RAISE 之後後面每一句照跑(memory `feedback_guard-effect-depends-on-how-it-is-executed`)。
--
-- BEGIN;
--   UPDATE public.suppliers SET is_active = false
--    WHERE id = '00000000-0000-4000-8000-000000000352';
-- COMMIT;
--
-- ⚠️ 回滾之後「店內現貨」會從採購下拉消失,但**已經掛在它底下的採購列與到貨紀錄不受影響**
--    (A5a 停用只擋新建與調升、事實欄照常;2026-08-03 晚 Sean Q1=A)。
