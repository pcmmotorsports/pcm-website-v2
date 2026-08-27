-- ============================================================================
-- 片1 行為測試(配 2026-08-25-saved-views-migration-draft.sql)
-- 🛑 草稿的測試,不是 migration 的一部分。跑法見檔尾。
-- ============================================================================
-- 🔴 每一發都要問:「這個檢查在【成立】與【不成立】兩個世界,會印不同的東西嗎?」
--    ⇒ 所以本檔配一份突變表(檔尾 §M),**沒有殺過突變的測試不算裝上**。
-- fixture:boss(管理者)· clerk(一般員工)· gone(停用)
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.expect(p_name text, p_actual text, p_expected text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL %: 期望 [%] 實得 [%]', p_name, p_expected, p_actual;
  END IF;
  RAISE NOTICE 'ok   %', p_name;
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_raise(p_name text, p_stmt text, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_stmt;
  RAISE EXCEPTION 'FAIL %: 期望被拒([%]), 而它【通過了】', p_name, p_msg;
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
  IF SQLERRM IS DISTINCT FROM p_msg THEN
    RAISE EXCEPTION 'FAIL %: 拒絕了而訊息不對。期望 [%] 實得 [%]', p_name, p_msg, SQLERRM;
  END IF;
  RAISE NOTICE 'ok   % (正確拒絕)', p_name;
END; $$;

-- 🔴 expect_code:與 expect 的差別是它【也接得住逃出來的例外】。
--    expect() 收的是「函式的回傳值」⇒ 函式若 RAISE, 例外在 expect 被呼叫【之前】就炸了
--    ⇒ 錯誤訊息裡沒有測試編號 ⇒ 看得到紅, 看不出是哪一格紅。
--    ⚠️ 這是 2026-08-28 跑 M11 突變時量到的:它紅了, 而紅的訊息是一句原始 DB 例外。
--    📌 **一個測試可以正確地紅, 而說不出自己是誰。**
--    ⚠️ 而 `EXECUTE` **看不到 PL/pgSQL 的區域變數** ⇒ 用到 `v_*_id` 的那幾格要走 `$1`。
--       (2026-08-28 我第一次批次轉換時整批紅在 `column "v_clerk_id" does not exist`
--        ⇒ 📌 **一條對的規則, 套用的方式可以是錯的。**)
CREATE OR REPLACE FUNCTION pg_temp.expect_code(p_name text, p_stmt text, p_expected text,
                                               p_arg bigint DEFAULT NULL,
                                               p_ts timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_actual text;
BEGIN
  IF p_arg IS NULL THEN
    EXECUTE p_stmt INTO v_actual;
  ELSIF p_ts IS NULL THEN
    EXECUTE p_stmt INTO v_actual USING p_arg;
  ELSE
    EXECUTE p_stmt INTO v_actual USING p_arg, p_ts;
  END IF;
  IF v_actual IS DISTINCT FROM p_expected THEN
    RAISE EXCEPTION 'FAIL %: 期望 [%] 實得 [%]', p_name, p_expected, v_actual;
  END IF;
  RAISE NOTICE 'ok   %', p_name;
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
  RAISE EXCEPTION 'FAIL %: 期望回碼 [%], 而它【丟了例外】: %', p_name, p_expected, SQLERRM;
END; $$;

DO $t$
DECLARE
  v_clerk_id bigint; v_boss_id bigint; v_shared_id bigint;
  v_ts timestamptz; v_seq_before bigint; v_seq_after bigint;
  v_n integer; v_txt text;
BEGIN
  -- ── T1 一般員工建【私人】檢視 ⇒ CREATED
  PERFORM pg_temp.expect_code('T1 clerk 建私人',
      $q$SELECT public.admin_create_saved_order_view('clerk','我的待出貨','status=pending',NULL,false,'k1',NULL)$q$, 'CREATED');

  -- ── T2 一般員工建【共用】檢視 ⇒ 被擋(Q-檢視-7「只有管理者」)
  PERFORM pg_temp.expect_raise('T2 clerk 建共用',
    $q$SELECT public.admin_create_saved_order_view('clerk','大家的','x',NULL,true,'k2',NULL)$q$,
    '無權執行此操作');

  -- ── T3 管理者建共用 ⇒ CREATED
  PERFORM pg_temp.expect_code('T3 boss 建共用',
      $q$SELECT public.admin_create_saved_order_view('boss','大家的','x',NULL,true,'k3',NULL)$q$, 'CREATED');

  -- ── T4 boss 建自己的私人 ⇒ clerk 看不到它
  PERFORM public.admin_create_saved_order_view('boss','老闆私房','y',NULL,false,'k4',NULL);
  SELECT count(*) INTO v_n FROM public.admin_list_saved_order_views('clerk');
  PERFORM pg_temp.expect('T4 clerk 看得到幾張(自己1 + 共用1)', v_n::text, '2');
  SELECT count(*) INTO v_n FROM public.admin_list_saved_order_views('clerk') WHERE label='老闆私房';
  PERFORM pg_temp.expect('T4b clerk 看不到 boss 的私人', v_n::text, '0');
  SELECT count(*) INTO v_n FROM public.admin_list_saved_order_views('boss');
  PERFORM pg_temp.expect('T4c boss 看得到幾張(自己1 + 共用1)', v_n::text, '2');

  SELECT id INTO v_clerk_id FROM public.admin_saved_order_views WHERE label='我的待出貨';
  SELECT id INTO v_boss_id  FROM public.admin_saved_order_views WHERE label='老闆私房';
  SELECT id INTO v_shared_id FROM public.admin_saved_order_views WHERE label='大家的';

  -- ── T5 改自己的 ⇒ UPDATED
  PERFORM pg_temp.expect_code('T5 clerk 改自己的',
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'我的待出貨2',NULL,NULL,NULL,NULL)$q$, 'UPDATED', v_clerk_id);

  -- ── T6 改別人的私人 ⇒ NOT_FOUND(而不是「無權」⇒ 不洩漏它存不存在)
  PERFORM pg_temp.expect_code('T6 clerk 改 boss 私人',
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'偷改',NULL,NULL,NULL,NULL)$q$, 'NOT_FOUND', v_boss_id);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_boss_id;
  PERFORM pg_temp.expect('T6b 而且真的沒被改到', v_txt, '老闆私房');

  -- ── T7 非管理者改共用 ⇒ NOT_FOUND
  PERFORM pg_temp.expect_code('T7 clerk 改共用',
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'亂改',NULL,NULL,NULL,NULL)$q$, 'NOT_FOUND', v_shared_id);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T7b 而且真的沒被改到', v_txt, '大家的');

  -- ── T8 管理者改共用 ⇒ UPDATED
  PERFORM pg_temp.expect_code('T8 boss 改共用',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'大家的v2',NULL,NULL,NULL,NULL)$q$, 'UPDATED', v_shared_id);

  -- ── T9 🔴 q31=甲「後改的贏」⇒ 兩格缺一不可
  --      ① B 的內容真的進去了   ② B 看到那句提示(回傳碼)
  --      只驗 ① ⇒ 提示從來不亮也全綠;只驗 ② ⇒ 內容沒寫進去也可能全綠
  SELECT updated_at INTO v_ts FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_catalog.pg_sleep(0.01);
  PERFORM public.admin_update_saved_order_view('boss',v_shared_id,'A 改的',NULL,NULL,v_ts,NULL);
  -- 現在拿【過期的】 v_ts 再改一次 = B 沒看到 A 剛改過
  PERFORM pg_temp.expect_code('T9-② B 看到提示',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'B 改的',NULL,NULL,$2,NULL)$q$,
      'UPDATED_OVERWROTE', v_shared_id, v_ts);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T9-① B 的內容真的進去了', v_txt, 'B 改的');

  -- ── T10 同值 ⇒ NO_CHANGE(零寫入)
  PERFORM pg_temp.expect_code('T10 同值',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'B 改的',NULL,NULL,NULL,NULL)$q$, 'NO_CHANGE', v_shared_id);

  -- ── T11 刪自己的 ⇒ DELETED;再刪一次 ⇒ NOT_FOUND
  PERFORM pg_temp.expect_code('T11 clerk 刪自己的',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,NULL)$q$, 'DELETED', v_clerk_id);
  PERFORM pg_temp.expect_code('T11b 再刪一次',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,NULL)$q$, 'NOT_FOUND', v_clerk_id);

  -- ── T17 🔴 delete 的內容閘 —— 而它是【突變表逼出來的】:
  --      2026-08-28 跑 M9 時發現我原本寫的那一發改到了 update, delete 那支從頭到尾沒有突變指名它
  --      ⇒ 回頭一看, 測試也只驗了「刪自己的」(T11) ⇒ **delete 的內容閘零覆蓋。**
  --      📌 一發打錯支的突變, 揭出的是【測試的缺口】不是突變的缺口。
  PERFORM public.admin_create_saved_order_view('clerk','clerk 的第二張','q2',NULL,false,'k12',NULL);
  PERFORM pg_temp.expect_code('T17 clerk 刪 boss 的私人',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,NULL)$q$, 'NOT_FOUND', v_boss_id);
  SELECT count(*) INTO v_n FROM public.admin_saved_order_views WHERE id=v_boss_id;
  PERFORM pg_temp.expect('T17b 而且它真的還在', v_n::text, '1');
  PERFORM pg_temp.expect_code('T18 clerk 刪共用(非管理者)',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,NULL)$q$, 'NOT_FOUND', v_shared_id);
  SELECT count(*) INTO v_n FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T18b 而且它真的還在', v_n::text, '1');
  PERFORM pg_temp.expect_code('T19 boss 刪共用(管理者)',
      $q$SELECT public.admin_delete_saved_order_view('boss',$1,NULL)$q$, 'DELETED', v_shared_id);

  -- ── T12 重播同一個 idempotency_key ⇒ DUPLICATE_REQUEST
  PERFORM pg_temp.expect_code('T12 重播',
      $q$SELECT public.admin_create_saved_order_view('boss','重播測試','z',NULL,false,'k9',NULL)$q$, 'CREATED');
  -- 用 expect_code:少了 idem 判定 ⇒ 例外會逃出來, 而 expect() 接不住 ⇒ 紅了說不出自己是誰
  PERFORM pg_temp.expect_code('T12b 同一把鑰匙再來一次 ⇒ DUPLICATE_REQUEST',
    $q$SELECT public.admin_create_saved_order_view('boss','重播測試改個名','z',NULL,false,'k9',NULL)$q$,
    'DUPLICATE_REQUEST');

  -- ── T13 兩張同名【共用】檢視 ⇒ NAME_TAKEN(不是丟例外)
  --      🔴 第五個碼。主視窗 2026-08-28 裁的,**Sean 沒有看過這個碼**。
  --      理由:一個 DB 例外冒到畫面 = 員工看到一串英文,而他做錯的事其實很簡單。
  PERFORM pg_temp.expect_code('T13 建同名共用',
      $q$SELECT public.admin_create_saved_order_view('boss','同名共用','q',NULL,true,'k13',NULL)$q$, 'CREATED');
  PERFORM pg_temp.expect_code('T13b 再建一張同名共用 ⇒ NAME_TAKEN',
    $q$SELECT public.admin_create_saved_order_view('boss','同名共用','q',NULL,true,'k10',NULL)$q$,
    'NAME_TAKEN');
  -- ── T13c 同名【私人】也要 NAME_TAKEN(兩個部分唯一索引各一發, 不要只驗一個)
  PERFORM pg_temp.expect_code('T13c clerk 建同名私人 ⇒ NAME_TAKEN',
    $q$SELECT public.admin_create_saved_order_view('clerk','clerk 的第二張','q',NULL,false,'k14',NULL)$q$,
    'NAME_TAKEN');
  -- ── T13d 🔴 而【不同人】取同一個名字要放行 —— 部分唯一索引管的是每個人自己
  --      (少了這一發, 一個「全表 label 唯一」的錯誤索引也會讓 T13/T13c 全綠)
  PERFORM pg_temp.expect_code('T13d boss 也叫「clerk 的第二張」⇒ 放行',
      $q$SELECT public.admin_create_saved_order_view('boss','clerk 的第二張','q',NULL,false,'k15',NULL)$q$, 'CREATED');

  -- ── T14 停用的員工 ⇒ 四支全擋
  PERFORM pg_temp.expect_raise('T14 停用員工 list',
    $q$SELECT * FROM public.admin_list_saved_order_views('gone')$q$, '無權執行此操作');
  PERFORM pg_temp.expect_raise('T14b 停用員工 create',
    $q$SELECT public.admin_create_saved_order_view('gone','x','y',NULL,false,NULL,NULL)$q$,
    '無權執行此操作');

  -- ── T20 / T21 🔴 停用員工打 update / delete —— 而這兩發是【突變表重算】逼出來的:
  --      T14 只驗了 list 與 create 兩支 ⇒ update / delete 的身分閘**零覆蓋**
  --      📌 一組寫著「四支都擋」的測試, 實際只餵了兩支。
  PERFORM pg_temp.expect_raise('T20 停用員工 update',
    $q$SELECT public.admin_update_saved_order_view('gone',1,'x',NULL,NULL,NULL,NULL)$q$,
    '無權執行此操作');
  PERFORM pg_temp.expect_raise('T21 停用員工 delete',
    $q$SELECT public.admin_delete_saved_order_view('gone',1,NULL)$q$, '無權執行此操作');

  -- ── T15 is_shared 寫不進去(GENERATED)
  BEGIN
    INSERT INTO public.admin_saved_order_views (staff_id,label,query,is_shared)
      VALUES ('clerk','手動','q',true);
    RAISE EXCEPTION 'FAIL T15: is_shared 竟然寫得進去';
  EXCEPTION WHEN generated_always THEN
    RAISE NOTICE 'ok   T15 is_shared 寫不進去';
  END;

  -- ── T16 🔴 執行順序:閘在寫入【之前】
  --      identity sequence 的 nextval 熬得過回滾 ⇒ 對一個【應該被拒絕】的呼叫比前後 last_value
  --      不動 ⇒ INSERT 根本沒跑過 ⇒ 閘在前面
  --      +1  ⇒ INSERT 跑過了才被擋 ⇒ 閘在後面(而交易照樣回滾, 外部行為完全相同)
  --      ⚠️ 比的是【前後差】不是絕對值 —— 讀到 0 會被讀成「沒被呼叫」
  --      🔴 而這一發只證得了 create 那支。update / delete 的執行順序【沒有測試證明得了】
  --         (§14-Z 殘餘風險 ②)—— 三支沒有 ≠ 四支都沒有,不要外推。
  SELECT last_value INTO v_seq_before
    FROM pg_sequences WHERE schemaname='public' AND sequencename LIKE 'admin_saved_order_views_id_%';
  BEGIN
    PERFORM public.admin_create_saved_order_view('clerk','越權共用','q',NULL,true,'k11',NULL);
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  SELECT last_value INTO v_seq_after
    FROM pg_sequences WHERE schemaname='public' AND sequencename LIKE 'admin_saved_order_views_id_%';
  PERFORM pg_temp.expect('T16 被拒的呼叫沒有動到 sequence(閘在寫入之前)',
    (v_seq_after - v_seq_before)::text, '0');

  RAISE NOTICE '=== 全部通過 ===';
END;
$t$;

-- ============================================================================
-- §M 突變表 —— 🔴 **每一發都要真的跑過並看到它紅。沒殺過突變的測試不算裝上。**
-- ============================================================================
-- M1-M9 打【授權】· M10 打【功能】⇒ 報「N 發全紅」時不要混在一起講(§14-19)。
--
--  M1  create 拿掉 `AND NOT v_is_manager` 的共用檢查   ⇒ T2 要紅
--  M2  身分閘拿掉 `AND s.is_active`                     ⇒ T14 要紅
--  M7''update 的內容閘整個換成恆真                      ⇒ T6 / T7 要紅
--      🔴 不可用「拿掉 staff_id = p_actor」那一版 —— 那會讓閘變【嚴】不是變鬆,
--         私人檢視變成沒有人改得動 ⇒ 仍然造不出越權 ⇒ **恆綠**。
--         判別句:拿掉一個條件, 有時候是把閘變嚴。看它落在 OR 還是 AND 的哪一側。
--  M8  list 的內容閘拿掉                                ⇒ T4b 要紅
--  M9  delete 的內容閘換成恆真                          ⇒ T17 / T18 要紅
--      🔴 這一發第一版【打錯支了】(改到 update)⇒ 而它揭出的是:delete 的內容閘
--         連測試都沒有(T11 只驗了刪自己的)。**一發打錯支的突變, 揭出測試的缺口。**
--  M5  create 把身分閘搬到 INSERT 之後                  ⇒ T16 要紅(碼錨也要紅)
--  M10 拿掉 updated_at 的 touch trigger                 ⇒ T9-② 要紅、而 T9-① 仍綠
--      🔴 先問那一句:「把它拿掉,『B 看到提示』這個現象還有沒有別的機制會提供?」
--         ⇒ 沒有 —— 那句提示的唯一來源就是這個比較 ⇒ **這一發有判別力。**
--  斷言層(打 migration 自己的尺,不打行為):
--  MA1 加一句 GRANT SELECT ... TO service_role          ⇒ 斷言 7c 要紅
--  MA2 拿掉其中一支的 SET search_path                    ⇒ 斷言 7a 要紅
--  MA3 把 create 的 INSERT 拆成兩句                      ⇒ 碼錨唯一性要紅
--  MA4 給 anon 一個 CREATE ON SCHEMA public              ⇒ 斷言 7b 要紅
--
-- ⏳ 突變表整張仍待重算(§14-Z ①/R3 IMP-11)—— 上面這張是換路後的第一版,
--    它取代舊的 9 發(那 9 發建在「3 支 upsert」的形狀上)。**發數與覆蓋面要重新盤過。**
--
-- 跑法:
--   1. 起拋棄式 PG、建 anon/authenticated/service_role + staff + admin_audit_log fixture
--   2. psql -f 2026-08-25-saved-views-migration-draft.sql
--   3. psql -f 本檔                       ⇒ 應全過
--   4. 每一發突變:改草稿一處 → 重建庫 → 重跑 2 與 3 ⇒ **必須看到指定的那一格紅**
