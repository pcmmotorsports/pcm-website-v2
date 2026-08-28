-- ============================================================================
-- 片1 行為測試(配 20260828080000_m4b_b4views1_saved_order_views.sql)
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
-- 🔴 `WHEN OTHERS` 不是 `WHEN raise_exception`(2026-08-28 折 R3 MF1 時改)——
-- 一發把閘塞進死分支的突變, 會讓呼叫一路走到稽核 INSERT 才撞 NOT NULL(23502),
-- **而 23502 不是 raise_exception** ⇒ 舊寫法接不住 ⇒ 例外裸奔出 DO 區塊
-- ⇒ 畫面上是一句原始 DB 錯誤, **沒有格名**。
-- 📌 **一個測試可以正確地紅, 而說不出自己是誰** —— 而突變測試的價值就在那個名字上。
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
  -- 🔴 **也要驗 SQLSTATE, 不能只比訊息字面**(codex R4 nit, 2026-08-28)——
  -- 上面把捕捉範圍從 `raise_exception` 放寬成 `OTHERS` 是為了讓每一格說得出自己是誰,
  -- 而放寬的代價是:一個 **SQLSTATE 不是 P0001、而 SQLERRM 剛好一樣**的例外會被判綠。
  -- 📌 **為了拿到名字而放寬捕捉, 順手放掉了「它是哪一種失敗」** —— 兩者可以都要。
  -- (我們自己的 `RAISE EXCEPTION '…'` 不帶 ERRCODE ⇒ 一律 P0001。)
  IF SQLSTATE <> 'P0001' OR SQLERRM IS DISTINCT FROM p_msg THEN
    RAISE EXCEPTION 'FAIL %: 拒絕了而訊息不對。期望 [% / P0001] 實得 [% / %]',
      p_name, p_msg, SQLERRM, SQLSTATE;
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
  v_n integer; v_txt text; v_id2 bigint;
BEGIN
  -- ── T1 一般員工建【私人】檢視 ⇒ CREATED
  PERFORM pg_temp.expect_code('T1 clerk 建私人',
      $q$SELECT public.admin_create_saved_order_view('clerk','我的待出貨','status=pending',NULL,false,'k1','req-test-001')$q$, 'CREATED');

  -- ── T2 一般員工建【共用】檢視 ⇒ 被擋(Q-檢視-7「只有管理者」)
  PERFORM pg_temp.expect_raise('T2 clerk 建共用',
    $q$SELECT public.admin_create_saved_order_view('clerk','大家的','x',NULL,true,'k2','req-test-001')$q$,
    '無權執行此操作');

  -- ── T3 管理者建共用 ⇒ CREATED
  PERFORM pg_temp.expect_code('T3 boss 建共用',
      $q$SELECT public.admin_create_saved_order_view('boss','大家的','x',NULL,true,'k3','req-test-001')$q$, 'CREATED');

  -- ── T4 boss 建自己的私人 ⇒ clerk 看不到它
  PERFORM public.admin_create_saved_order_view('boss','老闆私房','y',NULL,false,'k4','req-test-001');
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
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'我的待出貨2',NULL,NULL,NULL,'req-test-001')$q$, 'UPDATED', v_clerk_id);

  -- ── T6 改別人的私人 ⇒ NOT_FOUND(而不是「無權」⇒ 不洩漏它存不存在)
  PERFORM pg_temp.expect_code('T6 clerk 改 boss 私人',
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'偷改',NULL,NULL,NULL,'req-test-001')$q$, 'NOT_FOUND', v_boss_id);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_boss_id;
  PERFORM pg_temp.expect('T6b 而且真的沒被改到', v_txt, '老闆私房');

  -- ── T7 非管理者改共用 ⇒ NOT_FOUND
  PERFORM pg_temp.expect_code('T7 clerk 改共用',
      $q$SELECT public.admin_update_saved_order_view('clerk',$1,'亂改',NULL,NULL,NULL,'req-test-001')$q$, 'NOT_FOUND', v_shared_id);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T7b 而且真的沒被改到', v_txt, '大家的');

  -- ── T8 管理者改共用 ⇒ UPDATED
  PERFORM pg_temp.expect_code('T8 boss 改共用',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'大家的v2',NULL,NULL,NULL,'req-test-001')$q$, 'UPDATED', v_shared_id);

  -- ── T9 🔴 q31=甲「後改的贏」⇒ 兩格缺一不可
  --      ① B 的內容真的進去了   ② B 看到那句提示(回傳碼)
  --      只驗 ① ⇒ 提示從來不亮也全綠;只驗 ② ⇒ 內容沒寫進去也可能全綠
  SELECT updated_at INTO v_ts FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_catalog.pg_sleep(0.01);
  PERFORM public.admin_update_saved_order_view('boss',v_shared_id,'A 改的',NULL,NULL,v_ts,'req-test-001');
  -- 現在拿【過期的】 v_ts 再改一次 = B 沒看到 A 剛改過
  PERFORM pg_temp.expect_code('T9-② B 看到提示',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'B 改的',NULL,NULL,$2,'req-test-001')$q$,
      'UPDATED_OVERWROTE', v_shared_id, v_ts);
  SELECT label INTO v_txt FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T9-① B 的內容真的進去了', v_txt, 'B 改的');

  -- ── T10 同值 ⇒ NO_CHANGE(零寫入)
  PERFORM pg_temp.expect_code('T10 同值',
      $q$SELECT public.admin_update_saved_order_view('boss',$1,'B 改的',NULL,NULL,NULL,'req-test-001')$q$, 'NO_CHANGE', v_shared_id);

  -- ── T11 刪自己的 ⇒ DELETED;再刪一次 ⇒ NOT_FOUND
  PERFORM pg_temp.expect_code('T11 clerk 刪自己的',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,'req-test-001')$q$, 'DELETED', v_clerk_id);
  PERFORM pg_temp.expect_code('T11b 再刪一次',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,'req-test-001')$q$, 'NOT_FOUND', v_clerk_id);

  -- ── T17 🔴 delete 的內容閘 —— 而它是【突變表逼出來的】:
  --      2026-08-28 跑 M9 時發現我原本寫的那一發改到了 update, delete 那支從頭到尾沒有突變指名它
  --      ⇒ 回頭一看, 測試也只驗了「刪自己的」(T11) ⇒ **delete 的內容閘零覆蓋。**
  --      📌 一發打錯支的突變, 揭出的是【測試的缺口】不是突變的缺口。
  PERFORM public.admin_create_saved_order_view('clerk','clerk 的第二張','q2',NULL,false,'k12','req-test-001');
  PERFORM pg_temp.expect_code('T17 clerk 刪 boss 的私人',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,'req-test-001')$q$, 'NOT_FOUND', v_boss_id);
  SELECT count(*) INTO v_n FROM public.admin_saved_order_views WHERE id=v_boss_id;
  PERFORM pg_temp.expect('T17b 而且它真的還在', v_n::text, '1');
  PERFORM pg_temp.expect_code('T18 clerk 刪共用(非管理者)',
      $q$SELECT public.admin_delete_saved_order_view('clerk',$1,'req-test-001')$q$, 'NOT_FOUND', v_shared_id);
  SELECT count(*) INTO v_n FROM public.admin_saved_order_views WHERE id=v_shared_id;
  PERFORM pg_temp.expect('T18b 而且它真的還在', v_n::text, '1');
  PERFORM pg_temp.expect_code('T19 boss 刪共用(管理者)',
      $q$SELECT public.admin_delete_saved_order_view('boss',$1,'req-test-001')$q$, 'DELETED', v_shared_id);

  -- ── T12 重播同一個 idempotency_key ⇒ DUPLICATE_REQUEST
  PERFORM pg_temp.expect_code('T12 重播',
      $q$SELECT public.admin_create_saved_order_view('boss','重播測試','z',NULL,false,'k9','req-test-001')$q$, 'CREATED');
  -- 用 expect_code:少了 idem 判定 ⇒ 例外會逃出來, 而 expect() 接不住 ⇒ 紅了說不出自己是誰
  PERFORM pg_temp.expect_code('T12b 同一把鑰匙再來一次 ⇒ DUPLICATE_REQUEST',
    $q$SELECT public.admin_create_saved_order_view('boss','重播測試改個名','z',NULL,false,'k9','req-test-001')$q$,
    'DUPLICATE_REQUEST');

  -- ── T13 兩張同名【共用】檢視 ⇒ NAME_TAKEN(不是丟例外)
  --      🔴 第五個碼。主視窗 2026-08-28 裁的,**Sean 沒有看過這個碼**。
  --      理由:一個 DB 例外冒到畫面 = 員工看到一串英文,而他做錯的事其實很簡單。
  PERFORM pg_temp.expect_code('T13 建同名共用',
      $q$SELECT public.admin_create_saved_order_view('boss','同名共用','q',NULL,true,'k13','req-test-001')$q$, 'CREATED');
  PERFORM pg_temp.expect_code('T13b 再建一張同名共用 ⇒ NAME_TAKEN',
    $q$SELECT public.admin_create_saved_order_view('boss','同名共用','q',NULL,true,'k10','req-test-001')$q$,
    'NAME_TAKEN');
  -- ── T13c 同名【私人】也要 NAME_TAKEN(兩個部分唯一索引各一發, 不要只驗一個)
  PERFORM pg_temp.expect_code('T13c clerk 建同名私人 ⇒ NAME_TAKEN',
    $q$SELECT public.admin_create_saved_order_view('clerk','clerk 的第二張','q',NULL,false,'k14','req-test-001')$q$,
    'NAME_TAKEN');
  -- ── T13d 🔴 而【不同人】取同一個名字要放行 —— 部分唯一索引管的是每個人自己
  --      (少了這一發, 一個「全表 label 唯一」的錯誤索引也會讓 T13/T13c 全綠)
  PERFORM pg_temp.expect_code('T13d boss 也叫「clerk 的第二張」⇒ 放行',
      $q$SELECT public.admin_create_saved_order_view('boss','clerk 的第二張','q',NULL,false,'k15','req-test-001')$q$, 'CREATED');

  -- ── T22 🔴 update 改名撞到已存在的名字 ⇒ NAME_TAKEN(codex 關卡2 F3)
  --      舊寫法會讓唯一索引的例外直接冒到畫面。
  --      📌 NAME_TAKEN 原本【只有 create 產得出來】, 而 update 也做得到那件事。
  PERFORM pg_temp.expect_code('T22a clerk 建第三張',
    $q$SELECT public.admin_create_saved_order_view('clerk','clerk 第三張','q',NULL,false,'k20','req-test-001')$q$,
    'CREATED');
  PERFORM pg_temp.expect_code('T22b 把它改成跟自己另一張同名 ⇒ NAME_TAKEN',
    $q$SELECT public.admin_update_saved_order_view('clerk',
        (SELECT id FROM public.admin_saved_order_views WHERE label='clerk 第三張'),
        'clerk 的第二張',NULL,NULL,NULL,'req-test-001')$q$,
    'NAME_TAKEN');
  -- ── T22c 而【不同人】同名仍要放行(少了這發, 一個全表唯一的錯索引也讓 T22b 全綠)
  PERFORM pg_temp.expect_code('T22c boss 改成 clerk 也有的名字 ⇒ 放行',
    $q$SELECT public.admin_update_saved_order_view('boss',
        (SELECT id FROM public.admin_saved_order_views WHERE label='老闆私房'),
        'clerk 第三張',NULL,NULL,NULL,'req-test-001')$q$,
    'UPDATED');

  -- ── T23 🔴 重播【同時】撞重播鍵與同名索引 ⇒ 必須是 DUPLICATE_REQUEST(codex 關卡2 F2)
  --      一發重播本來就名字也一樣 ⇒ 兩個唯一索引同時被違反,
  --      而 PostgreSQL 先報哪一個**不保證** ⇒ 舊寫法(比對錯誤訊息字面)會回 NAME_TAKEN
  --      ⇒ 📌 **一發正常的重播被回報成「名字重複」** —— 而使用者會去改名字, 然後真的建出第二張。
  PERFORM pg_temp.expect_code('T23a 建一張',
    $q$SELECT public.admin_create_saved_order_view('boss','重播又同名','q',NULL,false,'k21','req-test-001')$q$,
    'CREATED');
  PERFORM pg_temp.expect_code('T23b 同鑰匙【且】同名再送一次 ⇒ DUPLICATE_REQUEST',
    $q$SELECT public.admin_create_saved_order_view('boss','重播又同名','q',NULL,false,'k21','req-test-001')$q$,
    'DUPLICATE_REQUEST');

  -- ── T24 🔴 `p_request_id` 閘(片1a;上一支缺這道而 39 格全綠 —— fixture 比真表寬)
  --      這兩格證的是【呼叫端沒傳】會大聲失敗, 而不是安靜寫進一列壞資料。
  PERFORM pg_temp.expect_raise('T24a request_id = NULL ⇒ 擋',
    $q$SELECT public.admin_create_saved_order_view('clerk','r1','q',NULL,false,NULL,NULL)$q$,
    'admin_create_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)');
  -- 🔴 全形空白 + 零寬 —— 它【不是空字串】, DB 的 CHECK (<> '') 擋不住它
  --    ⇒ 沒有 btrim 那半的話, 一列 request_id 是「看不見的字」的稽核會寫進去
  PERFORM pg_temp.expect_raise('T24b request_id 全是看不見的字 ⇒ 擋',
    $q$SELECT public.admin_create_saved_order_view('clerk','r2','q',NULL,false,NULL,
        U&'\3000' || U&'\200B')$q$,
    'admin_create_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)');

  -- ── T25 🔴 **update / delete 的 request_id 閘**(codex 關卡2 F2, 2026-08-28)
  --      ~~原本只有 T24a/T24b 兩格, 而它們都打 create~~ ⇒ **另外兩支寫入 RPC 零行為覆蓋**。
  --      📌 這與 T20/T21 是**同一個病的第二次**:一組寫著「三支都加了閘」的測試, 只餵了一支。
  --         而第一次是我自己撈到的, 這一次是 codex 撈到的 —— **同一個形狀我沒學會。**
  -- 🔴 這一格自己建一張, **不借用前面測試留下來的那張** ——
  --    第一版我借了 T1 建的「我的待出貨」, 而它在中途已經被別的格改名/刪掉
  --    ⇒ `v_id2` 是 NULL ⇒ `format('%s', NULL)` 安靜地給出**空字串**
  --    ⇒ 送出去的 SQL 長成 `admin_update_saved_order_view('clerk',,'x',…)` ⇒ 語法錯。
  --    📌 **`format` 的 `%s` 對 NULL 不會叫, 它會給你一個空洞** ——
  --       而空洞在字串裡看不見, 要等 DB 去 parse 才變成一個看不懂的錯。
  PERFORM public.admin_create_saved_order_view('clerk','T25 專用','q',NULL,false,'k25','req-test-001');
  SELECT id INTO v_id2 FROM public.admin_saved_order_views WHERE label='T25 專用';
  -- 正對照:先證明真的拿到 id, 否則下面四格會用一個空洞去測「閘擋不擋」而紅得毫無意義。
  PERFORM pg_temp.expect('T25-0 拿到 id(不是 NULL)', (v_id2 IS NOT NULL)::text, 'true');
  PERFORM pg_temp.expect_raise('T25a update request_id = NULL ⇒ 擋',
    format($q$SELECT public.admin_update_saved_order_view('clerk',%s,'x',NULL,NULL,NULL,NULL)$q$, v_id2),
    'admin_update_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)');
  PERFORM pg_temp.expect_raise('T25b update request_id 全是看不見的字 ⇒ 擋',
    format($q$SELECT public.admin_update_saved_order_view('clerk',%s,'x',NULL,NULL,NULL,U&'\3000' || U&'\200B')$q$, v_id2),
    'admin_update_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)');
  PERFORM pg_temp.expect_raise('T25c delete request_id = NULL ⇒ 擋',
    format($q$SELECT public.admin_delete_saved_order_view('clerk',%s,NULL)$q$, v_id2),
    'admin_delete_saved_order_view: p_request_id 不可為 NULL(稽核 correlation 需要)');
  PERFORM pg_temp.expect_raise('T25d delete request_id 全是看不見的字 ⇒ 擋',
    format($q$SELECT public.admin_delete_saved_order_view('clerk',%s,U&'\3000' || U&'\200B')$q$, v_id2),
    'admin_delete_saved_order_view: p_request_id 去空白後為空(稽核 correlation 需要)');

  -- ── T27 🔴 `名稱必填` 兩道閘(R5 抓到:migration:143 與 :310 **零覆蓋、零突變**)
  --      📌 兩道會擋住使用者的 RAISE, 從來沒有人看過它擋 —— 而它們就寫在那裡, 看起來很盡責。
  --      ⚠️ 位置刻意在 T26 之前:T26f 會把 v_id2 那一列刪掉, 之後 update 回的是 NOT_FOUND
  --         ⇒ 那樣測到的是內容閘, 不是這道閘。
  -- 🔴🔴 **這兩格證到的比它們看起來的窄, 而那是突變告訴我的**(2026-08-28 實測 MJ3/MJ4):
  --    把函式裡那道閘拿掉之後, 它們確實紅了 —— **而紅的原因是表上的
  --    `CHECK (saved_view_label_nonempty)`**(23514), 不是「空名字進得去了」。
  --    ⇒ 這兩格守的是「**員工看到一句看得懂的話**」, **不是**「空名字擋得住」——
  --      後者本來就有 DB 層在守, 拿掉函式那道閘也進不去。
  --    📌 **一發突變讓格子紅了, 而紅的理由與我寫它的理由不同 ——**
  --       **它證明了這一格有判別力, 同時證明了它的射程比我以為的窄。**
  PERFORM pg_temp.expect_raise('T27a create 名稱全是空白 ⇒ 擋',
      $q$SELECT public.admin_create_saved_order_view('clerk','   ','q',NULL,false,NULL,'req-test-001')$q$,
      'admin_create_saved_order_view: 名稱必填');
  PERFORM pg_temp.expect_raise('T27b update 名稱改成全空白 ⇒ 擋',
      format($q$SELECT public.admin_update_saved_order_view('clerk',%s,'   ',NULL,NULL,NULL,'req-test-001')$q$, v_id2),
      'admin_update_saved_order_view: 名稱必填');

  -- ── T26 🔴🔴 **稽核存的是【原值】, 不是被 btrim 改過的值**(codex 關卡2 F5, 2026-08-28)
  --      request_id 是上游的 correlation key, 對我們不透明。`btrim` 會吃掉合法地在頭尾的 ZWJ。
  --      ⇒ 上游 log 記 `req-zwj-1<ZWJ>`, 我們稽核寫 `req-zwj-1` ⇒ **兩邊對不起來**;
  --        而 `req-zwj-1` 這個「乾淨」的值躺在稽核欄位裡, **沒有任何訊號說它被動過**。
  --      📌 前四格(T24/T25)驗的是「閘會不會擋」, 而**擋得住不代表沒有順手改寫**。
  --         那兩件事可以同時成立, 而只有這一格分得開。
  PERFORM public.admin_create_saved_order_view('clerk','原值檢視','q',NULL,false,'k26',
      'req-zwj-1' || U&'\200D');
  -- 🔴 ~~原本 `ORDER BY a.id DESC LIMIT 1`~~ 作廢(R5 nit, 2026-08-28)——
  -- `admin_audit_log.id` 是 `uuid DEFAULT gen_random_uuid()` ⇒ **排的是亂數, 不是時序**。
  -- 📌 它今天不出事只因為這個 WHERE 恰好命中一列 —— **它對的理由不是它寫的理由。**
  -- ✅ 改成純量子查詢:0 列 ⇒ NULL(下一格照樣紅)· **>1 列 ⇒ PostgreSQL 自己丟例外**
  --    ⇒「恰好一列」從運氣變成**被檢查的事實**, 而且不必多開一格。
  SELECT (SELECT a.request_id FROM public.admin_audit_log a
           WHERE a.action='order.saved_view.create' AND a.request_id LIKE 'req-zwj-1%')
    INTO v_txt;
  PERFORM pg_temp.expect('T26a 稽核存原值(長度 = 9 + 1 個 ZWJ)',
      pg_catalog.char_length(v_txt)::text, '10');
  -- 🔴🔴 ~~原本這裡有一格 `T26b 稽核【不是】被 btrim 過的那個`~~ —— **刪掉了**(R3 格1)。
  --    它要紅的唯一世界是 `v_txt = 'req-zwj-1'`, 而那個世界裡**上面的 T26a 先紅**
  --    (長度 9 ≠ 10)⇒ DO 區塊當場中止 ⇒ **T26b 永遠輪不到**。
  --    📌 **一個構造上永遠輪不到的檢查, 修不出判別力 —— 它只能複誦前一格。**
  --       那是**穿著檢查外衣的死碼**, 而它每次都印一格綠。
  -- ⚠️ 這幾行刻意留著, 否則下一個人會覺得覆蓋率掉了兩格而把它們補回來。
  -- 🔴🔴 **三堆, 三個數, 不要合成兩堆**(R5 2026-08-28 命名了中間那一堆):
  --    「沒有世界」= 構造上恆真         ⇒ **0 格**(已刪的 T26b/T26e 就是這種, 只能刪)
  --    「有世界, 而被前一格遮蔽」        ⇒ **已知 3 格**(T13c / T22c / T4c)——
  --       本檔是**單一 DO 區塊、第一格紅就中止** ⇒ 它們有會紅的世界, 而輪不到自己開口
  --       ⚠️ ~~R5 原本列 5 格(含 T15 / T18)~~ —— 那兩格**已經被 MJ1 / MJ2 解開了**:
  --          MJ1 打 delete 的 NULL 洞 ⇒ T18 自己紅;
  --          MJ2 把 is_shared 的值用 trigger 補回來 ⇒ 前面全綠, **只有 T15 看得到**。
  --          📌 **「被遮蔽」不是一個永久屬性, 是【還沒有人造出讓它單獨開口的世界】。**
  --       🔴 而這 3 格是 **R5 抽驗 6 格**得到的, **不是逐格** —— 剩下 16 格沒有人分過類。
  --    「有世界、只是沒突變瞄準」        ⇒ 其餘 —— 值得補突變
  --    ⚠️ 中間那一堆是 R5 抽驗 6 格才看見的, **我原本只有兩堆而它裝不下**。
  --    要分開兩件事:**「從來沒紅過」= 證據缺席**(值得補突變);
  --    **「所有世界都會過」= 構造上恆真**(這 2 格, 只能刪)。**兩者不該共用一個數字。**
  -- 🔴 正對照:這一格必須在【原值真的被存進去】時才綠 ——
  --    上面兩格都只看長度與不等於, 而一個【完全不同】的值也會通過那兩格。
  PERFORM pg_temp.expect('T26c 稽核就是那個原值(逐字)',
      (v_txt = 'req-zwj-1' || U&'\200D')::text, 'true');

  -- ── T26d-f 🔴 **update / delete 的稽核也要存原值**(codex R2-3, 2026-08-28)
  --      ~~T26a-c 我自己標成「1/3, 已知且刻意, 由碼錨+突變守」~~ —— **而 codex 不接受, 它是對的**:
  --      碼錨是**字面比對**, 換一個空白寫法(`p_request_id ,'admin'`)就繞過去了;
  --      行為測試不管你怎麼寫, 它只問**那一列存了什麼**。
  --      📌 **一道字面錨證明的是「這段字還在」, 不是「這件事還成立」。**
  --      🔴 而這是同一個形狀的**第三次**(T20/T21 我撈 → F2 codex 撈 → T26 codex 再撈)
  --         ⇒ 「已知且刻意」這四個字**可以是誠實的, 也可以是我停下來的地方**。
  PERFORM public.admin_update_saved_order_view('clerk', v_id2, '原值改名', NULL, NULL, NULL,
      'req-zwj-2' || U&'\200D');
  -- 🔴 ~~原本 `ORDER BY a.id DESC LIMIT 1`~~ 作廢(R5 nit, 2026-08-28)——
  -- `admin_audit_log.id` 是 `uuid DEFAULT gen_random_uuid()` ⇒ **排的是亂數, 不是時序**。
  -- 📌 它今天不出事只因為這個 WHERE 恰好命中一列 —— **它對的理由不是它寫的理由。**
  -- ✅ 改成純量子查詢:0 列 ⇒ NULL(下一格照樣紅)· **>1 列 ⇒ PostgreSQL 自己丟例外**
  --    ⇒「恰好一列」從運氣變成**被檢查的事實**, 而且不必多開一格。
  SELECT (SELECT a.request_id FROM public.admin_audit_log a
           WHERE a.action='order.saved_view.update' AND a.request_id LIKE 'req-zwj-2%')
    INTO v_txt;
  PERFORM pg_temp.expect('T26d update 稽核存原值(逐字)',
      (v_txt = 'req-zwj-2' || U&'\200D')::text, 'true');
  -- 🔴 ~~原本這裡有一格 `T26e`~~ —— 與 T26b 同構、同理由刪除(被上面的 T26d 遮蔽)。
  PERFORM public.admin_delete_saved_order_view('clerk', v_id2, 'req-zwj-3' || U&'\200D');
  -- 🔴 ~~原本 `ORDER BY a.id DESC LIMIT 1`~~ 作廢(R5 nit, 2026-08-28)——
  -- `admin_audit_log.id` 是 `uuid DEFAULT gen_random_uuid()` ⇒ **排的是亂數, 不是時序**。
  -- 📌 它今天不出事只因為這個 WHERE 恰好命中一列 —— **它對的理由不是它寫的理由。**
  -- ✅ 改成純量子查詢:0 列 ⇒ NULL(下一格照樣紅)· **>1 列 ⇒ PostgreSQL 自己丟例外**
  --    ⇒「恰好一列」從運氣變成**被檢查的事實**, 而且不必多開一格。
  SELECT (SELECT a.request_id FROM public.admin_audit_log a
           WHERE a.action='order.saved_view.delete' AND a.request_id LIKE 'req-zwj-3%')
    INTO v_txt;
  PERFORM pg_temp.expect('T26f delete 稽核存原值(逐字)',
      (v_txt = 'req-zwj-3' || U&'\200D')::text, 'true');

  -- ── T14 停用的員工 ⇒ 四支全擋
  PERFORM pg_temp.expect_raise('T14 停用員工 list',
    $q$SELECT * FROM public.admin_list_saved_order_views('gone')$q$, '無權執行此操作');
  PERFORM pg_temp.expect_raise('T14b 停用員工 create',
    $q$SELECT public.admin_create_saved_order_view('gone','x','y',NULL,false,NULL,'req-test-001')$q$,
    '無權執行此操作');

  -- ── T20 / T21 🔴 停用員工打 update / delete —— 而這兩發是【突變表重算】逼出來的:
  --      T14 只驗了 list 與 create 兩支 ⇒ update / delete 的身分閘**零覆蓋**
  --      📌 一組寫著「四支都擋」的測試, 實際只餵了兩支。
  PERFORM pg_temp.expect_raise('T20 停用員工 update',
    $q$SELECT public.admin_update_saved_order_view('gone',1,'x',NULL,NULL,NULL,'req-test-001')$q$,
    '無權執行此操作');
  PERFORM pg_temp.expect_raise('T21 停用員工 delete',
    $q$SELECT public.admin_delete_saved_order_view('gone',1,'req-test-001')$q$, '無權執行此操作');

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
    PERFORM public.admin_create_saved_order_view('clerk','越權共用','q',NULL,true,'k11','req-test-001');
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
-- §M 突變表 —— 🔴 **正本不在這裡。**
-- ============================================================================
-- 🔴 ~~原本這裡有一張手寫的 13 發突變表~~ **整張作廢**(R3 nit, 2026-08-28)。
--    它在被寫下之後就開始漂, 而漂的每一處都指向「已經驗過了」:
--      · 只列 13 發, 而產生器當時已經有 36 發
--      · `M8 ⇒ T4b 要紅` —— 實際紅在 `T4`(T4b 是另一格)
--      · `M5 ⇒ T16 要紅` —— 實際上碼錨在 apply 期就殺掉它, **T16 從來沒執行到紅**
--      · 檔尾的手動跑法(改一處 → 重建庫 → 重跑)已被 run-mutants.sh 取代
--    📌 **一張過期的表, 不會空著讓人發現 —— 它會滿滿地寫著看起來很像事實的東西。**
--       而它與正本的差別, 只有同時開兩份的人看得到, 那種人最少。
-- ✅ 正本(可執行, 自己會數自己):
--      產生器   docs/specs/2026-08-25-saved-views-mutants.py   ← 每發的錨與期望格
--      跑法     bash docs/specs/2026-08-25-saved-views-run-mutants.sh
--               (它比「我餵幾條」與「它跑幾支」, 對不上就 rc=1 退場)
-- ⚠️ **本檔要留的只有【判準】, 不是清單** —— 清單會過期, 判準不會:
--    · 每一發都要問「這個檢查在成立與不成立兩個世界會印不同的東西嗎」
--    · **沒殺過突變的測試不算裝上**
--    · 檢查的是【紅在哪一格】不是【有沒有紅】——
--      一發打錯支的突變與一發紅在語法錯的突變, 只記後者都會被算成通過
--    · 拿掉一個條件有時候是把閘變【嚴】(閘變嚴 ⇒ 造不出越權 ⇒ 恆綠)——
--      看它落在 OR 還是 AND 的哪一側
--    · **授權**類與**功能**類的突變不要混在一起報「N 發全紅」(§14-19)
--
-- 跑法(兩支腳本都自己起拋棄式 PG, 不用手動做上面那些):
--   全套一次     bash docs/specs/2026-08-25-saved-views-verify-all.sh
--                (apply + 斷言 / 50 格行為 / 帶資料的 down / 撞名世界)
--   突變一整輪   bash docs/specs/2026-08-25-saved-views-run-mutants.sh
-- ⚠️ ~~原本第 4 步寫「改草稿一處 → 重建庫 → 重跑」~~ 作廢 —— 那是手動流程,
--    而**手動流程的紀錄只活在 shell 歷史裡**(本檔開頭那段就是它的下場)。
