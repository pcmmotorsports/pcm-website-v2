-- 20260816030000_m4b_admin_customer_list_view.sql
-- 客戶頁三欄(訂單數 / 消費金額 / 最後下單)—— 聚合 view `admin_customer_list_v`
--
-- plan = docs/specs/2026-08-16-customer-list-three-columns-plan.md
-- 來源 = Sean 2026-08-16 逐字「客戶頁三欄你先做你覺得最完整的功能頁面」,主視窗轉派 A 窗。
-- 鐵則 12③(DDL)。**additive:只新增一個 view,不動任何既有表、函式、索引;
--   權限只設在【這支新 view】上,不改任何既有物件的授權。**
--
-- ══ 1. 🔴 口徑 —— 誰裁的、誰沒裁,逐條寫清楚 ═══════════════════════════════════
--
-- ① **消費金額 = 排除已取消、不扣退款**
--    → **主視窗 2026-08-16 裁。Sean 未逐條答。要改直接改。**
--    理由:①「消費金額」在店家語境是「這個客人買了多少」②扣退款要碰退款帳(跨線)
--         ③選最保守可解釋的那個。
--
-- ② **訂單數 / 最後下單 也排除已取消**
--    → 🔴 **A 窗 2026-08-16 選的,【沒有任何人裁過】。要改直接改。**
--    理由 = 三個數字擺在同一列會被讀者互相對照;不一致時員工第一反應是「系統算錯了」,
--    而不是「口徑不同」。
--    ⚠️ **反方成立且已回報**:客人今天下單又取消,「最後下單」仍顯示數月前 ⇒ 掩蓋近期互動。
--       codex 2026-08-16 關卡1 判這條該由 Sean 裁。**已列進決策題,未答之前用本口徑。**
--
-- 🔴 **欄名自己講口徑,不靠 COMMENT**(codex 關卡1:「訂單數」實際是「未取消訂單數」,
--    名字會誤導)⇒ 欄名一律帶 `active_`:
--      active_order_count / active_spend_total / last_active_ordered_at
--    **UI 標籤仍是 Sean 指定的「訂單數 / 消費金額 / 最後下單」** —— 那一層的誠實
--    (標籤旁要不要加「不含已取消」)是接線片的事,不是本片。
--
-- ══ 2. 🔴 寫法契約 —— 抄 `admin_order_list_v`(20260814140000_…:30-45),含一處【刻意偏離】═══
--
-- 照抄:
--   ② **不得 `GROUP BY`、不得 `DISTINCT`、不得 join 到 `orders`** —— 三個新欄一律**純量子查詢**。
--      join + 聚合會讓 `c.user_id` 不再是「單純的欄位引用」,PostgREST 就追不回底表、embed 靜默消失。
--   ③ 新增欄位只能往後加,且必須是**純量**。
--
-- 🔴 **偏離契約①(`o.*` 原樣帶出)—— 這裡改成【逐顆列出欄位】,理由如下**:
--    `customers` 有兩顆**刻意不給後台列表看**的欄:`wallet_balance` / `total_deposit`
--    (建表 `20260523034911_…:21-22`;白名單 byte-equal 守門在
--     `packages/adapters/src/supabase/SupabaseCustomerAdapter.test.ts:25`)。
--    `c.*` 會把它們帶進 view ⇒ **view 一旦 GRANT 出去,那兩欄就在那個角色的可查表面上**,
--    adapter 不 select 不代表沒事。
--    ⇒ 契約① 禁的是「包表達式 / 改名 / 型別轉換」,**不是「不能列名」**:
--      逐顆列出的**純欄位引用**照樣追得回底表。
--    ✅ codex 2026-08-16 關卡1 獨立確認:「`c.user_id` 等純欄位引用與 `c.*` 展開後
--       都是直接欄位引用,PostgREST FK embed 沒有實質差異」。
--    ⚠️ **代價**:`customers` 日後加欄不會自動出現在這支 view —— 這是**明寫的**,
--       不像 `c.*` 那樣是「建 view 當下凍結」的隱藏陷阱。加欄要同批重建這支 view。
--
-- ══ 3. 🔴 型別 —— 兩顆都是 bigint,而且理由是同一個 ═══════════════════════════
--
-- `sum(int4)` 在 PG 回 `bigint`、`count(*)` 也是 `bigint`。**兩顆都不轉回 integer。**
-- ⚠️ plan 初版只替 `sum` 講了溢位、卻把 `count` 轉成 `integer` —— **自己跟自己矛盾**
--    (codex 關卡1 must-fix)。這裡兩顆一致保留 bigint。
-- ⚠️ **bigint 進 PostgREST/JS 會是 JSON number** —— 本專案量級不可能接近 2^53,
--    但**接線片要把型別明訂下來**,不要到前端才發現 number/string 不一致。已列進交接。
--
-- ══ 4. 🔴 NULL 語意 —— 三欄【不一致是對的】 ═══════════════════════════════════
--
--   active_order_count   零訂單 ⇒ **0**(`count(*)` 本來就不會 NULL,不需要 coalesce)
--   active_spend_total   零訂單 ⇒ **0**(`sum` 會回 NULL ⇒ **要** coalesce)
--   last_active_ordered_at 零訂單 ⇒ **NULL**(**刻意不 coalesce**:沒有一個合理的「零日期」;
--                          `epoch` 或 `now()` 都會製造假事實)
-- 🔴 **接線片必須把 NULL 顯示成「從未下單」或「—」,不得留白** ——
--    留白在畫面上與「載入失敗」長得一模一樣。(codex 關卡1 must-fix;本片管到 DB,
--    這句寫在這裡是**給下一片的驗收條款**,不是本片已完成的宣稱。)

CREATE OR REPLACE VIEW public.admin_customer_list_v
  WITH (security_invoker = true) AS
SELECT
  -- 🔴 逐顆列出 = 白名單本身(見 §2 偏離)。**不得加 wallet_balance / total_deposit。**
  c.user_id,
  c.name,
  c.email,
  c.phone,
  c.tier,
  c.created_at,
  -- 🔴 契約②:純量子查詢,不 join、不 GROUP BY、不 DISTINCT。
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
      AND o.cancelled_at IS NULL)                       AS last_active_ordered_at
FROM public.customers c;

-- ══ 5. 權限 —— 逐字抄 `admin_order_list_v`(:149-151)═══════════════════════════
--
-- 🔴 **絕不 GRANT 給 `anon` / `authenticated`**:這支帶**全體客戶的 email 與 phone**。
-- `security_invoker = true`:沒有任何需要繞過底表 RLS 的理由,以呼叫者身分套底表 RLS。
-- ⚠️ view 的建立者授權是**給具名角色的授權、不是 PUBLIC** ⇒ `REVOKE … FROM PUBLIC`
--    收不掉 ⇒ 必須**逐角色**收(這一段的教訓來自 :144-147,不是我推的)。
REVOKE ALL ON public.admin_customer_list_v FROM PUBLIC;
REVOKE ALL ON public.admin_customer_list_v FROM anon, authenticated;
GRANT SELECT ON public.admin_customer_list_v TO service_role;

COMMENT ON VIEW public.admin_customer_list_v IS
  '後台客戶列表(訂單數/消費金額/最後下單)。'
  '🔴 口徑:三欄一律【排除已取消】(cancelled_at IS NOT NULL 者不計)、不扣退款。'
  '消費金額那條=主視窗 2026-08-16 裁、Sean 未逐條答;訂單數與最後下單那條=A 窗 2026-08-16 選、'
  '無人裁 —— 兩者都是【要改直接改】。'
  '🔴 寫法契約:customers 欄位逐顆列出(刻意不用 c.* —— 要擋 wallet_balance/total_deposit)、'
  '三個聚合欄一律純量子查詢,不得 GROUP BY/DISTINCT/join orders。customers 加欄要同批重建本 view。'
  '🔴 只給 service_role:本 view 帶全體客戶 email/phone,不得 GRANT 給 anon/authenticated。';

COMMENT ON COLUMN public.admin_customer_list_v.active_order_count IS
  '未取消訂單數(bigint,零訂單=0)。欄名帶 active_ 是刻意的:它不是「總下單次數」。';
COMMENT ON COLUMN public.admin_customer_list_v.active_spend_total IS
  '未取消訂單的 total 加總(bigint 元位、禁浮點;零訂單=0)。不扣退款。';
COMMENT ON COLUMN public.admin_customer_list_v.last_active_ordered_at IS
  '最後一筆未取消訂單的 created_at。🔴 零訂單=NULL(刻意不 coalesce:沒有合理的零日期)。'
  '接線片必須顯示成「從未下單」或「—」,不得留白 —— 留白與載入失敗長得一樣。';

-- ══ 6. apply 時的自我斷言 ═════════════════════════════════════════════════════
--
-- 🔴🔴 **這裡【只放結構不變式】,不放任何需要造資料的值斷言**(codex 關卡1 must-fix)。
--    值斷言要造 fixture,而 migration **正式 apply 時也會跑** ⇒ 會污染正式資料,
--    或因正式庫狀態不同而失敗。值斷言在拋棄式庫用 `docs/probes/` 的 probe 跑,
--    那支可重跑、且不碰正式庫。
-- ⚠️ **誠實邊界**:下面五條證的是「這支 view 長對了、權限收對了」,
--    **不證「三欄算出來的數字對」** —— 那是 probe 的事,見 §7。
DO $verify$
DECLARE
  v_def  text;
  v_cnt  integer;
  v_cols text;
BEGIN
  SELECT pg_get_viewdef('public.admin_customer_list_v'::regclass, true) INTO v_def;

  -- ① 正向對照:先證我真的抓到 view 定義(空字串會讓下面每一條都恆真)
  IF v_def IS NULL OR length(v_def) < 50 THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 抓不到 view 定義(長度 %),下面的斷言全部沒有判別力',
      coalesce(length(v_def), -1);
  END IF;

  -- ② 契約②:不得 GROUP BY / DISTINCT / JOIN
  --    🔴 初版只擋前兩個 —— 改成 JOIN 但不用那兩個關鍵字時,五條照樣全綠(codex 關卡2 must-fix)。
  --    ⚠️ 這是**字串比對不是 SQL parser**。
  --    🔴 **初版那句「`pg_get_viewdef` 會印成 `FROM a, b` 所以下面也擋得到」是【推的、而且是錯的】**
  --       (code-reviewer 2026-08-16 實測):`FROM cust c, ord o` 有**別名**時,
  --       別名把逗號推開 ⇒ `from\s+[a-z_.]+\s*,` 不命中、`\mjoin\M` 也不命中 ⇒ **兩道全綠**。
  --       ⇒ 下面的正規式已改成**吃得下別名**。而 M0-M6 當時沒有一發打舊式 join,
  --         **所以那條當初是宣稱不是量測** —— 現在補了 M7。
  IF v_def ~* '\mgroup\s+by\M' OR v_def ~* '\mdistinct\M' OR v_def ~* '\mjoin\M' THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 定義裡出現 GROUP BY / DISTINCT / JOIN,違反寫法契約②(PostgREST embed 會靜默消失)';
  END IF;
  IF v_def ~* 'from\s+[a-z_."]+(\s+(as\s+)?[a-z_"]+)?\s*,' THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 最外層 FROM 出現逗號(舊式 join),違反寫法契約②';
  END IF;

  -- ③ 🔴 白名單:wallet_balance / total_deposit 絕不得出現
  IF v_def ~* '\mwallet_balance\M' OR v_def ~* '\mtotal_deposit\M' THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 定義裡出現 wallet_balance/total_deposit,那兩欄刻意不給後台列表看';
  END IF;

  -- ④ 欄位形狀:恰 9 欄,且三個聚合欄的型別逐字對
  --    🔴 **釘完整的欄名與順序,不是只釘欄數**(codex 關卡2 nit:只驗欄數的話,
  --       漏掉 phone、換成另一顆非禁用欄仍會通過)。這一串就是白名單本身。
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO v_cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v';
  IF v_cols IS DISTINCT FROM 'user_id,name,email,phone,tier,created_at,'
                             || 'active_order_count,active_spend_total,last_active_ordered_at' THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 欄名或順序不符白名單。實際:%', coalesce(v_cols, '(NULL)');
  END IF;

  SELECT count(*) INTO v_cnt
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'admin_customer_list_v'
     AND (column_name, data_type) IN (
       ('active_order_count', 'bigint'),
       ('active_spend_total', 'bigint'),
       ('last_active_ordered_at', 'timestamp with time zone'));
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 三個聚合欄的型別不對(bigint/bigint/timestamptz),命中 % 條。'
      '🔴 最可能的原因是有人把 count/sum 轉回 integer —— 那會在單一客人訂單數或金額超過 21 億時溢位', v_cnt;
  END IF;

  -- ⑤ 🔴🔴 權限 —— 兩個獨立的面,初版兩個都漏了一半(codex 關卡2 must-fix,我實測後只採信一半)
  --
  --    **實測(拋棄式 PG 17.10,兩發正反對照)**:
  --      · codex 說「`role_table_grants` 看不到 PUBLIC」⇒ **實測是錯的**,GRANT TO PUBLIC 後命中 1。
  --      · codex 說「看不到欄位層授權」⇒ **實測是對的**:`GRANT SELECT (email) ON v TO authenticated`
  --        之後 `role_table_grants` 回 **0**、而 `pg_attribute.attacl` 回 **1** ⇒ 真的是假綠。
  --    ⇒ 不是補一個角色名就好,是**查法本身要換**。
  --
  --    🔴 改成列舉【全部】grantee 而不是點名那三個 —— `CREATE OR REPLACE VIEW` 會**保留既有 ACL**,
  --       所以真正要斷言的是「除了 owner 與 service_role,誰都沒有」,不是「那三個沒有」。
  --    🔴 **正向對照**:`relacl IS NULL`(從沒下過 GRANT)時 `aclexplode` 回 0 列 ⇒ 下面那條會恆綠。
  --       §5 的 GRANT 在本區塊之前所以不會發生,但**恆綠格不能靠「不會發生」站著**。
  IF (SELECT relacl FROM pg_class WHERE oid = 'public.admin_customer_list_v'::regclass) IS NULL THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — relacl 是 NULL(從沒下過 GRANT),'
      '下面的授權斷言【沒有判別力】。§5 的 GRANT/REVOKE 沒跑到?';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = 'public.admin_customer_list_v'::regclass
     AND a.grantee <> c.relowner
     AND (a.grantee = 0 OR pg_get_userbyid(a.grantee) <> 'service_role');
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 表層授權除了 owner 與 service_role 之外還有 % 條'
      '(grantee=0 即 PUBLIC)。本 view 帶全體客戶 email/phone,不得外流', v_cnt;
  END IF;

  --    欄位層 ACL:一條都不該有(有的話 `REVOKE ALL ON <view>` 收不掉它)
  SELECT count(*) INTO v_cnt
    FROM pg_attribute at, aclexplode(at.attacl) a
   WHERE at.attrelid = 'public.admin_customer_list_v'::regclass
     AND at.attacl IS NOT NULL;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '客戶列表 view 驗收失敗 — 出現 % 條【欄位層】授權,而 REVOKE ALL ON <view> 收不掉它', v_cnt;
  END IF;

  -- 📏 **這幾條的判別力是量過的,不是宣稱的**(拋棄式 PG,只跑本 DO 區塊、不跑整支 migration):
  --      M0 乾淨                          → 綠
  --      M1 欄位層 GRANT authenticated     → 🔴 紅(欄位層那條)
  --      M1' 撤回                          → 綠
  --      M2 表層 GRANT anon                → 🔴 紅(表層那條)
  --      M3 GRANT PUBLIC                   → 🔴 紅(表層那條;codex 判它恆真 —— 實測不是)
  --      M4 全部撤回                       → 綠
  --      M5 改成 LEFT JOIN                 → 🔴 紅(契約②那條)
  --      M6 漏掉 phone、混入 updated_at    → 🔴 紅(欄名白名單那條)
  -- 🔴🔴 **第一版 harness 是假綠的,而它看起來完全正常**:當時拿「跑整支 migration」當突變載體 ——
  --      而 §5 的 `REVOKE` 在 DO 區塊【之前】⇒ **自己把突變清掉了再斷言**,M1/M2/M3 全綠。
  --      ⇒ **突變要打在被測的那一段上,不是打在「包含被測那段的整個流程」上。**
  RAISE NOTICE '✅ admin_customer_list_v:結構不變式全過(值的正確性由 docs/probes 的 probe 驗,不在本檔)';
END
$verify$;

-- ══ 7. 值的正確性驗到哪(誠實邊界)═══════════════════════════════════════════
--
-- 🔴 **本檔【沒有】驗三欄算出來的數字對不對。** 那要造資料,而造資料不能進正式 migration。
--    值斷言在 `docs/probes/admin-customer-list-view-probe.sh`(拋棄式 Postgres,可重跑、零花費),
--    含正反對照:**取消單不算**那條要有「加一筆取消單、三欄都不動」的負向格。
--
-- ══ 8. 效能(量過才寫,沒量的標明沒量)═══════════════════════════════════════
--
-- 每一列跑三個相關子查詢 ⇒ 每個客人對 `orders` 探三次。
-- 既有索引 `orders_customer_idx ON orders(customer_user_id)`(`20260604120000_…:178`)吃得到。
-- 🔴 codex 關卡1 判「must-fix:至少要加 partial covering index
--    `(customer_user_id, created_at DESC) INCLUDE (total) WHERE cancelled_at IS NULL`」。
--    **本片沒有加 —— 因為量出來它沒有效果。**
--
-- 📏 **實測(拋棄式 PG 17.10,20,000 客戶 / 100,000 訂單,10% 取消率)**
--    🔴 **重跑法**:`PROBE_SCALE=1 bash docs/probes/admin-customer-list-view-probe.sh`
--    ⚠️ **初版寫「可重跑」而規模產生器【沒有出貨】**(它當時只活在我的 shell 裡,probe 只造 3 客 4 單)
--       —— 那組數字是否決 codex 索引 must-fix 的**唯一依據**,沒人能重跑等於沒有依據。
--       (code-reviewer 2026-08-16 must-fix;產生器已補進 probe。)
--      分頁查 `ORDER BY created_at DESC LIMIT 20`(= 後台列表真正走的路)
--                                        第 1 次      第 2 次
--        只有既有 `orders_customer_idx`   4.17 ms      4.97 ms
--        再加 codex 那條 covering index   4.41 ms      4.22 ms
--        全表掃(不分頁,最壞情況)       64.8 ms     145.5 ms
--
--      🔴🔴 **兩次量測的【方向相反】** —— 第 1 次加索引比較慢、第 2 次比較快。
--         ⇒ **這正是「沒有可觀測的改善」的證據**,比任何一次的單一數字都強:
--           **一個真的有效的索引不會在兩次量測之間換邊。**
--         ⚠️ **不要引用其中任何一組單次數字當定論** —— 初版檔頭只寫了第 1 次那組,
--            讀起來像「量到 4.17 vs 4.41」,而真相是**它們在雜訊裡**。
--         ⚠️ 全表掃那格 64.8 → 145.5 差一倍以上 ⇒ **那格更不能拿來當容量規劃的依據**,
--            它只證「不分頁比分頁貴一到兩個數量級」這件事的**量級**,不是那個數字。
--    ⇒ 三個相關子查詢在**分頁路徑**下只對那 20 列展開,不是「每個客人掃三次全表」。
--      既有索引已經吃得到,**多一條索引在正式庫既有資料上建 = 純風險零收益**。
--
-- ⚠️ **這個數字的效度邊界(不要讀成全涵蓋)**:
--    ① 本機 Postgres,不是 Supabase 的機器與參數。
--    ② probe 造的 `orders` 是最小形狀(4 欄),正式庫那張表寬很多 ⇒ 每頁塞得下的列數不同。
--    ③ 量的是**分頁路徑**。哪天有人拿這支 view 去做不分頁的匯出,回頭看「全表掃 64.8 ms」那格。
--    ④ 20,000 客戶遠高於 PCM 目前量級 ⇒ 這是**上限探測**,不是現況量測。
--
-- ══ 9. Rollback ═══════════════════════════════════════════════════════════════
--   DROP VIEW IF EXISTS public.admin_customer_list_v;
-- (additive、無底表改動 ⇒ 這一行就回到 apply 前的狀態。)
