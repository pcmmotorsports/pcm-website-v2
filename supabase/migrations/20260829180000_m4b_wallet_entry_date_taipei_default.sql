-- M-4b:儲值金流水 `entry_date` 的預設值改成【台北日界】
--
-- 🛑 **本檔【還沒有被 apply 過】** —— apply 是 Sean 的手(照本 repo 慣例:他自己在 SQL Editor 貼)。
--
-- 🔴🔴 **貼之前先讀這一句:本片改的是【未來】寫進去的列。**
--    **已經記錯的舊列, 這一支【一個字都不動】。**
--    ⇒ 貼完之後, 畫面上那些已經錯的日期**還在那裡**。
--    ⇒ 📌 沒有這句話, apply 完會以為修好了 —— 而**一個【部分正確】的答案比空答案危險。**
--    ⇒ 舊列要不要訂正是**另一題**(等那句盤點 SQL 的數字, Sean 拍)、**另一顆 commit**
--      (兩件事分兩顆, 否則 revert 會把兩個決定一起退掉)。
--
-- ✅ **Sean 要看到什麼才算這一片成功**:
--    貼完之後, **在台北凌晨 00:00-08:00 之間**由後台調整儲值金所產生的那一列,
--    它的日期會是**那天的台北日期**, 而不是前一天。
--    ⚠️ **而「00:00-08:00」這個時段是【資料庫 TimeZone = UTC 時】才成立的**(關卡2 nit)——
--       舊 DEFAULT 跟著 session TimeZone 走 ⇒ 時區不同, 會差的時段就不同。
--       ⇒ 準確的講法是:**新舊在【台北日期與資料庫時區日期不同】的那段時間會不一樣**;
--         而 Supabase 常態是 UTC ⇒ 在那個前提下就是 00:00-08:00。
--
-- ══ 這不是一個新決定 ══════════════════════════════════════════════════
--
-- `packages/use-cases/src/deposit-wallet.ts:23` 逐字:
--   「`entryDate` / `note` 由 use-case 內部產(**D2 Sean 拍**):
--    **`entryDate` = 台灣當日(D3、Asia/Taipei、非 UTC)**」
--
-- ⇒ 「這一欄要用台北日期」**Sean 已經拍過**, 而 `deposit-wallet.ts` 那條路照做了
--   (`taipeiToday()`,`Intl.DateTimeFormat` + `timeZone:'Asia/Taipei'`)。
-- 🔴 而本欄的 DEFAULT 是 `current_date` —— 它**跟著資料庫的 TimeZone 走**,
--    而 Supabase 常態是 **UTC** ⇒ **台北 00:00-08:00 寫的那一筆會記成前一天。**
-- ⇒ **本片是把碼改成符合他已經拍過的東西, 不是問他要不要。**
--
-- ⚠️ **而這一欄現在【活著的寫入端只有一個】**:
--    `20260716210000_m4a_admin_adjust_wallet_rpc.sql:124`, 而它的註解逐字寫著
--    「`entry_date`/`created_at` 走 DEFAULT」⇒ **改 DEFAULT 就等於改好那條路。**
--    (另一條 `depositWallet` use-case 算的是台北日、是對的, 而它**沒有呼叫端** ——
--     那不是漏接:客人自助儲值那扇門是 Sean 2026-08-26 拍「只顯示餘額和明細」刻意沒開的。)
--
-- 🔴 **為什麼不在那支 RPC 的 INSERT 裡再明寫一次**(主視窗 2026-08-29 裁乙):
--    同一個規則住在兩個地方 ⇒ **它們可以各自被改**。
--    ⇒ 讀 RPC 的人看不到日期從哪來這個顧慮是真的 ⇒ **用 COMMENT 補, 不用第二份實作補。**

BEGIN;

-- 🔴 **`ALTER TABLE` 要拿 ACCESS EXCLUSIVE 鎖**(關卡2 must-fix)——
--    撞上一個沒結束的交易會**無上限等下去**, 而它同時擋住這張表後續的所有存取。
--    ⇒ 設上限:寧可這一片失敗讓人重貼, 也不要把儲值金那張表卡住。
--    (家法:本 repo 86 支 migration 提過 `lock_timeout`。)
SET LOCAL lock_timeout = '5s';

-- 🔴🔴 **`clock_timestamp()` 不是 `now()`**(關卡2 must-fix)——
--    `now()` = **交易開始的時刻**。一個在台北午夜【前】開始、午夜【後】才 INSERT 的交易
--    ⇒ 它會寫成**前一天** ⇒ 那正是本片要修的那個病, 只是換一個成因。
--    ⚠️ 而 `current_date` 也有同樣的性質 ⇒ 所以這不是回歸, 是**順手把另一半也修掉**。
--    ✅ 家法:本 repo migration 用 `clock_timestamp()` **74 次**。
ALTER TABLE public.customer_wallet_ledger
  ALTER COLUMN entry_date SET DEFAULT (timezone('Asia/Taipei', clock_timestamp()))::date;

COMMENT ON COLUMN public.customer_wallet_ledger.entry_date IS
  '這一筆儲值金流水的【台灣日期】。'
  '🔴 預設值釘死 Asia/Taipei 日界(不是 current_date)——'
  'current_date 跟著資料庫 TimeZone 走(Supabase 常態 UTC)⇒ 台北 00:00-08:00 寫的會記成前一天。'
  '✅ 出處:Sean D2/D3 拍板, 逐字見 packages/use-cases/src/deposit-wallet.ts:23'
  '(「entryDate = 台灣當日(D3、Asia/Taipei、非 UTC)」)。'
  '⚠️ 寫入端若自己列了 entry_date, 這個預設值就不生效 —— 那時要自己保證是台北日。';

-- 🔴 fail-closed 斷言:**新的預設值真的裝上去了**, 而不是「我寫了 ALTER」。
--    ⚠️ 這裡刻意**不比對整個字串**(PG 會把運算式正規化, 字面比對會脆)
--       ⇒ 比「它有沒有提到 Asia/Taipei」與「它還有沒有裸的 current_date」兩件事。
DO $$
DECLARE
  v_def text;
  v_val date;
BEGIN
  SELECT pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    INTO v_def
    FROM pg_catalog.pg_attrdef d
    JOIN pg_catalog.pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.customer_wallet_ledger'::regclass
     AND a.attname = 'entry_date';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '儲值金日期 fail-closed:entry_date 沒有 DEFAULT ⇒ 這一片沒生效';
  END IF;
  IF v_def NOT LIKE '%Asia/Taipei%' THEN
    RAISE EXCEPTION '儲值金日期 fail-closed:DEFAULT 沒有釘住 Asia/Taipei ⇒ 現在是 %', v_def;
  END IF;
  -- 🔴 而「有 Asia/Taipei」不代表「沒有 current_date」—— 兩件事要分開問。
  IF v_def ~* '(^|[^_a-z])current_date([^_a-z]|$)' THEN
    RAISE EXCEPTION '儲值金日期 fail-closed:DEFAULT 裡還有裸的 current_date ⇒ %', v_def;
  END IF;

  -- 🔴🔴 **而上面三格【全部是在看字面】, 它們不是 fail-closed**(關卡2 must-fix):
  --    把 DEFAULT 寫成 `(timezone('Asia/Taipei', clock_timestamp()))::date + 1`
  --    ⇒ 有 `Asia/Taipei`、沒有 `current_date` ⇒ **三格全過, 而它把每一列都寫成明天。**
  --    📌 **一組「檢查字串長得對不對」的斷言, 對【算錯的正確字串】完全失明。**
  --    ⇒ 所以這一格**真的把那個運算式算出來**, 拿它跟台北今天比。
  EXECUTE 'SELECT ' || v_def INTO v_val;
  IF v_val IS DISTINCT FROM (timezone('Asia/Taipei', clock_timestamp()))::date THEN
    RAISE EXCEPTION
      '儲值金日期 fail-closed:DEFAULT 算出來是 %, 而台北今天是 % ⇒ 式子對不上(檢查有沒有多加減天數)',
      v_val, (timezone('Asia/Taipei', clock_timestamp()))::date;
  END IF;
  -- ⚠️ 射程:這一發若剛好跨過台北午夜那一瞬, 兩次取值會差一天 ⇒ 它會**紅**。
  --    那是 fail-closed 的方向(寧可誤擋), 重貼一次即可。
END $$;

COMMIT;
