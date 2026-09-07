-- ═══ 貼板 89:ACL 快照蓋章(核過 244 行之後)═══
-- 出板:線【資料】-db, 2026-09-07。主視窗 A 拍甲, 並加條件:
--   🔴 「未證零手改」那句要寫進【蓋章文本身】, 不是附註 ——
--      蓋章文會被複製走, 附註不會;而下一個讀到「已蓋章」的人, 會把它讀成「查過了沒問題」。
--      ⇒ 那句限定必須跟著章一起旅行。
--
-- 🔴 這支【不是 schema migration】, 是一筆【資料批准】(同 85)。
--    它被放進 supabase/migrations/ 的唯一理由:scripts/apply-paste-board.sh:244 / :249
--    要求同版本號、同內容 sha 的 migration 檔 ⇒ 那支工具只有這一個入口。
--    ⚠️ 從零重放到新庫時必須跳過本支(新庫沒有快照列 ⇒ 前置閘會炸, 那是刻意的)。
--
-- 🔴 這支【不盲蓋】:先印要蓋哪一張、那張批了沒, 蓋完再印一次(同 85)。

BEGIN;

SELECT '── 蓋章前:最近 3 張快照 ──' AS 標籤;
SELECT taken_at, row_count, approved_at, left(coalesce(approved_note,'(未批)'), 80) AS note
FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 3;

DO $gate$
DECLARE v_t timestamptz; v_a timestamptz;
BEGIN
  SELECT taken_at, approved_at INTO v_t, v_a
  FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 1;
  IF v_t IS NULL THEN
    RAISE EXCEPTION '貼板89 前置閘:一列快照都沒有 ⇒ 先讓 cron 跑一次或手動 pcm_acl_digest_record()';
  END IF;
  IF v_a IS NOT NULL THEN
    RAISE EXCEPTION '貼板89 前置閘:最新那張(taken_at=%)【已經批過】(approved_at=%)⇒ 停下, 不重複蓋章', v_t, v_a;
  END IF;
  RAISE NOTICE '貼板89 前置閘過:要蓋的是 taken_at=%, 目前未批', v_t;
END
$gate$;

SELECT public.pcm_acl_approve_latest(
  '2026-09-07 -db 逐行核過後批准。'
  || '讀數:acl-snapshot.sh 對基線差 244 行 = 93 個相異物件(同一物件在多個角色上各一行);'
  || '逐族 FN 130 / REL 64 / FNCFG 32 / VIEWOPT 10 / DEFACL 4 / POL 4。'
  || '核法:對每個物件在 supabase/migrations/*.sql 找它的 CREATE 敘述(函式、view/table、policy 各自的形狀;'
  || 'DEFACL 對 ALTER DEFAULT PRIVILEGES)⇒ 93/93 對得上 ⇒ 244/244 行有對應。'
  || '負對照:現造名字 zqx7742tmp 命中 0 支 migration ⇒ 那個「全中」不是尺恆真。'
  || ' '
  || '🛑 這一章【證不到】什麼, 逐字寫在這裡而不是附註:'
  || '(1) 我證的是【每一個被改動的物件在版控裡都有一支 CREATE】, '
  || '不是【那個 ACL 的值是那支 migration 給的】。'
  || '(2) 原文照抄:一個在 dashboard 被手改過的物件, 只要它本來就有 migration, 在我這把尺下照樣對得上。'
  || '⇒ 所以【零手改】這件事本章答不出來, 而它需要另一把尺:逐格比對 migration 裡的 GRANT/REVOKE 字面與線上實際 ACL。'
  || '那把尺今天不存在, 已另開板列擋著。'
  || '(3) 本章只涵蓋這一批差異;它不對【沒有出現在差異裡的格】說任何話。'
  || ' '
  || '過程訂正:我第一把尺把 POL 的鍵切錯(policy 名在 | 後面, 我抓了前面)⇒ 產出一個假的「對不上 1 個」;'
  || '修好之後是 0。那個假的 1 沒有被端出去。'
  || ' 本批准對應的快照 taken_at = '
  || (SELECT max(taken_at)::text FROM public.pcm_acl_snapshot_digest)
) AS 蓋到哪一張;

SELECT '── 蓋章後:同一張應該有 approved_at 與理由 ──' AS 標籤;
SELECT taken_at, approved_at, left(approved_note, 160) AS note_前160字
FROM public.pcm_acl_snapshot_digest ORDER BY taken_at DESC LIMIT 1;

COMMIT;
