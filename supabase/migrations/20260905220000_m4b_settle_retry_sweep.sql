-- ⟦b4-SETTLERETRYNEVER⟧ 甲:重算失敗的匯款單, 給它第二次(pg_cron 掃描)
-- plan:`~/pcm-mailbox/plan-settle-retry-mail-20260905.md`(線 `-mail` 寫, Sean 2026-09-05 拍「7 甲」)
-- 前置:`20260904230000`(那支重算函式 + 它的 AFTER INSERT 掛點)
--
-- ## 病灶(plan §1 逐字讀來的)
--   `20260904230000` 的重算掛在 `AFTER INSERT ON public.order_payments` ⇒ **一張單只算一次**。
--   那一次整段 `EXCEPTION WHEN OTHERS` 吞掉例外(**刻意** —— 不讓客人那筆收款回滾),
--   而**沒有任何東西會再算它** ⇒ 單停在 `unpaid` ⇒ 訂單頁一直印「請匯款」+ 銀行帳號
--   ⇒ 🔴 **客人會再匯一次。**
--
-- ## 🛑 而「這件事發生過幾次」**我們答不出來**(plan §5b, 我自己量的)
--   `orders` 全表今天只有 1 張單而它不是匯款單 ⇒ 第一層條件就 0。
--   **那個 0 的成因是分母, 不是「沒發生過」。** ⇒ 🔴 **不得把它讀成「零次」。**
--   ⇒ 📌 **本片是在「不知道它會叫幾次」的情況下上線的, 而那是 Sean 拍板接受的代價**
--      (plan §6:受害者是已經匯了錢的客人, 等到有真實資料再做的期間沒有任何東西在看)。
--   ⇒ ✅ 對應的處置寫在下面「上線後第一週」那段, 而不是假裝我們量過了。
--
-- ## 🛑 這一片證不到什麼
--   · 它只撈【`230000` 貼上去之後】那些單:在那之前根本沒有重算, 也就沒有「重算失敗」。
--   · 它把單推進 `admin_compute_order_settlement` 算出來的那一格 —— **重算本身可能再失敗**,
--     那時它會記一次 attempt 而**不會**修好那張單。⇒ 見下面的上限。
--   · 🔴🔴 **它不通知任何人, 而【今天沒有人會接】** —— 這一句我第一版寫錯了(codex R1 抓到):
--     我寫「那一格由 ⟦b4-NEEDSHUMANNOWATCHER⟧ 接」, 而 plan §2 逐字寫著**那支哨兵只收
--     `overpaid` / `needs_human`** ⇒ **它結構上看不到這一族**。
--     而全 repo 今天**只有本 migration 讀 `pcm_settle_retry_attempts`** ⇒ 沒有任何人在看 gave_up。
--     📌 **⇒ 一張試到上限仍然壞的單, 今天會【安靜地留在那裡】。**
--     ✅ 那是一個【已知而未關】的缺口, 要一列在板上, 不是一句安慰。
--     🛑 **我原本那句話最危險的地方**:它讓下一個人以為有人在看 ⇒ 他不會去補。

BEGIN;

-- ── 前置閘⓪ ─────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.pcm_noncard_settle_recompute(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:pcm_noncard_settle_recompute(uuid) 不存在 ⇒ 20260904230000 還沒貼';
  END IF;
  IF to_regprocedure('public.admin_compute_order_settlement(uuid)') IS NULL THEN
    RAISE EXCEPTION '前置閘⓪:admin_compute_order_settlement(uuid) 不存在';
  END IF;
  IF to_regclass('public.pcm_settle_retry_attempts') IS NOT NULL THEN
    RAISE EXCEPTION '前置閘⓪:pcm_settle_retry_attempts 已存在 ⇒ 這支貼過了, 不要重貼';
  END IF;
END $$;

-- ── ① 試過幾次(沒有它, 一張永遠算不好的單會每 10 分鐘炸一次 log)──────
CREATE TABLE public.pcm_settle_retry_attempts (
  order_id        uuid PRIMARY KEY,
  attempts        integer     NOT NULL DEFAULT 0,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  gave_up_at      timestamptz
);

COMMENT ON TABLE public.pcm_settle_retry_attempts IS
  '⟦b4-SETTLERETRYNEVER⟧:每張單重試了幾次。'
  '🔴 `gave_up_at` 非 NULL = 這支暫時放棄它(24 小時後會再給一次機會)。'
  '🛑🛑 **而【今天沒有任何人在看這張表】** —— 全 repo 只有那支 sweep 讀它。'
  '⛔ ~~原本這裡寫「那一格由 ⟦b4-NEEDSHUMANNOWATCHER⟧ 接」~~ —— **那句是錯的**:'
  '那支哨兵只收 overpaid / needs_human ⇒ 它結構上看不到這一族(plan §2)。'
  '📌 板列 ⟦b4-RETRYGAVEUPNOWATCHER⟧ 記著這個缺口。';

REVOKE ALL ON TABLE public.pcm_settle_retry_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.pcm_settle_retry_attempts FROM anon;
REVOKE ALL ON TABLE public.pcm_settle_retry_attempts FROM authenticated;
REVOKE ALL ON TABLE public.pcm_settle_retry_attempts FROM service_role, payment_confirmer;
ALTER TABLE public.pcm_settle_retry_attempts ENABLE ROW LEVEL SECURITY;
-- RLS-GATE-EXEMPT: pcm_settle_retry_attempts -- 只有表擁有者與那支 cron 走得到;四個應用角色四道 REVOKE 全收。
-- static-checks:no-grant-needed 這張表【刻意不給任何人】—— 沒有任何頁面 / API 讀它。

-- ── ② 掃描器 ────────────────────────────────────────────────
CREATE FUNCTION public.pcm_settle_retry_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $sweep$
DECLARE
  -- 🔴 **上限 5 次是【推的, 沒有人拍過】** —— 而它的理由要寫下來:
  --    重算失敗的成因若是暫時的(鎖競爭 / 逾時), 五次 × 10 分鐘 ≈ 50 分鐘內會好;
  --    若是資料本身的問題(例:金額對不起來), 試五萬次也一樣。
  --    ⇒ 五次之後停下來, 讓它變成一個【需要人】的東西, 而不是一個每天炸 144 次 log 的東西。
  --    ⚠️ 而「50 分鐘」這個數字沒有被驗過 —— 它是 5 × 排程週期, 排程週期改了它就變。
  c_max_attempts constant integer := 5;
  r              record;
  v_fixed        integer := 0;
  v_after        public.payment_status;
BEGIN
  FOR r IN
    -- 🔴 **`admin_compute_order_settlement` 一定要在【便宜條件收窄之後】才呼叫**(codex R2):
    --    把它寫在同一層 WHERE 裡, planner 可以先對【所有通過前四條件的候選】逐列呼叫它,
    --    然後才 LIMIT ⇒ backlog 一大就整輪逾時, **一張都進不了迴圈**。
    --    ✅ 改成兩層:內層只用便宜條件 + LIMIT, 外層才算 verdict。
    SELECT c.id
      FROM (
        SELECT o.id
          FROM public.orders o
          LEFT JOIN public.pcm_settle_retry_attempts a ON a.order_id = o.id
         WHERE o.payment_channel = 'bank_transfer'
       AND o.cancelled_at IS NULL
       -- 🔴🔴 **不是只有 `unpaid`**(codex R2 must-fix;而我 R1 時複驗錯了):
       --    我用 `git grep` 掃 **TS 檔**得到「值域只有 unpaid/paid/refunded」⇒ 判 codex 那條不成立。
       --    ✅ 而**對正式庫唯讀量一次** ⇒ `unpaid, paid, partiallyPaid, refunded, partiallyRefunded`(5 個)。
       --    📌 **我那把尺的分母裡沒有 SQL** —— enum 定義在 `20260604120000`, 不在任何 .ts 裡。
       --    🛑 而漏掉 `partiallyPaid` 的後果:第一次短匯 ⇒ 狀態變 partiallyPaid;
       --       客人補尾款時重算失敗 ⇒ **這支永遠撈不到它**, 而客人那一頁照樣印「請匯款」。
       AND o.payment_status IN ('unpaid'::public.payment_status,
                                'partiallyPaid'::public.payment_status)
       -- 收過錢(淨額 > 0)—— 沒收到錢的單「停在 unpaid」是【對的】, 不是缺陷。
       AND (SELECT coalesce(sum(p.amount), 0) FROM public.order_payments p
             WHERE p.order_id = o.id) > 0
       -- 🔴 **放棄不是永久的**(codex R2:我第一版把清除放在成功分支裡, 而那個分支要先被撈到
       --    才會執行 ⇒ **死結**, 實測確認撈不回來)。
       --    ✅ 改成【放棄 24 小時後再給一次機會】:成因若是暫時的(那支函式被修好了、
       --       鎖散了), 它會自己回來;而它仍然壞的話, 一天最多再吵 c_max_attempts 次。
       --    🛑 而這**不取代**那張「沒有人在看放棄清單」的板列 —— 它只是不把門焊死。
       AND (a.order_id IS NULL
            OR (a.gave_up_at IS NULL AND a.attempts < c_max_attempts)
            OR a.gave_up_at < pg_catalog.clock_timestamp() - interval '24 hours')
     ORDER BY o.created_at
     LIMIT 50
     -- 🔵 一輪最多 50 張:一支跑很久的 cron 會與下一輪自己重疊。
     -- 🔴 **而 `LIMIT 50` 不保證只呼叫 50 次 `admin_compute_order_settlement`**(codex R1):
     --    那支函式在 `WHERE` 裡, 而 planner 可能對【所有通過前四個條件的候選】逐列呼叫它,
     --    然後才取前 50 ⇒ backlog 很大時這一輪會很久, 而久到 statement_timeout 就整批回滾。
     --    ✅ 前四個條件把候選壓得很小(匯款 + 未取消 + unpaid + 收過錢), 而**那是今天的形狀**,
     --       不是保證。🛑 **沒有修** —— 要修得先量真實 backlog 有多大, 而那個數字今天量不到
     --       (`orders` 全表 1 張)。⇒ 上線後第一週要看的第二格就是這個。
      ) c
      -- 🔴 verdict 在【外層】:內層已經 LIMIT 過 ⇒ 這支昂貴的 SECURITY DEFINER 函式
      --    最多被呼叫 50 次, 而不是「所有候選都算一遍再取 50」。
      WHERE (public.admin_compute_order_settlement(c.id) ->> 'verdict')
            IN ('settled', 'underpaid')
  LOOP
    BEGIN
      PERFORM public.pcm_noncard_settle_recompute(r.id);

      -- 🔴🔴 **不能拿「沒有拋例外」當成功**(codex 2026-09-05 R1 must-fix, 我第一版就是這樣寫的):
      --    `pcm_noncard_settle_recompute` 自己有一段 `EXCEPTION WHEN OTHERS THEN RAISE LOG …`
      --    (`20260904230000:339-342`)⇒ **它失敗的時候【正常返回】**。
      --    ⇒ 我下面那個 EXCEPTION 幾乎永遠不會被觸發 ⇒ `v_fixed` 會把失敗算成成功、
      --      `last_error` 永遠是 NULL、而五次「成功」之後那張仍然壞掉的單被蓋上 gave_up。
      --    📌 **⇒ 量【結果】不量【有沒有例外】** —— 重算完再讀一次那張單的狀態。
      --    🛑 而這正是本片要修的那個病的形狀:一個被吞掉的例外, 讓下游以為事情做完了。
      SELECT o.payment_status INTO v_after FROM public.orders o WHERE o.id = r.id;
      -- 🔴 **只有【明確變成 paid】才算修好**(codex R2):
      --    第一版寫 `IS DISTINCT FROM 'unpaid'` ⇒ ① 單被刪掉 ⇒ `v_after` 是 NULL ⇒ **也算成功**
      --    ② 另一個交易同時把它改成 refunded ⇒ **也算成功**。
      --    📌 **「不是那個壞值」與「是那個好值」是兩個宣稱** —— 而前者把所有沒想到的世界都算成好的。
      IF v_after = 'paid'::public.payment_status THEN
        v_fixed := v_fixed + 1;
        INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
        VALUES (r.id, 1, pg_catalog.clock_timestamp(), NULL)
        ON CONFLICT (order_id) DO UPDATE
          SET attempts = t.attempts + 1,
              last_attempt_at = pg_catalog.clock_timestamp(),
              last_error = NULL,
              gave_up_at = NULL;   -- 🔵 修好了就把放棄章拿掉(它可能是上一輪蓋的)
      ELSE
        -- 🔵 沒拋例外而狀態沒動 ⇒ **那就是失敗**, 而錯誤內容在 Postgres log 裡(內層 RAISE LOG)。
        INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
        VALUES (r.id, 1, pg_catalog.clock_timestamp(),
                '重算後狀態仍是 unpaid(內層吞了例外, 詳情看 Postgres log 的 [pcm_noncard_settle])')
        ON CONFLICT (order_id) DO UPDATE
          SET attempts = t.attempts + 1,
              last_attempt_at = pg_catalog.clock_timestamp(),
              last_error = excluded.last_error,
              gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts THEN pg_catalog.clock_timestamp() ELSE NULL END;
      END IF;
    -- 🔴 **`query_canceled`(57014)要【具名】接**(codex R2 打掉我 R1 那句「接不住」)——
    --    `WHEN OTHERS` 確實不含它, 而 `WHEN query_canceled` 含。
    --    ⛔ ~~我 R1 寫「要修它得每張單各自 commit / dblink」~~ —— **那句是錯的。**
    --    ✅ 接住它 ⇒ 記一次失敗 ⇒ **然後往上拋**:一輪逾時代表這一輪的預算用完了,
    --       繼續跑下去只會讓下一張也逾時。而 attempts 那一筆會跟著交易回捲 ——
    --       🛑 **那一格仍然沒解**(整輪回捲), 而現在至少 log 裡會有一行說「是逾時」。
    EXCEPTION WHEN query_canceled THEN
      RAISE LOG '[pcm_settle_retry_sweep] order=% 逾時(57014)⇒ 本輪中止', r.id;
      RAISE;
    WHEN OTHERS THEN
      -- 🔴 **一張單失敗不得讓整輪停下來** —— 否則第一張壞單會擋住它後面所有的單。
      --    而那正是本片要修的那個病的形狀:一個吞掉的例外, 讓後面的事再也不發生。
      INSERT INTO public.pcm_settle_retry_attempts AS t (order_id, attempts, last_attempt_at, last_error)
      VALUES (r.id, 1, pg_catalog.clock_timestamp(), left(SQLERRM, 500))
      ON CONFLICT (order_id) DO UPDATE
        SET attempts = t.attempts + 1,
            last_attempt_at = pg_catalog.clock_timestamp(),
            last_error = left(SQLERRM, 500),
            gave_up_at = CASE WHEN t.attempts + 1 >= c_max_attempts THEN pg_catalog.clock_timestamp() ELSE NULL END;
      RAISE LOG '[pcm_settle_retry_sweep] order=% 重算再次失敗:%', r.id, SQLERRM;
    END;
  END LOOP;

  -- ── 心跳 ──────────────────────────────────────────────────
  -- 🔴 **今天(2026-09-05)我因為漏了這一格弄紅過全隊一次** ——
  --    排了排程而沒有接上監控 ⇒ `cron-heartbeat-read` 那格會叫「有排程沒有人在看它」。
  --    而反過來(在白名單裡而從不寫心跳)⇒ 每天一封「它沒跳」的信。
  -- 🔴 `clock_timestamp()` 不用 `now()`(now() 是交易起始時間 ⇒ 心跳會倒退);
  --    `GREATEST` 擋晚到的舊值覆蓋新值。
  -- ⚠️ 而這個 EXCEPTION **接不住失敗那一側**:純 SQL 跑在 pg_cron 自己的交易裡,
  --    函式拋錯 ⇒ 同交易寫的東西一起回捲 ⇒ 它物理上寫不出失敗心跳
  --    ⇒ 所以 `pcm-settle-retry` 也要進 `FAILURE_COUNT_MEANINGLESS`。
  BEGIN
    INSERT INTO public.sweeper_heartbeat (job_name, last_success_at, consecutive_failures, updated_at)
    VALUES ('pcm-settle-retry', pg_catalog.clock_timestamp(), 0, pg_catalog.clock_timestamp())
    ON CONFLICT (job_name) DO UPDATE
      SET last_success_at      = GREATEST(public.sweeper_heartbeat.last_success_at, excluded.last_success_at),
          consecutive_failures = 0,
          updated_at           = GREATEST(public.sweeper_heartbeat.updated_at, excluded.updated_at);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[pcm_settle_retry_sweep] 心跳寫入失敗(本輪重算不受影響):%', SQLERRM;
  END;

  RETURN v_fixed;
END;
$sweep$;

REVOKE ALL ON FUNCTION public.pcm_settle_retry_sweep() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_sweep() FROM anon;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_sweep() FROM authenticated;
REVOKE ALL ON FUNCTION public.pcm_settle_retry_sweep() FROM service_role, payment_confirmer;

COMMENT ON FUNCTION public.pcm_settle_retry_sweep() IS
  '⟦b4-SETTLERETRYNEVER⟧:把「收了錢而還停在 unpaid」的匯款單再算一次。'
  '🔴 一張單最多試 5 次, 之後 `gave_up_at` 蓋章;24 小時後再給一次機會。'
  '🛑 而它**不通知任何人, 而且今天沒有人在看那張表** —— 板列 ⟦b4-RETRYGAVEUPNOWATCHER⟧。';

-- ── ③ 每 10 分鐘 ────────────────────────────────────────────
-- 🔵 週期抄 `pcm-capture-recheck`(`20260820070000` 的 `*/10 * * * *`)——
--    同一族的東西(修一張卡住的單), 而**它不是量出來的, 是抄的**。
SELECT cron.schedule('pcm-settle-retry', '*/10 * * * *', $cron$SELECT public.pcm_settle_retry_sweep();$cron$);

-- ── ④ 事後斷言 ──────────────────────────────────────────────
DO $$
DECLARE
  v_relations text[] := ARRAY[
    'public.pcm_settle_retry_attempts',
    'public.pcm_settle_retry_sweep()'
  ]::text[];
  v_r    text;
  v_leak text[] := ARRAY[]::text[];
  v_n    integer;
BEGIN
  IF to_regclass('public.pcm_settle_retry_attempts') IS NULL
     OR to_regprocedure('public.pcm_settle_retry_sweep()') IS NULL THEN
    RAISE EXCEPTION '斷言④a:物件沒建出來';
  END IF;

  -- 🔴 **列舉四個角色是【黑名單】, 它跟下一個沒想到的角色賽跑**(codex R1 must-fix;
  --    而 `20260904230000:346` 已經為同一件事留過同一句話)。
  --    ✅ 改成【白名單】:把 ACL 整個攤開, 只准表擁有者出現。
  -- 🔴 **`relacl IS NULL` 要單獨守**(codex R2):`aclexplode(NULL)` 回**零列**
  --    ⇒ `array_agg` 得 NULL ⇒ 下面那道斷言**靜靜通過**。
  --    而 `relacl IS NULL` 的意思是【預設 ACL】—— 那正是「四道 REVOKE 沒生效」的樣子。
  IF (SELECT relacl IS NULL FROM pg_catalog.pg_class
       WHERE oid = 'public.pcm_settle_retry_attempts'::regclass) THEN
    RAISE EXCEPTION '斷言④b0:表的 relacl 是 NULL ⇒ 那是【預設授權】, 四道 REVOKE 沒生效';
  END IF;
  SELECT array_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC'))
    INTO v_leak
    FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid = 'public.pcm_settle_retry_attempts'::regclass
     AND COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC') <> pg_get_userbyid(c.relowner);
  IF v_leak IS NOT NULL AND array_length(v_leak, 1) > 0 THEN
    RAISE EXCEPTION '斷言④b:表的 ACL 上有擁有者以外的人 ⇒ %', array_to_string(v_leak, ', ');
  END IF;
  -- 🔵 函式那邊同樣走白名單。⚠️ `proacl` 為 NULL 代表【預設】(= PUBLIC 可執行)⇒ 那要紅。
  IF (SELECT proacl IS NULL FROM pg_catalog.pg_proc
       WHERE oid = 'public.pcm_settle_retry_sweep()'::regprocedure) THEN
    RAISE EXCEPTION '斷言④b2:函式 proacl 是 NULL ⇒ 預設 PUBLIC 可執行, 四道 REVOKE 沒生效';
  END IF;
  SELECT array_agg(DISTINCT COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC'))
    INTO v_leak
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_settle_retry_sweep()'::regprocedure
     AND COALESCE(pg_get_userbyid(a.grantee), 'PUBLIC') <> pg_get_userbyid(p.proowner);
  IF v_leak IS NOT NULL AND array_length(v_leak, 1) > 0 THEN
    RAISE EXCEPTION '斷言④b3:函式的 ACL 上有擁有者以外的人 ⇒ %', array_to_string(v_leak, ', ');
  END IF;
  IF array_length(v_leak, 1) IS NOT NULL THEN
    RAISE EXCEPTION '斷言④b:這些角色還有權限 ⇒ %', array_to_string(v_leak, ', ');
  END IF;

  -- 🟢 負對照:同一把尺問【表擁有者】⇒ 必須是 true。
  --    少了這一格, 一支恆回 false 的 has_table_privilege 會讓 ④b 永遠通過。
  IF NOT has_table_privilege(current_user, 'public.pcm_settle_retry_attempts', 'SELECT') THEN
    RAISE EXCEPTION '斷言④c:連我自己都讀不到 ⇒ 上面那把尺是壞的';
  END IF;

  -- ④d 真的叫得動, 而且不會炸(今天世界是空的 ⇒ 該回 0)
  SELECT public.pcm_settle_retry_sweep() INTO v_n;
  IF v_n IS NULL THEN
    RAISE EXCEPTION '斷言④d:sweep 回 NULL';
  END IF;

  -- ④e 心跳真的寫出來了(這一格就是我今天漏掉的那一格)
  IF NOT EXISTS (SELECT 1 FROM public.sweeper_heartbeat
                  WHERE job_name = 'pcm-settle-retry' AND last_success_at IS NOT NULL) THEN
    RAISE EXCEPTION '斷言④e:心跳沒寫出來 ⇒ 監控那張表會說「這支排程從來沒跳過」';
  END IF;

  -- ④f 排程在, 而且【active】—— 名字在不等於它會跑
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-settle-retry' AND active) THEN
    RAISE EXCEPTION '斷言④f:排程不存在或 active = false ⇒ 它永遠不會跑';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'pcm-settle-retry' AND command LIKE '%pcm_settle_retry_sweep%') THEN
    RAISE EXCEPTION '斷言④g:排程的 command 不是在叫 pcm_settle_retry_sweep ⇒ 名字對而做的事不對';
  END IF;
END $$;

COMMIT;
