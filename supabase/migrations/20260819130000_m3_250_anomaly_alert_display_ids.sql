-- ============================================================
-- 告警帶單號:**新增一支**只回單號陣列的受控窗 RPC
--            `get_payment_anomaly_alert_display_ids`
-- ============================================================
--
-- 🔴 **這一支打開的是一道【當初刻意關上】的閘,不是補一個漏寫的欄位。**
--   原設計逐字(`packages/use-cases/src/check-anomaly-alerts.ts` 檔頭):
--     「reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權;
--       回傳只計數、**零 PII/零金額/零 id**」
--   關它的理由:LINE 訊息會留在手機、可能被轉發或截圖。
--
--   ⇒ 🔴 **打開它的是 Sean 本人,2026-08-19,在知道上面那個隱私代價的情況下。**
--      起因:他當天早上 9 點收到一封他看不懂的告警,逐字要求
--      「以後這種訊息可以寫直白一點嗎?**寫上訂單單號**比較方便查詢是哪一筆訂單有問題,
--        然後訊息內容簡單白話、精簡,因為真的看不懂。」
--      主視窗把隱私代價講給他聽之後,他答「甲 = 批,開工」。
--      他採納的理由是他自己的:**「沒單號我查不到,那則告警等於只說『有事』」。**
--   ⇒ ⇒ **下一個讀到這裡的人:那道閘是被誰、為什麼打開的,寫在上面。不是有人忘了它。**
--      要關回去是可以的,而那要再問他一次 —— 不要當成修 bug 順手關掉。
--
-- 🔴 **它每天【檢查】一次,有事才寄**(`20260723120000_m3_s2_settle_sweep_pgcron.sql:12` 逐字
--   `pcm-anomaly-alert(0 1 * * *)` = UTC 01:00 = 台北 09:00;零筆時 `shouldAlert=false` 不寄)
--   ⚠️ ~~原句「每天都會寄一封」~~ 不準(關卡2 nit)—— 那是**執行**每天一次,不是**寄**每天一次。
--   ⇒ 這道閘打開之後,**單號會每天出現在他手機上**。這是評估隱私面時要一起看的事實。
--
-- ══════════════════════════════════════════════════════════════
-- 🔴🔴 **為什麼是【新增一支】,而不是把單號加進 `get_payment_anomaly_alert_summary`**
-- ══════════════════════════════════════════════════════════════
--   本片第一版就是那樣寫的,而 codex 對抗審查把它打掉了,理由是**它會安靜地倒退兩代**:
--   ```
--   那支 summary RPC 目前有【四代】定義，而它們住在四支不同的 migration 裡：
--     20260701120000  六計數
--     20260701130000  七計數（#256 pending 雙扣）      ← 🔴 我第一版抄的是這一代
--     20260810220000  改③：superseded 的 charged/released 併進 attempt_manual_review_count
--     20260819010000  加第八鍵 reviewed_unknown_unresolved_count
--   ⇒ 用 CREATE OR REPLACE 重貼整支 = 把後兩代的改動【一起刪掉】，而：
--      · 三綠不紅（它是 SQL）
--      · apply 不紅（語法完全合法）
--      · 告警照常寄，只是「被讓路轉人工」那一整類【從此計數為 0】
--   ```
--   🔴 **而我自己的驗證看不到它** —— 我在拋棄式 PG 只 apply 到 `20260701130000` 就停,
--      於是「基準 7 鍵」與我抄的那一代完全吻合。**我挑的截止點讓世界符合了我的假設。**
--   ⇒ ⇒ 改成新增一支獨立函式之後,**這一整類 bug 在結構上不可能發生**:
--      本檔一個字都沒有動到 summary RPC。
--
-- ⚠️ **代價,照實寫**:告警那一輪現在打**兩次** DB(計數一次、單號一次)。
--    ⇒ 兩次之間資料可能變動 ⇒ 計數與陣列長度**可以不一致**,而那是**預期**不是故障;
--      應用層照「以實際列出的數量算差額」處理(`check-anomaly-alerts.ts` 的 `orderLines`)。
--    ⇒ 一天一次的 cron,多一次唯讀查詢的成本可以忽略。
--
-- 🔴 **述詞必須與計數逐字同源** —— 這是本檔最容易壞而最不會被發現的地方。
--   五組 WHERE 抄自**當下最新那一代**(`20260819010000` 的函式體,行號見各段註解),
--   而其中 ③④⑤ 自 `20260810220000` 起就沒再變過(我逐段比對過 `20260810220000` 與 `20260819010000`)。
--   ⇒ 下面第 4 節有一道 **apply 期交叉斷言**:拿本函式的陣列長度去對 summary RPC 的計數,
--     對不上就 RAISE。**述詞哪天被改到不同步,那道斷言會在 apply 當下就吵。**
--
-- 鐵則:12②(權限:新 SECDEF 受控窗)+ 12③(DB 結構:新函式)+ 12⑤(對外:LINE/Email 推播內容)
--   ⇒ 標準片、9 步 SOP 全走、commit 前 codex 對抗審查(plan 批了不等於審查可以省)。
--
-- @see docs/specs/2026-08-19-anomaly-alert-plain-language-plan.md(真權威 plan,§v2 定案版)
-- @see supabase/migrations/20260819010000_m4a_close_manual_review_attempt.sql(述詞來源、最新一代)
-- @see docs/phase-1-backlog.md #250
-- ============================================================


-- ── 0. 🔴 前置閘:述詞依賴的欄位必須存在,否則 ③ 會【安靜地變窄】 ──
-- 少了 `superseded_at`,③ 只剩 `status='pending'` 那一半 ⇒ 「被讓路轉人工」那一族
-- 的單號永遠不會出現,而**計數照樣是對的** ⇒ 訊息上看起來只是「單號比較少」。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
     WHERE attrelid = 'public.payment_charge_attempts'::pg_catalog.regclass
       AND attname  = 'superseded_at'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION '單號陣列片:payment_charge_attempts.superseded_at 不存在 ⇒ 人工待確認那一類的述詞會與計數不同步;拒繼續';
  END IF;
END
$$;


-- ── 1. 新 SECDEF 受控窗:只回單號,不回任何計數 ──
-- 🔴 **`CREATE FUNCTION`,不是 `CREATE OR REPLACE`**(關卡2 must-fix):這是一個**新物件**。
--    用 `OR REPLACE` 的話,正式庫若已經有一支同簽名的同名函式(別人建的、或某次半套 apply 留下的),
--    我們會**安靜地覆寫它**而不是撞名停下 —— 而那正是本片自己在 §「為什麼是新增一支」裡
--    花整段講的那個病(重貼會蓋掉別人的東西)。**同一個錯,不要在自己的新物件上再犯一次。**
--    ⇒ 撞名時它會 `42P13/42723` 直接炸,而那是**要的**:炸了才有人去看那支是誰的。
CREATE FUNCTION public.get_payment_anomaly_alert_display_ids(
  p_refunding_stuck_seconds   integer,
  p_pending_dc_window_seconds integer,
  p_pending_dc_stuck_seconds  integer
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT pg_catalog.jsonb_build_object(
    -- 🔴 每一發 `LIMIT 100` = **payload 護欄**,與應用層的顯示上限 30 是【兩個不同用途的數字】,
    --    不是同一個常數的兩個落點(100 只防陣列無上界;30 管訊息讀不讀得完)。
    --    唯一的不變式:**100 >= 應用層顯示上限**;動應用層那顆之前先回來看這一行。
    -- 🔴 排序一律【帶唯一鍵收尾】(`display_id` 是 UNIQUE)—— 少了它,同時間戳的列
    --    在兩次查詢之間會換位置,而他每天都會收到一封 ⇒ 看起來像換了一批單。

    -- ① 雙扣候選 open —— 述詞同 summary 的 `open_count`(20260819010000:118)
    'open_display_ids',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(t.display_id ORDER BY t.created_at, t.display_id),
                pg_catalog.jsonb_build_array())
         FROM (SELECT o.display_id, a.created_at
                 FROM public.payment_double_charge_anomalies a
                 JOIN public.orders o ON o.id = a.old_order_id
                WHERE a.status = 'open'
                ORDER BY a.created_at, o.display_id
                LIMIT 100) t),

    -- ② 退款卡逾時 —— 述詞同 `refunding_stuck_count`(20260819010000:125-129),含同一組門檻夾擠
    'refunding_stuck_display_ids',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(t.display_id ORDER BY t.refund_claimed_at, t.display_id),
                pg_catalog.jsonb_build_array())
         FROM (SELECT o.display_id, a.refund_claimed_at
                 FROM public.payment_double_charge_anomalies a
                 JOIN public.orders o ON o.id = a.old_order_id
                WHERE a.status = 'refunding'
                  AND a.refund_claimed_at < pg_catalog.now()
                      - pg_catalog.make_interval(secs => GREATEST(0, LEAST(COALESCE(p_refunding_stuck_seconds, 86400), 30 * 24 * 3600)))
                ORDER BY a.refund_claimed_at, o.display_id
                LIMIT 100) t),

    -- ③ 人工待確認 —— 述詞同 `attempt_manual_review_count`(20260819010000:134-142)
    -- 🔴🔴 **`superseded_at` 那一段不可省**:它自 20260810220000 起就在計數裡。
    --    第一版本片漏了它(只寫 `status='pending'`)⇒ 「被讓路轉人工」那一族**單號全部消失**
    --    而計數照樣正確 ⇒ 值班看到「3 筆」卻只列得出 1 個單號。codex 對抗審查抓到的。
    'attempt_manual_review_display_ids',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(t.display_id ORDER BY t.created_at, t.display_id),
                pg_catalog.jsonb_build_array())
         FROM (SELECT o.display_id, a.created_at
                 FROM public.payment_charge_attempts a
                 JOIN public.orders o ON o.id = a.order_id
                WHERE a.needs_manual_review = true
                  AND ( a.status = 'pending'
                        OR ( a.superseded_at IS NOT NULL
                             AND a.status IN ('charged', 'released') ) )
                  AND o.payment_status = 'unpaid'::public.payment_status
                ORDER BY a.created_at, o.display_id
                LIMIT 100) t),

    -- ④ released 死卡 —— 述詞同 `released_stuck_count`(20260819010000:176-182)
    'released_stuck_display_ids',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(t.display_id ORDER BY t.released_manual_review_at, t.display_id),
                pg_catalog.jsonb_build_array())
         FROM (SELECT o.display_id, a.released_manual_review_at
                 FROM public.payment_charge_attempts a
                 JOIN public.orders o ON o.id = a.order_id
                WHERE a.released_manual_review_at IS NOT NULL
                  AND a.status = 'released'
                  AND o.payment_status = 'unpaid'::public.payment_status
                ORDER BY a.released_manual_review_at, o.display_id
                LIMIT 100) t),

    -- ⑤ 疑似重複扣款 —— 述詞同 `pending_double_charge_candidate_count`(20260819010000:183-207)
    -- 🔴 它是**一組兩張單**,回 `[[單號A, 單號B], …]`。
    --    `DISTINCT ON (customer_user_id, total)` = 每組**恰好一對**,與計數的 `GROUP BY` 同一個分組鍵
    --    ⇒ 組數與陣列長度對得起來。**不要改成 min(o1)/min(o2)** —— 兩個 min 可能來自不同的兩對,
    --      會湊出一組【不存在的組合】,而畫面上完全看不出來。
    'pending_double_charge_display_id_pairs',
      (SELECT COALESCE(
                pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(g.a_display_id, g.b_display_id)
                                     ORDER BY g.a_display_id),
                pg_catalog.jsonb_build_array())
         FROM (
           -- 🔴 `LEAST`/`GREATEST` 不是美化 —— 少了它,配對內的順序由 `o1.id < o2.id` 決定,
           --    而那是 **uuid 比大小**、與單號無關 ⇒ 同一組每天可能印成不同的順序,
           --    而他每天早上 9 點都會收到一封 ⇒ 他會以為那是兩件不同的事。
           --    (拋棄式 PG 實跑當場抓到:第一版回 `[["PCM-2026-0006","PCM-2026-0005"]]`。)
           SELECT DISTINCT ON (o1.customer_user_id, o1.total)
                  LEAST(o1.display_id, o2.display_id)    AS a_display_id,
                  GREATEST(o1.display_id, o2.display_id) AS b_display_id
             FROM public.orders o1
             JOIN public.orders o2
               ON o1.customer_user_id = o2.customer_user_id
              AND o1.total            = o2.total
              AND o1.id              <  o2.id
              AND o1.payment_status = 'paid'::public.payment_status
              AND o2.payment_status = 'paid'::public.payment_status
              AND o1.paid_at IS NOT NULL AND o2.paid_at IS NOT NULL
              AND pg_catalog.abs(EXTRACT(EPOCH FROM (o1.paid_at - o2.paid_at)))
                  < GREATEST(0, LEAST(COALESCE(p_pending_dc_window_seconds, 43200), 30 * 24 * 3600))
            WHERE EXISTS (
                    SELECT 1
                      FROM public.payment_charge_attempts a
                     WHERE a.order_id IN (o1.id, o2.id)
                       AND a.status = 'charged'
                       AND EXTRACT(EPOCH FROM (a.updated_at - a.created_at))
                           > GREATEST(0, LEAST(COALESCE(p_pending_dc_stuck_seconds, 600), 24 * 3600))
                  )
            ORDER BY o1.customer_user_id, o1.total, o1.display_id, o2.display_id
            LIMIT 100) g)
  );
$fn$;

COMMENT ON FUNCTION public.get_payment_anomaly_alert_display_ids(integer, integer, integer) IS
  'M-3 #250 告警帶單號(2026-08-19):owner-defined SECDEF 受控窗,payment_confirmer cron 唯讀讀【單號陣列】。回 jsonb 五鍵 open_display_ids / refunding_stuck_display_ids / attempt_manual_review_display_ids / released_stuck_display_ids / pending_double_charge_display_id_pairs(末者為 [[單號A,單號B],…],每組一對,組內順序由 LEAST/GREATEST 依單號定死)。🔴 這是【刻意打開的隱私閘】:原設計零 id(LINE 訊息會被轉發截圖),2026-08-19 Sean 本人在知道該代價的情況下拍板打開,理由「沒單號我查不到」;要關回去要再問他,不是修 bug。🔴 五組 WHERE 與 get_payment_anomaly_alert_summary 的對應計數【逐字同源】,apply 期有交叉斷言比對;改任一邊必須同時改另一邊。每發 LIMIT 100 = payload 護欄(與應用層顯示上限 30 是兩個不同用途的數字;不變式:100 >= 顯示上限)。🔴 本函式【不動】summary RPC 一個字 —— 那支有四代定義分散在四支 migration,重貼整支會安靜倒退兩代。payment_confirmer 對 anomaly 兩表/attempts/orders 零直讀、只 EXECUTE。';


-- ── 2. ACL:新函式 ⇒ 先全收再精準給 ──
-- 🔴🔴 **角色要逐個點名,`FROM PUBLIC` 一個【不夠】** —— 這是本片改寫時我掉的一行,codex R2 抓回來:
--    Supabase 在 `public` schema 有 function 的 default privileges ⇒ **新函式出生就自帶
--    `anon` / `authenticated` / `service_role` 的 EXECUTE**,而 `REVOKE … FROM PUBLIC`
--    **收不掉角色專屬的那三份**(PUBLIC 是「所有人」這個偽角色,不是那三個具名角色)。
--    ⇒ 少了下面那一行,第 3 節的斷言會 RAISE ⇒ **整支 migration 在 Sean 面前回滾**。
--    ⇒ 形狀逐字抄既有的 `20260701130000` §2(它一直都是這樣寫的,是我重寫時漏掉)。
REVOKE ALL ON FUNCTION public.get_payment_anomaly_alert_display_ids(integer, integer, integer) FROM PUBLIC, anon, authenticated, service_role, payment_confirmer;
GRANT EXECUTE ON FUNCTION public.get_payment_anomaly_alert_display_ids(integer, integer, integer) TO payment_confirmer;


-- ── 3. fail-closed assert:**授權清單必須【恰好】只有 payment_confirmer** ──
-- 🔴 這一格是 codex 對抗審查逼出來的:原本只點名檢查 anon/authenticated/service_role 三個角色,
--    而**點名式檢查看不到你沒點到的名字** —— 日後多一個 ops_reader / 分析用角色,
--    它拿得到單號而這道斷言照樣綠。⇒ 改成【列舉實際 grantee】,任何非預期的名字都炸。
--
-- 🔴🔴 **而這道斷言【看不到角色成員閉包】—— 讀到這裡就要知道,不要以為它蓋住了**:
--    `GRANT payment_confirmer TO ops_reader` 之後,`proacl` **一個字都不會變**
--    ⇒ 本斷言全綠,而 `ops_reader` 只要 `SET ROLE payment_confirmer` 就讀得出單號。
--    ⇒ **這不是本片引入的缺口**(既有那幾支 SECDEF migration 的 ACL 斷言同一個形狀),
--      主視窗 2026-08-19 裁「不在這片解、立 backlog」⇒ `docs/phase-1-backlog.md` `#665`。
--    ⚠️ 我第一版寫 `#664` —— **已被佔用**(條款版本那條,`:23416`)。我當時的檢查是
--       `grep '^### #664\.'`(帶**點**),而既有那條用的是 `·` ⇒ **我的尺比我的宣稱窄**,漏看了。
--    ⇒ **要驗成員閉包得查 `pg_auth_members` 的遞移閉包,那是全樹一起做的事。**
DO $$
DECLARE
  v_extra text;
BEGIN
  SELECT pg_catalog.string_agg(g.grantee, ', ')
    INTO v_extra
    FROM (
      SELECT pg_catalog.pg_get_userbyid((aclexplode(p.proacl)).grantee) AS grantee
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname = 'get_payment_anomaly_alert_display_ids'
         -- 🔴 鎖簽名,不能只比名字(codex R2 nit):日後有人建一支同名 overload 並授權給別人,
         --    不鎖簽名的話**這道斷言會為了別人的函式而炸**,而訊息會指向我們這一支 ⇒ 假紅、且指錯地方。
         AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'integer, integer, integer'
    ) g
   -- 🔴 `CURRENT_USER` 是關鍵字不是函式,**不可以寫成 `pg_catalog.current_user`**
   --    (那會被當成「pg_catalog 這張表的 current_user 欄」⇒ missing FROM-clause,實跑撞過)。
   --    排除它的理由:owner 自己的 EXECUTE 是 `CREATE FUNCTION` 天生給的,不是額外授權。
   WHERE g.grantee NOT IN ('payment_confirmer', CURRENT_USER);

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '單號陣列片:EXECUTE 授權清單多出非預期角色(%) — 只應有 payment_confirmer;拒繼續', v_extra;
  END IF;

  IF NOT has_function_privilege('payment_confirmer',
        'public.get_payment_anomaly_alert_display_ids(integer,integer,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION '單號陣列片:payment_confirmer 沒有 EXECUTE ⇒ 告警拿不到單號;拒繼續';
  END IF;
END
$$;


-- ── 4. 🔴 fail-closed assert:五鍵都在、都是 array、而且【與 summary 的計數對得起來】 ──
-- 這一格擋的是**述詞不同步** —— 那種壞法 apply 不會紅、三綠不會紅、告警照常寄,
-- 只有「筆數說 3、單號列 1 個」這種**要人去讀才看得出來**的症狀。
--
-- 🔴🔴 **兩支函式必須在【同一個 SELECT】裡呼叫,這不是寫法偏好**(codex R2 must-fix):
--    分成兩句 `v_a := f(); v_b := g();` ⇒ READ COMMITTED 下**是兩個快照**
--    ⇒ 中間有人新增一筆 open,就會拿到 `ids=0 / count=1` ⇒ **正式 apply 當場炸,而其實沒事**。
--    🔴 一個 apply 閘擋住 Sean 而理由是假的,**比漏抓更糟** —— 他會停在那裡等人查一個不存在的問題。
--    ⇒ 寫成一句 `SELECT f(), g() INTO …`:單一敘述 = 單一快照 ⇒ 競態在結構上消失。
--
-- ⚠️⚠️ **這道斷言【擋不住什麼】,寫在這裡因為讀的人會照它做決定**:
--    ① `count > 100` 時不比對(那是 LIMIT 造成的,預期不相等)⇒ 那一格**沒有覆蓋**。
--    ② 🔴 **空庫(或某一類今天剛好 0 筆)時,兩邊都是 0 ⇒ 這一格恆綠而什麼都沒證明。**
--       ⇒ **它有判別力的前提是「那一類今天有資料」** —— apply 在一個乾淨的庫上通過,
--         **不代表述詞是同步的**。真正證明過述詞的是拋棄式 PG 那一發(五類各種一筆真資料)。
DO $$
DECLARE
  v_ids     jsonb;
  v_counts  jsonb;
  v_key     text;
  v_pairs   text[][] := ARRAY[
    ['open_display_ids','open_count'],
    ['refunding_stuck_display_ids','refunding_stuck_count'],
    ['attempt_manual_review_display_ids','attempt_manual_review_count'],
    ['released_stuck_display_ids','released_stuck_count'],
    ['pending_double_charge_display_id_pairs','pending_double_charge_candidate_count']
  ];
  v_len     integer;
  v_cnt     integer;
BEGIN
  -- 🔴 一句 SELECT、一個快照(理由見上面那段;拆成兩句就是 codex R2 抓到的假紅來源)。
  SELECT public.get_payment_anomaly_alert_display_ids(86400, 43200, 600),
         public.get_payment_anomaly_alert_summary(86400, 43200, 600)
    INTO v_ids, v_counts;

  FOR i IN 1 .. pg_catalog.array_length(v_pairs, 1) LOOP
    v_key := v_pairs[i][1];
    IF NOT (v_ids ? v_key) THEN
      RAISE EXCEPTION '單號陣列片:回傳缺鍵 % ;拒繼續', v_key;
    END IF;
    IF pg_catalog.jsonb_typeof(v_ids -> v_key) <> 'array' THEN
      RAISE EXCEPTION '單號陣列片:% 不是 array(實 %);拒繼續', v_key, pg_catalog.jsonb_typeof(v_ids -> v_key);
    END IF;
    v_len := pg_catalog.jsonb_array_length(v_ids -> v_key);
    v_cnt := (v_counts ->> v_pairs[i][2])::integer;
    -- 🔴🔴 **NULL 要自己一格,不能靠下面那個比較**(codex R2 must-fix):
    --    summary 少了那個 count key ⇒ `v_cnt` 是 NULL ⇒ `v_cnt <= 100` 的結果是 **NULL 不是 false**
    --    ⇒ `IF` 不成立 ⇒ **直接放行**。一個寫著 fail-closed 的閘,在最該擋的情況下靜靜地開著。
    IF v_cnt IS NULL THEN
      RAISE EXCEPTION '單號陣列片:summary 回不出 % 這個計數鍵 ⇒ 兩支對不起來且無從比對;拒繼續', v_pairs[i][2];
    END IF;
    IF v_cnt <= 100 AND v_len <> v_cnt THEN
      RAISE EXCEPTION '單號陣列片:% 的陣列長度 % 與 % 的計數 % 不符 ⇒ 兩邊述詞不同步;拒繼續',
        v_key, v_len, v_pairs[i][2], v_cnt;
    END IF;
  END LOOP;
END
$$;
