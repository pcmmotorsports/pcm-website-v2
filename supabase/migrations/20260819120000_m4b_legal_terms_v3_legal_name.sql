-- 20260819120000_m4b_legal_terms_v3_legal_name.sql
-- 法律頁站名改為英文法定登記名「PCM MOTOR PARTS LTD」⇒ 新增條款版本列 '2026-08-19'。
--
-- ┌── 🔴 這一支【取代】20260819110000，而那一支【已被刪除】────────────────────────
-- │ 20260819110000（commit 77626d1e）寫的是把法律頁改成「PCM重機零件販售」，
-- │ hash = 57bcffae…2be8。**那個 hash 在 apply 之前就作廢了** ——
-- │ Sean 2026-08-19 在 apply 前改了要求：法律頁改用**英文法定登記名**，不是中文顯示名。
-- │
-- │ 🔴 **為什麼是【刪掉檔案】而不是【留著並註記「不得 apply」】**：
-- │   `supabase db push` **會套用所有不在 ledger 裡的 migration**，它不接受「跳過這一支」。
-- │   ⇒ 留著那支 = 下一次 db push 一定會把作廢的 hash 寫進 `legal_terms_versions`，
-- │     然後本支的 `ON CONFLICT DO NOTHING` 靜默跳過、斷言 RAISE、**db push 中途失敗**。
-- │   ⇒ 「不得 apply」是一個**沒有機制執行的指示**，而這裡有機制可以執行：**不要讓那個檔存在。**
-- │ ✅ 而**紀錄沒有消失**：commit 77626d1e 仍在歷史裡，它記著這件事發生過。
-- └──────────────────────────────────────────────────────────────────────────────────
--
-- 🔴🔴 發布順序是硬性的（逐字抄 legal-content-hash.test.ts 那道守門自己寫的修法）:
--   ① 本檔 apply ② 確認已套用 ③ **才** bump `CURRENT_TERMS_VERSION` + `CURRENT_TERMS_CONTENT_HASH`
--   顛倒 = 每筆結帳 FK 違反、全站結帳斷線。
--   ⚠️ 而 `legal-content.ts` 那三句**不在本檔這一顆裡**——
--     改了它、而常數還沒 bump ⇒ `legal-content-hash.test.ts` 會紅，
--     而**鐵則 11 不准帶著紅 commit**。⇒ 那三句與 bump **同一顆**，都等 apply 之後。
--     （改好的版本已備妥；本檔的 hash 就是對那個版本算的。）
--
-- ── 開新鍵 '2026-08-19'、不覆寫 '2026-07-24' ────────────────────────────────────
--   #291 驗收條件本來就是「只能新增新版本列、不得修改既有列」。
--   '2026-07-24' 已經有客人簽過 ⇒ 覆寫會把舊客人的同意掛到他沒看過的文字上 = 舉證錯配。
--   ⚠️ 「已經有客人簽過」我**沒有獨立查證**（要查正式庫）——
--     🔴 而這個決定對那個未驗前提是**不變的**：開新鍵在兩個世界都安全，
--       要驗前提的是「覆寫」那條路，而本檔沒走。
--
-- ── 這一版改了什麼對外文字（只有站名，標點與其餘一字未動）──────────────────────
--   `LEGAL_UI_STRINGS.titleSuffix`  ' — PCM Motorsports'  →  ' — PCM MOTOR PARTS LTD'
--   服務條款 / 隱私政策 description 各一處同樣的站名替換
--   ⚠️ **半形括號 `(派達有限公司)` 與半形冒號【刻意保留】** —— 那是本檔既有的標點慣例，
--     全文其餘各句同款。Sean 的訊息裡是全形，而**改標點不在他的指示範圍內**，
--     且只改這兩句會讓同一頁內自相不一致。⇒ **要改請明講，那是另一次 hash。**
--
-- ── content_hash 怎麼來的（可重跑）──────────────────────────────────────────────
--   sha256(canonicalLegalPayload())，由 `legal-content-hash.test.ts` 失敗訊息印出。
--   🔴 **算了兩次、兩次相同**：12a1bb0c…77e4，且**與作廢的 57bcffae… 不同**（證明真的改到了）。
--
--   🔴 **而它會過期 —— 這件事【今天已經真的發生過一次】**：
--     上一支的 hash 就是在 apply 前被使用者改字面而作廢的。
--     ⇒ apply 前**必須**重跑一次那支測試對照；不相同 ⇒ **停，不要 apply**，改開新的一支。
--
--   🔴 **而那個「重跑一次」是【誰】做的**：**不是 Sean。**
--     他在 Supabase SQL Editor 裡貼 SQL，**他不會跑 vitest**。
--     ⇒ 責任在**把這支 SQL 遞給他的那個窗**：遞出去之前先跑
--       `npx vitest run apps/storefront/src/data/legal-content-hash.test.ts`
--       對不上本檔這個值 ⇒ **不要把這支 SQL 遞出去。**
--     📌 這一行寫在這裡**不夠**，它也要在 apply 佇列/交接條目上
--       （讀這個檔的人與遞 SQL 的人不一定是同一個）。
--
-- ── apply 前**跟這支 SQL 一起貼**的一發唯讀查詢 ──────────────────────────────────
--     select v.version,
--            count(c.order_id) as 已簽筆數,
--            min(c.consented_at) as 最早,
--            max(c.consented_at) as 最晚
--     from public.legal_terms_versions v
--     left join public.order_legal_consents c on c.terms_version = v.version
--     group by v.version
--     order by v.version;
--   🔴 用 LEFT JOIN 不用 `group by consents`：後者對**零筆的版本不印一列**（整列缺席，不是 0）。
--   ✅ 順手多一把尺：'2026-08-19' 那列 **apply 前不存在、apply 後印 0 筆** ⇒ 與下方斷言互為對照。
--   ⚠️ 那張表 RLS 啟用 + 零 policy + REVOKE ALL（含 service_role）⇒ **只有 SQL Editor 查得到。**
--
-- ⚠️ **本檔尚未 apply。** 鑰匙在 Sean 手上（G1 不 apply、不 push）。
-- ══════════════════════════════════════════════════════════════════════════════════

INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-08-19',
  '12a1bb0ced95a5d0a9225a38869b371f9629ca90135bfda40492855a716677e4',
  now()
)
ON CONFLICT (version) DO NOTHING;

-- 🔴 斷言:本檔 apply 之後，那一列必須真的在（而且 hash 是我們寫的那個）。
--    `DO NOTHING` 會在「版本鍵已存在但 hash 不同」時**靜默不動** ⇒ 沒有這一段就看不出來。
DO $$
DECLARE v_hash text;
BEGIN
  SELECT content_hash INTO v_hash
    FROM public.legal_terms_versions WHERE version = '2026-08-19';
  IF v_hash IS NULL THEN
    RAISE EXCEPTION '20260819120000: 版本列 2026-08-19 不存在 —— INSERT 沒生效';
  END IF;
  IF v_hash <> '12a1bb0ced95a5d0a9225a38869b371f9629ca90135bfda40492855a716677e4' THEN
    RAISE EXCEPTION
      '20260819120000: 版本列 2026-08-19 已存在而 content_hash 不同（現值 %）—— '
      '很可能是已作廢的 20260819110000 被套用過。停下，不要 bump 應用層常數。', v_hash;
  END IF;
END $$;
