-- 20260912030000_m4b_legal_terms_v6_copy_rewrite.sql
-- 服務條款 + 隱私政策整篇改寫(Sean 09-12 貼稿)⇒ 新增條款版本列 '2026-09-13'。只 INSERT,不動任何既有列。
-- pcm:idempotent: yes
--   理由:INSERT … ON CONFLICT (version) DO NOTHING + DO 斷言 hash(同 20260911160000 的形狀);
--   已存在而 hash 不同 ⇒ RAISE 整支回滾。⚠️ 本支【沒有】在拋棄式 PG 實跑過(v5 那支有)。
--
-- ── 這一版改了什麼對外文字 ────────────────────────────────────────────────────
--   `apps/storefront/src/data/legal-content.ts`:TERMS_SECTIONS 與 PRIVACY_SECTIONS 整篇換成 Sean 09-12 的稿
--   (稿與修正:`~/pcm-mailbox/2026-09-12-文案改版-四頁.md`,「修正與拍板」優先)。
--   🔴 第 10 條「商品性質」「鑑賞期(合理例外之事前告知)」兩條 = 舊字逐字保留(Sean Q3 乙)。
--   PRIVACY_DOC.subtitle 多「聲明」兩字;LEGAL_LAST_UPDATED '2026-07-24' → '2026-09-13'(Sean Q2 甲 = 上線那天,
--   上線日未定 ⇒ 佔位;真上線日若不同 ⇒ 又一個版本鍵 + 又一支 migration)。
--
-- ── 版本鍵為什麼是 '2026-09-13' ─────────────────────────────────────────────────
--   '2026-09-12' 已被 v5 佔用(20260911160000,貼板 128 已貼)。version 是 text PK、DB 無格式約束;
--   格式由 `legal-content-hash.test.ts:133` 釘成 YYYY-MM-DD。repo 內 '2026-09-13' 0 命中。
--   ⚠️ 正式庫前查【沒有做】—— 貼之前跑下面「對照查詢」確認 '2026-09-13' 整列缺席。
--
-- ── content_hash 怎麼來的(可重跑)────────────────────────────────────────────
--   sha256(canonicalLegalPayload()),由 `legal-content-hash.test.ts` 的失敗訊息印出:
--     npx vitest run --project storefront apps/storefront/src/data/legal-content-hash.test.ts
--     ⇒ 實際 hash = b7203107bd99bba2933aaa60754d3dba96f482576e8695f7d7c6f5884ac91724
--   同一發 Expected = 294375cf…b713(現行 '2026-09-12')≠ Received ⇒ 尺是活的。
--
-- ── 🔴 遞給 Sean 之前:跑 preflight ──────────────────────────────────────────────
--     bash scripts/legal-terms-preflight.sh 2026-09-13 \
--       b7203107bd99bba2933aaa60754d3dba96f482576e8695f7d7c6f5884ac91724 \
--       supabase/migrations/20260912030000_m4b_legal_terms_v6_copy_rewrite.sql
--   判準 = 末行逐字等於 `PREFLIGHT_RESULT=PASS`。
--
-- ── 🔴 發布順序(顛倒 = 全站結帳斷線)──────────────────────────────────────────
--   ① 本檔 apply ② 後查確認 ③ **才** 讓「改字 + bump 常數」那一顆上 main:
--        CURRENT_TERMS_VERSION      '2026-09-12' → '2026-09-13'
--        CURRENT_TERMS_CONTENT_HASH '294375cf…b713' → 'b7203107…1724'
--   🔴 **而 v5('2026-09-12')那一顆也還沒上 main** —— 兩版都要在 DB 裡,main 才能往前推。
--
-- ── 對照查詢:apply 前貼一次、apply 後貼一次 ────────────────────────────────────
--     select version, content_hash, effective_at
--     from public.legal_terms_versions
--     order by version;
--   判準:
--     前:'2026-09-13' 整列缺席 ⇒ 正常路徑。後:該列出現、content_hash = b7203107…1724;其他列前後逐字相同。
--     前:'2026-09-13' 已存在、hash 相同 ⇒ 之前套過,可重跑(DO NOTHING),先問清楚是誰套的。
--     前:'2026-09-13' 已存在、hash 不同 ⇒ 🔴 停。不要 apply;下面 DO 區塊也會 RAISE。改開新版本鍵。
--
-- 要退回 ⇒ 跑 `supabase/rollbacks/20260912030000-rollback.sql`(只在常數還沒 bump、而且沒有任何訂單簽過這一版時可跑)。

BEGIN;

INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-09-13',
  'b7203107bd99bba2933aaa60754d3dba96f482576e8695f7d7c6f5884ac91724',
  now()
)
ON CONFLICT (version) DO NOTHING;

-- 🔴 已存在而 hash 不同 ⇒ RAISE(整支回滾)。DO NOTHING 單獨擋不到這個世界。
DO $$
DECLARE v_hash text;
BEGIN
  SELECT content_hash INTO v_hash
    FROM public.legal_terms_versions WHERE version = '2026-09-13';
  IF v_hash IS NULL THEN
    RAISE EXCEPTION '20260912030000: 版本列 2026-09-13 不存在 —— INSERT 沒生效';
  END IF;
  IF v_hash <> 'b7203107bd99bba2933aaa60754d3dba96f482576e8695f7d7c6f5884ac91724' THEN
    RAISE EXCEPTION
      '20260912030000: 版本列 2026-09-13 已存在而 content_hash 不同(現值 %)—— '
      '停下,不要 bump 應用層常數,改開新版本鍵。', v_hash;
  END IF;
END $$;

COMMIT;
