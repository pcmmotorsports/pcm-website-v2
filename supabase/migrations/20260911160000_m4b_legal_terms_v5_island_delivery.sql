-- 20260911160000_m4b_legal_terms_v5_island_delivery.sql
-- 服務條款第 7 條「交付地」改成含離島 ⇒ 新增條款版本列 '2026-09-12'。只 INSERT,不動任何既有列。
--
-- ── 這一版改了什麼對外文字(只有這一處,其餘一字未動)────────────────────────────
--   `apps/storefront/src/data/legal-content.ts` 第 7 條 商品交付 items[1]:
--     舊  '交付地:台灣本島(離島與海外另議)。'
--     新  '交付地:台灣全島(含離島);海外另議。'
--   `LEGAL_LAST_UPDATED` 維持 '2026-07-24'(Sean 2026-09-11 答「乙 = 不改」)。
--
-- ── 授權來源 ──────────────────────────────────────────────────────────────────
--   Sean 2026-08-29 拍 Q-ISLAND-FEE 乙「不分(差額我們自己吸收)」之後,
--   `/info/shipping` 已改成「台灣全島(含離島)同一運費」(fd8e0be6e),而 `/terms` 被改回舊句(185c124b0)
--   ⇒ 兩頁互相矛盾。Sean 2026-09-11 拍甲「今天出條款新版, 改成「台灣全島(含離島)」」。
--   運費算式沒有離島加價(`packages/domain/src/order/shipping.ts` 與 `charge-actions.ts` 的 `離島` 0 命中)⇒ 新句是真的。
--
-- ── content_hash 怎麼來的(可重跑)────────────────────────────────────────────
--   sha256(canonicalLegalPayload()),文字改好後由 `legal-content-hash.test.ts` 的失敗訊息印出:
--     npx vitest run --project storefront apps/storefront/src/data/legal-content-hash.test.ts
--     ⇒ 實際 hash = 294375cf719f6eaf475a8445d50613e4dd0a482e0b16850e15392a8c0459b713
--   同一發 Expected = b250342b…1376(現行 '2026-08-21')≠ Received ⇒ 尺是活的。
--
-- ── 🔴 遞給 Sean 之前:跑 preflight(先把上面那一處文字套進 legal-content.ts)────────
--     bash scripts/legal-terms-preflight.sh 2026-09-12 \
--       294375cf719f6eaf475a8445d50613e4dd0a482e0b16850e15392a8c0459b713 \
--       supabase/migrations/20260911160000_m4b_legal_terms_v5_island_delivery.sql
--   判準 = 末行逐字等於 `PREFLIGHT_RESULT=PASS`。通過後立刻遞,遞的那一刻再跑一次。
--
-- ── 🔴 發布順序(顛倒 = 全站結帳斷線)──────────────────────────────────────────
--   ① 本檔 apply ② 後查確認(下面那一發)③ **才** 讓「改字 + bump 常數」那一顆上 main:
--        CURRENT_TERMS_VERSION      '2026-08-21' → '2026-09-12'
--        CURRENT_TERMS_CONTENT_HASH 'b250342b…1376' → '294375cf…b713'
--   本次是「目標版本列在 DB 裡還不存在」那一種 ⇒ 先 bump 而沒有這一列 ⇒ 每筆結帳 FK 違反。
--   而改字與 bump 必須是**同一顆** commit:只有改字上線 ⇒ 客人讀新句、同意卻記在 '2026-08-21'
--   = 靜默舉證錯配(`terms-version.ts:36-40`)。本檔那一顆(只有 SQL)先上哪裡都不改變客人看到的東西。
--
-- ── 對照查詢:apply 前貼一次、apply 後貼一次 ────────────────────────────────────
--     select version, content_hash, effective_at
--     from public.legal_terms_versions
--     order by version;
--   判準:
--     前:'2026-09-12' 整列缺席 ⇒ 正常路徑。後:該列出現、content_hash = 294375cf…b713、
--         effective_at 落在前查與後查之間;其他四列前後逐字相同(沒動到不該動的列)。
--     前:'2026-09-12' 已存在、hash 相同 ⇒ 之前套過,可重跑(DO NOTHING),先問清楚是誰套的。
--     前:'2026-09-12' 已存在、hash 不同 ⇒ 🔴 停。不要 apply;下面 DO 區塊也會 RAISE。改開新版本鍵。
--   apply 後再跑一次 preflight(同三個參數)⇒ 末行仍須是 PASS;DB 值對了而 preflight 紅
--   = 中間有人改了 legal-content.ts ⇒ 不要 bump,改開新 migration。
--
-- ── 前查(正式庫唯讀,scripts/readonly-prod-sql.sh,2026-09-11T07:23:59Z)──────────
--   legal_terms_versions 目前 4 列:2026-06-30 / 2026-07-24 / 2026-08-19 / 2026-08-21
--   '2026-08-21' 的 content_hash = b250342b…1376(= 現行常數)
--   version = '2026-09-12' ⇒ 0 列(本檔)· 負對照 '9999-12-31' ⇒ 0 列 · 正對照 '2026-08-21' ⇒ 1 列
--   supabase_migrations.schema_migrations:唯讀角色 permission denied ⇒ **沒有量**,不是 0。
--   apply 若在很久之後,請重跑一次前查。
--
-- 要退回 ⇒ 跑 `supabase/rollbacks/20260911160000-rollback.sql`(該檔自帶 lock_timeout;
--   只在常數還沒 bump、而且沒有任何訂單簽過這一版時可跑)。

BEGIN;

INSERT INTO public.legal_terms_versions (version, content_hash, effective_at)
VALUES (
  '2026-09-12',
  '294375cf719f6eaf475a8445d50613e4dd0a482e0b16850e15392a8c0459b713',
  now()
)
ON CONFLICT (version) DO NOTHING;

-- 🔴 已存在而 hash 不同 ⇒ RAISE(整支回滾)。DO NOTHING 單獨擋不到這個世界。
DO $$
DECLARE v_hash text;
BEGIN
  SELECT content_hash INTO v_hash
    FROM public.legal_terms_versions WHERE version = '2026-09-12';
  IF v_hash IS NULL THEN
    RAISE EXCEPTION '20260911160000: 版本列 2026-09-12 不存在 —— INSERT 沒生效';
  END IF;
  IF v_hash <> '294375cf719f6eaf475a8445d50613e4dd0a482e0b16850e15392a8c0459b713' THEN
    RAISE EXCEPTION
      '20260911160000: 版本列 2026-09-12 已存在而 content_hash 不同(現值 %)—— '
      '停下,不要 bump 應用層常數,改開新版本鍵。', v_hash;
  END IF;
END $$;

COMMIT;
