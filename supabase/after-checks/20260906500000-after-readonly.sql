-- ══════════════════════════════════════════════════════════════════════
-- 貼後對帳 · `20260906500000`(⟦b4-BANKCARDRACE⟧ 甲)—— **唯讀, 零寫入**
-- ══════════════════════════════════════════════════════════════════════
-- 🔴 **這支檔存在的理由**:migration 的事後斷言在【那一發交易裡】跑, 成功之後只留下
--    「沒有 RAISE」這個事實。⇒ 📌 **「它沒有叫」與「我看到了值」是兩件事。**
--
-- 🔴🔴 **本檔的第①格是【機械的】, 不是找字面**(codex R1 must-fix M4/M5)——
--    ⛔ ~~原本每一格都問「某個字面在不在」~~ ⇒ 🛑 **把 `OR` 改成 `AND`、把鎖移到查詢之後、
--       把 advisory key 換成常數 —— 那些字面全都還在, 它照樣印全綠。**
--    ✅ 改法:把守門那一整段**整段減掉**, 剩下的 md5 必須逐字等於貼之前那一版。
--       ⇒ 它同時答「守門一字沒被改」與「別的地方沒被動」。
--
-- 🛑 **它證不到什麼**
--    · **那道守門會不會擋對** —— 要真的建一張單(寫入), 唯讀線做不到。
--    · **並發下守不守得住** —— 要兩條連線, 本片沒做(plan §4)。
--    · **3DS pending 那段窗口** —— 本片關不掉, 見板列 `⟦b4-CARDPENDINGWINDOW⟧`。
--    · 客人看到的訊息 —— 文案還在 Sean 那裡。
-- ══════════════════════════════════════════════════════════════════════
\pset pager off
\pset format unaligned
\pset fieldsep ' | '

\echo '════ ① 機械對帳:新 body 減掉守門, 要等於貼前那一版(11 參 8cb6104e… · 10 參 a1f52126…)'
WITH g AS (SELECT $guard$
  -- ── 1b. ⟦b4-BANKCARDRACE⟧ 同一個購物車不得在【已經付成功】之後再開一張單 ──────
  --
  -- 🔴🔴 **這一段解的是「兩個分頁,客人兩邊都付」**:刷卡那條路(`begin_charge_attempt`)
  --    在它自己的交易裡把同 cart 的匯款單 supersede 掉(`20260904050000:202-217`
  --    `SET cancelled_at = now(), cancelled_reason = 'superseded_by_card'`),
  --    而那個 UPDATE **掃不到還沒 commit 的列**,更掃不到**它 commit 之後**才建的列。
  --    ⇒ 🛑 **後者根本不是 race** —— 在本段之前,那張後來的匯款單【永遠】沒有人會處理。
  --
  -- 🔴 **為什麼鎖要拿在這裡、而且是【同一把】**:
  --    `20260904050000:118` 逐字 `PERFORM pg_catalog.pg_advisory_xact_lock(
  --      pg_catalog.hashtextextended(v_order.customer_user_id::text, 0))`。
  --    📌 **一把 advisory lock 只序列化【有拿它的人】** —— 而在本段之前,建單這條路
  --    整支函式 `advisory` 命中 **0**、`FOR UPDATE` 命中 **0**(兩支多載都是,唯讀量過)
  --    ⇒ 那把鎖對建單形同不存在。**同 key、同型、同鎖序**才叫加入協定。
  --
  -- 🛑 **述詞【刻意只認「已經付成功」】,不認 pending / failed** —— 這一格是承重的:
  --    `ClearCartOnSuccess.tsx:18` 逐字「callback page 僅在 **paid 分支** 傳 regenerate」
  --    ⇒ 📌 **刷卡失敗或 pending 之後 `cart_session_id` 不會換。**
  --    ⇒ 若把 pending/failed 也擋掉,擋到的第一個人不是雙付的客人,
  --      **是刷卡失敗想再試一次的客人** —— 他會再也結不了帳。
  --    ⛔ ~~原本要用 partial unique index~~ **放棄**(主視窗 2026-09-06 裁甲):
  --      索引只表達得了「同一組欄位不得重複」,而本不變量是**跨列、有條件**的。
  --      📌 索引不需要任何人同意 —— 而代價是**它也不聽任何條件**。
  --
  -- 🔵 「已經付成功」的兩種形狀,逐字對齊既有述詞(不發明):
  --    · `o.payment_status = 'paid'` —— 與 `20260904050000:132` 那格同字面
  --    · 有一筆 `payment_charge_attempts.status = 'charged'` —— 與同檔 `:131` 同字面
  --    ⚠️ **不用 `a.status <> 'failed'`**(supersede 那段 `:216` 用的是它):那條**含 pending**,
  --      而 pending 正是上面說的「要允許重試」的那個世界。
  --      🛑 三處刻意**不共用**(理由同 `20260904050000:200` 那段:抽成共用點會變成一個
  --      【會一起被改壞】的東西)⇒ **改任一處之前先讀另外兩處。**
  --
  -- 🔴 查詢本身失敗 ⇒ **原樣往上拋,不吞** —— fail-closed。
  --    (與重算那支刻意吞例外的形狀相反:那裡吞是為了不讓客人的收款回滾,
  --     這裡沒有那個代價 —— 建單還沒發生。)
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));

  PERFORM 1
     FROM public.orders o
    WHERE o.customer_user_id = v_uid
      AND o.cart_session_id  = p_cart_session_id
      AND o.cancelled_at IS NULL
      AND (
            o.payment_status = 'paid'::public.payment_status
         OR EXISTS (
              SELECT 1 FROM public.payment_charge_attempts a
               WHERE a.order_id = o.id AND a.status = 'charged'
            )
          )
    LIMIT 1;
  IF FOUND THEN
    -- 🔴 **具名 SQLSTATE + 固定字面** —— app 端要靠它分辨這一種失敗,
    --    而**文案還沒有**(Q-同車兩單文案已排給 Sean)⇒ 在那之前客人看到的是原樣錯誤。
    --    🛑 改這個字面或這個 code = 改一個**呼叫端在比對的東西**,不是改文案。
    RAISE EXCEPTION 'create_order: 這個購物車已經有一張付款成功的訂單(pcm_cart_already_paid)'
      USING ERRCODE = 'P0002';
  END IF;

$guard$ AS t)
SELECT p.pronargs AS 參數個數,
       pg_catalog.strpos(p.prosrc, g.t) > 0                      AS 守門一字不差在裡面,
       pg_catalog.md5(pg_catalog.replace(p.prosrc, g.t, ''))     AS 減掉守門後的md5,
       pg_catalog.md5(pg_catalog.replace(p.prosrc, g.t, '')) =
         CASE p.pronargs WHEN 11 THEN '8cb6104ecb8b462bbdd75e23246cf51a'
                         WHEN 10 THEN 'a1f521268a77f741251759e11ef0c998' END AS 等於貼前那一版
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN g
 WHERE n.nspname = 'public' AND p.proname = 'create_order'
 ORDER BY p.pronargs;

\echo '════ ①b 🔵 形狀負對照:那個【比較寬】的述詞不准出現(出現 = 有人把 pending 也擋了)'
SELECT p.pronargs,
       pg_catalog.strpos(pg_catalog.regexp_replace(p.prosrc, '--[^' || chr(10) || ']*', '', 'g'),
                         'a.status <> ''failed''') > 0 AS 誤含pending_應為f
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'create_order' ORDER BY p.pronargs;

\echo '════ ② 頭的五格(CREATE OR REPLACE 會整組覆蓋 ⇒ 貼完要回頭看一眼)'
SELECT p.pronargs, p.prosecdef AS 是DEFINER, p.provolatile AS 揮發性,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.proconfig AS proconfig, p.proacl IS NOT NULL AS 有ACL
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'create_order' ORDER BY p.pronargs;

\echo '════ ③ ACL 逐筆(期望:只有 postgres 與 authenticated 的 EXECUTE, 都不可轉授)'
SELECT p.pronargs, pg_catalog.pg_get_userbyid(a.grantee) AS 角色,
       a.privilege_type, a.is_grantable
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
 WHERE n.nspname = 'public' AND p.proname = 'create_order' ORDER BY 1, 2;

\echo '════ ④ 簽章與 DEFAULT 一個字沒動嗎'
SELECT p.pronargs, pg_catalog.pg_get_function_arguments(p.oid) AS 完整參數
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'create_order' ORDER BY p.pronargs;

\echo '════ ⑤ COMMENT 有沒有跟著搬(貼完應該提到 pcm_cart_already_paid)'
SELECT p.pronargs, pg_catalog.length(pg_catalog.obj_description(p.oid,'pg_proc')) AS 長度,
       pg_catalog.strpos(COALESCE(pg_catalog.obj_description(p.oid,'pg_proc'),''),
                         'pcm_cart_already_paid') > 0 AS 提到守門
  FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname = 'create_order' ORDER BY p.pronargs;

\echo '════ 🟢🔵 對照'
SELECT (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='create_order')                        AS 綠_create_order支數_期望2,
       (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='begin_charge_attempt')                AS 綠_對照那支_期望1,
       (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.proname='zzq_no_such_fn_0906')                 AS 藍_不存在的_期望0;
