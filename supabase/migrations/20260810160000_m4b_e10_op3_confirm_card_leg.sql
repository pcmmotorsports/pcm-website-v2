-- ══════════════════════════════════════════════════════════════════════════
-- OP3 · confirm_order_payment 擴充:付款確認**同交易**寫 card 腿
-- ══════════════════════════════════════════════════════════════════════════
-- 塊規格權威 = `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md` §5.3 項 1 逐字:
--   card 腿 = R14 拆兩個 writer ——①**常態 writer = 本片**(付款確認同交易 insert card 腿,
--   冪等鍵 `(order_id, rec_trade_id)` UNIQUE)②**backfill migration 只處理歷史資料 = OP4**
--   (OP1 檔頭逐字「回填在 OP4」)。⇒ **本片只做 ①,不碰任何歷史資料。**
-- 塊級 plan = `B-383-PLAN`(v1 骨架,主視窗已預核)+ `B-384-PLAN-v2`(actor 題改形狀)。
-- 拍板 = `MAIN-020-A`(Sean 拍 A′)+ 主視窗裁 owner 題 A(只斷言不 ALTER);
--        memory `project_op3-card-actor-system-identity`。
--
-- ── 🔴🔴 發布序(硬的,不是給讀者推的)────────────────────────────────────
-- **OP1 → OP2a → OP2b → 本片**,不得跳號。OP2b 之前 `order_payments_dormant_until_triggers`
-- (`CHECK (false)`)擋住本表**所有**寫入 ⇒ 本片若先上線,**每一筆付款確認都會撞 gate、
-- 整筆交易失敗、正式站刷卡全掛**。這不是理論:memory
-- `feedback_app-layer-must-not-ship-before-migration-apply`(08-07 正式站壞約 8 小時)同形狀。
-- ⇒ 本片**自己在 migration 裡斷言 gate 已不在**(前置閘 ②),不靠人記得順序。
--
-- 🔴🔴 **下游啟用停點(codex 關卡2 must-fix;發布序的另一端,本片自己擋不到)**:
--    本片只讓**自本片 apply 之後**的付款確認落 card 腿。**apply 之前就已經 paid 的歷史訂單
--    在 order_payments 裡沒有任何列**,而且**永遠不會補上** —— 同 rec 重試會走 A8c2 的 paid
--    冪等樹提前 RETURN(回 idempotent=true),根本到不了 INSERT。這是刻意的(重放不得落第二列),
--    不是缺陷;但它的後果要寫死在這裡:
--      **在 OP4 回填完成之前,任何以 `SUM(order_payments.amount)` 當「已收總額」的下游
--      (OP6 對帳、OP7 退款額公式、A8b partiallyPaid 上限)一律不得啟用** ——
--      那段期間該式對歷史訂單會**系統性低報**(算出 0),而低報的直接後果是**退款算多**。
--    ⚠️ 本片**沒有**任何守門擋得住這件事(migration 看不到誰在讀那張表)⇒ 它是流程停點,
--       不是機制;寫在這裡是因為 OP6/OP7 的規劃者會來讀本檔的檔頭。
--    ⇒ 正確順序:**OP3 → OP4(回填歷史)→ 才啟用 OP6/OP7 的金額計算**。
--
-- ── 🔴 基底版本(最容易踩的一條;A8c1 已被 R11 打回過一次)──────────────────
-- `confirm_order_payment` 的**最新定義 = A8c2 版**(`20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql`),
-- **不是** `20260611120000` 那支基底。照舊基底 `CREATE OR REPLACE` 會把 A8c2 的
-- **取消守門與隔離閘整段蓋掉** —— 已取消的單會重新變成可確認,那是錢的洞。
-- ⇒ 前置閘 ① 用 md5 釘死現定義;不符就停,不猜。
-- 🔴 釘值 `6423848f965176c8a0c02917b8be9f52` 是**實量**的:全新拋棄式 PG17 套完全部 migration
--    之後直接 `SELECT md5(pg_get_functiondef(…))`,不是讀 A8c2 檔案自己算。
--    另獨立驗過「最後定義者是 A8c2」:全 repo 只有兩支 migration 定義這支函式
--    (`grep -l "FUNCTION public.confirm_order_payment" supabase/migrations/*.sql`)。
--    誠實邊界(照抄 A8c2 的措辭):md5 pin = **同 PG17 內的漂移偵測**,不是可攜的語意證明;
--    不符 = 安全的 false-stop,不是「一定被人改過」。
--
-- ── 🔴🔴 actor = `session_user`(Sean 拍 A′;這一段是本片最容易誤解的地方)──────
-- **記的是 DB session role,不是真人 staff。** 照 3DS 線兩支 RPC 的既有慣例逐字
-- (`20260624120004…:56` / `20260624120010…:72`:「稽核記 DB session role
-- (非 current_user=function owner、非真人 staff)」)。
-- · **不是 `current_user`**:SECDEF 內 `current_user` = 函式 owner(postgres)⇒ 稽核會失真,
--   每一筆刷卡都記成 postgres 做的。實測確認:本函式內 `session_user=payment_confirmer`
--   而 `current_user=postgres`。
-- · **`session_user` 是 SQL 關鍵字、不是函式** ⇒ 在 `search_path = ''` 下照樣解析得到,
--   不必(也不能)寫成 `pg_catalog.session_user`。第一版我寫成後者,實跑當場 42P01。
-- · seed 一列停用狀態的 `staff('payment_confirmer', …, is_active = false)` 讓 FK 站得住。
--   它**不會**進操作者下拉(`apps/admin/src/lib/staff.ts:29` 逐字 `.filter((row) => row.is_active)`,親驗),
--   但**會**在「設定 → 員工」頁以刪除線顯示 —— 這是 Sean 拍板時明白選的,系統身分不該是隱形的。
--
-- 🔴🔴 **因此本片新增一條部署層的不變式,寫下來免得下一個人踩**:
--    **正式路徑的 DB 連線角色必須「就是」`payment_confirmer`,不能是「繼承它的別的角色」。**
--    理由:`actor` 是 `NOT NULL REFERENCES staff(id)`,而 `session_user` 記的是**登入角色**;
--    以別的角色登入(即使繼承了 EXECUTE)會讓 `session_user` 沒有對應 staff 列 ⇒ **每一筆刷卡都失敗**。
--    · 實測(拋棄庫):以 `payment_confirmer` 呼叫 ⇒ 落帳成功;以 `postgres` 呼叫 ⇒ **23503 FK 違反**。
--    · 目前的結構讓這個面很窄(apply 當下實查):`payment_confirmer` 是 `rolinherit=f`、
--      **零成員**(`pg_auth_members` 查無),且 EXECUTE 全集只有 `payment_confirmer,postgres`
--      ⇒ 可能的呼叫者只有那兩個。下方前置閘 ③ 把這三件事釘住。
--      ⚠️ 精確講:那只涵蓋**直接 ACL**;superuser 與能取得 owner 身分的人**永遠**呼得到
--        (codex R2 nit)。他們呼到時會被執行期的角色釘安全拒絕(P2B36),不是放行 ——
--        但「可能的呼叫者只有兩個」這句話本身是過強的,照事實改寫。
--    · ⚠️ 誠實邊界:前置閘 ③ 是 **apply 那一刻**的點時觀察,擋不住「apply 之後有人加成員」。
--      擋那個面的是下方函式體內的 **P2B36 守門**(執行期,每一次呼叫都問)。
--
-- ── 🔴 OP-A11 的 card 軌交付物:`received_at` 的時間來源政策(本片是指名 owner)──
-- **決定:`received_at = pg_catalog.now()`(DB 自己的時鐘),不用 TapPay 回傳的授權時點。**
-- 理由:OP2a 的 A8 閘比的是 **DB 的時鐘**,對**外部系統的時鐘偏差擋不到**
-- (OP1 檔頭 OP-A11 逐字:「不得把 A8 當成時間一定對的證明」)⇒ 寫外部時點等於把一個
-- **沒有任何守門看得住的值**當成帳上事實。
-- 🔴🔴 **代價寫明,不藏**:帳上的收款時點 = **我方確認的時點**,與**發卡行授權時點**
--    可能差幾秒到幾分鐘(重試、回呼延遲、網路)。對帳與「今日收款」看到的是前者。
--    要改成後者,是一次要連 A8 閘一起重新設計的改動,不是換個運算式。
-- 🔴 為什麼是 `now()` 而不是 `clock_timestamp()`:`now()` = 交易開始時刻,恆 `<= clock_timestamp()`
--    ⇒ 一定過得了 OP2a 的閘;而同一筆付款確認的落帳時點取交易起點,比取「執行到這一行的瞬間」
--    更接近「這筆交易代表的那個事件」。兩者差距是毫秒級,對帳意義上不可見。
--
-- ── 🔴 SECDEF 可寫性(OP2b 的教訓,但**處置刻意與 OP2b 不同**)──────────────
-- `order_payments` 零 GRANT + RLS 開啟零 policy ⇒ SECDEF 的執行身分 = 函式 **owner**;
-- owner 若不是表 owner 又無 BYPASSRLS,**INSERT 會被擋或落 0 列,而且可能只在某些路徑上才炸**。
-- 🔴 **與 OP2b 的差別 = 只斷言、不 ALTER**(主視窗 2026-08-10 裁 A):
--    OP2b 對它**自己當場 CREATE 的新函式**做 `ALTER FUNCTION … OWNER TO`,影響面僅限本片產物;
--    而 `confirm_order_payment` 是**已在正式站跑著的金流 RPC** —— 對它 ALTER OWNER 改的是
--    **整支付款確認的 SECDEF 執行身分**,遠大於本片新增的這條 INSERT。
--    兩種做法在「斷言會過」時**行為完全相同**(ALTER 即 no-op);差別只出現在斷言**不過**的時候,
--    而那正是最不該讓 migration 自作主張改身分的情況 ⇒ 檔尾 fail-closed 斷言、不符就紅、人工對齊。
--
-- ── 零 TS 改動(但有一條要誠實寫明的代價)──────────────────────────────────
-- 函式**簽章與回傳形狀一字不動**(`{confirmed, idempotent}`)⇒ `PaymentConfirmerAdapter.ts:128`
-- 那條 `SELECT public.confirm_order_payment($1,$2,$3)` 與 `IPaymentConfirmer` / `database.types.ts`
-- 全部不受影響。**本片零 TS 改動**(A8c2 同款)。
--
-- 🔴🔴 **但「零 TS 改動」在效果上有代價,不藏(codex 關卡2 R2 抓到,主視窗 2026-08-10 裁 A:
--    本片不動 TS、修正另開一片)**:
--    `PaymentConfirmerAdapter.ts` 的 `classifyPgError` 逐字 —— **只有 `P0001` → `rejected`,
--    其餘一律 → `unreachable`「付款確認連線失敗(可重試)」**。
--    ⇒ 本片新增的 **P2B36(呼叫身分錯)與 P2B37(card 腿被靜默吞列)都不是 P0001**,
--      在 app 層會被歸成「連線失敗、**可重試**」——**與事實相反**:兩者都是決定性失敗
--      (部署設定錯 / 資料一致性錯),**重試永遠不會好**,而值班看到的訊息會把人帶去查網路。
--    ⚠️ 也就是說:這兩個碼在 **DB 層是可診斷的**(訊息寫得很清楚),但**那份診斷目前傳不到 app 層**。
--       本片仍加它們,是因為它們的**第一價值是 fail-closed 擋住錯誤寫入**(擋住這件事完全成立),
--       診斷只是附加價值 —— 不要因為附加價值沒到位就以為守門沒生效。
--    🔴 既有的 **P8C01(A8c2 隔離閘)同樣不是 P0001、同樣被歸 unreachable** ⇒ 這是**前置既有行為**,
--       不是本片引入的;修的時候三碼要一起看,只修兩個等於留一半。
--    ⇒ **backlog #371**:`classifyPgError` 分類修正(P2B36/P2B37/P8C01)+ 單元測,獨立的 adapter 金流片。
--       **不修會痛在哪**:值班人員照「可重試」去重試一個部署設定錯誤,永遠不會好,
--       而真正的原因(角色錯 / 吞列)被那句「連線失敗」蓋掉 ⇒ 一次本來十分鐘能查清的事故會拖很久。
--
-- ── ⛔ apply 停點 ────────────────────────────────────────────────────────
-- 施工窗不得自行 apply。preflight = `bash scripts/w7-coverage.sh record all` 全綠
-- + `bash scripts/op3-verify.sh all /tmp/op3` 全綠 + 全新 provision 套完全部 migration 綠,
-- 結果交 Sean 決定何時開。
-- apply 前另跑一次 `SHOW server_version;`(本檔用 `transaction_timeout` = **PG17 only**,
-- PG<17 要拿掉那一行;本檔**沒有**用 `MAINTAIN`,不必動 privilege 陣列)。
--
-- 🔴🔴 **硬前置(三線審查 must-fix;不是建議,是擋 apply 的條件)**:
--    **對正式 DSN 實跑 `SELECT session_user`,必須逐字回 `payment_confirmer`。**
--      psql "$PAYMENT_CONFIRMER_DB_URL" -c 'select session_user'
--    理由:本片的 P2B36 讓「連線角色必須就是 payment_confirmer」從**慣例**變成**執行期硬條件**。
--    若正式站其實以別的角色(例如 postgres 或某個繼承角色)連線,**每一道 apply-time 閘都會過**
--    (它們驗的是角色存在/成員/ACL,不是「誰會來連」),然後**apply 之後每一筆刷卡都紅在 P2B36**。
--    🔴 這正是 memory `feedback_app-layer-must-not-ship-before-migration-apply` 的同一形狀
--       —— 本檔開頭 §發布序 還自己引用了那條,卻沒把它套到自己新造的這個前提上。
--    ⚠️ 本機 harness **證不了**這件事:`scripts/op3-verify.sh` 用 `SET LOCAL SESSION AUTHORIZATION`
--       換 session_user,**繞過真實 LOGIN 與 pooler** ⇒ 本機十二格全綠與這條前提**完全無關**。
--       這條只有對正式 DSN 實測才算數,且**必須在 apply 之前**,不能事後補。
--
-- ── Rollback ────────────────────────────────────────────────────────────
-- 🔴 **不是「跑一次舊檔就好」**,分兩態:
-- · **態一:本片 apply 後尚無任何 card 腿列** —— 用 A8c2 檔案的函式本體逐字 `CREATE OR REPLACE`
--   還原(連同它的 COMMENT),再刪掉本片 seed 的 staff 列,零殘留。
-- · **態二:已經有 card 腿列** —— 還原函式**不會**刪掉那些列,也**不該**刪(帳本 append-only,
--   OP2b 的 `pcm_op2b_no_delete` 會擋);seed 的 staff 列也**刪不掉**
--   (`actor` FK 是 `ON DELETE RESTRICT`,這是刻意的)。⇒ 還原後那些列仍是正確的已收紀錄,
--   只是自那一刻起新的付款確認不再落帳 ⇒ 產生「有付款、帳本沒記」的缺口,而**補它的是 OP4**。
--   還原前先數一次 `SELECT count(*) FROM order_payments WHERE rail='card'` 並記進 STOP 檔。
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 🔴 CREATE OR REPLACE FUNCTION 只取函式層的鎖,不碰 order_payments;三個 timeout 照 OP2a/OP2b 同款,
--    保護「我等不到鎖時放棄」(不保護「別人在等我放鎖」——那要靠 transaction_timeout,PG17)。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ── 0. 前置閘 ①:confirm 現定義 = A8c2 版(基底版本被別片換掉的機制層防護)──
DO $op3_gate_base$
DECLARE v text;
BEGIN
  v := md5(pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure));
  IF v <> '6423848f965176c8a0c02917b8be9f52' THEN
    RAISE EXCEPTION 'OP3 前置閘:confirm_order_payment 現定義不是 A8c2 版(md5=%);'
                    '照舊基底覆蓋會把取消守門與隔離閘整段蓋掉 ⇒ 停下人工對齊,不要硬套', v;
  END IF;
END
$op3_gate_base$;

-- ── 0. 前置閘 ②:發布序 —— OP2b 必須已 apply(dormant gate 不在、三件套 trigger 都在)──
-- 🔴 只驗 gate 不在**不夠**:有人手動 DROP 掉 gate 也會讓它不在,而那時 A9 / 不可變 / 擋刪
--    一條都還沒上,本片的 INSERT 會落進一本**沒有任何不變式在守**的錢帳。
--    ⇒ 兩件都驗:gate 已移除 **且** OP2b 的四支 trigger 逐字都在。
DO $op3_gate_release_order$
DECLARE v_n integer; v_names text;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_constraint
   WHERE conname = 'order_payments_dormant_until_triggers'
     AND conrelid = 'public.order_payments'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'OP3 發布序閘:dormant gate 還在 ⇒ OP2b 未 apply。'
                    '本片一旦上線,每一筆付款確認都會撞 CHECK (false)、整筆失敗 = 刷卡全掛。'
                    '先 apply 20260810130000(OP2b),再套本片'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_gate_still_present';
  END IF;
  SELECT pg_catalog.string_agg(tgname, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM 'order_payments_immutable_bu,order_payments_no_delete_bd,'
                              'order_payments_received_at_not_future_biu,order_payments_reversal_amount_bi' THEN
    RAISE EXCEPTION 'OP3 發布序閘:本表的 trigger 集合是 [%],期望 OP2b 終態的四支。'
                    'gate 不在但守門也不在 = 本片會把錢寫進一本零不變式的帳',
                    coalesce(v_names, '(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_op2b_triggers_missing';
  END IF;
  -- 🔴🔴 **codex 關卡2 must-fix:名字集合對了不代表它們在做事。**
  --    `ALTER TABLE … DISABLE TRIGGER` 之後 `tgname` **原封不動**、上面那道全綠,
  --    而 A9 / 不可變 / 擋刪 / A8 四道守門一條都沒在跑 ⇒ 本片照樣把錢寫進一本零不變式的帳。
  --    這正是 memory `feedback_guard-checks-existence-not-effect`(存在性斷言對「還在但失效」全盲)。
  --    ⇒ 逐支要求 `tgenabled='O'`(origin 啟用;'D'=disabled、'R'/'A'=replica-only)。
  -- ⚠️ 誠實邊界:本閘仍不驗 `tgfoid`(綁的是不是原本那支函式)與 `tgtype`(事件/時機位元)——
  --    那兩者由 **OP2b 自己的檔尾斷言**在它 apply 當下逐字釘死;本片重複釘一次的邊際價值低於
  --    「兩處字面要同步改」的維護成本。這是刻意的取捨,不是漏了。
  SELECT pg_catalog.string_agg(tgname || '=' || tgenabled::text, ',' ORDER BY tgname) INTO v_names
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal AND tgenabled <> 'O';
  IF v_names IS NOT NULL THEN
    RAISE EXCEPTION 'OP3 發布序閘:OP2b 的 trigger 有被停用的(%)⇒ 名字還在但守門沒在跑,'
                    '本片會把錢寫進一本沒有任何不變式在守的帳', v_names
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_op2b_triggers_disabled';
  END IF;
  -- 🔴🔴 **codex R2 must-fix:名字對 + 啟用中,仍可能綁到別的函式或改了事件型別。**
  --    上一版我把這條寫成「刻意的取捨,OP2b 自己驗過」—— 那個理由站不住:OP2b 驗的是
  --    **它 apply 當下**,而本片 apply 可能是好幾天以後,中間有人 `CREATE OR REPLACE TRIGGER`
  --    改綁一支 no-op 函式,四支名字與 tgenabled 全都不變。⇒ 把 (名字, 綁定函式, tgtype) 三元組凍死。
  -- 🔴🔴 **三線審查 must-fix:三元組(名字/函式/tgtype)獨漏 `tgqual`(WHEN 子句)。**
  --    `CREATE OR REPLACE TRIGGER … WHEN (false)` ⇒ 名字、綁定函式、事件位元**四項全不變**,
  --    而那支 trigger 一列都不會跑 = 守門空轉。這正是 OP2b 自己列為 must-fix 的同一面
  --    (它對 A9 特地驗過「有沒有 WHEN」),我抄三元組時漏了。
  --    ⇒ 最省的修法不是再補一欄,是**整段換成 `pg_get_triggerdef()` 全文逐字比** ——
  --      它一次涵蓋時機/事件/FOR EACH/WHEN/綁定函式與參數,日後 PG 增欄也不會再漏。
  SELECT pg_catalog.string_agg(pg_catalog.pg_get_triggerdef(oid), E'\n' ORDER BY tgname)
    INTO v_names
    FROM pg_catalog.pg_trigger
   WHERE tgrelid = 'public.order_payments'::regclass AND NOT tgisinternal;
  IF v_names IS DISTINCT FROM
       'CREATE TRIGGER order_payments_immutable_bu BEFORE UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION pcm_op2b_immutable_columns()' || E'\n' ||
       'CREATE TRIGGER order_payments_no_delete_bd BEFORE DELETE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION pcm_op2b_no_delete()' || E'\n' ||
       'CREATE TRIGGER order_payments_received_at_not_future_biu BEFORE INSERT OR UPDATE ON public.order_payments FOR EACH ROW EXECUTE FUNCTION pcm_op2_received_at_not_future()' || E'\n' ||
       'CREATE TRIGGER order_payments_reversal_amount_bi BEFORE INSERT ON public.order_payments FOR EACH ROW WHEN ((new.reverses_payment_id IS NOT NULL)) EXECUTE FUNCTION pcm_op2b_reversal_amount()' THEN
    RAISE EXCEPTION 'OP3 發布序閘:OP2b trigger 的定義全文漂移。實得:%'
                    '⇒ 時機/事件/FOR EACH/WHEN/綁定函式任一被改都在這裡紅(WHEN (false) 空轉也擋得到)', coalesce(v_names,'(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_op2b_trigger_def_drifted';
  END IF;
END
$op3_gate_release_order$;

-- ── 0. 前置閘 ③:actor = session_user 的前提(呼叫者集合夠窄)──────────────
-- 🔴 這三件事撐著「actor 一定填得出來」:①payment_confirmer 存在且不繼承 ②沒有別的角色是它的成員
--    ③EXECUTE 全集只有它與 postgres。任一不成立,就有一條「以別的 session_user 呼叫」的路,
--    而那條路上每一筆刷卡都會撞 actor 的 FK。
-- ⚠️ **誠實邊界:這是 apply 那一刻的點時觀察**,擋不住 apply 之後有人加成員/改角色。
--    執行期的那一半由函式體內的 P2B36 守門負責(每一次呼叫都問)。兩者不可互相取代。
DO $op3_gate_actor_premise$
DECLARE v_inherit boolean; v_canlogin boolean; v_members text; v_grantees text;
BEGIN
  SELECT rolinherit, rolcanlogin INTO v_inherit, v_canlogin
    FROM pg_catalog.pg_roles WHERE rolname = 'payment_confirmer';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OP3 actor 前提閘:payment_confirmer 這個 DB 角色不存在 ⇒ session_user 永遠不會是它'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_role_missing';
  END IF;
  -- 🔴🔴 **codex 關卡2 must-fix:第一版讀了 `rolinherit` 進變數卻從來沒用它。**
  --    檔頭把「rolinherit=f、可登入」寫成**已釘住的前提**,而實際上一條斷言都沒有
  --    ⇒ 宣稱 > 事實(本 repo 反覆記過的那個形狀),而且是我自己寫的檔頭在說謊。
  --    · `rolcanlogin=false` ⇒ 正式站**根本連不進來**,每一筆刷卡都掛在連線階段。
  --    · `rolinherit=true`  ⇒ 它會繼承所屬角色的權限,權限面比檔頭宣稱的寬。
  IF NOT v_canlogin THEN
    RAISE EXCEPTION 'OP3 actor 前提閘:payment_confirmer 不可登入(rolcanlogin=false)⇒ 正式路徑連不進來,'
                    '而 actor=session_user 的整個設計都預設它是**登入角色**'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_role_cannot_login';
  END IF;
  IF v_inherit THEN
    RAISE EXCEPTION 'OP3 actor 前提閘:payment_confirmer 的 rolinherit=true(檔頭釘的前提是 false)'
                    '⇒ 它的權限面比本片宣稱的寬;要嘛改回 NOINHERIT,要嘛改檔頭並重新評估'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_role_inherits';
  END IF;
  SELECT pg_catalog.string_agg(m.member::regrole::text, ',' ORDER BY m.member::regrole::text)
    INTO v_members
    FROM pg_catalog.pg_auth_members m
   WHERE m.roleid = 'payment_confirmer'::regrole;
  IF v_members IS NOT NULL THEN
    RAISE EXCEPTION 'OP3 actor 前提閘:有角色是 payment_confirmer 的成員(%)⇒ 它們拿得到 EXECUTE,'
                    '但 session_user 會是它們自己的名字、staff 查無此列 ⇒ 那條路上每一筆刷卡都會撞 actor 的 FK。'
                    '正式路徑必須「就是」payment_confirmer 登入,不是繼承它', v_members
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_role_has_members';
  END IF;
  SELECT pg_catalog.string_agg(a.grantee::regrole::text, ',' ORDER BY a.grantee::regrole::text)
    INTO v_grantees
    FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
   WHERE p.oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure
     AND a.privilege_type = 'EXECUTE';
  -- ⚠️ 本閘比檔尾 ⓖ **寬**(它不看 GRANT OPTION 指紋)——同一份檔兩個標準是刻意的:
  --    這裡是 apply **前**的前提檢查(寬 ⇒ 早停、訊息好讀),ⓖ 是 apply **後**的驗收(嚴)。
  --    兩者都 fail-closed,寬的那個先跑不會放行嚴的那個抓得到的東西。
  IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
    RAISE EXCEPTION 'OP3 actor 前提閘:EXECUTE 全集=[%],期望逐字 payment_confirmer,postgres', coalesce(v_grantees,'(無)')
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_op3_execute_set_drifted';
  END IF;
END
$op3_gate_actor_premise$;


-- ── 1. seed:card 腿的系統身分(Sean 拍 A′)────────────────────────────────
-- 🔴 `is_active = false` 是**功能性的**,不是裝飾:`listActiveStaff()` 逐字 `.filter((row) => row.is_active)`
--    ⇒ 這一列不會出現在任何操作者下拉;而「設定 → 員工」頁列全部列、以刪除線顯示它 = 刻意保留
--    (系統身分不該是隱形的,Sean 拍板時明白選的)。
-- 🔴 `staff_id_format` = `CHECK (id ~ '^[a-z0-9_]{1,64}$')` ⇒ `payment_confirmer` 通過(親驗)。
-- 🔴 用裸 INSERT 不用 `ON CONFLICT DO NOTHING`:本檔 forward-only(前置閘 ① 讓二次 apply 必紅),
--    這一列若已存在,那是**有人先手動加過**、值不見得對 ⇒ 該當場紅、不該靜默略過。
INSERT INTO public.staff (id, label, is_manager, is_active)
VALUES ('payment_confirmer', 'TapPay 付款確認(系統)', false, false);


-- ── 2. confirm_order_payment CREATE OR REPLACE(**以 A8c2 版為基底**)──
-- 🔴 相對 A8c2 的改動**逐項列舉**(上一版寫「恰三處」而實際是四處,兩線都抓到 ——
--    數字型宣稱會被自己後續的編輯推移,改成列舉就不會過期):
--    ①PF-C 之後、`RETURN` 之前:actor 兩道守門(P2B36)+ card 腿 INSERT + 落帳 row_count 守(P2B37)
--    ②`WHEN unique_violation` 的**註解**補一句新觸發來源(行為未變)
--    ③COMMENT 更新
--    ④金額檢查後新增 `total <= 0` 守門(見該處註解)
--
-- 🔴🔴 **行為面破壞性變更揭示(三線審查 must-fix;上一版只寫「只加一段」= 宣稱 < 事實)**
--    本片**不是**純新增,它縮小了「誰能成功呼叫這支 RPC」:
--    · **改動前**:`payment_confirmer` 與 `postgres`(superuser)呼叫都能成功走完。
--    · **改動後**:只有 `payment_confirmer` 能成功;**任何其他角色(含 postgres)一律紅在 P2B36**。
--      這是刻意的(actor 記 DB 角色 ⇒ 身分必須被釘),但它是**行為變更**,不是新增功能。
--    ⇒ **連帶打到三支既有 harness**(實查數字,非轉述):
--        `scripts/a8c2-verify.sh` —— **26 處**呼叫 confirm、且 `URL` 以 **postgres** 連;
--          另釘 `MD5_NEW`(confirm 定義)與 `CMT_MD5_NEW`(confirm 的 **COMMENT**)⇒ 本片兩者都改了。
--        `scripts/a8a1-verify.sh`(1 處)、`scripts/a8a2-verify.sh`(3 處)同形,釘 `MD5_CONFIRM_A8C2`。
--    🔴 **但要說清楚因果,不要把既有債算到本片頭上**:那三支在**本片之前就已經跑不動**了 ——
--       2026-08-10 我把 OP3 **暫時移出** migrations 後重跑,`a8c2-verify` 仍拒跑、且紅在
--       **`begin_charge_attempt` 的 md5 閘**(L4a-1 於 08-09 改過那支)⇒ 既有債 = **backlog #370**。
--       本片**新增**的是「另外幾個會紅的理由」(postgres 呼叫被 P2B36 擋、confirm 與 COMMENT 兩個 md5 變了),
--       **不是**「本片弄壞了它們」。
--    ⇒ **本片刻意不復活它們**(那是 #370 的工,且要連 `begin` 閘一起處理);
--      本片負責的是**揭示**:①這段檔頭 ②`w7-coverage.sh` 的 `EXCLUDED-REASONS` 附失效條件
--      ③#370 條目補註:**修復時必須連帶** (a) 改用 `SET SESSION AUTHORIZATION 'payment_confirmer'`
--      (b) 重釘 `MD5_NEW`/`MD5_CONFIRM_A8C2` (c) 重釘 `CMT_MD5_NEW`。
--    ⚠️ 底線:**不得沉默**。三支回歸 harness 目前零自動化在看,這件事必須寫在讀得到的地方。
--    其餘(隔離閘、輸入驗、PF-B、取消守門、PF-D 樹、cross-order pre-check、PF-G、PF-C、
--    EXCEPTION backstop 本體)**一字不動** —— 檔尾碼錨逐條釘住這句話。
CREATE OR REPLACE FUNCTION public.confirm_order_payment(
  p_order_id     uuid,
  p_amount       integer,
  p_rec_trade_id text
)
RETURNS jsonb                 -- {confirmed boolean, idempotent boolean};禁回 total/價結構(PF-G)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_order       record;
  v_n           integer;
  v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
BEGIN
  -- 🔴 A8c2 隔離閘(fail-closed;A8c1 同款、A2b1 教訓):非 READ COMMITTED 下 FOR UPDATE 等鎖
  --    醒來後快照仍舊、部分取消不動 orders 列 ⇒ EXISTS 看不到已 commit 取消。
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
  IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
    RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
  END IF;

  -- ── PF-B:FOR UPDATE 鎖臨界區 ──
  SELECT id, total, payment_status, tappay_rec_trade_id, cancelled_at
    INTO v_order
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  -- ── PF-D(1):訂單不存在 → 拒(通用、不洩存在與否)──
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 A8c2 取消守門(master plan row 35;R8 守門先於取消):存在任何取消紀錄 ⇒ 拒確認。
  --    位置=paid 冪等樹之前:已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功。
  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約);通用訊息=PF-E。
  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
  -- 🔴 OP3:這棵樹的位置**不得下移到 card 腿之後** —— 它提前 RETURN 正是「同 rec 重放不落第二列」
  --    的唯一機制(重放根本到不了 INSERT)。檔尾順序錨釘住它在 INSERT 之前。
  IF v_order.payment_status = 'paid'::public.payment_status THEN
    IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
       AND p_amount IS NOT NULL AND v_order.total = p_amount THEN
      RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', true);
    END IF;
    -- PF-D(4):paid 但 rec 或 amount 任一不等(疑重複扣款/竄改)→ 拒
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(4):refunded / partiallyPaid(非 unpaid)→ 拒(同 rec 也不復活成 paid)──
  IF v_order.payment_status <> 'unpaid'::public.payment_status THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-D(5):unpaid 且金額相符 → 翻 paid;金額不符/NULL → 拒(整數比對、不洩 total)──
  IF p_amount IS NULL OR p_amount <> v_order.total THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 🔴 `total <= 0` 守門(Fable 實跑抓到;可達性趨零但後果不對稱):
  --    total=0 且 p_amount=0 時上面的相等檢查**會過**,然後 card 腿撞
  --    `order_payments.amount CHECK (amount <> 0)` ⇒ 噴 **raw 23514**,PG 的 DETAIL 會把
  --    **整列值**帶出來(繞過 PF-E 的不洩內部狀態),而 app 層又把非 P0001 標成「可重試」。
  --    ⇒ 收斂成 PF-E 通用訊息;這條**不改任何合法路徑**(合法訂單 total 恆正)。
  IF v_order.total <= 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── cross-order rec_trade_id 重用序列 pre-check(優雅通用訊息;UNIQUE 並發 backstop 見 EXCEPTION)──
  PERFORM 1 FROM public.orders
   WHERE tappay_rec_trade_id = p_rec_trade_id AND id <> p_order_id;
  IF FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ── PF-G:翻 paid、僅 5 欄、零 fulfillment_status;WHERE 帶 payment_status='unpaid' 條件式 ──
  UPDATE public.orders
     SET payment_status      = 'paid'::public.payment_status,
         tappay_rec_trade_id = p_rec_trade_id,
         paid_at             = pg_catalog.now(),
         payment_method      = 'tappay',
         updated_at          = pg_catalog.now()
   WHERE id = p_order_id
     AND payment_status = 'unpaid'::public.payment_status;

  -- ── PF-C:row_count 守(防 FORCE RLS 靜默 0 列=收錢沒翻單)──
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- ══ 🔴 OP3 card 腿:與翻 paid **同一筆交易**寫收款帳本 ══════════════════════
  -- 🔴 執行期的 actor 守門(檔頭前置閘 ③ 的另一半):`actor` 是 NOT NULL FK 到 staff,
  --    而 `session_user` 記的是**登入角色**。以「沒有對應 staff 列」的角色呼叫本 RPC,
  --    原本會噴一個 raw 23503 並把約束名 `order_payments_actor_fkey` 洩出去,
  --    而現場完全看不出「這是部署設定問題、不是訂單問題」。⇒ 先問一次、給可診斷的訊息。
  -- ⚠️ 這條**刻意不用** PF-E 通用訊息:PF-E 是為了不洩**訂單狀態**;這裡洩的是我方的角色設定,
  --    與客人的訂單無關,而把它壓成「付款確認失敗」會讓一次部署事故變成查不出來的謎。
  -- 🔴🔴 **codex 關卡2 must-fix:第一版只問「有沒有同名 staff 列」,那擋不住錯的身分。**
  --    失敗情境:apply 之後有人給角色 `ops` EXECUTE、而 staff 恰好也有一列 `ops`
  --    ⇒ 舊守門**全綠**,card 腿的 actor 被寫成 `ops`,錢帳上的經手人從此是錯的,
  --      而且每一格斷言都看不出來(列有落、FK 也過)。
  --    ⇒ 守門要釘的是**身分本身**,不是「這個名字在 staff 表裡找得到」。
  -- 🔴 為什麼可以硬釘 `payment_confirmer` 這個字面:本片的 actor 政策就是
  --    「card 腿只由 TapPay 付款確認這條機器軌寫」(Sean 拍 A′),而那條軌的登入角色就是它。
  --    日後若真要多開一條機器軌,那是**新的拍板**,應該同時改這裡與檔頭政策 —— 讓它在這裡紅,
  --    比讓它靜默寫進一個沒人決定過的 actor 好。
  IF session_user <> 'payment_confirmer' THEN
    RAISE EXCEPTION 'confirm_order_payment: 呼叫端的 DB 角色是 [%],不是 payment_confirmer ⇒ 拒絕落 card 腿。'
                    '這是部署設定問題、不是訂單問題:本 RPC 的 actor 記的是 DB session role(非真人),'
                    '正式路徑必須「就是」payment_confirmer 登入,不是繼承它、也不是別的有 EXECUTE 的角色', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_wrong_role';
  END IF;
  -- 角色對了還要真的有那一列:seed 被刪掉時 FK 會噴 raw 23503(洩約束名且不可診斷)。
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = session_user) THEN
    RAISE EXCEPTION 'confirm_order_payment: DB 角色 [%] 在 staff 沒有對應列 ⇒ card 腿的 actor 寫不進去。'
                    '這是部署設定問題、不是訂單問題:OP3 seed 的那一列被刪了或沒 apply 到', session_user
      USING ERRCODE = 'P2B36', CONSTRAINT = 'pcm_op3_actor_not_in_staff';
  END IF;

  -- 位置=PF-C 之後、RETURN 之前。放在 PF-C 之後才有意義:翻單沒成功就不該落帳。
  -- · rail='card';`bank_reference` / `request_id` 必須 NULL(OP1 rail_fields 的 card 分支)。
  -- · amount = v_order.total —— **不是 p_amount**。兩者在這一行已被上面的守門證明相等
  --   (`p_amount <> v_order.total` 就 RAISE 了),取 DB 側的值是因為它是**帳本該記的那個事實**,
  --   而 p_amount 是呼叫端送進來的參數。等價但來源不同,選不會被外部影響的那個。
  -- · received_at = pg_catalog.now():理由與代價見檔頭 OP-A11 那段(帳上收款時點=我方確認時點)。
  -- · actor = session_user:見檔頭 actor 那段(DB session role、非真人)。
  -- · 冪等:同 rec 重放走上面的 paid 冪等樹提前 RETURN,到不了這裡;真並發撞
  --   `order_payments_card_idem_uniq` / `order_payments_rec_trade_global_uniq` 由下方既有的
  --   `WHEN unique_violation` handler 收成通用訊息(PF-E)。
  -- 🔴 search_path='' ⇒ 表名與函式名一律 schema-qualified;`session_user` 是**關鍵字不是函式**,
  --    不加 pg_catalog 前綴(加了會 42P01,實跑踩過)。
  INSERT INTO public.order_payments (order_id, rail, amount, received_at, rec_trade_id, actor)
  VALUES (p_order_id, 'card', v_order.total, pg_catalog.now(), p_rec_trade_id, session_user);

  -- 🔴🔴 **PF-C 的第二道(codex 關卡2 must-fix)**:我抄了 UPDATE 那道 row_count 守,
  --    卻沒替自己新增的 INSERT 補同一道。BEFORE INSERT trigger **回 NULL 會把那一列靜默吞掉**
  --    —— INSERT 影響 0 列、**不報任何錯**,函式照樣往下 RETURN 成功,而 orders 已翻成 paid
  --    並隨本交易 commit ⇒ 帳面顯示已收款、收款帳本查無此筆,**正是本片存在的理由本身**,
  --    而且沒有任何守門會叫。
  -- ⚠️ 這條擋的是「靜默 0 列」,不是「INSERT 報錯」—— 後者會直接拋例外、整筆 rollback,本來就安全;
  --    真正危險的是不報錯的那條路。負測 = op3-verify.sh G10(裝一支回 NULL 的 BEFORE INSERT trigger)。
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'confirm_order_payment: card 腿落帳 % 列(期望恰 1)⇒ 翻單成功但收款帳本沒收到這筆。'
                    '成因通常是 order_payments 上有 BEFORE INSERT trigger 回了 NULL(靜默吞列)。'
                    '本交易整筆回滾,訂單狀態與錢帳都不會半套', v_n
      USING ERRCODE = 'P2B37', CONSTRAINT = 'pcm_op3_card_leg_row_count';
  END IF;
  -- ══════════════════════════════════════════════════════════════════════════

  RETURN pg_catalog.jsonb_build_object('confirmed', true, 'idempotent', false);

EXCEPTION
  -- 🔴 PF-E:cross-order rec_trade_id 真並發撞 orders.tappay_rec_trade_id UNIQUE → 通用訊息(不洩 raw 23505/約束名)
  -- 🔴 OP3:本 handler 自本片起**多了一個觸發來源** —— card 腿撞 order_payments 的兩道 partial
  --    unique 也會走到這裡(OP3 之前只可能由 orders 那道 UNIQUE 觸發)。行為相同(通用訊息),
  --    但這句話要寫下來,否則下一個人會以為這條 handler 只管 orders。負測=op3-verify.sh G7。
  WHEN unique_violation THEN
    RAISE EXCEPTION '%', v_generic_msg;
END;
$fn$;

-- COMMENT:在 A8c2 字面尾端接上 card 腿那一段(前半逐字不動,便於 diff 對照)
COMMENT ON FUNCTION public.confirm_order_payment(uuid, integer, text) IS
  'M-3-S2-c 付款確認(SECURITY DEFINER 零 service_role、search_path='''')。只 payment_confirmer 可呼;🔴 E10-A8c2 取消守門(master plan row 35;R8 守門先於取消):隔離閘(非 READ COMMITTED 一律 P8C01)→ PF-B FOR UPDATE(加讀 cancelled_at)→ 取消守門(cancelled_at 非空或 order_cancellations 任一列 ⇒ 通用 RAISE;真相表直讀;位置在 paid 冪等樹之前 ⇒ 已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功)→ PF-D 冪等樹:unpaid + p_amount=orders.total + rec_trade_id 非空且未用於別單 → 翻 paid 寫 5 欄(零 fulfillment、PF-G);paid+同 rec+同 amount 重放冪等 no-op(不刷時間戳);refunded/partiallyPaid 即使同 rec 也拒。PF-C row_count 守 + PF-E 通用訊息(#219 harden)+ UNIQUE 並發 backstop。零經銷價/cost。'
  '🔴 E10-OP3 card 腿:PF-C 之後、RETURN 之前,**同一筆交易**往 order_payments insert 一列 '
  '(rail=card、amount=orders.total、received_at=now()、rec_trade_id=本次交易號、actor=session_user)⇒ 翻單與落帳同生共死。'
  'actor 記的是 **DB session role 不是真人**(照 3DS 線慣例);正式路徑必須「就是」payment_confirmer 登入,'
  '沒有對應 staff 列時走 P2B36 具名守門(可診斷訊息,刻意不壓成 PF-E 通用訊息 —— 那是部署問題不是訂單問題)。'
  'received_at 記的是**我方確認時點**、不是發卡行授權時點(外部時鐘 OP2a 的 A8 閘擋不到,見 OP1 檔頭 OP-A11);'
  '同 rec 重放由 paid 冪等樹提前 RETURN 擋住、到不了 INSERT ⇒ 不落第二列;'
  '並發撞 card 兩道 partial unique 由 WHEN unique_violation 收成通用訊息。歷史資料的回填是 OP4,不在本片。';


-- ── 3. 結構 assert:A8c2 全部碼錨保留 + OP3 新錨 + 順序錨 + ACL + SECDEF 可寫性 ──
DO $op3_asserts$
DECLARE v_def text; v_code text; v_idx text; v_idxname text; v_idxdef text; v_n integer;
BEGIN
  v_def := pg_get_functiondef('public.confirm_order_payment(uuid,integer,text)'::regprocedure);
  -- 🔴🔴 **codex 關卡2 must-fix:`pg_get_functiondef` 把註解一起回傳** ⇒ 下面所有文字錨
  --    都可以被「把 code 刪掉、字面留在註解裡」騙過(死字串掏空)。例如刪掉整條 card 腿 INSERT、
  --    但在註解裡留一行提到它,「恰一條」那道照樣算到 1、順序錨也照樣過。
  --    ⇒ 先剝掉行註解,所有錨改對 `v_code` 比對。
  -- ⚠️ 誠實邊界(兩條,不假裝關完):
  --    ① 這個剝法對「`--` 出現在字串常值裡」會誤傷;本函式體目前沒有那種字面(逐行確認過),
  --       日後若有,錨會開始**假紅** —— 那是安全方向的失敗(false-stop),不是放行。
  --    ② 文字錨擋的是**被掏空**,不是**被改細**:把取消條件改成 `... AND false` 之後錨仍在。
  --       那一類只有行為測得到 ⇒ 由 `scripts/op3-verify.sh` 的 G4/G6/G9/G10 負責,不是這裡。
  -- 🔴 codex R2 must-fix:第一版只剝行註解,`/* … */` 區塊註解一樣藏得住死字串
  --    ⇒ 兩種都剝(先剝區塊、再剝行;非貪婪以免吃掉整段)。
  v_code := pg_catalog.regexp_replace(v_def, '/\*.*?\*/', '', 'gs');
  v_code := pg_catalog.regexp_replace(v_code, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');

  -- ⓐ A8c2 的碼錨**逐條照抄**(zero-regression:證明我沒把它的守門蓋掉)
  IF position(E'USING ERRCODE = \'P8C01\'' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 結構 assert:A8c2 隔離閘碼錨缺失;拒繼續';
  END IF;
  IF position('id, total, payment_status, tappay_rec_trade_id, cancelled_at' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 結構 assert:cancelled_at 欄碼錨缺失;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_code) = 0
     OR position('OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 結構 assert:A8c2 取消守門碼錨缺失;拒繼續';
  END IF;
  IF position(E'WHERE id = p_order_id\n   FOR UPDATE;' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 結構 assert:PF-B FOR UPDATE 碼錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF position('GET DIAGNOSTICS v_n = ROW_COUNT;' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 結構 assert:PF-C 碼錨缺失(zero-regression 破);拒繼續';
  END IF;
  IF position('current_setting(''transaction_isolation'') <> ''read committed''' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:隔離閘條件字面缺失或被反轉;拒繼續';
  END IF;
  IF position('IF v_order.cancelled_at IS NOT NULL' in v_code)
     >= position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:取消守門不在 paid 冪等樹(真 IF)之前;拒繼續';
  END IF;
  IF position('current_setting(''transaction_isolation'')' in v_code)
     >= position('交易識別碼缺失' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:隔離閘不在輸入驗之前;拒繼續';
  END IF;

  -- ⓑ OP3 新錨:card 腿**恰一條**,欄位清單與值逐字
  -- 🔴 數「恰一條」不是潔癖:兩條 INSERT = 一次付款落兩列帳,而所有「有沒有落帳」的斷言都照樣綠。
  v_n := (pg_catalog.length(v_code)
          - pg_catalog.length(pg_catalog.replace(v_code, 'INSERT INTO public.order_payments', '')))
         / pg_catalog.length('INSERT INTO public.order_payments');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'OP3 碼錨:函式體裡有 % 條 card 腿 INSERT(期望恰 1)⇒ 0 條=沒做、2 條以上=一次付款落多列帳', v_n;
  END IF;
  IF position('(order_id, rail, amount, received_at, rec_trade_id, actor)' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:card 腿的欄位清單不是逐字那六欄 ⇒ 多寫/少寫一欄都會改變落帳形狀;拒繼續';
  END IF;
  IF position('VALUES (p_order_id, ''card'', v_order.total, pg_catalog.now(), p_rec_trade_id, session_user)' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:card 腿的值不是逐字那六個 ⇒ 金額改取自 p_amount、received_at 改用外部時點、'
                    '或 actor 改成 current_user(=owner,稽核失真),都在這裡紅;拒繼續';
  END IF;
  -- 🔴 actor 守門的碼錨:少了它,以無 staff 列的角色呼叫會退回 raw 23503(洩約束名、且不可診斷)
  IF position('USING ERRCODE = ''P2B36''' in v_code) = 0
     OR position('SELECT 1 FROM public.staff s WHERE s.id = session_user' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:actor 守門(P2B36)缺失或被改寫;拒繼續';
  END IF;
  -- 🔴 角色釘的碼錨(codex 關卡2 must-fix 的落地):少了這條,任何拿得到 EXECUTE 且
  --    staff 恰有同名列的角色都能把 actor 寫成自己,而每一格斷言都看不出來。
  IF position('IF session_user <> ''payment_confirmer'' THEN' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:actor 角色釘(session_user 必須是 payment_confirmer)缺失;拒繼續';
  END IF;
  IF position('IF v_order.total <= 0 THEN' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:total<=0 守門缺失 ⇒ total=0 會噴 raw 23514 並由 DETAIL 外洩整列;拒繼續';
  END IF;
  -- 🔴 card 腿 row_count 守的碼錨:少了它,BEFORE INSERT trigger 回 NULL 會靜默吞列,
  --    而函式回成功、orders 已 commit 成 paid = 帳面已收款但錢帳查無此筆。
  IF position('USING ERRCODE = ''P2B37''' in v_code) = 0 THEN
    RAISE EXCEPTION 'OP3 碼錨:card 腿的 row_count 守(P2B37)缺失 ⇒ 靜默吞列無人擋;拒繼續';
  END IF;

  -- ⓒ OP3 順序錨:①card 腿在 PF-C 之後(翻單沒成功不落帳)②在 paid 冪等樹之後(重放不落第二列)
  --    ③actor 守門在 card 腿之前(否則守不到它要守的那條 INSERT)
  -- 🔴 ② 是本片最貴的一條不變式:冪等樹若被移到 INSERT 之後,同 rec 重放就會落第二列,
  --    SUM(amount) 把同一筆錢算兩次,而「有沒有落帳」的斷言全綠。
  IF position('GET DIAGNOSTICS v_n = ROW_COUNT;' in v_code)
     >= position('INSERT INTO public.order_payments' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:card 腿不在 PF-C row_count 守之後 ⇒ 翻單沒成功也會落帳;拒繼續';
  END IF;
  IF position('IF v_order.payment_status = ''paid''::public.payment_status THEN' in v_code)
     >= position('INSERT INTO public.order_payments' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:paid 冪等樹不在 card 腿之前 ⇒ 同 rec 重放會落第二列、同一筆錢記兩次;拒繼續';
  END IF;
  IF position('SELECT 1 FROM public.staff s WHERE s.id = session_user' in v_code)
     >= position('INSERT INTO public.order_payments' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:actor 守門不在 card 腿之前 ⇒ 它守不到那條 INSERT;拒繼續';
  END IF;
  -- 🔴 P2B37 必須排在 INSERT **之後**:排在前面它讀到的是上一句 UPDATE 的 ROW_COUNT
  --    ⇒ 恆為 1、恆真,而真正要守的「INSERT 被吞成 0 列」完全沒被看。
  IF position('USING ERRCODE = ''P2B37''' in v_code)
     <= position('INSERT INTO public.order_payments' in v_code) THEN
    RAISE EXCEPTION 'OP3 順序錨:card 腿的 row_count 守不在 INSERT 之後 ⇒ 它讀到的是 UPDATE 的 ROW_COUNT、恆真;拒繼續';
  END IF;

  -- ⓓ A8c2 的 UNIQUE indexdef pin(PF-E backstop 的承重)照抄
  SELECT indexdef INTO v_idx FROM pg_indexes
   WHERE schemaname='public' AND tablename='orders' AND indexname='orders_tappay_rec_trade_id_key';
  IF v_idx IS DISTINCT FROM 'CREATE UNIQUE INDEX orders_tappay_rec_trade_id_key ON public.orders USING btree (tappay_rec_trade_id)' THEN
    RAISE EXCEPTION 'OP3 結構 assert:rec UNIQUE indexdef 漂移([%]);backstop 失據、拒繼續', v_idx;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i
                  WHERE i.indexrelid = 'public.orders_tappay_rec_trade_id_key'::regclass
                    AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique) THEN
    RAISE EXCEPTION 'OP3 結構 assert:rec UNIQUE 索引非 valid/ready/live/unique;backstop 失據、拒繼續';
  END IF;

  -- ⓔ card 腿倚賴的**兩道 partial unique** 必須在(它們是「同一筆 TapPay 交易只記一次」的承重)
  -- 🔴🔴 **codex 關卡2 must-fix:第一版只**數名字**(count=2)。**
  --    把其中一道 DROP 掉、再用**同名**建一支非唯一 / 錯欄 / predicate 恆假 / invalid 的索引,
  --    count 照樣是 2 ⇒ 斷言全綠,而「同一筆 TapPay 交易只記一次」的 backstop 已經不存在。
  --    (A8c2 對 orders 那道 rec UNIQUE 本來就做了 indisvalid/ready/live/unique 的完整檢查,
  --     我卻沒把同樣的嚴格度套到自己倚賴的這兩道 —— 同一份檔案裡兩種標準。)
  --    ⇒ 逐道比 `indexdef` 逐字 + 四個 pg_index 旗標。
  FOR v_idxname, v_idxdef IN
    SELECT * FROM (VALUES
      ('order_payments_card_idem_uniq',
       'CREATE UNIQUE INDEX order_payments_card_idem_uniq ON public.order_payments USING btree (order_id, rec_trade_id) WHERE ((rail = ''card''::text) AND (reverses_payment_id IS NULL))'),
      ('order_payments_rec_trade_global_uniq',
       'CREATE UNIQUE INDEX order_payments_rec_trade_global_uniq ON public.order_payments USING btree (rec_trade_id) WHERE ((rail = ''card''::text) AND (reverses_payment_id IS NULL))')
    ) t(nm, def)
  LOOP
    SELECT indexdef INTO v_idx FROM pg_indexes
     WHERE schemaname='public' AND tablename='order_payments' AND indexname = v_idxname;
    IF v_idx IS DISTINCT FROM v_idxdef THEN
      RAISE EXCEPTION 'OP3 結構 assert:% 的 indexdef 漂移。實得 [%];期望 [%]'
                      '⇒ 同名但非唯一/錯欄/predicate 被改,card 冪等 backstop 失據;拒繼續',
                      v_idxname, coalesce(v_idx,'(不存在)'), v_idxdef;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_index i
                    WHERE i.indexrelid = ('public.' || v_idxname)::regclass
                      AND i.indisvalid AND i.indisready AND i.indislive AND i.indisunique) THEN
      RAISE EXCEPTION 'OP3 結構 assert:% 非 valid/ready/live/unique ⇒ 存在但不提供 backstop;拒繼續', v_idxname;
    END IF;
  END LOOP;

  -- ⓕ seed 的系統身分:存在、停用、label 非空
  -- 🔴 `is_active = false` 要驗:它若是 true,這個系統身分會出現在操作者下拉裡,
  --    而那正是 Sean 拍板時明確排除的東西(不是美觀問題,是他選的那個方案的一半)。
  -- 🔴 nit(codex 關卡2):上一版註解宣稱驗「label 非空」,查詢卻只有 id 與 is_active
  --    ⇒ 宣稱 > 事實,label 被清空照樣全綠。補進條件裡,讓字面與斷言一致。
  IF NOT EXISTS (SELECT 1 FROM public.staff s
                  WHERE s.id = 'payment_confirmer' AND s.is_active = false
                    AND pg_catalog.btrim(s.label) <> '') THEN
    RAISE EXCEPTION 'OP3 結構 assert:staff 的 payment_confirmer 列不存在或 is_active 不是 false'
                    '⇒ 前者讓每一筆刷卡撞 actor FK,後者讓系統身分跑進操作者下拉;拒繼續';
  END IF;

  -- ⓖ 有效權閘 + ACL 窮舉(A8c2 版式逐字照抄;CREATE OR REPLACE 不動 ACL,這裡驗它真的沒動)
  IF has_function_privilege('anon',          'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR has_function_privilege('service_role',  'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE')
     OR NOT has_function_privilege('payment_confirmer', 'public.confirm_order_payment(uuid,integer,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'OP3 有效權閘異常 — confirm 應只 payment_confirmer 可呼(含繼承);拒繼續';
  END IF;
  DECLARE v_grantees text;
  BEGIN
    SELECT string_agg(g, ',' ORDER BY g)
      INTO v_grantees
      FROM (SELECT DISTINCT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
                   || CASE WHEN a.is_grantable THEN '+GRANTOPT' ELSE '' END AS g
              FROM pg_proc p, aclexplode(p.proacl) a
             WHERE p.oid = 'public.confirm_order_payment(uuid,integer,text)'::regprocedure
               AND a.privilege_type = 'EXECUTE') t;
    IF v_grantees IS DISTINCT FROM 'payment_confirmer,postgres' THEN
      RAISE EXCEPTION 'OP3 ACL 窮舉異常 — EXECUTE grantee 全集=[%];拒繼續', v_grantees;
    END IF;
  END;

  -- ⓗ SECDEF fail-open 面:**三張表**都要對齊(A8c2 只驗兩張,OP3 新增 order_payments 這張)
  -- 🔴 這是本片相對 A8c2 唯一擴大的守門面:card 腿是**寫**,而 SECDEF 身分寫不進去時
  --    症狀是「翻單成功、錢帳落 0 列」或整筆紅,而且可能只在某些路徑上才炸。
  -- 🔴 只斷言不 ALTER 的理由見檔頭(這支是既有的正式站金流 RPC,不是本片新建的函式)。
  DECLARE v_fn_owner oid; v_bad text;
  BEGIN
    SELECT proowner INTO v_fn_owner FROM pg_proc WHERE oid='public.confirm_order_payment(uuid,integer,text)'::regprocedure;
    SELECT string_agg(c.relname, ',') INTO v_bad
      FROM pg_class c
     WHERE c.oid IN ('public.orders'::regclass, 'public.order_cancellations'::regclass,
                     'public.order_payments'::regclass, 'public.staff'::regclass)
       AND (c.relowner <> v_fn_owner OR c.relforcerowsecurity);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'OP3 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on;'
                      'card 腿會寫不進去(落 0 列或整筆紅)⇒ 停下人工對齊 owner,不由本片自行 ALTER', v_bad;
    END IF;
    -- 🔴 owner 對齊還不等於寫得進:再問**欄級** INSERT 權(表級 ACL 攤平看不到欄級 GRANT,
    --    memory `reference_pg-table-acl-flatten-blind-to-column-grants`)。
    -- ⚠️ **誠實邊界(codex 關卡2 nit,他說得對)**:上一道已經要求「函式 owner = 表 owner」,
    --    而 owner 天生對自己的表有全部欄權 ⇒ 這道在**絕大多數情況下恆真、近乎零新增證據**。
    --    留著的唯一理由:owner **可以**被 `REVOKE INSERT (col) ON … FROM` 自己(PG 允許),
    --    那時上一道仍綠而這道會紅。不誇大它的價值,但那個縫是真的存在。
    SELECT string_agg(x.col, ', ' ORDER BY x.col) INTO v_bad
      FROM unnest(ARRAY['order_id','rail','amount','received_at','rec_trade_id','actor']) x(col)
     WHERE NOT pg_catalog.has_column_privilege(v_fn_owner, 'public.order_payments'::regclass, x.col, 'INSERT');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'OP3 SECDEF 可寫性 — 函式 owner 對 order_payments 的這些欄沒有 INSERT 權:%', v_bad;
    END IF;
  END;

  RAISE NOTICE 'OP3 結構驗收通過:A8c2 八道碼錨與兩道順序錨全在(zero-regression)、card 腿恰 1 條且欄位清單與六個值逐字、'
               'actor 守門(P2B36)在且排在 card 腿之前、card 腿在 PF-C 之後且在 paid 冪等樹之後(重放不落第二列的承重)、'
               'orders 的 rec UNIQUE indexdef 與 valid 狀態未漂移、card 軌兩道 partial unique 都在、'
               'staff 的 payment_confirmer 列在且 is_active=false(不進操作者下拉)、'
               'EXECUTE 有效權與 ACL 窮舉未被 CREATE OR REPLACE 動到、'
               'SECDEF 對 orders/order_cancellations/order_payments/staff 四張表 owner 對齊且 FORCE RLS 全關、'
               '函式 owner 對 card 腿六欄皆有欄級 INSERT 權。🔴 行為證據不在這裡,在 scripts/op3-verify.sh(十三格)';
END
$op3_asserts$;

COMMIT;
