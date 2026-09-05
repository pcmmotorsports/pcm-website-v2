-- ═══════════════════════════════════════════════════════════════════════════
-- Rollback:20260905420000_m4b_pcm_incident_kind_add_refund_over_total
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴🔴 **這一支【我今晚漏寫過兩次】** —— 20260905350000 與本支的檔頭都先寫了
--    「↩️ Rollback:<路徑>」而那支檔不存在(codex 2026-09-05 兩次都抓到)。
--    📌 **一句指向不存在檔案的路徑, 比沒有那句糟** —— 它讓要回滾的人停止尋找。
--
-- 🛑 **不可整段跑。** 還原 = 把 `refund_over_total` 從封閉集拿掉,
--    而**表上若已經有那個 kind 的列, `ADD CONSTRAINT` 會直接失敗**(它重驗全表)。
--    ⇒ 那不是壞事:它在告訴你「有真的事故用了這個值」⇒ 先決定那些列怎麼辦。
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  RAISE EXCEPTION '20260905420000 的 rollback 不可自動執行。還原前先問:表上有沒有 kind=refund_over_total 的列? 有的話這一支會失敗(ADD CONSTRAINT 重驗全表), 而那些列代表真的超退事故。讀完 §R 再手動把這一段註解掉。';
END $$;

-- ── §R 還原(註解)──────────────────────────────────────────────────────
-- BEGIN;
-- ALTER TABLE public.pcm_incident DROP CONSTRAINT IF EXISTS pcm_incident_kind_check;
-- ALTER TABLE public.pcm_incident ADD CONSTRAINT pcm_incident_kind_check
--   CHECK (kind IN ('pending_refund_open_failed'));
-- COMMIT;
--
-- ⚠️ 還原之後 `pg_get_constraintdef` 會印 `CHECK ((kind = 'pending_refund_open_failed'::text))`
--    —— PG 把 `IN (單一值)` 折成 `=`。**那是同一件事**, 不要以為還原失敗了。
-- 🛑 而線【帳務】片③ 若已經上線, 還原之後它寫超退會丟 `check_violation`
--    ⇒ 而那個例外**被內層 handler 吞掉** ⇒ 📌 **超退會安靜地不留痕。**

-- ── §V 量現況(唯讀, 零副作用)────────────────────────────────────────────
SELECT
  COALESCE((SELECT pg_catalog.pg_get_constraintdef(con.oid)
              FROM pg_catalog.pg_constraint con
             WHERE con.conrelid = to_regclass('public.pcm_incident')
               AND con.conname = 'pcm_incident_kind_check'),
           '(沒有那個約束 —— 封閉集不在了)')                    AS 現行封閉集,
  to_regclass('public.pcm_incident') IS NOT NULL                 AS 表在;
-- ⚠️ **列數與各 kind 的筆數這裡問不到** —— 那張表對每一個角色都隱形(20260905290000 的設計),
--    只有 definer 函式進得去。要看數字 ⇒ `SELECT public.get_pcm_incident_health();`(需 service_role)。
