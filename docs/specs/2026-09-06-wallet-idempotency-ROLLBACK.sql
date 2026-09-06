-- 2026-09-06-wallet-idempotency-ROLLBACK.sql
-- ⟦b4-WALLETDEDUPE⟧ 的還原(災難用;把 `20260906800000` 退回貼之前那個世界)
--
-- ══ 🛑🛑 第 0 步不是跑這支檔 ═══════════════════════════════════════════════
-- **先把後台的儲值金調整入口停掉**(那顆「加值 / 扣款」鈕), 並處理完在途請求, 再跑本檔。
-- 🔴 **為什麼這一片沒有「換回舊函式就是止血」這件事**(它與 supersede 那片性質不同):
--    本檔會 `DROP COLUMN request_id` ⇒ **已經寫進去的冪等鍵【全部消失】**。
--    ⇒ 那些鍵是「這一筆做過了」的**唯一證據**。刪掉之後:
--      · 舊的 POST 被重播 / 員工重按 ⇒ 找不到證據 ⇒ **再扣一次**
--      · 之後若又把新版貼回去, 同一把鍵也認不出來了
--    ⇒ 📌 **所以順序是:先關門 → 確認沒有在途 → 才動 DB。** 反過來會在還原的當下開一個窗口。
--
-- ══ 怎麼跑 ════════════════════════════════════════════════════════════════
-- `bash scripts/readonly-prod-sql.sh` **不能用**(那條路只有唯讀授權)。
-- 這支要由**有 apply 授權的人**貼,而 Sean 說「貼 <號碼>」才算授權。
--
-- ══ 前置閘擋住你的時候 ════════════════════════════════════════════════════
-- ✅ **逃生口(照這個順序,一步都不能少)**:
-- ```
-- ROLLBACK;                          ← 🔴 上一發被擋下時交易已 aborted, 不先結束它, 下一句 SET 會失敗
-- SET pcm.rollback_force = '1';
-- ```
-- 🛑 **它只跳過 md5 / COMMENT 兩個內容錨** —— **簽章與多載數那兩格【不跳過】**,
--    因為那兩格代表「我不知道要換哪一支」, 硬蓋會換錯支。
-- 🔴 **已知殘留(與 `54r` 同一個, 不修, 明寫)**:`pcm.rollback_force` 是 **GUC**,
--    而 **GUC 的變更是交易性的**。本檔在前置閘【讀完當下】就清掉它 ⇒ 成功那條路乾淨;
--    而**中途撞 `lock_timeout` / `statement_timeout` ⇒ 整筆回滾 ⇒ 那個清除也被回滾, force 又回來**。
--    ⇒ ✅ 用完 force 之後**自己**跑一句
--      `SELECT pg_catalog.set_config('pcm.rollback_force','off',false);` 或**換一個連線**。
--
-- ══ 🔴🔴 這一片還原最容易寫錯的那一格 ═══════════════════════════════════════
-- ⛔ **不得「逐字抄 `20260716210000:37-148` 貼回去」** ——
--    那個檔面寫的是 `SET search_path = public, pg_temp`, 而**正式庫現值是空字串**
--    (`20260905110000:171` 收緊過)。`CREATE OR REPLACE` **會把 SET 子句整組換掉**
--    ⇒ 照抄 = **把那道安全強化打回去**, 而 **body md5 一模一樣 ⇒ 只比 `prosrc` 的錨會【印綠】**。
-- ✅ 本檔:抄 body、**自己寫 `SET search_path = ''`**, 並把 `proconfig` 放進事後斷言。
-- 📎 memory `reference_create-or-replace-resets-set-clause`

BEGIN;
-- 🔴 事故中要能【及時失敗】, 不能無限等鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $rbpre$
DECLARE
  v_force boolean;
  v_oid   oid;
  v_n     integer;
BEGIN
  v_force := coalesce(current_setting('pcm.rollback_force', true), '') = '1';
  -- 🔴 **讀完就立刻清掉**, 不要等結尾:結尾那一句在「中途撞 timeout」時跑不到。
  PERFORM pg_catalog.set_config('pcm.rollback_force', 'off', false);

  -- ① 同名多載數(force **不跳過**)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '還原前置閘①:public.admin_adjust_wallet 有 % 支同名函式(期望 1)⇒ 我不知道要換哪一支, 拒繼續(force 不跳過這一格)。', v_n;
  END IF;

  SELECT p.oid INTO v_oid
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';

  -- ② 簽章(force **不跳過**):參數列變了 ⇒ 這一貼會新增多載而不是換掉它
  IF pg_catalog.pg_get_function_arguments(v_oid)
     <> 'p_customer_user_id uuid, p_entry_type text, p_amount integer, p_note text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION '還原前置閘②:參數列不是預期那一組, 實得「%」⇒ 拒繼續(force 不跳過這一格)。',
      pg_catalog.pg_get_function_arguments(v_oid);
  END IF;

  -- ③ 內容錨:線上必須是**本片貼上去的那一版**(force 跳過這一格)
  IF v_force THEN
    RAISE WARNING '還原前置閘③:pcm.rollback_force=1 ⇒ **跳過 md5 / COMMENT 內容錨**。請確認你知道自己在換什麼。';
  ELSE
    IF pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid))
       <> 'ae2567393ca47e550ebe501644234d8a' THEN
      RAISE EXCEPTION '還原前置閘③:body md5 = %(期望本片的 ae2567393ca47e550ebe501644234d8a)⇒ 線上不是本片貼的那一版, 拒繼續。',
        pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid));
    END IF;
    IF pg_catalog.md5(coalesce(pg_catalog.obj_description(v_oid, 'pg_proc'), '(無)'))
       <> '2c3abd8cf084d7b5e08bc7cc97ce610f' THEN
      RAISE EXCEPTION '還原前置閘③b:COMMENT md5 不是本片貼的那一版 ⇒ 拒繼續。';
    END IF;
  END IF;

  -- ④ 🔴 **在途/存量提醒**:有多少列會因為 DROP COLUMN 而失去它的冪等鍵
  SELECT count(*) INTO v_n FROM public.customer_wallet_ledger WHERE request_id IS NOT NULL;
  RAISE WARNING '⚠️ 本次還原會 DROP COLUMN request_id ⇒ **% 列的冪等鍵將永久消失**。那些鍵是「這一筆做過了」的唯一證據 —— 確認調整入口已經關掉、沒有在途請求, 再讓這一筆 COMMIT。', v_n;
END
$rbpre$;

-- ══ 1. 換回舊函式(body 逐字抄 20260716210000:50-147;而 SET 子句【自己寫】)══
CREATE OR REPLACE FUNCTION public.admin_adjust_wallet(
  p_customer_user_id uuid,
  p_entry_type       text,
  p_amount           integer,
  p_note             text,
  p_actor            text,
  p_request_id       text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴 **檔面原本是 `public, pg_temp`;這裡【刻意寫成空字串】**, 理由見檔頭。
SET search_path = ''
AS $$
DECLARE
  -- 空白字元集(codex 關卡2 F2):btrim 預設只吃 ASCII 空白;service_role 直呼可用全形空白/NBSP/
  -- 零寬字繞過「必填」→ 顯式列舉 Unicode 空白+零寬集,note/actor/request_id 三參數同套。
  -- ⚠️ PG E'' 不支援 \v(會變字面字母 v、btrim 誤刪備註首尾 v;codex round2 抓)→ 垂直 tab 用八進位 \013。
  v_ws constant text := E' \t\r\n\f\013'
    || U&'\00A0'  -- NBSP
    || U&'\2007'  -- figure space
    || U&'\202F'  -- narrow NBSP
    || U&'\3000'  -- 全形空白
    || U&'\200B'  -- zero-width space
    || U&'\FEFF'; -- BOM/zero-width no-break
  v_entry_type     public.wallet_entry_type;
  v_note           text;
  v_before_balance integer;
  v_before_total   integer;
  v_after_balance  integer;
  v_after_total    integer;
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 request_id';
  END IF;
  IF p_customer_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 customer_user_id';
  END IF;

  -- 1b. entry_type 白名單:僅 deposit / use('refund' 在 enum 內但本 RPC 拒收=UI 不開退款)。
  IF p_entry_type IS NULL OR p_entry_type NOT IN ('deposit', 'use') THEN
    RAISE EXCEPTION 'admin_adjust_wallet: entry_type 非 deposit/use';
  END IF;
  v_entry_type := p_entry_type::public.wallet_entry_type; -- enum cast(關卡1 note N2)

  -- 1c. 金額:符號一致(前置重述 wallet_amount_sign CHECK=縱深;deposit>0 / use<0,0 一律拒)
  --     + 單筆 sanity 上界 1,000 萬元(抓多零手滑、不擋真大額;D2 值班台建議維持,Sean 可改)。
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 amount';
  END IF;
  IF p_entry_type = 'deposit' AND p_amount <= 0 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 加值金額須為正整數';
  END IF;
  IF p_entry_type = 'use' AND p_amount >= 0 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 扣款金額須為負整數';
  END IF;
  IF pg_catalog.abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 金額超過單筆上限';
  END IF;

  -- 1d. 備註必填(Sean Q1=B):trim 非空、≤200 字、拒控制字元(對齊 invoice_number 紀律)。
  IF p_note IS NULL THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 note';
  END IF;
  v_note := pg_catalog.btrim(p_note, v_ws);
  IF v_note = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 備註必填';
  END IF;
  IF pg_catalog.char_length(v_note) > 200 OR v_note ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 備註非法';
  END IF;

  -- 1e. 鎖列 + before 快照(同客並發調整序列化;查無 → 固定碼、讓 UI 顯示不存在)。
  SELECT wallet_balance, total_deposit
    INTO v_before_balance, v_before_total
    FROM public.customers
   WHERE user_id = p_customer_user_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'NOT_FOUND';
  END IF;

  -- 1f. INSERT ledger(🔴 餘額由既有 AFTER INSERT trigger 同步;本函式體零 UPDATE customers=禁裸覆寫;
  --     entry_date/created_at 走 DEFAULT;related_order_id 留 NULL=人工調整無關聯單)。
  INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note)
  VALUES (p_customer_user_id, v_entry_type, p_amount, v_note);

  -- 1g. after 快照(鎖仍持有、trigger 已於 INSERT 語句內完成 → 重讀即調整後值)。
  SELECT wallet_balance, total_deposit
    INTO v_after_balance, v_after_total
    FROM public.customers
   WHERE user_id = p_customer_user_id;

  -- 1h. 同交易寫稽核(before/after=純狀態快照、鍵名對稱;操作參數可由差額+ledger 回查;reason=備註)。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (
    p_actor,
    'customer.wallet.adjust',
    'customer:' || p_customer_user_id::text,
    pg_catalog.jsonb_build_object('wallet_balance', v_before_balance, 'total_deposit', v_before_total),
    pg_catalog.jsonb_build_object('wallet_balance', v_after_balance,  'total_deposit', v_after_total),
    v_note,
    p_request_id,
    'admin'
  );

  RETURN 'ADJUSTED';
END;
$$;

-- ══ 2. COMMENT 也要換回(只還原 body 是不夠的)══
-- 🔴 本片的 forward 在 COMMENT 尾巴補了一整段(冪等鍵語意)。只換 body 而不換 COMMENT
--    ⇒ **catalog 上會繼續宣稱一個已經被移除的行為**, 而值班的人讀的正是那一段。
-- 🔵 下面整段逐字取自 20260716210000:150-151。
COMMENT ON FUNCTION public.admin_adjust_wallet(uuid, text, integer, text, text, text) IS
  'M-4a 客戶線儲值金編輯(加值 deposit>0 / 扣款 use<0;refund 拒收)。SECURITY DEFINER owner RPC;備註必填、單筆上限 1,000 萬、允許扣成負餘額(07-16 拍板)。鎖列讀 before → INSERT customer_wallet_ledger(餘額只走 on_wallet_ledger_inserted trigger、函式體零 UPDATE customers)→ 重讀 after → 同交易寫 admin_audit_log。回 ADJUSTED/NOT_FOUND。EXECUTE 僅 service_role。';

-- ══ 3. 拿掉索引與欄位 ══
-- 🛑 **順序**:先 DROP INDEX 再 DROP COLUMN(反過來 Postgres 也會連帶刪掉索引, 而顯式寫出來
--    是為了讓讀的人看得到「有兩個東西要消失」)。
DROP INDEX public.customer_wallet_ledger_idempotency_uidx;
ALTER TABLE public.customer_wallet_ledger DROP COLUMN request_id;

-- ══ 4. 事後斷言(不成立 ⇒ 整筆回滾)══
DO $rbpost$
DECLARE v_oid oid; v_n integer;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';

  -- ① 還是恰好一支(證明我換掉了它, 沒有新增多載)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '還原失敗①:同名函式有 % 支 ⇒ 這一貼新增了多載。', v_n;
  END IF;

  -- ② body 回到 20260716210000 那一版
  IF pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid))
     <> 'ad55861bb449dfc98ae6630dceea546f' THEN
    RAISE EXCEPTION '還原失敗②:body md5 = %(期望 ad55861bb449dfc98ae6630dceea546f)。',
      pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid));
  END IF;

  -- 🔴 ③ **`proconfig` 仍是空字串** —— 這一格是這份還原檔最重要的一格:
  --    ②那個 md5 對, **完全不代表**我沒有把 search_path 打回去。兩把尺在不同的軸上。
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_oid) IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '還原失敗③:proconfig = %(期望 {"search_path=\"\""})⇒ 我把 20260905110000 那道強化打回去了。',
      coalesce((SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_oid)::text, '(NULL)');
  END IF;

  -- ④ COMMENT 也回去了
  -- 🔴 **這個錨我一度量錯, 錯法值得留著**:第一次量的時候, 我的量測環境**沒有裝舊 COMMENT**
  --    ⇒ `coalesce(obj_description(…), '(無)')` 回的是佔位字 ⇒ 我把 `md5('(無)')`
  --      (逐字 `7cc781655c60486b4437b9568614a92a`)當成「舊的那一版」寫進來。
  --    ⇒ 📌 **一個代表「沒有」的值, 長得跟一個真讀數一模一樣。**
  --      照那個錨比 ⇒ 還原**成功**的時候反而紅。現值是裝了 COMMENT 之後量的。
  IF pg_catalog.md5(coalesce(pg_catalog.obj_description(v_oid, 'pg_proc'), '(無)'))
     <> 'c12448e69f8ac5b8a6fd2a8a3adb40a7' THEN
    RAISE EXCEPTION '還原失敗④:COMMENT md5 不是 20260716210000 那一版 ⇒ 我只還原了 body。';
  END IF;

  -- ⑤ SECURITY DEFINER 與 ACL 沒被洗掉
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '還原失敗⑤:不是 SECURITY DEFINER 了。';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原失敗⑤b:service_role 叫不動它了。';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '還原失敗⑤c:anon 叫得動它了。';
  END IF;

  -- ⑥ 索引與欄位真的不見了
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_indexes WHERE schemaname='public'
              AND tablename='customer_wallet_ledger' AND indexname='customer_wallet_ledger_idempotency_uidx') THEN
    RAISE EXCEPTION '還原失敗⑥:索引還在。';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
              AND table_name='customer_wallet_ledger' AND column_name='request_id') THEN
    RAISE EXCEPTION '還原失敗⑥b:request_id 欄還在。';
  END IF;

  RAISE NOTICE '[ROLLBACK] 已回到 20260716210000 那一版(body + COMMENT + proconfig + ACL), 索引與欄位已移除。';
END
$rbpost$;

-- 🔵 `pcm.rollback_force` 已在前置閘【讀完當下】就清掉了 —— 這裡不再重複,
--    留這段字是為了讓搜「rollback_force」的人知道它在哪裡被清的(以及檔頭那個已知殘留)。

COMMIT;
