-- ============================================================
-- M-4b · 請款狀態重讀(backlog #785 / plan `~/pcm-mailbox/W4-014-plan-請款狀態重讀-等批-20260820.md`)
--
-- Sean 2026-08-20 逐字「要」;主視窗同日批准 plan。
--
-- ── 為什麼需要它 ────────────────────────────────────────────────────────────
-- `capture_state`(`20260820040000`)只在**授權當下**被寫一次,而銀行是 21 小時後才請款
-- ⇒ 沒有任何路徑會再寫它。成因:`settle-charge.ts:70` 的 paid 短路在 Record 查詢**之前** return,
--    而 `settleCharge` 的生產 caller 恰 4 條、全部走同一支函式。
-- ⇒ **本片新造一條路,不動那個短路**(短路存在的理由是 TapPay rate limit,`settle-charge.ts:66` 逐字)。
--
-- ── 🔴 本檔【只做掃描 RPC】—— 三件刻意不在這裡 ────────────────────────────
--   · ✅ 本檔:掃描用的 SECDEF RPC + 兩道 REVOKE + 結構斷言
--   · ❌ **不建寫入路徑**:用既有的 `record_charge_capture_state`(`20260820040000`),
--        那支已有值域守衛、單調性(captured 不被 authorized 蓋回)、雙鍵驗。
--   · ❌ 🔴 **不排 cron** —— 排程是**另一支 migration、在 route 上線【之後】才排**。
--        理由不是風格,是同族先例的教訓(`20260810200000:36-46` 逐字):
--        「原本寫『同批 apply』⇒ **不成立**:repo 的 apply 路徑逐 statement/逐檔自動提交」
--        ⇒ 先排 cron 而 route 還沒部署 ⇒ 每 10 分鐘打一發 404。**那個窗口要用結構關掉,不是靠順序。**
--
-- ── 🔴 它為什麼必須是 SECURITY DEFINER ─────────────────────────────────────
--   `payment_charge_attempts` 的表層終態是 anon/authenticated 全零、service_role 唯 SELECT
--   (`20260612150000:118-121`),而 **payment_confirmer 對這張表有【零】直接權限**
--   (`20260820040000` 的 role-hygiene 斷言就在守這件事)⇒ 它只能透過 SECDEF RPC 讀。
--
-- ── 🔴 與既有兩支 cron 的鎖面(主視窗指定要確認的那一格;查了,兩個方向都成立)─────
--   ① **集合互斥(by construction)**:`claim_stuck_unsettled_attempts` 濾
--      `o.payment_status = 'unpaid'`(`20260615120001:98/:130`);而本片的列必然
--      `capture_state = 'authorized'` —— 那個值**只在 settlePaid 內寫得出來** ⇒ 訂單必然已 paid。
--   ② **即使相交也不會阻塞**:它用 `FOR UPDATE OF a SKIP LOCKED`(`20260615120001:137` 逐字)
--      ⇒ 撞到本片鎖住的列會**跳過**,不是等。
--   ③ email-sweep 完全不碰這張表(`grep -c 'payment_charge_attempts'` 於 route 與 outbox adapter ⇒ 各 0)。
--   ⚠️ 本檔的掃描 RPC **刻意不取任何鎖**(純 SELECT、無 FOR UPDATE)—— 鎖只發生在寫入那一刻,
--      而那是既有 RPC 的單列 `FOR UPDATE`,持有時間是一個 UPDATE。
--
-- ⛔ apply 停點:本檔 commit 後**不 apply**。apply 要 Sean 在場。
-- ⚠️ 而 apply 之後**行為仍然不會改變** —— route 的 `CAPTURE_RECHECK_CUTOFF_DAYS` 未設就整段不跑。
--    **真正的「上膛」動作是設那個 env,不是 apply 也不是排程**(形狀照 email-sweep,
--    `apps/storefront/src/app/api/cron/email-sweep/route.ts:18-20` 逐字)。
-- ============================================================

BEGIN;

-- ══ 1. 掃描 RPC ═════════════════════════════════════════════════════════════
-- 🔴 述詞 = `capture_state = 'authorized'` —— **天然的待辦集合**:
--    「我們知道它授權了,而還不知道請款了沒」。成功一列就翻成 'captured' ⇒ **集合會自己排空**。
-- 🔴 `ORDER BY capture_state_read_at ASC` = 最久沒問的先問。
--
-- ⚠️⚠️ **而下面這句原本寫錯了,實測為假,更正保留**(W5 對抗審查 R1 MF-1;W4 2026-08-20 拋棄式 PG 實跑):
--   ~~「一列被問過(不論成功失敗)只要有寫入就會更新 read_at ⇒ 排到隊尾 ⇒ **失敗的不會霸佔每一輪**」~~
--   🔴 **兩條失敗路徑都是零寫入的 `continue`**(`recheck-capture-state.ts` 的「不是恰一筆」與「throw」)
--      ⇒ read_at **不會被更新** ⇒ 那一列保持它原本(最舊)的 read_at ⇒ **每一輪都排在隊首**。
--   實測:三列同時 authorized,只有 REC-FAIL 一直不被寫 ⇒ 第一/二/三輪的隊首**都是它**。
--   ⇒ **這是一個已知的飢餓面**:若永久失敗的列數 ≥ `p_limit`,真正會成功的列會排不進來。
--   ⇒ 邊界:它**自己會結束** —— 超過 `p_cutoff_days` 就退出集合(所以是「≤cutoff 天的飢餓」,不是永久)。
--   ⇒ 觀測:use-case 的回傳分「本輪新失敗」與「重複失敗」,讓飢餓**看得見**而不是只看到一個固定數字。
--
-- 🔴 **而 `NULLS FIRST` 在這個述詞下是死碼**(同一輪實測):
--   pair CHECK 保證 `capture_state <> 'unknown' ⇒ read_at IS NOT NULL`,
--   而述詞要求 `capture_state = 'authorized'` ⇒ **集合裡不可能有 read_at 為 NULL 的列**(實測 0 筆)。
--   保留它只是防禦性,不要把它讀成「有處理 NULL 的情況」。
-- 🔴 `p_cutoff_days` 超過就退出集合 ⇒ **沒有一列會被無限重試**。
--    ⚠️ 而那留下一種狀態:**超過 cutoff 而仍是 authorized = 「我們停止問了」**。
--       那不是缺陷,是事實;顯示層要講清楚(backlog #781)。
CREATE OR REPLACE FUNCTION public.list_charge_attempts_for_capture_recheck(
  p_cutoff_days integer,
  p_limit       integer
) RETURNS TABLE (attempt_id uuid, order_id uuid, rec_trade_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- fail-closed:參數不合法一律回空集合,**不回「全部」**(照 20260615120001 的 age-gate 精神〔D〕)。
  IF p_cutoff_days IS NULL OR p_cutoff_days <= 0 OR p_limit IS NULL OR p_limit <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id, a.order_id, a.rec_trade_id
    FROM public.payment_charge_attempts a
   WHERE a.capture_state = 'authorized'
     AND a.rec_trade_id IS NOT NULL          -- 沒有 rec 就問不到 Record,撈出來也是白跑
     AND a.created_at >= pg_catalog.now() - pg_catalog.make_interval(days => p_cutoff_days)
   ORDER BY a.capture_state_read_at ASC NULLS FIRST, a.id
   LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.list_charge_attempts_for_capture_recheck(integer, integer) IS
  'M-4b 請款狀態重讀的掃描端(SECURITY DEFINER、search_path='''')。'
  '🔴 **唯讀、零鎖**:純 SELECT、無 FOR UPDATE ⇒ 不與 claim_stuck_unsettled_attempts 爭鎖'
  '(而那支用 FOR UPDATE OF a SKIP LOCKED,即使相交也是跳過不是等)。'
  '🔴 述詞 capture_state=''authorized'' 是天然待辦集合:成功一列翻成 captured ⇒ 集合自己排空。'
  '🔴 ORDER BY capture_state_read_at ASC = 最久沒問的先問。'
  '⚠️ **已知飢餓面**(W4 2026-08-20 實測):失敗路徑是零寫入的 continue ⇒ read_at 不更新'
  '⇒ 永久失敗的列**每一輪都排在隊首**;若這種列 >= p_limit，會成功的列排不進來。'
  '邊界:超過 p_cutoff_days 自動退出集合 ⇒ 是「<=cutoff 天的飢餓」，不是永久。'
  '⇒ 觀測在 use-case 的回傳(本輪新失敗 vs 重複失敗)。~~原註解「失敗的不會霸佔每一輪」為假~~。'
  '📌 NULLS FIRST 在本述詞下是**死碼**:pair CHECK 保證 authorized ⇒ read_at 非 NULL(實測集合內 0 筆)。'
  '⚠️ 殘留狀態:超過 cutoff 而仍 authorized = 「我們停止問了」,不是缺陷(顯示層 backlog #781)。'
  '參數不合法(NULL / <=0)⇒ **回空集合,不回全部**(fail-closed)。只 payment_confirmer 可呼。';

-- ══ 2. 兩道 REVOKE(新 SECDEF 物件出生自帶 PUBLIC EXECUTE)═══════════════════
-- `docs/patterns/revoking-function-execute-in-supabase.md:24-25`;清單照 `20260619120000:233-236`。
-- ⚠️ 誠實邊界(照抄 `20260810210000:431-432` 自標的那格,不擴張):REVOKE 的是**列舉的 role 名**
--    ⇒ 有人手動 GRANT 給自訂 role 會原封活過本檔。**本檔不宣稱「已封死」。**
REVOKE ALL ON FUNCTION public.list_charge_attempts_for_capture_recheck(integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_charge_attempts_for_capture_recheck(integer, integer)
  TO payment_confirmer;

-- ══ 3. 結構斷言 ═════════════════════════════════════════════════════════════
DO $$
BEGIN
  -- ① SECDEF + search_path 釘住
  -- 🔴 期望字面是實跑量出來的:空 search_path 在 proconfig 裡渲染成 `search_path=""`(帶兩個雙引號)。
  --    (同坑 repo 已記過三次:20260612150000:49-50 / 20260810200000:477-478 / 20260820040000。)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
     WHERE oid = 'public.list_charge_attempts_for_capture_recheck(integer,integer)'::regprocedure
       AND prosecdef
       AND pg_catalog.array_to_string(proconfig, ', ') = 'search_path=""'
  ) THEN
    RAISE EXCEPTION '掃描 RPC 不是 SECURITY DEFINER 或 search_path 非 ""(實測字面);拒繼續';
  END IF;

  -- ② 🔴 全稱 ACL:任何非 owner、非 payment_confirmer 的 grantee 一律紅
  --    (比 `proacl IS NOT NULL` 強:那格擋得住「REVOKE 沒跑」,擋不住「事後 GRANT 給 anon」)
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     WHERE p.oid = 'public.list_charge_attempts_for_capture_recheck(integer,integer)'::regprocedure
       AND a.grantee <> p.proowner
       AND a.grantee <> 'payment_confirmer'::regrole
  ) THEN
    RAISE EXCEPTION '掃描 RPC 的 proacl 出現非 payment_confirmer 的 grantee;拒繼續';
  END IF;

  -- ③ proacl 非 NULL(NULL ⇒ REVOKE/GRANT 都沒生效 ⇒ PG 預設 EXECUTE TO PUBLIC)
  IF (SELECT proacl FROM pg_catalog.pg_proc
       WHERE oid = 'public.list_charge_attempts_for_capture_recheck(integer,integer)'::regprocedure) IS NULL THEN
    RAISE EXCEPTION '掃描 RPC 的 proacl 是 NULL(REVOKE/GRANT 沒生效)⇒ 對 PUBLIC 開著;拒繼續';
  END IF;

  -- ④ 🔴 零鎖宣稱要有證人:函式必須是 STABLE(STABLE 不得含 FOR UPDATE / 寫入)
  --    這一格擋的是「未來有人把 FOR UPDATE 加進來」—— 加了就不能是 STABLE,PG 自己會擋。
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc
     WHERE oid = 'public.list_charge_attempts_for_capture_recheck(integer,integer)'::regprocedure
       AND provolatile = 's'
  ) THEN
    RAISE EXCEPTION '掃描 RPC 不是 STABLE ⇒ 「唯讀零鎖」那句話沒有證人;拒繼續';
  END IF;
END
$$;

COMMIT;

-- ── Rollback(Supabase forward-only;逆序手動,僅供參考)──────────────────────
--   DROP FUNCTION IF EXISTS public.list_charge_attempts_for_capture_recheck(integer, integer);
