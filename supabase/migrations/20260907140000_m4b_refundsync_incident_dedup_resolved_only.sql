-- ═══ M-4b:超退事故去重加上 resolved_at IS NULL ═══
-- 來源:貼板 80 補審 codex R1 must-fix ①。主視窗 A 裁:修進新貼板, 不回滾。
--
-- 🔴 病(codex R1 逐字):「訂單先超退、事故處理完並填 resolved_at;之後另一筆補登再次超額
--    ⇒ B 放行, 而同步器的 NOT EXISTS 連已結案事故也算 ⇒ 既不開新單, 也不重新開啟舊單。
--    健康檢查只計未結案事故 ⇒ 這次異常可能完全不告警。」
--    座標 20260905440000…:358(去重)· 20260905290000…:200(健康檢查只數 resolved_at IS NULL)
--
-- ✅ 修法:去重的 NOT EXISTS 加 `AND i.resolved_at IS NULL`。本體其餘逐字不動。
--
-- 🔴🔴 **本檔的閘全部改用 md5(prosrc) 釘死, 不用字面 strpos —— 而那是被打出來的**:
--    codex 對本檔第一版判 FAIL, 並用【記憶體突變】證明我的事後閘 A3 是【恆真】的:
--    我用 `strpos(v_src,'NOT EXISTS')` 當「去重還在」的證據, 而本檔第 152 行的【註解】裡
--    就有那個字 ⇒ **把真正的去重判斷整段刪掉, 那道閘照樣印綠。**
--    📌 這正是「註解被 grep 當成碼」那一族 —— 而我在同一天已經撞過它一次。
--    ⇒ 改成比對 `md5(p.prosrc)`:prosrc 是【安裝進資料庫的函式本體】, 註解改不動它,
--      換行、空白、字面順序也騙不過它。**一個等號取代四道字面閘。**
--    ⚠️ 代價要寫明:md5 釘死 ⇒ **來源版本只要動一個字, 本支就會拒貼**。那是刻意的。
--
-- 🔬 三個 md5 都是量到的, 不是算的(2026-09-07 唯讀):
--    · 正式庫現行 prosrc md5 = 5ca774441f6b84119ccb361aa8a0f18a(len 4720)
--    · repo 最新一代 20260905440000:260 的 body md5 = 5ca774441f6b84119ccb361aa8a0f18a(len 4720)
--      ⇒ 兩者相同 ⇒ 正式庫現行就是我抄的那一版
--    · 本支貼完應該長成 md5 = 38dc32ef2ad275588363db641f2019e3(len 4770)
--    正式庫該名字只有一個多載:`pcm_sync_order_refund_payment_status(uuid)`;secdef=t;
--    proconfig = `search_path=""`。以上四項下面都有閘在釘。
--
-- 🛑 **本檔的「整筆回滾」不是它自己保證的** —— 它需要執行端把整支包在同一個交易裡。
--    ⇒ 所以本檔自己寫了 BEGIN / COMMIT(codex 指出:只寫在註解裡不算數)。

BEGIN;

-- ══ 1. 前置閘 ═══════════════════════════════════════════════════════
DO $pre$
DECLARE v_oid oid; v_md5 text; v_cfg text; v_sec boolean; v_n integer; v_own text;
BEGIN
  -- 🔴 **[codex R2 4a]** 檢查與替換之間有競態:我通過前置閘之後、CREATE OR REPLACE 之前,
  --    另一個 session 可以替換同一支函式並提交 ⇒ 事後雜湊仍然吻合我, 而我已經蓋掉它。
  --    `BEGIN` 沒有把「版本檢查」變成原子的條件更新。
  --    ⇒ 拿一把**交易級**的 advisory lock。
  --    🔴🔴 **[R3 N2]「讓同一時間只有一個貼板能動這支函式」這句話, 我原本寫得比事實大。**
  --      實查:全 repo `advisory` 字面只有 `20260906700000`(鍵是 supplier uuid, 與本鍵不同),
  --      而**換過同一支函式的 `20260905440000` 零 advisory` ⇒ **今天這把鎖一個人都擋不到。**
  --      ⇒ 📌 它擋的是**未來也拿同一把鎖的人**;現在放它, 是為了讓下一支有東西可以對上。
  --      ⚠️ 不受它管的**不只**「SQL Editor 手動改的人」—— 更現實的是**別支 migration / 重跑 440000**。
  --      (我原本的但書只點名前者, 而那不是現實中真的會發生的那一種。)
  --    🔵 **[R3 N1]** 鍵用 `hashtextextended(x, 0)` 不用 `hashtext(x)` —— 全隊既有唯一用法是前者
  --      (`20260906700000…:309,479`)。兩者鍵值不同 ⇒ 下一支照慣例寫的人會拿到**另一把鎖**, 而兩邊都不會紅。
  --    🔵 **[R3 N3]** 這是**等待型**不是 fail-fast ⇒ 真的撞上會**不印任何東西地掛著**, 看起來像當掉而它是對的。
  --      ⇒ 照全隊慣例(`20260906700000…:43` / `20260901030000…:182`)設 `lock_timeout = '5s'`, 讓它變成會講話的失敗。
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('pcm_sync_order_refund_payment_status', 0));

  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_sync_order_refund_payment_status';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '前置閘 P1:該名字在 public 有 % 個多載(要 1 個)⇒ 停下人判', v_n;
  END IF;

  v_oid := 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;

  SELECT md5(p.prosrc), p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''),
         pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_md5, v_sec, v_cfg, v_own
    FROM pg_proc p WHERE p.oid = v_oid;

  IF v_md5 = '38dc32ef2ad275588363db641f2019e3' THEN
    RAISE EXCEPTION '前置閘 P2:正式庫已經是本支要產生的版本 ⇒ 已 apply 過, 拒絕重貼';
  END IF;

  IF v_md5 <> '5ca774441f6b84119ccb361aa8a0f18a' THEN
    RAISE EXCEPTION '前置閘 P3:正式庫現行 body md5 = % ⇒ 不是我抄的那一版(要 5ca77444…)⇒ 停下, 不要蓋掉別人的東西', v_md5;
  END IF;

  IF NOT v_sec THEN
    RAISE EXCEPTION '前置閘 P4:現行不是 SECURITY DEFINER ⇒ 前提已變, 停下';
  END IF;
  IF v_cfg <> 'search_path=""' THEN
    RAISE EXCEPTION '前置閘 P5:現行 proconfig = % ⇒ 不是預期的 search_path="" ⇒ 停下', v_cfg;
  END IF;

  -- 🔴 **[codex R2 4b]** owner 沒釘 ⇒ 若 owner 已被換成讀不到事故表的角色,
  --    body / DEFINER / search_path 可以全部吻合, 而 SECURITY DEFINER 跑起來會權限失敗或被 RLS 過濾;
  --    而 `CREATE OR REPLACE` **不會**把 owner 換回來 ⇒ 我貼完也修不好它。
  IF v_own <> 'postgres' THEN
    RAISE EXCEPTION '前置閘 P6:現行 owner = %(要 postgres)⇒ SECURITY DEFINER 會以別人的身分跑, 停下', v_own;
  END IF;

  -- 🔴 **[R3 N4]** 我釘了函式的 owner, 卻沒釘**那張表**的。
  --    本片的整個推論是「去重那個 NOT EXISTS 讀得到, 因為 definer 是表主人、繞得過 RLS」。
  --    而 `20260905290000…:155-159` 自己逐字寫過:誰對 `pcm_incident` 下 `FORCE ROW LEVEL SECURITY`,
  --    definer 讀不到會**回 0 列而且安靜** ⇒ 去重靜默失效 ⇒ **本片要修的那個病原樣回來。**
  --    ⇒ 把那張表的 owner 與 force_rls 一起釘住。(唯讀量到的現況:owner=postgres · rls=t · force_rls=f)
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = 'pcm_incident'
                    AND pg_catalog.pg_get_userbyid(c.relowner) = 'postgres'
                    AND NOT c.relforcerowsecurity) THEN
    RAISE EXCEPTION '前置閘 P7:public.pcm_incident 的 owner 不是 postgres, 或已被下 FORCE ROW LEVEL SECURITY ⇒ 去重會安靜地讀到 0 列, 停下';
  END IF;

  RAISE NOTICE '前置閘 P1-P7 全過:鎖到手 · 單一多載 · body md5 · DEFINER · search_path · 函式 owner · pcm_incident owner 與 force_rls。';
END
$pre$;

-- ══ 2. 本體(逐字抄自 20260905440000:260, 只換去重那一行)═══════════════
CREATE OR REPLACE FUNCTION public.pcm_sync_order_refund_payment_status(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- 🔴🔴 **[2026-09-05]`search_path` 從 `public, pg_temp` 改成 `''`**(線【資料】`-db` 的閘抓的)。
--    ⛔ ~~原版(`20260823020000:243`)是 `public, pg_temp`~~ —— 本片是 `CREATE OR REPLACE`,
--      而**那道閘只看檔面, 新檔一律要求 `''`**。
--    🔵 `''` = 不信任任何 schema ⇒ body 裡的物件必須帶全名, 攻擊者無法用同名物件劫持。
-- 🛑 **而「body 裡一律加 `pg_catalog.`」這句話是【錯的】, 我逐個實測過**:
--      🔬 `SELECT pg_catalog.sum(1)`                    ⇒ 1              ✅ 可以加
--      🔬 `SELECT pg_catalog.current_setting('transaction_isolation')` ⇒ read committed  ✅ 可以加
--      🔬 `SELECT pg_catalog.coalesce(1,2)` ⇒ **ERROR: function pg_catalog.coalesce(integer, integer) does not exist**
--      ⇒ 🔴 `COALESCE` / `NULLIF` / `GREATEST` / `LEAST` 是 **SQL 特殊語法, 不是可加 schema 的函式**。
--    🔵 樣板 `20260904200000` 自己 body 裡用的也是**裸 `coalesce`** ⇒ 這不是我的例外, 是慣例。
--    🎯 **⇒ 一句「一律加全名」照字面執行會讓整支貼不下去** —— 而它讀起來完全合理。
--      (今晚 `20260904230000` 已經被同一件事咬過一次, R2 抓到 3 處。)
SET search_path = ''
AS $fn$

DECLARE
  v_ps     text;
  v_total  integer;
  v_moved  bigint;
  v_target text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 缺 order_id';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 需在 READ COMMITTED 下執行(現為 %;RR 下鎖後 SUM 讀不到並行提交)', pg_catalog.current_setting('transaction_isolation');
  END IF;

  SELECT o.payment_status::text, o.total INTO v_ps, v_total
    FROM public.orders o WHERE o.id = p_order_id
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 不存在(FK 應擋住;資料異常)。🔴 本函式由多個呼叫端共用 —— 看呼叫堆疊, 錯不一定在卡片那條路', p_order_id;
  END IF;

  -- 🔴🔴 **[2026-09-05 ⟦b4-MANREFUNDNOOWNER2⟧]本片唯一的行為改動:把人工退款也算進來。**
  --    ⛔ ~~原本只加總 `order_refunds`(卡片軌)~~ —— 而 `admin_record_manual_refund` 寫的是
  --      **另一張表** `order_manual_refunds`, 然後呼叫本函式 ⇒ 本函式算到 0 ⇒ 提早 return
  --      ⇒ 🎯 **客人的人工退款登記進去之後, `payment_status` 從來沒有被改過。**
  --    🔬 掃描實測(2026-09-04, 分母 2,320 支檔):全 repo 六支活的 payment_status 寫入端,
  --      `order_manual_refunds` **全部 0 次**;而 `admin_record_manual_refund` **只呼叫本函式**
  --      ⇒ **人工退款那條路唯一到得了的寫入端, 就是這一支。** ⇒ 沒有別人在管。
  --    🔵 述詞用 `voided_at IS NULL` 而**不是** `status = 'confirmed'` ——
  --      🔬 `order_manual_refunds` 建表(`20260820010000`)**沒有 status 欄**;
  --      作廢走 `voided_at`(`20260820090000` 後補)。
  --      ⇒ 📌 這與 `20260904230000:239` 用的述詞**逐字相同** ⇒ 兩邊對齊, 不是各寫各的。
  SELECT COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_refunds
   WHERE order_id = p_order_id AND status = 'confirmed';

  SELECT v_moved + COALESCE(pg_catalog.sum(refund_amount), 0) INTO v_moved
    FROM public.order_manual_refunds
   WHERE order_id = p_order_id AND voided_at IS NULL;

  -- 🔴🔴 **第三段帳本(片③ 新增;關卡1 R1 must-fix)** —— 「先判失敗、後來更正為錢有動」的卡退。
  --    座標:`20260814190000:417-423` **自己就在扣這一段** ⇒ 少了它, 那筆錢會被算成 0
  --    ⇒ 狀態錯降回 `paid`, 而**錢其實出去了**。
  --    📌 同一個問題在兩支函式各有一份答案 ⇒ **口徑分岔在這裡特別致命。**
  SELECT v_moved + COALESCE(pg_catalog.sum(r.refund_amount), 0) INTO v_moved
    FROM public.order_refunds r
    JOIN public.order_refund_effective_verdict v ON v.refund_id = r.id
   WHERE r.order_id = p_order_id
     AND r.status = 'failed'
     AND r.failed_reason = 'manual_failed'
     AND v.corrected_to = 'money_moved';

  -- ⛔ ~~IF v_moved <= 0 THEN RETURN v_ps; END IF;~~ **片③ 拿掉這道早退。**
  --    🔴 留著它 ⇒ 全部退款被作廢時 `v_moved = 0` ⇒ 早退 ⇒ **永遠走不到 `paid` 那一支**
  --      ⇒ `payment_status` 卡死在 `refunded`, 而 Sean 2026-08-22 `Q-B=甲` 拍的「作廢後照事實降回」
  --        **靜靜地不存在**(本函式自己的 COMMENT 逐字記過這件事)。
  --    🛑 **而拿掉它會讓一批本來走不到下面那道 domain 閘的單開始撞它** —— 那是刻意的, 見下。

  IF v_ps NOT IN ('paid', 'partiallyRefunded', 'refunded') THEN
    RAISE EXCEPTION 'pcm_sync_order_refund_payment_status: 訂單 % 的 payment_status=% 不允許進入退款轉移(domain 轉移表);拒繼續。🔴 本函式由多個呼叫端共用(卡片結案 / 非卡登記 / …)—— **錯不一定在卡片那條路**, 看呼叫堆疊', p_order_id, v_ps;
  END IF;

  -- 🔴 **`v_moved > 0` 那一半非有不可**(關卡1 R1 must-fix):`v_moved >= v_total` 在
  --    `0 >= 0` 時**成立** ⇒ 一張 `total = 0` 的單、零退款, 會被算成「已全額退款」。
  v_target := CASE WHEN v_moved > 0 AND v_moved >= v_total THEN 'refunded'
                   WHEN v_moved > 0                        THEN 'partiallyRefunded'
                   ELSE                                         'paid' END;

  -- 🔴🔴 **超退留痕(片③;`-f8` 2026-09-05 裁【丙】)** —— 卡退金額**明訂無上界**
  --    (`20260801120000:200-201`)⇒ 總額 1,000 而帳本 1,200 時上面算出 `refunded`
  --    ⇒ 📌 **看起來完全正常, 而 200 元的異常沒有任何人會知道。**
  --    ⛔ ~~用 `RAISE WARNING` + 標紅~~ —— `20260902020000:1-15,211-229` **逐字**說
  --      `WARNING` **員工看不到**、**不得與 UI／等價告警分開上線** ⇒ 那個先例**否定**那個做法。
  --    ✅ 改寫進小事故表, 那就是它要的「等價告警」⇒ 零 UI 工作、不算分開上線。
  --    🛑 **不擋** —— 擋了會讓一筆已經發生的事無法登記, 那正是 `⟦PCM01⟧` 否決的方向。
  -- 🔴 **去重(關卡2 R1 must-fix)**:`pcm_incident_log` 是**無去重的 INSERT**, 而本函式
  --    **有多個呼叫端**、每次退款動作都會被叫 ⇒ 一個持續存在的超退會**累積成一堆事故列**
  --    ⇒ 📌 **而告警是「事故 > 0 就叫」** ⇒ 那會變成同一件事叫很多次。
  --    🔵 本函式是 SECURITY DEFINER / owner=postgres, 而 `pcm_incident` 也是 postgres 的
  --      ⇒ 表主人預設 bypass RLS ⇒ 這個 NOT EXISTS 讀得到(拋棄式 PG 已驗)。
  IF v_moved > v_total
     AND NOT EXISTS (SELECT 1 FROM public.pcm_incident i
                      WHERE i.kind = 'refund_over_total' AND i.subject_id = p_order_id
                        AND i.resolved_at IS NULL) THEN
    PERFORM public.pcm_incident_log(
      'refund_over_total', p_order_id,
      pg_catalog.format('退款總額 %s 超過訂單總額 %s(差 %s)—— 由 pcm_sync_order_refund_payment_status 記下, 未擋',
                        v_moved, v_total, v_moved - v_total));
  END IF;

  -- 🔴 **`v_ps <> 'refunded'` 那一半拿掉了** —— 它就是「只升不降」。
  IF v_ps <> v_target THEN
    UPDATE public.orders SET payment_status = v_target::public.payment_status
     WHERE id = p_order_id;
    v_ps := v_target;
  END IF;

  RETURN v_ps;
END;
$fn$;

-- ══ 3. 事後閘 ═══════════════════════════════════════════════════════
DO $post$
DECLARE v_oid oid; v_md5 text; v_cfg text; v_sec boolean; v_n integer; v_own text;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'pcm_sync_order_refund_payment_status';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '事後閘 A1:貼完之後有 % 個多載 ⇒ 我不小心建了新簽章, 回滾', v_n;
  END IF;

  v_oid := 'public.pcm_sync_order_refund_payment_status(uuid)'::regprocedure;
  SELECT md5(p.prosrc), p.prosecdef, coalesce(array_to_string(p.proconfig, ','), ''),
         pg_catalog.pg_get_userbyid(p.proowner)
    INTO v_md5, v_sec, v_cfg, v_own FROM pg_proc p WHERE p.oid = v_oid;

  IF v_md5 <> '38dc32ef2ad275588363db641f2019e3' THEN
    RAISE EXCEPTION '事後閘 A2:貼完的 body md5 = %(要 38dc32ef…)⇒ 產生的東西不是我預期的, 回滾', v_md5;
  END IF;

  IF NOT v_sec THEN
    RAISE EXCEPTION '事後閘 A3:SECURITY DEFINER 掉了 ⇒ 回滾(CREATE OR REPLACE 省略它會退回 INVOKER)';
  END IF;
  IF v_cfg <> 'search_path=""' THEN
    RAISE EXCEPTION '事後閘 A4:proconfig 變成 % ⇒ search_path 被洗掉, 回滾', v_cfg;
  END IF;
  IF v_own <> 'postgres' THEN
    RAISE EXCEPTION '事後閘 A5:owner 變成 % ⇒ 回滾', v_own;
  END IF;

  RAISE NOTICE '事後閘 A1-A5 全過:單一多載 · body md5 = 38dc32ef… · DEFINER · search_path · owner=postgres。';
END
$post$;

COMMIT;

-- ══ 4. 這一支【證不到】什麼(codex R1 對本檔第一版點出, 逐條留著)═══════
--  · 🔴 **它沒有判「超退曾經消失過」** —— 事故結案後, 若帳本沒變(仍然超退),
--    下一次同步照樣會開一張新事故。codex 逐字:「反例:總額 1,000、退款 1,200, 結案但帳本不變;
--    只重算, 照樣新增事故。」⇒ 📌 **這是刻意的還是問題, 要人判**:
--    異常還在而有人把單結掉 ⇒ 再開一張, 從告警的角度是對的;從噪音的角度是壞的。
--    ✅ **[2026-09-07 主視窗 A 裁 甲]**:**刻意的 —— 異常還在就該一直叫。**
--    ⇒ 結案不會讓一個【仍然成立】的超退安靜下去;要讓它安靜, 得把帳本修對, 不是把單結掉。
--    📌 這一句留在這裡, 是因為讀到上面那個反例的人, 應該在同一個地方讀到「這是刻意的、誰拍的」。
--  · 🔴🔴 **[R3 範圍外附記, 我自己驗過 —— 這一條會改變「這一貼修好了什麼」的字面]**
--    **`public.pcm_incident.resolved_at` 在全 repo 沒有任何寫入端。**
--    我的驗(可重跑):掃 `supabase/migrations/ apps/ packages/`(排除 .next/dist/node_modules)找
--    `SET resolved_at` / `resolved_at =` 的非註解行 ⇒ 只有 **3** 處, 而那三處逐字寫的是
--    `UPDATE public.payment_double_charge_anomalies a`(`20260624120004…:135 :156 :176`)—— **另一張表**。
--    正對照:同一把尺換 `voided_at` ⇒ **5** 處命中 ⇒ 那個 0 不是尺沒接上。
--    ⇒ 📌 **所以本支今天是 no-op**:R1 描述的病(「填了 resolved_at 之後…」)在正式庫
--      **還沒有路徑走得到**。要重現或驗證, 必須有人手動 `UPDATE pcm_incident SET resolved_at = …`。
--    🛑 **這不影響本支的正確性, 它影響的是宣稱**:貼完不可以說「修好了一個會發生的漏報」,
--      只能說「把一個**未來會發生**的漏報先關掉了」。⚠️ 而它會在有人做結案 UI 的那一天**自己變成有效**。
--    ⚠️ 我讀不到 `pcm_incident` 的內容(`permission denied`)⇒ **答不出正式庫現在有幾列已結案**。
--  · 事故列去重 ≠ 通知只發一次。本支只動事故列, 不保證告警頻率。
--  · 本支沒有做 DB 寫入實測(我這個窗沒有寫入權)。codex 給了可跑的情境骨架,
--    要在拋棄式 DB 上跑;預期事故總數依序 1、2、3、4(後兩次正是上面那個反例)。
