-- 20260826140000_m4b_admin_customer_list_view_birthday.sql
-- 客戶列表 view 加兩欄:`birthday` / `birth_month` —— 給後台生日篩選用
--
-- plan  = docs/specs/2026-08-26-customer-filters-merged-plan.md(片A)
-- 上游  = 20260816030000_m4b_admin_customer_list_view.sql(本檔【改】它建的那支 view)
-- 拍板  = Sean 2026-08-26:`e:丙`(兩種生日篩法都要)+ `q4=甲`(現在做)+ `A: 甲`(鐵則 8 批准)
-- 鐵則 12③(DDL)。
--
-- ══ 0. 🔴 先講這支檔【放寬了一道守門】,而放寬的只有一條 ═══════════════════════
--
-- 上游那支的 DO 區塊 ④ 釘死一串**逐字欄名白名單**:
--   'user_id,name,email,phone,tier,created_at,active_order_count,active_spend_total,last_active_ordered_at'
-- 加欄一定會撞到它 —— **那正是它該做的**。所以本檔把那串更新成九欄 + 兩欄。
--
-- 🔴🔴 **而【擋 wallet_balance / total_deposit 的第 ③ 條,一個字都不動】。**
--    上游把「欄名清單」與「禁用欄」寫成**兩條獨立斷言**是刻意的:
--    ⇒ **加欄是常態、而那兩欄永遠不准進來。** 一起鬆掉就是把兩件事混成一件。
--
-- 🔴🔴🔴 **為什麼第 ③ 條不能一起鬆 —— 寫理由,不是只寫「不動它」**
--    (沒有理由的禁令會在下一次被當成保守而拿掉。給下一個要加欄的人:)
--
--    `wallet_balance` / `total_deposit` = **這個客人手上有多少錢、總共儲值過多少**。
--    ① 這支 view 是**列表**:一次回一整頁客戶 ⇒ 那兩欄一旦在裡面,
--       **一次外洩就是一整批人的財務狀況**,不是一個人。
--    ② 而它們**不像 email / phone** —— email 外洩是聯絡方式,餘額外洩是**財務畫像**:
--       誰是大戶、誰快沒錢了。**那是可以拿來差別對待客人的資訊。**
--    ③ 🔴 **這條線上還有一個更硬的鄰居**:PCM 的**經銷價**同樣禁止進任何客戶側讀模型
--       (Server 端鐵則:「經銷價絕不傳到一般會員瀏覽器」)。
--       **餘額與經銷價是同一族的東西** —— 它們的共同點不是「敏感」,是
--       **【它在畫面上長得像一個普通數字,而它洩漏的是商業關係】**。
--    ④ 而 `customers` 表**日後每加一欄**,都有人要決定它進不進這支 view。
--       第 ③ 條是那個決定的**預設值 = 不進**。**鬆掉它 = 把預設值從「不進」改成「看寫的人記不記得」。**
--
--    ⇒ **結論:欄名清單那條是【會變的】, 第 ③ 條是【不變的】。**
--      要加欄 ⇒ 改前者、順便讓後者擋你一次確認你沒手滑。**兩條一起改 = 兩道守門同時歸零。**
--    ⇒ 本檔的證人 N4 專打這一格(見 §5-a)。
--
-- ══ 1. 為什麼要【兩欄】而不是一欄 ═════════════════════════════════════════════
--
--   Sean `e:丙` = 兩種篩法都要, 而它們要的東西不同:
--     「幾歲到幾歲」  ⇒ 日期區間  ⇒ 用 `birthday`     (app 端算出上下界, 走 gte/lte)
--     「這個月生日」  ⇒ 月份 1-12 ⇒ 用 `birth_month`  (走 eq)
--   🔴 **為什麼 `birth_month` 要是一顆【欄】而不是在查詢裡算**:
--      後台列表走 PostgREST,而 **PostgREST 的 filter 吃不了任意運算式** ——
--      `extract(month from birthday)` 沒有辦法寫成一個 filter ⇒ 只能先在 view 裡變成欄。
--
--   ⚠️ `birthday` 是 `date`(不是 timestamptz)⇒ `EXTRACT(MONTH FROM date)` 是 **IMMUTABLE**
--      ⇒ 底表那支函式索引建得起來(見 §3)。若哪天有人把它改成 timestamptz, 索引會建不起來。
--
-- ══ 2. 🔴 這【不是】把生日搬上列表畫面 ═══════════════════════════════════════
--
--   `apps/admin/src/lib/customers/customer-repository.ts:14-16` 逐字:
--     「列表走 ADMIN_CUSTOMER_LIST_SELECT 具名白名單(**不帶 wallet/birthday**);
--       明細-a 起 findById 含 …/birthday(… **PII 只在明細頁**、登入閘後)」
--   ⇒ 那是一條**既有決定**, 本檔不推翻它。
--   ⇒ ✅ 做法 = **篩得到、不顯示**:PostgREST 可以對 view 上有的欄下 filter 而**不放進 `select`**
--     ⇒ `ADMIN_CUSTOMER_LIST_SELECT` 那串**一個字都不改**
--        (它有 byte-equal 守門在 `SupabaseCustomerAdapter.test.ts:28` —— 改了會紅, 而我不改)。
--   ⚠️ **誠實邊界**:本檔讓 `birthday` 出現在**這支 view 的可查表面**上。
--      而這支 view 只 GRANT 給 `service_role`(上游 §5), 而 `service_role` 本來就 BYPASSRLS、
--      對 `customers` 有完整讀取 ⇒ **DB 層沒有新增任何暴露面**。
--      🔴 新增的暴露面在**應用層**:誰寫錯一次 select 就會把生日印上列表。
--         ⇒ 那道防線是上面那個 byte-equal 守門, **不是本檔**。
--
-- ══ 3. 索引 —— 兩支,不是一支 ═════════════════════════════════════════════════
--
--   兩種篩法的查法不同 ⇒ 索引也不同, 兩支都建在**底表** `customers` 上(view 不能建索引):
--     customers_birthday_idx        普通 btree    給 birthday BETWEEN a AND b
--     customers_birth_month_idx     函式索引       給 extract(month from birthday) = N
--   ⚠️ **本檔沒有量過它們有沒有效**。上游 §8 的實測教訓逐字:
--      「一個真的有效的索引不會在兩次量測之間換邊」——
--      🔴 **所以這兩支索引是【照查法建的】, 不是【量出來需要的】。**
--         PCM 目前客戶數是兩位數 ⇒ 這個量級下**兩支索引都不會被用到**(planner 會選 seq scan)。
--      ⇒ 建它們的理由是「查法對得上」與「日後不用回頭補」, **不是效能量測**。
--      ⇒ 若審查認為「沒量過就不要建」, **拿掉它們不影響功能**(見 §6 rollback)。
--
-- ══ 4. 🔴 Rollback —— 而它【不是 DROP VIEW】 ═════════════════════════════════
--
--   上游那支的 rollback 是 `DROP VIEW`, 因為它建的是一支**全新的 view**。
--   🔴 **本檔改的是一支【已經在跑】的 view ⇒ DROP 不是回滾, 是把後台列表砍掉。**
--
--   🔴 **完整回滾腳本在本檔最後(§7)** —— 它是**可以整段複製貼上直接跑**的 SQL,
--      不是「把 GRANT 加回去」這種指示句。
--      理由:**要用到 rollback 的那一刻,通常是半夜而且有人在急。**
--
--   🔴🔴 **為什麼 GRANT 那三行不能省**(這是本檔最容易被下一個人省掉的一格):
--      `CREATE OR REPLACE VIEW` **保留**既有 ACL ⇒ 單純 replace 的話授權還在。
--      **而如果有人改用 `DROP VIEW` + 重建**(欄要減少時 Postgres 逼你這樣做),
--      **授權會跟著 view 一起消失** ⇒ 後台列表整個讀不到,
--      而 🔴 **報出來的錯是「權限不足」不是「欄位不見」⇒ 修的人會往錯的方向找。**
--   ⚠️ **上面這段回滾我【沒有實際跑過】** —— 它是照 Postgres 語義寫的。

-- ── 3-a 索引(建在底表)──────────────────────────────────────────────────────
-- 🔴🔴 **刻意【不用】 `IF NOT EXISTS`** —— 而這一格是**兩個獨立的東西同時指到的**:
--    ① 對抗審查 must-fix:同名但建錯運算式/錯表的索引已存在時, `IF NOT EXISTS` **安靜跳過**
--       ⇒ 而斷言只查名字的話全綠 ⇒ **拿到綠燈, 而這支 migration 什麼都沒建。**
--    ② `scripts/migration-new-file-static-checks.sh` 這道 pre-commit 閘**擋下了我的第一版**,
--       理由逐字:「撞名要當場紅,不要靜靜跳過。跳過之後,你的 REVOKE 與斷言會對著
--       那個既有物件跑而且很可能通過」。
--    📌 **一個是人指出來的、一個是機器擋下來的, 而它們指的是同一格。**
--       ⇒ 這種重合不是多餘 —— **它是這一格真的重要的證據。**
-- ⚠️ **代價明寫**:本檔因此**不可重跑**。第二次 apply 會在這裡紅(索引已存在)。
--    那是**要的行為**, 不是缺陷 —— migration 本來就只該 apply 一次。
CREATE INDEX customers_birthday_idx
  ON public.customers (birthday);

-- 🔴🔴 **運算式必須與 view 那一欄【逐字相同】, `::smallint` 不能少**(codex 2026-08-26 must-fix,
--    而下面那組是**量到的、不是推的**;拋棄式 PG 17.10, 50,000 列, ANALYZE 過):
--      索引 = extract(month from birthday)              ⇒ 🔴 **Seq Scan**(索引沒被用到)
--      索引 = (extract(month from birthday))::smallint  ⇒ ✅ **Bitmap Index Scan on ...**
--      負對照 查一個沒建索引的欄                         ⇒ Seq Scan(證 EXPLAIN 有判別力)
--    ⇒ view 那一欄是 `::smallint` ⇒ 查詢下推後 filter 帶著 cast ⇒ **不帶 cast 的索引永遠對不上。**
--    ⇒ 📌 **這種錯不會有任何東西紅** —— 索引建起來了、查詢也回對的資料, 只是慢。
CREATE INDEX customers_birth_month_idx
  ON public.customers (((extract(month from birthday))::smallint));

COMMENT ON INDEX public.customers_birthday_idx IS
  '給後台「幾歲到幾歲」篩選(birthday BETWEEN 兩個算出來的日子)。'
  '🔴 建它的理由是查法對得上, 不是效能量測 —— PCM 目前客戶數兩位數, planner 會選 seq scan。';
COMMENT ON INDEX public.customers_birth_month_idx IS
  '給後台「這個月生日」篩選(admin_customer_list_v.birth_month = N)。'
  '🔴 依賴 birthday 是 date ⇒ extract 為 IMMUTABLE。若改成 timestamptz, 本索引建不起來。'
  '🔴 運算式必須與 view 那一欄逐字相同(含 ::smallint)—— 少了 cast ⇒ 量到是 Seq Scan, 而不會有東西紅。';

-- ── 1-a view 重建(逐顆列出欄位 = 白名單本身;沿用上游契約)───────────────────
-- 🔴 新欄一律**往後加**:CREATE OR REPLACE VIEW 不允許改既有欄的順序或型別。
-- 🔴 契約② 照舊:不 GROUP BY / 不 DISTINCT / 不 join orders,三個聚合欄仍是純量子查詢。
-- 🔴 契約(上游 §2 偏離)照舊:**不得用 `c.*`** —— 那會把 wallet_balance / total_deposit 帶進來。
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
  -- 🔴 兩顆新欄。**只給 filter 用, 不給 select 用**(見 §2)。
  c.birthday                                            AS birthday,
  -- 🔴 沒填生日 ⇒ birth_month 是 NULL, **刻意不 coalesce 成 0 或 13**。
  --    照上游 §4 的同一條理由:沒有一個合理的「零月份」, 造一個就是製造假事實。
  --    ⇒ 而「沒填生日的人」要在畫面上被數出來(Sean q4-甲「另有 N 人沒填生日」),
  --      那個 N 靠的就是這一欄 IS NULL。**把 NULL 填掉會讓那個 N 永遠是 0。**
  extract(month from c.birthday)::smallint              AS birth_month
FROM public.customers c;

-- ── 權限:CREATE OR REPLACE 保留既有 ACL, 但【明寫一次】不靠它 ────────────────
-- 🔴 靠「它會保留」= 靠一個不在本檔裡的行為。原樣抄上游 §5 三行, 冪等。
REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_customer_list_v TO service_role;

COMMENT ON COLUMN public.admin_customer_list_v.birthday IS
  '客戶生日(date)。🔴 **給 filter 用, 不給 select 用** —— 列表白名單 ADMIN_CUSTOMER_LIST_SELECT '
  '刻意不含它(PII 只在明細頁, customer-repository.ts:14-16)。加進 select 會違反那條既有決定。';
COMMENT ON COLUMN public.admin_customer_list_v.birth_month IS
  '生日的月份 1-12(smallint)。給「這個月生日」篩選 —— PostgREST 的 filter 吃不了運算式, '
  '所以必須先在 view 裡變成欄。🔴 沒填生日 = NULL(刻意不 coalesce):'
  '「另有 N 人沒填生日」那個 N 就是靠這一欄 IS NULL 數出來的, 填掉會讓它永遠是 0。';

-- ══ 5. apply 時的自我斷言 ═════════════════════════════════════════════════════
--
-- 🔴 照上游那條教訓:**只放結構不變式, 不放需要造資料的值斷言**(值斷言會污染正式庫)。
-- 🔴🔴 而上游記著它第一版 harness 是【假綠】的, 逐字:
--    「拿『跑整支 migration』當突變載體 —— 而 REVOKE 在 DO 區塊【之前】
--      ⇒ 自己把突變清掉了再斷言 ⇒ **突變要打在被測的那一段上,
--      不是打在「包含被測那段的整個流程」上。**」
--    ⇒ 本檔的證人(§5-a)照這條做:突變只打 DO 區塊, 不跑整支檔。
DO $verify$
DECLARE
  v_def  text;
  v_cols text;
  v_cnt  integer;
BEGIN
  SELECT pg_get_viewdef('public.admin_customer_list_v'::regclass, true) INTO v_def;

  -- ① 正向對照:先證抓得到定義(抓不到的話下面每一條都恆真)
  IF v_def IS NULL OR length(v_def) < 50 THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 抓不到 view 定義(長度 %),下面的斷言全部沒有判別力',
      coalesce(length(v_def), -1);
  END IF;

  -- ② 🔴 上游第 ③ 條:**判別條件逐字相同(byte-equal), 而 RAISE 訊息換過**
  --    (R1 nit 6 更正:上一版寫「一個字不改」—— 訊息那半改了。判別力那半才是 byte-equal 的。)
  IF v_def ~* '\mwallet_balance\M' OR v_def ~* '\mtotal_deposit\M' THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 定義裡出現 wallet_balance/total_deposit。'
      '🔴 本檔放寬的是【欄名清單】那一條, 不是這一條 —— 兩件事不得一起鬆';
  END IF;

  -- ③ 上游契約②:仍不得 GROUP BY / DISTINCT / JOIN(含吃得下別名的舊式 join)
  IF v_def ~* '\mgroup\s+by\M' OR v_def ~* '\mdistinct\M' OR v_def ~* '\mjoin\M' THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 定義裡出現 GROUP BY / DISTINCT / JOIN,違反上游寫法契約②';
  END IF;
  IF v_def ~* 'from\s+[a-z_."]+(\s+(as\s+)?[a-z_"]+)?\s*,' THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 最外層 FROM 出現逗號(舊式 join),違反上游寫法契約②';
  END IF;

  -- ④ 🔴 欄名白名單 —— 本檔更新的就是這一條。九欄 + 兩顆新欄, **順序也釘**
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
  IF v_cols IS DISTINCT FROM 'user_id,name,email,phone,tier,created_at,'
                             || 'active_order_count,active_spend_total,last_active_ordered_at,'
                             || 'birthday,birth_month' THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 欄名或順序不符白名單。實際:%', coalesce(v_cols, '(NULL)');
  END IF;

  -- ⑤ 兩顆新欄的型別逐字對
  --    🔴 birth_month 釘 smallint 是有理由的:不釘的話 extract 回 numeric,
  --       而 numeric 進 PostgREST/JS 可能是 string 不是 number ⇒ 前端比對會靜默失敗
  --       (那種錯不會拋例外, 只會篩不到人 —— 而畫面上看起來就是「這個月沒人生日」)。
  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v'
     AND (column_name, data_type) IN (('birthday', 'date'), ('birth_month', 'smallint'));
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 兩顆新欄的型別不對(date/smallint),命中 % 條。'
      '🔴 birth_month 若是 numeric, 它進 JS 可能是字串 ⇒ 月份比對靜默失敗、畫面看起來像「沒人生日」', v_cnt;
  END IF;

  -- ⑥ 🔴 授權 —— 原樣搬上游第 ⑤ 條(表層 + 欄位層兩個面, 兩個都要)
  --    正向對照:relacl 是 NULL 時 aclexplode 回 0 列 ⇒ 下面那條會恆綠
  IF (SELECT relacl FROM pg_class WHERE oid = 'public.admin_customer_list_v'::regclass) IS NULL THEN
    RAISE EXCEPTION '生日欄驗收失敗 — relacl 是 NULL(從沒下過 GRANT),下面的授權斷言【沒有判別力】';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_customer_list_v'::regclass
     AND a.grantee <> c.relowner
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 表層授權除了 owner 與 service_role 之外還有 % 條(grantee=0 即 PUBLIC)。'
      '🔴 本 view 現在還多帶了【全體客戶生日】, 外流的代價比上游那版更高', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_attribute at, aclexplode(at.attacl) a
   WHERE at.attrelid = 'public.admin_customer_list_v'::regclass
     AND at.attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '生日欄驗收失敗 — 出現 % 條【欄位層】授權,而 REVOKE ALL ON <view> 收不掉它', v_cnt;
  END IF;

  -- ⑦ 🔴 索引 —— 驗的是【定義】不是【名字】(codex 2026-08-26 must-fix)
  --    為什麼:上面兩支用 `CREATE INDEX IF NOT EXISTS` ⇒ **同名但建錯運算式/錯表的索引已存在時,
  --    它會安靜地跳過** ⇒ 只查名字的話, 一支對不上查詢的索引照樣讓斷言全綠。
  --    ⇒ 而那正是本檔剛剛才犯過的錯(少一個 ::smallint ⇒ Seq Scan)。只查名字擋不到自己那個錯。
  --    🔴 分開報 —— 合起來報的話, 少一支看不出是哪一支。
  --    ⚠️ 比對法 = **命中「有判別力的那幾段」, 不是逐字比整串**。
  --       理由:`pg_get_indexdef` 的括號與空白**跨 PG 版本會變**(本機 17.10 / Supabase 未必同版)
  --       ⇒ 逐字比會在**換版時整批紅**, 而那種紅與「真的建錯了」長得一樣。
  --       ⇒ 所以釘的是三件事:**在哪張表 · 是不是 btree · 運算式裡有沒有那個 cast**。
  DECLARE v_def text;
  BEGIN
    SELECT pg_get_indexdef(oid) INTO v_def
      FROM pg_class WHERE relname = 'customers_birthday_idx' AND relkind = 'i';
    IF v_def IS NULL
       OR v_def !~ 'ON public\.customers USING btree'
       OR v_def !~ '\(birthday\)' THEN
      RAISE EXCEPTION '生日欄驗收失敗 — customers_birthday_idx 的【定義】不符(要 public.customers 上的 btree(birthday))。實際:%',
        coalesce(v_def, '(不存在)');
    END IF;

    SELECT pg_get_indexdef(oid) INTO v_def
      FROM pg_class WHERE relname = 'customers_birth_month_idx' AND relkind = 'i';
    IF v_def IS NULL
       OR v_def !~ 'ON public\.customers USING btree'
       OR v_def !~* 'extract\(month from birthday\)'
       OR v_def !~ '::smallint' THEN
      RAISE EXCEPTION '生日欄驗收失敗 — customers_birth_month_idx 的【定義】不符 —— '
        '🔴 最可能是少了 ::smallint。而那不會讓任何東西紅:索引照樣建得起來、查詢照樣回對的資料, '
        '只是【永遠是 Seq Scan】(量到的:無 cast ⇒ Seq Scan, 有 cast ⇒ Bitmap Index Scan)。實際:%',
        coalesce(v_def, '(不存在)');
    END IF;
  END;

  RAISE NOTICE '✅ admin_customer_list_v 生日兩欄:結構不變式全過(值的正確性由 probe 驗, 不在本檔)';
END
$verify$;

-- ══ 5-a 證人 —— **實跑過了。輸出在下面,不是宣稱** ══════════════════════════
--
--   跑法 `bash docs/probes/admin-customer-list-view-birthday-probe.sh`(可重跑, 零花費)
--   實跑 2026-08-26 CST · 拋棄式 PG 17.10(Homebrew, aarch64-darwin23.6.0)
--   🔴 照上游的教訓:**突變只打 DO 區塊, 不跑整支 migration**
--      (整支跑的話, 那三行 REVOKE/GRANT 會在斷言之前把授權突變清掉 ⇒ 假綠)
--
--     N0  乾淨                                    → OK 綠
--     N1  view 少加 birth_month                   → OK 紅(④ 欄名或順序不符白名單)
--     N2  兩顆新欄順序對調                         → OK 紅(④ —— 證它釘的是順序不只是集合)
--     N3  birth_month 留 numeric 不轉 smallint     → OK 紅(⑤ 兩顆新欄的型別不對)
--     N4  🔴 加回 c.wallet_balance                 → OK 紅(② 定義裡出現 wallet_balance)
--     N5  表層 GRANT anon                          → OK 紅(⑥ 表層授權除了 owner…)
--     N6  欄位層 GRANT (birthday) authenticated    → OK 紅(⑥ 出現 1 條【欄位層】)
--     N7a DROP customers_birth_month_idx           → OK 紅(⑦ 指名 birth_month_idx)
--     N7b DROP customers_birthday_idx              → OK 紅(⑦ 指名 birthday_idx)
--     N8a LEFT JOIN + GROUP BY                     → OK 紅(③)
--     N8b 🔴 **只加 JOIN、不加 GROUP BY**           → OK 紅(③ —— 這一格才證得了 JOIN 那道)
--     N10 🔴 **索引名字對而運算式少 ::smallint**    → OK 紅(⑦ 定義不符)
--     N9  全部還原(收尾正對照)                   → OK 綠
--     值   1/31→1 · 12/31→12 · 2/29→2 · NULL→NULL  → OK 四格全中
--     負對照 改 1/31→7/31, 那一格必須從 1 變 7      → OK 變了
--     ⇒ **PASS=15 FAIL=0**
--
--   📌 **每一格的錯誤訊息【都不一樣】, 而且現在是【機器在核】不是我用眼睛看** ——
--      `check` 的第三個參數 = 這一格預期的錯誤字串, 對不上就判 FAIL。
--      十格全紅但都紅在同一句話上, 等於只有一格。
--
-- ══ 5-a-2 🔴 對抗審查(2026-08-26,唯讀)—— 9 must-fix + 1 nit,**全中** ═════
--
--   鐵則 12③ 觸發, 由本窗自己跑(`-s read-only`, 零 repo 改動)。**逐條處置**:
--
--   [修了] rollback 用 CREATE OR REPLACE 從 11 欄退回 9 欄 ⇒ **Postgres 直接拒絕**
--      改成 DROP + CREATE。⚠️ 而我第一次寫這條自陳時**引了一句本檔不存在的話**
--         (R1 must-fix 4;真句在 `:116`, 講的是「不允許改既有欄的順序或型別」= 另一件事)。
--   [修了] DROP VIEW 會一起丟掉 **view 與三個聚合欄的 COMMENT**, 而回滾斷言仍報成功
--      ⇒ COMMENT 四則寫回 §7, 回滾斷言加一格數 COMMENT。
--   [修了] **函式索引少了 `::smallint`, 與 view 那一欄對不上** ⇒ 永遠 Seq Scan
--      📏 **量到的**(50,000 列, ANALYZE 過):無 cast ⇒ `Seq Scan`;有 cast ⇒ `Bitmap Index Scan`;
--         負對照(查沒建索引的欄)⇒ Seq Scan ⇒ **EXPLAIN 這把尺是活的**。
--      🔴 這種錯**不會有任何東西紅** —— 索引建了、資料也對, 只是慢。
--   [修了] `CREATE INDEX IF NOT EXISTS` 遇到同名但建錯的索引會**安靜跳過**,
--      而斷言只查名字 ⇒ 全綠。⇒ **兩層都修**:①⑦ 改成驗**定義**、probe 加 N10 專打這格
--      ②🔴 **`IF NOT EXISTS` 整個拿掉**(見 §3-a)—— 而拿掉它的直接原因是
--        `migration-new-file-static-checks.sh` 這道 pre-commit 閘**當場把我的第一版擋下來**。
--        📌 **人指出來的與機器擋下來的是同一格。**
--      📌 而它**在本檔自己身上現場發生過**:加了 N10 之後收尾正對照 N9 紅了 ——
--        紅的理由不是 N9 有問題, 是 reset 沒把那支髒索引清掉。**reset 也修了。**
--   [修了] probe 的紅格**只判 rc 非零、沒核對預期錯誤** ⇒ 語法錯/物件不見/別的斷言先炸
--      都會被算成擊中。⇒ `check` 加第三個參數, 紅了還要**紅在對的那一條**。
--   [修了] N8 同時下 LEFT JOIN 與 GROUP BY ⇒ **就算 JOIN 那道瞎了, GROUP BY 也會擋**
--      ⇒ 那一格證不了 JOIN。拆成 N8a / N8b。
--   [修了·nit] 負對照是「餵一個假字串比對」⇒ **天然不可能相等, 什麼都沒證明**
--      ⇒ 改成動產品那一側:把生日 1/31 改成 7/31, `birth_month` 必須跟著從 1 變 7。
--   [降級成明寫的天花板] 欄名白名單不驗欄位來源(helper 函式可繞)⇒ 見 §8-①
--   [降級成明寫的天花板] ACL 只查直接 grantee, `SET ROLE` 繞得過 ⇒ 見 §8-②
--      ⇒ 這兩條**不是這支 migration 擋得住的**, 而**不寫下來就會被讀成「沒有限制」**。
--
--   OK **第 2 題與第 3 題判沒問題**:`wallet_balance` 那條與上游逐字同義(只改註解);
--      `date` 來源 ⇒ NULL 傳播、2/29 合法、無時區換日、月份固定 1-12、IMMUTABLE 成立。
--
--   📎 審查指令形狀(引用用, 不要直接貼跑):`codex exec -s read-only "<題目>" < /dev/null`
--      🔴 stdin 一定要導掉 —— 不導它會睡死, 而外觀與「深度思考」相同。
--
-- ══ 5-a-3 🔴 code-reviewer R1(2026-08-26)—— **R1 FAIL,5 must-fix,全中** ═══
--
--   Sean 2026-08-26 本人授權叫 code-reviewer(逐字「甲、甲」)。fresh context、唯讀。
--   🔴 **它抓到的東西, 前一輪外部審查【一條都沒抓到】** —— 兩輪打的不是同一個面。
--
--   [修了] 🔴🔴 **§7 的 rollback 照它自己的用法貼下去是【無聲的 no-op】**
--      上一版用法句寫「整段複製貼上直接跑,不要改任何一個字」——
--      而每一行都帶 `-- ` ⇒ 原樣貼下去 **rc=0、輸出全空、view 一欄都沒退**。
--      🔴 **「跑成功了」與「什麼都沒做」印同一個東西。**
--      而剝掉前綴貼 ⇒ 散文行變成 syntax error。**兩條路都不通。**
--      ⇒ 修法:散文行改雙層 `-- --`、用法句改成「剝掉前綴再貼」,
--        並且 **probe 新增一格【從本檔切出 rollback 實跑】** —— 現在它是量到的:
--        跑完 9 欄 / 0 索引 / 3 則欄位 COMMENT。
--      📌 而那個修法**改了三次才對** —— 前兩次的判別式都只看行首第一個字,
--        漏掉「`-- ` 之後還有空白再接中文」的那種。**三次都是 probe 抓到的, 不是我看到的。**
--   [修了] §6 把**本顆已經做完的事**寫成待辦, 並指向上游那支 probe ——
--      而上游那支套的是上游 migration ⇒ **它的世界裡根本沒有 birth_month, 永遠會綠**。
--      🔴 下一個人會去補一個已經存在的格, 或誤以為本片沒驗值。⇒ 改指本顆 probe。
--   [修了] commit scope feat(schema) ⇒ feat(schemas)(規則清單無 schema;
--      全史 (schemas) 59 vs (schema) 26, 而 migrations 那條線近 12 顆全是 schemas)。
--   [修了] 🔴 **我引了一句本檔不存在的逐字**:「§4 逐字:不允許刪既有欄」——
--      §4 沒有那句, 真句在 `:116` 且講的是「不允許改既有欄的**順序或型別**」= 另一件事。
--      **兩件在 Postgres 都成立, 而我引的是不存在的那句。** ⇒ 想去核對的人會撲空。
--   [修了] `::smallint` 的唯一證據(50,000 列 EXPLAIN)**沒有人能重跑** ——
--      上游 20260816030000:258-260 記著一模一樣的病。⇒ 那一發塞進 probe, 現在可重跑。
--   [修了·nit]「第③條原樣搬過來一個字不改」⇒ 正確說法是「**判別條件 byte-equal, 而 RAISE 訊息換了**」。
--   [修了·nit] 行號漂移:customer-repository.ts:15-17 ⇒ 實際 :14-16;
--      SupabaseCustomerAdapter.test.ts:25 ⇒ 實際 :28。
--      🔴 **前者會被寫進 DB 的 COMMENT** ⇒ 錯的行號會跟著 schema 走。
--   [修了·nit] N5/N6/N7 的突變沒走 mutate() ⇒ 突變本身失敗時會被報成「守門沒判別力」
--      —— **正是 §5-b 病一的形狀, 而我只修了一半就收手。**
--   [修了·nit] probe 切法把 DO 區塊之後整段排除 ⇒ 加一格機械自檢(尾段非註解行數必須 = 0)。
--   📝 未做·nit:base 從零建 view, 沒走「既有 9 欄 → 11 欄」的真實升級路徑
--      (審查者另跑一發確認今天 rc=0)。⇒ **列為已知天花板。**
--
--   📏 三綠(.sql / .sh 不算純文件片, 照鐵則 11 跑):
--      TURBO_FORCE=1 pnpm typecheck ⇒ rc=0, **0 cached / 8 total**
--      TURBO_FORCE=1 pnpm lint      ⇒ rc=0, **0 cached / 10 total**
--      ⚠️ **誠實**:本顆零 TS 改動 ⇒ 這兩發對本顆**沒有判別力**, 跑它是照規矩不是照效力。
--      真正有判別力的是上面那支 probe(17 格)與四道 pre-commit 閘。
--
-- ══ 5-b 🔴🔴 而這支證人的【第一版是假的】, 而它看起來完全正常 ══════════════
--
--   第一版跑出 PASS=10 FAIL=2, 而那兩格「應紅→綠」讀起來像**守門瞎了**。
--   真相是兩個【互相獨立】的病, 而它們都不在 migration 裡, 在證人裡:
--
--   🔴 病一:**突變根本沒套上去**(N1 / N3)
--      我用 `CREATE OR REPLACE VIEW` 下突變, 而它 **不能刪欄、不能改欄型別**
--      ⇒ Postgres 拒絕 ⇒ 而我把 stderr 丟進 /dev/null ⇒ **外面看到「突變跑了、斷言綠」**
--      ⇒ 讀起來是【守門沒判別力】, 實際是【突變不存在】。**兩者長得一樣。**
--      ⇒ 修法不是換寫法就好, 是加一道 `mutate()`:**突變自己要先成功, 這一格才算數。**
--
--   🔴 病二:**reset 安靜地失敗 ⇒ 之後每一格都在髒世界裡跑**(N5 / N6 / N7)
--      N4 加了一顆 wallet_balance 欄, 而 reset 也是 `CREATE OR REPLACE` ⇒ 刪不掉那顆欄
--      ⇒ 後面 N5/N6/N7 **全部紅在 N4 的錯誤上** ⇒ 畫面上是四個 ✅
--      ⇒ 🔴 **四格全綠, 而它們量的是同一件事。**(`guard-and-instrument-traps.md`「一發紅多格」)
--      ⇒ 修法:reset 先 `DROP VIEW` 再重建。
--
--   📌 **判別句(這才是本段要留下的東西)**:
--      「這一格紅了」不夠。要問 **「它紅的理由, 是不是我這一格打的那個東西?」**
--      ⇒ 操作化 = **看每一格的錯誤訊息一不一樣**。全都一樣 ⇒ 前面某一格污染了世界。
--
-- ══ 6. 值的正確性(誠實邊界)═══════════════════════════════════════════════════
--
-- 🔴 本檔**沒有**驗 birth_month 算出來的月份對不對, 也沒有驗「沒填生日 ⇒ NULL」。
--    ✅ **已經有人在驗了, 而不是上游那支**(R1 must-fix 2 修正):
--       `docs/probes/admin-customer-list-view-birthday-probe.sh` 的「值」那一段。
--    ⚠️ **上一版這裡指的是上游 `admin-customer-list-view-probe.sh` 並寫「probe 要補格」——
--       那句話是錯的**:上游那支套的是上游 migration, **它的世界裡根本沒有 `birth_month`**
--       ⇒ 它永遠會綠, 而綠的理由是「它沒有在看這兩欄」。
--       🔴 **而更糟的是它會讓下一個人去補一個【已經存在的格】, 或誤以為本片沒驗值。**
--    ✅ 已驗的格(2026-08-26 實跑, 四格全中):
--      · 生日 1/31 ⇒ birth_month = 1 · 生日 12/31 ⇒ 12(兩端)
--      · 🔴 生日 2/29(閏日)⇒ birth_month = 2, 而它沒有讓任何斷言炸掉
--      · 🔴 birthday IS NULL ⇒ birth_month IS NULL(**負向格:不是 0 也不是 13**)
--      · 🔴 負對照:把 1/31 改成 7/31 ⇒ 那一格從 1 變 7(證這條查詢不是恆真)

-- ══ 7. 🔴 ROLLBACK ═══════════════════════════════════════════════════════════
--
--   🔴🔴 **用法(R1 must-fix 1 修正 —— 上一版的用法句是錯的)**:
--      下面每一行都帶 `-- ` 前綴。要跑的話 **先把每行開頭那一層 `-- ` 剝掉再貼**,例如:
--        sed -n '/^-- BEGIN;/,/^-- COMMIT;/p' <本檔> | sed 's/^-- //' | psql ...
--   ⚠️ **上一版寫「整段複製貼上直接跑,不要改任何一個字」—— 那句話是錯的, 而且錯得很安靜**:
--      原樣貼下去 ⇒ **每一行都是註解 ⇒ `rc=0`、輸出全空、而 view 一欄都沒退。**
--      🔴 **「跑成功了」與「什麼都沒做」印同一個東西。**(R1 實測:貼完仍 11 欄 / 2 索引)
--   📌 所以本節的散文行一律用 **雙層 `-- --`** —— 剝掉一層之後它們仍然是註解, 不會變成語法錯。
--
--   🔴🔴 **第一版寫錯了**(對抗審查 must-fix):回滾用 `CREATE OR REPLACE` 從 11 欄退回 9 欄
--      ⇒ **Postgres 直接拒絕刪欄** ⇒ 第一個動作就會失敗。
--      ⚠️ **而我第一次寫這段自陳時引錯了自己的話**(R1 must-fix 4):我寫「§4 逐字說不允許刪既有欄」,
--         🔴 **§4 沒有那句。** 本檔真正寫著的是 `:116` 逐字
--         「**新欄一律往後加:CREATE OR REPLACE VIEW 不允許改既有欄的順序或型別**」——
--         那是**另一件事**(改型別/順序 vs 刪欄), 兩件在 Postgres 都成立而**我引的是不存在的那句**。
--      📌 **想去核對的人打開 §4 會撲空** —— 而撲空的人不會知道結論本身是對的。
--
--   ⇒ 正解 = **DROP VIEW + CREATE VIEW**。而 DROP 會一起丟掉:
--        ① 授權(GRANT)  ② view 的 COMMENT  ③ 三個聚合欄的 COMMENT
--      🔴 **三樣都要寫回去** —— ②③ 是 codex 抓到的第二條:
--        只補授權的話, 回滾「成功」了而**上游那些解釋口徑的 COMMENT 全部消失**,
--        而回滾自己的斷言【還是會報成功】⇒ 下一個查 schema 的人看不到口徑, 只看到欄。
--
--   用法:把 `BEGIN;` 到 `COMMIT;` 之間整段貼進 SQL Editor 執行。冪等。
--   ⚠️ **這段【沒有被實跑過】** —— 照 Postgres 語義寫的。真要用之前先在拋棄式庫跑一遍
--      (`docs/runbooks/throwaway-postgres-for-migration-verification.md`)。
--
-- BEGIN;
--
-- -- ① 🔴 DROP 再建 —— 不能用 CREATE OR REPLACE(它不准刪欄)
-- DROP VIEW IF EXISTS public.admin_customer_list_v;
-- CREATE VIEW public.admin_customer_list_v
--   WITH (security_invoker = true) AS
-- SELECT
--   c.user_id,
--   c.name,
--   c.email,
--   c.phone,
--   c.tier,
--   c.created_at,
--   (SELECT count(*)
--      FROM public.orders o
--     WHERE o.customer_user_id = c.user_id
--       AND o.cancelled_at IS NULL)                       AS active_order_count,
--   (SELECT coalesce(sum(o.total), 0)
--      FROM public.orders o
--     WHERE o.customer_user_id = c.user_id
--       AND o.cancelled_at IS NULL)                       AS active_spend_total,
--   (SELECT max(o.created_at)
--      FROM public.orders o
--     WHERE o.customer_user_id = c.user_id
--       AND o.cancelled_at IS NULL)                       AS last_active_ordered_at
-- FROM public.customers c;
--
-- -- ② 授權三行(DROP 之後授權沒了, 這三行【無條件跑】)
-- REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
-- REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
-- GRANT SELECT ON public.admin_customer_list_v TO service_role;
--
-- -- ③ 🔴 COMMENT 四則 —— DROP 一起丟掉了。逐字取自上游 20260816030000 §5。
-- --    漏掉它們的話回滾仍會「成功」, 而口徑解釋消失, 且沒有任何東西會提醒你。
-- COMMENT ON VIEW public.admin_customer_list_v IS
--   '後台客戶列表(訂單數/消費金額/最後下單)。'
--   '🔴 口徑:三欄一律【排除已取消】(cancelled_at IS NOT NULL 者不計)、不扣退款。'
--   '三條都是主視窗 2026-08-16 裁(Q-最後下單口徑=A)、Sean 未逐條答 —— 【要改直接改】。'
--   '裁的理由=兩欄並排必須共用一條規則,否則員工要學兩套。'
--   '想要「他最近有沒有來」那個訊號 ⇒ 那是另一個欄位「最後互動」,不是改這欄。'
--   '🔴 寫法契約:customers 欄位逐顆列出(刻意不用 c.* —— 要擋 wallet_balance/total_deposit)、'
--   '三個聚合欄一律純量子查詢,不得 GROUP BY/DISTINCT/join orders。customers 加欄要同批重建本 view。'
--   '🔴 只給 service_role:本 view 帶全體客戶 email/phone,不得 GRANT 給 anon/authenticated。';
-- COMMENT ON COLUMN public.admin_customer_list_v.active_order_count IS
--   '未取消訂單數(bigint,零訂單=0)。欄名帶 active_ 是刻意的:它不是「總下單次數」。';
-- COMMENT ON COLUMN public.admin_customer_list_v.active_spend_total IS
--   '未取消訂單的 total 加總(bigint 元位、禁浮點;零訂單=0)。不扣退款。';
-- COMMENT ON COLUMN public.admin_customer_list_v.last_active_ordered_at IS
--   '最後一筆未取消訂單的 created_at。🔴 零訂單=NULL(刻意不 coalesce:沒有合理的零日期)。'
--   '接線片必須顯示成「從未下單」或「—」,不得留白 —— 留白與載入失敗長得一樣。';
--
-- -- ④ 兩支索引(底表上的, 與 view 無關 ⇒ 分開處理)
-- DROP INDEX IF EXISTS public.customers_birth_month_idx;
-- DROP INDEX IF EXISTS public.customers_birthday_idx;
--
-- -- 🔴 ⑤ 回滾後的自我斷言 —— 四格, 而【COMMENT 那格是 codex 逼出來的】
-- --    沒有它的話:「回滾跑過了」與「回滾真的回去了」是同一句話。
-- DO $rb$
-- DECLARE v_cols text; v_cnt integer;
-- BEGIN
--   SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
--   IF v_cols IS DISTINCT FROM 'user_id,name,email,phone,tier,created_at,'
--                              || 'active_order_count,active_spend_total,last_active_ordered_at' THEN
--     RAISE EXCEPTION '回滾未完成 — 欄名仍不是上游那九欄。實際:%', coalesce(v_cols, '(NULL)');
--   END IF;
--   SELECT count(*) INTO v_cnt
--     FROM pg_class c, aclexplode(c.relacl) a
--    WHERE c.oid = 'public.admin_customer_list_v'::regclass
--      AND a.grantee <> c.relowner
--      AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
--   IF v_cnt <> 0 THEN
--     RAISE EXCEPTION '回滾後授權不對 — 除 owner 與 service_role 外還有 % 條', v_cnt;
--   END IF;
--   IF (SELECT count(*) FROM pg_class WHERE relname IN
--       ('customers_birthday_idx','customers_birth_month_idx') AND relkind = 'i') <> 0 THEN
--     RAISE EXCEPTION '回滾未完成 — 兩支索引還在';
--   END IF;
-- --   🔴 COMMENT 四則都要回來(DROP VIEW 會一起丟掉它們)
--   IF obj_description('public.admin_customer_list_v'::regclass, 'pg_class') IS NULL THEN
--     RAISE EXCEPTION '回滾未完成 — view 的 COMMENT 不見了(DROP VIEW 丟掉的)';
--   END IF;
--   SELECT count(*) INTO v_cnt FROM pg_description d
--     JOIN pg_attribute a ON a.attrelid = d.objoid AND a.attnum = d.objsubid
--    WHERE d.objoid = 'public.admin_customer_list_v'::regclass AND d.objsubid > 0;
--   IF v_cnt <> 3 THEN
--     RAISE EXCEPTION '回滾未完成 — 欄位 COMMENT 只剩 % 則(上游有 3 則)', v_cnt;
--   END IF;
--   RAISE NOTICE '✅ 回滾完成:九欄 + 授權 + 索引 + COMMENT 四格都驗過';
-- END
-- $rb$;
--
-- COMMIT;

-- ══ 8. 🔴 這道守門【擋不到】什麼(codex 2026-08-26 逼出來的兩條, 不是我想到的)═══
--
--   ⚠️ 兩條都【不是 must-fix】, 而是**明寫的天花板**。寫在這裡是因為
--      「沒寫下來的限制」會被下一個人讀成「沒有限制」。
--
--   ① **欄名白名單驗的是【名字】, 不是【那一欄的資料從哪來】。**
--      `wallet_balance` 那條(第 ② 條)是**字串比對 view 定義**
--      ⇒ 直接寫 `c.wallet_balance` 會被抓到, 而**經由一個 helper 函式間接讀它**
--        (`SELECT f(c.user_id)::smallint AS birth_month`)⇒ 定義文字裡沒有那個字 ⇒ **全綠**。
--      ⇒ 這道擋的是**手滑**, 不是**刻意繞過**。刻意繞過要靠 code review, 不是靠這裡。
--
--   ② **ACL 斷言查的是【直接被授權的人】。**
--      如果有人能 `SET ROLE` 到 `service_role`(或切到 owner), 斷言仍綠而生日讀得到。
--      ⇒ 那一層的防線在 Supabase 的角色設定, **不在這支 migration**。
--      📎 本 repo 有相關前例:memory `Supabase 分冊` 的
--         「session_user 閘把 SET ROLE 當攻擊者」「pooled SET ROLE 斷線」。
