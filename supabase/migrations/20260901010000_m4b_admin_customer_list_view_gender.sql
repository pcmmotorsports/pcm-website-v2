-- 20260901010000_m4b_admin_customer_list_view_gender.sql
-- ⟦客戶篩選多軸⟧ 段③:`admin_customer_list_v` 加 `gender` 欄(給 filter 用)。
--
-- ══ 🔴🔴 §0 本檔為什麼寫成【完整欄位列】而不是「只加一欄」════════════════════
--   ⛔ ~~原標題「§0 這支檔【同時補一個不是本片的洞】—— 而那是刻意的,不是範圍擴張」~~
--      (2026-09-01 早,線【權限登入】`-a0` 寫的)—— 🔴 **舊字面逐字留著,不刪**
--      —— 讓下一個搜「同時補一個不是本片的洞」的人**同一發撞到這裡**:
--      ~~「碼 f8f62cab 已上線而 20260826140000 帳本上零命中 ⇒ 員工挑生日月份會 42703 炸頁,
--        本檔同時補這個洞」~~
--   🔴 **那個結論是錯的,而推論鏈每一步都對。**主視窗 2026-09-01 用**唯讀正式庫**實測:
--      `admin_customer_list_v` 現有欄含 **birthday ⇒ 1 · birth_month ⇒ 1**
--      (🟢 正對照 active_order_count ⇒ 1 · 🔵 負對照 zzq0901nosuch ⇒ 0)
--      ⇒ ✅ **生日兩軸沒有壞。板上那個 ✅ 是對的。**
--      ⇒ 🔴 而 **`gender` ⇒ 0** ⇒ 段③ 那個洞是真的,只是比原本以為的小。
--
--   📌 **錯在哪:那條鏈的第一環是【帳本】,而帳本是一本帳,不是那個庫。**
--      量到的是 `APPLIED.tsv` 沒記 `20260826*`(repo 248 支 vs 帳本 231 支,差 16,反向 0)
--      ⇒ 而正式庫上它**在** ⇒ 📌 **帳本是【低報】的。**
--      🔴🔴 **⇒ 「帳本沒有」不可以讀成「沒有 apply」** —— 而那正是本檔第一版做的事。
--      ⚠️ 其餘 15 支**沒有人逐支判過**是還沒貼、還是貼了沒記 ⇒ 已另開板列等 Sean。
--
--   ⇒ **而本檔的形狀不變,理由換了一個:**
--     `CREATE OR REPLACE VIEW` 允許在尾端加欄,而寫完整欄位列 ⇒ **冪等,且不必先知道是哪一代**。
--     今天我們知道它是 0826 代,而完整列**仍然是最穩的形狀** —— 它不依賴那個知識,
--     所以它在「有人記錯了現在是哪一代」的世界裡也對。(主視窗 2026-09-01 裁定,逐字採用。)
--   ⚠️ 代價要明寫:**前 11 欄必須與 `20260826140000:131-158` 逐字同序**
--      —— 順序不同 ⇒ `CREATE OR REPLACE` 直接報錯。那是好事:它會**吵**,
--      不會安靜地做出第三種形狀。
--
-- ══ §1 為什麼 gender 只給 filter、不給 select ═════════════════════════════════
--   原樣沿用 `20260826140000` §2 對 birthday 的那條決定:
--   列表投影白名單 `ADMIN_CUSTOMER_LIST_SELECT`(`SupabaseCustomerAdapter.ts:113`)**一個字不改**
--   ⇒ 性別**不出現在列表畫面上**,只用來篩。
--   🔴 理由與 birthday 同源:PII 只在明細頁。**「能篩」與「能看」是兩件事**,
--      而把它加進 select 會違反一條既有決定,而那條決定不是本片能推翻的。
--
-- ══ §2 🔴 值域是【代碼】不是中文 ═════════════════════════════════════════════
--   `customers.gender` 的 CHECK 在 `20260831150000` 已改成 `male / female / undisclosed`
--   (帳本 :339 記著 Sean 本人貼、`-15` 唯讀複驗 `pg_get_constraintdef` 逐字)。
--   ⇒ view 原樣透出,不做任何轉換 —— 中文標籤住在 `@pcm/schemas` 的 `GENDER_LABEL`,
--     那是唯一真相(`packages/schemas/src/index.ts:61`)。
--   🔴 **不在這裡 coalesce NULL** —— 照 birth_month 那條同樣的理由:
--      NULL 的意思是「沒有值」,而它同時涵蓋「沒被問」(Google/LINE 註冊的人)與「問了沒填」。
--      填掉它 ⇒「另有 N 人沒填性別」那個 N 永遠是 0。
--
-- ══ §3 索引:本檔建【生日那兩支】,不建 gender 那支 ═══════════════════════════
--   ⛔ ~~原句:「生日兩支用 `IF NOT EXISTS`,在『在』與『不在』兩個世界都對 ⇒ 保留」~~
--      🔴 **已作廢 —— pre-commit 閘擋下 `CREATE … IF NOT EXISTS`,而它是對的**(理由見 §2)。
--   ✅ 現況:**本檔一支索引都不建,只在 §6⑧ 斷言生日那兩支在**;
--      查無 ⇒ 紅,訊息叫你去 apply `20260826140000`。
--   🔴 而斷言驗的是【定義】不是【名字】,那一條仍然成立且更重要了 ——
--      因為現在沒有 CREATE 了,唯一擋得住「同名而建錯運算式」的就是那道斷言
--      (0826 §7 量過:少 `::smallint` ⇒ 永遠 Seq Scan,而什麼都不會紅)。
--   · 🔴 **gender 不建索引,而這是判斷不是遺漏**:三個值的欄位選擇度極低
--     (最好的情況也只濾掉 2/3),PG 幾乎一定選 Seq Scan ⇒ 建了只是多一份寫入成本。
--     🛑 **而「三個值 ⇒ PG 幾乎一定選 Seq Scan」這句是【推的,不是量的】**
--        (codex R1 2026-09-01 nit,我採認):本片**沒有跑過 EXPLAIN**。
--        ⚠️ 而它在**資料偏斜**時可能先錯:若 `undisclosed` 只佔 1%,
--           篩那個值的查詢是會用到索引的 —— 「三個值」講的是**基數**,
--           而 planner 看的是**選擇度**,那是兩件事。
--     ⚠️ 而這個判斷綁著一個會過期的前提:**今天 `customers` 只有 14 筆**。
--     🔴🔴 **重看條件:`customers` 超過 10,000 筆時。**
--        而**沒有東西會提醒你** —— 三綠不會紅、審查看不出來、畫面只是慢一點。
--        📌 **這一行就是那個提醒。**(主視窗 2026-09-01 要求標死,逐字採用。)
--
-- ══ §4 不 apply ══════════════════════════════════════════════════════════════
--   本檔由 Sean 本人在 SQL Editor 貼;施工窗不 apply、不碰正式庫。
--   ⚠️ 版本號 `20260901010000` 我查過 repo 與帳本皆 0 命中,**而發號權在主視窗**
--      (`20260831140000` 撞過一次)⇒ 貼之前請主視窗確認號沒被別的窗拿走。

-- ══ 🔴🔴 §5 給貼這支檔的人(Sean)—— 三件事,順序不可換 ═════════════════════════
--   ⚠️ codex R3(2026-09-01 換角度)開的:前兩輪都在問「SQL 對不對」,
--      **而沒有人問「災難當天,貼的那個人手上有沒有足以行動的東西」。**
--
--   ── ① 貼【之前】:Vercel 上那顆旗標必須是【關的】────────────────────────
--      `ADMIN_CUSTOMER_GENDER_FILTER` —— 沒設 或 不等於 `1` 都算關。
--      🔵 順序的理由:旗標關著時,後台**不會出現性別下拉**,也不吃 `?gender=` 網址
--         ⇒ 貼的過程中不論成功失敗,員工那邊**看不出差別**。
--
--   ── ② 貼【之後】:跑這一段確認(它只讀,不改任何東西)────────────────────
--      🔴 **`Success. No rows returned` 【不是】證據** —— 那句話在
--         「貼了全部」與「只貼到一半的某個成功語句」都會出現。
--      ```sql
--      SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS 欄位
--        FROM information_schema.columns
--       WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
--      ```
--      ✅ **要看到的**:最後三個字是 `birthday,birth_month,gender`
--      🔴 **看不到 `gender`** ⇒ 沒貼成功 ⇒ **旗標不要開**,回報。
--
--   ── ③ 確認 ② 之後,才去 Vercel 把旗標設成 `1` ─────────────────────────
--      🔴 反過來做(先開旗標)⇒ 員工按下性別下拉 ⇒ 整頁顯示「客戶列表載入失敗」,
--         而那句話**與資料庫暫時斷線長得一樣** ⇒ 會被誤診成「等一下再試」。
--
--   ── 🆘 出事了要回去:貼這一段(可直接複製,已包交易)──────────────────────
--      🛑 **第 0 步:先把 Vercel 那顆旗標關掉(設成 0 或刪掉),再貼下面的 SQL。**
--         順序反了 ⇒ DB 已經退回 11 欄而旗標還開著 ⇒ **客戶頁持續故障**。
--      ⚠️ 而下面這段是 `20260826140000` 的 view 段的**副本** ——
--         📌 **副本會過期**:貼之前先確認那支檔的 `CREATE … VIEW` 到 `birth_month`
--            那一段與下面逐字相同;不同 ⇒ **以那支檔為準,不要用這份**。
--      ```sql
--      BEGIN;
--        SET LOCAL lock_timeout = '5s';
--        DROP VIEW public.admin_customer_list_v;   -- 這會一起丟掉所有 COMMENT
--        CREATE VIEW public.admin_customer_list_v
--          WITH (security_invoker = true) AS
--        SELECT c.user_id, c.name, c.email, c.phone, c.tier, c.created_at,
--          (SELECT count(*) FROM public.orders o
--            WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL) AS active_order_count,
--          (SELECT coalesce(sum(o.total), 0) FROM public.orders o
--            WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL) AS active_spend_total,
--          (SELECT max(o.created_at) FROM public.orders o
--            WHERE o.customer_user_id = c.user_id AND o.cancelled_at IS NULL) AS last_active_ordered_at,
--          c.birthday AS birthday,
--          extract(month from c.birthday)::smallint AS birth_month
--        FROM public.customers c;
--        REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
--        REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
--        GRANT SELECT ON public.admin_customer_list_v TO service_role;
--        COMMENT ON COLUMN public.admin_customer_list_v.birthday IS
--          '客戶生日(date)。給 filter 用, 不給 select 用。';
--        COMMENT ON COLUMN public.admin_customer_list_v.birth_month IS
--          '生日的月份 1-12(smallint)。沒填生日 = NULL(刻意不 coalesce)。';
--        -- 🔴 回滾自己的驗收:回不到 11 欄就整筆退,不留半套
--        DO $rb$
--        DECLARE v_cols text;
--        BEGIN
--          SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
--            FROM information_schema.columns
--           WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
--          IF v_cols IS DISTINCT FROM 'user_id,name,email,phone,tier,created_at,'
--                                     || 'active_order_count,active_spend_total,'
--                                     || 'last_active_ordered_at,birthday,birth_month' THEN
--            RAISE EXCEPTION '回滾未完成 — 欄名或順序不對。實際:%', coalesce(v_cols, '(NULL)');
--          END IF;
--        END
--        $rb$;
--      COMMIT;
--      ```
--      ⚠️ 那兩則 COMMENT 是**簡寫版**(原文很長)——
--         回滾的目的是讓後台能用,不是把註解一字不差地復原。完整版在 `20260826140000`。

BEGIN;

-- ⛔ ~~原句:「兩支 CREATE INDEX 要取得鎖」~~ ⇒ **已過期**:本檔改成不建索引之後,
--    需要鎖的是 `CREATE OR REPLACE VIEW`(它要 view 的 ACCESS EXCLUSIVE)。
--    🔴 **timeout 三行照留,理由沒變**:正式庫有長交易在讀 `customers` 時,
--       這支會排隊,而排隊中的 DDL 會連帶堵住後面的流量。照 `20260811060000:54-58` 的 house 值。
--    (成因:B-1 `20260831140000` 第一版沒寫,codex R1 must-fix 逐字
--     「資料列少只能讓 CHECK 掃描很快,不能縮短【等待取得鎖】的時間」。)
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

-- ══ 1. view ═══════════════════════════════════════════════════════════════════
-- 🔴 前 11 欄與 `20260826140000:131-158` 逐字相同、順序相同 —— 見 §0 那條代價。
CREATE OR REPLACE VIEW public.admin_customer_list_v
  WITH (security_invoker = true) AS
SELECT
  c.user_id,
  c.name,
  c.email,
  c.phone,
  c.tier,
  c.created_at,
  (SELECT count(*)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS active_order_count,
  (SELECT coalesce(sum(o.total), 0)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS active_spend_total,
  (SELECT max(o.created_at)
     FROM public.orders o
    WHERE o.customer_user_id = c.user_id
      AND o.cancelled_at IS NULL)                       AS last_active_ordered_at,
  c.birthday                                            AS birthday,
  extract(month from c.birthday)::smallint              AS birth_month,
  -- 🔴 新欄。**只給 filter 用, 不給 select 用**(見 §1)。原樣透出代碼, 不轉中文(見 §2)。
  c.gender                                              AS gender
FROM public.customers c;

-- ══ 2. 索引 —— 🔴 **本檔【不建】任何索引,只【驗】生日那兩支在不在** ═════════
--   ⛔ ~~上一版這裡有兩句 `CREATE INDEX IF NOT EXISTS`~~ ⇒ **被 pre-commit 閘擋下,而它是對的。**
--      閘逐字:「撞名要當場紅,不要靜靜跳過。跳過之後,你的 REVOKE 與斷言會對著那個
--      既有物件跑而且很可能通過 —— 拿到綠燈,而這支 migration 什麼都沒建。」
--   📌 **而最難看的一格是:我自己的檔裡就引用過同一條理由**(見 `20260826140000:71-72`
--      「不用 `IF NOT EXISTS`:它把【撞到不一致】從 error 變成 silent skip」)——
--      **我引用了那條規矩,然後在同一支檔裡違反它。**
--
--   ✅ 而拿掉它們**沒有損失**,因為原本加它們的理由已經不成立:
--      我寫它們時以為「0826 可能沒 apply ⇒ 索引可能不在」,
--      而主視窗 2026-09-01 用唯讀正式庫量到 `birthday ⇒ 1` / `birth_month ⇒ 1`
--      ⇒ **正式庫就是 0826 代 ⇒ 那兩支索引在。**
--   ⇒ 📌 本檔改成【斷言它們在】(§6⑧)。在 ⇒ 過;不在 ⇒ **紅,並告訴你去 apply 0826**
--      —— 那比默默補建一支索引誠實,也不會讓本檔悄悄變成別人那一片的補丁。

-- ══ 3. 權限 —— 明寫一次, 不靠「CREATE OR REPLACE 會保留」═══════════════════════
-- 🔴 靠「它會保留」= 靠一個不在本檔裡的行為。原樣抄 `20260826140000:162-164`, 冪等。
REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_customer_list_v TO service_role;

-- ══ 4. COMMENT —— 三則都明寫 ═════════════════════════════════════════════════
-- 🔴 為什麼連 birthday / birth_month 那兩則也重寫:**本檔要在兩個世界都對**(§0)。
--    0826 若沒 apply, 那兩則從來沒被寫過 ⇒ 只寫 gender 那則會留下兩個沒有說明的欄。
COMMENT ON COLUMN public.admin_customer_list_v.birthday IS
  '客戶生日(date)。🔴 **給 filter 用, 不給 select 用** —— 列表白名單 ADMIN_CUSTOMER_LIST_SELECT '
  '刻意不含它(PII 只在明細頁, customer-repository.ts:14-16)。加進 select 會違反那條既有決定。';
COMMENT ON COLUMN public.admin_customer_list_v.birth_month IS
  '生日的月份 1-12(smallint)。給「這個月生日」篩選 —— PostgREST 的 filter 吃不了運算式, '
  '所以必須先在 view 裡變成欄。🔴 沒填生日 = NULL(刻意不 coalesce):'
  '「另有 N 人沒填生日」那個 N 就是靠這一欄 IS NULL 數出來的, 填掉會讓它永遠是 0。';
COMMENT ON COLUMN public.admin_customer_list_v.gender IS
  '性別代碼 male / female / undisclosed(值域由 customers_gender_chk 管, 20260831150000)。'
  '🔴 **給 filter 用, 不給 select 用** —— 同 birthday 那條理由, 列表投影白名單不含它。'
  '🔴 NULL 刻意不 coalesce:它同時涵蓋「沒被問」與「問了沒填」, 而**多數人會是 NULL** —— '
  '只有【Email 註冊路徑】會填這一欄, Google / LINE 進來的使用者恆 NULL(結構, 不是漏做; '
  '全文在 customers.gender 的 COMMENT)。⇒ 任何「性別分布」統計都只涵蓋 Email 註冊那一群。';

-- ══ 5. apply 時的自我斷言 ═════════════════════════════════════════════════════
-- 🔴 只放結構不變式, 不放需要造資料的值斷言(值斷言會污染正式庫)——
--    原樣沿用 `20260826140000` §5 的立場與逐條形狀。
DO $verify$
DECLARE
  v_def  text;
  v_cols text;
  v_cnt  integer;
  v_who  text;
BEGIN
  SELECT pg_get_viewdef('public.admin_customer_list_v'::regclass, true) INTO v_def;

  -- ① 正向對照:先證抓得到定義(抓不到的話下面每一條都恆真)
  IF v_def IS NULL OR length(v_def) < 50 THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 抓不到 view 定義(長度 %),下面的斷言全部沒有判別力',
      coalesce(length(v_def), -1);
  END IF;

  -- ② 判別條件逐字沿用上游:仍不得透出儲值/成本欄
  IF v_def ~* '\mwallet_balance\M' OR v_def ~* '\mtotal_deposit\M' THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 定義裡出現 wallet_balance/total_deposit。'
      '🔴 本檔加的是【一顆 filter 用的欄】, 不是鬆綁那一條';
  END IF;

  -- ③ 上游契約②:仍不得 GROUP BY / DISTINCT / JOIN(含吃得下別名的舊式 join)
  IF v_def ~* '\mgroup\s+by\M' OR v_def ~* '\mdistinct\M' OR v_def ~* '\mjoin\M' THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 定義裡出現 GROUP BY / DISTINCT / JOIN,違反上游寫法契約②';
  END IF;
  IF v_def ~* 'from\s+[a-z_."]+(\s+(as\s+)?[a-z_"]+)?\s*,' THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 最外層 FROM 出現逗號(舊式 join),違反上游寫法契約②';
  END IF;

  -- ④ 🔴 欄名白名單 —— 12 欄, **順序也釘**
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
  IF v_cols IS DISTINCT FROM 'user_id,name,email,phone,tier,created_at,'
                             || 'active_order_count,active_spend_total,last_active_ordered_at,'
                             || 'birthday,birth_month,gender' THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 欄名或順序不符白名單。實際:%', coalesce(v_cols, '(NULL)');
  END IF;

  -- ⑤ 三顆 filter 欄的型別逐字對
  --    🔴 gender 釘 text:它若被寫成 enum 或 varchar(n), PostgREST 的 eq 仍會動,
  --       而**值域就由兩個地方管了**(CHECK 一個、型別一個)⇒ 改選項時只改一邊會靜默不一致。
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v'
     AND (column_name, data_type) IN
         (('birthday', 'date'), ('birth_month', 'smallint'), ('gender', 'text'));
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 三顆 filter 欄的型別不對(date/smallint/text),命中 % 條。'
      '🔴 birth_month 若是 numeric, 它進 JS 可能是字串 ⇒ 月份比對靜默失敗、畫面看起來像「沒人生日」', v_cnt;
  END IF;

  -- ⑤-c 🔴🔴 **這一欄的【資料真的來自 customers.gender 嗎】** —— codex R2 新 must-fix,
  --    而我當場在拋棄式 PG 上驗了它說得對:把 view 改成 `c.email AS gender`
  --    ⇒ 欄名對、`text` 型別對、CHECK 在、ACL 對、索引對 ⇒ **上面每一條斷言全綠 rc=0**。
  --    ⇒ 而員工選「男」會篩到**零筆**(沒有人的 email 等於 'male'),
  --      畫面上與「沒有男客人」**長得一樣**。
  --    📌 **⇒ 前面那些斷言問的都是【這一欄長什麼樣】,沒有一條問【它從哪裡來】。**
  --
  --    ✅ 用 `pg_depend`(catalog 事實)—— 🛑 **刻意不用 `pg_get_viewdef` 的字串比對**,
  --       理由同 ⑥ 那條:反編譯結果不是穩定 identity(`20260831150000:92-102` 的 R3 裁決)。
  --    🟢 這把尺在兩個世界印不同的數(2026-09-01 拋棄式 PG 17.10 實測):
  --       好世界問 `gender` ⇒ **1** · 負對照問 view 沒讀的 `wallet_balance` ⇒ **0**。
  --    ⚠️ **它證的是「這張 view 有讀 customers.gender」,不是「叫 gender 的那一欄就是它」**
  --       —— 有人同時寫 `c.email AS gender` 而別處又碰了 `c.gender`, 本條仍會過。
  --       那一格沒有守門, 靠 code review。**寫出來, 因為它不寫就會被讀成全包。**
  IF NOT EXISTS (
    SELECT 1
      FROM pg_depend d
      JOIN pg_rewrite r ON r.oid = d.objid
      JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
     WHERE r.ev_class = 'public.admin_customer_list_v'::regclass
       AND d.refobjid = 'public.customers'::regclass
       AND a.attname  = 'gender'
  ) THEN
    RAISE EXCEPTION '性別欄驗收失敗 — view 沒有真的讀 public.customers.gender。'
      '🔴 欄名叫 gender 而資料來自別欄(例如 c.email AS gender)⇒ 前面每一條斷言都會綠, '
      '而員工篩出來是【零筆】, 與「沒有這種人」長得一樣。';
  END IF;

  -- ⑤-b 🔴 `security_invoker` —— codex R1 must-fix(2026-09-01),而它是【最貴的那一條】
  --    失敗情境:有人 `CREATE OR REPLACE` 時漏掉 `WITH (security_invoker = true)`
  --    ⇒ view 改以 **owner 身分**求值 ⇒ 底表 `customers` 的 RLS **整個被繞過**
  --    ⇒ 而上面每一條斷言【照樣全綠】:欄位對、型別對、授權對、索引對。
  --    📌 **一個權限邊界被拆掉,而這道守門的每一格都印綠。**
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE oid = 'public.admin_customer_list_v'::regclass
       AND reloptions @> ARRAY['security_invoker=true']
  ) THEN
    RAISE EXCEPTION '性別欄驗收失敗 — view 沒有 security_invoker=true。'
      '🔴 它會以 owner 身分求值 ⇒ 底表 RLS 被繞過, 而其他每一條斷言都不會發現。實際 reloptions:%',
      coalesce((SELECT array_to_string(reloptions, ',') FROM pg_class
                 WHERE oid = 'public.admin_customer_list_v'::regclass), '(NULL)');
  END IF;

  -- ⑥ 🔴 底表那一側:CHECK 要在 —— 這是一道【前置閘】,不是【值域閘】
  --
  --    🛑 **codex R1(2026-09-01)在這裡開了一條 must-fix,而我【不照它的處方做】**:
  --       它逐字說「只驗名稱、類型與 validated;值域錯成只收 `male` 整段仍綠」——
  --       **那個缺口是真的**,而它的處方(比對 `pg_get_constraintdef` 的完整字串)
  --       **在本 repo 已經被 codex 自己判成 must-fix 移除過**:
  --       `20260831150000:92-102` 逐字記著 R3 的理由 ——
  --         「`pg_get_constraintdef` 把 PostgreSQL 的**反編譯結果**當成穩定 schema identity。
  --          官方只把它定義為【反編譯重建】,不是原始 DDL」
  --         ⇒ 三個值換順序 / 加 `IS NULL OR` / 換版改括號 **都會被誤擋**
  --         ⇒ 📌 那會變成一道【自己會壞,而壞的時候擋住正確的資料庫】的閘。
  --    ⇒ **兩輪 codex 的結論相反,而它們回答的不是同一個問題**:
  --       R1 問「這道閘擋得夠不夠緊」,R3 問「收緊本身會不會製造新失效」。
  --       ⇒ 這裡採 R3,因為**假紅會被修掉,而修法是把閘拆掉** —— 那比缺口更貴。
  --
  --    🔴 **⇒ 所以殘餘風險要明寫,不能當成沒有**:
  --       若有人把 CHECK 改成只收 `male`,本檔全綠,而後台選「女」會回**零筆** ——
  --       畫面上「這個條件沒有人」與「值域被改壞了」**長得一樣**。
  --       ⚠️ 而那一格**全 repo 沒有守門**(TS 那三個值 vs DB 的 CHECK 是兩份真相,
  --          中間只有型別層斷言,而型別層看不到 DB)——
  --          同一句話也寫在 `customer-list-view.test.ts` 的性別那一段。
  --
  --    🔵 **codex R2 給了一個【不是字串比對】的處方,我照做了**:行為探針,
  --       BEGIN → 三個合法值各插一發 → 非法值必須回 `23514` → ROLLBACK。
  --       實跑(2026-09-01,拋棄式 PG 17.10):
  --         male / female / undisclosed ⇒ rc=0(三發都收)
  --         🔵 「其他」⇒ rc=1 且命中 `customers_gender_chk`
  --         🔵 舊中文「男」⇒ rc=1 且命中 `customers_gender_chk`(相容期已過, 值域是代碼)
  --         🟢 零留痕:探針前後 `customers` 筆數相同(4 ⇒ 4)
  --    🛑 **而那個探針【證不到正式庫】** —— 它跑的是我自己建的那個庫、我自己下的那個 CHECK。
  --       ⇒ 📌 **「我驗過這個行為」與「那台機器上的行為是這樣」是兩個宣稱。**
  --    ✅ **正式庫那一格的證據在別處,而它是量到的**:`supabase/APPLIED.tsv` 的
  --       `20260831150000` 那一列記著 `-15` 2026-08-31 15:23 用唯讀連線實查
  --       `pg_get_constraintdef` ⇒ 逐字 `CHECK ((gender = ANY (ARRAY[male, female,
  --       undisclosed])))`(原文帶 ::text cast), 並另外量了「中文那一版不在了」⇒ f。
  --    ⚠️ **殘餘窗口**:那是 08-31 的量測, 而本檔在 09-01 之後才 apply ——
  --       中間有人動過 CHECK 的話, **沒有任何東西會說**。這是時間差, 不是量測缺陷。
  --    正向對照 = 找得到約束定義(找不到就直接紅, 不是恆綠)
  SELECT count(*) INTO v_cnt
    FROM pg_constraint
   WHERE conrelid = 'public.customers'::regclass
     AND conname  = 'customers_gender_chk'
     AND contype  = 'c'
     AND convalidated;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '性別欄驗收失敗 — public.customers 上找不到已驗證的 customers_gender_chk。'
      '🔴 前置未滿足:請先 apply 20260831140000 與 20260831150000';
  END IF;

  -- ══ 🔴🔴 ⑦ 授權 —— **2026-09-01 第三次重寫(Fable 對抗審查 5 條 must-fix)** ══
  --
  --   ⛔ ~~前兩版是【偵測器】:先看世界長怎樣,不對就紅。~~
  --   🔴 而它在正式庫上**紅了兩次,兩次都是假警報**,兩次都是 Sean 在當測試環境。
  --   📌 Fable 逐字:「現形 assert-only:紅一次=老闆往返一輪,而他已吃兩次假警報 ——
  --      **閘的可信度被預支,第三次紅(真的那次)最可能被當第三次假的。**」
  --
  --   ✅ **⇒ 修法是把它從【偵測器】變成【執法器】**:上面 `:201-202` 那兩行 `REVOKE`
  --      **無條件先跑**(冪等,世界本來就對時零動作),**然後才**斷言。
  --      ⇒ 🔴 **所以 ⑦-a 紅的話,只剩一種可能:REVOKE 沒有生效。**
  --        而那不是「這個庫長得跟平常一樣」,那是一件真的、需要人看的事。
  --      📌 **⇒ 偵測器會誤報;執法器不會 —— 它先把世界改成對的。**
  --
  --   ══ 🛑 本閘【不看】什麼(Fable 提的三條,寫下來而不擴張本閘去管它們)══
  --     ① `SECURITY DEFINER` 函式自帶的 `PUBLIC EXECUTE` —— 那是另一條路,見
  --        `docs/patterns/revoking-function-execute-in-supabase.md`
  --     ② **底表 `public.customers` 本身的授權與 RLS** —— 本閘一個字都沒看
  --     ③ Realtime publication —— 一張表被加進 publication 的暴露面不經過 view ACL
  --   📌 三條都不是「以後補」,是**明寫的天花板**。沒寫下來的限制會被讀成沒有限制。

  -- 🔵 正向對照:relacl 是 NULL 時 aclexplode 回 0 列 ⇒ 下面每一條都會恆綠。
  IF (SELECT relacl FROM pg_class WHERE oid = 'public.admin_customer_list_v'::regclass) IS NULL THEN
    RAISE EXCEPTION '性別欄驗收失敗 — relacl 是 NULL(從沒下過 GRANT),下面的授權斷言【沒有判別力】';
  END IF;

  --   ⑦-a 🔴 **FAIL:上得了網的身分讀得到** —— 用 `has_table_privilege`,**不比 ACL**。
  --        🔴 Fable must-fix:ACL 比對只看【直接授權】。若權限掛在一個中介角色上、
  --           而 `anon` 是它的成員 ⇒ **三名單零命中,而 anon 實際讀得到。**
  --        ✅ `has_table_privilege` 走的是**有效權限**(含繼承)⇒ 看得到那條路。
  --        🔵 主視窗 2026-09-01 打正式庫:anon=f · authenticated=f · service_role=t · pcm_readonly=t
  --           ⇒ **今天沒有繼承洞,兩把尺同一個答案** —— 而【今天沒有】不等於【尺看得到】。
  --        🛑 **名單寫死 `anon` / `authenticated` / PUBLIC,不動態導出**(Fable 建議從
  --           `pg_auth_members WHERE member='authenticator'` 導,而主視窗打正式庫:
  --           那個成員集合是 `postgres, supabase_storage_admin` ⇒ **anon 不在裡面**
  --           ⇒ 照它做,這道閘會導出一份【不含 anon】的名單 ⇒ **對它唯一該防的角色失明**)。
  --           📌 **一個聽起來更嚴謹的修法,會讓守門對它要防的東西瞎掉。**
  --        ⚠️ 角色不存在時 `has_table_privilege` 會擲錯 ⇒ 先用 `to_regrole` 過濾。
  SELECT count(*),
         coalesce(string_agg(x.who || '=' || x.priv, ', ' ORDER BY x.who, x.priv), '(無)')
    INTO v_cnt, v_who
    FROM (
      SELECT r.rolname AS who, p.priv
        FROM (VALUES ('anon'), ('authenticated')) AS n(nm)
        JOIN pg_roles r ON r.rolname = n.nm
        CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
       WHERE has_table_privilege(r.oid, 'public.admin_customer_list_v'::regclass, p.priv)
      UNION ALL
      -- PUBLIC 沒有 role oid ⇒ 只能走 ACL(而 REVOKE 已先跑過)
      SELECT 'PUBLIC', a.privilege_type
        FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.oid = 'public.admin_customer_list_v'::regclass AND a.grantee = 0
    ) x;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 上得了網的身分【仍然】讀得到本 view:%(共 % 條)。'
      '🔴 而本檔在斷言【之前】已經無條件 REVOKE 過 ⇒ 這一紅只剩一種可能:那道 REVOKE 沒有生效'
      '(例如權限經由中介角色繼承而來 —— REVOKE 直接授權收不掉繼承)。'
      '📌 上面那一串由命中的列自己產生, 沒有一個字是事先寫死的。', v_who, v_cnt;
  END IF;

  --   ⑦-b 🔵 **只印不擋:可轉授** —— 首版先印後擋(Fable nit)。
  --        理由:owner 那幾列若帶 grantable, 直接擋會誤紅, 而 **Supabase 的 owner 列形狀未確認**。
  --        🔵 主視窗打正式庫:該 view 全部 `is_grantable=f`(含 owner)⇒ 今天不會誤紅。
  --        ⇒ 而它仍然危險(能把這張 view 再發給任何人)⇒ **印出來, 讓下一次有人看得到它變了。**
  SELECT coalesce(string_agg(
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
           || '=' || a.privilege_type, ', ' ORDER BY 1), '(無)')
    INTO v_who
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_customer_list_v'::regclass AND a.is_grantable;
  RAISE NOTICE '🔵 可轉授的授權(只印不擋, 首版):%', v_who;

  --   ⑦-c ✅ **PASS 條件:service_role 讀得到** —— 問「有沒有【少】」,方向與上面相反。
  --        0 = 後台客戶列表整個讀不到, 而 ⑦-a 不會紅(它只問「有沒有多」)。
  IF NOT has_table_privilege('service_role', 'public.admin_customer_list_v'::regclass, 'SELECT') THEN
    RAISE EXCEPTION '性別欄驗收失敗 — service_role 讀不到本 view。'
      '🔴 後台客戶列表會整頁「載入失敗」, 而上面那條「有沒有多」一格都不會紅。';
  END IF;

  --   ⑦-d 🔴 **欄位層 —— 自己一把尺,不能靠 ⑦-a**
  --        🔴 Fable must-fix:`has_table_privilege` 對「**只有欄級授權**」的情況**回 false**
  --           ⇒ 表級那把尺對它少報。⇒ 表級與欄級**各一把**。
  SELECT count(*),
         coalesce(string_agg(at.attname || '.' ||
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
           || '=' || a.privilege_type, ', ' ORDER BY 1), '(無)')
    INTO v_cnt, v_who
    FROM pg_attribute at, aclexplode(at.attacl) a
   WHERE at.attrelid = 'public.admin_customer_list_v'::regclass
     AND at.attacl IS NOT NULL
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) IN ('anon', 'authenticated'));
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '性別欄驗收失敗 — 欄位層授權給上得了網的身分:%(共 % 條)。'
      '🔴 `REVOKE ALL ON <view>` 收不掉欄位層的授權, 所以上面那道 REVOKE 沒有幫到這裡。'
      '📌 上面那一串由命中的列自己產生。', v_who, v_cnt;
  END IF;

  --   ⑦-e 🔵 **只印不擋:兩個會變的東西** —— 讓它們在變的那天說話, 而不是今天就瞎掉。
  SELECT coalesce(string_agg(pg_get_userbyid(a.grantee) || '=' || a.privilege_type, ', ' ORDER BY 1), '(無)')
    INTO v_who
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_customer_list_v'::regclass
     AND a.grantee <> 0 AND a.grantee <> c.relowner
     AND pg_get_userbyid(a.grantee) NOT IN ('anon', 'authenticated', 'service_role');
  RAISE NOTICE '🔵 其餘非公開授權(只印不擋):%', v_who;

  SELECT coalesce(string_agg(m.rolname, ', ' ORDER BY m.rolname), '(無 / 或 authenticator 不存在)')
    INTO v_who
    FROM pg_auth_members am
    JOIN pg_roles g ON g.oid = am.roleid
    JOIN pg_roles m ON m.oid = am.member
   WHERE g.rolname = 'authenticator';
  RAISE NOTICE '🔵 authenticator 的成員(只印不擋 —— 它變的那天, 上面那份寫死的名單可能就不完整了):%', v_who;

  -- ⑧ 🔴 索引 —— 驗【定義】不驗名字(沿用 `20260826140000` §5⑦ 的 codex must-fix)
  --    為什麼:`CREATE INDEX IF NOT EXISTS` 在**同名但建錯運算式**的索引已存在時會安靜跳過。
  --    ⚠️ 比對法 = 命中有判別力的那幾段, **不逐字比整串**
  --       (`pg_get_indexdef` 的括號與空白跨 PG 版本會變 ⇒ 逐字比會在換版時整批假紅)。
  DECLARE v_idx text;
  BEGIN
    -- 🔴 codex R1 must-fix(2026-09-01)三格,而它們是**三種不同的假綠**:
    --    ① **沒限 namespace** ⇒ 別的 schema 裡一支同名索引會被撈來當證據。
    --    ② **沒驗 `indisvalid`** ⇒ 一支失敗的 `CREATE INDEX CONCURRENTLY` 會留下
    --       **定義完全正確而不可用**的索引 ⇒ 字串比對全過,而查詢照樣 Seq Scan。
    --    ③ **沒驗 `indpred IS NULL`** ⇒ partial index(`WHERE birthday > '2000-01-01'`)
    --       的 `pg_get_indexdef` **一樣含**「ON public.customers USING btree (birthday)」
    --       ⇒ 片段比對過關,而它只蓋住一部分的列。
    --    📌 **⇒ 三格都是「定義字串看起來對」而「那支索引不是我要的那一支」。**
    SELECT pg_get_indexdef(i.indexrelid) INTO v_idx
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'customers_birthday_idx'
       AND c.relnamespace = 'public'::regnamespace
       AND i.indrelid = 'public.customers'::regclass
       AND i.indisvalid
       AND i.indpred IS NULL;
    IF v_idx IS NULL
       OR v_idx !~ 'ON public\.customers USING btree'
       OR v_idx !~ '\(birthday\)' THEN
      RAISE EXCEPTION '性別欄驗收失敗 — customers_birthday_idx 不符(要 public schema 上、綁 public.customers、'
        'indisvalid、非 partial 的 btree(birthday))。🔴 本檔【不建】索引, 只驗 —— '
        '查無 ⇒ 請先 apply 20260826140000。實際:%', coalesce(v_idx, '(查無符合條件的索引)');
    END IF;

    SELECT pg_get_indexdef(i.indexrelid) INTO v_idx
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE c.relname = 'customers_birth_month_idx'
       AND c.relnamespace = 'public'::regnamespace
       AND i.indrelid = 'public.customers'::regclass
       AND i.indisvalid
       AND i.indpred IS NULL;
    IF v_idx IS NULL
       OR v_idx !~ 'ON public\.customers USING btree'
       OR v_idx !~* 'extract\(month from birthday\)'
       OR v_idx !~ '::smallint' THEN
      RAISE EXCEPTION '性別欄驗收失敗 — customers_birth_month_idx 的【定義】不符 —— '
        '🔴 最可能是少了 ::smallint。而那不會讓任何東西紅:索引照樣建得起來、查詢照樣回對的資料, '
        '只是【永遠是 Seq Scan】。實際:%', coalesce(v_idx, '(不存在)');
    END IF;
  END;

  RAISE NOTICE '✅ admin_customer_list_v:12 欄 + 三型別 + 底表 CHECK + 授權兩面 + 索引兩支,結構不變式全過';
END
$verify$;

COMMIT;

-- ══ 6. 🔴 ROLLBACK —— 而它【不是 DROP VIEW】 ═════════════════════════════════
--   沿用 `20260826140000` §4 那條:`DROP VIEW` 會**一起丟掉四則 COMMENT**,
--   而重建時若忘了寫回來,「回滾成功」與「回滾丟了東西」印同一個綠。
--   ⛔ ~~原句:「回滾 = `CREATE OR REPLACE` 回 11 欄那一版 + 重寫兩則 COMMENT」~~
--   ⛔ ~~以及「真正的回滾動作是把 20260826140000 的 view 段整段重跑」~~
--   🔴 **那兩句自相矛盾,而 codex R1(2026-09-01)當場指出來了** ——
--      我上一行才寫「`CREATE OR REPLACE VIEW` 不能減少欄位」,下一行就叫人去重跑
--      **一段 `CREATE OR REPLACE`** ⇒ 它會直接報錯(`cannot drop columns from view`)。
--      📌 **⇒ 而這種錯最貴的地方在【它會在事故當下才顯形】** —— 寫的時候讀起來完全合理,
--         而真的要回滾的那一刻,人正在急,手上那份指示是壞的。
--
--   ✅ **正確的回滾動作 —— 🔴 整組包在【一筆交易】裡,三步順序不可換**
--      (`BEGIN;` … `COMMIT;` 是 codex R2 must-fix:中途失敗時,
--       上一版會把正式 view **留在已刪除的狀態** ⇒ 後台客戶頁直接壞掉,
--       而回滾的人正在急。📌 **一個沒有交易的回滾腳本,失敗時比不回滾更糟。**)
--      ```
--      BEGIN;
--        SET LOCAL lock_timeout = '5s';
--      ① DROP VIEW public.admin_customer_list_v;
--         🔴 這一步會**一起丟掉所有 COMMENT** —— 它們住在 view 上,不是獨立物件。
--      ② 把 `20260826140000` 的 `CREATE … VIEW` 段整段重跑(11 欄那一版)。
--         ⚠️ 它寫的是 `CREATE OR REPLACE`,而 view 剛被 DROP ⇒ 這裡等同 `CREATE` ⇒ 成立。
--      ③ 重下三行 REVOKE/GRANT + 重寫 `birthday` / `birth_month` 兩則 COMMENT。
--         🔴 **DROP 掉的 view,ACL 也跟著沒了** —— 不重下的話後台整個列表壞掉,
--            **而症狀是「客戶列表載入失敗」,不會有人聯想到回滾少了一步。**
--      COMMIT;
--      ```
--   🔵 **「兩則」這個數字是【量的】,不是抄的**(2026-09-01 拋棄式 PG 17.10):
--      本檔跑完 ⇒ view 層 COMMENT **0** 則、欄位層 **3** 則(birthday / birth_month / gender);
--      而 `20260826140000` 檔內 `grep -c '^COMMENT ON COLUMN'` ⇒ **2**、`'^COMMENT ON VIEW'` ⇒ **0**
--      ⇒ 回滾要恢復的是那 **2** 則。
--      ⛔ ~~codex R2 在這裡說「DROP 會丟掉共 7 則、應恢復 6 則」~~ ⇒ **那兩個數字是錯的**,
--         我當場量了才發現。📌 **審查者的數字也要有來源** —— 而它這一條的
--         **判斷是對的(要包交易、我原本漏了)、數字是錯的**。兩件事分開收。
--   ⚠️ 而**本檔仍然不附一份可貼的回滾腳本** —— 上游那支就是 ② 的正本,
--      抄一份等於製造第二個真相。這裡寫的是**動作序**,不是腳本副本。
--
-- ══ 7. 🔴 這道守門【擋不到】什麼 ═════════════════════════════════════════════
--   ① 欄名白名單驗的是【名字】, 不是【那一欄的資料從哪來】——
--      經由 helper 函式間接讀 wallet_balance ⇒ 定義文字裡沒有那個字 ⇒ 全綠。
--      ⇒ 這道擋的是**手滑**, 不是**刻意繞過**。
--   ② ACL 斷言查的是【直接被授權的人】—— 能 `SET ROLE` 到 service_role 的人仍讀得到。
--   ③ 🔴 **本檔證不出「正式庫貼之前是哪一代」** —— 它是冪等的, 而冪等的代價是
--      **貼完之後你分不出「本來就有 birthday」與「是我這一發補上的」**。
--      ⇒ 要那個答案, 必須在**貼之前**跑一次 information_schema.columns。
