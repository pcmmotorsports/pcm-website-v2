-- ============================================================
-- M-4b E10 第 2 批 B2 · W1:五支出貨 writer RPC 的**骨架 + ACL**
-- ============================================================
-- 片級 plan = `docs/specs/2026-08-07-e10-b2-shipping-writer-rpc-plan-draft.md`(**v4.2 已定稿**)§2 W1 列。
-- 驗收 harness = `scripts/w1-verify.sh`。
-- 🔴 **三綠對本片同樣是「空跑的綠」**(W0b code review 實查):`pnpm lint` / `typecheck` **不吃 `.sql`**。
--    本片的正確性證據**只有** `scripts/w1-verify.sh` 的實跑。**不得拿三綠當背書。**
--
-- ══ 本片交付什麼 ═════════════════════════════════════════════
--   ① 五支 RPC 的**最終簽章** + `SECURITY DEFINER` + `search_path=''` + `lock_timeout`
--   ② **隔離閘**(P2B02;**五支逐支都有,且五支逐支都被驗**——
--      首版只驗了一支而檔頭寫「每支都有」,對抗審查 F3 指出那是字面 vs 事實 ⇒ harness 已補到逐支)
--   ③ **ACL**:五支 REVOKE PUBLIC/anon/authenticated/authenticator + GRANT service_role
--   ④ **產號來源的裁定與前置閘**:重用 N3a 的 `public.pcm_generate_display_id()`,本片零產號程式碼
--   ⑤ **一個**專屬錯誤碼寫死並可觀察:`P2B20`(骨架未實作 / 前置閘失敗)
--      🔴 `P2B21`(產號重試耗盡)**只是保留字、本片零實作** —— 它要跟迴圈一起落在 W3。
--         (首版檔頭寫「兩個錯誤碼寫死」,對抗審查 F8 指出 P2B21 只在註解裡 ⇒ 已更正字面。)
--
-- ══ 🔴 本片**刻意不含**(每一項都有承接者)═════════════════════
--   · 冪等層(鍵表讀寫 / payload_hash 比對 / 重放)          = **W2**
--   · 建箱・掛品項・出貨的業務邏輯                          = **W3**
--   · 作廢・unvoid 與 M4 順序前緣守門                       = **W3c**
--   · **產號重試迴圈本身**(它要包住 INSERT 才觀察得到撞號)= **W3**
--     ⇒ 本片只交付**前置閘**;迴圈上界 5、23505 分派、耗盡碼 P2B21 的設計在 plan §1d,
--       W3 照那節實作。**本片沒有交付迴圈也沒有交付耗盡碼,不得讀成「產號重試已完成」。**
--   · 多品項取鎖序 + 禁批次行為層守門(`GET DIAGNOSTICS ROW_COUNT`)= **W4**
--
-- ══ 🔴 **對定稿 plan v4.2 的偏離申報**(code review F4;鐵則 11 要求偏離要寫明)═══
--   plan §8 N4 逐字:「W0 改定位為設計節 + **W1 的一部分**,artifact =
--   『產號重試迴圈 + 23505 分派 + 耗盡碼』**三件**」;§2a DAG 表亦寫「含原 W0 產號重試(併入本片)」。
--   **本片只交付其中零件**:重用裁定 + 前置閘。三件都推到 W3。
--   🔴 理由(開工後才看清、plan 寫的時候沒有):**重試迴圈必須包住 INSERT 才觀察得到撞號**,
--      23505 分派與耗盡碼都只在那個迴圈裡才有意義 ⇒ 放在 W1 只能寫成不可驗的散文。
--   🔴 **這是偏離,不是既定分工** —— 首版檔頭把它寫得像後者,code review F4 指出。
--      W3 開工時必須把這三件當**本線既有欠款**處理,不是新需求。
--
-- ══ 🔴 骨架 = **fail-closed**,不是空殼 ═══════════════════════
--   五支的 body 目前只有兩步:**隔離閘 → 未實作 RAISE(P2B20)**。
--   ⇒ 本片上線後,任何呼叫都**必定拋錯**,不存在「靜默成功但什麼都沒做」的窗口。
--   🔴 順序刻意是「閘在前」:這讓隔離閘**現在就有可觀察行為**
--      (RR 下拋 P2B02、RC 下拋 P2B20)⇒ 它不是等 W3 才生效的死條文。
--
-- ══ 🔴 簽章對 A8a1/A8a2 慣例的**一處刻意分歧**(Q1=A 照那套,此處說明為何不照)═══
--   a8a2 的 `p_idempotency_key` 是 **`uuid`**;本片五支用 **`text`**。
--   理由:W0b 的鍵欄是 `text`,且帶 `key_not_blank`(非空白 + `length <= 200`)兩條 CHECK。
--   若簽章收 `uuid`,那兩條 CHECK 在 **RPC 邊界上恆真**(uuid::text 永遠 36 字元、永不空白)
--   ⇒ 等於我在 W0b 寫了兩條對主要入口沒有判別力的守門。
--   🔴 **代價要說清楚**:`text` 讓呼叫端可以傳任意字串 ⇒ **鍵的唯一性責任落在呼叫端(W8)**。
--      W8 的契約必須明寫產生方式;本片不假裝 DB 層能保證它。
--
-- 內容分級:RPC 非內容,不適用 L1/L2/L3。
-- ============================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- ── 1. 🔴 產號:**不自寫,重用 N3a 的 `public.pcm_generate_display_id()`** ──
-- 🔴 **這是修正**:本片首版自己寫了一支 `pcm_b2_gen_shipment_reference()`,用 `random()`。
--    對抗審查打掉,兩個理由都成立且我事前查得到:
--    ① plan §7 F2 **早就裁定**「N3a 產的是固定 6 碼、同一個 28 字母表,與 CHECK **逐字相符**,**可直接用**」
--       —— 我沒重讀自己 plan 的折入帳就動手。
--    ② N3a 的 COMMENT(`20260730120000:124`)逐字寫著亂數源必須是 pgcrypto `gen_random_bytes`、
--       **禁 `random()`**,理由是「否則客人可預測他人單號」。審查實測 `setseed` 可重現我那版的輸出序列。
--    ⇒ 本片**零產號程式碼**。單號由 `public.pcm_generate_display_id()` 產,W3 的重試迴圈呼叫它。
--
-- 🔴 **前置閘(照 N3a 自己的形狀:破壞性動作之前,不是之後)**:
--    本片的五支骨架將來要靠那支產號。它若不在,現在就要紅,不要等 W3 在正式站才發現。
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pcm_generate_display_id()') IS NULL THEN
    RAISE EXCEPTION 'W1 前置閘失敗 — public.pcm_generate_display_id() 解析不到。'
      '本片與 W3 的出貨單號產號依賴它(plan §7 F2 裁定重用,不自寫)。'
      USING ERRCODE = 'P2B20';
  END IF;
END
$$;

-- 🔴 **跨域耦合的誠實邊界**:重用 N3a 等於把「訂單編號格式」與「出貨單號格式」綁在一起。
--    目前兩者的 CHECK 逐字相同(`20260805170000:99` vs `20260730120000` 的合約),
--    但**沒有任何東西保證它們永遠相同** —— 這條由 `scripts/w1-verify.sh` 的
--    `W1-GEN-MATCHES-SHIPMENTS` 格守:它把正規式**從 s1a1 檔抽出來**(不手抄),
--    再拿 N3a 實際產出的碼去比。兩邊哪天分岔,那一格會紅。

-- ── 2. 五支 writer 骨架 ──────────────────────────────────────
-- 🔴 五支的**動作名**與 W0b 鍵表 `pcm_b2_shipping_idem_action_known` 的五個值同源:
--      admin_create_shipment      ↔ 'create_shipment'
--      admin_add_shipment_items   ↔ 'add_items'
--      admin_mark_shipment_shipped↔ 'ship'
--      admin_void_shipment        ↔ 'void'
--      admin_unvoid_shipment      ↔ 'unvoid'
--    這個對應由 `scripts/w1-verify.sh` 的 `W1-ACTION-MAP` 格釘住 —— 兩邊字面漂了會紅。
--    🔴 權威來源是 **W7c 的凍結集合**(plan §2a);本檔與 W0b 的 CHECK 都由它對帳,不各寫各的。

CREATE FUNCTION public.admin_create_shipment(
  p_idempotency_key   text,
  p_customer_user_id  uuid,
  p_recipient_snapshot jsonb,
  p_carrier_code      text,
  p_carrier_note      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_create_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  RAISE EXCEPTION 'admin_create_shipment:W1 骨架,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE FUNCTION public.admin_add_shipment_items(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_items           jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_add_shipment_items:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  RAISE EXCEPTION 'admin_add_shipment_items:W1 骨架,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE FUNCTION public.admin_mark_shipment_shipped(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_tracking_number text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_mark_shipment_shipped:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  RAISE EXCEPTION 'admin_mark_shipment_shipped:W1 骨架,業務層尚未實作(W3)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE FUNCTION public.admin_void_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid,
  p_void_reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_void_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  RAISE EXCEPTION 'admin_void_shipment:W1 骨架,業務層尚未實作(W3c)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

CREATE FUNCTION public.admin_unvoid_shipment(
  p_idempotency_key text,
  p_shipment_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET lock_timeout = '5s'
AS $fn$
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_unvoid_shipment:需在 READ COMMITTED 下執行(現為 %)', pg_catalog.current_setting('transaction_isolation')
      USING ERRCODE = 'P2B02', CONSTRAINT = 'pcm_b2_w1_isolation_rc';
  END IF;
  RAISE EXCEPTION 'admin_unvoid_shipment:W1 骨架,業務層尚未實作(W3c)'
    USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w1_not_implemented';
END
$fn$;

-- ── 3. ACL ───────────────────────────────────────────────────
-- 🔴 `authenticator` 一併列入(W0b 對抗審查 F6 立的清單形狀,五支照同一份)。
-- 🔴 **新函式的 service_role EXECUTE 是預設就有的**(memory
--    `reference_supabase-service-role-execute-default-grant`)⇒ 先 REVOKE 再顯式 GRANT,
--    不得只寫 GRANT 就當作「權限是我給的」。
REVOKE ALL ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb) FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_add_shipment_items(text, uuid, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_mark_shipment_shipped(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_void_shipment(text, uuid, text) FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_void_shipment(text, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.admin_unvoid_shipment(text, uuid) FROM PUBLIC, anon, authenticated, authenticator, service_role;
GRANT EXECUTE ON FUNCTION public.admin_unvoid_shipment(text, uuid) TO service_role;

-- 🔴 對抗審查 F11:五支是 `SECURITY DEFINER` ⇒ **執行身分 = owner**。
--    不釘 owner 等於把提權面交給「當下的部署身分」。repo 既有慣例(N3a / a9b2-s2 等)照釘。
ALTER FUNCTION public.admin_create_shipment(text, uuid, jsonb, text, text) OWNER TO postgres;
ALTER FUNCTION public.admin_add_shipment_items(text, uuid, jsonb)          OWNER TO postgres;
ALTER FUNCTION public.admin_mark_shipment_shipped(text, uuid, text)        OWNER TO postgres;
ALTER FUNCTION public.admin_void_shipment(text, uuid, text)                OWNER TO postgres;
ALTER FUNCTION public.admin_unvoid_shipment(text, uuid)                    OWNER TO postgres;

-- ── 4. 🔴 檔內 fail-closed 權限矩陣斷言(對抗審查 F6)──────────
-- 為什麼要寫在 migration 裡、而不是只留給 harness:
--   harness 跑在**裸 PG**,它的 ACL 格**證不了正式站**(harness 檔頭自陳)。
--   ⇒ 正式站唯一會在 apply 當下說話的,就是這一段。
--   memory `reference_supabase-service-role-execute-default-grant` 的通用守法②正是這條:
--   **新函式的 service_role EXECUTE 是預設就有的**,只寫 GRANT 不足以證明權限是我給的。
-- 🔴 這段**必須 fail-closed**:任一支不符就整個 migration 回滾,不留半套權限。
DO $$
DECLARE
  r record;
  v_bad text := '';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('admin_create_shipment','admin_add_shipment_items',
                        'admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')
  LOOP
    -- ① 三個對外角色一律不得有 EXECUTE(點名軸)
    IF pg_catalog.has_function_privilege('anon', r.sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', r.sig, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticator', r.sig, 'EXECUTE') THEN
      v_bad := v_bad || r.sig || '(對外角色仍可執行) ';
    END IF;
    -- ② service_role 必須有(否則 W8 呼不到,是另一種壞法)
    IF NOT pg_catalog.has_function_privilege('service_role', r.sig, 'EXECUTE') THEN
      v_bad := v_bad || r.sig || '(service_role 沒拿到 EXECUTE) ';
    END IF;
    -- ③ 🔴 集合軸:非 owner 的 grantee 必須**恰好只有 service_role**。
    --    點名軸只驗你點到的名字;**第五個意外角色只有集合比對抓得到**(W0b n-1 實測)。
    --    🔴 這裡**不得 join pg_roles** —— 它會靜默丟掉 PUBLIC(grantee=0)那列(已實測)。
    IF (SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
         WHERE p.oid = r.sig::regprocedure
           AND a.grantee <> p.proowner
           AND a.grantee <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')) > 0 THEN
      v_bad := v_bad || r.sig || '(有非預期角色在 ACL 裡) ';
    END IF;
  END LOOP;

  -- 🔴 也要驗「五支都在」——上面的迴圈若一支都沒跑到,前面每個 IF 都不會執行 ⇒ 恆真。
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.proname IN ('admin_create_shipment','admin_add_shipment_items',
                           'admin_mark_shipment_shipped','admin_void_shipment','admin_unvoid_shipment')) <> 5 THEN
    RAISE EXCEPTION 'W1 權限矩陣斷言:五支 RPC 不齊(迴圈跑不到就等於沒驗)' USING ERRCODE = 'P2B20';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'W1 權限矩陣斷言失敗:%', v_bad USING ERRCODE = 'P2B20';
  END IF;
  RAISE NOTICE 'W1 權限矩陣斷言通過:五支 × (三對外角色無 EXECUTE + service_role 有 + 集合恰為 service_role)';
END
$$;

COMMIT;
