-- 20260906800000_m4b_wallet_adjust_idempotency.sql
-- ⟦b4-WALLETDEDUPE⟧ 儲值金重送重複入帳去重(M-4b;線【帳號】`account` 2026-09-06)
--
-- ══ 病灶(派工包逐字, 我開檔複驗過)═══════════════════════════════════════════
-- 「員工扣 500, DB 已提交但回應遺失, 同一操作再送 ⇒ 扣 1000;`FOR UPDATE` 只排順序
--   不辨認同一次業務操作, 前端 pending disable 擋不到提交成功後的重送。」
--   `20260716210000:113` 的 `FOR UPDATE` 只讓兩發**排隊**, 排完 `:124` **兩發都插**;
--   而 `customer_wallet_ledger` 上除 pkey 外**零 UNIQUE**。
--
-- ══ 🔴 為什麼不是照 backlog `#279` 那個解法做 ═══════════════════════════════
-- `#279` 說「加 `request_id` 欄 + partial UNIQUE + RPC 收 `p_request_id`」。**那擋不到它要擋的情境。**
-- `p_request_id` 原本吃的是 `getRequestId()`(`apps/admin/src/lib/audit/context.ts:17-20`),
-- 讀的是 middleware **每個 HTTP request** 新產的 `x-request-id`(`apps/admin/src/proxy.ts:36`)
-- ⇒ **back-resubmit = 新請求 = 新 id ⇒ 唯一索引不會撞 ⇒ 照樣扣兩次。**
-- ⇒ 📌 那個解法會**看起來做完了**(migration 貼了、索引建了、三綠全綠)**而病還在**。
--
-- ══ ✅ 做法照 repo 既有先例, 不自己發明 ═════════════════════════════════════
-- `apps/admin/src/proxy.ts:28-34` 逐字記著:`order_note.append` 的冪等鍵**就是 `p_request_id`**,
-- 吃的是**表單帶回的一次性 token**, token 由 **server 在渲染表單時**產(不是瀏覽器自造)。
-- 設計 `docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §4;拍板該檔 §9 `Q2=C`(Sean 2026-08-02)。
-- 本片沿用同一個拍板(主視窗 `-f1` 2026-09-06 `Q-wallet4=甲`)。
-- 🛑 **繼承的誠實代價**:冪等鍵改吃表單值 = **持 session 者可自選/重複那個稽核關聯值**,
--    推翻 `proxy.ts:22-25` 的「一律 server 新產」。**殘餘防線 = 本片的「同鍵而內容不符 ⇒ RAISE」。**
--
-- ══ 🔴🔴 `SET search_path` 這一格會咬人 ══════════════════════════════════════
-- ⛔ 來源檔 `20260716210000:48` 逐字寫的是 `SET search_path = public, pg_temp`,
--    **而正式庫現值是空字串** —— `20260905110000:171` 用動態
--    `EXECUTE format('ALTER FUNCTION public.%s SET search_path = %L', r.sig, '')` 收緊過。
-- 🛑 **`CREATE OR REPLACE` 會把 SET 子句整組換掉** ⇒ 照抄來源檔 = **把那道安全強化打回去**,
--    **而 body md5 完全相同 ⇒ 任何只比 `prosrc` 的錨都會【印綠】。**
-- ⇒ ✅ 本檔顯式寫 `SET search_path = ''`, 並把 `proconfig` 放進前置閘與事後斷言各一格。
-- 📌 工具射程:`scripts/latest-definition-of.sh` 數的是 **body 定義點**, `ALTER FUNCTION` 不進它的分母
--    ⇒ 它回「1 代」不等於「沒被改過」(memory `reference_latest-definition-of-counts-body-not-last-toucher`)。
--
-- ══ 唯讀性 ════════════════════════════════════════════════════════════════
-- 本片動到:① `ALTER TABLE … ADD COLUMN`(nullable, 既有列不動)② 一個 partial UNIQUE index
-- ③ `CREATE OR REPLACE` 一支函式 ④ 一段 `COMMENT ON FUNCTION` ⑤ 前置閘與事後斷言的 catalog 查詢。
-- 🟢 **零資料列 DML** —— 不 UPDATE、不 DELETE、不 INSERT 任何一列業務資料。
--
-- 還原:`docs/specs/2026-09-06-wallet-idempotency-ROLLBACK.sql`(🛑 第 0 步是【先停掉調整入口】)
-- 對帳:`supabase/after-checks/20260906800000-wallet-idempotency-reconcile.sql`
-- plan :`docs/plans/2026-09-06-wallet-resubmit-idempotency-plan.md`

BEGIN;
-- 🔴 事故中要能【及時失敗】, 不能無限等鎖。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ══ 0. 前置閘(任一不成立 ⇒ 整筆拒 COMMIT)══
DO $pre$
DECLARE
  v_n   integer;
  v_oid oid;
  v_cfg text[];
BEGIN
  -- ① 同名多載必須恰好一支(多載時「我要換哪一支」機械上答不出來)
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘①:public.admin_adjust_wallet 有 % 支同名函式(期望 1)⇒ 拒繼續。', v_n;
  END IF;

  SELECT p.oid, p.proconfig INTO v_oid, v_cfg
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';

  -- ② 簽章要是我抄的那一組(參數列變了 ⇒ CREATE OR REPLACE 會新增多載而不是換掉它)
  IF pg_catalog.pg_get_function_arguments(v_oid)
     <> 'p_customer_user_id uuid, p_entry_type text, p_amount integer, p_note text, p_actor text, p_request_id text' THEN
    RAISE EXCEPTION '前置閘②:參數列不是預期那一組, 實得「%」⇒ 這一貼會新增多載, 拒繼續。',
      pg_catalog.pg_get_function_arguments(v_oid);
  END IF;

  -- ③ body md5 錨:證明線上跑的就是我抄的那一版
  IF pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid))
     <> 'ad55861bb449dfc98ae6630dceea546f' THEN
    RAISE EXCEPTION '前置閘③:body md5 = %(期望 ad55861bb449dfc98ae6630dceea546f)⇒ 線上不是我抄的那一版, 拒繼續。',
      pg_catalog.md5((SELECT prosrc FROM pg_catalog.pg_proc WHERE oid = v_oid));
  END IF;

  -- 🔴 ③b **`proconfig` 錨**(這一格是本片最容易被略過而最貴的一格):
  --    body md5 對 ≠ 這支函式沒被改過。`search_path` 就住在 body 之外。
  IF v_cfg IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '前置閘③b:proconfig = %(期望 {"search_path=\"\""})⇒ 線上的 search_path 不是我以為的那個, 拒繼續。',
      coalesce(v_cfg::text, '(NULL)');
  END IF;

  -- ④ SECURITY DEFINER 還在
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '前置閘④:不是 SECURITY DEFINER 了 ⇒ 拒繼續。';
  END IF;

  -- ⑤ ACL 白名單:owner 以外只准 service_role, 且不得可轉授
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p
   CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid
     AND a.grantee <> p.proowner
     AND (a.is_grantable OR a.grantee = 0 OR pg_catalog.pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '前置閘⑤:有 % 筆沒預期的授權(PUBLIC / 可轉授 / 非 service_role)⇒ 本片的新副作用會跟著暴露, 拒繼續。', v_n;
  END IF;
  -- 🟢 正對照:service_role **叫得動**(否則這一格恆綠);anon **叫不動**
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘⑤b(正對照):service_role 對它沒有有效 EXECUTE ⇒ 白名單本身是錯的。';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '前置閘⑤c:anon 叫得動這支 ⇒ 拒繼續。';
  END IF;

  -- ⑥ 目標表與 trigger 還在(餘額是 trigger 算的;它不在了本片的語意就不成立)
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public'
       AND c.relname = 'customer_wallet_ledger' AND t.tgname = 'on_wallet_ledger_inserted'
  ) THEN
    RAISE EXCEPTION '前置閘⑥:on_wallet_ledger_inserted trigger 不在 ⇒ 餘額不會被算, 拒繼續。';
  END IF;

  -- ⑦ 🔵 **重貼的防線是上面③那個 body md5 錨**, 不是這裡 ——
  --    貼過一次之後 md5 就不是 `ad55861b…` 了 ⇒ 第二貼會**紅在前置閘③**。
  --    ⛔ ~~原本這行寫「見下面的 IF NOT EXISTS」~~ —— 那個東西**刻意不存在**
  --      (`scripts/migration-static-checks.sh` ① 擋, 而它擋得對:那會讓重貼安靜地成功)。
  RAISE NOTICE '前置閘全過:admin_adjust_wallet 是預期那一版(body + proconfig + ACL), trigger 在。';
END
$pre$;

-- ══ 1. 加欄 + partial UNIQUE ══
-- 🔴 **不用 `IF NOT EXISTS`**(`scripts/migration-static-checks.sh` ① 擋, 而它擋得對):
--    那個寫法會讓**重貼安靜地什麼都不做** ⇒ 印一個「成功」而其實沒有做事。
--    ⇒ 📌 重貼的防線是**前置閘③的 body md5 錨** —— 貼過一次之後 md5 就不是
--       `ad55861b…` 了 ⇒ 第二貼會**紅在前置閘**, 那是看得見的失敗, 不是安靜的成功。
ALTER TABLE public.customer_wallet_ledger ADD COLUMN request_id text;

-- 🔴 **partial** 是刻意的:`WHERE request_id IS NOT NULL` —— 而**理由要寫對**:
--    ⛔ ~~「partial ⇒ 既有列不受影響」~~ **因果是錯的**(2026-09-06 鑽機當場證偽):
--      保護既有列(NULL 鍵)的是 **Postgres 唯一索引預設 `NULLS DISTINCT`** —— 每個 NULL 互不相等
--      ⇒ **就算換成全表 UNIQUE, 多筆 NULL 鍵一樣插得進去。**
--    ✅ partial 真正在做的是**大小與意圖**:NULL 鍵的舊列不進索引;
--      並在 `indexdef` 上寫明「這道唯一性只管**有鍵**的列」。
--    🛑 而**真正扛事的是「這個唯一索引存在」** —— 鑽機的突變①(把索引整個拿掉)
--      會讓 RPC **執行期**炸;而 partial 拿掉、換成全表 UNIQUE, 去重照樣成立。
CREATE UNIQUE INDEX customer_wallet_ledger_idempotency_uidx
  ON public.customer_wallet_ledger (customer_user_id, request_id)
  WHERE request_id IS NOT NULL;

COMMENT ON COLUMN public.customer_wallet_ledger.request_id IS
  '⟦b4-WALLETDEDUPE⟧ 2026-09-06 冪等鍵:後台人工調整走 admin_adjust_wallet 時, 由**表單帶回的一次性 token**(server 渲染時產、uuid v4)。🔴 nullable 是**為了既有列**, 不是為了新呼叫 —— 新版 RPC 拒收 NULL / 空字串 / 非 uuid。唯一性由 partial UNIQUE `customer_wallet_ledger_idempotency_uidx`(WHERE request_id IS NOT NULL)守。🛑 本欄**不涵蓋** service_role 直插 ledger 那條路(backlog #280)。⚠️ **這個鍵沒有 TTL** —— 它永久留在這一列上, 而唯一索引也永久擋著同一把鍵。⇒ 📌 好處是「一年後同一把鍵重播也不會重複入帳」;代價是**索引只會長不會縮**, 且**沒有任何機制回收舊鍵**。若日後要清, 那是一次獨立的決策(要先回答「多久之前的重送不必再擋」), 不得順手 DELETE。';

-- ══ 2. 換函式 ══
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
  -- ⟦b4-WALLETDEDUPE⟧ 2026-09-06
  v_inserted       integer;   -- ON CONFLICT DO NOTHING 之後實際插了幾列(0 = 撞到同鍵)
  v_prior          public.customer_wallet_ledger%ROWTYPE;   -- 撞到時, 前一次那一列
BEGIN
  -- 1a. server 供參數 fail-closed(actor 由 server session 解析、非 client;缺=拒,不以未知身分寫稽核)。
  IF p_actor IS NULL OR pg_catalog.btrim(p_actor, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 actor';
  END IF;
  IF p_request_id IS NULL OR pg_catalog.btrim(p_request_id, v_ws) = '' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: 缺 request_id';
  END IF;
  -- 🔴 ⟦b4-WALLETDEDUPE⟧:`p_request_id` 從「稽核關聯值」升格成**冪等鍵** ⇒ 形狀要收緊成 uuid。
  -- 🛑 **為什麼不能只驗「非空」**:非空的隨機字串每次都不同 ⇒ 唯一索引永遠不會撞
  --    ⇒ 去重**靜默失效**, 而 migration 貼了、索引建了、三綠全綠。fail-closed 在這裡。
  -- 🔵 呼叫端形狀同一道:`apps/admin/src/lib/customers/wallet-form.ts` 的 UUID_RE。
  IF p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_adjust_wallet: request_id 形狀不是 uuid';
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
  INSERT INTO public.customer_wallet_ledger (customer_user_id, entry_type, amount, note, request_id)
  VALUES (p_customer_user_id, v_entry_type, p_amount, v_note, p_request_id)
  -- 🔴 **必須指定衝突目標**(codex 審 plan #13):裸 `ON CONFLICT DO NOTHING` 會把**別的**
  --    唯一衝突也一起吞掉 ⇒ 那時它會回一個看起來很正常的 'DUPLICATE', 而真相是另一個錯。
  -- 🔴🔴 **`WHERE request_id IS NOT NULL` 不能省** —— 鑽機當場抓到的真 bug:
  --    **partial 唯一索引要當 ON CONFLICT 的仲裁者, 衝突目標必須帶上【相符的 predicate】**,
  --    否則執行期報 `there is no unique or exclusion constraint matching the ON CONFLICT specification`。
  --    🛑 它是**執行期**才炸的 —— `CREATE OR REPLACE` 當下不紅、三綠不紅、前置閘與事後斷言也不紅。
  --    ⇒ 📌 **只有真的呼叫一次 RPC 才問得出來**(codex 審 plan 也沒抓到這條)。
  -- 🔴 **而這一行我修過兩次** —— 第一次修在【產生出來的 migration】上, 而不是這支產生器,
  --    下一次重新產生就把它**靜默還原**了(鑽機第二次抓到同一個錯)。
  --    ⇒ 📌 **修產物不修產生器 = 那個修法有一個看不見的到期日。**
  ON CONFLICT (customer_user_id, request_id) WHERE request_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    -- 🔴 **`ROW_COUNT = 0` 只證明「沒插入」, 不證明「同一筆已經完成」**(codex 審 plan #13)
    --    ⇒ 一定要把前一次那一列撈出來**逐欄比對**, 相符才算重送。
    SELECT * INTO v_prior
      FROM public.customer_wallet_ledger
     WHERE customer_user_id = p_customer_user_id
       AND request_id = p_request_id;
    IF NOT FOUND THEN
      -- 撞了唯一索引卻找不到那一列 = 我不知道發生什麼事 ⇒ fail-closed, 不要猜。
      RAISE EXCEPTION 'admin_adjust_wallet: 冪等鍵撞了而讀不到前一列';
    END IF;
    -- 🛑 **同一把鑰匙被拿去開別的門** —— 例如員工按上一頁、把金額改成 600 再送:
    --    token 相同而內容不同。這時**回 DUPLICATE 是錯的**(會讓他以為「已經處理過了」,
    --    而他這一次要做的那件事**根本沒有執行**)⇒ 一律 RAISE, 讓他看到不對勁。
    IF v_prior.entry_type IS DISTINCT FROM v_entry_type
       OR v_prior.amount   IS DISTINCT FROM p_amount
       OR v_prior.note     IS DISTINCT FROM v_note THEN
      -- 🔴 **帶專屬 ERRCODE**:呼叫端要分得出「這是內容不符」與「這是一般 DB 錯誤」——
      --    那兩者要讓員工做**相反**的動作(一個是停下來, 一個是放心再按一次)。
      --    ⇒ 📌 **不要讓 app 去比對訊息字串** —— 訊息會被改、會被翻譯, 而 SQLSTATE 不會。
      RAISE EXCEPTION 'admin_adjust_wallet: 同一個 request_id 帶著不同內容'
        USING ERRCODE = 'P9W01';
    END IF;
    -- 🔵 真的是重送 ⇒ **提前 RETURN**:不重複入帳、也不再寫一列稽核
    --    (這一發沒有改變任何東西;而「員工按了第二次」由 app 端的 attempt log 記著)。
    RETURN 'DUPLICATE';
  END IF;

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
COMMENT ON FUNCTION public.admin_adjust_wallet(uuid, text, integer, text, text, text) IS
  'M-4a 客戶線儲值金編輯(加值 deposit>0 / 扣款 use<0;refund 拒收)。SECURITY DEFINER owner RPC;備註必填、單筆上限 1,000 萬、允許扣成負餘額(07-16 拍板)。鎖列讀 before → INSERT customer_wallet_ledger(餘額只走 on_wallet_ledger_inserted trigger、函式體零 UPDATE customers)→ 重讀 after → 同交易寫 admin_audit_log。回 ADJUSTED/NOT_FOUND。EXECUTE 僅 service_role。'
  '🔴 **2026-09-06 ⟦b4-WALLETDEDUPE⟧ 新增**:`p_request_id` 從「稽核關聯值」升格成**冪等鍵** —— 形狀收緊成 uuid(非 uuid 一律 RAISE), 一併寫進 `customer_wallet_ledger.request_id`, 由 partial UNIQUE `(customer_user_id, request_id) WHERE request_id IS NOT NULL` 守。撞到同鍵時**逐欄比對**前一列(entry_type / amount / note):相符 ⇒ 提前 `RETURN ''DUPLICATE''`(不重複入帳、也不再寫一列稽核);**不符 ⇒ RAISE**(同一把鑰匙被拿去開別的門, 回 DUPLICATE 會讓員工以為做過了而其實沒有)。該 RAISE 帶專屬 SQLSTATE **P9W01**, 讓呼叫端分得出它與一般 DB 錯誤(兩者要讓員工做**相反**的動作)。呼叫端送的是**表單帶回的一次性 token**(server 渲染表單時產), 不是 HTTP `x-request-id` —— 後者每個請求都不同, 拿它當鑰匙等於沒有去重。形狀與拍板照 A6:`docs/specs/2026-08-02-e10-a9d2-1-note-action-plan.md` §4 / §9 Q2=C。⚠️ 誠實代價:冪等鍵吃表單值 ⇒ 持 session 者可自選/重複稽核關聯值, 殘餘防線就是上面那道「內容不符即 RAISE」。⚠️ 本函式**不涵蓋** service_role 直插 ledger(backlog #280)。';

-- ══ 3. 事後斷言(不成立 ⇒ 整筆回滾)══
DO $post$
DECLARE
  v_oid oid;
  v_def text;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet';

  -- ① 還是恰好一支(證明我換掉了它, 沒有新增一支多載)
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'admin_adjust_wallet') <> 1 THEN
    RAISE EXCEPTION '事後①:換完之後同名函式不只一支 ⇒ 我新增了多載。';
  END IF;

  -- 🔴 ② `proconfig` 仍是空字串 —— **這一格是為了擋我自己**:
  --    來源檔寫的是 `public, pg_temp`, 照抄就會把安全強化打回去, 而 body md5 一模一樣。
  IF (SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_oid) IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION '事後②:proconfig = %(期望 {"search_path=\"\""})⇒ 我把 search_path 打回去了。',
      coalesce((SELECT proconfig FROM pg_catalog.pg_proc WHERE oid = v_oid)::text, '(NULL)');
  END IF;

  -- ③ 還是 SECURITY DEFINER、ACL 沒被 CREATE OR REPLACE 洗掉
  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
    RAISE EXCEPTION '事後③:不是 SECURITY DEFINER 了。';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後③b:service_role 叫不動它了。';
  END IF;
  IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION '事後③c:anon 叫得動它了。';
  END IF;

  -- 🔴 ④ 索引**真的是 partial** —— 逐字比對 `indexdef`。
  --    🛑 只驗「多筆 NULL 插得進去」是**免費的綠**:拔掉整個 UNIQUE 也會通過那種驗法。
  SELECT indexdef INTO v_def FROM pg_catalog.pg_indexes
   WHERE schemaname = 'public' AND tablename = 'customer_wallet_ledger'
     AND indexname = 'customer_wallet_ledger_idempotency_uidx';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '事後④:找不到 customer_wallet_ledger_idempotency_uidx。';
  END IF;
  IF pg_catalog.strpos(v_def, 'UNIQUE INDEX') = 0
     OR pg_catalog.strpos(v_def, 'WHERE (request_id IS NOT NULL)') = 0 THEN
    RAISE EXCEPTION '事後④:索引定義不是「UNIQUE + partial」⇒ 實得 %', v_def;
  END IF;

  -- ⑤ 欄位在, 而且是 nullable(既有列不能被逼著填)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'customer_wallet_ledger'
       AND column_name = 'request_id' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION '事後⑤:request_id 欄不在, 或不是 nullable。';
  END IF;

  RAISE NOTICE '事後斷言全過:函式換好(proconfig/ACL/SECDEF 都還在)、partial UNIQUE 在、欄位是 nullable。';
END
$post$;

COMMIT;
