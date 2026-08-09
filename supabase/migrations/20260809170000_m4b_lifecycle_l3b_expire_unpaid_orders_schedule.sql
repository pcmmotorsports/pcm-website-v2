-- ============================================================
-- M-4b 生命週期 L3b(件①):expire_unpaid_orders 的每小時 pg_cron 排程
-- ============================================================
-- 真權威:docs/specs/2026-08-09-order-payment-lifecycle-plan.md 件① / §3 表 L3(Q5=A 獨立每小時 job)。
-- 函式本體在 L3a `20260809160000_m4b_lifecycle_l3a_expire_unpaid_orders_fn.sql`(本片只排程、不定義行為)。
--
-- 鐵則 12④(平台設定:pg_cron 排程)。
--
-- 🔴 **本片依賴 pg_cron 擴充** ⇒ 隔離 DB 排練環境跳過它(`scripts/d1t2-rehearsal.sh` 的 skip 清單,
--   既有先例 `20260723120000`)。⚠️ 誠實邊界:**排程這半沒有本機行為證據**,只有
--   ①本檔的 fail-closed 斷言(apply 當下真的跑)②正式環境 apply 後的 `cron.job` / `cron.job_run_details`。
--   函式本體的行為證據在 `scripts/l3-verify.sh`(對真 PostgreSQL 實跑)。
--
-- 為什麼是每小時而不是每 2 分鐘:判準是「建立超過 1 天」,粒度以小時計綽綽有餘;
-- 也刻意**不**掛進既有的 settle-sweep route —— 那支的 60s 預算已被算到 ~50s
-- (`apps/storefront/src/app/api/cron/settle-sweep/route.ts:52-56`),再塞掃全表的工作會擠爆它(Q5=A)。
-- 本 job 是純 SQL、不經 HTTP ⇒ 不需要 pcm_cron.invoke_cron_route 那層 wrapper、也不依賴 Vault secret。
--
-- Rollback(Supabase forward-only、僅供參考):SELECT cron.unschedule('pcm-expire-unpaid-orders');
-- ============================================================


BEGIN;

-- ── 0. 前置閘 ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'L3b:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'L3b:pg_cron 未啟用 — 請先於 Supabase Dashboard→Database→Extensions 啟用;拒繼續';
  END IF;
  -- 函式必須先在(L3a 未套用 = 排程指向不存在的函式 = 靜默死排程)
  -- 🔴 不只驗「存在」(codex 關卡2):同簽名的函式可能被換成漂移的 body、或改掉 owner/SECDEF/ACL,
  --    而排程照樣每小時執行它。故把 L3a 的三項安全前提在這裡重驗一次(排程 = 授予它定期執行的權力)。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'L3b:expire_unpaid_orders 不存在或 owner/SECDEF/search_path 不符(L3a 未套用或已漂移);拒繼續';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner
  ) THEN
    RAISE EXCEPTION 'L3b:expire_unpaid_orders 有 owner 以外的 grantee —— 拒絕替它排程;拒繼續';
  END IF;
  -- 🔴 **body 也要看**(codex 確認輪):上面三項只驗 metadata —— 保留同樣 owner/SECDEF/search_path
  --    但把函式體換掉(例如拿掉 `status <> 'failed'` 那條安全核心)的版本,照樣會被排成每小時執行。
  --    ⚠️ 誠實邊界:這裡用**錨點比對**不是 functiondef 的 md5 —— md5 會隨 PG 版本的格式化差異假紅。
  --    少一個錨擋得住,錨以外的改動看不見;要更強就得把 canonical body 存進表裡比對(本片不做)。
  IF NOT EXISTS (
    SELECT 1 FROM (
      SELECT pg_get_functiondef('pcm_cron.expire_unpaid_orders(integer)'::regprocedure) AS d
    ) s
     WHERE position('payment_expired' in s.d) > 0
       AND position('status <> ''failed''' in s.d) > 0
       AND position('interval ''1 day''' in s.d) > 0
       AND position('SKIP LOCKED' in s.d) > 0
  ) THEN
    RAISE EXCEPTION 'L3b:expire_unpaid_orders 的函式體缺少本片的安全錨(已被替換?)—— 拒絕排程;拒繼續';
  END IF;
END $$;


-- ── 1. 排程(每小時整點;by-name upsert 冪等 + 顯式 active)──────────────────
-- (理由見檔頭「為什麼是每小時」;此處不重複。)
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-expire-unpaid-orders', '0 * * * *',
    $job$SELECT pcm_cron.expire_unpaid_orders(500)$job$);
  PERFORM cron.alter_job(job_id => v_id, active => true);  -- by-name upsert 不改 active,顯式設 true
END $$;



-- ── 2. fail-closed 斷言 ─
-- ⚠️ 誠實邊界(codex 關卡2 nit):下面只證「cron.job 這一列的設定是對的」。
--    scheduler 沒在跑、`cron.launch_active_jobs=off`、首次執行就失敗、或 run logging 被關掉 ——
--    這四種情況本斷言**全部照樣通過**。真正的「它有在跑」只能靠上線後查 cron.job_run_details
--    (查法見 L3a 檔頭的觀測點②)。───────────────────────────────────────────────────
DO $$
DECLARE v_cnt integer;
BEGIN
  -- 2a. job:恰一筆、active、排程字面、command 字面、跑在本 DB。
  -- 🔴 先數「同名的**全部**」(codex 關卡2):把 username 併進 WHERE 的話,
  --    另一個角色底下同名的第二筆 job 會被濾掉、斷言仍是 1 = 看不見的重複排程。
  SELECT count(*) INTO v_cnt FROM cron.job WHERE jobname = 'pcm-expire-unpaid-orders';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'L3b:同名 job 不是恰一筆(實 %,可能有跨角色重複);拒繼續', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM cron.job
   WHERE jobname = 'pcm-expire-unpaid-orders'
     AND active
     AND database = current_database()
     AND schedule = '0 * * * *'
     AND command  = 'SELECT pcm_cron.expire_unpaid_orders(500)'
     -- 🔴 username 必須釘住(code-reviewer N9):函式的 EXECUTE 只給 postgres
     --    (`proacl={postgres=X/postgres}`)⇒ 若日後由別的角色排程,會每小時 permission denied,
     --    而少了這條的斷言**照樣全綠** = 靜默死排程。
     AND username = 'postgres';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'L3b:pcm-expire-unpaid-orders job 不是恰一筆 active 且字面相符(實 %);拒繼續', v_cnt;
  END IF;
END $$;

COMMIT;
