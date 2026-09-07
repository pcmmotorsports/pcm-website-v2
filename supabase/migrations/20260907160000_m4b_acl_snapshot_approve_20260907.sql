-- 🔴🔴 **這一支【不是 schema migration】, 它是一筆【資料批准】。**
--    它被放進 `supabase/migrations/` 的唯一理由:`scripts/apply-paste-board.sh` 的前置④/⑤
--    逐字要求 `repo 裡 <版本號>_*.sql 命中剛好 1 支` 且**內容 sha 與貼板檔相同**
--    (`scripts/apply-paste-board.sh:244` 與 `:249`)⇒ **那支工具只有這一個入口。**
--    ⚠️ **代價寫明, 不藏**:若有人拿 `supabase/migrations/` 從零重放到一個新資料庫,
--    這一支會在前置閘 P1 炸掉(新庫裡一列快照都沒有)—— **那是刻意的**:
--    一筆「2026-09-07 的批准」重放到別的庫上, 蓋的會是一張完全不同的快照。
--    ⇒ 📌 **從零重放時必須跳過本支。** 這句話寫在這裡, 因為重放的人只會讀到檔案本身。
--
-- ═══ 貼板 85:ACL 快照蓋章(pcm_acl_approve_latest)═══
-- 出板:線【資料】-db, 2026-09-07(date 原輸出 Mon Sep  7 13:36:48 CST 2026 之後)
-- 主視窗 A 裁:③ 走乙 —— codex 判無害 ⇒ 蓋章, reason 逐字寫 codex 落點。
--
-- 🔴 這支【不盲蓋】:它先印出要蓋哪一張快照、那張批了沒, 蓋完再印一次。
--    理由:pcm_acl_approve_latest 蓋的是 max(taken_at) 那一列, 而出板的人(-db 的唯讀角色)
--    讀不到 pcm_acl_snapshot_digest 與 pcm_acl_drift_status(兩個都 permission denied)
--    ⇒ 我無法在出板時確認會蓋到哪一張。⇒ 把確認搬進板子裡, 由貼的人當場看見。
--
-- 🛑 前置閘:若 max(taken_at) 那一列【已經批過】⇒ 整筆 RAISE 回滾, 不重複蓋章。
--    (重複蓋章會把一個舊的批准理由蓋到一張新快照上, 而那在事後與正確的批准長得一樣。)

BEGIN;

\echo '── 蓋章前:最近 3 張快照 ──'
SELECT taken_at, row_count, approved_at,
       left(coalesce(approved_note, '(未批)'), 80) AS note
FROM public.pcm_acl_snapshot_digest
ORDER BY taken_at DESC LIMIT 3;

DO $gate$
DECLARE v_t timestamptz; v_a timestamptz;
BEGIN
  SELECT taken_at, approved_at INTO v_t, v_a
  FROM public.pcm_acl_snapshot_digest
  ORDER BY taken_at DESC LIMIT 1;
  IF v_t IS NULL THEN
    RAISE EXCEPTION '貼板85 前置閘:一列快照都沒有 ⇒ 先讓 cron 跑一次或手動 pcm_acl_digest_record()';
  END IF;
  IF v_a IS NOT NULL THEN
    RAISE EXCEPTION '貼板85 前置閘:最新那張(taken_at=%)【已經批過】(approved_at=%) ⇒ 停下, 不重複蓋章', v_t, v_a;
  END IF;
  RAISE NOTICE '貼板85 前置閘過:要蓋的是 taken_at=%, 目前未批', v_t;
END
$gate$;

SELECT public.pcm_acl_approve_latest(
  '2026-09-07 -db 對帳後批准。快照與基線差 244 行, 拆開是:新物件 216 行(昨夜到今天貼的 RPC/表/view 出生自帶) + 簽章換掉 6 行 + 真正的權限變動 11 行。'
  || '11 格逐格對得上版控 migration:(a) products_list_public 與 vehicle_taxonomy_public 的 anon+authenticated 由 SIUDTRG 收成 S------ ← 20260905260000_m4b_public_views_revoke_write_from_anon.sql:204-207;'
  || '(b) DEFACL 兩格(sequences 掉 anon/authenticated 的 w、tables 掉 service_role 的 Dxtm)← 20260905430000 與 20260905350000;'
  || '(c) 唯一一格放寬 = get_search_log_health() 對 payment_confirmer 加 EXECUTE ← 20260906970000_m4b_anomaly_reader_grants_payment_confirmer.sql:78;'
  || '(d) pcm_order_refund_status_transition() 四個角色由 DEFINER 變 INVOKER ← 20260907030000_m4b_tappaydirect_a2_void_backfill.sql:115-118 該檔沒有寫 SECURITY DEFINER 那一行, 且檔內說明只交代 search_path 收緊、未提 DEFINER。'
  || ' 含一格 DEFINER→INVOKER, codex 判無害。codex 逐字結論:VERDICT: 無害(限已核對的 A2 trigger 本體, 單論 DEFINER → INVOKER);理由逐字:函式本體只比較 OLD/NEW、檢查 NULL、回傳或拋錯, 沒有查表、呼叫其他函式或檢查角色。'
  || ' 補量(唯讀):五支寫入 RPC admin_finalize_order_refund / admin_record_manual_refund / admin_void_backfilled_refund / admin_correct_backfilled_refund / admin_backfill_tappay_console_refund 全部 owner=postgres 且 secdef=t;trigger 函式 owner 亦為 postgres, order_refunds owner=postgres。'
  || ' 所以列舉到的每一條路, DEFINER 與 INVOKER 的有效身分都是 postgres, 沒有一條會變。'
  || ' 射程(不放寬):codex 的無害只涵蓋已核對的本體與單論這一個屬性, 不是對整支 migration 的背書;本批准也不涵蓋任何未被本次快照量到的面。'
  || ' 本批准對應的快照 taken_at = '
  || (SELECT max(taken_at)::text FROM public.pcm_acl_snapshot_digest)
) AS 蓋到哪一張;

\echo '── 蓋章後:同一張應該有 approved_at 與理由 ──'
SELECT taken_at, approved_at, left(approved_note, 120) AS note_前120字
FROM public.pcm_acl_snapshot_digest
ORDER BY taken_at DESC LIMIT 1;

COMMIT;
