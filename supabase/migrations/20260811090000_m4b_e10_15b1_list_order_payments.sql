-- M-4b E10 #15-B1:訂單收款列表的唯讀 RPC(`admin_list_order_payments`)。
--
-- ══ 為什麼需要這支(不是偏好,是實查出來的硬限制)══════════════════════════
-- `order_payments` 的 `relacl` = `{postgres=arwdDxtm/postgres}` —— **只有 owner**。
-- `has_table_privilege` 對 `service_role` / `authenticated` / `anon` 的 SELECT **全 false**;
-- 欄級 `attacl` 空;RLS 開著但 policy 數 = 0。
-- ⇒ **寫得進去、讀不出來**:寫走 OP5 的 SECDEF(owner=postgres)沒事,
--    讀不管走 PostgREST 直查表還是任何現有 RPC 都拿不到列
--    (唯一能讀該表又給 service_role EXECUTE 的是 `admin_compute_order_settlement`,
--     而它回**彙總**、沒有明細,還自標 `scope=db_internal_only`
--     ⇒ 精確講:**沒有任何現成路徑回得出明細**;「能讀該表」的不只它,回得出明細的一個也沒有)。
-- ⇒ 不新增讀路徑就做不出「列出已登錄的收款列」。窄 RPC 優於開表級 grant:
--    grant 開了收不回(收緊要另一支 migration),而且會把全表攤給 service client。
--    主視窗 2026-08-11 裁 B(D-480-A)。
--
-- ══ 🔴🔴 授權:`REVOKE FROM PUBLIC` **收不掉 anon** ═══════════════════════════
-- 本庫 `public` schema 對 **function** 的 `pg_default_acl` 有兩筆(實查):
--   grantor=postgres       → {postgres=X, anon=X, authenticated=X, service_role=X}
--   grantor=supabase_admin → {postgres=X, anon=X, authenticated=X, service_role=X}
-- ⇒ **函式一建出來,anon 與 authenticated 就自動持有 EXECUTE**,
--    而 `REVOKE ... FROM PUBLIC` 收不掉它們(PUBLIC ≠ 明確持有 grant 的 anon)。
--    只寫 `FROM PUBLIC` 的話,這支會是**登出訪客帶任一 order uuid 就能讀出該單收款明細**的端點。
-- ⇒ 下方 REVOKE 逐個點名四個角色,且檔尾斷言用**三層**驗(見該處),不靠「記得要 REVOKE」。
--
-- ⚠️ `authenticator` 是 `rolinherit = false`(NOINHERIT)、`rolcanlogin = true`(實查 `pg_roles`)
--    ⇒ 它**不隱式繼承** service_role 的 EXECUTE,必須明確 `SET ROLE` 才拿得到 —— 那正是 PostgREST 的正常路徑。
--    所以檔尾「有效權限」那層對它斷言 false 是**過得了的**;不先查這件事就照抄會在 apply 當場炸。
--
-- ══ 三態必須可分辨(這是本片最毒的失敗形狀)════════════════════════════════
-- 「訂單不存在」/「SECDEF 靜默回空」/「真的還沒收款」三者若都回 `[]`,員工看到的都是「尚無收款」,
-- 而**中間那個會害他再登一次 ⇒ 重複入帳**(`request_id` 擋不住新表單鑄的新鍵)。
--   · 訂單不存在      → 回 **NULL**(照姊妹函式 `20260811030000:335-336` 的慣例,不造假 jsonb)
--   · owner 漂/FORCE RLS → **RAISE**(檔尾 SECDEF fail-open 閘,apply 時就擋)
--   · 存在但零收款    → `[]`(`COALESCE`;`jsonb_agg` 對空集合回的是 NULL 不是 `[]`)
--
-- ══ 本片不做 ═══════════════════════════════════════════════════════════════
-- · **不加 `p_actor`**:純讀、不寫稽核 ⇒ 沒有稽核對象;而 `p_actor` 從來不是授權證明
--   (呼叫端想填什麼填什麼)。⚠️ **但別把這句讀成「授權在 app 層做掉了」** ——
--   實查:`session/actor.ts:5-7` 與 `components/orders/order-detail-route.tsx:110-111` **兩處逐字自陳**
--   actor cookie「不是登入/授權邊界」;`authorizeAdminMutation` 只服務 action(寫)。
--   **讀路徑真正唯一的閘是 `apps/admin/src/proxy.ts:38-49` 的全域登入閘,無角色檢查、且有 DEV_AUTH_BYPASS。**
--   ⇒ 誠實話:**任何登入後台的人都讀得到任何一單的收款明細**。現況不是本片造成的,
--     但本片第一次把它變成畫面上的資料。
-- · **不加隔離閘/鎖**:本支是 **`STABLE`** ⇒ 函式內的查詢共用**呼叫查詢的快照**,構造不出中間態。
--   ⚠️ 這裡原本寫的是「`LANGUAGE sql` 單一 statement ⇒ 單一快照」——**那是錯的推論**
--   (`LANGUAGE sql` 不保證單句;而快照規則來自 STABLE、與語言無關)。結論不變、理由換掉。
--   真正的不一致在**跨呼叫**(`order-detail-route.tsx:113-117` 是 `Promise.allSettled` 平行讀,
--   本片會加成第四路;兩次呼叫間有人 commit 沖銷 ⇒ 列表與結清兩塊面板互相矛盾)——
--   那條的處置在 B2-a 定(最省=列表與結清同一支 RPC 一次回),**不在本片**。
-- · **不做跨單查詢**:跨單 = 今日對帳 #16,別提前長出來。
--
-- ⚠️ **本片不 apply、不 push**;apply 由 Sean 批(鐵則 12③:本片新增 DB 物件)。

BEGIN;

-- 🔴 三個 timeout。⚠️ **「照姊妹函式」只是先例、不是理由** —— 姊妹是**寫入**函式,本片是純讀 DDL。
--    本片自己的理由:`CREATE FUNCTION` 要拿 schema 層的 catalog 鎖,而檔尾斷言會讀 `pg_class`
--    (`public.orders` / `public.order_payments` 的 `relowner`/`relforcerowsecurity`)
--    ⇒ 若 apply 當下有人正在對那兩張表跑 DDL,本片會**卡著等**而不是失敗。
--    有上限 ⇒ 卡住時整片乾淨回滾(本檔自包交易),不會半套留在庫裡、也不會擋住別人的 apply 佇列。
--    數值沿用姊妹的 5s/60s/90s;**那三個數字我沒有獨立評估過**,標明未評、不假裝算過。
--    ⚠️ memory `reference_supabase-migration-set-local-is-noop` 的**標題**是無條件句(「migration 內 SET LOCAL 是 no-op」),
--    但那條自己有條件補正:決定因素是**該檔有沒有自包 `BEGIN; … COMMIT;`** ——
--    包了就生效、逐句 autocommit 才是 no-op(WARNING 25P01)。本檔在上一行就 `BEGIN;` ⇒ **有效**。
--    判別法(別憑標題):`grep -n '^BEGIN;' 本檔`,看 SET LOCAL 行號在不在 BEGIN…COMMIT 之間。
-- ⚠️ `transaction_timeout` 是 **PG17-only**(姊妹函式 `:39` 同款代價);它已在正式站 apply 成功
--    ⇒ 正式站是 PG17 這件事由「它跑得過」佐證,apply 前仍建議 `SHOW server_version`。
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '90s';

CREATE FUNCTION public.admin_list_order_payments(p_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE                       -- 唯讀;**必須是 STABLE、不接受 IMMUTABLE**(見檔尾 ④ 的理由)。
SECURITY DEFINER
SET search_path = ''
AS $fn$
  -- 🔴 **快照一致性來自 `STABLE`,不是來自「只有一句」**(關卡2 codex 更正我原本寫的理由):
  --    `LANGUAGE sql` **不保證**單一 statement;而 STABLE 函式裡的每一句都共用**呼叫查詢的快照**
  --    ⇒ 就算日後變成多句,函式內仍看到同一個快照。
  --    ⇒ 檔尾對 `prolang` 的斷言**不是**在證「單句」,它證的是「沒被換成 plpgsql」
  --      (plpgsql 的 VOLATILE 子查詢會各自取快照)。原本那句「單一 statement ⇒ 一個快照」是**錯的推論**。
  -- 🔴 每個名稱全限定 `public.…`:`search_path = ''` 只讓未限定名稱**壞掉**,不等於保護。
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id = p_order_id)
      THEN NULL                     -- 訂單不存在:回 NULL,不造一個假的空陣列
    ELSE COALESCE(
      (SELECT pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                  'id',                  p.id,
                  'rail',                p.rail,
                  'amount',              p.amount,
                  'received_at',         p.received_at,
                  'created_at',          p.created_at,
                  'actor',               p.actor,
                  'bank_reference',      p.bank_reference,
                  'rec_trade_id',        p.rec_trade_id,
                  -- 🔴 是 `payer_note` 不是 `note`:OP5 的 INSERT 欄位表逐字
                  --    `(order_id, rail, amount, received_at, bank_reference, request_id, payer_note, actor)`
                  --    ⇒ **員工在表單打的備註存進 payer_note,`note` 這欄 OP5 根本不寫**。
                  --    讀錯欄的症狀是每一筆都顯示「無備註」,而員工明明打了字。
                  'payer_note',          p.payer_note,
                  'reverses_payment_id', p.reverses_payment_id,
                  'reversal_reason',     p.reversal_reason,
                  -- 🔴 具名旗標,呼叫端**不准用正負號判斷是不是沖銷**:
                  --    「沖銷之沖銷」的金額可以是正的(`20260810100000` 檔頭逐字:500−500+500=500)
                  --    ⇒ 看正負會把一筆沖銷讀成收款。
                  'is_reversal',         (p.reverses_payment_id IS NOT NULL)
                )
                -- 🔴 排序寫在**聚合函式裡面**:子查詢的 ORDER BY 不保證聚合結果的順序。
                --    三段是決定性排序 —— 同一秒入帳兩筆時少了 `id` 這個 tie-breaker,
                --    畫面順序會在兩次重整之間跳動,而員工正拿它跟銀行對帳。
                ORDER BY p.received_at DESC, p.created_at DESC, p.id DESC)
         FROM public.order_payments p
        WHERE p.order_id = p_order_id),
      '[]'::jsonb)                  -- 存在但零收款:`jsonb_agg` 回 NULL ⇒ 收斂成空陣列
  END
$fn$;

COMMENT ON FUNCTION public.admin_list_order_payments(uuid) IS
  'M-4b E10 #15-B1 訂單收款列表(唯讀、零寫入、SECURITY DEFINER、search_path='''')。'
  '存在理由:order_payments 對每個非 owner 角色的 SELECT 都是 false(零表權、零 RLS policy)⇒ 不經本支讀不到。'
  '三態:訂單不存在=NULL / 存在但零收款=[] / owner 漂或 FORCE RLS=檔尾閘在 apply 時 RAISE。'
  '🔴 呼叫端用具名 is_reversal 判斷沖銷,**不要看金額正負**(沖銷之沖銷可為正)。'
  '🔴 備註欄是 payer_note(OP5 寫的那欄),不是 note。'
  '🔴 授權粒度誠實話:讀路徑只有 proxy.ts 的全域登入閘、無角色檢查 ⇒ 任何登入後台者可讀任何一單的收款明細。'
  '刻意不回 order_id / request_id / note / reviewed_by / reviewed_at(檔尾有閉世界斷言釘住)。';

-- ── ACL:逐個點名 REVOKE(PUBLIC 收不掉 anon,見檔頭)────────────────────────
REVOKE ALL ON FUNCTION public.admin_list_order_payments(uuid)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION public.admin_list_order_payments(uuid) TO service_role;

-- ── 結構斷言(全部在同一交易內;任一紅 = 整片回滾、不留半套)────────────────
DO $gate$
DECLARE
  v_fn  oid := 'public.admin_list_order_payments(uuid)'::regprocedure;
  v_bad text;
  v_src text;
BEGIN
  -- ① proacl 不得是 NULL。
  --    🔴 這是**地基**,不是多餘的一層:REVOKE 從沒執行過時 proacl 是 NULL,
  --    而 `aclexplode(NULL)` 回**零列** ⇒ 下面 ② 的閉世界斷言會**直接通過**,
  --    但那正是「預設 PUBLIC 可 EXECUTE」的狀態。少了這條,② 是恆真格。
  IF (SELECT p.proacl FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) IS NULL THEN
    RAISE EXCEPTION '#15-B1:proacl 是 NULL ⇒ REVOKE 沒執行過,函式預設 PUBLIC 可 EXECUTE'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_proacl_null';
  END IF;

  -- ② EXECUTE 閉世界:只准 {owner, service_role},且**不得帶 WITH GRANT OPTION**
  --    (`is_grantable` 那半不能少 —— 允許集合內的角色帶了它就能再轉授出去)。
  SELECT pg_catalog.string_agg(y.grantee, ', ' ORDER BY y.grantee) INTO v_bad
    FROM (
      SELECT CASE WHEN g.grantee = 0 THEN 'PUBLIC'
                  ELSE pg_catalog.pg_get_userbyid(g.grantee) END AS grantee
        FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) g
       WHERE p.oid = v_fn
         AND g.privilege_type = 'EXECUTE'
         AND (g.grantee = 0
              OR pg_catalog.pg_get_userbyid(g.grantee)
                 NOT IN ('service_role', pg_catalog.pg_get_userbyid(p.proowner))
              OR g.is_grantable)
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#15-B1 EXECUTE 閉世界被打破(%)⇒ ①出現 {owner, service_role} 以外的 grantee '
                    '②或允許集合內的角色帶了 WITH GRANT OPTION', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_execute_closed_world';
  END IF;

  -- ③ 有效權限實測 —— ①② 只看 ACL 字面,這層才擋得住「透過成員關係間接拿到」。
  --    ⚠️ ①(proacl NULL)**不是**與本層獨立的一層(關卡2 nit):proacl 為 NULL 時套用硬編碼預設、
  --    其中 PUBLIC 有 EXECUTE ⇒ 本層的 anon 實測必然也會紅。① 的價值只有**報錯更精準**,不是多一道判別力。
  SELECT pg_catalog.string_agg(x.r, ', ' ORDER BY x.r) INTO v_bad
    FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
   WHERE pg_catalog.has_function_privilege(x.r, v_fn, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#15-B1:這些角色有效拿得到 EXECUTE(%)⇒ 登出訪客可讀收款明細', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_execute_too_wide';
  END IF;

  -- ③b 🔴 `has_function_privilege` **只驗立即可用的權限**,驗不到「`SET ROLE service_role` 之後才拿到」那條路
  --     (PG16+ 的 `GRANT … WITH SET TRUE`)。實查正式站:
  --       `pg_has_role('authenticator','service_role','SET')` = **true**,而
  --       `has_function_privilege('authenticator', …)` = **false**(NOINHERIT)
  --     ⇒ ③ 對 authenticator 是**盲的**,只是它那條路是 PostgREST 的正常路徑、刻意允許。
  --     但同一個機制下,任何被授 `service_role WITH SET TRUE` 的角色都同樣繞得過 ③。
  --     ⇒ 對 anon / authenticated 補這一道(**authenticator 明列為刻意例外,不是漏掉**)。
  --     🔴 R2 補:**不只要擋「達得到 service_role」,也要擋「達得到函式 owner」** ——
  --     owner 是 SECDEF 的執行身分,達得到 owner 等於拿到的比 service_role 更多。
  --     而 `authenticator` 的豁免**只豁免 service_role**(PostgREST 正常路徑),
  --     **不豁免 owner**:它若達得到 owner,那不是正常路徑、是事故。
  SELECT pg_catalog.string_agg(y.msg, '; ' ORDER BY y.msg) INTO v_bad
    FROM (
      SELECT x.r || '→service_role' AS msg
        FROM unnest(ARRAY['anon','authenticated']) x(r)
       WHERE pg_catalog.pg_has_role(x.r, 'service_role', 'SET')
          OR pg_catalog.pg_has_role(x.r, 'service_role', 'USAGE')
      UNION ALL
      SELECT x.r || '→owner(' || pg_catalog.pg_get_userbyid(p.proowner) || ')' AS msg
        FROM unnest(ARRAY['anon','authenticated','authenticator']) x(r)
        CROSS JOIN pg_catalog.pg_proc p
       WHERE p.oid = v_fn
         AND (pg_catalog.pg_has_role(x.r, p.proowner, 'SET')
              OR pg_catalog.pg_has_role(x.r, p.proowner, 'USAGE'))
    ) y;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#15-B1:這些角色取得得到更高身分(%)⇒ 它們 SET ROLE 之後就讀得到收款明細,'
                    '而 has_function_privilege 看不到這條路', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_role_reachable';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION '#15-B1:service_role 拿不到 EXECUTE ⇒ 呼叫端整條死路'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_service_role_blocked';
  END IF;

  -- ④ 函式屬性:SECDEF / search_path / 唯讀 / 語言。
  --    「DDL 裡寫了」不等於「它會一直是」——「純讀」與「快照一致」兩個判斷的地基就在這幾欄。
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = v_fn AND p.prosecdef) THEN
    RAISE EXCEPTION '#15-B1:不是 SECURITY DEFINER ⇒ 零表權的呼叫端讀不到任何列'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_not_secdef';
  END IF;
  -- 🔴 逐字比 `search_path=""`(**含雙引號**)—— 那是 PG 對 `SET search_path = ''` 的實際存法。
  --    姊妹函式 `20260811030000:270-272` 記過:寫成 `search_path=` 會讓自己的閘在拋棄庫當場紅。
  SELECT pg_catalog.array_to_string(p.proconfig, ', ') INTO v_bad
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  IF v_bad IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION '#15-B1 proconfig 是 [%],期望逐字 [%]', coalesce(v_bad,'(NULL)'), 'search_path=""'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_search_path';
  END IF;
  -- 🔴 **只接受 STABLE,不接受 IMMUTABLE**(關卡2 must-fix;我原本照抄姊妹函式寫成 `NOT IN ('s','i')`)。
  --    本支**讀表**:標成 IMMUTABLE 會讓 planner 有權把結果在 prepared plan 裡折成常數
  --    ⇒ 收款列表可能回一份**過期的**答案,而畫面看起來完全正常。
  --    姊妹函式允許 'i' 是它自己的取捨,不是本片可以照抄的理由。
  IF (SELECT p.provolatile FROM pg_catalog.pg_proc p WHERE p.oid = v_fn) <> 's' THEN
    RAISE EXCEPTION '#15-B1:provolatile 不是 STABLE ⇒ VOLATILE 表示有人讓它會寫東西、'
                    'IMMUTABLE 表示讀表結果可被折成過期常數'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_not_readonly';
  END IF;
  -- ⚠️ 這條**與快照無關**(STABLE 的快照規則不限定語言,關卡2 R2 更正我上一版的說法)。
  --    它真正買到的是兩件事:①下面 ⑥ 的碼錨假設本體是**單一 SQL 運算式**的形狀,換成 plpgsql 就失去意義;
  --    ②plpgsql 有程序控制流(迴圈/條件/動態 SQL),可以繞過欄位白名單而碼錨看不出來。
  IF (SELECT l.lanname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid = p.prolang
       WHERE p.oid = v_fn) <> 'sql' THEN
    RAISE EXCEPTION '#15-B1:不是 LANGUAGE sql ⇒ 碼錨的結構前提失效、且程序控制流可繞過欄位白名單'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_not_sql_lang';
  END IF;

  -- ⑤ 🔴🔴 SECDEF fail-open 面(同 `20260811030000:296-308`)。
  --    失敗形狀:表 owner 與函式 owner 不對齊、或表被開了 FORCE RLS ⇒ 查詢**靜默回空**、
  --    函式回 `[]`、畫面說「尚無收款」,員工照著再登一次 ⇒ **重複入帳**。
  --    「靜默回空」是這一族最毒的失敗:沒有錯誤、沒有紅,只有一個有信心的錯答案。
  --
  -- 🔴 **但 FORCE RLS 那一半有前提,別把它講太滿**(2026-08-11 拋棄庫三案實測,PG17):
  --    | owner 形狀 | FORCE RLS | 結果 |
  --    | `rolbypassrls=true`(**正式站的 postgres 就是這個**,`rolsuper=false`) | on | **照常回 4 列,不受影響** |
  --    | `rolbypassrls=false` | on | **回 `[]` 靜默回空** |
  --    | `rolbypassrls=false` | off | 回 4 列(對照組,證明上一列是 FORCE 造成的) |
  --    ⇒ **BYPASSRLS 連 FORCE RLS 也一起繞過** ⇒ 以今天的 owner 而言,「事後被開 FORCE RLS」
  --      **走不到**靜默回空那條路。這一半守的是「owner 換成沒有 BYPASSRLS 的角色」那個未來。
  --    ⚠️ 本閘只在 **apply 當下**跑 ⇒ 事後才被改的情況它看不到(B2 的已知風險,本片不長偵測)。
  SELECT pg_catalog.string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
    FROM pg_catalog.pg_class c
   WHERE c.oid IN ('public.orders'::regclass, 'public.order_payments'::regclass)
     AND (c.relowner <> (SELECT p.proowner FROM pg_catalog.pg_proc p WHERE p.oid = v_fn)
          OR c.relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#15-B1 SECDEF fail-open 面 — [%] owner 不對齊或開了 FORCE RLS ⇒ '
                    '查詢會靜默回空、列表會說「尚無收款」而員工會重複入帳', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_secdef_fail_open';
  END IF;
  -- ⚠️ 這裡**刻意不硬寫 owner 的角色名**:有意義的不變式是「函式 owner 與它讀的表對齊」,
  --    寫死 `postgres` 會在別的環境誤紅,而且那是「誰部署的」而不是「哪個不變式」。

  -- ⑥ 碼錨(prosrc)。
  --    🔴 為什麼需要它:第 ⑤ 之外的正確性(排序在聚合內 / 三態 / 不外流欄位)**在本 migration 裡驗不了**
  --    —— `order_payments` 有 FK + CHECK + trigger,DO 區塊插不了測資。
  --    行為驗證走拋棄庫 `BEGIN → fixture → 驗 → ROLLBACK`(B1 驗收);這裡是**字面層的下界**。
  -- 🔴🔴 **先剝註解、再正規化空白** —— 順序不能反,兩步缺一不可(關卡2 must-fix + 我自己踩過的坑):
  --    ① `prosrc` **保留註解** ⇒ 不剝的話,把錨字串寫進 `--` 註解、同時把真正那行拿掉,
  --       下面每一格都會**假綠**(而且是「看起來守得很嚴」的假綠)。
  --    ② 本檔的鍵值對是**對齊排版**的(`'payer_note',          p.payer_note`)
  --       ⇒ 不正規化空白的話,拿單一空格的字面去 strpos 會**比不到**,而「比不到」同樣等於「通過」。
  --    先剝註解(行為單位)再壓空白;反過來壓完空白註解會吃掉後面整段。
  --    🔴 **兩種註解都要剝**:只剝 `--` 的話,`/* … */` 一樣能把錨字串藏進去假綠(關卡2 R2)。
  --    ⚠️ 誠實邊界:這是**字面層**的下界,不是 parser。已知殘留弱點**兩個方向都有**:
  --      · 假紅方向:字串常值裡若出現 `--` 或 `/*` 會被誤剝(本函式體內沒有那種字串);
  --      · 🔴 假綠方向:把錨字串**藏進字串常值**(例如 `SELECT 'ORDER BY p.received_at …'`)
  --        一樣騙得過 —— 剝註解擋得住註解,擋不住常值。
  --    真要根治得靠 AST,不在本片範圍;**這些錨是回歸守門,不是安全邊界**。
  SELECT pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(p.prosrc, '/\*.*?\*/', '', 'gs'),
             '--[^\n]*', '', 'g'),
           '\s+', ' ', 'g') INTO v_src
    FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;

  -- ⑥a 排序必須在聚合函式**裡面**。
  --     🔴 我的第一版錨是「`…p.id DESC)` 後面緊接右括號」—— **那是恆真格**:
  --     把 ORDER BY 搬到子查詢尾巴時,它後面**照樣**是子查詢的右括號 ⇒ 錨仍然命中,
  --     而那正是它要抓的那個搬動。改用**順序比較**(同 OP5 檔尾順序錨的手法):
  --     聚合內 ⇒ ORDER BY 在 `FROM public.order_payments` **之前**;搬到子查詢 ⇒ 在它**之後**。
  IF pg_catalog.strpos(v_src, 'ORDER BY p.received_at DESC, p.created_at DESC, p.id DESC') = 0 THEN
    RAISE EXCEPTION '#15-B1 碼錨:三段決定性排序不見了(或被改動)⇒ 同秒兩列的順序會在重整之間跳動'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_order_anchor';
  END IF;
  IF pg_catalog.strpos(v_src, 'ORDER BY p.received_at')
     > pg_catalog.strpos(v_src, 'FROM public.order_payments') THEN
    RAISE EXCEPTION '#15-B1 碼錨:ORDER BY 排在 FROM 之後 ⇒ 它在子查詢層、不在 jsonb_agg 內,'
                    '聚合結果的順序不保證'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_order_inside_agg';
  END IF;
  -- ⑥b 三態的兩個分支都在。
  IF pg_catalog.strpos(v_src, 'THEN NULL') = 0
     OR pg_catalog.strpos(v_src, '''[]''::jsonb') = 0 THEN
    RAISE EXCEPTION '#15-B1 碼錨:三態分支不全(訂單不存在→NULL / 零收款→[])⇒ 兩種情況會同形'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_tristate_anchor';
  END IF;
  -- ⑥c 刻意不外流的欄位:閉世界,不是「我沒寫」。
  --     🔴 錨的形狀**逐欄不同,理由也不同**(R3 更正我上一版「一律用完整鍵值對」的說法):
  --     · `p.order_id` **必須**用完整鍵值對 `'order_id', p.order_id` ——
  --       裸 `p.order_id` 在 `WHERE p.order_id = p_order_id` 就出現,拿裸的比會**恆紅**。
  --     · `p.note` **必須**用裸欄名 —— 我上一版用完整鍵值對 `'note', p.note`,
  --       那只擋得住「鍵也叫 note」;**改個鍵名就外流**(reviewer 實測 `'memo', p.note,` ⇒ 全綠)。
  --       裸 `p.note` 是安全的:`p.payer_note` **不含** `p.note` 這個子字串(`p.` 後面接的是 `p`)。
  --     ⇒ 同族的 request_id / reviewed_* 本來就是裸的,現在 note 與它們一致。
  SELECT pg_catalog.string_agg(x.k, ', ' ORDER BY x.k) INTO v_bad
    FROM unnest(ARRAY['''order_id'', p.order_id', 'p.note',
                      'p.request_id', 'p.reviewed_by', 'p.reviewed_at']) x(k)
   WHERE pg_catalog.strpos(v_src, x.k) > 0;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '#15-B1 碼錨:回傳含刻意排除的欄位(%)⇒ 外流面被擴大而沒人發現', v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_excluded_columns';
  END IF;
  -- ⑥d 禁「整列轉 json」的所有寫法:日後有人加欄會**自動**送到 client。
  --     🔴 原本只擋 `SELECT *` / `p.*` —— **擋不住 `to_jsonb(p)` / `row_to_json(p)`**(關卡2 must-fix),
  --     那兩個把整列(含 request_id / note / reviewed_*)一次吐出來,而且字面上**沒有星號**
  --     ⇒ ⑥c 的排除清單與舊版 ⑥d 會同時判綠。
  --     🔴🔴 R3(換模型)再抓到一個**全盲面**:上面五種寫法都沒用到,只要把**整列 `p` 當成一個 value**
  --     塞進 `jsonb_build_object`(例如 `'row', p,`)就外流全部 16 欄,而且
  --     ⑥e 還會判它合格(`jsonb_build_object` 確實是 `jsonb_agg` 的直接引數)。
  --     reviewer 實測:加那一行 ⇒ 15 個錨**全綠**、含五個刻意不回的欄位一起吐出去。
  --     ⇒ 補「裸 `p` 當引數」的兩種形狀(後接逗號或右括號);基準實測 strpos 皆為 0、不誤紅。
  IF pg_catalog.strpos(v_src, 'SELECT *') > 0
     OR pg_catalog.strpos(v_src, 'p.*') > 0
     OR pg_catalog.strpos(v_src, 'to_jsonb(p)') > 0
     OR pg_catalog.strpos(v_src, 'row_to_json(p)') > 0
     OR pg_catalog.strpos(v_src, 'to_json(p)') > 0
     OR pg_catalog.strpos(v_src, ', p)') > 0
     OR pg_catalog.strpos(v_src, ', p,') > 0 THEN
    RAISE EXCEPTION '#15-B1 碼錨:出現整列外流的寫法(SELECT * / p.* / to_jsonb(p) / row_to_json(p) /'
                    ' 把裸 p 當成 jsonb_build_object 的 value)⇒ 未來新增的欄位會自動外流'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_no_star';
  END IF;
  -- ⑥e **正面錨**:`jsonb_build_object` 必須**直接是 `jsonb_agg` 的引數**。
  --     🔴 上一版只要求「某處存在 `jsonb_build_object(`」——**那是恆真格**(關卡2 R2):
  --     寫成 `jsonb_agg(p)`(整列外流)再在別處掛一個沒用到的 `jsonb_build_object()` 就全綠。
  --     ⇒ 改成錨定**直接巢狀**,並另外禁掉 `jsonb_agg(p)` 這個具體形狀。
  --     ⚠️ 本錨吃**正規化後的單一空格排版**:任何讓兩者不再直接相鄰的改寫都會讓它紅。
  --     那是 **fail-closed 方向**(寧可誤紅要人來看),不是缺陷;但改動本體時要知道它會擋。
  IF pg_catalog.strpos(v_src, 'jsonb_agg( pg_catalog.jsonb_build_object(') = 0 THEN
    RAISE EXCEPTION '#15-B1 碼錨:jsonb_build_object 不是 jsonb_agg 的直接引數 '
                    '⇒ 逐鍵組的欄位白名單沒有真的套在聚合輸入上'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_build_object_required';
  END IF;
  IF pg_catalog.strpos(v_src, 'jsonb_agg(p)') > 0
     OR pg_catalog.strpos(v_src, 'jsonb_agg( p )') > 0 THEN
    RAISE EXCEPTION '#15-B1 碼錨:jsonb_agg(p) 整列聚合 ⇒ 未來新增的欄位會自動外流'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_15b1_no_whole_row_agg';
  END IF;
END
$gate$;

COMMIT;

-- ── 回滾(需要時手動;本片可逆、純新增)──────────────────────────────────────
-- 🔴 要包成單一交易,不要逐句貼(`psql -f` 是 autocommit、無 ON_ERROR_STOP)。
--
-- BEGIN;
--   DROP FUNCTION IF EXISTS public.admin_list_order_payments(uuid);
-- COMMIT;
--
-- ⚠️ 回滾後 B2 的列表會整條壞掉(讀不到任何列)⇒ **應用層不得先於本片上線**
--    (memory `feedback_app-layer-must-not-ship-before-migration-apply`;B2 收割押在本片 apply 之後)。
