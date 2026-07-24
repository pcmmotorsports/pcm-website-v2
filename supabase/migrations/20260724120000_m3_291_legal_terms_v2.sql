-- 20260724120000_m3_291_legal_terms_v2.sql
-- M-3 #291:登錄條款版本 '2026-07-24'(= /terms、/privacy 正式上線的那份對外文字)。
--
-- 真權威:內容 = apps/storefront/src/data/legal-content.ts;
--   hash = sha256(canonicalLegalPayload())、由 apps/storefront/src/data/legal-content-hash.test.ts 釘住
--   (該測試同時掃描本目錄,確認有一支 migration 同時含當前 version 與 hash ⇒ TS 與 .sql 不會單邊漂移)。
--
-- ┌── 為什麼需要這一支 ────────────────────────────────────────────────────────────
-- │ order_legal_consents.terms_version 對 legal_terms_versions(version) 有 FK,只收**已登錄**版本。
-- │ 舊值 '2026-06-30' 的 content_hash 來源是 design-reference/components/LegalPage.jsx(**草稿檔**),
-- │ 與客人實際讀到的 /terms 內容**對不上** → 稽核時「這位客人同意的是哪份文字」查無對證。
-- │ 本 migration 先把新版本 + 新內容 hash 登錄進來,storefront 才能安全 bump CURRENT_TERMS_VERSION。
-- │ 🔴 順序硬性:本檔 apply 完成前**不得**部署 bump 後的 storefront —— 否則每筆結帳 FK 違反、全站結帳斷線
-- │   (blast radius:charge-actions 的 placeOrder 在 initiatePayment 之前 ⇒ 零扣款、但結帳全斷)。
-- └────────────────────────────────────────────────────────────────────────────────
--
-- 鐵則 12 ③(DB 寫入)→ 高風險片。作用面極窄:單列 INSERT 進一張**非 PII、公開讀**的版本登錄表,
--   不動 schema、不動 RPC、不動任何既有列(舊版本列 = 既有訂單 FK 的指向對象,**永不可刪**)。
--
-- ⚠️ 內容口徑之誠實紀錄(2026-07-24):本版第 10 條主張「客製化委任代購不適用七日鑑賞期」,
--   係 **Sean 三度確認之拍板(選項 B)**,與 Claude 查證結論相反 ——
--   查證:通訊交易解除權合理例外情事適用準則第 2 條列舉 7 款例外,「代購」不在其中;
--   行政院總說明附表第二款明文「消費者依現有顏色或規格中加以指定或選擇者,非屬客製化給付」。
--   Claude 建議選項 D(僅對真客製品逐項標示排除);Sean 評估後選 B、風險自負。
--   完整法源與決策紀錄:memory `project_seven-day-withdrawal-stance-decision`。
--   ⇒ 本註記僅為稽核留痕,不影響本 migration 的技術正確性。
--
-- ⚠️ **本檔已於 2026-07-24 apply 至正式 DB**(history version 20260724120000、6 statements)。
--   自此**視為不可變**:以下僅修正被證偽的註解字面,**SQL 語句一字未動**。
--
-- ⚠️ **交易語意宣稱之更正(codex 關卡2 must-fix #1)**:本檔原註解宣稱「自帶 BEGIN/COMMIT ⇒
--   任一斷言 RAISE 即整檔 ROLLBACK」。該宣稱**未被證實、且推理有誤**:
--   supabase CLI 會把 migration history 的 INSERT 接在檔案敘述之後一起送 ExecBatch,
--   而批次中出現明確交易控制句時不再隱含包交易 ⇒ 本檔的 COMMIT 之後,history INSERT 屬另一筆交易。
--   理論失敗態 = 版本列已提交但 history 未寫 ⇒ DB 已變更、CLI 卻視為未套用。
--   🔴 **實測結果(2026-07-24 apply 後查證)**:`supabase_migrations.schema_migrations`
--   確有 20260724120000 一列(6 statements)⇒ **此次未發生分裂**;但這是觀察到的結果,不是保證。
--   ⇒ 後續 migration **不要**照抄「自帶 BEGIN/COMMIT 即原子」的推論;
--     真正成立的保證只有:本檔 INSERT 為 ON CONFLICT DO NOTHING、**重跑安全**。
--
-- ⚠️ **權限斷言範圍之更正(codex 關卡2 must-fix #5)**:2c 僅檢查 INSERT/UPDATE/DELETE,
--   **未檢查 TRUNCATE**(表級寫入、不受 RLS row policy 保護,同樣能毀掉版本舉證鏈)。
--   🔴 實測(2026-07-24):anon / authenticated / service_role 三者 TRUNCATE 皆為 false ⇒ 缺口未實際發生;
--   後續 migration 的權限 lock-in 應一併納入 TRUNCATE(修正版見 20260724130000)。
--
-- 驗證(2026-07-24 實跑,非推論):對正式專案跑 BEGIN→模擬→驗→ROLLBACK 零留痕通過;
--   突變自驗 = 先塞入同名版本但不同 hash,2a 斷言確實 RAISE `P0001`(非靜默放行)。
--   ⚠️ 該手動模擬**只涵蓋 SQL 語句本身**,不涵蓋 CLI 的 ExecBatch 路徑(見上)。

BEGIN;


-- ── 1. 登錄新版本 ───────────────────────────────────────────────────────────────
-- effective_at 用 now():本列生效時點 = apply 當下(storefront 隨後才部署)。
INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-07-24',
  'fd26ac4e1ffb06c6c9138b96bd5ae9239c9ed9dd718c57a40162bc97c736401d',
  now()
)
ON CONFLICT (version) DO NOTHING;


-- ── 2. fail-closed 自閘 ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_expected constant text := 'fd26ac4e1ffb06c6c9138b96bd5ae9239c9ed9dd718c57a40162bc97c736401d';
  v_actual   text;
  v_role     text;
BEGIN
  -- 2a. 新列存在,且 hash **逐字**等於預期。
  --     🔴 這道斷言的真正目的:上面用 ON CONFLICT DO NOTHING,若同名版本已存在但 hash 不同
  --     (例如同一天改了兩次條款、或 replay 時 legal-content.ts 已異動),INSERT 會**靜默不做事**
  --     而 storefront 卻 bump 成新 hash → 版本與內容再度對不上,且沒有任何錯誤訊息。
  --     ⇒ 這裡改成硬 RAISE:寧可 db push 失敗,也不要靜默漂移。
  SELECT content_hash INTO v_actual
    FROM public.legal_terms_versions WHERE version = '2026-07-24';

  IF v_actual IS NULL THEN
    RAISE EXCEPTION '#291:版本 2026-07-24 未登錄成功;拒繼續';
  END IF;
  IF v_actual <> v_expected THEN
    RAISE EXCEPTION
      '#291:版本 2026-07-24 已存在但 content_hash 不符(既有 %,預期 %)—— 條款內容已再次異動,請改用新版本鍵而非覆寫;拒繼續',
      left(v_actual, 12), left(v_expected, 12);
  END IF;

  -- 2b. 舊版本列必須原封不動:既有訂單的 order_legal_consents.terms_version 指向它,
  --     刪除或改寫 = 破壞既有訂單的同意紀錄舉證鏈。
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_terms_versions
    WHERE version = '2026-06-30'
      AND content_hash = 'a07a5f29bc5eb6b8600e75071862073d3a529550159d4d7d289d1ef577c4bd77'
  ) THEN
    RAISE EXCEPTION '#291:舊版本列 2026-06-30 遺失或已被改寫(既有訂單 FK 指向它);拒繼續';
  END IF;

  -- 2c. 權限矩陣 lock-in(本檔不改權限,這裡是「確認沒被別處改鬆」的斷言)。
  --     建表時(20260630120000:44)對 PUBLIC/anon/authenticated/**service_role** 一律 REVOKE ALL,
  --     再單獨 GRANT SELECT 給 anon/authenticated。
  --     🔴 service_role 一併查:它是後端 API key 的身分,漏查等於漏掉最有能力寫入的那個。
  --     ⚠️ 涵蓋範圍**僅** INSERT/UPDATE/DELETE,**不含 TRUNCATE**(見檔頭更正說明)。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.legal_terms_versions', 'INSERT')
    OR has_table_privilege(v_role, 'public.legal_terms_versions', 'UPDATE')
    OR has_table_privilege(v_role, 'public.legal_terms_versions', 'DELETE')
    THEN
      RAISE EXCEPTION '#291:legal_terms_versions 對 % 出現寫入權限(應為唯讀/無權);拒繼續', v_role;
    END IF;
  END LOOP;

  -- 2d. RLS 仍啟用(關掉會讓上面的 GRANT SELECT 變成無條件全表讀 —— 本表非 PII 故非災難,
  --     但「RLS 被誰關掉了」本身就是需要立刻知道的事)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.legal_terms_versions'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '#291:legal_terms_versions 的 RLS 已被關閉;拒繼續';
  END IF;
END $$;


-- ── 3. 更新表註解(hash 來源已從 design 草稿檔改為 storefront canonical payload)──
COMMENT ON TABLE public.legal_terms_versions IS
  'M-3 #241 條款版本登錄表。version=條款版本鍵(= storefront CURRENT_TERMS_VERSION);content_hash=該版本對外文字之 sha256。'
  '🔴 2026-07-24(#291)起 hash 來源 = apps/storefront/src/data/legal-content.ts 的 canonicalLegalPayload()'
  '(涵蓋頁標題/副標/SEO 描述/章節標題/內文/條列/最後更新日 = 客人實際讀得到的全部文字),'
  '由 legal-content-hash.test.ts 釘住(含掃描 migration 確認 .sql 與 TS 常數同步);'
  '舊列 2026-06-30 的 hash 來源為 design-reference/components/LegalPage.jsx 草稿檔,僅供既有訂單 FK 指向、**不得**再作內容來源。'
  'order_legal_consents.terms_version FK 此表 → 只收已登錄版本。非 PII、公開讀;寫入僅 migration seed;既有列永不刪。';


COMMIT;


-- Rollback(Supabase forward-only、僅供參考):
--   DELETE FROM public.legal_terms_versions WHERE version = '2026-07-24';
--   🔴 僅在「尚無任何 order_legal_consents 指向該版本」時可行(有則 FK 擋,且**不應**刪 —— 那是客人的同意紀錄)。
--   一併須把 storefront CURRENT_TERMS_VERSION / CURRENT_TERMS_CONTENT_HASH 退回 '2026-06-30' 那組並重新部署。
