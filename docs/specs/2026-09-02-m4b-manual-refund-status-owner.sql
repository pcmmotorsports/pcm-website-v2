-- 🛑🛑🛑 **尚未通過審查 —— 不得貼、不得 apply、不得當交件。** 🛑🛑🛑
--    2026-09-02 03:xx。前一版 codex 判 **FAIL(10 must-fix + 2 nit)**,
--    其中一條:它只加「會寫 refunded」而沒加「作廢會降回」
--    ⇒ **作廢之後狀態卡死在 `refunded`** —— 那是一個【今天不存在】的新錯狀態。
--    本檔是修正版, **而它的 harness 與 codex 複審都還沒跑完**。
--    ⇒ 📌 通過之後這一段會被拿掉, 而在那之前:**看到這一段就不要貼。**
-- ════════════════════════════════════════════════════════════════════════
-- ⟦b4-MANREFUNDNOOWNER⟧ 人工退款之後,訂單狀態終於會跟著改 —— 而作廢之後它也會降回來
--
-- 🛑 **本檔在 `docs/specs/`,不在 `supabase/migrations/`** —— 那個目錄底下每一支都會被
--    26 支 harness 的 provision 依序 apply;而檔頭寫「不要 apply」是給人看的,**跑它的是迴圈**。
--
-- ══ 給 Sean 的白話(貼之前先讀這一段)══════════════════════════════════════
--
-- 【它修什麼】你在後台登記一筆「現金/匯款退款」之後,那張訂單**還是寫著「已付款」**。
--   退了 400 的單,畫面上看起來像一毛都沒退。🔴 **今天按下去就是這樣。**
--
-- 【貼了會看到什麼】三件事:
--   ① 登記人工退款之後,那張單會變成「部分退款」或(退滿時)「已退款」。
--   ② **把那筆退款作廢之後,它會降回去** —— 全部作廢就回「已付款」。
--      🔵 這是你 2026-08-22 拍過的(`Q-B=甲` 開放降級),而它一直沒有做完。
--   ③ 卡片退款那條路的**篩選規則一個字都沒改**。
--      ⚠️ **但有一種情況它的結果會變,而那個變化是對的**:
--        同一張單既有人工退款、又有卡片退款時,**狀態改成按兩本帳【合計】算**。
--        (例:總額 1000,先人工退 600、再確認卡片退 400 ⇒ 舊版只看 400 算「部分退款」,
--         新版合計 1000 ⇒「已退款」。舊版那個答案是錯的。)
--      🛑 **所以不能說「卡片那條路完全沒有改變」** —— 篩選規則沒變,而混合退款的結論會變。
--
-- 【貼錯了怎麼還原】還原 SQL 在另一支檔:`還原-人工退款狀態-20260902.sql`。
--   **整支貼下去就對,不用挑段落。**
--   🔴 還原之後,人工退款又會變成不改狀態 —— 也就是今天的樣子。
--   🔴 它【不會】把已經被改對的訂單狀態改回去。
--
-- 【它會不會弄壞現在能用的東西】兩格我特別驗過,因為它們差一點就會:
--   ① 今天有一種單是「客人匯了款、後台登記了收款,而系統仍寫著**未付款**」
--      (那是另一件事 `⟦b4-NONCARDPAID1⟧`,還沒修)。這種單如果被人工退款,
--      照最直覺的寫法會**直接報錯、整筆登記不進去**。⇒ 本檔多寫一個分支讓它照舊。
--   ② 只加「會寫已退款」而不加「作廢會降回」⇒ 作廢之後那張單會**卡死在已退款**。
--      🛑 **那是一個今天不存在的新錯法** ⇒ 所以兩件必須一起做,不能只做一半。
--
-- ══ 給下一個維護者 ════════════════════════════════════════════════════════
--
-- 🔴🔴 **檔名會騙人,而它是誠實的騙**:`..._record_calls_sync.sql` 逐字寫「只加這一行」,
--    而它真的呼叫了同步器 —— 🛑 **而那支同步器讀的是另一張表**。
--    ⇒ 📌 **「A 呼叫了 B」與「B 做了那件事」是兩個宣稱,而檔名只答得出前一個。**
--    ⇒ ⇒ **任何用「有沒有接線」當判準的稽核,都會把這一格算成已修。**
--
-- 🔵 **本檔就是 `20260823010000:213-221` 預告的那個「片3」的一部分。**那段 COMMENT 逐字寫著:
--    「片3 會換成【已確認動錢】三段聚合 + 三態(含回 paid)+ 依 Sean 2026-08-22 Q-B=甲 開放降級。
--      🔴🔴 片3 必須【移除】上面那道早退…留著它 ⇒ 全部退款被作廢時 v_moved=0 ⇒ 早退
--      ⇒ payment_status 卡死在 refunded ⇒ Sean 拍板『作廢後照事實降回』的行為靜靜地不存在,
--      而 typecheck / lint / build 與片1 片2 的全部驗收都是綠的。」
--    ⚠️ **而本檔【沒有移除】那道早退,是在早退【裡面】實作降級** —— 差別與理由:
--      移除它 ⇒ 每一個呼叫端在「零退款」時都會走到下面那道 domain 閘 ⇒ 非退款域的單會開始拋錯
--      ⇒ 那是一個新的回歸。⇒ 本檔改成:早退時若狀態**已在退款域**才降回,其餘照舊回傳。
--      ⇒ 📌 **同一個結果,而爆炸半徑小一個量級。**
--
-- ⚠️ **真正的呼叫端只有兩個**(全 repo 產線 SQL 實查;⛔ ~~本檔前一版寫「5 處」~~ 那是把
--    **字面命中**當成 runtime 呼叫,其餘命中是註解 / catalog 查詢 / 位置斷言):
--      `20260823010000:402` 卡片結案 · `20260823020000:478` 人工登記
--    🔴 而 `admin_void_manual_refund` **沒有**呼叫它 —— **那正是「作廢之後卡死」能發生的原因**,
--      所以本檔 §2 把它接上。

BEGIN;

-- ── 0. 前置閘:確認要改的是我以為的那一版(整支 body 指紋,不是三個可共存的字串)──
DO $pre$
DECLARE v_src text; v_md5 text; v_secdef boolean; v_cfg text; v_owner text;
BEGIN
  SELECT p.prosrc, pg_catalog.md5(p.prosrc), p.prosecdef,
         pg_catalog.coalesce(pg_catalog.array_to_string(p.proconfig, ','), '<無>'),
         pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_src, v_md5, v_secdef, v_cfg, v_owner
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  IF v_src IS NULL THEN
    RAISE EXCEPTION '前置:找不到同步器 ⇒ 20260823010000/020000 還沒 apply,拒繼續';
  END IF;
  -- 🔴 為什麼是整支 md5 不是幾個字串:三個字串可以與【一個更新的版本】共存
  --    ⇒ 那樣本檔會把別人後來加的守門/稽核/安全強化**靜默洗掉**(codex must-fix)。
  --    這個值 = `20260823020000:239` 那一版,而它與正式庫實測值相同
  --    (Sean 2026-08-24 在 SQL Editor 本人貼、螢幕輸出;記在 APPLIED.tsv 那一列)。
  IF v_md5 <> '0473092c723ae33d8538886c592a5b8a' THEN
    RAISE EXCEPTION '前置:同步器的 body 指紋不是我以為的那一版。'
                    '實得 md5=% ⇒ 有人改過它(或它已經是本檔的版本)。'
                    '🛑 貼下去會把那個版本整支洗掉 ⇒ 停下來確認,拒繼續。'
                    '(期望 0473092c723ae33d8538886c592a5b8a = 20260823020000:239 那一版)', v_md5;
  END IF;
  IF NOT v_secdef OR v_cfg <> 'search_path=public, pg_temp' OR v_owner <> 'postgres' THEN
    RAISE EXCEPTION '前置:同步器的安全屬性不是我以為的(secdef=% cfg=% owner=%)⇒ 拒繼續',
                    v_secdef, v_cfg, v_owner;
  END IF;
  IF to_regclass('public.order_refund_effective_verdict') IS NULL THEN
    RAISE EXCEPTION '前置:order_refund_effective_verdict 這個 view 不在 ⇒ 第三段聚合算不了(#473b-1 未 apply),拒繼續';
  END IF;
  IF to_regprocedure('public.admin_void_manual_refund(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION '前置:admin_void_manual_refund 不在 ⇒ §2 接不上 ⇒ 作廢之後狀態會卡死,拒繼續';
  END IF;
END
$pre$;

-- ── 1. 同步器:三段聚合 + 開放降級 ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_card   bigint;   -- ⟦MANREFUND⟧ 卡片那半(confirmed + 被更正成 money_moved 的 failed)
  v_manual bigint;   -- ⟦MANREFUND⟧ 人工那半(未作廢的)
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  -- ⟦MANREFUND⟧ 卡片那半:兩段, 口徑逐字對齊 `pcm_order_refundable_remaining`(#473b-1)。
  -- 🔴 第二段不是可有可無:一筆被人工判定成 failed、而事後被更正成【錢真的動了】的列,
  --    在「還能退多少」那支函式裡是算的。兩支對同一筆錢給不同答案 ⇒ 客人會看到互相矛盾的畫面。
  -- 🔵 而一般的 `processing` 與**未被更正**的 `failed` 都不算 —— 那兩種錢沒有離開。
  SELECT COALESCE(SUM(r.refund_amount), 0) INTO v_card
    FROM public.order_refunds r
   WHERE r.order_id = p_order_id AND r.status = 'confirmed';
  v_card := v_card + COALESCE((
      SELECT SUM(r.refund_amount)
        FROM public.order_refunds r
        JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
       WHERE r.order_id = p_order_id
         AND r.status = 'failed'
         AND r.failed_reason = 'manual_failed'
         AND v.corrected_to = 'money_moved'), 0);

  -- ⟦MANREFUND⟧ 人工那半。`voided_at` 非空 = 那筆退款被作廢 ⇒ 錢沒有真的離開 ⇒ 不計。
  -- 🔵 這張表【刻意沒有 status】(COMMENT 逐字寫那不是還沒加)⇒ 作廢欄是它唯一的「不算數」訊號。
  SELECT COALESCE(SUM(m.refund_amount), 0) INTO v_manual
    FROM public.order_manual_refunds m
   WHERE m.order_id = p_order_id AND m.voided_at IS NULL;

  v_moved := v_card + v_manual;

  IF v_moved <= 0 THEN
    -- 🔴🔴 ⟦MANREFUND⟧ 這裡是 Sean 2026-08-22 `Q-B=甲`「作廢後照事實降回」落地的位置。
    --    `20260823010000:215` 逐字警告過:留著一個【無條件】的早退 ⇒ 全部退款被作廢時
    --    payment_status 會卡死在 refunded, 而所有驗收都是綠的。
    --    ⇒ 而本檔【不移除】早退, 是在它裡面補降回 —— 移除它會讓每一個呼叫端在「零退款」時
    --      走到下面那道 domain 閘 ⇒ 非退款域的單開始拋錯 ⇒ 那是一個新的回歸。
    --    ⇒ 📌 只有【本來就在退款域】的才降回;其餘照舊原樣回傳。
    IF v_ps IN ('partiallyRefunded', 'refunded') THEN
      UPDATE public.orders SET payment_status = 'paid'::public.payment_status
       WHERE id = p_order_id;
      RETURN 'paid';
    END IF;
    RETURN v_ps;
  END IF;

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    -- 🔴🔴 ⟦MANREFUND⟧ 出口 —— 而它的範圍要寫準,不要只用一個例子解釋(codex must-fix)。
    --    **範圍**:任何不在那三值裡的狀態(今天是 `unpaid` 與 `partiallyPaid`),
    --    而且**卡片那半為 0**(也就是這筆錢只從人工帳本來)⇒ 不改狀態、也不拋錯。
    --    **為什麼**:改本檔【之前】人工那半根本不被加總 ⇒ v_moved 恆 0 ⇒ 提早 return ⇒ 不拋錯。
    --      沒有這個出口, 本檔會讓那種單的人工退款登記【整筆失敗】—— 一個今天能用的流程被弄壞。
    --    **代價明寫**:那種單的狀態仍然是錯的 —— 而它錯的原因是 `⟦b4-NONCARDPAID1⟧`(未修),
    --      不是本檔。本檔選擇【不越界去猜】。
    --    🔵 而卡片那半 > 0 時, 下面那道 RAISE 一個字都沒動 ⇒ 它守的東西沒有變窄。
    IF v_card = 0 THEN
      RAISE LOG 'pcm_sync_order_refund_payment_status: 訂單 % 狀態 % 不在退款域, 而本次只有人工退款 ⇒ 不改狀態也不拋錯(⟦b4-MANREFUNDNOOWNER⟧;該狀態本身是 ⟦b4-NONCARDPAID1⟧ 的缺口)', p_order_id, v_ps;
      RETURN v_ps;
    END IF;
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  v_target := CASE WHEN v_moved >= v_total THEN 'refunded' ELSE 'partiallyRefunded' END;
  -- 🔴🔴 ⟦MANREFUND⟧ 舊版這裡是 `IF v_ps <> 'refunded' AND v_ps <> v_target`——
  --    那個 `v_ps <> 'refunded'` 是【單調不降級】:一旦寫上 refunded 就再也下不來。
  --    ⇒ 作廢一部分退款之後該回 partiallyRefunded, 而它會卡在 refunded。
  --    ⇒ Sean 2026-08-22 `Q-B=甲` 已拍開放降級 ⇒ 拿掉它。
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- ── 2. 把作廢那支接上同步器 ──────────────────────────────────────────────
-- 🔴 **不手抄那 89 行** —— 用 `pg_get_functiondef` 把現況整份取出來、只插一行、再 EXECUTE 回去。
--    理由:手抄 89 行到一支交件檔裡,「抄漏一個 WHERE」與「抄對了」在 diff 上長得一樣。
-- 🔵 兩個 return 點都接:冪等那條路(已經作廢過)也要同步 —— 否則
--    「第一次作廢時同步失敗、第二次重按」會走冪等早退而永遠修不回來。
DO $wire$
DECLARE v_def text; v_n integer;
BEGIN
  v_def := pg_catalog.pg_get_functiondef('public.admin_void_manual_refund(uuid,text,text)'::regprocedure);
  IF pg_catalog.strpos(v_def, 'pcm_sync_order_refund_payment_status') > 0 THEN
    RAISE EXCEPTION '§2:那支已經接過同步器了 ⇒ 有人先做了或本檔已貼過,拒繼續';
  END IF;
  v_n := (SELECT pg_catalog.count(*)
            FROM pg_catalog.regexp_matches(v_def, 'RETURN pg_catalog\.jsonb_build_object\(', 'g'))::integer;
  IF v_n <> 2 THEN
    RAISE EXCEPTION '§2:接線錨在那支函式裡出現 % 次(預期恰 2 —— 冪等那條與正常那條)⇒ 它不是我以為的形狀,拒繼續', v_n;
  END IF;
  v_def := pg_catalog.replace(v_def,
    'RETURN pg_catalog.jsonb_build_object(',
    'PERFORM public.pcm_sync_order_refund_payment_status(v_row.order_id);' || pg_catalog.chr(10) ||
    '      RETURN pg_catalog.jsonb_build_object(');
  EXECUTE v_def;
END
$wire$;

-- ── 3. 後置斷言(貼完看到最後那兩行 NOTICE 才算成功)──────────────────────
DO $post$
DECLARE v_bare text; v_void text;
BEGIN
  SELECT pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g')
    INTO v_bare FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;

  IF pg_catalog.strpos(v_bare, 'order_manual_refunds') = 0 THEN
    RAISE EXCEPTION '後置:人工那本帳沒有被加總,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'voided_at IS NULL') = 0 THEN
    RAISE EXCEPTION '後置:少了「作廢的不算」那道篩,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'corrected_to') = 0 THEN
    RAISE EXCEPTION '後置:少了第三段(被更正成 money_moved 的 failed)⇒ 與「還能退多少」那支不同口徑,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'AND r.status = ''confirmed''') = 0 THEN
    RAISE EXCEPTION '後置:卡片第一段的算式不見了,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'domain 轉移表') = 0 THEN
    RAISE EXCEPTION '後置:那道 domain 閘不見了,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'v_card = 0') = 0 THEN
    RAISE EXCEPTION '後置:少了「只有人工退款時不拋錯」那個出口 ⇒ 會弄壞今天能用的登記流程,拒繼續'; END IF;
  -- 🔴 這兩道守的是【降級】那一半 —— 它是本檔與「只加會寫 refunded」之間的差別。
  IF pg_catalog.strpos(v_bare, 'v_ps <> ''refunded'' AND') > 0 THEN
    RAISE EXCEPTION '後置:單調不降級那道判斷還在 ⇒ 作廢之後狀態會卡死在 refunded,拒繼續'; END IF;
  IF pg_catalog.strpos(v_bare, 'IN (''partiallyRefunded'', ''refunded'')') = 0 THEN
    RAISE EXCEPTION '後置:早退裡的降回分支不見了 ⇒ 全部作廢之後回不到 paid,拒繼續'; END IF;

  SELECT p.prosrc INTO v_void FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.admin_void_manual_refund(uuid,text,text)'::regprocedure;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(v_void, 'pcm_sync_order_refund_payment_status', 'g')) <> 2 THEN
    RAISE EXCEPTION '後置:作廢那支的同步器呼叫不是恰 2 處(冪等那條 + 正常那條)⇒ §2 沒接乾淨,拒繼續'; END IF;

  RAISE NOTICE '⟦b4-MANREFUNDNOOWNER⟧ 後置斷言全過:三段聚合 / 作廢不計 / domain 閘與保護出口都在 / 開放降級 / 作廢那支已接上(2 處)';
  RAISE NOTICE '⟦b4-MANREFUNDNOOWNER⟧ ⚠️ 看到上面那一行 = 貼成功。沒看到 = 有問題, 不要當成功。';
END
$post$;

COMMIT;

-- 🎯 **還原 SQL 在【另一支檔】** —— `2026-09-02-m4b-manual-refund-status-owner-ROLLBACK.sql`。
--    放同一支只有兩種形狀:①活的 SQL ⇒ 貼的人會把剛裝好的當場拆掉 ②註解 ⇒ 那就不是「直接貼」。
--    ⇒ **兩種都不對,而共同成因是想把兩個用途塞進一支檔。**
-- — END —
