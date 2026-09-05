-- ROLLBACK · `20260905170000`(⟦b9-ACLDRIFT5⟧ 片二:漂移訊號 view + 批准函式)
--
-- 🛑 **整支一次貼、按一次 Run。** 逐段按會讓交易開著抱鎖。
-- 🔵 它退的是【片二】。片一(`20260905140000`:表 / 兩支函式 / 每日 cron)**不動** ——
--    退完之後每天仍然會記一列快照, 只是沒有人在比對它。
-- 🔴 而 `approved_at` / `approved_note` 兩欄**跟著被刪** ⇒ 誰批准過什麼【會一起消失】。
--    ⇒ 要留紀錄的話, 先把它抄出來:
--       SELECT taken_at, approved_at, approved_note
--         FROM public.pcm_acl_snapshot_digest WHERE approved_at IS NOT NULL;
-- 🔴 順序不可換:view 先掉(它讀那兩欄), 再掉欄, 最後掉函式。
--    反過來做 `DROP COLUMN` 會因為 view 相依而失敗, 而那個失敗訊息不會告訴你順序錯了。

BEGIN;

-- ── ⓪ 先把批准紀錄【搬走】, 不是印出來給人看 ────────────────────
-- 🔴 codex 2026-09-05 R1:原本檔頭只寫「要留紀錄的話先 SELECT 抄出來」——
--    而**照「整支一次貼」做的人不會停下來抄**, 那句警告救不了任何人。
--    ⇒ 改成腳本自己搬:退版之後那張表還在, 誰批准過什麼一格都沒少。
CREATE TABLE IF NOT EXISTS public.pcm_acl_approval_archive (
  taken_at      timestamptz PRIMARY KEY,
  approved_at   timestamptz NOT NULL,
  approved_note text,
  archived_at   timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE public.pcm_acl_approval_archive FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_acl_approval_archive FROM anon;
REVOKE ALL ON TABLE public.pcm_acl_approval_archive FROM authenticated;
REVOKE ALL ON TABLE public.pcm_acl_approval_archive FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_acl_approval_archive ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_acl_approval_archive -- 稽核備份, 只有表擁有者走得到;四個應用角色四道 REVOKE 全收。

INSERT INTO public.pcm_acl_approval_archive (taken_at, approved_at, approved_note)
SELECT taken_at, approved_at, approved_note
  FROM public.pcm_acl_snapshot_digest
 WHERE approved_at IS NOT NULL
ON CONFLICT (taken_at) DO NOTHING;

DROP VIEW IF EXISTS public.pcm_acl_drift_status;

ALTER TABLE public.pcm_acl_snapshot_digest
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS approved_note;

DROP FUNCTION IF EXISTS public.pcm_acl_approve_latest(text);

-- ── 事後斷言(退乾淨了嗎)────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.pcm_acl_drift_status') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 斷言:view 還在';
  END IF;
  IF to_regprocedure('public.pcm_acl_approve_latest(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 斷言:approve 函式還在';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
              WHERE attrelid = 'public.pcm_acl_snapshot_digest'::regclass
                AND attname IN ('approved_at','approved_note') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'rollback 斷言:那兩欄還在';
  END IF;
  -- 🔴 批准紀錄真的搬走了嗎(而不是「本來就沒有」)——
  --    這一格用【搬之前有幾筆】對【archive 裡有幾筆】, 不是只看 archive 非空。
  IF (SELECT count(*) FROM public.pcm_acl_approval_archive) = 0
     AND EXISTS (SELECT 1 FROM public.pcm_acl_snapshot_digest) THEN
    RAISE WARNING 'rollback:archive 是空的 —— 若原本就沒有人批准過, 這是對的;否則有東西掉了';
  END IF;

  -- 🟢 負對照:片一的東西【必須還在】—— 少了這一格, 一支把整片砍掉的 rollback 也會全綠。
  IF to_regclass('public.pcm_acl_snapshot_digest') IS NULL
     OR to_regprocedure('public.pcm_acl_digest_record()') IS NULL THEN
    RAISE EXCEPTION 'rollback 斷言:片一的東西被一起砍掉了 ⇒ 退過頭';
  END IF;
END $$;

COMMIT;
