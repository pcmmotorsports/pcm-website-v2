-- ═══════════════════════════════════════════════════════════════════════════
-- 給 `pcm_readonly` 兩張表的 SELECT:`search_queries` · `order_pending_refunds`
-- ═══════════════════════════════════════════════════════════════════════════
-- 為什麼:2026-09-05 有人要「search_queries 今天幾筆」「order_pending_refunds 幾列」
--   兩個數,而唯讀角色對這兩張表拿到的是 `ERROR: permission denied`。
--   🔴 **那與「0 筆」是兩件事, 而它們在報告上長得幾乎一樣** ——
--      一句「還是空的」若是從 permission denied 推出來的, 它是**假的**,
--      而假在【比較安心】的那一側:沒有人會回頭查一個「本來就該是空的」的表。
--   ⇒ 所以這一片解的不是方便, 是**讓那個 0 有機會是真的**。
--
-- 🛑 射程(逐字):這是 **SELECT only**, 給 **`pcm_readonly` 一個角色**, **兩張表**。
--    · 它**不給** INSERT / UPDATE / DELETE, 也不動任何 RLS policy。
--    · ⚠️ 而 `pcm_readonly` **帶 `BYPASSRLS`**(2026-09-05 實測 `rolbypassrls = true`)
--      ⇒ 📌 **給了 SELECT 之後它讀到的是【全部的列】, 不受 RLS 收窄。**
--      ⇒ 這兩張表若含個資或敏感內容, **這一片就是一個要想清楚的決定**, 不是例行授權。
--        `search_queries` = 客人打過的搜尋字;`order_pending_refunds` = 待退款。
--        ⇒ 🔴 **貼之前請確認你要的是「能查數字」而不是「能讀內容」** ——
--          這一片給的是後者, 因為 SQL 的 SELECT 沒有「只能 count 不能看列」這種粒度。
--
-- 🔵 貼完怎麼驗(兩個世界):
--      貼【前】 SELECT has_table_privilege('pcm_readonly','public.search_queries','SELECT');  ⇒ f
--      貼【後】 同一句                                                                        ⇒ t
--    ⇒ 只看「不再報錯」不夠 —— 那在「表被刪掉」的世界裡也不報錯。
--
-- ↩️ Rollback(一句, 貼下面那行就回到原狀):
--      REVOKE SELECT ON public.search_queries, public.order_pending_refunds FROM pcm_readonly;
--    ⚠️ 而 REVOKE **收不到 PUBLIC 授權** —— 本片沒有給 PUBLIC, 所以這一句夠;
--      若將來有人另外給了 PUBLIC, 那要另一句 `FROM PUBLIC`(本 repo 記過的「兩道 REVOKE」)。
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 前置:角色與兩張表都要在, 否則下面 GRANT 會建立一個「看起來成功」的空動作
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'pcm_readonly') THEN
    RAISE EXCEPTION '角色 pcm_readonly 不存在 ⇒ 拒繼續(名字打錯的話 GRANT 會直接報錯, 而我要它在這裡就停)';
  END IF;
  IF to_regclass('public.search_queries') IS NULL THEN
    RAISE EXCEPTION '表 public.search_queries 不存在 ⇒ 拒繼續';
  END IF;
  IF to_regclass('public.order_pending_refunds') IS NULL THEN
    RAISE EXCEPTION '表 public.order_pending_refunds 不存在 ⇒ 拒繼續';
  END IF;
END $$;

GRANT SELECT ON public.search_queries        TO pcm_readonly;
GRANT SELECT ON public.order_pending_refunds TO pcm_readonly;

-- 事後斷言:GRANT 是「我寫的動作」, 這一段是「量到的結果」
DO $$
DECLARE v_a boolean; v_b boolean;
BEGIN
  v_a := has_table_privilege('pcm_readonly', 'public.search_queries', 'SELECT');
  v_b := has_table_privilege('pcm_readonly', 'public.order_pending_refunds', 'SELECT');
  IF NOT (v_a AND v_b) THEN
    RAISE EXCEPTION '事後斷言失敗:search_queries=% · order_pending_refunds=% ⇒ 有一張沒生效, 拒 COMMIT', v_a, v_b;
  END IF;
  -- 🔵 負對照:同一把尺對一張【本片沒有授權】的表要印 f ——
  --    否則「兩個 t」的成因可能是這把尺對什麼都印 t。
  IF has_table_privilege('pcm_readonly', 'public.payment_webhook_events', 'SELECT') THEN
    RAISE NOTICE '⚠️ 負對照沒過:pcm_readonly 對 payment_webhook_events 也有 SELECT ⇒ 上面那兩個 t 的判別力要打折(它可能本來就都看得到)';
  ELSE
    RAISE NOTICE '🔵 負對照通過:同一把尺對未授權的表印 f ⇒ 上面那兩個 t 是這一片給的';
  END IF;
  RAISE NOTICE '✅ 兩張表的 SELECT 都到位';
END $$;

COMMIT;
