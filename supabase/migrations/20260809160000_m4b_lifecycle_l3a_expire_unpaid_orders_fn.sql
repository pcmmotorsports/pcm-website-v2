-- ============================================================
-- M-4b 生命週期 L3a(件①):未付款訂單超過 1 天自動失效 — **函式本體**(不含排程)
-- ============================================================
-- 真權威:docs/specs/2026-08-09-order-payment-lifecycle-plan.md 件① / §3 表 L3。
-- 批准:Sean 2026-08-09 對 plan §6 六題逐字 `Q1:a … Q6:a`(Q1=A 沿用 cancelled_at + reason、
--   Q2=A 不復活、Q5=A 獨立每小時 pg_cron job),經主視窗 P-232-A 轉達;縮小版範圍另經 P-239-A 核准。
--
-- 鐵則 12①(錢:訂單狀態)③(大量寫入)。**排程那半在 L3b `20260809170000`**(鐵則 12④ 平台設定)。
--
-- 🔴 **為什麼拆成兩支**:pg_cron 是 Supabase 平台擴充,vanilla PG 沒有 ⇒ 隔離 DB 排練環境
--   (`scripts/d1t2-rehearsal.sh`)必須跳過依賴它的 migration(既有先例:`20260723120000`)。
--   函式本體與排程放在同一支 = 整支被跳過 = **這支 RPC 的行為在本機一格都驗不到**。
--   拆開之後:本片(純 SQL)在排練環境照常套用 ⇒ `scripts/l3-verify.sh` 能對**真的 PostgreSQL**
--   跑行為斷言;只有排程那半靠字面與正式環境 apply 斷言承重。
--
-- ── 這片做什麼 ───────────────────────────────────────────────────────────────
-- `payment_status='unpaid'` 且超過 1 天沒付成的訂單,寫上 `cancelled_at` + `cancelled_reason='payment_expired'`。
-- **不刪任何資料、不動 payment_status、不碰庫存**;純粹讓一張沒走完的單有個終點,不再無限期躺在後台。
--
-- 🔴 **這片解決的不是「客人被卡住」** —— 沒有人被卡(見下方不變量那段)。它解決的是資料面:
--    admin 列表噪音、報表失真(轉換率/客單價含殭屍單)。對客可見的那半由 L6 的顯示層過濾接走
--    (Sean 2026-08-09 逐字「刷卡單失敗直接不顯示在後台就好」,P-233-A)。
-- ⚠️ **上線當下對現有資料的影響是 0**:主視窗 2026-08-09 唯讀盤點正式站 = 殭屍 0 / pending 0 /
--    unpaid 超過 1 天 0(P-232-A ②)⇒ 首輪掃描預期 0 筆。**這是預防機制,不是清理作業。**
--
-- ── 🔴 不變量:cancelled ⇒ 該單沒有 active attempt ────────────────────────────
-- 本 RPC 的 `NOT EXISTS (attempt WHERE status <> 'failed')` **與 `admin_cancel_order` 的允許集合逐字同條件**
-- (`20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:198-202`)⇒ orders 的兩個「寫 cancelled_at」的入口
-- 都維持同一條不變量。
-- **為什麼這條不變量重要**:三處「擋客人重新結帳」的查詢
--   ① `find_active_sibling_own`(`20260624120001_*.sql:66-70`)
--   ② `begin_charge_attempt` cart dedup(`20260613130000_*.sql:399-409`)
--   ③ 同函式 per-user 閘(`20260613130000_*.sql:433-444`)
-- **每一個都要求該單有 active attempt(pending|charged)或已 paid**。有了上面那條不變量,
-- 被取消/失效的單依定義不可能滿足它們 ⇒ **失效不會、也不需要去動那三處**。
-- 🔴 **反過來說:誰要放寬取消/失效的條件(例如允許取消在途單),必須同時回頭改那三處**,
--    否則會出現「單已取消、charge 還在途中,而三處都不再擋」⇒ 客人重刷 = 雙扣。
-- ⚠️ 本片一度打算在那三處加 `cancelled_at IS NULL`;**已撤回**:在現行不變量下它是死碼,
--    而一旦不變量被放寬,它會從死碼變成「不再阻擋在途取消單」的陷阱(plan §2 件① 有完整說明)。
--
-- ⚠️ **`orders.version`(樂觀鎖)本片不動**(code-reviewer N6):admin 的寫入走 `WHERE version = $expected`,
--    cron 失效不 bump version ⇒ 對「表單已開著的 admin」而言這次變更不可見、不會撞 409。
--    這與 `admin_cancel_order` 同形狀(它也不 bump)⇒ 「兩個寫入端一致」這句在 version 這一面**也**成立;
--    要改就兩支一起改,不在本片。
--
-- ── 為什麼不新增 payment_status 值 / 不寫 order_cancellations / 不寫 admin_audit_log ──
-- · payment_status 加值:PG enum 加了不能刪,且該欄被 begin/settle/confirm/sweeper 四層的 WHERE 直接比對
--   (`20260613130000:407,441`、`20260615120001:98` …)⇒ 為顯示層方便去動雙扣防線的比對語意,不划算(Q1=C 未採)。
-- · `order_cancellations`:那張表模型的是**客服取消**(actor、reason_code、逐品項 cancelled_quantity)。
--   自動失效沒有 actor、沒有品項層決策 ⇒ 硬塞會讓那張表的語意變髒。
-- · `admin_audit_log`:`source_app` CHECK 只收 `('admin','quote')`(`20260712210000_*.sql`),
--   為了一支排程去放寬共用稽核表的 CHECK,代價大於收益。
-- 🔴 **那要怎麼查「這支到底有沒有在跑、跑了什麼」**(觀測點,誠實列出):
--   ① 跑了什麼 → `SELECT * FROM public.orders WHERE cancelled_reason = 'payment_expired'`(durable、可查時間);
--   ② 有沒有在跑 → pg_cron 的執行紀錄。🔴 **`cron.job_run_details` 沒有 `jobname` 欄**(codex 關卡2 指正,
--      官方欄位表:jobid/runid/job_pid/database/username/command/status/return_message/start_time/end_time)
--      ⇒ 要這樣查:
--        SELECT d.* FROM cron.job_run_details d JOIN cron.job j USING (jobid)
--         WHERE j.jobname = 'pcm-expire-unpaid-orders' ORDER BY d.start_time DESC;
--      ⚠️ 且 `return_message` 對 SELECT 記的是 **command tag**(如 `SELECT 1`),**不是**本函式回傳的筆數
--      ⇒ 「這次掃到幾筆」要看 ①,不要期待從 ② 讀到數字;② 只回答「有沒有跑、成不成功」。
--   這兩點合起來才回答得了災難當天的問題;缺 ② 的話,「沒有失效單」會同時相容於「機制正常但沒東西可掃」
--   與「機制死了」兩種世界。
--
-- ── ⚠️ 重估觸發(Sean 拍板時逐字要求寫死在規格裡)──────────────────────────
-- 🔴 **開放匯款付款(後台第 15 項)時,「1 天」必須重看** —— 匯款常要 1-3 天,1 天會把正常等匯款的單殺掉。
--    屆時的最小修法:本函式的 interval 改成依 `payment_channel` 分流(tappay 1 天 / bank_transfer 另訂),
--    或對非 tappay channel 直接不失效。**這條同時是 L6 顯示層隱藏規則的邊界**(P-233-A ④:
--    未來匯款單不在隱藏規則內)。
--
-- ── 🔴 驗證紀錄(只寫已經發生的事)───────────────────────────────────────────
-- ✅ `scripts/l3-verify.sh`(本地隔離 PG17,由 `scripts/d1t2-rehearsal.sh provision` 建庫、全部 migration 實套;
--    2026-08-09 實跑輸出逐字 **PASS=25 FAIL=0 突變命中=5**):
--    A 區 11 格 失效條件(🔴 pending / charged / **released** attempt 一律不碰、attempt 全 failed 才失效、
--                       23:59:59 邊界不動、已取消不覆寫、paid 與**其餘三個 payment_status 值**都不動)
--    B 區 4 格 批次與回傳(p_limit=1 取最舊 / 0 與 NULL 退回 1 / 回傳值 = 實際改動筆數)
--    C 區 2 格 權限(四個 client role 零 EXECUTE〔有判別力〕、pcm_cron 零 USAGE〔回歸格、今天恆真〕)
--    D 區 4 格 = **補跑 L2 `20260809140000` 欠的行為證據**(見該檔「驗證紀錄」段)
--    E 區 1 格 還原確認(E9;E1-E5 五個突變另計於「突變命中」,不進 PASS)
--    F 區 3 格 零留痕(全庫快照逐字相同 + 兩個標記零殘留)
--    ⇒ 11+4+2+4+1+3 = 25,與輸出的 PASS=25 對得上。
--
-- ✅ 五個突變各自讓對應的斷言翻面(= 那些斷言不是恆真;**不宣稱「只翻那一格」**,見下方措辭說明):
--    拿掉 `NOT EXISTS` ⇒ A3 翻面 / `1 day`→`1 second` ⇒ A2 / 拿掉 unpaid 閘 ⇒ A7 /
--    拿掉 `cancelled_at IS NULL` ⇒ A6 / `ORDER BY` 反轉 ⇒ B1
--    (🔴 排序那格刻意用「反轉」而非「拿掉」:拿掉之後堆序可能碰巧仍回最舊那筆 = 假綠。)
--    ⚠️ 措辭精確(codex 關卡2):每個突變只重跑**最能代表它**的那一格,**不宣稱「只翻一格」** ——
--       例如拿掉 `NOT EXISTS` 實際會同時翻 A3/A4/A8。要證明的是「拿掉守門 ⇒ 對應斷言會紅」。
--
-- ⚠️ 誠實邊界:本地 vanilla PG17 ≠ Supabase(無 pg_cron、無 RLS 情境、auth.uid() 回 NULL)
--    ⇒ 驗到的是**函式邏輯與權限**;**排程那半沒有本機證據**(在 L3b `20260809170000`,
--    只有它自己 apply 當下的 fail-closed 斷言 + 上線後 cron.job_run_details)。
--    並發/鎖行為(`FOR UPDATE SKIP LOCKED` 在多 worker 下的表現)本 harness **未涵蓋**。
--
-- Rollback(Supabase forward-only、僅供參考):
--   DROP FUNCTION IF EXISTS pcm_cron.expire_unpaid_orders(integer);
--   -- 資料面回滾:本片寫 cancelled_at / cancelled_reason / **updated_at** 三欄。
--   -- 🔴 前兩欄可完全復原;`updated_at` **復原不了**(舊值沒留)—— 下面這句只還原前兩欄,
--   --    被掃到的列的 updated_at 會停在失效當下的時間。誠實列出,不要宣稱「完全復原」。
--   UPDATE public.orders SET cancelled_at = NULL, cancelled_reason = NULL
--    WHERE cancelled_reason = 'payment_expired';
-- ============================================================


BEGIN;

-- ── 0. 前置閘(必須 postgres + 依賴欄位存在;🔴 **本片不檢查 pg_cron** —— 它是純 SQL、
--        在 vanilla PG 也要套得起來,pg_cron 的檢查在 L3b)──────────────────────
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'L3a:migration 必須以 postgres 執行(實 %);拒繼續', current_user;
  END IF;
  -- 依賴的欄位必須在(cancelled_at / cancelled_reason 由 20260712203000 建;缺 = 依賴順序被打亂)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'cancelled_reason'
  ) THEN
    RAISE EXCEPTION 'L3a:orders.cancelled_reason 不存在(應由 20260712203000 建);拒繼續';
  END IF;
END $$;


-- ── 1. 失效 RPC(私有 schema、只給排程呼)────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS pcm_cron;
REVOKE ALL ON SCHEMA pcm_cron FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION pcm_cron.expire_unpaid_orders(p_limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- 防 SECURITY DEFINER search_path 劫持;下方全 schema-qualify。
AS $fn$
DECLARE
  v_count integer;
BEGIN
  -- 🔴 誠實邊界(codex 關卡2):本函式**完全信任 `orders.created_at`**,而那一欄沒有不可變守門 ——
  --    owner / migration 把它回填成舊日期,新單會提早被取消;改成未來,則永遠掃不到。
  --    不加守門的理由:owner 本來就能繞過任何 DB 層防線,為此加欄位級 trigger 的代價大於收益。
  -- p_limit fail-safe:NULL / <=0 一律退回 1(不接受「無上限」;0-worker 會靜默不處理)。
  -- ⚠️ 誠實邊界(codex 關卡2 nit):`LIMIT` 限的是**改幾列**,不是**掃幾列** —— 歷史 paid/failed 單一多,
  --    找候選的掃描成本仍會長,且本函式沒有 statement_timeout。現況存量 0、每小時一次 ⇒ 可接受;
  --    真的長起來時的修法 = 對 (payment_status, cancelled_at, created_at) 加部分索引 + 設 statement_timeout。
  IF p_limit IS NULL OR p_limit <= 0 THEN
    p_limit := 1;
  END IF;

  WITH target AS (
    SELECT o.id
      FROM public.orders o
     WHERE o.payment_status = 'unpaid'::public.payment_status
       AND o.cancelled_at IS NULL                                    -- 已取消/已失效 → 不重複寫(冪等)
       AND o.created_at < pg_catalog.now() - interval '1 day'        -- 🔴 1 天 = Sean 2026-08-09 逐字「1天」(落 memory project_m4b-b2-shipments-db-decisions:79;
       --    ⚠️ 那份 memory 內部編號 Q2 指的是天數,與本 plan §6 的 Q2「失效單不復活」是**不同的兩題**,別混)。
       --    重估觸發見檔頭。
       -- 🔴 安全核心:有任何非終態 attempt = 錢可能在途 ⇒ 一律不碰(留給對帳/人工)。
       --    條件與 admin_cancel_order 步7 逐字相同 ⇒ 兩個寫入端維持同一條不變量。
       --    ⚠️ 代價(code-reviewer N7):`released` 也被這條擋住 ⇒ **帶 released attempt 的單永遠不會被失效**。
       --    這是保守的正確選擇(released = 鎖已釋、仍在低頻對帳到 terminal),但它意味著那類單
       --    **在本片之後仍然沒有終點** —— 那正是 Q7/L5 要處理的「放棄型」殭屍,不在件① 範圍。
       AND NOT EXISTS (
             SELECT 1 FROM public.payment_charge_attempts a
              WHERE a.order_id = o.id
                AND a.status <> 'failed'
           )
     ORDER BY o.created_at                                            -- 最舊的先處理(可預期、便於分批)
     LIMIT p_limit
     -- 🔴 字面精確(codex 關卡2 nit):SKIP LOCKED 只保證**本函式**跳過已被別人鎖住的列;
     --    若本函式先拿到鎖,後來的 admin 仍會等。稱「互不阻塞」不實,實際是「本函式不等別人」。
     FOR UPDATE OF o SKIP LOCKED
  )
  UPDATE public.orders o
     SET cancelled_at     = pg_catalog.now(),
         cancelled_reason = 'payment_expired',
         updated_at       = pg_catalog.now()
    FROM target t
   WHERE o.id = t.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  -- 🔴 觀測點(plan §4-6 驗收條件):每次執行都留一行,零 PII(只有筆數與上限)。
  --    沒有它的話,「掃到 0 筆」與「這支根本沒被呼叫」在 DB 側分不出來 ——
  --    而 cron.job_run_details 的 return_message 對 SELECT 只會記 command tag、不記筆數。
  RAISE LOG '[expire_unpaid_orders] expired=% limit=%', v_count, p_limit;
  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION pcm_cron.expire_unpaid_orders(integer)
  FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;

COMMENT ON FUNCTION pcm_cron.expire_unpaid_orders(integer) IS
  'M-4b 生命週期 L3(件①):unpaid + 未取消 + 建立超過 1 天 + **無任何非終態 attempt** 的訂單 → 寫 cancelled_at + cancelled_reason=''payment_expired''(不刪資料、不動 payment_status、不碰庫存)。回本次筆數。批次上限 p_limit(預設 500、NULL/<=0 退回 1)、FOR UPDATE SKIP LOCKED(語意=**本函式不等別人**;若本函式先拿到鎖,後來的 admin 仍會等,不是「互不阻塞」)。🔴 不變量:cancelled ⇒ 無 active attempt(與 admin_cancel_order 步7 同條件)——三處「擋重新結帳」的查詢都靠 active attempt 判定,放寬本條件的人必須同時回頭改那三處,否則「已取消但 charge 在途」會不再被擋 = 雙扣。⚠️ 重估觸發:開放匯款付款(後台第 15 項)時「1 天」必須重看(匯款常要 1-3 天),屆時改為依 payment_channel 分流。只由 pg_cron job pcm-expire-unpaid-orders 呼叫;無任何 client role 可執行。';


-- ── 2. fail-closed 斷言(任一異常 → 整檔 ROLLBACK;本檔自包 BEGIN…COMMIT,
--        沒有它的話 psql -f 會逐句 autocommit、前面的 schema/函式/ACL 已經留在 DB 上了)──────────────────────────
DO $$
BEGIN
  -- 2a. 函式:owner=postgres、SECURITY DEFINER、search_path 固定空。
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND p.proowner = 'postgres'::regrole
       AND p.prosecdef
       -- 🔴 字面注意:`SET search_path = ''` 在 proconfig 實際存成 `search_path=""`(含兩個雙引號),
       --    不是 `search_path=`。寫錯這個字面 ⇒ 斷言恆假、apply 直接被自己的守門擋下
       --    (本片實測踩過一次,對齊 20260723120000:3a 的同一句註解)。
       AND p.proconfig @> ARRAY['search_path=""']
  ) THEN
    RAISE EXCEPTION 'L3a:expire_unpaid_orders 的 owner/SECDEF/search_path 不符;拒繼續';
  END IF;

  -- 2b. ACL:🔴 **allowlist 而非黑名單**(codex 關卡2):只列舉四個已知角色的話,
  --     任何「未被列舉的新角色」拿到 EXECUTE 都不會被發現。改成「owner 以外零 grantee」。
  IF EXISTS (
    SELECT 1
      FROM pg_proc p,
           LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = 'pcm_cron.expire_unpaid_orders(integer)'::regprocedure
       AND a.grantee <> p.proowner        -- owner 自己不算
       AND a.grantee <> 0                 -- 0 = PUBLIC:下一條單獨擋(訊息才分得出來)
  ) THEN
    RAISE EXCEPTION 'L3a:expire_unpaid_orders 有 owner 以外的 grantee(應零);拒繼續';
  END IF;
  IF has_function_privilege('public', 'pcm_cron.expire_unpaid_orders(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'L3a:expire_unpaid_orders 對 PUBLIC 可執行(REVOKE 沒生效?);拒繼續';
  END IF;

  -- 2c. schema 未曝露給 PostgREST 的前提(pcm_cron 對 client role 零 USAGE)。
  --     ⚠️ 誠實標註(code-reviewer M7):新建 schema 本來就沒給 PUBLIC USAGE ⇒ §1 的 REVOKE 對 USAGE 是
  --     no-op,**這道斷言今天恆真、零判別力**。留著是回歸用(將來有人 GRANT USAGE 時會擋下),
  --     **不得**把它當成「權限有被鎖上」的證據 —— 有判別力的是 2b(拿掉 REVOKE 會翻紅,harness C1 實測)。
  IF has_schema_privilege('anon',          'pcm_cron', 'USAGE')
  OR has_schema_privilege('authenticated', 'pcm_cron', 'USAGE')
  OR has_schema_privilege('service_role',  'pcm_cron', 'USAGE') THEN
    RAISE EXCEPTION 'L3a:pcm_cron schema USAGE 外洩;拒繼續';
  END IF;
END $$;

COMMIT;
