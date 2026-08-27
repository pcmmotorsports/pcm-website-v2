-- 20260724130000_m3_291_legal_terms_hash_correction.sql
-- M-3 #291 修正:把版本 '2026-07-24' 的 content_hash 更新為對外文字**定稿後**的實際雜湊。
--
-- ┌── 為什麼會有這一支(誠實原委)──────────────────────────────────────────────────
-- │ 20260724120000 於 2026-07-24 apply 時,登錄的 hash 是 fd26ac4e…401d。
-- │ 其後 codex 關卡2 判 NO-GO,其中兩項 must-fix **改動了對外文字本身**:
-- │   ① SEO 描述、麵包屑「首頁」、「最後更新:」標籤、分頁標題後綴原本不在雜湊涵蓋範圍內
-- │      → 收進 canonicalLegalPayload()(這些字客人讀得到,漏收 = 可被改而 hash 不變)。
-- │   ② 第 10 條「非本公司既有現貨庫存」與商品頁/配送頁的現貨敘述互相矛盾 → 改為「以…為原則」。
-- │   ③ 隱私政策 localStorage 段易被誤解為「資料永不上傳」→ 補述結帳時會隨訂單送出。
-- │   ④ codex R2 指出 ③ 仍不精確(頁面載入即背景呼 server action 查價;結帳另送車輛資訊)
-- │      → **Sean 2026-07-24 拍 Q3=A**「改準確、接受再推一次」,改寫為兩段式據實描述
-- │      (已核對實際程式:useResolvedCart 於 hydration 後呼 resolveCartLines 送 productId/variantId;
-- │       charge-actions 的 PlaceOrderInput 含 lines[].vehicle 車輛快照 + cartSessionId)。
-- │ ⇒ 定稿內容的雜湊變為 eca6a241…b6ab,與已登錄的 fd26ac4e…401d 不符。
-- │   (中途曾短暫為 d6117ee5…cd6c;Sean 拍 Q3=A 後再修隱私政策文字 ⇒ 定稿為 eca6a241。
-- │    d6117ee5 **從未寫入 DB**、僅存在於本 session 的中間狀態。)
-- │
-- │ 🔴 **提早部署的真實風險(codex 關卡2 R2 A4 更正,原描述是錯的)**:
-- │   版本列 '2026-07-24' **已經存在**於正式 DB ⇒ 現在部署 storefront **不會** FK 失敗、結帳不會斷。
-- │   FK 只綁 `terms_version`、**不綁 `content_hash`** ⇒ 會**成功建單**,並把客人對「新條款畫面」的同意
-- │   掛到一列 content_hash 仍是舊值 fd26ac4e 的版本上 —— **靜默的舉證錯配**,沒有任何錯誤訊息。
-- │   ⇒ 危險性比原本寫的「結帳全斷」**更高**(壞事發生時不會有人發現)。
-- │   而且事後補推本檔時,若期間已產生 consent,守衛會拒絕覆寫 → 只能改開新版本鍵收拾。
-- └────────────────────────────────────────────────────────────────────────────────
--
-- ✅ **覆寫策略 = Sean 2026-07-24 拍板 Q1=A**(codex 關卡2 R2 B1 指出這牴觸 backlog #291 驗收條件
--   「只能新增新版本列、不得修改既有列」→ 已上呈 Sean、由他裁定採覆寫;理由見下)。
--
-- 🔴 **為什麼可以覆寫、而不是開新版本鍵**(20260724120000 的 2a 斷言正確地要求「改用新版本鍵而非覆寫」):
--   那條規則的用意是**不得竄改客人已經簽過的版本**。本案不適用,因為:
--     · 實測(2026-07-24):`order_legal_consents` **零筆**指向 '2026-07-24'(僅 1 筆指向舊版 '2026-06-30');
--     · bump 後的 storefront **從未部署**,不可能有客人看過或同意過這個版本鍵。
--   ⇒ 這是「同一天、尚未對外生效的版本定稿」,非改寫歷史。
--   **規則由機制守、不靠人記得**:覆寫語句自帶 `WHERE NOT EXISTS (consent 指向該版本)`,
--   有人簽過就寫不進去;第 2 段再驗 hash,守衛擋下時會以 RAISE 現形(不會靜默 no-op)。
--
-- ⚠️ **交易語意(不重蹈 20260724120000 的錯誤宣稱)**:本檔**不自帶 BEGIN/COMMIT**。
--   理由:supabase CLI 會把 migration history 的 INSERT 與檔案敘述一起送 ExecBatch,
--   批次中出現明確交易控制句時不再隱含包交易 ⇒ 自帶 COMMIT 反而可能把 history 切到另一筆交易。
--   本檔**不宣稱整檔原子性**。真正成立的保證有兩點,皆為單一語句層級:
--     · 覆寫與其守衛在**同一個 INSERT ... ON CONFLICT ... WHERE 語句**內求值(無中間視窗);
--     · 重跑安全:第二次執行時 hash 已相同,DO UPDATE 寫入同值、`effective_at` 不動。
--   ⚠️ **不宣稱 idempotent 到「完全無寫入」**:conflict 分支仍會執行一次 UPDATE(寫入相同值)。
--
-- 鐵則 12 ③(DB 寫入)。作用面:單列 UPDATE 一張非 PII、公開讀的版本登錄表;不動 schema/RPC/既有舊版本列。


-- ── 1. 定稿雜湊:**單一 statement 內**完成「零 consent 檢查 + 覆寫」──────────────────
--
-- 🔴 為什麼把守衛塞進 ON CONFLICT 的 WHERE、而不是先跑一段 DO 檢查(codex 關卡2 R2 新問題 B2):
--   「先 SELECT count(*) 確認為 0,再 UPDATE」是**兩個 statement**;
--   在無法證明整檔原子性的前提下(見檔頭交易語意說明),兩者之間可能插入一筆 consent
--   → 檢查通過、覆寫照做,結果仍改寫了客人簽過的版本。
--   放進同一個 INSERT ... ON CONFLICT DO UPDATE ... WHERE,條件與寫入由 PostgreSQL
--   在**同一個語句**內求值,不存在中間可插入的視窗。
--
-- 🔴 `DO UPDATE SET` **只寫 content_hash、不碰 effective_at**(codex R2 A1):
--   版本的「生效時點」是事實,不該因為修一次 hash 就往後跳。
--   VALUES 裡的 `now()` 只在本列不存在(純新增路徑)時才會被採用。
INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-07-24',
  'eca6a2415d0599c16fbea7ed81316584dab6ba6c7856e4c48f9e5c89514cb6ab',
  now()
)
ON CONFLICT (version) DO UPDATE
  SET content_hash = EXCLUDED.content_hash
  WHERE NOT EXISTS (
    SELECT 1 FROM public.order_legal_consents
    WHERE terms_version = '2026-07-24'
  );


-- ── 2. fail-closed 自閘 ───────────────────────────────────────────────────────────
DO $$
DECLARE
  v_expected constant text := 'eca6a2415d0599c16fbea7ed81316584dab6ba6c7856e4c48f9e5c89514cb6ab';
  v_actual   text;
  v_role     text;
  v_consents bigint;
BEGIN
  -- 2a. 定稿 hash 已落地。
  --     🔴 若上一段的 WHERE 守衛擋下了覆寫(= 期間出現 consent),這裡就會抓到 hash 仍是舊值 → RAISE。
  --     ⇒ 「守衛擋下」不會變成靜默 no-op,一定以 db push 失敗的形式現形。
  SELECT content_hash INTO v_actual
    FROM public.legal_terms_versions WHERE version = '2026-07-24';
  IF v_actual IS DISTINCT FROM v_expected THEN
    SELECT count(*) INTO v_consents
      FROM public.order_legal_consents WHERE terms_version = '2026-07-24';
    RAISE EXCEPTION
      '#291:版本 2026-07-24 的 content_hash 非預期(實際 %,預期 %);該版本現有 % 筆同意紀錄 —— 若 >0 表示已被客人簽署、依設計拒絕覆寫,請改開新版本鍵;拒繼續',
      left(coalesce(v_actual, 'NULL'), 12), left(v_expected, 12), v_consents;
  END IF;

  -- 2b. 舊版本列原封不動(既有訂單 FK 指向它)。
  IF NOT EXISTS (
    SELECT 1 FROM public.legal_terms_versions
    WHERE version = '2026-06-30'
      AND content_hash = 'a07a5f29bc5eb6b8600e75071862073d3a529550159d4d7d289d1ef577c4bd77'
  ) THEN
    RAISE EXCEPTION '#291:舊版本列 2026-06-30 遺失或已被改寫;拒繼續';
  END IF;

  -- 2c. 權限矩陣 lock-in —— 🔴 **含 TRUNCATE**(20260724120000 的 2c 漏查、codex 關卡2 must-fix #5)。
  --     TRUNCATE 是表級寫入、不受 RLS row policy 保護,同樣能一次清掉整張版本舉證鏈。
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.legal_terms_versions', 'INSERT')
    OR has_table_privilege(v_role, 'public.legal_terms_versions', 'UPDATE')
    OR has_table_privilege(v_role, 'public.legal_terms_versions', 'DELETE')
    OR has_table_privilege(v_role, 'public.legal_terms_versions', 'TRUNCATE')
    THEN
      RAISE EXCEPTION
        '#291:legal_terms_versions 對 % 出現寫入權限(INSERT/UPDATE/DELETE/TRUNCATE 任一);拒繼續', v_role;
    END IF;
  END LOOP;

  -- 2d. RLS 仍啟用。
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.legal_terms_versions'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION '#291:legal_terms_versions 的 RLS 已被關閉;拒繼續';
  END IF;
END $$;


-- Rollback(Supabase forward-only、僅供參考):
--   以同款 upsert 把 content_hash 寫回 'fd26ac4e1ffb06c6c9138b96bd5ae9239c9ed9dd718c57a40162bc97c736401d',
--   並把 storefront CURRENT_TERMS_CONTENT_HASH 一併退回、重新部署。
--   🔴 若屆時已有 consent 指向 '2026-07-24',**不得**覆寫 —— 改開新版本鍵。
