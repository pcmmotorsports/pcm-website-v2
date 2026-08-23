-- ============================================================
-- `#866` 片 1/2:人工退款的「該軌淨實收」上限函式(**只建函式,還沒有人呼叫它**)
-- ============================================================
-- plan = ~/pcm-mailbox/58-866-人工退款軌別上限-plan-20260824.md
-- 命中 = 鐵則 12①(錢)+ 12③(動 RPC / migration)⇒ 對抗審查不降級
--
-- ── 這支在補什麼洞 ──────────────────────────────────────────────────
-- `admin_record_manual_refund` 的額度上限問的是 `pcm_order_refundable_remaining`,
-- 而那支的分母是**訂單總額**(`20260820100000:231` `SELECT o.total::bigint - …`)。
-- ⇒ 它管得住「退超過訂單」,**管不住「退一筆從來沒收過的錢」**。
--
-- 攻擊路徑(codex 對抗審查 2026-08-24 構造,主視窗與施工窗 A 各自逐格複打;backlog `#866`):
--   持有效後台 session ⇒ **直接送 `recordManualRefundAction`(不經畫面)**
--   ⇒ 一張純刷卡、未付款的單 ⇒ 金額 ≤ 訂單總額 ⇒ 寫進一筆假的人工退款
--   ⇒ **永久扣低該單的可退餘額**。
-- 🔴 UI 那道 rail 條件(`manual-refund-entry-gate.ts`)**server 端沒有重驗**,
--    而擋不住它的理由就寫在 `manual-refund-actions.ts` 自己的註解裡:
--    「畫面按鈕不渲染**擋不住**直接送這支 server action 的請求」。
--
-- ── 🔴 為什麼【不】改 `pcm_order_refundable_remaining` ─────────────────
-- 量法(2026-08-24):
--   `grep -rln "pcm_order_refundable_remaining" supabase/migrations apps packages | grep -v node_modules | grep -v '\.next'`
--   ⇒ migration 10 支 + app 層 13 支(含測試)
-- ⇒ 它是**卡片退款那條線也在用**的共用上限,而卡退本來就該用訂單總額當分母。
-- ⇒ 改它會直接打到卡退 ⇒ **本片新增一支,既有那支一個字不動。兩道上限同時成立,取較嚴的。**
--
-- ── Sean 2026-08-24 拍板:合併,不逐軌 ────────────────────────────────
-- `cash` 與 `bank_transfer` **合併計算**,不分軌對帳。
-- 理由(施工窗 A 提、Sean 採納):
--   ① 逐軌會誤擋一個合法動作 —— 客人付現金 1000、我們用匯款退他 1000。
--   ② 🔴 **合併已經把洞完全堵住**:攻擊要的是「純刷卡的單」,而純刷卡單的
--      `cash + bank_transfer` 淨實收 = **0** ⇒ 合併擋得死。
--      ⇒ **逐軌沒有多堵到任何東西,只多了誤擋。**
--      📌 形狀:**「這個更嚴的選項,嚴在哪裡?」答不出來 ⇒ 那不是更安全,只是更吵。**
--
-- ── ⚠️ 本片【不做】什麼(誠實邊界)────────────────────────────────────
-- · **本片只建函式,零呼叫端** ⇒ 套下去之後**行為一個字都沒變**。
--   接上它的是片 2/2(執行點還在決定中,見 plan §3 與主視窗)。
-- · 不碰 `pcm_order_refundable_remaining`、不碰任何表結構、零資料異動。
-- · down-migration 在檔尾,而**照本 repo 慣例它不會被跑過** ⇒ 標【未驗】,不宣稱可回退。
--
-- ── 🔴 一個寫這種 migration 必踩的坑(`20260820100000` 檔內記過,原封搬來)───
-- `prosrc` **含註解** ⇒ 任何比對 `prosrc` 字面的斷言,**註解與 code 在裡面是同一種東西**。
-- ⇒ 在函式本體裡寫出關鍵字,會讓那些斷言對「把 code 整段刪掉」**恆真**。
-- ⇒ **本檔的函式本體【不寫】說明性關鍵字**,說明一律寫在函式外面(就是這裡)。
-- ============================================================

-- ══ 0. 前置閘(缺任何一個就炸,不要靜靜跳過)═════════════════════════
DO $pre$
BEGIN
  IF to_regclass('public.order_payments') IS NULL THEN
    RAISE EXCEPTION '#866 前置閘:public.order_payments 不存在 ⇒ 算不出淨實收';
  END IF;
  IF to_regclass('public.order_manual_refunds') IS NULL THEN
    RAISE EXCEPTION '#866 前置閘:public.order_manual_refunds 不存在 ⇒ 先 apply 20260820010000';
  END IF;
  -- 🔴 作廢欄是本片算式的一半(未作廢的才扣額度)⇒ 沒有它,算出來的上限會偏低而沒有訊號
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.order_manual_refunds'::regclass
                    AND attname = 'voided_at' AND NOT attisdropped AND attnum > 0) THEN
    RAISE EXCEPTION '#866 前置閘:order_manual_refunds.voided_at 不存在 ⇒ 先 apply 20260820090000';
  END IF;
  -- 🔴 **以下三道是 2026-08-24 codex must-fix 補的** —— 它們不是「多驗一點」,
  --    而是本函式算出來的數字**建立在它們之上**:
  --    ① `refund_amount > 0`:少了它,一筆**負的**人工退款會讓扣減變成加法
  --       ⇒ **反向【增加】可退上限**,而本檔的 A1-A4 一道都不會響。
  --    ② `rail` 值域:本函式只取 `cash` / `bank_transfer` 兩軌 —— 值域若漂掉,
  --       「哪些算在這一軌」就沒有依據了。
  --    ③ `void_trio`:作廢的三欄要配對,否則「已作廢」這個狀態本身可以是半套的,
  --       而算式第二段正是靠 `voided_at IS NULL` 分辨它。
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.order_manual_refunds'::regclass
                    AND contype = 'c' AND convalidated
                    AND pg_get_constraintdef(oid) ILIKE '%refund_amount%>%0%') THEN
    RAISE EXCEPTION '#866 前置閘:order_manual_refunds 的 refund_amount > 0 CHECK 不在(或未 validated)'
      ' ⇒ 負值退款會反向【增加】上限,本片的算式不成立';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.order_payments'::regclass
                    AND contype = 'c' AND convalidated
                    AND pg_get_constraintdef(oid) ILIKE '%rail%bank_transfer%') THEN
    RAISE EXCEPTION '#866 前置閘:order_payments 的 rail 值域 CHECK 不在 ⇒ 本片取兩軌的依據不成立';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.order_manual_refunds'::regclass
                    AND conname = 'order_manual_refunds_void_trio' AND convalidated) THEN
    RAISE EXCEPTION '#866 前置閘:order_manual_refunds_void_trio 不在 ⇒ 「已作廢」可能是半套狀態,'
      ' 而算式第二段靠 voided_at IS NULL 分辨它';
  END IF;

  -- 🔴 **fail-closed,不是冪等**(2026-08-24 codex must-fix;做法照 `#841` 那支:裸 CREATE + 存在性斷言)
  --    ~~原本用 `CREATE OR REPLACE` + RAISE NOTICE~~ ⇒ 那會**覆寫**一支同名函式,
  --    而**保留它既有的 owner 與額外 ACL** —— 也就是說:如果有人先種了一支同名函式,
  --    我們的定義蓋上去,而**權限仍是他的**。A2/A3 只查三個角色 ⇒ 查不到那件事。
  --    ⇒ 已存在 ⇒ **直接炸**,由人去看那支是誰建的,不要靜靜覆蓋。
  IF to_regprocedure('public.pcm_manual_refund_rail_cap(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION '#866 前置閘:public.pcm_manual_refund_rail_cap(uuid) 已存在。'
      '⇒ 本檔【不覆寫】(覆寫會保留既有 owner 與額外 ACL)。'
      '若確定要重套,先 DROP FUNCTION 再跑,並確認那支是我們建的。';
  END IF;
END
$pre$;

-- ══ 1. 上限函式 ═══════════════════════════════════════════════════════
-- 算式兩段,四個口徑每個都有出處(逐字出處寫在下方 COMMENT 與本檔頭,不寫進函式本體):
--   ① 收款側直接加總、**不過濾負列、不 ABS、不只算非沖銷列**  出處 `20260815010000:18-20`
--      沖銷列帶負值(`20260810100000:199` `CHECK (amount <> 0)`),而「一邊算一邊不算 =
--      兩個數字都對不起來,而且沒有任何錯誤訊號」(同檔逐字)
--   ② `COALESCE(…, 0)`  出處同檔 `:22-23` —— SQL 的 `SUM()` 在**零列**時回 **NULL 不是 0**,
--      而「這張單還沒有任何收款」是**常態**,不是邊角案例
--      🔴 少了它 ⇒ 呼叫端拿到 NULL ⇒ `p_refund_amount > NULL` **不為 true** ⇒ **靜靜放行**
--         (同款已記在 `20260820021000:285`:`999999 > NULL` 不為 true,拋棄式 PG 17.10 實測)
--   ③ 扣掉的那半要 `voided_at IS NULL`  出處 `20260820100000:261`(既有那支第三段同樣寫法)
--      ⇒ **作廢掉的登記要把額度還回來**,否則作廢等於沒作廢
--   ④ `rail` 值域三值  出處 `20260810100000:189` `CHECK (rail IN ('card','bank_transfer','cash'))`
--      本函式取其中兩個(Sean 拍板合併)
CREATE FUNCTION public.pcm_manual_refund_rail_cap(p_order_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT COALESCE(
           (SELECT SUM(p.amount)
              FROM public.order_payments p
             WHERE p.order_id = p_order_id
               AND p.rail IN ('bank_transfer', 'cash')), 0)::bigint
       - COALESCE(
           (SELECT SUM(m.refund_amount)
              FROM public.order_manual_refunds m
             WHERE m.order_id = p_order_id
               AND m.voided_at IS NULL), 0)::bigint;
$fn$;

COMMENT ON FUNCTION public.pcm_manual_refund_rail_cap(uuid) IS
  '#866 人工退款上限:這張單在【現金 + 匯款】兩軌上的淨實收,減掉已登記且未作廢的人工退款。'
  '收款側直接加總(沖銷列帶負值,不過濾不 ABS,口徑同 20260815010000:18-20);'
  '兩段皆 COALESCE(...,0) —— 零列時 SUM 回 NULL,而 NULL 會讓呼叫端的 > 比較靜靜放行;'
  '扣除側只算 voided_at IS NULL(作廢要把額度還回來,同 20260820100000:261)。'
  '🔴 它與 pcm_order_refundable_remaining 是【兩道並存】的上限,不是取代:'
  '後者分母是訂單總額、給卡退用;本函式管的是「不得退一筆從來沒收過的錢」。'
  '⚠️ 本函式【零呼叫端】直到 #866 片 2/2 接上它。';

-- ══ 2. 權限(🔴 動 GRANT ⇒ 鐵則 12②)══════════════════════════════════
-- ⚠️ 讀 `docs/patterns/revoking-function-execute-in-supabase.md`:
--    **新物件出生就自帶 PUBLIC/anon 的 EXECUTE**,而 repo 內零 GRANT 字面可掃、三綠不紅。
-- ⇒ 先 REVOKE 乾淨,再只開給 service_role(形狀對齊 `20260822120000` D3-c)。
REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.pcm_manual_refund_rail_cap(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pcm_manual_refund_rail_cap(uuid) TO service_role;

-- ══ 3. 後置斷言(同一交易內;任何一道不過 ⇒ 整筆 ROLLBACK)═══════════════
-- 🔴 形狀照 `20260822120000`(D3-c 有 A1-A4 四道);**走 aclexplode 不靠 has_*_privilege 反推**
--    —— 那組函式對欄級授權會少報(memory `MEMORY-supabase`)。
DO $post$
DECLARE
  -- 🔴 新物件收權斷言的【清單】(`scripts/migration-new-file-static-checks.sh` ③ 要它可被數)。
  --    **它防的不是「忘記收權」,是「忘記列」** —— 下面那個迴圈只檢查你列出來的物件。
  --    ⚠️ **2026-08-24 這一格【當場擋下了本檔】**:REVOKE 我寫了 5 行、A1-A3 也寫了,
  --       而這份清單是空的 ⇒ 閘印「可授權物件 1 個,斷言清單列了 0 個」。
  --       📌 差別是實質的:`REVOKE` 是**我做的動作**;這份清單是**下一個加新物件的人會撞到的東西**。
  --       A1-A3 護的是「這一支函式」,清單護的是「這個檔日後多出來的每一支」。
  --    🔴 簽章逐字從本檔 `:117` 的 `CREATE FUNCTION` 抄 —— `to_regprocedure` 對參數型別逐字比對,
  --       打錯會**回 NULL(找不到)**,而下面第一道 IF 就是為了讓那件事 fail-loud、不靜默通過。
  --    🔴 結尾的 `::text[]` 不能拿掉(清單清空時 `ARRAY[]` 無法推斷型別)。
  v_relations text[] := ARRAY[]::text[];
  v_functions text[] := ARRAY[
    'public.pcm_manual_refund_rail_cap(uuid)'
  ]::text[];
  v_acl   text;
  v_n     int;
  v_probe bigint;
  v_probe_id uuid;
  v_fn    oid;
  r       text;
BEGIN
  -- A0 清單迴圈:每一支都要 存在 + anon/authenticated 零 EXECUTE + service_role 有
  --    ⚠️ **與 A1-A3 對本函式是重疊的,而那是刻意的**:A1-A3 是手寫的三格、綁死這一支;
  --       本迴圈吃的是**清單**,日後這個檔多建一支函式而忘了加斷言時,閘會先在靜態層擋下來。
  FOREACH r IN ARRAY v_functions LOOP
    v_fn := pg_catalog.to_regprocedure(r);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION '#866 A0 失敗:找不到函式 %(簽名打錯或沒建成)⇒ 拒繼續', r;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#866 A0 失敗:% 對 anon/authenticated 開著 EXECUTE(三道 REVOKE 少了一道?)', r;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
      RAISE EXCEPTION '#866 A0 失敗:% 對 service_role 沒有 EXECUTE(收太多)⇒ 片 2 會被 42501 擋掉', r;
    END IF;
  END LOOP;

  -- A1 service_role 真的拿到 EXECUTE
  IF NOT has_function_privilege('service_role',
        'public.pcm_manual_refund_rail_cap(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '#866 A1 失敗:service_role 沒有 EXECUTE ⇒ 片 2/2 會在執行期被 42501 擋掉';
  END IF;

  -- A2 PUBLIC 與 anon 各 0 筆(走 aclexplode,不用 has_*_privilege 反推)
  SELECT count(*) INTO v_n
    FROM pg_proc p, aclexplode(p.proacl) a
   WHERE p.oid = 'public.pcm_manual_refund_rail_cap(uuid)'::regprocedure
     AND (a.grantee = 0 OR a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'anon'));
  IF v_n <> 0 THEN
    RAISE EXCEPTION '#866 A2 失敗:PUBLIC/anon 仍有 % 筆授權(預期 0)', v_n;
  END IF;

  -- A3 對照組:authenticated 必須回 false(否則判量具壞掉,不是判它安全)
  IF has_function_privilege('authenticated',
        'public.pcm_manual_refund_rail_cap(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION '#866 A3 失敗:authenticated 竟然有 EXECUTE ⇒ REVOKE 沒生效';
  END IF;

  -- A4 🔴 **零列的單要回 0,不是 NULL** —— 這是本片最容易靜默壞掉的一格。
  --    ⚠️ ~~原本用全零 uuid,說它「保證不存在」~~ —— **那句話沒有依據**(2026-08-24 codex nit):
  --    正式庫若真有那筆訂單,A4 會拿到非 0 而**誤爆 apply**。
  --    ⇒ 改用 `gen_random_uuid()`:它不是「保證」不存在,而是**碰撞機率可忽略**,
  --      而且**下面那道 EXISTS 把它從機率變成事實** —— 兩段都零列才往下走。
  SELECT gen_random_uuid() INTO v_probe_id;
  IF EXISTS (SELECT 1 FROM public.order_payments       WHERE order_id = v_probe_id)
     OR EXISTS (SELECT 1 FROM public.order_manual_refunds WHERE order_id = v_probe_id) THEN
    RAISE EXCEPTION '#866 A4:隨機探針 uuid 竟然有資料列 ⇒ 本格不算數,重跑一次';
  END IF;
  SELECT public.pcm_manual_refund_rail_cap(v_probe_id) INTO v_probe;
  IF v_probe IS NULL THEN
    RAISE EXCEPTION '#866 A4 失敗:零列的單回 NULL 而不是 0 ⇒ 呼叫端的 > 比較會【靜靜放行】';
  END IF;
  IF v_probe <> 0 THEN
    RAISE EXCEPTION '#866 A4 失敗:零列的單回 %(預期 0)', v_probe;
  END IF;

  -- ══ 🔴🔴 A5 / A6 **撤回** —— 而撤回的理由要留著,它是本檔最貴的一課 ══════
  -- 第一版我在這裡塞測試列、量、再故意 RAISE 讓 plpgsql 子區塊回滾,宣稱「零留痕」。
  -- 那個機制**本身成立**(`BEGIN…EXCEPTION` 是 subtransaction),而它**在正式庫一定會炸**:
  --   ① `order_payments.order_id` / `order_manual_refunds.order_id` 都 `REFERENCES orders(id)`
  --      ⇒ 我捏的 `00000866-…` 訂單**不存在** ⇒ FK 當場拒絕
  --   ② `order_payments.actor` `REFERENCES staff(id)` ⇒ 同上,再一個 FK
  --   ③ `CHECK ((reverses_payment_id IS NULL AND amount > 0) OR (reverses_payment_id IS NOT NULL AND amount <> 0))`
  --      ⇒ 我那筆 `cash, -1000` 的沖銷列**必須指向一筆真的收款**,不能憑空存在
  --      (更別說 rail 別的欄位 CHECK:`bank_transfer` 要 `bank_reference` + `request_id`…)
  --
  -- 🔴 **而本機測試全綠** —— 因為那套拋棄式 schema 是我自己寫的簡化版,**沒有那些 FK 與 CHECK**。
  --    ⇒ 這正是 `docs/runbooks/throwaway-postgres-for-migration-verification.md` 那句
  --      「**本機通過 ≠ 正式庫通過**」的實例,而它咬的是寫那份 plan 時親手寫下這句話的人。
  --    📌 形狀:**我自己造的替身,只會照我理解的樣子回答我。**
  --       替身沒有的約束,不會在替身上出聲 —— 而那正是它與真東西差最多的地方。
  --
  -- ⇒ **處置:需要捏資料才驗得了的行為斷言,不放進 migration。**
  --    算式那兩個口徑(rail 篩選 / voided_at)改由**可重跑的 harness** 驗:
  --      `bash scripts/866-rail-cap-verify.sh`
  --    它起拋棄式 PG、跑 7 條驗收值 + 4 發突變,而**突變會證明那兩個口徑真的承重**。
  -- ⚠️ **代價照實寫**:本 migration 自帶的斷言(A1-A4)只涵蓋**權限**與**零列回 0**,
  --    **不涵蓋算式對不對** —— 那一半的證人在 harness 裡,不在這支檔裡。
  --    ⇒ 改動這支函式的人:**改完要跑那支 harness**,三綠不會替你紅。

  SELECT array_to_string(p.proacl, ',') INTO v_acl
    FROM pg_proc p
   WHERE p.oid = 'public.pcm_manual_refund_rail_cap(uuid)'::regprocedure;
  RAISE NOTICE '#866 A1-A4 全過。proacl = %(算式口徑的證人在 scripts/866-rail-cap-verify.sh)', v_acl;
END
$post$;

-- ══ 4. 回退法(⚠️ 未驗:本 repo 慣例 down-migration 不會被跑過)═══════════
-- DROP FUNCTION IF EXISTS public.pcm_manual_refund_rail_cap(uuid);
-- 🔴 而回退前要先確認**沒有呼叫端** —— 片 2/2 接上之後,直接 DROP 會讓那支 RPC 執行期炸。
--    量法:`grep -rn "pcm_manual_refund_rail_cap" supabase/migrations apps packages | grep -v node_modules`
