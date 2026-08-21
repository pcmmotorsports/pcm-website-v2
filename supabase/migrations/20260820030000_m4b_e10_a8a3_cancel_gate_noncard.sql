-- ============================================================
-- M-4b E10 · A8a3:取消閘按【收款方式】分岔 —— 現金 / 匯款的已付款單可以取消
-- ============================================================
-- 真權威 plan:~/pcm-mailbox/W1-078-拆閘與取消介面-plan-20260820.md(定稿 §10;
--   Sean 2026-08-20 逐字「開工」批准)。基線 = 20260805100000(A8a2)的 6 參版。
-- 鐵則 12①(錢)。關卡1 codex 對抗審 R1 FAIL 8 條 → 折入 → R2 FAIL 7 條 → 折入(§7/§9)。
--
-- ⛔ **本檔尚未 apply,而且不由施工窗 apply** —— apply 要 Sean 在場(鐵則 12①③)。
--
-- ── 這一片改了什麼(只有這些;函式其餘部分是從 A8a2 原檔【程式抽出】的,零手抄)──────
--   ① 步7 允許集合    :unpaid **或** 非卡已付款(讀 order_payments.rail 集合)
--   ② 冪等重放 ⑤      :與 ① 同一條述詞(不同步改 ⇒ 重送同一顆冪等鍵被擋 ⇒ 外觀像隨機失敗)
--   ③ audit 快照比對  :payment_status 值域放寬成 {'unpaid','paid'}
--                       ⇒ 「before 整顆等值」換成 鍵在 + 鍵數 + 型別 + 值域 + 前後一致
--   ④ SECDEF fail-open 面:八張表 → **九張**(新讀 public.order_payments)
--   ⑤ COMMENT 換新
--   🔴 **attempts 那一半一個字都沒動** ⇒ 20260809160000(L3a)COMMENT 記的跨檔不變式
--      「cancelled ⇒ 無 active attempt」**字面上**不受影響。刷卡單照樣被它擋住。
--
-- 🔴🔴 **而「字面成立」不等於「事實成立」—— 這一格是 BLOCKER,本檔【尚未解決它】**
--   (codex 關卡2 R3 抓到,我開檔核過原始碼、不是照註解):
--   那條不變式存在的**目的**是「**被取消的單不會擋住客人重新結帳**」。
--   舊規則下能取消的單必定 unpaid ⇒ 取消後仍 unpaid ⇒ 永遠不滿足那三處的「已 paid」。
--   本片讓「現金已付款」的單可以取消,而**取消不改 payment_status**
--   ⇒ 產生新形狀 **cancelled=true 且 payment_status='paid'** ⇒ 它**滿足**那三處:
--     ① find_active_sibling_own  20260624120001_*.sql:60-75  逐字 `o.payment_status = 'paid'` 無 cancelled_at 條件
--     ② begin_charge_attempt dedup 20260613130000_*.sql:396-412 同上
--   ⇒ **客人重新結帳時會撞上自己那張【已經被取消】的單。**
--   ⚠️ ~~傷害方向是**過度阻擋,不是雙扣**;而它不產生客訴以外的訊號。~~
--   🔴🔴 **2026-08-20 更正(W2 真瀏覽器重現;原字面劃掉不刪,因為錯的那句已經被引用過)**:
--      **不是「擋住」,是「假成功」。** 實測畫面顯示「訂單已成立、我們會盡快為您出貨」,
--      而單號指向**那張已取消的舊單**;DB 裡**沒有任何新單被建立**、**沒有打過 TapPay**。
--      ⇒ 客人以為買到了、在等出貨,而**永遠不會出貨**。
--   🔴 **兩種壞的差別,就是這一格為什麼要更正**:
--      「擋住」  ⇒ 客人**知道**自己沒買到 ⇒ 會重試、會找客服 ⇒ **有回饋路徑**
--      「假成功」⇒ 客人**不會有任何動作** ⇒ 直到他發現貨一直不來 ⇒ **零回饋路徑**
--      ⇒ 我原本把它評成「客人只會覺得網站怪怪的」——**那個評估太輕,而它影響的是排序。**
--   📌 重現條件與正負對照見 `~/pcm-mailbox/W2-002-結帳BLOCKER重現-假成功-20260820.md`
--      (含正對照:同一次測正常下單一次、證明新單真的會被建立 ⇒ 量具不是壞的)。
--      ⚠️ 環境限定:拋棄式庫 / dev 模式 / getPrime 被 monkeypatch。
--   ✅ 而這個形狀**今天在正式站造不出來**(現行 payment_not_unpaid 閘還擋著)——
--      **它是片 A 會製造出來的東西,在它出生前被抓到。**
--   📌 而 L3a:36-37 早就逐字寫下這條指令,對象就是本片:
--     「誰要放寬取消/失效的條件,**必須同時回頭改那三處**」。
--   ⛔ **⇒ 本檔在那三處被處理之前,不得 apply。** 處置由主視窗/Sean 裁(見
--      ~/pcm-mailbox/W1-079-片A交件-等裁R3-20260820.md)。
--
-- ── 🔴 刻意【不做】的一件,以及它的殘餘風險 ───────────────────────────────
--   不加 `SUM(amount) > 0`。加了它,一張淨額 0 的 paid 單會變成「不可取消」,
--   而**並行插入一筆人工正額就會把它翻成可取消**(codex 關卡1 R2 的 E-1)。
--   要擋住得先枚舉 order_payments 的 writer 並補鎖序契約 —— 那是另一片的體積
--   (量到的:`grep -c "FOR UPDATE" supabase/migrations/20260810110000_m4b_e10_op2a_received_at_guard.sql` ⇒ 0)。
--   ⇒ 主視窗 2026-08-20 裁「乙」。殘餘風險與**落地必驗**寫在 backlog `#764`,不留在 commit body。
--
-- ── 🔴 這條述詞的語意是「**曾經**有過卡片收款」,不是「**現在**是非卡單」(W5 盲審 n-3)──
--   `order_payments` 是**歷史流水**:沖銷不刪列,而沖銷列被 FK `order_payments_reverses_same_order_rail`
--   (`20260810100000:310-312`)強制與被沖列**同 rail** ⇒ **有過 card 列,這個述詞就永遠為假**。
--   ⇒ 一張「先刷卡、卡腳被沖銷、改收現金」的單會**永久不可取消**。
--   ✅ **而它成立的理由是:那條路可能根本不存在** —— `20260812150000_..._opa12:141-143`
--      具名拒絕沖銷卡軌。⚠️ **可達性 W5 沒證出來、我也沒有** ⇒ **標未確認**。
--   ⇒ 方向是 **over-block(擋過頭)⇒ 安全**;而**若哪天卡軌變得沖銷得掉,這條述詞要重估**。
--   📌 這句話寫在這裡,是因為它是**這條述詞能成立的理由**,不是一個註腳。
--
-- ── ⚠️ 一格驗證不對稱(W5 盲審 n-2,認列)────────────────────────────────────
--   本檔很用力驗 `rail` 的 NOT NULL 與三值 CHECK(理由:值域是本片的承重點),
--   而「沒有 card 列 ⇒ 非卡」同樣承重在**卡軌真的會把收款寫進 order_payments**(OP3/OP4)——
--   本檔對那兩支的命中 = **0**。兩支今天都已 apply ⇒ 無現行風險,
--   但**同一個理由我只用了一半**,寫下來讓下一個人知道這一格沒有閘。
--
-- ── 為什麼判準不能讀 orders.payment_channel ────────────────────────────────
--   該欄 DEFAULT 就是 'tappay'(20260712203000:50-51),正式庫 19/19 都是它,
--   連 9 張從沒收過錢的 unpaid 單也是 —— **它是常數,不是資料**(W2 2026-08-19 實量)。
--   而同檔 COLUMN COMMENT(:88-89)自己逐字寫著「算實收金額用 payment_method+payment_status,
--   **勿用本欄**」⇒ 讀它會在每一張單上都說「這是 TapPay」。
--
-- ── 相依 ──────────────────────────────────────────────────────────────────
--   20260805100000(A8a2,本檔的基線)/ 20260810100000(OP1,order_payments 建表)
--   ⚠️ order_payments 對 service_role **零表權**(20260810100000:410)——
--      本函式是 SECURITY DEFINER、owner = 表 owner ⇒ **走 definer 權限讀得到**。
--      🔴 **不要為此補 GRANT**:那會觸發 20260810100000:690-701 的 apply 期閘、把那支炸掉。
--
-- ── 🔴🔴 上線順序與依賴(W5 盲審 MF-1/MF-2;**本檔在此之前讀起來像自足的一片,而它不是**)──
--
--   **① schema 先、UI 後**(與艦隊慣例相反,正因為這片是【放寬】)。
--      反過來(UI 先上、本檔後 apply)⇒ 現金已付款單上出現取消鈕 ⇒ 按下去被**舊閘**擋 ⇒
--      而拒絕訊息是 `v_generic_msg`(**刻意通用**)⇒ 員工看到一個沒有理由的失敗,而畫面自洽。
--      ⇒ **那是無法診斷的失敗**,不是「暫時不能用」。
--
--   **② 本函式【完全不碰錢】** —— 寫入只有四處(order_cancellations / _items /
--      UPDATE orders 的對客欄 / admin_audit_log),`payment_status` 原值帶過。
--      ⇒ 取消一張現金已付款單之後,狀態是:**單已取消、錢仍記為已收、零退款紀錄**。
--      🔴 而 Sean 逐字要的是「可以取消訂單 **and 退款**」⇒ **那一半在片 D**,
--         而片 D 需要的 `order_manual_refunds` 登記 RPC **至今不存在**
--         (`20260820010000` 檔頭逐字「登記用的 RPC 是下一片」)。
--      ⇒ ⇒ **本片單獨上線會開啟一個目前結不掉的狀態。**
--
--   ⛔⛔ **主視窗 2026-08-20 裁定:片 A 不得單獨上線。上線包與順序寫死:**
--        ```
--        ① 守門片(find_active_sibling_own + begin_charge_attempt 的 sibling dedup 各加 cancelled_at IS NULL)
--        ② 本片(A8a3 拆閘)
--        ③ 片 D 的【退款登記】那一段(order_manual_refunds 的寫入 RPC)
--        ⇒ 同一次 apply,順序不可顛倒
--        ```
--        **理由(逐字轉,而我同意)**:片 A 單獨上線 ⇒ 員工做得出一個系統裡**沒有辦法結清**的狀態
--        (單取消了、錢還掛在帳上、沒地方登記退款)。**那比「不能取消」更糟 ——
--        不能取消至少狀態是自洽的。**
--        ⚠️ 片 B(TS 鏡像)/ 片 C(介面搬家)**不在這個約束裡**(它們不製造那個狀態),
--           但**片 C 的取消鈕不得在上線包落地前對員工可見**。
--
--   **③ 客人動線的前置(codex R3 抓到、我開檔核過)**:見上面 BLOCKER 那一段 ——
--      `find_active_sibling_own` 與 `begin_charge_attempt` 的 sibling dedup 必須先加
--      `cancelled_at IS NULL`,**順序是「守門片 → 本片」**,不可顛倒。
--
-- ── ⚠️ 一條 codex 關卡2 打出來、而本片【刻意不修】的(認列,不藏)──────────────
--   重放路徑上,closing audit 的 `after.cancelled_at` 只被驗「非 NULL」+「訂單確實已關」,
--   **沒有驗它是不是 timestamp 字面** ⇒ 把它改成任意非 null 的 JSON 值,重放仍會通過。
--   🔴 **那是 A8a1/A8a2 就有的行為,不是本片造成的** —— 本片的 diff 只有 4 個 hunk,
--      而它們都不在那一段(可重跑:`diff -u` a8a2 的函式段 vs 本檔的函式段)。
--   ⇒ 修它要動重放判形那一整塊 = 另一片的範圍。**寫在這裡是為了讓下一個人查得到,不是待辦。**
--
-- Rollback:用 A8a2 的函式段跑一次 `CREATE OR REPLACE`(簽名相同 ⇒ 直接覆蓋、ACL 保留),
--   並把 §3 的 SECDEF 清單改回八張表。本檔零 DDL(不建表、不改欄、不動 trigger)⇒ 回退無資料面。
-- ============================================================

BEGIN;

-- ── 0. 前置閘:現行必須是 A8a2 那一版,而且本檔沒套過(forward-only)──────────
-- 🔴 **這裡刻意不用 md5 指紋**:寫這支檔的人沒有正式庫連線,算不出 md5
--    ⇒ 硬寫一個數字進來 = 一個**沒有來源的字面**。改用**碼錨**:指名它在找什麼字面,
--      而錯誤訊息把「找不到」與「已套過」分成兩種,不合成一句。
DO $$
DECLARE v_def text; v_src text; n integer;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF n <> 1 THEN
    RAISE EXCEPTION 'A8a3 前置閘:admin_cancel_order overload 數=%(預期恰 1);停下人工對齊', n;
  END IF;
  IF to_regprocedure('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行不是 6 參簽名(A8a2 版)——先 apply 20260805100000';
  END IF;
  v_def := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure);
  SELECT prosrc INTO v_src FROM pg_proc
   WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;

  -- 指紋①:本檔【已經套過了嗎】。先判這個,因為它與②互斥、而合成一句會讓人查錯方向。
  IF position('AND NOT EXISTS (SELECT 1 FROM public.order_payments op' in v_def) > 0 THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行已含本片的 rail 述詞 ⇒ **本檔已套過**(forward-only,拒重跑)。這不是「有人改壞了」';
  END IF;

  -- 指紋①b(K2 #4):**整份定義的 md5**。碼錨只錨得到我想得到的那幾行,
  --   「沒被錨到的那些行被人改過」它一律看不見 ⇒ 套下去會**無聲覆蓋正式庫的 drift 或 hotfix**。
  -- 🔴🔴 **期望值只有一份配方,而它就在下面十行**(W5 盲審 n-1:原本這裡寫著另一份【已過期】的
  --   配方 —— 它講 `pg_get_functiondef` 與「第 80-490 行」,而**程式碼比的是 `prosrc`**
  --   ⇒ 下一個人照那份重算會得到不同數字,然後把它誤判成「正式庫被改過」。已刪除,不留兩份)。
  --
  --   **重算方式(不需要資料庫)**:打開 20260805100000,取 `AS $fn$` 與 `$fn$;` **之間**那段文字,
  --   算 md5。實測:「從檔案算」= 「從 pg_proc.prosrc 算」= `81c21bfafded3011ceb7e2e6e5ddddc1`
  --   (prosrc 長度 20,396;W5 2026-08-20 獨立重算過,一字不差)。
  -- ⚠️ 不符 ⇒ **那是函式真的被改過**,不是伺服器排版差異(prosrc 不含排版)。停下人工判斷。
  -- 🔴🔴 **硬閘比的是 `prosrc`,不是 `pg_get_functiondef`**(K2 R2-A 打對了):
  --   後者含伺服器產生的**排版**(版本一換就可能不同)⇒ 拿它當硬閘會**誤擋一個正確的正式庫**。
  --   `prosrc` 是原始碼本身 ⇒ 版本無關。
  -- 🔴 期望值**不需要資料庫就能重算**(所以下一個人驗得動):取 20260805100000 的
  --   `AS $fn$` 與 `$fn$;` 之間那段文字,算 md5。已實測「從檔案算」與「從 pg_proc.prosrc 算」相同。
  IF md5(v_src) <> '81c21bfafded3011ceb7e2e6e5ddddc1' THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行 prosrc md5=%(期望 81c21bfafded3011ceb7e2e6e5ddddc1=A8a2 版)。prosrc 不含伺服器排版 ⇒ 這【不是】版本差異,是**函式真的被改過**。停下人工判斷,不要繞過、也不要改這個字面讓它過。診斷用:functiondef md5=%', md5(v_src), md5(v_def);
  END IF;

  -- 指紋②:現行是不是 A8a2 那一版(三個只有 A8a2 才有的字面,一次都不能少)
  IF position(''':partial:'' || v_canon' in v_def) = 0
     OR position('admin_cancel_order: 品項數量超出範圍' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行缺 A8a2 的碼錨(p_items 那一族)⇒ 它不是 A8a2 版;停下人工判斷現況是哪一版,**不要繞過本閘**';
  END IF;
  IF position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行缺步7 的 attempts 述詞字面 ⇒ 有人動過允許集合;停下人工對齊';
  END IF;
  IF position('jsonb_build_object(''payment_status'', ''unpaid'', ''cancelled_at'', NULL)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 前置閘:現行缺 audit 快照的 unpaid 字面 ⇒ 有人動過那道守門;停下人工對齊';
  END IF;

  -- 指紋③:本函式**新讀**的那張表要在,而且形狀是本檔預期的(rail 值域三值)
  IF to_regclass('public.order_payments') IS NULL THEN
    RAISE EXCEPTION 'A8a3 前置閘:public.order_payments 不存在 ⇒ 先 apply 20260810100000';
  END IF;
  -- 🔴 K2 #5:只驗「欄在」不夠。本片的判準是**否定式**(「沒有 card 列 ⇒ 放行」)
  --   ⇒ 只要 rail 漂移出第四個值,那個值會被當成非卡軌**誤放行**;而 rail 若可為 NULL,
  --     `op.rail = 'card'` 對 NULL 求值為 NULL(非 true)⇒ 一列 NULL 的卡片收款會靜靜穿過去。
  --   ⇒ 值域與 NOT NULL 都是本片的**承重點**,不是那張表自己的事。
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'public.order_payments'::regclass
                    AND attname = 'rail' AND NOT attisdropped AND attnum > 0 AND attnotnull) THEN
    RAISE EXCEPTION 'A8a3 前置閘:order_payments.rail 不存在或可為 NULL ⇒ NULL 的卡片收款會穿過「沒有 card 列」這道判準;停下人工對齊';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.order_payments'::regclass AND contype = 'c'
                    AND pg_get_constraintdef(oid) LIKE '%rail%'
                    AND pg_get_constraintdef(oid) LIKE '%''card''%'
                    AND pg_get_constraintdef(oid) LIKE '%''bank_transfer''%'
                    AND pg_get_constraintdef(oid) LIKE '%''cash''%') THEN
    RAISE EXCEPTION 'A8a3 前置閘:order_payments.rail 的三值 CHECK(card/bank_transfer/cash)找不到 ⇒ 值域可能已漂移,而漂出來的新軌會被本片當成非卡軌放行;停下人工對齊';
  END IF;

  -- ══ 🔴🔴 上線包前置閘(2026-08-20 補;**在此之前它們只是文件與紀律,不是這支檔擋得住的事**)══
  --   主視窗裁定逐字:「必須靠**權限或結構物理封死**,不能靠 apply 順序」——
  --   而本檔原本**沒有**這兩道(W3 讀全檔量到:to_regprocedure / cancelled_at IS NULL 命中零)
  --   ⇒ 照錯順序 apply 本片,它不會 RAISE、會直接套進去,製造出
  --     「取消了、錢還掛在帳上、沒地方登記退款」的狀態。**現在補上。**

  -- 閘一:**守門片必須先落地** —— 那兩支「擋客人重新結帳」的函式要已含 cancelled_at 排除。
  --   少了它:現金已付款單被取消之後,客人重新結帳會撞上自己那張已取消的單,
  --   而實測形狀是**假成功**(畫面說訂單已成立、而 DB 沒有新單)—— 不是「擋住」。
  IF to_regprocedure('public.find_active_sibling_own(uuid)') IS NULL
     OR to_regprocedure('public.begin_charge_attempt(uuid)') IS NULL THEN
    RAISE EXCEPTION 'A8a3 前置閘一:find_active_sibling_own / begin_charge_attempt 至少缺一支;停下人工對齊';
  END IF;
  IF position('o.cancelled_at IS NULL' in
        (SELECT prosrc FROM pg_proc WHERE oid = 'public.find_active_sibling_own(uuid)'::regprocedure)) = 0
     OR position('o.cancelled_at IS NULL' in
        (SELECT prosrc FROM pg_proc WHERE oid = 'public.begin_charge_attempt(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'A8a3 前置閘一:守門片(20260820020000)尚未 apply —— 那兩支函式還沒排除已取消的單。'
                    '🔴 先套守門片再回來。**不要拿掉這道閘**:少了它,本片會直接套進去,'
                    '而客人重新結帳會撞上自己那張已取消的單(實測是【假成功】:畫面說訂單已成立、DB 沒有新單)';
  END IF;

  -- 閘二:**退款登記路徑必須可用** —— 否則本片開啟一個系統裡結不掉的狀態
  --   (取消一張現金已付款單之後:單已取消、錢仍記為已收、而**沒有地方登記那筆退款**)。
  -- 🔴 這道驗的是「**能不能用**」不是「存不存在」—— 後者答不出分期開權的狀態:
  --   D1 建函式但零 GRANT、EXECUTE 由 D2 與沖銷 RPC 一起開
  --   ⇒ 「service_role 呼得到」為真 ⟺ **D1 與 D2 都已落地**。一道斷言覆蓋兩片。
  -- ⚠️ 而這道成立有一個前提:**新函式出生自帶 PUBLIC EXECUTE,而 has_function_privilege 把 PUBLIC 算進去**
  --   (實測,拋棄式 PG 17.10:不 REVOKE 的新 SECDEF 函式 ⇒ service_role/anon/authenticated 全 true)
  --   ⇒ 若 D1 沒有自己 REVOKE PUBLIC,本道在 D1 落地那一刻就已為真、封不住。
  --   ✅ D1 已把兩道 REVOKE 歸在自己那片並斷言 service_role=false ⇒ **前提成立**。
  --      這句寫在這裡,是因為**本道的判別力借自那一片**,而借來的東西要寫明出處。
  IF to_regprocedure('public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'A8a3 前置閘二:退款登記 RPC(admin_record_manual_refund)不存在 ⇒ 片 D 尚未落地。'
                    '🔴 本片會讓現金已付款單可以取消,而取消【不碰錢】⇒ 沒有登記路徑的話,'
                    '員工做得出一個系統裡結不掉的狀態(單取消了、錢還掛在帳上)。先套 D1+D2 再回來';
  END IF;
  IF NOT has_function_privilege('service_role',
        'public.admin_record_manual_refund(uuid,uuid,text,text,integer,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a3 前置閘二:service_role 呼不到退款登記 RPC ⇒ D2(開權那片)尚未落地。'
                    '🔴 函式存在不等於路徑可用 —— D1 是零 GRANT 的,EXECUTE 由 D2 開。先套 D2 再回來';
  END IF;

END
$$;

-- ── 1. 換函式(CREATE OR REPLACE;**簽名相同 ⇒ 不產生第二 overload、ACL 保留**)────
-- 🔴 下面整段函式本體是用程式從 20260805100000 抽出來的,只換了檔頭列的那三處。
--    每一處替換在產生時都 assert「恰命中 1 次」,命中 0 或 >1 即中止 ⇒ **沒有手抄面**。
CREATE OR REPLACE FUNCTION public.admin_cancel_order(
  p_order_id        uuid,
  p_idempotency_key uuid,
  p_actor           text,
  p_reason_code     text,
  p_reason_detail   text,
  p_items           jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
DECLARE
  v_order       record;
  v_existing    record;
  v_audit       record;
  v_detail      text;
  v_hash        text;
  v_reason_txt  text;
  v_canon       text;
  v_cid         uuid;
  v_bad         bigint;
  v_cnt         integer;
  v_expect      integer;
  v_partial     boolean;
  v_closed      boolean;
  v_generic_msg constant text := 'admin_cancel_order: 取消失敗';
BEGIN
  -- 步1 隔離閘(A8c 家族同款;RR 等鎖醒來舊快照會漏看真相表)
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;

  -- 步2 輸入驗(輸入類=具體訊息;§5.1d 七值映射=可測合約)
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 冪等鍵缺失';
  END IF;
  v_reason_txt := CASE p_reason_code
    WHEN 'customer_request' THEN '依您要求取消'
    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
    WHEN 'price_change'     THEN '依您要求取消'
    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
    WHEN 'internal_error'   THEN '依您要求取消'
    WHEN 'other'            THEN NULL
    ELSE NULL END;
  IF v_reason_txt IS NULL AND p_reason_code IS DISTINCT FROM 'other' THEN
    RAISE EXCEPTION 'admin_cancel_order: 未知取消原因碼';
  END IF;
  v_detail := pg_catalog.btrim(p_reason_detail);
  IF v_detail = '' THEN v_detail := NULL; END IF;
  IF p_reason_code = 'other' THEN
    -- 判空白=A7 CHECK 同款明列碼位(僅判定;入庫/hash/對客=btrim 原文,不剝內部字元)
    IF v_detail IS NULL OR pg_catalog.translate(v_detail,
         U&'\0009\000A\000B\000C\000D\0020\0085\00A0\00AD\1680\180E\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\200B\200C\200D\2028\2029\202F\205F\2060\2800\3000\3164\FEFF',
         '') = '' THEN
      RAISE EXCEPTION 'admin_cancel_order: other 需填取消說明';
    END IF;
    v_reason_txt := v_detail;
  ELSIF v_detail IS NOT NULL THEN
    RAISE EXCEPTION 'admin_cancel_order: 非 other 不得填說明';
  END IF;
  -- Δ p_items 具名矩陣驗(v2b;jsonb 同 object 重複 key=last-key-wins、收到前已丟失=誠實邊界)
  v_partial := p_items IS NOT NULL;
  IF v_partial THEN
    IF pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項清單需為非空陣列';
    END IF;
    -- 先判 typeof 再數鍵(兩段式;SQL OR 不保證短路,scalar 元素碰 jsonb_object_keys 會 22023 訊息失控)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el) <> 'object') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (SELECT count(*) FROM pg_catalog.jsonb_object_keys(el)) <> 2
                   OR NOT (el ? 'order_item_id') OR NOT (el ? 'quantity')) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'order_item_id') <> 'string'
                   OR (el->>'order_item_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項識別碼格式錯誤';
    END IF;
    -- 數量:jsonb number 且十進位整數字面(1.0/字串/boolean/null 全拒=canonical 單一產生式)
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE pg_catalog.jsonb_typeof(el->'quantity') <> 'number'
                   OR (el->>'quantity') !~ '^[0-9]+$') THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量需為正整數';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE (el->>'quantity')::numeric < 1 OR (el->>'quantity')::numeric > 2147483647) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項數量超出範圍';
    END IF;
    IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_items) e(el))
       <> (SELECT count(DISTINCT (el->>'order_item_id')::uuid) FROM pg_catalog.jsonb_array_elements(p_items) e(el)) THEN
      RAISE EXCEPTION 'admin_cancel_order: 品項重複';
    END IF;
    -- canonical 串:uuid 正規化後文字升冪、qty=驗證後 int 的 ::text(零雙 hash 面——
    -- 生 JSON 文字排序/去重會讓大寫 uuid 變體產生第二 hash 並繞過重複檢查,關卡2 抓)
    SELECT pg_catalog.string_agg(((el->>'order_item_id')::uuid)::text || '=' || ((el->>'quantity')::integer)::text,
                                 ',' ORDER BY ((el->>'order_item_id')::uuid)::text)
      INTO v_canon
      FROM pg_catalog.jsonb_array_elements(p_items) e(el);
  END IF;

  -- 步3 orders FOR UPDATE(第一觸表動作;§5.0 鎖序合約)
  SELECT id, payment_status, cancelled_at, cancelled_reason INTO v_order
    FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  v_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    'a8a1:v1:' || p_order_id::text || ':' || p_reason_code || ':' || coalesce(v_detail,'')
      || CASE WHEN v_partial THEN ':partial:' || v_canon ELSE ':full' END,
    'UTF8')), 'hex');

  -- 步4 冪等格(驗全產物集+硬不變式;任一不符=fail-loud;plan v2c §3.2-4)
  SELECT id, payload_hash, actor, reason_code, reason_detail INTO v_existing
    FROM public.order_cancellations
   WHERE order_id = p_order_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    -- hash 欄自身竄改由這裡抓(hash=輸入導出;header 欄位竄改由下方不變式抓)
    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ①header reason 欄位對輸入
    IF v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ②逐品項硬不變式 0 ≤ Σci ≤ quantity(bigint)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                 WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ③關單等價 + closing audit 判形 + reason 恰=closing header 映射
    IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (
          SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = p_order_id
             AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                            WHERE ci.order_item_id = oi.id), 0) < oi.quantity::bigint)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    IF v_order.cancelled_at IS NULL THEN
      IF v_order.cancelled_reason IS NOT NULL THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      -- 恰一筆 closing audit(after.closed=true 或 A8a1 三鍵關單形)且對客文字=其 header 映射
      IF (SELECT count(*) FROM public.admin_audit_log g
           WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
             AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                  OR (NOT (g.after ? 'closed')
                      AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                      AND (g.after->>'cancelled_at') IS NOT NULL))) <> 1 THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      IF v_order.cancelled_reason IS DISTINCT FROM (
           SELECT CASE c.reason_code
                    WHEN 'customer_request' THEN '依您要求取消'
                    WHEN 'out_of_stock'     THEN '商品供貨中斷,已為您取消'
                    WHEN 'long_leadtime'    THEN '交期無法配合,已為您取消'
                    WHEN 'price_change'     THEN '依您要求取消'
                    WHEN 'duplicate_order'  THEN '重複訂單,已為您取消'
                    WHEN 'internal_error'   THEN '依您要求取消'
                    WHEN 'other'            THEN c.reason_detail
                    ELSE NULL END
             FROM public.admin_audit_log g
             JOIN public.order_cancellations c ON c.id = (g.after->>'cancellation_id')::uuid
            WHERE g.target = 'order:' || p_order_id::text AND g.action = 'order.cancel'
              AND ((g.after ? 'closed' AND (g.after->>'closed')::boolean)
                   OR (NOT (g.after ? 'closed')
                       AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(g.after)) = 3
                       AND (g.after->>'cancelled_at') IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ④本 header 集合等式(雙向;整單=存在性條件化)
    IF v_partial THEN
      IF (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id = v_existing.id)
         <> pg_catalog.jsonb_array_length(p_items)
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                     WHERE NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                        WHERE ci.cancellation_id = v_existing.id
                                          AND ci.order_item_id = (el->>'order_item_id')::uuid
                                          AND ci.cancelled_quantity = (el->>'quantity')::integer)) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    ELSE
      IF EXISTS (
        SELECT 1 FROM public.order_items oi
        LEFT JOIN public.order_cancellation_items hc
               ON hc.cancellation_id = v_existing.id AND hc.order_item_id = oi.id
        CROSS JOIN LATERAL (SELECT oi.quantity::bigint
                 - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                              WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_existing.id), 0) AS rem) r
        WHERE oi.order_id = p_order_id
          AND ((r.rem > 0 AND hc.cancelled_quantity::bigint IS DISTINCT FROM r.rem)
               OR (r.rem <= 0 AND hc.order_item_id IS NOT NULL))) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
    END IF;
    -- ⑤payment 允許集合(A8a3:與步7 **同一條述詞**)+ 零在途 attempts
    -- 🔴 這裡不同步改的話:現金單第一次取消得了,而重送同一顆冪等鍵會在這裡被擋
    --    ⇒ 外觀是「隨機失敗」。三處述詞(步7 / 本處 / audit 快照)必須一起改。
    IF (v_order.payment_status <> 'unpaid'::public.payment_status
         AND NOT (v_order.payment_status = 'paid'::public.payment_status
                  AND EXISTS (SELECT 1 FROM public.order_payments op
                               WHERE op.order_id = p_order_id)
                  AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                   WHERE op.order_id = p_order_id AND op.rail = 'card')))
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- ⑥audit 恰一列且全欄相符(request_id 非 UNIQUE ⇒ 必數恰 1;closed 鍵條件比)
    SELECT g.* INTO v_audit FROM public.admin_audit_log g
     WHERE g.request_id = p_idempotency_key::text
       AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text;
    IF (SELECT count(*) FROM public.admin_audit_log g
         WHERE g.request_id = p_idempotency_key::text
           AND g.action = 'order.cancel' AND g.target = 'order:' || p_order_id::text) <> 1
       OR v_audit.actor IS DISTINCT FROM p_actor
       OR v_audit.reason IS DISTINCT FROM p_reason_code
       OR v_audit.source_app IS DISTINCT FROM 'admin'
       OR (v_audit.after->>'cancellation_id')::uuid IS DISTINCT FROM v_existing.id
       -- 快照比對(A8a1/a8a2 原為「before 整顆等值 + after 恆 unpaid」)。
       -- 🔴 **A8a3 把上面那句換掉,因為它已經不成立**:payment_status 的值域從單值 'unpaid'
       --    放寬成 {'unpaid','paid'} ⇒ 「整顆等值」寫不出來了。改成五道:鍵在 + 鍵數 + 型別 + 值域 + 前後一致。
       -- 🔴 **鍵在**與**型別**缺一不可:`->>` 對【缺鍵】與【JSON null】都回 NULL
       --    ⇒ 只驗取值的話,把鍵刪掉再塞一個別的鍵會整組穿過去(codex 關卡1 R2 的 C-1)。
       -- 🔴 **本段守的是「鍵形 + 值域 + 前後一致」,不守「值被整組替換」**:
       --    把 before 與 after 同時從 paid 改成 unpaid,本段抓不到 —— 逐字寫在這裡,不藏。
       --    擋它的在別層:admin_audit_log 對 service_role **只有 INSERT**
       --    (20260712210000:110-115 兩道 apply 期 ACL 斷言)且該表零 trigger(:161)
       --    ⇒ 要改那兩個值得有表 owner 權限,已不在本函式的射程內。
       OR NOT (v_audit.before ? 'payment_status')
       OR NOT (v_audit.before ? 'cancelled_at')
       OR (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.before)) <> 2
       OR pg_catalog.jsonb_typeof(v_audit.before->'cancelled_at') <> 'null'
       OR pg_catalog.jsonb_typeof(v_audit.before->'payment_status') <> 'string'
       OR v_audit.before->>'payment_status' NOT IN ('unpaid', 'paid')
       OR v_audit.after->>'payment_status' IS DISTINCT FROM (v_audit.before->>'payment_status') THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 權威值=本 op audit;缺鍵=判形 fallback(v2c:唯 A8a1 三鍵關單形 → true,其餘病理 RAISE)
    IF v_audit.after ? 'closed' THEN
      -- 鍵在:恰 4 鍵+值必 boolean(加鍵/JSON null/字串竄改=病理;codex R2 MF2)
      IF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) <> 4
         OR pg_catalog.jsonb_typeof(v_audit.after->'closed') <> 'boolean' THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;
      v_closed := (v_audit.after->>'closed')::boolean;
    ELSIF (SELECT count(*) FROM pg_catalog.jsonb_object_keys(v_audit.after)) = 3
          AND (v_audit.after->>'cancelled_at') IS NOT NULL THEN
      v_closed := true;
    ELSE
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- after.cancelled_at 與 closed 同形(codex R2 MF2:部分 audit 被塞非 NULL cancelled_at=病理)
    IF v_closed <> ((v_audit.after->>'cancelled_at') IS NOT NULL) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- closed 值交叉核對(關卡2 折入):audit 宣稱已關 ⇒ orders 必已關(反向=部分 op 的 false
    -- 在單子後來被關掉=合法,不設反向)
    IF v_closed AND v_order.cancelled_at IS NULL THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    RETURN pg_catalog.jsonb_build_object('cancelled', true,
      'cancellation_id', v_existing.id, 'idempotent', true, 'closed', v_closed);
  END IF;

  -- 步5 已取消守門+帳本健康閘(v2:新鍵也驗;PS4 的 header-only 病理由③擋)
  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_order.cancelled_reason IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_items oi
                 WHERE oi.order_id = p_order_id
                   AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint)
     OR EXISTS (SELECT 1 FROM public.order_cancellations c
                 WHERE c.order_id = p_order_id
                   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                    WHERE ci.cancellation_id = c.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步6 actor 存在且啟用(FK 只擋不存在;A7 債⑥)
  IF NOT EXISTS (SELECT 1 FROM public.staff s WHERE s.id = p_actor AND s.is_active) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步7 允許集合(A8a3 放寬:unpaid **或** 非卡已付款;attempts 那一半逐字不動)
  -- 🔴 判準讀 public.order_payments.rail 的集合,**不讀 orders.payment_channel**
  --    (該欄 DEFAULT 就是 'tappay'、正式庫 19/19 都是它 ⇒ 它是常數不是資料;W2 2026-08-19 實量)。
  -- 🔴 零收款列 ⇒ 不放行(態 C fail-closed):正式庫有一張 refunded 而收款帳本零列的舊單。
  -- 🔴 **刻意不看淨額**(不加 SUM(amount) > 0):那道條件在並行下會翻面 ——
  --    並行插入一筆人工正額會把「不可取消」變「可取消」(codex 關卡1 R2 的 E-1)。
  --    殘餘風險與落地必驗寫在 backlog #764,不留在 commit body。
  -- 🔴 attempts 那一半**一個字不動** ⇒ 20260809160000 L3a COMMENT 的跨檔不變式
  --    「cancelled ⇒ 無 active attempt」不受影響;而刷卡單照樣被它擋住,不必為它另寫一道閘。
  IF (v_order.payment_status <> 'unpaid'::public.payment_status
       AND NOT (v_order.payment_status = 'paid'::public.payment_status
                AND EXISTS (SELECT 1 FROM public.order_payments op
                             WHERE op.order_id = p_order_id)
                AND NOT EXISTS (SELECT 1 FROM public.order_payments op
                                 WHERE op.order_id = p_order_id AND op.rail = 'card')))
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  -- 步8 品項守門(鎖 items NKU 按 id 序=排序契約;額度只由真相算;摘要只驗在場不讀值)
  PERFORM 1 FROM public.order_items oi
   WHERE oi.order_id = p_order_id
   ORDER BY oi.id
   FOR NO KEY UPDATE;
  SELECT count(*) INTO v_cnt FROM public.order_items x WHERE x.order_id = p_order_id;
  -- 零品項單 fail-closed(row 36「零明細 header」;A7-t presence 是 DEFERRED 且訊息非通用,不倚賴)
  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 摘要在場一致閘(row 37 fail-closed 正解):真相非零的品項必有 summary 列,缺列=毀損 RAISE
  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0
           OR coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  IF v_partial THEN
    -- 請求品項必屬本單
    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi
                                   WHERE oi.id = (el->>'order_item_id')::uuid AND oi.order_id = p_order_id)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    -- 可取消量守門:增量 ≤ quantity − instock − cancelled(bigint;Q17=B;shipped 退化式)
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
      JOIN public.order_items oi ON oi.id = (el->>'order_item_id')::uuid
      WHERE (el->>'quantity')::bigint > oi.quantity::bigint
            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)
            - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    v_expect := pg_catalog.jsonb_array_length(p_items);
  ELSE
    -- 整單(含部分歷史收尾):任一品項有到貨 ⇒ 拒(Q17=B);全增量=0 ⇒ 拒(殘態重呼)
    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                                  JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                                 WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
    SELECT count(*) INTO v_expect FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0);
    IF v_expect = 0 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;

  -- 步9 寫入(同交易;items 按 order_item_id 序=排序契約;append-only)
  INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, reason_detail, payload_hash)
  VALUES (p_order_id, p_actor, p_idempotency_key, p_reason_code,
          CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END, v_hash)
  RETURNING id INTO v_cid;
  IF v_partial THEN
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, (el->>'order_item_id')::uuid, (el->>'quantity')::integer
      FROM pg_catalog.jsonb_array_elements(p_items) e(el)
     ORDER BY ((el->>'order_item_id')::uuid)::text;
  ELSE
    INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
    SELECT v_cid, p_order_id, oi.id,
           (oi.quantity::bigint - coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                              FROM public.order_cancellation_items ci
                                             WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0))::integer
      FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id AND ci.cancellation_id <> v_cid), 0)
     ORDER BY oi.id;
  END IF;
  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充請求集;必=預期筆數
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_expect THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
  -- 關單判定:寫後全域重算(此值=audit.closed=重放權威)
  v_closed := NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0));
  IF v_closed THEN
    UPDATE public.orders
       SET cancelled_at = pg_catalog.now(),
           cancelled_reason = v_reason_txt,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
    GET DIAGNOSTICS v_bad = ROW_COUNT;
    IF v_bad <> 1 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;
  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', CASE WHEN v_closed THEN pg_catalog.now() ELSE NULL END,
            'cancellation_id', v_cid, 'closed', v_closed),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;

  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'cancellation_id', v_cid,
    'idempotent', false, 'closed', v_closed);
END;
$fn$;

COMMENT ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) IS
  'M-4b E10-A8a1+A8a2+**A8a3** 訂單取消(SECURITY DEFINER、search_path=''''、lock_timeout=5s;service_role only)。'
  'A8a3(2026-08-20,Sean 逐字「開工」):允許集合從「僅 unpaid」放寬為 '
  '**unpaid 或(paid 且該單在 order_payments 有列、且無 rail=''card'' 的列)** —— 即現金/匯款收款的單可以取消。'
  '🔴 判準讀 order_payments.rail 的集合,**不讀 orders.payment_channel**(該欄 DEFAULT=''tappay''、'
  '正式庫 19/19 皆是它、含 9 張從未收款的 unpaid 單 ⇒ 它是常數不是資料;且該欄 COLUMN COMMENT 自己寫著「勿用本欄」)。'
  '🔴 **零收款列不放行**(態 C fail-closed:正式庫存在 refunded 而收款帳本零列的舊單)。'
  '🔴 **刻意不看淨額**(不加 SUM(amount)>0):那道條件在並行下會翻面(並行插入人工正額 ⇒ 不可取消變可取消);'
  '殘餘風險=淨額 0 的 paid 單會被放行取消,與**落地必驗**寫在 backlog #764。'
  '🔴 **attempts 那一半逐字不動**(仍要求無非 failed 的扣款嘗試)⇒ 刷卡單照樣被擋,'
  '且 20260809160000(L3a)COMMENT 記的跨檔不變式「cancelled ⇒ 無 active attempt」不受影響。'
  '同一條述詞出現在**三處**:步7、冪等重放 ⑤、以及 audit 快照比對的值域 —— 三處必須一起改,'
  '只改步7 的話「第一次取消成功、重送同一顆冪等鍵被擋」會表現成隨機失敗。'
  'audit 快照比對:payment_status 值域放寬成 {''unpaid'',''paid''} ⇒ 原「before 整顆等值」改為 '
  '鍵在 + 鍵數(恰 2)+ 型別(cancelled_at 為 JSON null、payment_status 為 string)+ 值域 + before/after 相等。'
  '⚠️ **本段守鍵形與值域,不守「值被整組替換」**(before/after 同時 paid→unpaid 抓不到);'
  '擋它的是 admin_audit_log 對 service_role 只有 INSERT + 零 trigger,已不在本函式射程。'
  '其餘行為(十步、p_items 具名矩陣、可取消量守門、關單判定、三道筆數守、append-only)一律沿用 A8a2,逐字未改。';

-- ── 2. ACL:service_role only ─────────────────────────────────────────────────
-- 🔴 `CREATE OR REPLACE` 且**參數型別未變** ⇒ 保留既有 proacl(見
--    docs/patterns/revoking-function-execute-in-supabase.md:121)⇒ A8a2 那兩道 REVOKE 仍有效。
-- ⚠️ **仍然照寫兩道**:成本為零,而「靠上一支做對了」不是一道防線(那份 patterns 檔 :24-25、
--    :92-99 的 PG 17.10 實測表:完全不 REVOKE ⇒ anon 執行得到)。
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cancel_order(uuid, uuid, text, text, text, jsonb) TO service_role;

-- ── 3. 結構 assert(A8a2 版式全繼承 + 本片 Δ)────────────────────────────────
DO $$
DECLARE v_def text; v_n integer; v_cfg text[]; v_bad text; v_fn_owner oid; v_tabs text[];
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname = 'admin_cancel_order';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'A8a3 結構 assert:overload 數=%(預期恰 1);拒繼續', v_n;
  END IF;
  SELECT pronargs, proconfig INTO v_n, v_cfg FROM pg_proc
   WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'A8a3 結構 assert:pronargs=%(預期 6);拒繼續', v_n;
  END IF;
  IF NOT ('lock_timeout=5s' = ANY(v_cfg)) OR NOT ('search_path=""' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'A8a3 結構 assert:proconfig=%(需 lock_timeout=5s+search_path="");拒繼續', v_cfg;
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc
           WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure) THEN
    RAISE EXCEPTION 'A8a3 結構 assert:prosecdef=false(SECURITY DEFINER 遺失=service_role 呼叫必炸);拒繼續';
  END IF;

  v_def := pg_get_functiondef('public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure);

  -- Δ 碼錨①:新述詞必須出現**恰兩次**(步7 + 冪等重放 ⑤)。
  -- 🔴 數次數不是數存在:只改一處也會讓「存在」為真,而那正是本片最容易犯的錯。
  -- 🔴🔴 K2 R2-B:三段各數 2 次**不保證它們在同兩個完整判斷式裡** —— 片段可以錯配到不同分支,
  --   而且 `pg_get_functiondef` **含註解** ⇒ 註解也能把次數補足(那正是 20260820010000 記過的坑:
  --   「整包字串當比對對象時,註解與 code 在裡面是同一種東西」)。
  -- ⇒ 改成錨**整條述詞**,並先把空白全部去掉(兩處縮排不同,不去空白比不了)。
  --   要偽造它,得在註解裡逐字重寫整條述詞 —— 那已經不是「不小心」的範圍。
  -- ⚠️ 去的是**空白與換行**:只去空白的話換行還在,兩處的斷行位置不同就比不起來(實測踩過)。
  IF (length(replace(replace(v_def, ' ', ''), E'\n', '')) - length(replace(replace(replace(v_def, ' ', ''), E'\n', ''),
        'IF(v_order.payment_status<>''unpaid''::public.payment_statusANDNOT(v_order.payment_status=''paid''::public.payment_statusANDEXISTS(SELECT1FROMpublic.order_paymentsopWHEREop.order_id=p_order_id)ANDNOTEXISTS(SELECT1FROMpublic.order_paymentsopWHEREop.order_id=p_order_idANDop.rail=''card'')))', '')))
     / length('IF(v_order.payment_status<>''unpaid''::public.payment_statusANDNOT(v_order.payment_status=''paid''::public.payment_statusANDEXISTS(SELECT1FROMpublic.order_paymentsopWHEREop.order_id=p_order_id)ANDNOTEXISTS(SELECT1FROMpublic.order_paymentsopWHEREop.order_id=p_order_idANDop.rail=''card'')))') <> 2 THEN
    RAISE EXCEPTION 'A8a3 碼錨:完整的允許集合述詞不是恰 2 處(步7 + 冪等重放 ⑤ 必須逐字相同);拒繼續';
  END IF;

  -- Δ 碼錨②:舊的單值述詞不得殘留(任一處沒改到就會命中)
  IF position('IF v_order.payment_status <> ''unpaid''::public.payment_status' in v_def) > 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:仍有「僅 unpaid」的舊述詞殘留 ⇒ 三處沒有同步改;拒繼續';
  END IF;

  -- Δ 碼錨③:audit 快照那五道
  IF position('NOT (v_audit.before ? ''payment_status'')' in v_def) = 0
     OR position('NOT (v_audit.before ? ''cancelled_at'')' in v_def) = 0
     OR position('jsonb_typeof(v_audit.before->''cancelled_at'') <> ''null''' in v_def) = 0
     OR position('jsonb_typeof(v_audit.before->''payment_status'') <> ''string''' in v_def) = 0
     OR position('v_audit.before->>''payment_status'' NOT IN (''unpaid'', ''paid'')' in v_def) = 0
     -- 🔴 K2 #7:原本漏錨這兩道 ⇒ 把它們刪掉斷言照樣綠。鍵數守門擋「塞第三個鍵」,
     --    前後一致擋「before 與 after 各說各話」。
     OR position('jsonb_object_keys(v_audit.before)) <> 2' in v_def) = 0
     OR position('v_audit.after->>''payment_status'' IS DISTINCT FROM (v_audit.before->>''payment_status'')' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:audit 快照七道守門缺(鍵在/鍵數/型別/值域/前後一致);拒繼續';
  END IF;
  IF position('jsonb_build_object(''payment_status'', ''unpaid'', ''cancelled_at'', NULL)' in v_def) > 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:audit 快照仍釘死字面 unpaid ⇒ 現金單重放會被誤擋;拒繼續';
  END IF;

  -- A8a2 碼錨全繼承(抽樣但逐條指名;拿掉任何一條都會紅)
  IF position('pg_catalog.current_setting(''transaction_isolation'') <> ''read committed''' in v_def) = 0
     OR position('USING ERRCODE = ''P8C01''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:隔離閘缺失;拒繼續';
  END IF;
  IF position('FROM public.orders WHERE id = p_order_id FOR UPDATE;' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:orders FOR UPDATE(第一觸表=鎖序合約)缺失;拒繼續';
  END IF;
  IF position(''':partial:'' || v_canon' in v_def) = 0 OR position(''':full''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:hash 域字面缺失;拒繼續';
  END IF;
  IF position('WHERE s.id = p_actor AND s.is_active' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:actor 守門缺失;拒繼續';
  END IF;
  IF position('WHERE a.order_id = p_order_id AND a.status <> ''failed''' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:attempts 那一半被動到了(本片不得改它);拒繼續';
  END IF;
  IF position('AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:摘要在場一致閘缺失;拒繼續';
  END IF;
  IF position(E'GET DIAGNOSTICS v_bad = ROW_COUNT;\n  IF v_bad <> v_expect THEN' in v_def) = 0
     OR position('-- audit 筆數守' in v_def) = 0 THEN
    RAISE EXCEPTION 'A8a3 碼錨:筆數守缺失;拒繼續';
  END IF;

  -- Δ SECDEF fail-open 面:**九張表**(A8a2 的八張 + 本片新讀的 order_payments)
  -- 🔴 少加這一張的話,order_payments 的 owner 不對齊或哪天開了 FORCE RLS,
  --    本函式會在**執行時**炸,而 apply 當下全綠。
  -- 🔴🔴 **清單長度自己驗**(2026-08-20 突變測試 M3 抓到的:原本寫成一串 IN (...),
  --    把 order_payments 從清單刪掉之後**全部斷言照樣通過**,而成功訊息還印著「九張表」
  --    ⇒ 那是恆真格 + 一句假話。改成陣列 + 長度斷言 + 逐項掃,刪任何一項都會紅。
  v_tabs := ARRAY['public.orders', 'public.order_items',
                  'public.order_cancellations', 'public.order_cancellation_items',
                  'public.order_item_procurement', 'public.order_item_procurement_receipts',
                  'public.payment_charge_attempts', 'public.admin_audit_log',
                  'public.order_payments'];
  IF array_length(v_tabs, 1) <> 9 THEN
    RAISE EXCEPTION 'A8a3 SECDEF 面:清單長度=%(預期 9=A8a2 的八張 + 本片新讀的 order_payments);有人動過清單,拒繼續',
                    array_length(v_tabs, 1);
  END IF;
  SELECT proowner INTO v_fn_owner FROM pg_proc
   WHERE oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure;
  SELECT string_agg(c.relname, ',') INTO v_bad
    FROM unnest(v_tabs) t(nm)
    JOIN pg_class c ON c.oid = t.nm::regclass
   WHERE c.relowner <> v_fn_owner OR c.relforcerowsecurity;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A8a3 SECDEF fail-open 面 — [%] owner 不對齊或 FORCE RLS on;拒繼續', v_bad;
  END IF;
  -- 🔴 K2 #8:原本這道是**恆真的** —— 把 order_payments 換成任一既有表的重複項,
  --   長度與 JOIN count 都還是 9 ⇒ 它數得出「幾張」,數不出「是不是那九張」。
  --   ⇒ 改成兩道:①去重後仍須 9(擋重複灌數)②order_payments **必須是成員**(擋換掉)。
  SELECT count(DISTINCT nm) INTO v_n FROM unnest(v_tabs) t(nm);
  IF v_n <> 9 THEN
    RAISE EXCEPTION 'A8a3 SECDEF 面:去重後只有 % 張(清單裡有重複項在灌數);拒繼續', v_n;
  END IF;
  -- 🔴 K2 R2-C:「去重 9 張 + 含 order_payments」仍然可以**把另外八張之一換成別的表**
  --   (只要那張表 owner 相同、沒開 FORCE RLS,所有斷言照樣綠)⇒ 改成**九張逐一具名驗在**。
  --   verbose 是刻意的:換掉任何一張都會紅,而那正是這道守門唯一的用途。
  SELECT string_agg(t.nm, ',') INTO v_bad
    FROM unnest(ARRAY['public.orders', 'public.order_items',
                      'public.order_cancellations', 'public.order_cancellation_items',
                      'public.order_item_procurement', 'public.order_item_procurement_receipts',
                      'public.payment_charge_attempts', 'public.admin_audit_log',
                      'public.order_payments']) t(nm)
   WHERE NOT (t.nm = ANY(v_tabs));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A8a3 SECDEF 面:預期的表不在清單裡(%)⇒ 有人把清單換掉了;拒繼續', v_bad;
  END IF;

  -- Δ ACL 實查:只有 owner 與 service_role 拿得到 EXECUTE
  -- 🔴 K2 #9:只問 anon / authenticated 是**列舉已知敵人**,而 `CREATE OR REPLACE` 保留既有
  --   proacl ⇒ 任何**自建角色**上次拿到的 EXECUTE 會原封留著,而上面那兩道問不到它,
  --   於是「僅 owner+service_role」這句話是假的。⇒ 改成**列舉實際 grantee**(同
  --   20260810100000:697 對 relacl 的做法),多出誰就報誰的名字。
  SELECT string_agg(DISTINCT g.grantee::regrole::text, ',') INTO v_bad
    FROM pg_proc p,
         LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
   WHERE p.oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure
     AND g.grantee <> 0                                   -- 0 = PUBLIC,下一道單獨判
     -- 🔴 K2 R2-D:原本白名單含字面 'postgres' —— 那假設 postgres **就是** owner,
     --   而那是兩個宣稱。改成只認「owner 本人」+ service_role,不認名字。
     AND g.grantee::regrole::text <> 'service_role'
     AND g.grantee <> p.proowner;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'A8a3 ACL:owner 與 service_role 以外還有 grantee(%)⇒「僅 owner+service_role」是假的;拒繼續', v_bad;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p,
                    LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure
                AND g.grantee = 0) THEN
    RAISE EXCEPTION 'A8a3 ACL:PUBLIC 仍有權限 ⇒ 兩道 REVOKE 沒生效;拒繼續';
  END IF;
  -- 🔴 K2 R2-D:`WITH GRANT OPTION` 讓被授權者**可以再授權給別人** ⇒ 那一格上面兩道都看不到,
  --   而它等於把「誰能執行」的控制權交出去。service_role 自己拿到可轉授也不行。
  IF EXISTS (SELECT 1 FROM pg_proc p,
                    LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
              WHERE p.oid = 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)'::regprocedure
                AND g.is_grantable AND g.grantee <> p.proowner) THEN
    RAISE EXCEPTION 'A8a3 ACL:有 grantee 拿到 WITH GRANT OPTION(可再轉授)⇒ 執行權的控制權已外流;拒繼續';
  END IF;
  IF has_function_privilege('anon', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a3 ACL:anon 或 authenticated 執行得到本函式;拒繼續';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A8a3 ACL:service_role 執行不到本函式(後台會整條壞掉);拒繼續';
  END IF;

  RAISE NOTICE 'A8a3 結構驗收通過:prosrc 前置指紋符(版本無關)/ overload 1 / 6 參 / SECDEF / proconfig 齊 / '
                '完整允許集合述詞(去空白換行後)恰 2 處 / 舊單值述詞零殘留 / audit 七道在 / A8a2 碼錨全繼承 / '
                'SECDEF 面 % 張(去重後量到的,非寫死;九張逐一具名驗在)/ '
                'ACL:grantee 列舉過、PUBLIC 零權、無 WITH GRANT OPTION', v_n;
END
$$;

COMMIT;
