-- ============================================================
-- L5b-2 片 2f — admin_initiate_order_refund 加入序列化點與跨帳本否決
-- plan = docs/specs/2026-08-12-l5b2-2f-initiate-advisory-plan.md(**權威版以該檔檔頭版號為準**;
--        這裡刻意不複寫版號 —— 每折一輪就要同步三個檔的版號,那是週期性的字面漂移來源;
--        關卡1 三輪 48 條 + diff 層 R1 兩輪(29 → v6、33 → v7)+ diff 層 R2 換模型輪(19 → v8)已折)
-- 母 plan = docs/specs/2026-08-10-l5b-2-compensation-writer-plan.md(v8)§2 片表 :577
--
-- 做三件事:
--   A. 步 2 之後、步 3 之前取 order 級 advisory(三方共用序列化點;鍵式子與 2e 逐字相同)
--   B. 步 6 之後、步 7 之前加 payment_refunds 在途否決(複用 REFUND_IN_FLIGHT,不新增第 9 碼)
--   C. 函式層 SET lock_timeout = '10s'(Sean Q-2f-1;放子句不放 body)
--
-- 🔴 Sean 拍板(2026-08-12):
--   Q-2f-1  = lock_timeout 10 秒(母 plan 建議 3s;3s 無量測依據且本支是員工日常路徑)
--   Q-2f-2  = B 放行(**已受理即不算在途**;複判維持)⇒ 述詞排除 result_success
--   Q-超退閘 = 做,獨立片排 2g 前(backlog #445;知情推翻拍板⑤)
--
-- 🔴 依賴(缺任一 ⇒ 前置閘整片回滾):
--   2e = 20260812160000(已 apply;成組閘釘它的 post-image)
--   2d = 20260811110000(已 apply;terminal 集合 = result_confirmed/result_failed/manual)
--   沖銷片 = 20260812140000(已 apply;交付 canonical view payment_refund_effective_terminal)
--
-- ⛔ apply 紀律(R3 F5 —— 包了 BEGIN 還是逃得掉):
--   本檔**只准** `supabase db push`,或 `psql -f <檔> -v ON_ERROR_STOP=1`。
--   **禁止**互動式 `\i`、**禁止**逐句貼進 SQL Editor ——
--   psqlrc 若開 ON_ERROR_ROLLBACK,RAISE 只回滾那一句,而 CREATE OR REPLACE 已經落地
--   ⇒ 守門邏輯完好、但沒有後果。那兩條路上本檔的所有前置閘都不存在。
--
-- ⛔ apply 停點要對 Sean 講兩句(plan §13-19,不是只寫在文件裡):
--   ① lock_timeout 逾時目前是**無名失敗**:員工只看到 generic 訊息、值班在 log 裡分不出是等鎖太久
--      還是別的錯(具名診斷要到後片才有)。
--   ② 超退防線:Q-2f-2=B 之後 **TapPay 是唯一防線**,而它①只有 sandbox 實證
--      ②partial 路徑根本不查帳(v_frozen := p_amount)⇒ 本片**不宣稱任何本地超退防護**(→ #445)。
--
-- Rollback = scripts/l5b2-2f-rollback.sql(單一交易腳本;**禁止只抄座標逐句手跑** —— 那條路上
--   「2g writer 在庫則 abort」的成組回退閘不存在)。
--
-- 誠實邊界(plan §9 逐條;commit body 同步):
--   1. 否決條件**現在恆假** —— payment_refunds 尚無 writer(2g 未建)⇒ apply 後行為零變化。
--      harness 的相關格驗的都是直接 INSERT 造出來的資料,不是跑真流程長出來的。
--   2. advisory 隨交易釋放的前提 = **單語句交易**。唯一呼叫點
--      apps/admin/src/lib/payment/refund-repository.ts:195 走 PostgREST 單一 RPC ⇒ 成立;
--      但那是**時點觀察不是禁止**,函式內看不到自己被誰包著 ⇒ 做不成守門,只寫進 COMMENT。
--   3. order 尺度會擋到同單其他 attempt 的在途補償(fail-closed 方向)。
--   4. 卡住的補償退款**沒有機制保證會到終局**;Q-2f-2=B 之後它從「永久擋單」變成
--      **永久隱形**(不擋也不顯示)⇒ backlog #442(2g 硬前置)。
--   5. payment_charge_attempts.order_id **無 immutable 守門** ⇒ 尺度會靜默漂移(#444;與 2e 共用假設)。
--   6. 員工看到的 REFUND_IN_FLIGHT 文案承諾「30 分鐘沒完成會進異常清單」,而異常清單只讀
--      order_refunds ⇒ 阻擋源是新那半時**永遠不會兌現**(#443,2g 硬前置)。
--   7. 見上「apply 停點」②。
--   8. 本檔釘的 md5 全部是**實作日量的**,不轉抄(算法與量法見各 PIN 上方註解)。
--   9. lock_timeout 逾時無具名診斷(同上①)。
-- ============================================================

BEGIN;

-- migration 執行期的保險(與函式層那個 10s 是兩回事:前者管「這支 migration 卡住時自己放手」)
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL transaction_timeout = '120s';

-- ══ 0. pre-image 快照 ═══════════════════════════════════════════════════════
-- 🔴 屬性保留不靠「我記得現況是什麼」:先把 pre-image 存下來,REPLACE 之後逐欄比自己。
--    CREATE OR REPLACE 是**整份宣告重寫**,凡是沒寫的子句一律回 PG 預設
--    (proconfig→NULL / prosecdef→false / provolatile→v / proisstrict→false /
--     proparallel→u / proleakproof→false / procost→100 / prorows→1000)。
CREATE TEMP TABLE _l5b2_2f_preimage ON COMMIT DROP AS
SELECT md5(p.prosrc)                       AS src_md5,
       p.prosecdef, p.provolatile, p.proisstrict, p.proparallel,
       p.proleakproof, p.procost, p.prorows,
       p.proconfig::text                   AS proconfig,
       p.proacl::text                      AS proacl,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       md5(pg_catalog.obj_description(p.oid, 'pg_proc')) AS comment_md5,
       pg_catalog.obj_description(p.oid, 'pg_proc')      AS comment_full
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'admin_initiate_order_refund'
   AND pg_catalog.pg_get_function_identity_arguments(p.oid)
       = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';

-- ══ 1. 前置閘 P1-P8(任一不符 ⇒ 整片回滾)═══════════════════════════════════
DO $pre_2f$
DECLARE
  -- ── PIN 值(算法一律 md5;量法寫在各行右側)──────────────────────────────
  -- P1:2e 的 post-image prosrc md5。來源 = 正式庫 apply 當下 NOTICE 逐字(P-578-A §1)。
  c_2e_post_md5   constant text := 'f4e3aa5b5afb9e886b0b2820a4c4b34b';
  -- P2:② 的 pre-image prosrc md5。量法 = scripts/l5b2-2f-verify.sh pins(臨時叢集套 repo migrations
  --     後 SELECT md5(prosrc));出處是 repo —— 全 repo 只有 20260803150000 定義它、無任何 ALTER FUNCTION。
  c_pre_md5       constant text := 'f98e25f58dde8306772e157f0c7cc5cb';
  -- P4:canonical view 的 md5(pg_get_viewdef(...))。
  --     🔴 **必須在正式庫量**:pg_get_viewdef 回的是 PG 正規化重寫後的文字、隨版本變,
  --     本機值拿來釘正式庫會假性失敗。量法逐字:
  --       SELECT md5(pg_get_viewdef('public.payment_refund_effective_terminal'));
  --     量測來源 = Sean 於正式庫 SQL Editor 親跑(2026-08-12),server_version = **17.6**。
  --     🔴 若你在別的 PG 版本上重量而值不合,**那不必然是漂移** —— 先確認版本再下結論
  --        (本機 17.10 Homebrew 實測與 17.6 同值,但這是觀察、不是保證)。
  c_viewdef_md5   constant text := 'd20e9c8e9702d4b9b975105b91e051d1';
  -- P6:狀態機函式 prosrc md5(同 P2,repo 出處)。
  c_sm_md5        constant text := 'c97ed6ce3ae502e357994cb445621dcc';
  -- P8:② 現行 COMMENT 全文 md5(同 P2,repo 出處)。
  c_comment_md5   constant text := '9656887fa0b2032d03ac0e39fa2fac8d';

  v_txt   text;
  v_arr   text[];
  v_n     integer;
  v_ok    boolean;
BEGIN
  -- ── PIN 未填即停(不可能靜默通過)──────────────────────────────────────
  IF c_pre_md5 LIKE '@@%' OR c_viewdef_md5 LIKE '@@%'
     OR c_sm_md5 LIKE '@@%' OR c_comment_md5 LIKE '@@%' THEN
    RAISE EXCEPTION '2f 前置閘:PIN 值尚未填入(仍是佔位符)⇒ 拒繼續。'
                    '量法見各 PIN 上方註解;P4 那顆**必須在正式庫量**。'
      USING ERRCODE = 'P2F00', CONSTRAINT = 'l5b2_2f_pins_required';
  END IF;

  -- ── P1. 成組閘:2e 必須在庫且未被動過(母 plan :718)────────────────────
  --    🔴 只釘 prosrc 不夠:ALTER FUNCTION 可以拿掉 lock_timeout / SECDEF / 改 ACL 而不動 prosrc。
  --    🔴 P1/P1b/P1c 三道都用 `proname = 'close_released_attempt'` 定位、沒有限定簽章
  --       ⇒ 同名多載存在時 `SELECT INTO` 拿到的是**任意一顆**(plpgsql 取第一列、不報錯)。
  --       多載一顆走樣的 2e 進來,三道有機會全部量到「正確的那顆」而放行。
  --       ⇒ 先證這個名字**恰好一顆**,後面三道的定位才成立(這是那三道的共同前提,只寫一次)。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '2f 前置閘 P1-0:public.close_released_attempt 有 % 顆同名函式(必須恰好 1)⇒ '
                    'P1/P1b/P1c 的定位不帶簽章,多載之下量到的是任意一顆,守門結論不可信,拒繼續', v_n
      USING ERRCODE = 'P2F01', CONSTRAINT = 'l5b2_2f_2e_overloaded';
  END IF;

  SELECT md5(p.prosrc) INTO v_txt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
  IF v_txt IS DISTINCT FROM c_2e_post_md5 THEN
    RAISE EXCEPTION '2f 前置閘 P1:2e(close_released_attempt)的 prosrc md5 = % ,期望 % '
                    '⇒ 2e 未上或已被改。2e/2f/2g 成組,缺任一支後面那支自己整片回滾(母 plan §2b)。',
                    COALESCE(v_txt, '<不存在>'), c_2e_post_md5
      USING ERRCODE = 'P2F01', CONSTRAINT = 'l5b2_2f_2e_postimage_required';
  END IF;

  -- 🔴 只找「設定名稱在不在」等於沒驗(R1v6 MF):把 2e 的 lock_timeout ALTER 成 `0`
  --    (=無限等,本組要消掉的死結面整個回來)、或把 search_path 換成別的路徑,
  --    名稱照樣在 ⇒ 舊形狀 LIKE '%lock_timeout%' 全綠。改成**逐值比對 + 集合大小**:
  --    多一個會改行為的設定(例如 statement_timeout)也要擋,所以 cardinality 一起釘。
  --    期望值出處 = 2e 自己的 migration 檔面 20260812160000:175-177
  --      SECURITY DEFINER / SET search_path = '' / SET lock_timeout = '3s'。
  --    ⚠️ 2e=3s 而 2f=10s 是 Sean Q-2f-1 的已知結果(三方不再同值),不是漂移。
  SELECT p.prosecdef
         AND p.proconfig IS NOT NULL
         AND pg_catalog.cardinality(p.proconfig) = 2
         -- 🔴 逐字 = `search_path=""`,不是 `search_path=`:PG 把空字串的 GUC 值存成一對雙引號。
         --    量法(本機臨時叢集實跑,2026-08-13):第一版寫 `search_path=` 當場被這道自己擋下,
         --    訊息印出現況 proconfig = {"search_path=\"\"",lock_timeout=3s} ⇒ 元素本體是 search_path=""。
         AND 'search_path=""' = ANY (p.proconfig)
         AND 'lock_timeout=3s' = ANY (p.proconfig)
    INTO v_ok
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
  IF NOT COALESCE(v_ok, false) THEN
    SELECT pg_catalog.format('prosecdef=%s proconfig=%s',
                             p.prosecdef::text, COALESCE(p.proconfig::text, '<null>'))
      INTO v_txt
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
    RAISE EXCEPTION '2f 前置閘 P1b:2e 的函式層設定不是逐值相符的 '
                    '{SECDEF, search_path="", lock_timeout=3s}(現況 %)'
                    '⇒ 有人 ALTER 過 2e 的設定(prosrc 一字未動、P1 看不到)。'
                    '🔴 特別是 lock_timeout=0 = 無限等 —— 那正是本組要消掉的死結面,拒繼續',
                    COALESCE(v_txt, '<2e 不存在>')
      USING ERRCODE = 'P2F01', CONSTRAINT = 'l5b2_2f_2e_attributes_required';
  END IF;

  -- 2e 的 EXECUTE 權限面:除 owner 外不得有人拿得到。
  --   🔴 不用「列舉四個角色各查一次」(R1 B):那是**抽樣**,第五個角色被授權時全綠。
  --      改成從 proacl 反向展開、比對**整個授權集合** —— 這才是全稱句。
  --   🔴 proacl IS NULL 必須當成失敗:函式的預設 ACL 是「PUBLIC 可 EXECUTE」,
  --      NULL 代表從沒動過權限 = 全世界都能執行,不是「沒有人有權限」。
  SELECT p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner)
    INTO v_ok
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
  IF COALESCE(v_ok, true) THEN
    SELECT COALESCE(p.proacl::text, '<null=PUBLIC 可執行>') INTO v_txt
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
    RAISE EXCEPTION '2f 前置閘 P1c:2e 的 EXECUTE 授權集合不是「僅 owner」(現況 acl = %)⇒ 拒繼續', v_txt
      USING ERRCODE = 'P2F01', CONSTRAINT = 'l5b2_2f_2e_acl_owner_only';
  END IF;

  -- ── P2. ② 的底稿沒漂移 ────────────────────────────────────────────────
  SELECT src_md5 INTO v_txt FROM _l5b2_2f_preimage;
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '2f 前置閘 P2:找不到 admin_initiate_order_refund(8 參數簽章)⇒ 拒繼續'
      USING ERRCODE = 'P2F02', CONSTRAINT = 'l5b2_2f_target_required';
  END IF;
  IF v_txt <> c_pre_md5 THEN
    RAISE EXCEPTION '2f 前置閘 P2:② 的 pre-image prosrc md5 = % ,期望 % '
                    '⇒ 正式庫與本片所依據的 repo 底稿不一致,拒繼續(不要硬改 PIN,先查誰動了它)',
                    v_txt, c_pre_md5
      USING ERRCODE = 'P2F02', CONSTRAINT = 'l5b2_2f_preimage_mismatch';
  END IF;

  -- ── P3. 現況屬性符合本片的預期起點(post-assert 會逐欄比 pre-image)────
  SELECT prosecdef AND proconfig = '{"search_path=public, pg_temp"}' INTO v_ok
    FROM _l5b2_2f_preimage;
  IF NOT COALESCE(v_ok, false) THEN
    SELECT format('prosecdef=%s proconfig=%s', prosecdef, COALESCE(proconfig, '<null>'))
      INTO v_txt FROM _l5b2_2f_preimage;
    RAISE EXCEPTION '2f 前置閘 P3:② 的起點屬性不符預期(%);'
                    '本片假設它是 SECDEF 且 proconfig 只有 search_path=public, pg_temp', v_txt
      USING ERRCODE = 'P2F03', CONSTRAINT = 'l5b2_2f_preimage_attrs';
  END IF;

  -- P3b. ② 的 EXECUTE 授權集合 = 恰好 {owner, service_role}(Sean 裁 Q-P591-1 = A)
  --   🔴 後置③ 只證「apply 前後 proacl 沒變」= 相對條件:既有的誤授會被**原樣保留且全綠**。
  --      這裡改成比對**期望集合**的絕對條件 ⇒ 誤授擋在 apply 前,而不是上線後才發現。
  --      ⚠️ 這道翻紅代表正式庫的授權現況與預期不符 —— **不要為了讓 apply 過而去改授權**,
  --         停下來回報,由 Sean 拍板(P 十代與主視窗 2026-08-12 明文約定)。
  --   COMMENT 已宣告「EXECUTE 僅 service_role」;owner 恆有 ⇒ 期望集合就是這兩個。
  SELECT p.proacl IS NULL
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.privilege_type = 'EXECUTE'
                       AND a.grantee <> p.proowner
                       AND a.grantee <> (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role'))
         OR NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE a.privilege_type = 'EXECUTE'
                           AND a.grantee = (SELECT r.oid FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role'))
         -- 🔴 集合相等還不夠(R1v6 IMP):service_role 若是 **WITH GRANT OPTION** 拿到 EXECUTE,
         --    現在的集合仍然「恰好是 {owner, service_role}」,但它自己就能把 EXECUTE 轉授出去
         --    ⇒ 這道守的不變量隨時可以被非 owner 的人打破,而 apply 當下量不到。
         --    可轉授 = 期望之外的能力 ⇒ 一律擋。
         OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                     WHERE a.privilege_type = 'EXECUTE'
                       AND a.grantee <> p.proowner
                       AND a.is_grantable)
    INTO v_ok
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';
  IF COALESCE(v_ok, true) THEN
    SELECT COALESCE(proacl, '<null=PUBLIC 可執行>') INTO v_txt FROM _l5b2_2f_preimage;
    RAISE EXCEPTION '2f 前置閘 P3b:② 的 EXECUTE 授權集合不是恰好 {owner, service_role}(現況 acl = %)'
                    '⇒ 拒繼續。**不要改授權讓它過** —— 停下來回報,由 Sean 裁定。', v_txt
      USING ERRCODE = 'P2F03', CONSTRAINT = 'l5b2_2f_preimage_acl_set';
  END IF;

  -- ── P4. canonical view 的**語意**沒被換掉 ──────────────────────────────
  --    🔴 不是存在性檢查:view 若被 CREATE OR REPLACE 成「每列都算終局」,
  --    存在性照過而否決條件恆假(無聲失效)。釘定義本身才擋得住。
  --    ⚠️ view 不存在的失效模式是 42P01 fail-loud,不是恆假 —— 兩者要分清楚。
  SELECT md5(pg_catalog.pg_get_viewdef('public.payment_refund_effective_terminal')) INTO v_txt;
  IF v_txt IS DISTINCT FROM c_viewdef_md5 THEN
    RAISE EXCEPTION '2f 前置閘 P4:canonical view 的定義 md5 = % ,期望 % '
                    '⇒ 它被改過。本片的否決條件整個建立在它的語意上,拒繼續。',
                    COALESCE(v_txt, '<不存在>'), c_viewdef_md5
      USING ERRCODE = 'P2F04', CONSTRAINT = 'l5b2_2f_viewdef_pinned';
  END IF;

  -- P4b. viewdef 只涵蓋「SELECT 寫了什麼」,**不含 security_invoker**(R1 B)。
  --   🔴 這顆的失效是無聲的:本函式是 SECDEF、以 owner 身分執行。
  --      security_invoker 若被關掉,view 改以 view owner 身分讀底表,RLS 適用對象整個換人
  --      ⇒ 終局判定看到的列集合變了,而 viewdef 一字未改、md5 照樣相符。
  --   ⚠️ owner 與 relacl 刻意不釘:它們被改動的失效模式是「讀不到 ⇒ 42501 fail-loud」,
  --      不是無聲改語意;跨庫 owner 名稱也不同,釘了只會製造假性漂移。
  --   🔴 不比 'security_invoker=true' 這個**單一字面**:reloptions 存的是設定當下的寫法,
  --      `SET (security_invoker = on)` 之類的合法等價寫法會存成別的字面 ⇒ 單一字面比對會**誤擋**
  --      合法狀態(fail-closed 但擋錯人,災難當天最難查)。改成取出該鍵的值再判布林真值。
  SELECT lower(COALESCE(
           (SELECT pg_catalog.split_part(o, '=', 2)
              FROM pg_catalog.unnest(COALESCE(cl.reloptions, ARRAY[]::text[])) o
             WHERE pg_catalog.split_part(o, '=', 1) = 'security_invoker'
             LIMIT 1), '')) IN ('true', 'on', '1', 'yes', 't', 'y')
    INTO v_ok
    FROM pg_catalog.pg_class cl JOIN pg_catalog.pg_namespace n ON n.oid = cl.relnamespace
   WHERE n.nspname = 'public' AND cl.relname = 'payment_refund_effective_terminal';
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION '2f 前置閘 P4b:canonical view 沒有 security_invoker=true '
                    '⇒ 它會以 view owner 身分讀底表、RLS 適用對象改變,終局判定的列集合可能靜默變動,拒繼續'
      USING ERRCODE = 'P2F04', CONSTRAINT = 'l5b2_2f_viewdef_security_invoker';
  END IF;

  -- ── P5. 三張表都沒開 FORCE RLS ────────────────────────────────────────
  --    🔴 payment_refund_events 不能漏:它才是 canonical view 判終局的資料來源,
  --    被 FORCE 住 ⇒ 已結案的退款看起來永遠沒結案 ⇒ 永久擋單。
  SELECT count(*) INTO v_n
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relforcerowsecurity
     AND c.relname IN ('payment_refunds', 'payment_charge_attempts', 'payment_refund_events');
  IF v_n > 0 THEN
    RAISE EXCEPTION '2f 前置閘 P5:payment_refunds / payment_charge_attempts / payment_refund_events '
                    '之中有 % 張開了 FORCE ROW LEVEL SECURITY ⇒ 本函式(SECDEF)可能讀不到全部列,'
                    '否決條件會漏擋或誤擋,拒繼續', v_n
      USING ERRCODE = 'P2F05', CONSTRAINT = 'l5b2_2f_no_force_rls';
  END IF;

  -- P5b. 「沒開 FORCE」只有在**本函式以表 owner 的身分執行**時才等於「讀得到全部列」(R1v6 IMP)。
  --   本函式是 SECDEF ⇒ 執行身分 = 它自己的 owner。那個 owner 若既不是這三張表的 owner、
  --   又沒有 BYPASSRLS,RLS policy 對它照樣生效 ⇒ 終局/在途判定看到的是**被裁切過的列集合**,
  --   而 P5 一路全綠。這在換庫(正式 vs 臨時叢集 owner 不同)時最容易發生。
  --   ⚠️ 只要求「owner 相同」或「有 BYPASSRLS」二者之一 —— 兩者都足以讓非 FORCE 的 RLS 不裁列。
  SELECT NOT EXISTS (
           SELECT 1
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace cn ON cn.oid = c.relnamespace
            WHERE cn.nspname = 'public'
              AND c.relname IN ('payment_refunds', 'payment_charge_attempts', 'payment_refund_events')
              AND c.relrowsecurity
              AND c.relowner <> f.proowner
              AND NOT COALESCE((SELECT r.rolbypassrls FROM pg_catalog.pg_roles r WHERE r.oid = f.proowner), false))
    INTO v_ok
    FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace fn ON fn.oid = f.pronamespace
   WHERE fn.nspname = 'public' AND f.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(f.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';
  IF NOT COALESCE(v_ok, false) THEN
    SELECT pg_catalog.string_agg(cn.nspname || '.' || c.relname || '(owner=' ||
                                 pg_catalog.pg_get_userbyid(c.relowner) || ')', ', ')
      INTO v_txt
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace cn ON cn.oid = c.relnamespace
     WHERE cn.nspname = 'public'
       AND c.relname IN ('payment_refunds', 'payment_charge_attempts', 'payment_refund_events')
       AND c.relrowsecurity;
    RAISE EXCEPTION '2f 前置閘 P5b:本函式(SECDEF)的執行身分 = 它的 owner(%),而該角色既不是這幾張'
                    '開了 RLS 的表的 owner、也沒有 BYPASSRLS ⇒ policy 會裁掉列,'
                    '在途/終局判定會**漏擋**而且完全無症狀。相關表 = %。拒繼續',
                    (SELECT owner FROM _l5b2_2f_preimage), COALESCE(v_txt, '<無>')
      USING ERRCODE = 'P2F05', CONSTRAINT = 'l5b2_2f_secdef_owner_rls_reach';
  END IF;

  -- ── P6. order_refunds 的終局語意還是本片 COMMENT 寫的那個 ──────────────
  --    值域 CHECK 只管「能填哪些值」,**管不到誰能轉出** ⇒ 兩道都要。
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_txt
    FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.order_refunds'::regclass AND c.conname = 'order_refunds_status_check';
  --    🔴 不用「四個 LIKE 都命中」(R1 B):那只證明**至少**有這四個,
  --       多出第五個值(例如新增 'cancelled')照樣四道全綠,而本片 COMMENT 寫死的
  --       「終局集合 = confirmed/failed/deferred」就已經過期了。改成**集合相等**。
  --    🔴 集合相等仍然只看**字面**(v7 補):把 CHECK 寫成
  --       `status <> ANY (ARRAY['processing',...])`,抽出來的四個字面一模一樣、集合照樣相等,
  --       而那條約束的意思已經整個翻面(變成「只准填這四個以外的值」)。
  --       ⇒ 運算子本身也要釘:必須是 `= ANY (ARRAY[`,且整段不得出現 `<>` / `!=`。
  --
  --    🔴🔴 **能力邊界(v7 三折;主視窗 `P-607-A` 換路裁決,不是我自己降標準)**:
  --       這一道在 R1 被 `<>` 繞過、補了運算子之後在 R2 又被 `NOT (...)` 繞過 —— **同一道守門、同型繞法第二次**。
  --       照 R4「相同錯法第 2 次 = 換路」,**這裡不再補第三個運算子變體**。
  --       原因是結構性的:本道本質是**比對 catalog 文字**,而等價寫法是開放集合
  --       (`<>`、`!=`、`NOT (...)`、`NOT (… = ANY …)`、`IN`、CASE …),補一種就有第 N+1 種。
  --       ⇒ **本道的定位改成「擋 apply 當下的明顯形狀變動」,不是「證明值域語意正確」。**
  --       語意保證移到 harness `neg` 模式的**行為探針**(N12c/N12d):在臨時叢集真的 INSERT ——
  --       該被擋的值要 23514、該過的值要成功。行為探針對所有等價寫法一視同仁,因為它驗的是行為不是文字。
  --       ⚠️ 行為探針**跑不到正式庫**(apply 當下無法寫測試資料)⇒ 兩者不互相取代:
  --          結構斷言守 apply 當下、行為探針守「語意到底對不對」。哪幾道配上了行為靶見 plan §7-11。
  IF COALESCE(v_txt, '') !~ 'status = ANY \(ARRAY\[' OR COALESCE(v_txt, '') ~ '<>|!=' THEN
    RAISE EXCEPTION '2f 前置閘 P6-op:order_refunds_status_check 的運算子不是 `= ANY (ARRAY[`,'
                    '或出現了 `<>`/`!=`(constraintdef = %)⇒ 值域語意可能已翻面,而字面集合看起來沒變,拒繼續',
                    COALESCE(v_txt, '<不存在>')
      USING ERRCODE = 'P2F06', CONSTRAINT = 'l5b2_2f_status_domain_operator';
  END IF;
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_arr
    FROM pg_catalog.regexp_matches(COALESCE(v_txt, ''), '''([a-z_]+)''::text', 'g') AS m;
  IF v_arr IS DISTINCT FROM ARRAY['confirmed', 'deferred', 'failed', 'processing'] THEN
    RAISE EXCEPTION '2f 前置閘 P6:order_refunds_status_check 的值域集合 = % ,期望恰好 '
                    '{processing, confirmed, failed, deferred}(constraintdef = %)'
                    '⇒ 本片 COMMENT 寫死的終局集合會過期,拒繼續',
                    COALESCE(v_arr::text, '<抽不出>'), COALESCE(v_txt, '<不存在>')
      USING ERRCODE = 'P2F06', CONSTRAINT = 'l5b2_2f_status_domain';
  END IF;

  -- 🔴 P6b/P6c 一律**沿 pg_trigger 解析**、不按函式名字另查(R1 A3):
  --    同名 trigger 可以被 DROP 後重建、綁到一顆 no-op 函式上,而舊函式仍留在庫裡 ⇒
  --    「trigger 在」與「那個名字的函式沒被改」兩道都綠,終態卻已經可以被轉出。
  --    守門要問的是「**這顆 trigger 實際會執行什麼**」,不是「庫裡有沒有那個名字」。
  --    同族的中和手法一併釘住(這病不只 R1 指名的那一面):
  --      停用 tgenabled / 永假 WHEN 子句 tgqual / 改時機或事件 tgtype /
  --      改 UPDATE OF 的欄位 tgattr(改成別欄 ⇒ 改 status 時根本不觸發)。
  --    期望值 = 本機臨時叢集實測(PG 17.10):tgtype=19(ROW 1|BEFORE 2|UPDATE 16)、tgattr={10}=status。
  --      量法逐字:SELECT tgtype, tgattr, tgqual IS NULL FROM pg_trigger WHERE tgname = '<名>';
  --      對照 pg_get_triggerdef = 'BEFORE UPDATE OF status ON public.order_refunds FOR EACH ROW'。
  --    tgattr 為空 = 對所有欄位觸發(比現況更寬、不是弱化)⇒ 一併放行。
  --    🔴 兩處放寬(R1v6 IMP:合法且**更強**的設定被誤擋)——
  --      ①tgenabled:'A'(ALWAYS)連 replica 角色都照跑,比 'O'(origin)嚴格更強,卻被 = 'O' 擋掉。
  --      ②tgtype:官方只把它定義成 bitmask(https://www.postgresql.org/docs/17/catalog-pg-trigger.html),
  --        釘整數 19 等於同時釘住「沒有其他事件」——多綁一個 INSERT(bit 4)只會讓狀態機管得更多,
  --        不會讓「三終態不得轉出」變弱,卻被擋。改成逐位元要求:ROW(1)|BEFORE(2)|UPDATE(16) 三個位元都在,
  --        另外排除 INSTEAD(64)—— 那個會換掉整個執行語意。
  SELECT t.tgenabled IN ('O', 'A')
         AND t.tgqual IS NULL
         AND (t.tgtype & 1) = 1
         AND (t.tgtype & 2) = 2
         AND (t.tgtype & 16) = 16
         AND (t.tgtype & 64) = 0
         AND (pg_catalog.cardinality(t.tgattr::int2[]) = 0
              OR (SELECT a.attnum FROM pg_catalog.pg_attribute a
                   WHERE a.attrelid = t.tgrelid AND a.attname = 'status') = ANY (t.tgattr::int2[]))
    INTO v_ok
    FROM pg_catalog.pg_trigger t
   WHERE t.tgrelid = 'public.order_refunds'::regclass
     AND t.tgname = 'order_refunds_status_transition_bu' AND NOT t.tgisinternal;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION '2f 前置閘 P6b:狀態機 trigger order_refunds_status_transition_bu 不存在、被停用'
                    '(tgenabled 不是 O 或 A)、帶了 WHEN 子句、時機/事件缺 ROW|BEFORE|UPDATE 任一位元'
                    '(或是 INSTEAD OF)、或 UPDATE OF 的欄位清單不含 status '
                    '⇒「confirmed/failed/deferred 皆為終態」這句話失去執行者(值域 CHECK 管不到轉移),拒繼續'
      USING ERRCODE = 'P2F06', CONSTRAINT = 'l5b2_2f_status_machine_enabled';
  END IF;

  -- P6c:md5 取自「這顆 trigger 實際綁的函式」(join tgfoid),不是按名字另查一顆同名函式。
  SELECT md5(p.prosrc) INTO v_txt
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
   WHERE t.tgrelid = 'public.order_refunds'::regclass
     AND t.tgname = 'order_refunds_status_transition_bu' AND NOT t.tgisinternal;
  IF v_txt IS DISTINCT FROM c_sm_md5 THEN
    RAISE EXCEPTION '2f 前置閘 P6c:這顆 trigger 實際綁的函式 prosrc md5 = % ,期望 % '
                    '⇒ 轉移規則被改過、或 trigger 已被重綁到別的函式,拒繼續',
                    COALESCE(v_txt, '<不存在>'), c_sm_md5
      USING ERRCODE = 'P2F06', CONSTRAINT = 'l5b2_2f_status_machine_pinned';
  END IF;

  -- ── P7. order_refunds 那半的 DB 權威還在,而且**還是那個形狀** ─────────
  --    🔴 只驗名稱擋不住「同名重建成錯 predicate / 錯 key / invalid」。
  --    本片「不做 order_refunds 那半」的整個論證靠它;它變了 = 我留了個洞。
  --    🔴 predicate 用**整串相等**、不用 LIKE '%processing%'(R1 A1):
  --       把 predicate 改成 `WHERE status <> 'processing'`,子字串照樣命中 ⇒ 守門全綠,
  --       而 processing 完全不受限、同單可開多筆退款。
  --       這與突變 M1(共享鎖函式名**包含**互斥鎖名當前綴)是同一個病:
  --       **「找得到這個字串」不是守門**。寫 LIKE/strpos 守門前先問「加一個否定詞會怎樣」。
  --    🔴 鍵也不用 indexdef LIKE '%(order_id)%':indexdef 連 predicate 一起吐,
  --       改成別的鍵而 predicate 裡出現 order_id 就會誤過 ⇒ 改查 indkey[0] 的實際欄名。
  --    期望字面 = 本機臨時叢集實測(PG 17.10):(status = 'processing'::text)
  --       量法逐字:SELECT pg_get_expr(indpred, indrelid) FROM pg_index
  --                  WHERE indexrelid = 'public.order_refunds_single_processing_per_order'::regclass;
  --       ⚠️ 這是 PG **反編譯重建**的文字(官方明載,https://www.postgresql.org/docs/17/functions-info.html)、
  --          不是當初寫下的原始文字,隨版本可能改寫。
  --       🔴 已知代價(主視窗裁定接受 fail-closed,但值班要看得懂):語意相同而寫法/版本不同的
  --          predicate 會被**誤擋**。症狀逐字如下 ——
  --            · apply 直接失敗、constraint = l5b2_2f_single_flight_index;
  --            · 訊息裡會印出**實際的索引定義全文**(下面那句 pg_get_indexdef);
  --            · 值班的動作 = 拿那段實際定義與這裡釘的字面逐字比,若語意相同只是寫法不同
  --              ⇒ 那是誤擋、不是漂移 ⇒ 停下回報,由 Sean 拍板改釘值,**不要自己放寬成 LIKE**。
  SELECT i.indisvalid AND i.indisunique AND i.indisready AND i.indislive
         AND i.indnkeyatts = 1 AND i.indnatts = 1 AND i.indexprs IS NULL
         AND a.attname = 'order_id'
         AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(status = ''processing''::text)'
    INTO v_ok
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
   WHERE i.indexrelid = 'public.order_refunds_single_processing_per_order'::regclass;
  IF NOT COALESCE(v_ok, false) THEN
    SELECT pg_catalog.pg_get_indexdef(i.indexrelid) INTO v_txt
      FROM pg_catalog.pg_index i
     WHERE i.indexrelid = 'public.order_refunds_single_processing_per_order'::regclass;
    RAISE EXCEPTION '2f 前置閘 P7:唯一索引 order_refunds_single_processing_per_order 不存在、'
                    '無效/未 ready、非唯一、鍵不是單欄 order_id、是運算式索引、'
                    '或 predicate 不再逐字等於 (status = ''processing''::text)。實際定義 = % '
                    '⇒ order_refunds 那半的 single-flight 不再成立,而本片刻意不重做那半,拒繼續',
                    COALESCE(v_txt, '<不存在>')
      USING ERRCODE = 'P2F07', CONSTRAINT = 'l5b2_2f_single_flight_index';
  END IF;

  -- ── P8. COMMENT 基線(post-assert 要證新 COMMENT 以它為前綴)────────────
  SELECT comment_md5 INTO v_txt FROM _l5b2_2f_preimage;
  IF v_txt IS DISTINCT FROM c_comment_md5 THEN
    RAISE EXCEPTION '2f 前置閘 P8:② 現行 COMMENT 全文 md5 = % ,期望 % '
                    '⇒ 基線不符,無法保證「逐字保留 + 追加」,拒繼續',
                    COALESCE(v_txt, '<不存在>'), c_comment_md5
      USING ERRCODE = 'P2F08', CONSTRAINT = 'l5b2_2f_comment_baseline';
  END IF;

  RAISE NOTICE '2f 前置閘 P1-P8 全過。';
END;
$pre_2f$;

-- ══ 2. 函式本體(由 scripts 機械切自 20260803150000:423-604 並插入 A/B/C)══
CREATE OR REPLACE FUNCTION public.admin_initiate_order_refund(
  p_order_id               uuid,
  p_kind                   text,
  p_amount                 integer,   -- partial 必填正整數;full 必須 NULL
  p_record_refunded_before bigint,    -- G0 baseline(action 從 Record 查得;缺欄時 action 已 abort)
  p_record_amount          bigint,    -- G0 那次 Record 的 amount(剩餘額);full 必填(凍結額)、partial 必須 NULL
  p_reason                 text,
  p_actor                  text,
  p_request_id             text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '10s'          -- Sean Q-2f-1(2026-08-12);放函式層子句不放 body
AS $fn$
DECLARE
  v_actor    text;
  v_req      text;
  v_reason   text;
  v_ps       text;
  v_rec      text;
  v_frozen   integer;
  v_brid     text;
  v_row      public.order_refunds%ROWTYPE;
  v_id       uuid;
  v_conname  text;
  v_blocking uuid;
BEGIN
  -- 步 1. 輸入衛生(G11;RAISE 面,鏡像 A6 步 1;slug regex 拒 unicode ⇒ 裸 btrim 已足)
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 actor';
  END IF;
  v_actor := btrim(p_actor);
  IF v_actor !~ '^[a-z0-9_]{1,64}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: actor 非法(須為 staff slug)';
  END IF;
  IF p_request_id IS NULL
     OR p_request_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 非法(須為 UUID v4 小寫;表單渲染時 server 發)';
  END IF;
  v_req := p_request_id;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: 缺 reason';
  END IF;
  v_reason := btrim(p_reason);
  IF v_reason = '' OR char_length(v_reason) > 200 OR v_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: reason 非法(1-200 字、零控制字元)';
  END IF;

  -- 步 2. kind 與金額參數互斥(RAISE 面;fail-closed 嚴格互斥;損壞輸入=RAISE 非業務碼)
  IF p_kind IS NULL OR p_kind NOT IN ('full', 'partial') THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: kind 須為 full|partial(got %)', COALESCE(p_kind, '<null>');
  END IF;
  IF p_record_refunded_before IS NULL OR p_record_refunded_before < 0 THEN
    RAISE EXCEPTION 'admin_initiate_order_refund: record_refunded_before 須為非負整數(G0 baseline;Record 欄缺時 action 必須 abort、不得傳 0 充數)';
  END IF;
  IF p_kind = 'partial' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 必須帶正整數 amount';
    END IF;
    IF p_record_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: partial 不得帶 record_amount(凍結額=員工輸入額)';
    END IF;
    v_frozen := p_amount;
  ELSE  -- full
    IF p_amount IS NOT NULL THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 不得帶 amount(凍結額=Record 剩餘額;plan G3)';
    END IF;
    IF p_record_amount IS NULL OR p_record_amount < 0 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: full 必須帶非負 record_amount(G0 那次 Record 的 amount;負值=損壞輸入)';
    END IF;
    IF p_record_amount > 2147483647 THEN
      RAISE EXCEPTION 'admin_initiate_order_refund: record_amount 超出 integer 範圍';
    END IF;
    v_frozen := p_record_amount::integer;   -- =0 時走步 6 的 NOTHING_LEFT(業務態非損壞)
  END IF;

  -- 🆕 2f-A. 訂單級序列化點(母 plan §3a-4/§3a-6a;plan §3-1)
  --   🔴 必須在步 3 之前:此刻手上**沒有任何列鎖** ⇒ 只可能「等 advisory」,
  --      不可能「持 orders 列鎖等 advisory」× close 持 advisory 等 orders = AB-BA 40P01。
  --   🔴 鍵式子與 2e(close_released_attempt)**逐字相同**,三方必須同一把鎖;
  --      不經 hashtext = 避 32-bit 碰撞讓不相干訂單共用隊伍。
  --   ⚠️ p_order_id 為 NULL 時鍵求值為 NULL、鎖不生效,步 3 隨即回 ORDER_NOT_FOUND(harness 釘住)。
  PERFORM pg_catalog.pg_advisory_xact_lock(
    ('x' || pg_catalog.substr(pg_catalog.replace(p_order_id::text, '-', ''), 1, 16))::bit(64)::bigint);

  -- 步 3. 鎖訂單(G1:FOR NO KEY UPDATE —— FOR UPDATE 與 FK RI KEY SHARE 死結 40P01 實錘;
  --   鎖順序沿既有約定 orders → order_refunds;INSERT trigger 的 FOR SHARE 同列同交易相容)
  SELECT o.payment_status::text, o.tappay_rec_trade_id
    INTO v_ps, v_rec
    FROM public.orders o
   WHERE o.id = p_order_id
     FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_FOUND');
  END IF;

  -- 步 4. 查驗式冪等(G4;**先於一切業務前置** —— 重播必須拿到 DUPLICATE 而非被
  --   後續業務態遮蔽;以 S4 唯一鍵找列、逐欄比指紋)
  SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
  IF FOUND THEN
    IF v_row.order_id = p_order_id AND v_row.kind = p_kind
       AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec THEN
      IF v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: 該 request 的前次嘗試已終結為 %(deferred/failed 不得同鍵重放;請開新請求=新表單=新 token)', v_row.status;
    END IF;
    RAISE EXCEPTION 'admin_initiate_order_refund: request_id 已被使用且指紋不符(order/kind/金額/rec 任一變動;full 的凍結額會隨 Record 漂移 —— 金額已變動,請重新發起)';
  END IF;

  -- 步 5. 業務前置(友善碼面;P7C02/P7C03 仍是深層防線、不重複計門)
  IF v_ps = 'refunded' THEN
    RETURN jsonb_build_object('result', 'REFUND_LEDGER_FULL');   -- Sean Q1=A 硬擋(G12)
  END IF;
  IF v_ps NOT IN ('paid', 'partiallyRefunded') THEN
    RETURN jsonb_build_object('result', 'ORDER_NOT_REFUNDABLE');
  END IF;
  IF v_rec IS NULL OR btrim(v_rec) = '' THEN
    RETURN jsonb_build_object('result', 'ORDER_NO_CARD_TRANSACTION');
  END IF;

  -- 步 6. full 的「已無可退」業務態(fable F2:凍 0 元會撞 refund_amount>0 CHECK 成裸錯)
  IF p_kind = 'full' AND v_frozen < 1 THEN
    RETURN jsonb_build_object('result', 'REFUND_NOTHING_LEFT');
  END IF;

  -- 🆕 2f-B. 跨帳本否決:payment_refunds(補償帳本)有在途 ⇒ 不開新的
  --   位置=步 6 之後、步 7 之前(plan §3-2a / §11 偏-4):
  --     下界 母 plan :290「必須晚於 G4」(早於 G4 會把合法重播的 DUPLICATE_REQUEST 變成被拒);
  --     上界「早於動錢」= 步 8 的 INSERT(步 5-7 無寫入、無外呼)。
  --     取區間最後一格 ⇒ LEDGER_FULL / NOT_REFUNDABLE / NO_CARD_TRANSACTION / NOTHING_LEFT
  --     四個具體診斷**優先於**籠統的 REFUND_IN_FLIGHT,與 order_refunds 那半(步 8 才擋)一致。
  --   🔴 只做 payment_refunds 這半:order_refunds 那半已由唯一索引
  --      order_refunds_single_processing_per_order 在步 8 擋住(plan §1-4),再加一道會被它嚴格蘊含。
  --   🔴 複用既有回傳碼 REFUND_IN_FLIGHT,**不新增第 9 碼**:8 碼全集是呼叫端合約
  --      (本檔 COMMENT + apps/admin/src/lib/payment/refund-repository.ts:17-26 allowlist,:211 未知碼 throw)。
  SELECT pr.id
    INTO v_blocking
    FROM public.payment_refunds pr
    JOIN public.payment_charge_attempts a ON a.id = pr.attempt_id
   WHERE a.order_id = p_order_id
     -- 終局判定一律消費 canonical view(沖銷片 §2d-1 契約;本函式不自行判讀 manual)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et
                      WHERE et.refund_id = pr.id)
     -- 🔴 已被沿鏈接手的舊列不算在途:母 plan :483-489 的重試路徑(delta 說沒退 ⇒ 沿鏈開新根)
     --    **沒有任何一步給舊列寫終局** ⇒ 少這條,走過一次設計內重試的訂單會被**永久**擋死。
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s
                      WHERE s.supersedes_refund_id = pr.id)
     -- 🔴 Sean Q-2f-2 = B(2026-08-12,複判維持):**已受理即不算在途**。
     --    result_success 不在 canonical view 的終局集合(20260811110000:197-198)⇒ 只能直讀 events。
     --    這是本函式**唯一**獲准直讀的 event_type(carve-out,後置錨釘死);
     --    它是**受理判定**、不是終局判定,不得當成「終局」的同義詞。
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                      WHERE e.refund_id = pr.id AND e.event_type = 'result_success')
   -- 無 ORDER BY 的 LIMIT 1 回哪一列由計畫決定 ⇒ blocking id 會飄、測試 flake、對帳對不起來
   ORDER BY pr.created_at, pr.id
   LIMIT 1;
  IF v_blocking IS NOT NULL THEN
    RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT',
                              'blocking_payment_refund_id', v_blocking);
  END IF;

  -- 步 7. bank_refund_id 生成(G2:rotation-always 一列一鍵;16 bytes→base64→+/→ab→截 20
  --   = 恰 20 字 [A-Za-z0-9ab]、熵 ≥90-bit;生成即形狀,不設驗證(恆真=死規則,關卡2 折入);
  --   撞鍵由 UNIQUE 承接、機率天文小、fail-loud)
  v_brid := substr(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', 'ab'), 1, 20);

  -- 步 8. 單列 INSERT(S5/S4 撞鍵在此收斂成具名結果;其餘 unique 撞鍵 fail-loud)
  BEGIN
    INSERT INTO public.order_refunds
      (order_id, bank_refund_id, rec_trade_id, refund_amount, status, reason, actor,
       request_id, kind, record_refunded_before)
    VALUES
      (p_order_id, v_brid, v_rec, v_frozen, 'processing', v_reason, v_actor,
       v_req, p_kind, p_record_refunded_before)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_conname = CONSTRAINT_NAME;
    IF v_conname = 'order_refunds_single_processing_per_order' THEN
      RETURN jsonb_build_object('result', 'REFUND_IN_FLIGHT');   -- 接線債②:同單已有進行中退款
    END IF;
    IF v_conname = 'order_refunds_request_id_key' THEN
      -- 同 token 併發競態:另一連線剛插入 ⇒ 重跑步 4 的查驗(嚴格同判準)
      SELECT * INTO v_row FROM public.order_refunds WHERE request_id = v_req;
      IF FOUND AND v_row.order_id = p_order_id AND v_row.kind = p_kind
         AND v_row.refund_amount = v_frozen AND v_row.rec_trade_id = v_rec
         AND v_row.status IN ('processing', 'confirmed') THEN
        RETURN jsonb_build_object('result', 'DUPLICATE_REQUEST', 'refund_id', v_row.id,
          'bank_refund_id', v_row.bank_refund_id, 'refund_amount', v_row.refund_amount,
          'status', v_row.status);
      END IF;
      RAISE EXCEPTION 'admin_initiate_order_refund: request_id 併發撞鍵且查驗不過;拒繼續';
    END IF;
    RAISE;  -- bank_refund_id 撞鍵等 = 異常,fail-loud
  END;

  -- 步 9. 同交易稽核(G9;audit INSERT 不包 EXCEPTION handler —— 失敗必整筆 rollback)
  -- 🔴 audit.reason 一律 NULL(零自由文字/零 PII;退款理由存帳本列 reason 欄、RLS 保護;
  --    關卡2 codex MF3 折入)。after 恰 8 鍵、全部取自實際寫入值。
  INSERT INTO public.admin_audit_log (actor, action, target, before, after, reason, request_id, source_app)
  VALUES (v_actor, 'order_refund.initiate', 'order:' || p_order_id::text, NULL,
          jsonb_build_object(
            'order_id', p_order_id,
            'refund_row_id', v_id,
            'kind', p_kind,
            'refund_amount', v_frozen,
            'rec_trade_id', v_rec,
            'bank_refund_id', v_brid,
            'record_refunded_before', p_record_refunded_before,
            'request_id', v_req),
          NULL, v_req, 'admin');

  RETURN jsonb_build_object('result', 'INITIATED', 'refund_id', v_id,
    'bank_refund_id', v_brid, 'refund_amount', v_frozen, 'status', 'processing');
END;
$fn$;

-- ══ 3. COMMENT:既有全文**逐字保留** + 追加 2f 段落 ═════════════════════════
COMMENT ON FUNCTION public.admin_initiate_order_refund(uuid, text, integer, bigint, bigint, text, text, text) IS
  'M-3 A7c RW1a 退款登記 RPC(=RF2b 的 initiate 半邊;plan v3.2 §2)。帳先記(INSERT processing 列、RPC 自產 bank_refund_id 一列一鍵)、呼叫端再打 TapPay refund()。'
  '固定回傳碼 8 碼(jsonb.result;呼叫端必斷言 ∈ 全集):INITIATED / DUPLICATE_REQUEST / ORDER_NOT_FOUND / ORDER_NOT_REFUNDABLE / ORDER_NO_CARD_TRANSACTION / REFUND_LEDGER_FULL / REFUND_IN_FLIGHT / REFUND_NOTHING_LEFT。'
  '🔴 檢查順序=合約:鎖訂單 → 冪等查驗(G4,先於一切業務前置 —— 重播恆得 DUPLICATE、不被 REFUND_LEDGER_FULL 等遮蔽)→ G12/白名單/卡交易 → NOTHING_LEFT。'
  '🔴 DUPLICATE_REQUEST=查驗式冪等(同 request_id + 指紋 order/kind/金額/rec 全符 + 列在 processing|confirmed)⇒ 按成功處理;同鍵但指紋不符或前次已 deferred/failed = RAISE fail-loud。'
  '🔴 REFUND_IN_FLIGHT=同單已有 processing 列(S5;接線債② single-flight)。REFUND_LEDGER_FULL=Sean Q1=A refunded 硬擋。'
  'kind=full 凍結額=呼叫端提供的 Record 剩餘額(G0:action 先 recordQuery 並斷言 record_status∈{0,1,2}、refunded_amount 欄缺=abort 嚴禁 ??0、full 時 amount>0);partial=員工輸入。'
  'audit(action=order_refund.initiate、after 恰 8 鍵、reason=NULL 零自由文字)。鎖序=orders FOR NO KEY UPDATE → order_refunds。EXECUTE 僅 service_role。'
  -- ── 以上為 20260803150000:598-604 逐字保留(P8 基線 + 後置前綴斷言證明未被截) ──
  '🆕 L5b-2 片 2f(20260812170000):①步 2 後、步 3 前取 order 級 advisory(三方共用序列化點,母 plan §3a-4;鍵式子=pg_advisory_xact_lock((''x''||substr(replace(order_id::text,''-'',''''),1,16))::bit(64)::bigint),三方必須逐字相同,不經 hashtext=避 32-bit 碰撞讓不相干訂單共用隊伍;必須早於步 3 否則持 orders 列鎖等 advisory × close 持 advisory 等 orders = AB-BA 40P01)。'
  '②步 6 後、步 7 前加 payment_refunds 在途否決 → 複用 REFUND_IN_FLIGHT(不新增第 9 碼:8 碼全集是呼叫端合約)。在途 = 父列存在 且 canonical view payment_refund_effective_terminal 無有效終局 且 未被沿鏈接手(supersedes_refund_id) 且 無 result_success。'
  '🔴 order_refunds 的終局集合逐字 = confirmed / failed / deferred(20260803150000:185-186 值域 + :211/:214 狀態機「三終態轉出一律 RAISE」);在途 = processing。'
  '🔴 carve-out:終局判定**一律**消費 canonical view;**唯一例外**=直讀 payment_refund_events 的 event_type=''result_success'' 判「已受理」——它是**受理判定不是終局判定**(Sean Q-2f-2=B,2026-08-12 複判維持:已受理即不算在途)。本函式不得直讀其他 event_type。'
  '🔴 尺度=order(join payment_charge_attempts 取 order_id):payment_refunds 無 order_id 欄,且其 rec_trade_id 刻意 nullable ⇒ rec 尺度會漏掉 NULL 列。代價=同單其他 attempt 的在途補償也會擋(fail-closed 方向)。'
  '③函式層 SET lock_timeout=''10s''(Sean Q-2f-1;放子句不放 body:body 內 SET LOCAL 是交易尺度、不隨函式返回還原)。⚠️ 這對員工可見:原本「等一下就成功」的正常競爭可能直接失敗。'
  '🔴🔴 呼叫端前提(本函式管不到、無機制守,只能寫在這裡):**本函式只能在單語句交易內呼叫**。advisory 持有到**整個交易結束**、不是函式返回 ⇒ 呼叫端交易若在本呼叫之外還持有、或之後還會等待任何可爭用資源,就可能與另一條同單呼叫成環。現況唯一呼叫點 apps/admin/src/lib/payment/refund-repository.ts:195 走 PostgREST 單一 RPC(**時點觀察、非禁止**)。本片不宣稱消滅死結,只宣稱「該前提成立之下 advisory 不會出現在環上」。'
  '⚠️ 超退不歸本函式管:Q-2f-2=B 之後 TapPay 是**唯一**防線,而它只有 sandbox 實證、且 partial 路徑不查任何帳(v_frozen := p_amount)⇒ backlog #445 專責。';

-- ══ 4. 後置斷言(任一不符 ⇒ 整片回滾)═══════════════════════════════════════
DO $post_2f$
DECLARE
  v_src      text;
  v_stripped text;
  v_ok       boolean;
  v_n        integer;
  v_n2       integer;
  v_txt      text;
  v_txt2     text;
  v_norm     text;   -- v_stripped 再把連續空白正規化成單一空格(比對「寫法」用)
  i_adv      integer;
  i_s2       integer;
  i_nku      integer;
  i_g4       integer;
  i_veto     integer;
  i_ins      integer;
BEGIN
  SELECT p.prosrc INTO v_src
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';

  -- ── ①順序錨(剝註解後比字元位置)─────────────────────────────────────
  --    🔴 剝註解是必要的:② 唯一出現 'FOR UPDATE' 的地方是步 3 上面那句「解釋為何不能用它」的註解。
  --    ⚠️ 這只是**廉價前哨**,真判別力在 harness 的死結消融(必須實際觀察到 40P01)。
  v_stripped := pg_catalog.regexp_replace(v_src, '--[^' || pg_catalog.chr(10) || ']*', '', 'g');
  -- 空白正規化版本:⑥⑦ 比對「寫法」時用(換行/縮排不該影響判定)。在這裡一次算好,
  -- 不放到某條斷言裡面 —— 否則斷言順序一改,後面那條就拿到 NULL 而靜默失效。
  v_norm := pg_catalog.regexp_replace(v_stripped, '\s+', ' ', 'g');
  i_adv  := pg_catalog.strpos(v_stripped, 'pg_advisory_xact_lock');
  i_s2   := pg_catalog.strpos(v_stripped, 'v_frozen := p_record_amount::integer');
  -- 🔴 順序錨的座標系一律用 v_stripped(v7 三折更正):
  --    v6 讓 i_nku 走 upper(v_stripped) 而 i_adv 走 v_stripped,兩個不同座標系直接比大小,
  --    只靠「upper() 不改長度」這個**沒有普遍性的假設**(ICU 之下 ß→SS 就會位移)撐著。
  --    現在同座標系:小寫寫的 `for no key update` 會讓 i_nku=0 ⇒ ①a 當場紅(fail-closed 方向,可接受);
  --    真正需要大小寫/空白不敏感的是 ①c 的**存在性**判定,那一道另外用 upper(v_norm) 做,不進座標比較。
  i_nku  := pg_catalog.strpos(v_stripped, 'FOR NO KEY UPDATE');
  i_g4   := pg_catalog.strpos(v_stripped, 'WHERE request_id = v_req');
  i_veto := pg_catalog.strpos(v_stripped, 'payment_refund_effective_terminal');
  IF NOT (i_adv > 0 AND i_nku > 0 AND i_adv < i_nku) THEN
    RAISE EXCEPTION '2f 後置①a:advisory(位置 %)必須早於 FOR NO KEY UPDATE(位置 %)', i_adv, i_nku
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_anchor_advisory_before_lock';
  END IF;
  -- 🔴 只證上界不夠(R1v6 IMP):把 advisory 移到步 1/步 2 的輸入驗證**之前**,
  --    「早於列鎖」照樣成立,但這時連 actor/kind/金額都還沒驗 ——
  --    一個打錯參數的請求會先去排隊、等滿 lock_timeout 10 秒才失敗,
  --    等於讓無效請求也去放大同單的阻塞。下界錨 = 步 2 最後一句賦值。
  IF NOT (i_s2 > 0 AND i_s2 < i_adv) THEN
    RAISE EXCEPTION '2f 後置①a2:advisory(位置 %)必須晚於步 2 的參數互斥檢查(錨 v_frozen := '
                    'p_record_amount::integer,位置 %)—— 早於它 = 無效輸入也會先去排隊等滿 lock_timeout',
                    i_adv, i_s2
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_anchor_advisory_after_validation';
  END IF;
  -- 🔴 鎖的**種類**也要釘:突變測試 M1 實測,把 pg_advisory_xact_lock 換成 pg_advisory_xact_lock_shared
  --    之下,順序錨(strpos 找前綴)與鍵等價(只比 substr 算式)**兩道都照樣綠**,
  --    但共享鎖彼此不互斥 ⇒ 序列化完全失效。守門看不見的失效 = 最危險的那種。
  -- 🔴 大小寫(R1v6 MF):SQL 的識別字不分大小寫,`PERFORM PG_ADVISORY_XACT_LOCK(0)` 是完全合法的
  --    同一支函式;舊版兩道(①d 與 ②a)都用大小寫敏感的正規式 ⇒ 大寫寫法**一處都不會被數到**,
  --    可以偷渡第二把全域鎖或換成共享鎖而兩道全綠。
  --    ⇒ 掃描一律 'gi';比對仍要求**逐字小寫**的那個字面(大寫寫法會落進「不等於」而被擋)。
  SELECT count(*) INTO v_n
    FROM pg_catalog.regexp_matches(v_stripped, 'pg_[a-z_]*advisory[a-z_]*', 'gi') AS m
   WHERE m[1] <> 'pg_advisory_xact_lock';
  IF v_n > 0 THEN
    RAISE EXCEPTION '2f 後置①d:本函式用了 pg_advisory_xact_lock 以外的 advisory 函式,或用了'
                    '非小寫的寫法(% 處)⇒ 共享鎖/try 版/session 版都不提供本片要的互斥語意;'
                    '大小寫變體則會讓其餘各道字面守門集體失明,拒繼續', v_n
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_advisory_exclusive_only';
  END IF;

  IF NOT (i_g4 > 0 AND i_veto > 0 AND i_g4 < i_veto) THEN
    RAISE EXCEPTION '2f 後置①b:跨帳本否決(位置 %)必須晚於 G4 冪等查驗(位置 %)'
                    '—— 早於 G4 會把合法重播的 DUPLICATE_REQUEST 變成被拒 = 改既有語意', i_veto, i_g4
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_anchor_veto_after_g4';
  END IF;

  -- 🔴 只證下界不夠(R1 B):否決若被移到步 8 的 INSERT **之後**,「晚於 G4」照樣成立,
  --    但那時帳已經記進去了 —— 否決的整個意義(動錢前擋下)就沒了。上界必須一起釘。
  i_ins := pg_catalog.strpos(v_stripped, 'INSERT INTO public.order_refunds');
  IF NOT (i_ins > 0 AND i_veto < i_ins) THEN
    RAISE EXCEPTION '2f 後置①b2:跨帳本否決(位置 %)必須早於步 8 的 INSERT INTO public.order_refunds(位置 %)'
                    '—— 晚於它 = 帳已經記了才否決,擋不住任何東西', i_veto, i_ins
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_anchor_veto_before_insert';
  END IF;
  -- ── ①e 否定詞保存:三條在途述詞的 NOT 不能被拿掉 ─────────────────────────
  --    🔴 R1v6 MF:①b/①b2 用的是**名稱座標**(strpos 找 view 名字)。把 `NOT EXISTS` 改成
  --       `EXISTS`,名字的位置一個字元都不會動 ⇒ 兩道順序錨照樣綠,而三條述詞的語意全部反轉
  --       (「沒有在途才放行」變成「有在途才放行」)。位置守門對語意反轉天生全盲。
  --    ⇒ 改成全稱形狀:凡是這三個關聯名被提到的地方,**每一處**都必須包在它那一條
  --       `NOT EXISTS (SELECT 1 FROM public.<名>` 的形式裡;總數與合格數不相等就擋,
  --       不需要知道被改成了什麼。三個關聯名各數一次,少數哪一個都會被抓到。
  --    ⚠️ 這道只管「NOT 還在不在、包在不在」;述詞內部的關聯條件(e.refund_id = pr.id 之類)
  --       不在這道的範圍 —— 那一面留給行為靶(mut M8),兩者刻意不重疊。
  SELECT count(*) INTO v_n  FROM pg_catalog.regexp_matches(v_norm, 'payment_refund_effective_terminal', 'g') AS m;
  SELECT count(*) INTO v_n2 FROM pg_catalog.regexp_matches(v_norm,
           'NOT EXISTS \(SELECT 1 FROM public\.payment_refund_effective_terminal ', 'g') AS m;
  IF v_n <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '2f 後置①e-1:canonical view 被提到 % 處、其中包在 NOT EXISTS(SELECT 1 FROM ...)裡的 % 處,'
                    '兩者都必須恰好 1 ⇒ 終局述詞的否定被拿掉或改寫,語意可能整個反轉,拒繼續', v_n, v_n2
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_veto_negation_terminal';
  END IF;
  SELECT count(*) INTO v_n  FROM pg_catalog.regexp_matches(v_norm, 'supersedes_refund_id', 'g') AS m;
  SELECT count(*) INTO v_n2 FROM pg_catalog.regexp_matches(v_norm,
           'NOT EXISTS \(SELECT 1 FROM public\.payment_refunds s WHERE s\.supersedes_refund_id ', 'g') AS m;
  IF v_n <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '2f 後置①e-2:沿鏈排除被提到 % 處、其中包在 NOT EXISTS 裡的 % 處,兩者都必須恰好 1 '
                    '⇒ 少了它,走過一次設計內重試的訂單會被永久擋死;反轉它則變成只擋已接手的列,拒繼續', v_n, v_n2
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_veto_negation_superseded';
  END IF;
  SELECT count(*) INTO v_n  FROM pg_catalog.regexp_matches(v_norm, 'payment_refund_events', 'g') AS m;
  SELECT count(*) INTO v_n2 FROM pg_catalog.regexp_matches(v_norm,
           'NOT EXISTS \(SELECT 1 FROM public\.payment_refund_events e ', 'g') AS m;
  IF v_n <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '2f 後置①e-3:events 直讀被提到 % 處、其中包在 NOT EXISTS 裡的 % 處,兩者都必須恰好 1 '
                    '⇒ Sean Q-2f-2=B 的「已受理即不算在途」被反轉或被搬去別的地方用,拒繼續', v_n, v_n2
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_veto_negation_accepted';
  END IF;

  -- 🔴 ①c 走 **upper(v_norm)**(v7 三折;diff 層 R2 MF):
  --    v6 走 upper(v_stripped) —— 沒有做空白正規化 ⇒ `FOR<換行>UPDATE`、`FOR  UPDATE`(雙空格)
  --    一處都數不到,M22 的繞法換個空白就復活。同族的 ⑥⑦①e 早就走 v_norm,只有這道沒跟上。
  --    ⇒ 大小寫與空白兩個維度一起吸收。
  -- 🔴 順手刪掉 v6 的 `<> i_nku + 7` 豁免:'FOR NO KEY UPDATE' **不含**子字串 'FOR UPDATE'
  --    ⇒ 那個分支永遠不成立 = 死碼,而它會讓讀者以為這道有在防誤擋(diff 層 R2 nit)。
  --    任何一處 FOR UPDATE 都是違規,不需要豁免。
  IF pg_catalog.strpos(pg_catalog.upper(v_norm), 'FOR UPDATE') <> 0 THEN
    RAISE EXCEPTION '2f 後置①c:剝註解+空白正規化+大寫化之後仍出現 FOR UPDATE ⇒ 鎖強度被改,拒繼續'
      USING ERRCODE = 'P2F10', CONSTRAINT = 'l5b2_2f_anchor_lock_strength';
  END IF;

  -- ── ②跨函式鎖鍵等價:2e 與 2f 必須是**同一把鎖** ───────────────────────
  --    🔴 沒有這道,鍵式子寫錯(截 15 字、取錯段 UUID)之下順序錨綠、同函式併發也綠,
  --    但三方根本不在同一條隊伍 —— 兩邊各自綠、中間那一跳沒人守。
  --    🔴 比的是**整個引數式子**、不是其中的 substr 片段(R1 A2):
  --       只比片段之下,把前綴 'x' 換成別的字、或在尾巴 +1,片段一字未動 ⇒ 斷言照樣綠,
  --       但兩支算出來的 bigint 已經是不同的鎖 —— 又一次「找得到這個字串」當守門。
  --    抽法:從 pg_advisory_xact_lock( 起,到該句 ';' 前的 ')' 止,以 [^;]* 界定範圍。
  --       🔴 不可寫 '(.*?)':PG 的 ARE 整體貪婪度由**第一個**量詞決定 ⇒ `.*?` 在此不會非貪婪,
  --          實測會一路吃到函式尾(本機臨時叢集 PG 17.10 實跑確認)。
  --    識別字正規化:兩支的鍵來源識別字不同(2e = v_order_id_pre / 2f = p_order_id),
  --       其餘必須逐字相同。
  --    🔴 正規化只認**這兩個名字**(R1v6 MF):舊版把 `[a-z_]+::text` 一律換成 ORDERID,
  --       等於宣告「鍵來自哪個變數無所謂」—— 那正是這道要守的東西。
  --       2f 若改成鎖 p_request_id,舊正規化會把它一起抹平 ⇒ 兩邊字串相同 ⇒ 判為同一把鎖,
  --       而實際上兩支已經排在完全不同的隊伍上、跨函式互斥整個失效、零症狀。
  --       白名單之外的識別字**保留原樣** ⇒ 只要有人換來源變數,字串就對不起來。
  --    ⚠️ 代價:2e/2f 哪天合法改名(重構變數)會誤擋 ⇒ 症狀 = apply 被擋在 l5b2_2f_key_equivalence
  --       且訊息會把兩邊抽出來的式子逐字印出來,值班照著改這裡的白名單,不要改回萬用正規化。
  SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(
             pg_catalog.substring(
               pg_catalog.regexp_replace(p.prosrc, '--[^' || pg_catalog.chr(10) || ']*', '', 'g'),
               'pg_advisory_xact_lock\s*\(([^;]*)\)\s*;'),
             '\s+', ' ', 'g'),
           '\m(p_order_id|v_order_id_pre)\M::text', 'ORDERID::text'))
    INTO v_txt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'close_released_attempt';
  IF v_txt IS NULL THEN
    RAISE EXCEPTION '2f 後置②:抽不出 2e 的 advisory 引數式子 ⇒ 無法證明兩支用同一把鎖,拒繼續'
      USING ERRCODE = 'P2F11', CONSTRAINT = 'l5b2_2f_key_equivalence_unmeasurable';
  END IF;

  -- 🔴 本函式的 advisory 呼叫必須**恰好一顆**:多一顆(例如再鎖一個常數鍵)之下,
  --    上面的抽取只會抽到第一顆 ⇒ 等價斷言綠,而實際多了一把全域鎖(序列化全站/新的成環面)。
  --    🔴 同樣走 'gi'(R1v6 MF):大寫寫的第二顆鎖若數不到,這道就是擺設。
  SELECT count(*) INTO v_n
    FROM pg_catalog.regexp_matches(v_stripped, 'pg_advisory_xact_lock', 'gi') AS m;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '2f 後置②a:本函式的 pg_advisory_xact_lock 呼叫有 % 處(必須恰好 1 處)⇒ '
                    '鍵等價斷言只看得到第一處,拒繼續', v_n
      USING ERRCODE = 'P2F11', CONSTRAINT = 'l5b2_2f_advisory_call_once';
  END IF;

  v_txt2 := pg_catalog.btrim(pg_catalog.regexp_replace(
              pg_catalog.regexp_replace(
                pg_catalog.substring(v_stripped, 'pg_advisory_xact_lock\s*\(([^;]*)\)\s*;'),
                '\s+', ' ', 'g'),
              '\m(p_order_id|v_order_id_pre)\M::text', 'ORDERID::text'));
  IF v_txt2 IS DISTINCT FROM v_txt THEN
    RAISE EXCEPTION '2f 後置②:2f 的 advisory 引數式子與 2e 不同 ⇒ 兩支會排在不同隊伍上(互斥失效),拒繼續。'
                    '2e = [%] / 2f = [%]', v_txt, COALESCE(v_txt2, '<抽不出>')
      USING ERRCODE = 'P2F11', CONSTRAINT = 'l5b2_2f_key_equivalence';
  END IF;

  -- ── ③屬性:除 proconfig 外逐欄等於 pre-image;proconfig = 舊 + lock_timeout ──
  SELECT p.prosecdef   IS NOT DISTINCT FROM pre.prosecdef
     AND p.provolatile IS NOT DISTINCT FROM pre.provolatile
     AND p.proisstrict IS NOT DISTINCT FROM pre.proisstrict
     AND p.proparallel IS NOT DISTINCT FROM pre.proparallel
     AND p.proleakproof IS NOT DISTINCT FROM pre.proleakproof
     AND p.procost     IS NOT DISTINCT FROM pre.procost
     AND p.prorows     IS NOT DISTINCT FROM pre.prorows
     AND p.proacl::text IS NOT DISTINCT FROM pre.proacl
     AND pg_catalog.pg_get_userbyid(p.proowner) IS NOT DISTINCT FROM pre.owner
    INTO v_ok
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   CROSS JOIN _l5b2_2f_preimage pre
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION '2f 後置③:CREATE OR REPLACE 改動了不該動的屬性 '
                    '(secdef/volatile/strict/parallel/leakproof/cost/rows/acl/owner 之一)⇒ 拒繼續'
      USING ERRCODE = 'P2F12', CONSTRAINT = 'l5b2_2f_attrs_preserved';
  END IF;

  SELECT p.proconfig::text INTO v_txt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';
  -- 🔴 「含這兩個片段」是**下界**、不是等式(R1v6 IMP):多一個 SET(statement_timeout、
  --    row_security、任何會改行為的 GUC)照樣含得到那兩段 ⇒ 全綠,而本片宣稱的是
  --    「只新增 lock_timeout」。改成整串相等 —— 字面與回退腳本閘②b 的 c_post_proconfig
  --    是**同一顆**(scripts/l5b2-2f-rollback.sql;改一邊必須同 commit 改另一邊)。
  -- ⚠️ **誤擋症狀與值班動作**(v7 三折 nit;P4/P7 都寫了、只有這道漏寫):
  --    整串相等對合法的等價寫法會誤擋 —— 例如有人把子句寫成 `SET search_path = "public", pg_temp`,
  --    PG 存進 proconfig 的字面就不同。症狀 = apply 擋在 l5b2_2f_proconfig、訊息印出實際 proconfig。
  --    值班動作 = 拿實際字面與這裡的期望逐字比,若只是寫法不同 ⇒ 那是誤擋、不是漂移,
  --    停下回報由 Sean 裁定改釘值,**不要自己放寬回 LIKE 子字串**(那正是這道 v6 被打的原因)。
  IF v_txt IS DISTINCT FROM '{"search_path=public, pg_temp",lock_timeout=10s}' THEN
    RAISE EXCEPTION '2f 後置④:proconfig = % ,必須逐字等於 {"search_path=public, pg_temp",lock_timeout=10s} '
                    '(省略 SET 子句會讓 proconfig 變 NULL;抄 2e 的 search_path='''' 會改掉解析路徑;'
                    '多一個 SET = 本片沒宣告過的行為改動)',
                    COALESCE(v_txt, '<null>')
      USING ERRCODE = 'P2F13', CONSTRAINT = 'l5b2_2f_proconfig';
  END IF;

  -- ── ⑤COMMENT:以舊全文為前綴、且嚴格更長 ───────────────────────────────
  SELECT pg_catalog.obj_description(p.oid, 'pg_proc') INTO v_txt
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_initiate_order_refund'
     AND pg_catalog.pg_get_function_identity_arguments(p.oid)
         = 'p_order_id uuid, p_kind text, p_amount integer, p_record_refunded_before bigint, p_record_amount bigint, p_reason text, p_actor text, p_request_id text';
  -- 🔴 用 starts_with 不用 LIKE(R1 B):LIKE 會把舊全文裡的 `_` 當成萬用字元
  --    ⇒ 有人把 request_id 改成 requestXid,前綴比對照樣過、而「逐字保留」已經不成立。
  SELECT pg_catalog.starts_with(v_txt, comment_full) AND length(v_txt) > length(comment_full)
    INTO v_ok FROM _l5b2_2f_preimage;
  IF NOT COALESCE(v_ok, false) THEN
    RAISE EXCEPTION '2f 後置⑤:新 COMMENT 不是「舊全文 + 追加」⇒ 既有的 8 碼全集/順序合約/稽核契約 '
                    '可能被截掉,拒繼續'
      USING ERRCODE = 'P2F14', CONSTRAINT = 'l5b2_2f_comment_prefix';
  END IF;
  -- 🔴 這道是**字面在位**檢查,不是契約檢查(R1v6 IMP 逐字承認):
  --    COMMENT 是自由文字,任何斷言都擋不住「後面再加一句把前面否定掉」。
  --    能做的只有把要求的字面拉長到帶上下文,讓「改掉合約」不可能只動一兩個字就過關;
  --    真正在守這件事的是審查與 P8 基線(舊全文逐字保留),不是這一行。**不要把它讀成合約已被驗證。**
  IF v_txt NOT LIKE '%終局集合逐字 = confirmed / failed / deferred%' THEN
    RAISE EXCEPTION '2f 後置⑤b:COMMENT 未逐字寫入 order_refunds 的終局集合合約句'
                    '(母 plan :358 硬要求;期望字面「終局集合逐字 = confirmed / failed / deferred」)'
      USING ERRCODE = 'P2F14', CONSTRAINT = 'l5b2_2f_comment_terminal_set';
  END IF;

  -- ── ⑥carve-out 錨:本函式直讀 events 的 event_type 只有 result_success ──
  --    🔴 沒有這道,carve-out 會退化成「以後想直讀什麼都行」的破口。
  --    🔴 舊寫法只認「別名 e. + `=` + 字面」這一種寫法(R1 B):改成 `IN ('x','y')`、
  --       換別名、或用串接組字串,一律抽不到 ⇒ 零命中 ⇒ 綠燈。**枚舉寫法的守門一寫下就過期。**
  --       改成不枚舉寫法的形狀:凡是 event_type 被提到的地方,**每一處**都必須是那唯一獲准的形式;
  --       總數與合格數不相等 = 出現了別的用法,不必知道那是什麼用法就能擋。
  --    🔴 獲准形式要**連著左鄰的 `AND `** 一起比(R1v6 MF):只比 `event_type = 'result_success'`
  --       之下,`AND NOT e.event_type = 'result_success'` 兩個計數**仍然都是 1** ——
  --       加一個否定詞就把「已受理不算在途」翻成「只有已受理才算在途」,而守門一聲不吭。
  --       把 `AND ` 綁進形式裡,任何插在中間的否定詞/括號都會讓合格數掉到 0。
  SELECT count(*) INTO v_n  FROM pg_catalog.regexp_matches(v_norm, 'event_type', 'g') AS m;
  SELECT count(*) INTO v_n2 FROM pg_catalog.regexp_matches(v_norm,
           'AND e\.event_type = ''result_success''\)', 'g') AS m;
  IF v_n <> 1 OR v_n2 <> 1 THEN
    RAISE EXCEPTION '2f 後置⑥:本函式提到 event_type 共 % 處,其中符合唯一獲准形式 '
                    '(AND e.event_type = ''''result_success'''')的有 % 處 —— 兩者都必須恰好是 1。'
                    '⇒ carve-out 被擴大、被改寫成別的形式,或中間被塞了否定詞,拒繼續', v_n, v_n2
      USING ERRCODE = 'P2F15', CONSTRAINT = 'l5b2_2f_carveout_scope';
  END IF;

  -- ── ⑦回傳碼全集:靜態抽 prosrc 的 'result' 字面,必須 ⊆ 8 碼 ────────────
  --    抽樣輸出證不到「不存在第 9 碼」,靜態抽取才是全稱句。
  --    🔴 舊寫法只掃「'result', '大寫字面'」這一種形狀(R1 B):寫成
  --       jsonb_build_object('result', v_code) 或用串接組碼,一律抽不到 ⇒ 零命中 ⇒ 綠燈,
  --       而回傳的碼可能根本不在 8 碼裡。**「掃不到違規」不等於「沒有違規」。**
  --       改成計數相等:每一處 'result' 鍵的出現,都必須緊接著 8 碼之一的字面。
  --    🔴 只比「兩個計數相等」會被**同步減少**繞過(R1v6 MF):把鍵寫成 ''res'' || ''ult''
  --       之下,'result' 字面消失 ⇒ 兩個計數一起掉 ⇒ 相等 ⇒ 綠燈,而那個回傳點回什麼都沒人看。
  --       相等只擋得住「多出來的」,擋不住「一起不見的」⇒ 補一條**絕對值**:回傳點的數目本身也釘住。
  --       期望值 = 本函式現行的 10 個 'result' 鍵(= 10 個 RETURN jsonb_build_object 回傳點;
  --       檔面量法:awk 切出 $fn$ 區段 → sed 去 -- 註解 → grep -o "'result'" | wc -l = 10),
  --       量法逐字(本機臨時叢集實跑,scripts/l5b2-2f-verify.sh 的 E1 同源):
  --         SELECT count(*) FROM regexp_matches(
  --           regexp_replace(regexp_replace(prosrc,'--[^\n]*','','g'),'\s+',' ','g'), '''result''', 'g');
  --       ⚠️ 合法增刪回傳點時這裡會擋 ⇒ 症狀 = apply 擋在 l5b2_2f_result_code_closure、訊息印出實得數;
  --          那時要一起改的是:本 PIN、COMMENT 的 8 碼全集、呼叫端 allowlist。**三處同動才是完整的改**。
  SELECT count(*) INTO v_n
    FROM pg_catalog.regexp_matches(v_norm, '''result''', 'g') AS m;
  SELECT count(*) INTO v_n2
    FROM pg_catalog.regexp_matches(v_norm,
           '''result'', ''(INITIATED|DUPLICATE_REQUEST|ORDER_NOT_FOUND|ORDER_NOT_REFUNDABLE|'
           'ORDER_NO_CARD_TRANSACTION|REFUND_LEDGER_FULL|REFUND_IN_FLIGHT|REFUND_NOTHING_LEFT)''', 'g') AS m;
  IF v_n <> v_n2 OR v_n <> 10 THEN
    RAISE EXCEPTION '2f 後置⑦:prosrc 出現 ''''result'''' 鍵 % 處(期望恰 10 處),其中緊接 8 碼字面的 % 處 '
                    '⇒ 有回傳碼不是 8 碼全集裡的字面、改用變數/串接組出來、或回傳點被增刪,'
                    '破壞呼叫端合約(refund-repository.ts:17-26 allowlist,:211 未知碼 throw),拒繼續', v_n, v_n2
      USING ERRCODE = 'P2F16', CONSTRAINT = 'l5b2_2f_result_code_closure';
  END IF;

  -- ── ⑧觀察:apply 當下有多少 payment_refunds 會被本片擋住 ────────────────
  --    🔴 >0 = 本片一上線就會擋住那些單 ⇒ 這是 apply 的人**應該先知道再決定**的事,
  --    不是事後翻 log 才發現 ⇒ fail-closed,停下來問,不自動放行。
  --    ⚠️ 這個數字**沒有被預先量過**(2g 未建、payment_refunds 預期為空)。
  SELECT count(*) INTO v_n
    FROM public.payment_refunds pr
   WHERE NOT EXISTS (SELECT 1 FROM public.payment_refund_effective_terminal et WHERE et.refund_id = pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refunds s WHERE s.supersedes_refund_id = pr.id)
     AND NOT EXISTS (SELECT 1 FROM public.payment_refund_events e
                      WHERE e.refund_id = pr.id AND e.event_type = 'result_success');
  IF v_n > 0 THEN
    RAISE EXCEPTION '2f 後置⑧:目前有 % 筆 payment_refunds 符合本片的「在途」定義 ⇒ '
                    '本片一 apply,那些訂單的員工退款會立刻被擋住。'
                    '預期值是 0(2g 未建、本表應為空)⇒ **停下來問 Sean**,不要自動放行也不要硬擋到底。', v_n
      USING ERRCODE = 'P2F17', CONSTRAINT = 'l5b2_2f_unexpected_inflight';
  END IF;
  RAISE NOTICE '2f 觀察:符合「在途」定義的 payment_refunds 筆數 = %(預期 0)', v_n;

  RAISE NOTICE '2f 後置斷言全過(順序錨/鎖鍵等價/屬性保留/proconfig/COMMENT 前綴/carve-out 範圍/回傳碼閉集)。';
END;
$post_2f$;

COMMIT;
