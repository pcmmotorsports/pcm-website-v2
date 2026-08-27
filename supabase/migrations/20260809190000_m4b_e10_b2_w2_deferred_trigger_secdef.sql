-- ══════════════════════════════════════════════════════════════════════════
-- W2 半成品閘:DEFERRED constraint trigger 的函式必須 SECURITY DEFINER
-- ══════════════════════════════════════════════════════════════════════════
-- 🔴 事故(2026-08-09,正式站):Sean 按「建箱並標出貨」⇒
--    `permission denied for table pcm_b2_shipping_idempotency`(42501)。
--
-- 根因(讀檔+catalog 定案,不是推測):
--   `pcm_b2_shipping_idem_require_complete()`(`…w2_shipping_idempotency_layer.sql:524`)
--   宣告成 **SECURITY INVOKER**,而它掛的是 `DEFERRABLE INITIALLY DEFERRED` 的
--   CONSTRAINT TRIGGER(同檔 :558-561)。
--   ⇒ **DEFERRED 表示它在 COMMIT 當下才執行,那時 SECURITY DEFINER 的 RPC 早已退場**,
--     執行身分回到 session 角色 `service_role`;
--   ⇒ 函式體第一句 `SELECT … FROM public.pcm_b2_shipping_idempotency`,
--     而該表在 `…w0b_shipping_idempotency.sql:210` 對 service_role `REVOKE ALL`
--   ⇒ 42501。錢與出貨都卡在這裡。
--
-- 🔴 **判準(本片要留下的東西,不只是修這一支)**:
--   CONSTRAINT TRIGGER 的函式**是否需要 SECDEF,取決於它有沒有可能在 COMMIT 當下跑**:
--     · `DEFERRABLE INITIALLY DEFERRED` ⇒ 一定在 COMMIT 當下跑。
--     · 🔴 `DEFERRABLE INITIALLY IMMEDIATE` ⇒ **客戶端一句 `SET CONSTRAINTS ALL DEFERRED` 就延到 COMMIT**
--       ⇒ 它同樣逃得出 SECDEF 上下文。**判準是「可不可以被延遲」(`tgdeferrable`),不是「預設有沒有被延遲」。**
--       (這一條是 codex 對抗審查抓的:我原本只掃 `tginitdeferred`,漏掉這一整類。)
--     · `NOT DEFERRABLE`(含未宣告)⇒ 永遠在語句內跑 ⇒ 仍在呼叫者的 SECDEF 上下文 ⇒ 不在範圍。
--   本 repo 現況(**catalog 實測**,不是數 CREATE 敘述):`tgdeferrable` 共 **6 支**:
--     · initdeferred=true 四支:`order_cancellations_items_presence_ac` /
--       `order_cancellation_items_presence_ac`(a7t,fn=pcm_assert_cancellation_has_items)、
--       `shipments_items_presence_ac`(s1b,fn=pcm_b2_shipments_items_presence)、
--       `pcm_b2_shipping_idem_require_complete`(本片修的這支)。
--     · initdeferred=false 但可延遲兩支:`order_item_procurement_allocation_guard_ac`(a2b1)、
--       `order_item_procurement_summary_recompute_zc`(a4a)。
--   除了本片修的那支,其餘五支本來就是 SECDEF ⇒ **6 支裡只有 W2 這支漏了**。
--
-- 🔴 **本檔首版把這個數字寫成「8 支」,錯的**(2026-08-09 apply 後由正式站 NOTICE 印出 6 才發現)。
--    病因不是查詢面、也不是正式站漂移(本地重放與正式站都是 6,兩邊一致):
--    我是**數 migration 原始碼裡的 `CREATE CONSTRAINT TRIGGER` 敘述**得到 8 的,
--    而 `…a7c_refund_ledger_guards.sql:160-161` 後來把 rf2a2 那兩支 **DROP 掉了**。
--    ⇒ **要數「現在存在什麼」就得問 catalog,不能數建立敘述** —— 建立敘述只講歷史,不講現況。
--    本檔的三道斷言本來就查 catalog,所以斷言的涵蓋面從頭到尾是對的;錯的只有這行註解。
--    (本行於 apply 之後更正,**只改註解、不改任何行為**;DB 內沒有本檔的註解文字,無 repo/DB 語意分歧。)
--   斷言的範圍照判準畫在 `tgdeferrable` 上,而且不限 public schema。
--
-- 🔴 為什麼 harness 沒抓到:w0b/w1/w2 全程以 **owner(postgres)** 身分跑 ⇒
--    deferred 那一刻的身分也是 owner ⇒ 讀表恆過。**觀察點(執行身分)選錯**,
--    不是斷言太鬆。負測補在 **`scripts/w5-line-verify.sh`**(`LINE-NONOWNER-COMMIT` +
--    `TMUT-NONOWNER-COMMIT`):以真的 service_role 跑一次完整 create + commit,
--    靶把函式改回 INVOKER ⇒ 當場重現 42501。
--    🔴 **不放 `w2-verify.sh`**:那支只重放到自己的前綴(`PREFIX_TS=20260807160000`),
--       本修法比它晚 ⇒ 在它的世界裡根本不存在,負測會恆紅。線級 harness 才重放到尖端。
--
-- 修法選 `ALTER FUNCTION … SECURITY DEFINER` 而不是 CREATE OR REPLACE 帶全屬性:
--   函式體一個字都不改、`owner=postgres` 與 `SET search_path=''` 原本就對(w2:527/583),
--   ALTER 的 diff 面最小 ⇒ 最不容易在急件裡改壞別的東西。
-- ══════════════════════════════════════════════════════════════════════════

ALTER FUNCTION public.pcm_b2_shipping_idem_require_complete() SECURITY DEFINER;

COMMENT ON FUNCTION public.pcm_b2_shipping_idem_require_complete() IS
  'W2 半成品閘(對抗審查 R1-F2)。DEFERRED ⇒ 在 commit 當下才看,讓同交易的回填來得及。'
  '🔴 重讀表而非用 NEW:deferred trigger 的 NEW 是觸發當下的列版本(shipment_id 仍 NULL),用它會誤殺正常流程。'
  '🔴 它讓 claim() 裡的 P2B23 在正常情況下不可達 —— 兩層刻意都留,harness 用「拆掉本層才構造得出 P2B23」證各自的判別力。'
  '🔴 2026-08-09 事故:本函式原為 SECURITY INVOKER ⇒ commit 當下以 service_role 執行、讀 owner-only 的鍵表 42501。'
  'DEFERRED 必然逃出呼叫者的 SECDEF 上下文 ⇒ 這類函式一律要自己是 SECURITY DEFINER。';

-- ── fail-closed 斷言:同族全掃,不是只驗這一支 ────────────────────────────
-- 🔴 這道斷言的價值不在「現在是對的」,在**下一支 DEFERRED constraint trigger 落檔那天會紅**。
--    查的是 catalog 不是檔案字面 ⇒ 誰用 CREATE OR REPLACE 把 SECDEF 改掉也一樣紅。
DO $secdef_sweep$
DECLARE
  v_bad text;
  v_n   integer;
BEGIN
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(DISTINCT p.proname || '(trigger ' || t.tgname || ')', ', ' ORDER BY p.proname || '(trigger ' || t.tgname || ')')
    INTO v_n, v_bad
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc      p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_class     c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
     AND t.tgdeferrable
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND NOT p.prosecdef;
  IF v_n > 0 THEN
    RAISE EXCEPTION '可延遲(DEFERRABLE)的 constraint trigger 函式必須 SECURITY DEFINER —— 它可能在 COMMIT 當下跑,那時已離開呼叫者的 SECDEF 上下文。有 % 支不是:%',
                    v_n, v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_deferred_trigger_must_be_secdef';
  END IF;

  -- 🔴 SECDEF 而沒有釘死 search_path = 換一種洞(搜尋路徑挾持)⇒ 同一道掃描一起問。
  -- 🔴 codex must-fix:presence-only(`LIKE 'search_path=%'`)**放得過 `search_path=攻擊者的schema`**
  --    —— 那正好是這道斷言要擋的東西。⇒ 收成**兩值 allowlist**,兩個值都是本 repo 現行實際在用的。
  --    維護成本寫明:未來哪片要用第三種寫法,**回來加進這個清單**(會紅、擋得住,不是靜靜放過)。
  -- 🔴 首版我寫死要等於空字串,實跑當場擋掉三支
  --    本來就正確的函式:`pcm_assert_cancellation_has_items` 與 `pcm_b2_shipments_items_presence`
  --    用的是 `search_path=public, pg_temp`(PostgreSQL 官方對 SECDEF 建議的安全寫法之一),
  --    只有 W2 這支用 `search_path=""`。兩種都防得住挾持,選哪種是各片自己的事。
  --    **殘餘(codex 指出,不假裝關完)**:`public, pg_temp` 要安全,前提是 `public` 對非特權角色
  --    不可寫。本 repo 未確認這件事 —— 那是另一片的範圍(schema 級 ACL 稽核),記在這裡。
  SELECT pg_catalog.count(*)::integer,
         pg_catalog.string_agg(DISTINCT p.proname || '(' || coalesce(pg_catalog.array_to_string(p.proconfig, '|'), '無 proconfig') || ')', ', ')
    INTO v_n, v_bad
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_proc      p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_class     c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal
     AND t.tgdeferrable
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND NOT EXISTS (
           SELECT 1 FROM pg_catalog.unnest(coalesce(p.proconfig, ARRAY[]::text[])) cfg
            WHERE cfg IN ('search_path=""', 'search_path=public, pg_temp')
       );
  IF v_n > 0 THEN
    RAISE EXCEPTION '可延遲的 constraint trigger 函式的 search_path 必須是 allowlist 裡的值(空字串 或 public, pg_temp)—— presence-only 放得過攻擊者指定的 schema。有 % 支不是:%',
                    v_n, v_bad
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_deferred_trigger_must_pin_search_path';
  END IF;

  -- 🔴 前置自證:上面兩道若因為「一支都沒撈到」而恆真,這裡會擋下。
  --    本 repo 現況是**六支**可延遲的 constraint trigger(catalog 實測,見檔頭);
  --    數字掉到 0 = 查詢寫錯或 trigger 被 DROP,
  --    兩種都不該讓本 migration 靜靜通過。
  SELECT pg_catalog.count(*)::integer INTO v_n
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class     c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE NOT t.tgisinternal AND t.tgdeferrable
     AND n.nspname NOT IN ('pg_catalog', 'information_schema');
  IF v_n = 0 THEN
    RAISE EXCEPTION '掃描前置沒成立:一支可延遲的 constraint trigger 都沒撈到 ⇒ 上面兩道斷言是恆真的,拒絕通過'
      USING ERRCODE = 'P2B20', CONSTRAINT = 'pcm_b2_w2_deferred_sweep_vacuous';
  END IF;

  RAISE NOTICE 'W2 deferred-secdef 掃描通過:% 支**可延遲**的 constraint trigger,全部 SECDEF 且 search_path 在 allowlist 內', v_n;
END
$secdef_sweep$;
