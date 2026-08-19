-- 20260819110000_m4b_legal_terms_v3_site_rename.sql
-- 站名改為「PCM重機零件販售」⇒ 對外法律文字變動 ⇒ 新增條款版本列 '2026-08-19'。
--
-- ┌── 🔴🔴 發布順序是硬性的,顛倒 = 每筆結帳 FK 違反、全站結帳斷線 ─────────────────
-- │   ① 本檔 apply（INSERT 新版本列）
-- │   ② 確認已套用
-- │   ③ **才** bump `CURRENT_TERMS_VERSION` + `CURRENT_TERMS_CONTENT_HASH`
-- │      並同時改 `legal-content.ts` 的三句對外字面（它們必須同一顆 commit，否則 hash 對不上）
-- │   ⇒ 這一段逐字抄自 `legal-content-hash.test.ts` 那道守門自己寫的修法。
-- └──────────────────────────────────────────────────────────────────────────────────
--
-- ── 為什麼是新版本鍵、不是覆寫 '2026-07-24' ──────────────────────────────────────
--   backlog #291 的驗收條件是「只能新增新版本列、不得修改既有列」。
--   20260724130000 那次覆寫是 **Sean 2026-07-24 拍板 Q1=A 的例外**（當時該版本尚無 consent）。
--   本次不同：'2026-07-24' 這一版**已經有客人簽過**（正式站自 7 月起持續收單）
--   ⇒ 覆寫會把舊客人的同意掛到新文字上 = **舉證錯配**。⇒ **開新鍵。**
--
-- ── 這一版改了什麼對外文字（只有站名，其餘一字未動）────────────────────────────
--   `LEGAL_UI_STRINGS.titleSuffix`  ' — PCM Motorsports'  →  ' — PCM重機零件販售'
--   服務條款 description / 隱私政策 description 各一處同樣的站名替換
--   ⇒ Sean 2026-08-19 拍板逐字「PCM Motorsports 要從網頁上消失，這個是錯誤的名字，
--     單純只有網域在用」。法定名（派達有限公司 / PCM MOTOR PARTS LTD）**一個字沒動**。
--
-- ── content_hash 怎麼來的（可重跑）──────────────────────────────────────────────
--   sha256(canonicalLegalPayload())，由 `legal-content-hash.test.ts` 失敗訊息印出。
--   🔴 **算了兩次、兩次相同**（主視窗要求）：57bcffae…2be8
--   ⚠️ **而它綁的是【那三句改完之後】的 legal-content.ts** ——
--     若在 apply 之前有人又動了任何一句對外法律文字，**這個 hash 就過期了**
--     ⇒ apply 前請重跑一次那支測試對照；不相同 ⇒ **停，不要 apply**，改開新的 migration。
--
--   🔴 **而那個「重跑一次」是【誰】做的（GR-077 nit，2026-08-19 折入）**：
--     **不是 Sean。** 他在 Supabase SQL Editor 裡貼這段 SQL，**他不會跑 vitest**。
--     ⇒ **責任在【把這支 SQL 遞給他的那個窗】** —— 遞出去之前先跑一次
--       `npx vitest run apps/storefront/src/data/legal-content-hash.test.ts`
--       （把 `legal-content.ts` 那三句改動套上去之後跑，取失敗訊息裡的「實際 hash」）
--       對不上本檔這個值 ⇒ **不要把這支 SQL 遞出去。**
--     📌 這一行寫在這裡**不夠** —— 它也要在 apply 佇列/交接條目上，
--       因為**讀這個檔的人與遞 SQL 的人不一定是同一個**（「寫對地方 ≠ 會被讀到」）。
--
-- ── apply 前**跟這支 SQL 一起貼**的一發唯讀查詢（GR-077 補；同一個交接項的第②個動作）──
--   用途：驗「'2026-07-24' 到底有沒有客人簽過」——
--   本檔選擇「開新鍵不覆寫」的**理由**寫著它有；而那是從前例檔頭推的，**沒有獨立查證**。
--   🔴 **這一發不會改變要不要 apply** —— 開新鍵在「有 consent」與「沒 consent」兩個世界都安全。
--     它只會決定上面那句**理由對不對**（要驗前提的是「覆寫」那條路，而本檔沒走）。
--
--     select v.version,
--            count(c.order_id) as 已簽筆數,
--            min(c.consented_at) as 最早,
--            max(c.consented_at) as 最晚
--     from public.legal_terms_versions v
--     left join public.order_legal_consents c on c.terms_version = v.version
--     group by v.version
--     order by v.version;
--
--   🔴 **為什麼是 LEFT JOIN 而不是直接 group by consents**（GR-077 抓到、成因是我寫的）：
--     `group by terms_version` 對**零筆的版本不會印一列** —— 它是**整列缺席**，不是顯示 0。
--     ⇒ 操作的人會在輸出裡**找不到那個 0**，然後不知道該怎麼判。
--   ✅ 而 LEFT JOIN 多拿一把尺：**'2026-08-19' 那一列，apply 前查【不存在】、apply 後【印 0 筆】**
--     ⇒ 順手驗了 INSERT 真的生效，與本檔下方的 `DO $$` 斷言**互為第二把尺**。
--   ⚠️ 那張表 RLS 啟用 + 零 policy + REVOKE ALL（含 service_role）⇒ **只有 SQL Editor 查得到。**
--
-- ⚠️ **本檔尚未 apply。** 鑰匙在 Sean 手上（G1 不 apply、不 push）。
-- ══════════════════════════════════════════════════════════════════════════════════

INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-08-19',
  '57bcffae87a095680ae5bee0fa2a75fc3ede9d4e4f87ae83174e33a2e8142be8',
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
    RAISE EXCEPTION '20260819110000: 版本列 2026-08-19 不存在 —— INSERT 沒生效';
  END IF;
  IF v_hash <> '57bcffae87a095680ae5bee0fa2a75fc3ede9d4e4f87ae83174e33a2e8142be8' THEN
    RAISE EXCEPTION
      '20260819110000: 版本列 2026-08-19 已存在而 content_hash 不同（現值 %）—— '
      '有人先建過這一鍵。停下，不要 bump 應用層常數。', v_hash;
  END IF;
END $$;
